<div align="center">

# JourneyOS

**Your AI Travel Operating System**

Describe the trip in one sentence. Get the whole plan — day-by-day itinerary, flights, stays, budget, visa requirements and a packing list.

</div>

---

## What it is

Planning a trip means twenty browser tabs that don't talk to each other. Change the dates and half the research is void.

JourneyOS is one chat box and a living trip document beside it. You say what you want; the assistant asks only for what it genuinely needs, then builds the whole thing. Change anything by saying so, and only the affected parts rebuild.

**The wedge is compliance.** Passport validity, visa requirements and insurance mandates are checked automatically for every traveller, each answer citing its source and the date it was verified. Competitors sell inventory or chat. Nobody owns the question travellers actually fear: *am I allowed to go, and what do I need first?*

---

## Quick start

**Prerequisites:** Node 20+ and Docker.

```bash
# 1. Database — PostgreSQL 17 on port 5433 (5432 is left free for your other projects)
docker run -d --name journeyos-db \
  -e POSTGRES_DB=journeyos -e POSTGRES_USER=journeyos -e POSTGRES_PASSWORD=journeyos \
  -p 5433:5432 -v journeyos-pgdata:/var/lib/postgresql/data \
  --restart unless-stopped postgres:17

# 2. Schema, seed data and the admin account
docker cp schema.sql journeyos-db:/tmp/schema.sql
docker exec -i journeyos-db psql -U journeyos -d journeyos -f /tmp/schema.sql

# 3. App
npm install
cp .env.example .env.local        # then generate a JWT secret, see below
npm run dev                       # http://localhost:3000
```

Generate the JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste it as `JWT_SECRET` in `.env.local`.

### Log in

| | |
|---|---|
| **Admin** | `admin@journeyos.local` / `Admin@12345` |
| **Anyone else** | Sign up at `/signup` — it takes about fifteen seconds |

The admin account is the only one that can reach `/admin`. **Change its password** before this is reachable by anyone but you:

```bash
docker exec -i journeyos-db psql -U journeyos -d journeyos \
  -c "update users set password_hash = crypt('YOUR-NEW-PASSWORD', gen_salt('bf',10)) where email='admin@journeyos.local';"
```

---

## The AI key

`OPENAI_API_KEY` is **deliberately left empty**.

- **With it empty**, the app runs on a deterministic fallback planner. Everything works end to end — slot extraction, plan generation, compliance, budget, documents, export — it just doesn't reason freely. Zero API cost, and the pressure test runs green against it.
- **Paste a key into `.env.local`** and the real model takes over with no code change. Restart `npm run dev` to pick it up.

```ini
OPENAI_API_KEY=sk-...
MODEL_PLANNER=gpt-4o          # multi-constraint reasoning + tool calling
MODEL_EXTRACTOR=gpt-4o-mini   # slot extraction, runs every turn, must be cheap
```

Model routing is where the margin lives — a "what's the weather" turn should never reach the expensive model. `/admin` shows which mode you're in, plus live token and cost figures.

---

## Using it

1. Land on `/`, type a trip, press the arrow. You're taken through signup; what you typed is replayed on the other side.
2. On the dashboard, type or tap a suggested prompt. Try the one that defines the product:

   > **Plan a 7-day London vacation for me, my wife and two kids**

3. Watch it extract `London`, `7 days`, `2 adults`, `2 children` — and **not** ask how many people are travelling. It asks only for what it can't infer: dates and the children's ages.
4. Answer: *"Second week of April. Kids are 6 and 11."*
5. The tool chips run, and the plan fills in: itinerary, flights, stays, documents, budget, essentials.
6. Open **Documents**. This tab is the product — per-traveller passport and visa status, each citing its source and verification date.
7. Click **Share** for a read-only link, or **Export PDF** to print.

Also worth trying: the 🎙 mic button, the ◐ theme toggle, and narrowing the window to phone width — the plan pane becomes a pull-up sheet.

---

## How it works

```
Browser ──► proxy.ts (edge: JWT check only)
            │
            ├─► /api/auth/*           bcrypt + rotating refresh tokens
            ├─► /api/trips/[id]/chat  Server-Sent Events
            │     └─► lib/ai/orchestrator.ts
            │           ├─ streaming tool loop (max 6 iterations)
            │           └─ lib/ai/tools.ts ──┬─► lib/providers    (flights, stays, places, weather)
            │                                ├─► lib/itinerary    (cluster → route → time-fit)
            │                                ├─► lib/compliance   (→ resolve_compliance() in SQL)
            │                                └─► lib/budget       (allocation + variance)
            └─► PostgreSQL 17
```

Three rules hold the whole thing together:

1. **The trip state object is the source of truth**, not the chat transcript. That is what makes turn 15 as reliable as turn 2.
2. **The model proposes; the server disposes.** Tools return structured data and the server applies it. A probabilistic model never writes to the database.
3. **No LLM call in `lib/itinerary/`, `lib/budget.ts`, or the visa decision.** Routing, time arithmetic and entry rules are the places where a probabilistic answer is never acceptable. `resolve_compliance()` is a PL/pgSQL function; the model only phrases its result.

---

## Pressure test

```bash
npm run dev          # in one terminal
npm run smoke        # in another
```

61 checks across authentication, the chat orchestrator, the itinerary engine's hard rules, compliance, budget, authorisation boundaries, share-link privacy, admin access, rate limiting and input validation.

```
Result  61 passed  0 failed
```

Among the things it proves:

- **CB-1** — *"me, my wife and two kids"* yields 2 adults + 2 children, and the assistant never asks for a headcount
- **FR-8.6** — walking stays under 5 km a day when a child under ten is travelling
- **IDOR** — a second account gets a 404 on someone else's trip, on both read and chat
- **Share privacy** — a public link leaks no budget, no documents, no email
- A malformed trip id returns 404, not a 500

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm run lint` | ESLint |
| `npm run smoke` | The 61-check pressure test |
| `npm run db:up` | Start the Postgres container |
| `npm run db:load` | Copy `schema.sql` in and re-apply it (resets data) |

---

## Project layout

```
journeyos/
├── app/
│   ├── page.tsx                    landing
│   ├── login · signup · reset      auth screens
│   ├── dashboard/                  composer, trips grid
│   ├── trips/[id]/                 the two-pane workspace
│   ├── share/[token]/              public read-only trip
│   ├── admin/                      operations dashboard
│   └── api/                        auth, trips, chat (SSE), share, admin
├── lib/
│   ├── ai/                         orchestrator, tools, prompt, fallback
│   ├── itinerary/build.ts          cluster → route → time-fit   (no LLM)
│   ├── budget.ts                   allocation + variance        (no LLM)
│   ├── compliance.ts               wraps resolve_compliance()   (no LLM)
│   ├── providers/                  flights, stays, places, weather, FX
│   ├── auth.ts · auth-edge.ts      Node-only / edge-safe split
│   └── db.ts · plan.ts · types.ts
├── data/seed.ts                    carriers, properties, attractions, tips
├── docs/                           PRD, implementation plan, API reference, overview PDF
├── scripts/smoke.mjs               the pressure test
├── schema.sql                      tables, enums, seeds, resolve_compliance(), admin
└── proxy.ts                        edge route guard
```

---

## Documentation

| Document | What's in it |
|---|---|
| [docs/PRD.md](docs/PRD.md) | The full product requirements — 31 sections. §13A is the chatbot behaviour spec. |
| [docs/PRD.html](docs/PRD.html) | The same, as a readable page with rendered diagrams |
| [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) | Build order, architecture decisions, code walkthrough |
| [docs/api.md](docs/api.md) | REST + SSE reference with real payloads |
| [docs/JourneyOS-Overview.pdf](docs/JourneyOS-Overview.pdf) | Four-page overview: problem, data model, state machine, objectives, stack |
| [docs/ui-prototype.html](docs/ui-prototype.html) | Standalone UI prototype — opens with no server |

---

## Data honesty

Flights, hotels, attractions and events come from a **seeded dataset** (`data/seed.ts`) with real carriers, real properties and real opening hours. Prices are indicative, and the UI labels them as sample data.

Weather is live from Open-Meteo inside the forecast window, and labelled climate normals beyond it. Visa rules are a seeded corpus with real source URLs and verification dates; a rule older than 30 days renders amber.

Swap any provider for a live API behind `lib/providers/` without touching anything above it.

---

## Security notes

This is a **development** configuration:

- The seeded admin password is public knowledge. Change it.
- `JWT_SECRET` must be unique per environment.
- The rate limiter is in-process; use Redis when you run more than one node.
- Visa and passport output is guidance, always shown with its source and an explicit disclaimer. It is not legal advice and never promises an outcome.

---

<div align="center">
<sub>Built as a one-day MVP. The hard part was never the backend — it was making the chatbot ask the right two questions.</sub>
</div>
