-- ============================================================================
-- JourneyOS — Database schema
-- Target: VANILLA PostgreSQL 14+ (local install, no Supabase, no cloud)
--
--   createdb journeyos
--   psql -U postgres -d journeyos -f schema.sql
--
-- Credentials: this project connects with user `postgres` and an EMPTY password,
-- which requires local trust authentication. See IMPLEMENTATION.md §2.
--
-- Authorisation is enforced in the application layer (every query is scoped by
-- user_id), NOT by row-level security -- there is no auth.uid() without Supabase.
-- The single admin account seeded at the bottom manages everything.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid(), crypt(), gen_salt()
create extension if not exists citext;     -- case-insensitive email

-- pgvector is OPTIONAL. The MVP retrieves with full-text search only.
-- Uncomment if you have the extension installed and want embeddings:
-- create extension if not exists vector;

-- ----------------------------------------------------------------------------
-- Clean slate (safe to re-run during development)
-- ----------------------------------------------------------------------------
drop table if exists audit_log, compliance_checks, trip_options, itinerary_items,
  messages, conversations, trip_travellers, trips, travellers, sessions,
  auth_tokens, knowledge_chunks, visa_rules, users cascade;

drop type if exists trip_status, trip_state, trip_pace, msg_role, item_slot,
  item_type, option_kind, hotel_tier, doc_type, doc_status, doc_severity,
  visa_outcome, passport_state, user_role cascade;

-- ----------------------------------------------------------------------------
-- Enums -- closed sets, so bad values cannot reach the application
-- ----------------------------------------------------------------------------
create type trip_status    as enum ('draft','planned','upcoming','active','completed','archived');
create type trip_state     as enum ('idle','gathering','drafting','ready','refining','blocked','packaged');
create type trip_pace      as enum ('relaxed','balanced','packed');
create type msg_role       as enum ('user','assistant','system','tool');
create type item_slot      as enum ('morning','afternoon','evening');
create type item_type      as enum ('activity','meal','transport','flight','checkin','free');
create type option_kind    as enum ('flight','hotel','event');
create type hotel_tier     as enum ('budget','mid','luxury');
create type doc_type       as enum ('passport','visa','insurance','health');
create type doc_status     as enum ('satisfied','required','in_progress','blocking');
create type doc_severity   as enum ('info','warning','blocking');
create type visa_outcome   as enum ('not_required','eta_required','evisa','visa_on_arrival','embassy_required');
create type passport_state as enum ('valid','expiring','expired','none','unknown');
create type user_role      as enum ('user','admin');

-- ----------------------------------------------------------------------------
-- users -- we own credentials now, so password_hash lives here (bcrypt, cost 10)
-- ----------------------------------------------------------------------------
create table users (
  id                uuid primary key default gen_random_uuid(),
  email             citext not null unique,
  password_hash     text,                        -- null for OAuth-only accounts
  google_id         text unique,
  full_name         text,
  home_city         text,
  home_iata         char(3),
  nationality       char(2),                     -- ISO-3166 alpha-2
  travel_style      text check (travel_style in ('budget','balanced','premium')),
  default_pace      trip_pace not null default 'balanced',
  locale            text not null default 'en-IN',
  currency          char(3) not null default 'INR',
  theme             text not null default 'dark' check (theme in ('dark','light','system')),
  role              user_role not null default 'user',
  preferences       jsonb not null default '{}'::jsonb,
  is_active         boolean not null default true,
  email_verified_at timestamptz,
  last_login_at     timestamptz,
  failed_logins     int not null default 0,
  locked_until      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint users_need_a_credential
    check (password_hash is not null or google_id is not null)
);

-- ----------------------------------------------------------------------------
-- sessions -- refresh-token family. Reuse of a consumed token revokes the family.
-- ----------------------------------------------------------------------------
create table sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  family_id    uuid not null default gen_random_uuid(),
  token_hash   text not null unique,            -- sha256 of the refresh token
  user_agent   text,
  ip           inet,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index sessions_user_idx   on sessions(user_id);
create index sessions_family_idx on sessions(family_id);

-- Password-reset and email-verification tokens share this table via `purpose`.
create table auth_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  purpose    text not null check (purpose in ('reset','verify')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index auth_tokens_user_idx on auth_tokens(user_id, purpose);

-- ----------------------------------------------------------------------------
-- travellers -- reusable people. Passport NUMBER is deliberately never stored.
-- ----------------------------------------------------------------------------
create table travellers (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  name            text not null,
  birth_date      date,
  nationality     char(2) not null,
  passport_status passport_state not null default 'unknown',
  passport_expiry date,
  notes           text,
  created_at      timestamptz not null default now(),
  constraint traveller_expiry_needs_passport
    check (passport_expiry is null or passport_status <> 'none')
);
create index travellers_user_idx on travellers(user_id);

-- Age band is derived, never stored stale. Drives walking caps and activity filters.
create or replace function traveller_age_band(birth date, on_date date default current_date)
returns text language sql immutable as $$
  select case
    when birth is null then 'adult'
    when extract(year from age(on_date, birth)) < 2   then 'infant'
    when extract(year from age(on_date, birth)) < 13  then 'child'
    when extract(year from age(on_date, birth)) < 18  then 'teen'
    when extract(year from age(on_date, birth)) >= 70 then 'senior'
    else 'adult' end;
$$;

-- ----------------------------------------------------------------------------
-- trips -- the plan container and the canonical trip state
-- ----------------------------------------------------------------------------
create table trips (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  title               text not null default 'New trip',
  destination_city    text,
  destination_country char(2),
  destination_lat     numeric(9,6),
  destination_lng     numeric(9,6),
  origin_city         text,
  origin_iata         char(3),
  start_date          date,
  end_date            date,
  duration_days       int check (duration_days between 1 and 90),
  dates_flexible      boolean not null default false,
  party_adults        int not null default 1 check (party_adults between 1 and 12),
  party_children      int[] not null default '{}',   -- ages, e.g. '{6,11}'
  budget_total        numeric(12,2) check (budget_total >= 0),
  budget_per_person   boolean not null default false,
  currency            char(3) not null default 'INR',
  pace                trip_pace not null default 'balanced',
  interests           text[] not null default '{}',
  hotel_tier          hotel_tier,
  assumptions         text[] not null default '{}',  -- defaults we applied, shown in the UI
  status              trip_status not null default 'draft',
  state               trip_state  not null default 'idle',
  share_token         text unique,
  share_revoked_at    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint trip_dates_ordered
    check (end_date is null or start_date is null or end_date >= start_date)
);
create index trips_user_status_idx on trips(user_id, status);
create index trips_updated_idx     on trips(user_id, updated_at desc);
create index trips_share_idx       on trips(share_token) where share_token is not null;

create table trip_travellers (
  trip_id      uuid not null references trips(id) on delete cascade,
  traveller_id uuid not null references travellers(id) on delete cascade,
  primary key (trip_id, traveller_id)
);

-- ----------------------------------------------------------------------------
-- conversations / messages -- one thread per trip
-- ----------------------------------------------------------------------------
create table conversations (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null unique references trips(id) on delete cascade,
  summary    text,                             -- rolling summary of older turns
  created_at timestamptz not null default now()
);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            msg_role not null,
  content         text,
  tool_calls      jsonb,                       -- [{name, args, resultRef, ms}]
  input_mode      text check (input_mode in ('text','voice')),
  model           text,
  prompt_version  text,
  tokens_in       int not null default 0,
  tokens_out      int not null default 0,
  cost_usd        numeric(10,6) not null default 0,
  created_at      timestamptz not null default now()
);
create index messages_convo_idx on messages(conversation_id, created_at);

-- ----------------------------------------------------------------------------
-- itinerary_items -- the plan rows. source_tool is NOT NULL: nothing unsourced renders.
-- ----------------------------------------------------------------------------
create table itinerary_items (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references trips(id) on delete cascade,
  day_number      int not null check (day_number between 1 and 90),
  item_date       date,
  slot            item_slot not null default 'morning',
  sort_order      int not null default 0,
  item_type       item_type not null default 'activity',
  title           text not null,
  description     text,
  place_id        text,
  place_name      text,
  lat             numeric(9,6),
  lng             numeric(9,6),
  start_time      time,
  duration_min    int check (duration_min between 0 and 1440),
  cost_amount     numeric(12,2),
  cost_currency   char(3),
  cost_per        text check (cost_per in ('person','group')),
  travel_mode     text check (travel_mode in ('walk','transit','taxi','drive','flight')),
  travel_minutes  int,
  travel_km       numeric(6,2),
  age_bands       text[] not null default '{}',
  ticket_required boolean not null default false,
  booking_url     text,
  locked          boolean not null default false,  -- re-planning must never move this
  source_tool     text not null,
  fetched_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index itinerary_trip_day_idx on itinerary_items(trip_id, day_number, sort_order);

-- ----------------------------------------------------------------------------
-- trip_options -- shortlisted flights, hotels and events
-- ----------------------------------------------------------------------------
create table trip_options (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips(id) on delete cascade,
  kind        option_kind not null,
  provider    text not null,
  payload     jsonb not null,                  -- FlightOffer | HotelOffer | Event
  value_score numeric(5,2) check (value_score between 0 and 100),
  reason      text,                            -- one line, shown in the UI
  selected    boolean not null default false,
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index options_trip_kind_idx on trip_options(trip_id, kind, value_score desc);
create unique index options_one_selected_per_kind
  on trip_options(trip_id, kind) where selected;

-- ----------------------------------------------------------------------------
-- visa_rules -- the seeded corpus.
-- source_url and verified_on are NOT NULL by design: a rule we cannot
-- attribute is a rule we do not serve.
-- ----------------------------------------------------------------------------
create table visa_rules (
  id                       uuid primary key default gen_random_uuid(),
  nationality              char(2) not null,
  destination              char(2) not null,
  purpose                  text not null default 'tourism',
  max_stay_days            int,
  outcome                  visa_outcome not null,
  passport_validity_months int not null default 0,  -- months required beyond entry/exit
  validity_basis           text not null default 'entry'
                           check (validity_basis in ('entry','exit','stay')),
  insurance_required       boolean not null default false,
  insurance_min_cover      numeric(12,2),
  insurance_currency       char(3),
  fee_amount               numeric(10,2),
  fee_currency             char(3),
  processing_days_min      int,
  processing_days_max      int,
  blank_pages_required     int,
  notes                    text,
  source_url               text not null,
  verified_on              date not null,
  created_at               timestamptz not null default now(),
  unique (nationality, destination, purpose)
);
create index visa_rules_lookup_idx on visa_rules(nationality, destination);

-- A rule older than 30 days is still served, but flagged stale in the UI.
create or replace view visa_rules_v as
  select *, (current_date - verified_on) > 30 as is_stale from visa_rules;

-- ----------------------------------------------------------------------------
-- compliance_checks -- resolved requirements per traveller per trip
-- ----------------------------------------------------------------------------
create table compliance_checks (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references trips(id) on delete cascade,
  traveller_id   uuid not null references travellers(id) on delete cascade,
  document_type  doc_type not null,
  status         doc_status not null,
  severity       doc_severity not null default 'info',
  outcome        visa_outcome,
  requirement    text not null,
  shortfall_days int,                          -- passport validity gap, when applicable
  details        jsonb not null default '{}'::jsonb,
  source_url     text not null,
  verified_on    date not null,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (trip_id, traveller_id, document_type)
);
create index compliance_trip_sev_idx on compliance_checks(trip_id, severity);

-- ----------------------------------------------------------------------------
-- knowledge_chunks -- destination and procedural knowledge.
-- Full-text search only in the MVP; add the embedding column with pgvector later.
-- ----------------------------------------------------------------------------
create table knowledge_chunks (
  id           uuid primary key default gen_random_uuid(),
  corpus       text not null,                  -- 'visa' | 'passport' | 'advisory' | 'destination'
  jurisdiction char(2),                        -- filter BEFORE ranking
  title        text,
  body         text not null,
  source_url   text not null,
  verified_on  date not null,
  tokens       int,
  created_at   timestamptz not null default now()
  -- , embedding vector(1536)                  -- uncomment with pgvector
);
create index chunks_corpus_idx on knowledge_chunks(corpus, jurisdiction);
create index chunks_fts_idx on knowledge_chunks
  using gin (to_tsvector('english', coalesce(title,'') || ' ' || body));
-- create index chunks_vec_idx on knowledge_chunks
--   using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ----------------------------------------------------------------------------
-- audit_log -- append-only. Every admin read of user data lands here with a reason.
-- ----------------------------------------------------------------------------
create table audit_log (
  id         bigserial primary key,
  actor_id   uuid references users(id),
  action     text not null,
  subject    text,
  subject_id uuid,
  reason     text,
  metadata   jsonb not null default '{}'::jsonb,
  ip         inet,
  created_at timestamptz not null default now()
);
create index audit_actor_idx on audit_log(actor_id, created_at desc);

-- ----------------------------------------------------------------------------
-- updated_at maintenance
-- ----------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists users_touch on users;
create trigger users_touch before update on users
  for each row execute function touch_updated_at();

drop trigger if exists trips_touch on trips;
create trigger trips_touch before update on trips
  for each row execute function touch_updated_at();

-- ============================================================================
-- THE ADMIN ACCOUNT
--
-- One account manages everything: users, analytics, provider health, AI cost,
-- conversation inspection, feature flags.
--
--   email    : admin@journeyos.local
--   password : Admin@12345
--
-- The hash below is bcrypt (cost 10), generated by pgcrypto, so it is
-- verifiable by bcryptjs in the Node app with no extra step.
-- CHANGE THIS PASSWORD before the app is reachable by anyone but you.
-- ============================================================================
insert into users (email, password_hash, full_name, role, nationality,
                   home_city, home_iata, travel_style, currency,
                   email_verified_at, is_active)
values ('admin@journeyos.local',
        crypt('Admin@12345', gen_salt('bf', 10)),
        'JourneyOS Admin', 'admin', 'IN',
        'Bengaluru', 'BLR', 'balanced', 'INR',
        now(), true)
on conflict (email) do update
  set role = 'admin', is_active = true, email_verified_at = now();

-- A demo traveller set on the admin account, so the UI has something to show
-- and the blocking-passport case is reproducible on first run.
insert into travellers (user_id, name, birth_date, nationality, passport_status, passport_expiry)
select u.id, t.name, t.birth_date, 'IN', t.st::passport_state, t.exp
from users u,
  (values
    ('Priya Raman',  date '1988-03-12', 'valid',    date '2030-03-11'),
    ('Arjun Raman',  date '1986-07-02', 'valid',    date '2028-08-20'),
    ('Maya Raman',   date '2015-09-18', 'expiring', date '2027-06-30'),
    ('Vihaan Raman', date '2021-02-14', 'none',     null)
  ) as t(name, birth_date, st, exp)
where u.email = 'admin@journeyos.local';

-- ----------------------------------------------------------------------------
-- Seed -- visa rules. One row per outcome type, so every UI state is
-- demonstrable on first run. Verify the dates before any real use.
-- ----------------------------------------------------------------------------
insert into visa_rules
  (nationality, destination, outcome, passport_validity_months, validity_basis,
   insurance_required, insurance_min_cover, insurance_currency,
   fee_amount, fee_currency, processing_days_min, processing_days_max,
   max_stay_days, notes, source_url, verified_on)
values
  ('IN','GB','embassy_required', 0,'stay', false, null, null, 127,'GBP', 15, 21, 180,
   'Standard Visitor visa. Online application, biometrics at a VFS centre. Tied to the passport number, so apply after any renewal.',
   'https://www.gov.uk/standard-visitor', current_date - 5),

  ('IN','AE','visa_on_arrival', 6,'entry', false, null, null, 0,'AED', 0, 0, 14,
   'Visa on arrival for 14 days for eligible passport holders. Six months validity required.',
   'https://u.ae/en/information-and-services/visa-and-emirates-id', current_date - 9),

  ('IN','TH','evisa', 6,'entry', false, null, null, 0,'THB', 1, 3, 60,
   'Entry without a visa for tourism under the current scheme; register online before travel.',
   'https://www.thaievisa.go.th', current_date - 7),

  ('IN','FR','embassy_required', 3,'exit', true, 30000,'EUR', 90,'EUR', 10, 15, 90,
   'Schengen short-stay visa. Travel medical insurance of at least EUR 30,000 is mandatory. 90 days in any 180.',
   'https://france-visas.gouv.fr', current_date - 4),

  ('IN','SG','not_required', 6,'entry', false, null, null, 0,'SGD', 0, 0, 30,
   'No visa for tourism up to 30 days. Submit the SG Arrival Card within three days of arrival.',
   'https://www.ica.gov.sg', current_date - 11),

  ('IN','US','embassy_required', 6,'entry', false, null, null, 185,'USD', 60, 365, 180,
   'B1/B2 visitor visa. In-person interview required; appointment waits vary widely by consulate -- check before planning dates.',
   'https://travel.state.gov', current_date - 6),

  ('IN','JP','evisa', 6,'entry', false, null, null, 0,'JPY', 5, 7, 90,
   'eVisa for short-term tourism for eligible applicants. Apply online before travel.',
   'https://www.mofa.go.jp', current_date - 33),   -- deliberately stale, to exercise the amber state

  ('US','GB','eta_required', 0,'stay', false, null, null, 10,'GBP', 0, 3, 180,
   'Electronic Travel Authorisation required before travel. Approval usually within three working days.',
   'https://www.gov.uk/guidance/electronic-travel-authorisation-eta', current_date - 8);

-- ----------------------------------------------------------------------------
-- resolve_compliance() -- the structured path.
-- The model EXPLAINS this result; it never computes it.
-- ----------------------------------------------------------------------------
create or replace function resolve_compliance(
  p_nationality     char(2),
  p_destination     char(2),
  p_passport_expiry date,
  p_depart          date,
  p_return          date
) returns table (
  document_type  doc_type,
  status         doc_status,
  severity       doc_severity,
  outcome        visa_outcome,
  requirement    text,
  shortfall_days int,
  source_url     text,
  verified_on    date
) language plpgsql stable as $$
declare r record; required_until date; gap int;
begin
  select * into r from visa_rules
   where nationality = p_nationality
     and destination = p_destination
     and purpose = 'tourism';

  if not found then
    return query select 'visa'::doc_type, 'required'::doc_status, 'warning'::doc_severity,
      null::visa_outcome,
      'No verified rule on file for this nationality and destination. Confirm with the official source before booking.'::text,
      null::int, 'https://www.iatatravelcentre.com'::text, current_date;
    return;
  end if;

  -- Passport validity
  required_until := case r.validity_basis
                      when 'entry' then (p_depart + (r.passport_validity_months || ' months')::interval)::date
                      when 'exit'  then (p_return + (r.passport_validity_months || ' months')::interval)::date
                      else p_return
                    end;

  if p_passport_expiry is null then
    return query select 'passport'::doc_type, 'blocking'::doc_status, 'blocking'::doc_severity,
      null::visa_outcome,
      'No passport on file. Apply before anything else -- the visa application is tied to the passport number.'::text,
      null::int, r.source_url, r.verified_on;
  else
    gap := required_until - p_passport_expiry;
    if gap > 0 then
      return query select 'passport'::doc_type, 'blocking'::doc_status, 'blocking'::doc_severity,
        null::visa_outcome,
        format('Passport expires %s but %s requires validity until %s -- short by %s days. Renew before applying for the visa.',
               p_passport_expiry, p_destination, required_until, gap)::text,
        gap, r.source_url, r.verified_on;
    else
      return query select 'passport'::doc_type, 'satisfied'::doc_status, 'info'::doc_severity,
        null::visa_outcome,
        format('Passport valid to %s -- beyond the %s requirement.', p_passport_expiry, p_destination)::text,
        null::int, r.source_url, r.verified_on;
    end if;
  end if;

  -- Visa
  return query select 'visa'::doc_type,
    (case when r.outcome = 'not_required' then 'satisfied' else 'required' end)::doc_status,
    (case when r.outcome = 'not_required' then 'info' else 'warning' end)::doc_severity,
    r.outcome, r.notes::text, null::int, r.source_url, r.verified_on;

  -- Insurance
  if r.insurance_required then
    return query select 'insurance'::doc_type, 'required'::doc_status, 'warning'::doc_severity,
      null::visa_outcome,
      format('Travel medical insurance of at least %s %s is mandatory for entry.',
             r.insurance_min_cover, r.insurance_currency)::text,
      null::int, r.source_url, r.verified_on;
  end if;
end; $$;

-- ----------------------------------------------------------------------------
-- Verify the install
-- ----------------------------------------------------------------------------
-- Expect: passport BLOCKING (short by N days) + visa REQUIRED (embassy_required)
--   select * from resolve_compliance('IN','GB', date '2027-06-30', date '2027-04-11', date '2027-04-18');
-- Expect: one admin
--   select email, role from users where role = 'admin';
-- Expect: 8 rules, one of them stale
--   select nationality, destination, outcome, is_stale from visa_rules_v order by destination;

do $$
begin
  raise notice 'JourneyOS schema installed. Admin: admin@journeyos.local / Admin@12345 -- change it.';
end $$;

-- ============================================================================
-- End of schema.
-- ============================================================================
