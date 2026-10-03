# JourneyOS — Implementation Approach

Companion to [`PRD.md`](PRD.md). This is the build order: what to install, what to write, in what sequence, and how to know each step worked.

**Target:** one working day, 1–2 developers, one deployable Next.js app.

---

## 0. Decisions and assumptions

Three things changed from the PRD's original stack, because you asked for plain Postgres with blank credentials:

| Was | Now | Why |
|---|---|---|
| Supabase Auth | **Own auth** — bcrypt + JWT in httpOnly cookies | Supabase needs a hosted project and keys. You asked for a local database with empty credentials. |
| Supabase Postgres + RLS | **Local Postgres**, authorisation in the app layer | `auth.uid()` doesn't exist outside Supabase. Every query is scoped by `user_id` instead. |
| pgvector for RAG | **Postgres full-text search** | One less extension to install. The MVP's visa corpus is a table, not embeddings. |

Assumptions I've made — correct me if any is wrong:

1. **Database credentials.** User `postgres`, password empty, via local *trust* authentication (§2). The Windows installer forces you to set a superuser password, so blank-password access is configured afterwards in `pg_hba.conf`.
2. **Admin account.** One account, seeded by `schema.sql`: `admin@journeyos.local` / `Admin@12345`, `role = 'admin'`. It is the only account that can reach `/admin`.
3. **Flights and hotels are seeded JSON**, not live APIs. Real supplier integration is a week-2 job; sandbox approvals aren't same-day reliable.
4. **Google OAuth is optional.** Email/password is the P0 path. Add Google only if you have a client ID to hand.
5. **This is a development setup.** Trust auth and a known admin password are fine on localhost and unacceptable anywhere reachable.

---

## 1. Prerequisites

You have Node v24.19.0 and npm 11.17.0. You need Postgres.

**Install PostgreSQL 17** — download from `postgresql.org/download/windows`, run the installer, and:

- Keep the Stack Builder components unchecked; you only need the server and command-line tools
- Set a superuser password when asked (you'll bypass it in the next step — just note it down)
- Leave the port at `5432`
- Tick **Command Line Tools** so you get `psql`

Then add `psql` to your PATH for the session:

```powershell
$env:Path += ";C:\Program Files\PostgreSQL\17\bin"
psql --version
```

To make it permanent:

```powershell
[Environment]::SetEnvironmentVariable(
  "Path",
  [Environment]::GetEnvironmentVariable("Path", "User") + ";C:\Program Files\PostgreSQL\17\bin",
  "User")
```

---

## 2. Empty-password access (trust authentication)

Postgres will not accept a blank password under `scram-sha-256`. Switch local connections to `trust`, which skips password checking entirely.

Open `C:\Program Files\PostgreSQL\17\data\pg_hba.conf` in an editor **running as Administrator**, and change the bottom four method entries from `scram-sha-256` to `trust`:

```
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
host    replication     all             127.0.0.1/32            trust
```

Restart the service and confirm you can connect with no password:

```powershell
Restart-Service postgresql-x64-17
psql -U postgres -c "select current_user, version();"
```

If that returns a row without prompting, blank-credential access works.

> **Security note, stated once.** `trust` means *anyone who can reach port 5432 is any database user*. Keep Postgres bound to `localhost` (it is by default) and never apply this to a machine on an untrusted network.

---

## 3. Create the database

```powershell
psql -U postgres -c "CREATE DATABASE journeyos;"
psql -U postgres -d journeyos -f "C:\Users\Udayshankar\Downloads\Mini project\schema.sql"
```

The script is idempotent — it drops and recreates its own objects, so re-run it freely during the build.

**Verify all three things it set up:**

```powershell
# 1. The admin account exists
psql -U postgres -d journeyos -c "select email, role from users where role='admin';"

# 2. Eight visa rules, one deliberately stale (to exercise the amber UI state)
psql -U postgres -d journeyos -c "select nationality, destination, outcome, is_stale from visa_rules_v order by destination;"

# 3. The compliance engine resolves the blocking passport case
psql -U postgres -d journeyos -c "select document_type, status, severity, shortfall_days from resolve_compliance('IN','GB', date '2027-06-30', date '2027-04-11', date '2027-04-18');"
```

The third query is the one that matters. It should return `passport | blocking | blocking | <N>` and `visa | required | warning`. That function is the compliance engine — the model only phrases its output, never computes it.

---

## 4. Scaffold the app

```powershell
cd "C:\Users\Udayshankar\Downloads\Mini project"
npx create-next-app@latest journeyos --typescript --tailwind --app --eslint --src-dir=false --import-alias "@/*" --no-turbopack
cd journeyos

# data + auth
npm i pg bcryptjs jose zod
npm i -D @types/pg @types/bcryptjs

# AI
npm i @anthropic-ai/sdk

# UI
npm i lucide-react framer-motion clsx tailwind-merge
npx shadcn@latest init
npx shadcn@latest add button input card tabs accordion badge dialog sheet skeleton progress checkbox
```

### `.env.local`

```ini
# Database -- empty password, trust auth (see IMPLEMENTATION.md section 2)
DATABASE_URL=postgresql://postgres@localhost:5432/journeyos
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=
PGDATABASE=journeyos

# Auth -- generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=replace-me-with-32-random-bytes
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=2592000

# Admin (seeded by schema.sql -- change the password after first login)
ADMIN_EMAIL=admin@journeyos.local

# AI
ANTHROPIC_API_KEY=sk-ant-...
MODEL_PLANNER=claude-opus-5-5
MODEL_EXTRACTOR=claude-haiku-4-5
AI_DAILY_CAP_USD=10

# Optional
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Copy this to `.env.example` with the secrets blanked, and make sure `.env.local` is in `.gitignore`.

---

## 5. Folder structure

```
journeyos/
├── app/
│   ├── (marketing)/page.tsx            # S-01 landing
│   ├── (auth)/
│   │   ├── signup/page.tsx             # S-02
│   │   ├── login/page.tsx              # S-03
│   │   └── reset/page.tsx              # S-04
│   ├── (app)/
│   │   ├── layout.tsx                  # shell: topbar, theme, auth guard
│   │   ├── dashboard/page.tsx          # S-06
│   │   ├── trips/page.tsx              # S-14
│   │   └── trips/[id]/page.tsx         # S-07 the workspace
│   ├── share/[token]/page.tsx          # S-16 public, no auth
│   ├── admin/page.tsx                  # S-19 admin only
│   └── api/
│       ├── auth/{signup,login,logout,refresh,forgot,reset}/route.ts
│       ├── trips/route.ts
│       ├── trips/[id]/route.ts
│       ├── trips/[id]/chat/route.ts    # SSE -- the core endpoint
│       ├── trips/[id]/itinerary/[itemId]/route.ts
│       └── admin/metrics/route.ts
├── lib/
│   ├── db.ts                           # pg pool
│   ├── auth.ts                         # hash, JWT, cookies, session helpers
│   ├── ai/
│   │   ├── client.ts                   # Anthropic client + model routing
│   │   ├── prompt.ts                   # the system prompt (PRD section 13A.5)
│   │   ├── extract.ts                  # slot extraction, structured output
│   │   ├── orchestrator.ts             # the streaming tool loop
│   │   └── tools.ts                    # the tool registry
│   ├── itinerary/
│   │   ├── cluster.ts                  # geographic grouping
│   │   ├── route.ts                    # nearest-neighbour + 2-opt
│   │   └── build.ts                    # time-fit, walking caps -- NO LLM
│   ├── compliance.ts                   # wraps resolve_compliance()
│   ├── budget.ts                        # allocation + variance -- NO LLM
│   └── providers/{flights,hotels,places,weather,fx}.ts
├── components/{ui,chat,trip}/
├── data/seed/{flights.json,hotels.json,places.json}
└── middleware.ts                       # edge: JWT check + route guards
```

The two rules that keep this clean: **`lib/itinerary/*` and `lib/budget.ts` never import the AI client**, and **`app/api/*` never contains business logic** — routes parse, authorise, delegate, respond.

---

## 6. Build order

Each block ends in something you can see working. Don't move on until it does.

| # | Block | Hrs | Files | Done when |
|---|---|---|---|---|
| 0 | Setup | 0.5 | scaffold, `.env.local`, `lib/db.ts` | `select 1` returns from a route handler |
| 1 | Design system | 1.0 | `globals.css` tokens, `components/ui/*` | A demo page renders every primitive in dark and light |
| 2 | Auth | 1.0 | `lib/auth.ts`, `api/auth/*`, 3 screens, `middleware.ts` | Sign up, log out, log in, reset; `/dashboard` redirects when signed out |
| 3 | Data + seed | 0.75 | `schema.sql` applied, `data/seed/*` | Seeded flights and hotels render in a scratch page |
| 4 | Dashboard | 0.75 | `dashboard/page.tsx`, `AIComposer` | Typing a prompt creates a trip row and routes to `/trips/[id]` |
| 5 | Chat + orchestrator | 2.0 | `lib/ai/*`, `api/trips/[id]/chat/route.ts` | One sentence produces a persisted, complete plan |
| 6 | Workspace UI | 2.0 | `trips/[id]/page.tsx`, `components/trip/*` | All six tabs render real data with real empty/loading/error states |
| 7 | Compliance + budget | 0.75 | `lib/compliance.ts`, `lib/budget.ts` | The blocking-passport case renders with source and verified date |
| 8 | Package + polish | 1.0 | print stylesheet, share token, mobile sheet | PDF export works on a phone; Lighthouse ≥90 |
| — | Buffer | 0.75 | — | — |

**Two developers:** split after block 4. Dev A takes 5 and 7 (AI, compliance, budget). Dev B takes 6 and 8 (workspace, polish). They meet at the `TripPatch` shape, so agree that type first — it is the contract between them.

**If you fall behind,** cut in this order: drag-and-drop → events tab → share links → admin page. Never cut compliance; it is the product.

---

## 7. The parts worth getting right

### 7.1 Database client — `lib/db.ts`

One pool for the process. Note `password` is omitted entirely rather than set to `""`; node-postgres treats an empty string as a password attempt, which trust auth doesn't need.

```ts
import { Pool } from "pg";

const globalForDb = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForDb.pool ??
  new Pool({
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? "postgres",
    database: process.env.PGDATABASE ?? "journeyos",
    // no `password` key at all -- trust auth
    max: 10,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

/** Every trip read goes through this. Ownership is checked in SQL, not in JS. */
export async function ownedTrip(tripId: string, userId: string) {
  const [trip] = await q(`select * from trips where id = $1 and user_id = $2`, [tripId, userId]);
  if (!trip) throw new HttpError(404, "TRIP_NOT_FOUND");
  return trip;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}
```

### 7.2 Auth — `lib/auth.ts`

`jose` rather than `jsonwebtoken`, because Next.js middleware runs on the edge runtime where Node crypto isn't available.

```ts
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import { q } from "./db";

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
const ACCESS_TTL = Number(process.env.JWT_ACCESS_TTL ?? 900);

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export type Claims = { sub: string; email: string; role: "user" | "admin" };

export async function signAccess(c: Claims) {
  return new SignJWT({ email: c.email, role: c.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(c.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL}s`)
    .sign(secret);
}

export async function readAccess(token?: string): Promise<Claims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return { sub: payload.sub!, email: payload.email as string, role: payload.role as any };
  } catch {
    return null;        // expired or tampered -- treat as signed out
  }
}

/** Refresh tokens are random, stored only as a sha256 hash, and single-use. */
export async function issueRefresh(userId: string, familyId?: string) {
  const raw = randomBytes(32).toString("hex");
  const token_hash = createHash("sha256").update(raw).digest("hex");
  await q(
    `insert into sessions (user_id, family_id, token_hash, expires_at)
     values ($1, coalesce($2, gen_random_uuid()), $3, now() + interval '30 days')`,
    [userId, familyId ?? null, token_hash]
  );
  return raw;
}

/** Reuse of a consumed token means the cookie leaked: kill the whole family. */
export async function rotateRefresh(raw: string) {
  const hash = createHash("sha256").update(raw).digest("hex");
  const [row] = await q<any>(`select * from sessions where token_hash = $1`, [hash]);
  if (!row || row.revoked_at || row.expires_at < new Date()) return null;
  if (row.consumed_at) {
    await q(`update sessions set revoked_at = now() where family_id = $1`, [row.family_id]);
    return null;
  }
  await q(`update sessions set consumed_at = now() where id = $1`, [row.id]);
  return { userId: row.user_id, next: await issueRefresh(row.user_id, row.family_id) };
}

export async function currentUser(): Promise<Claims | null> {
  return readAccess((await cookies()).get("jos_at")?.value);
}

export async function requireUser(): Promise<Claims> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "UNAUTHENTICATED");
  return u;
}

export async function requireAdmin(): Promise<Claims> {
  const u = await requireUser();
  if (u.role !== "admin") throw new HttpError(403, "FORBIDDEN");
  return u;
}
```

Login writes two httpOnly cookies — `jos_at` (15 min) and `jos_rt` (30 days, `path=/api/auth/refresh`) — both `secure` in production, `sameSite: "lax"`.

### 7.3 Route guard — `middleware.ts`

Edge-safe: JWT signature only, no database.

```ts
import { NextResponse, type NextRequest } from "next/server";
import { readAccess } from "@/lib/auth";

const PROTECTED = ["/dashboard", "/trips", "/settings", "/profile"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const claims = await readAccess(req.cookies.get("jos_at")?.value);

  if (pathname.startsWith("/admin")) {
    if (claims?.role !== "admin") return NextResponse.redirect(new URL("/login", req.url));
    return NextResponse.next();
  }
  if (PROTECTED.some((p) => pathname.startsWith(p)) && !claims) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/trips/:path*", "/settings/:path*", "/profile/:path*", "/admin/:path*"],
};
```

### 7.4 AI client and model routing — `lib/ai/client.ts`

Two models: a frontier model for planning, a cheap fast one for extraction. Routing is where the margin lives.

```ts
import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic();   // reads ANTHROPIC_API_KEY

export const MODELS = {
  planner:   process.env.MODEL_PLANNER   ?? "claude-opus-5-5",
  extractor: process.env.MODEL_EXTRACTOR ?? "claude-haiku-4-5",
} as const;

// USD per million tokens, for the admin cost panel
const PRICE = {
  "claude-opus-5-5":  { in: 4,  out: 20 },
  "claude-haiku-4-5": { in: 1,  out: 5  },
} as const;

export function costUsd(model: string, usage: { input_tokens: number; output_tokens: number }) {
  const p = PRICE[model as keyof typeof PRICE];
  if (!p) return 0;
  return (usage.input_tokens / 1e6) * p.in + (usage.output_tokens / 1e6) * p.out;
}
```

### 7.5 Slot extraction — `lib/ai/extract.ts`

This is the turn that decides whether the chatbot feels intelligent. Structured output, so you get a typed object rather than prose to parse.

```ts
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, MODELS } from "./client";

const Slots = z.object({
  intent: z.enum(["plan_trip", "modify_plan", "ask_question", "compliance", "smalltalk"]),
  destinationCity: z.string().nullable(),
  durationDays: z.number().int().nullable(),
  adults: z.number().int().nullable(),
  childAges: z.array(z.number().int()),
  startDate: z.string().nullable(),       // ISO, resolved from "second week of April"
  originCity: z.string().nullable(),
  budgetTotal: z.number().nullable(),
  interests: z.array(z.string()),
  constraints: z.array(z.string()),       // "no museum day longer than 2 hours"
});

export async function extractSlots(text: string, known: unknown) {
  const res = await anthropic.messages.parse({
    model: MODELS.extractor,
    max_tokens: 2048,
    system:
      "Extract travel planning slots from the user's message. " +
      "Infer aggressively but never invent: \"me, my wife and two kids\" means adults=2, childAges=[] " +
      "(two children, ages unknown). Resolve relative dates against today. " +
      "Return null for anything genuinely absent. Carry forward anything already known. " +
      "Add any standing constraint the user states to `constraints`.",
    messages: [
      { role: "user", content: `Known so far:\n${JSON.stringify(known)}\n\nNew message:\n${text}` },
    ],
    output_config: { format: zodOutputFormat(Slots) },
  });
  return res.parsed_output;    // null if parsing failed -- guard at the call site
}
```

**The acceptance test for this function is CB-1:** given the brief's exact sentence, it must return `destinationCity: "London"`, `durationDays: 7`, `adults: 2`, `childAges: []` of length 2. If it asks for headcount later, this function is wrong.

### 7.6 Tool registry — `lib/ai/tools.ts`

Every external fact comes through here. The model may call nothing else.

```ts
import type Anthropic from "@anthropic-ai/sdk";
import { searchFlights } from "@/lib/providers/flights";
import { searchHotels } from "@/lib/providers/hotels";
import { searchPlaces } from "@/lib/providers/places";
import { getWeather } from "@/lib/providers/weather";
import { checkCompliance } from "@/lib/compliance";
import { buildItinerary } from "@/lib/itinerary/build";
import { computeBudget } from "@/lib/budget";

export const TOOL_DEFS = [
  {
    name: "search_flights",
    description:
      "Search flights. Returns priced offers with duration, stops, baggage and a value score. " +
      "Use once dates, origin and party are known.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        origin: { type: "string" }, destination: { type: "string" },
        departDate: { type: "string" }, returnDate: { type: "string" },
        adults: { type: "integer" }, childAges: { type: "array", items: { type: "integer" } },
      },
      required: ["origin", "destination", "departDate", "returnDate", "adults", "childAges"],
      additionalProperties: false,
    },
  },
  // ... search_hotels, search_places, get_weather, check_compliance,
  //     build_itinerary, compute_budget -- same shape
] satisfies Anthropic.Tool[];

export const HANDLERS: Record<string, (input: any) => Promise<unknown>> = {
  search_flights:   searchFlights,
  search_hotels:    searchHotels,
  search_places:    searchPlaces,
  get_weather:      getWeather,
  check_compliance: checkCompliance,
  build_itinerary:  buildItinerary,   // deterministic
  compute_budget:   computeBudget,    // deterministic
};

/** Labels for the UI's tool chips. Legibility is a feature. */
export const TOOL_LABELS: Record<string, string> = {
  search_flights:   "Searching 42 airlines",
  search_hotels:    "Finding stays",
  search_places:    "Pulling opening hours and ticket rules",
  get_weather:      "Checking the forecast",
  check_compliance: "Checking entry requirements",
  build_itinerary:  "Routing your days",
  compute_budget:   "Working out the budget",
};
```

Every handler returns `{ data, provenance: { tool, fetchedAt } }`. The orchestrator drops any model claim with no matching provenance — that is how NFR-14 is actually enforced rather than merely hoped for.

### 7.7 The orchestrator — `lib/ai/orchestrator.ts`

A manual streaming loop, not the SDK tool runner, because we need to emit SSE events for the tool chips as the calls happen.

```ts
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODELS, costUsd } from "./client";
import { SYSTEM_PROMPT } from "./prompt";
import { TOOL_DEFS, HANDLERS, TOOL_LABELS } from "./tools";

const MAX_ITERATIONS = 6;   // hard cap -- PRD NFR-AI6

export async function* runTurn(opts: {
  tripState: unknown;
  history: Anthropic.MessageParam[];
  userMessage: string;
}) {
  const messages: Anthropic.MessageParam[] = [
    ...opts.history,
    { role: "user", content: opts.userMessage },
  ];
  let totalCost = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const stream = anthropic.messages.stream({
      model: MODELS.planner,
      max_tokens: 64000,                       // streaming, so give it room
      output_config: { effort: "medium" },     // Opus 5.5 defaults to medium; set it explicitly
      system: [
        // Stable prefix first so it caches; volatile trip state after it.
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        { type: "text", text: `## Current trip state\n${JSON.stringify(opts.tripState)}` },
      ],
      tools: TOOL_DEFS,
      messages,
    });

    stream.on("text", (delta) => void delta);  // forwarded below via the queue

    const message = await stream.finalMessage();
    totalCost += costUsd(MODELS.planner, message.usage);

    for (const block of message.content) {
      if (block.type === "text") yield { type: "token", text: block.text };
    }

    if (message.stop_reason === "end_turn") break;
    if (message.stop_reason === "refusal") { yield { type: "error", code: "AI_REFUSED" }; break; }
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    if (message.stop_reason === "max_tokens") { yield { type: "error", code: "TRUNCATED" }; break; }

    const calls = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (calls.length === 0) break;

    messages.push({ role: "assistant", content: message.content });

    // Run them in parallel -- the whole point of the five-provider fan-out.
    const results = await Promise.all(
      calls.map(async (call) => {
        yield_(call);   // see note below
        const started = Date.now();
        try {
          const out = await HANDLERS[call.name](call.input);
          return {
            block: { type: "tool_result" as const, tool_use_id: call.id, content: JSON.stringify(out) },
            event: { type: "tool_end", tool: call.name, ms: Date.now() - started },
          };
        } catch (err) {
          return {
            block: {
              type: "tool_result" as const, tool_use_id: call.id, is_error: true,
              content: `Provider unavailable: ${(err as Error).message}`,
            },
            event: { type: "tool_end", tool: call.name, ms: Date.now() - started, warn: true },
          };
        }
      })
    );

    // All tool_results go back in ONE user message. Splitting them teaches the
    // model to stop calling tools in parallel.
    messages.push({ role: "user", content: results.map((r) => r.block) });
    for (const r of results) yield r.event;
  }

  yield { type: "done", costUsd: totalCost };
}
```

Three things in there are not stylistic:

- **`tool_choice` is left at its default `auto`.** Forcing a call (`{type:"any"}`) returns a 400 on `claude-opus-5-5`. Steer from the prompt and keep argument validity with `strict: true` on each tool.
- **All `tool_result` blocks go back in a single user message.** Splitting them across messages silently trains the model out of parallel calls, and the fan-out is what makes generation feel fast.
- **A failed tool returns `is_error: true`, never nothing.** That's what lets one dead provider degrade a single panel instead of the whole plan.

*(The `yield_(call)` line is shorthand — in the real file, collect `tool_start` events into a queue the SSE route drains, since you cannot `yield` from inside a `.map()` callback.)*

### 7.8 SSE route — `app/api/trips/[id]/chat/route.ts`

```ts
import { requireUser } from "@/lib/auth";
import { ownedTrip, q } from "@/lib/db";
import { runTurn } from "@/lib/ai/orchestrator";

export const runtime = "nodejs";          // pg and bcrypt need Node, not edge
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const trip = await ownedTrip(id, user.sub);
  const { message, inputMode } = await req.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      try {
        const history = await loadHistory(trip.id);
        for await (const ev of runTurn({ tripState: trip, history, userMessage: message })) {
          send(ev.type, ev);
        }
      } catch (err) {
        send("error", { code: "AI_UNAVAILABLE", message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",      // stops proxies buffering the stream
    },
  });
}
```

### 7.9 Itinerary engine — `lib/itinerary/build.ts`

**No LLM in this file.** Routing and time arithmetic are the two places a probabilistic answer is never acceptable.

```ts
const WALK_CAP_KM = { default: 8, withYoungChild: 5 };
const MAX_ANCHORS = { relaxed: 2, balanced: 3, packed: 4 };

export async function buildItinerary(input: BuildInput): Promise<ItineraryItem[]> {
  const youngest = Math.min(...(input.childAges.length ? input.childAges : [99]));
  const walkCap = youngest < 10 ? WALK_CAP_KM.withYoungChild : WALK_CAP_KM.default;
  const perDay = MAX_ANCHORS[input.pace];

  const clusters = kMeansByGeo(input.places, input.durationDays);   // cluster.ts
  const days: ItineraryItem[] = [];

  for (let d = 1; d <= input.durationDays; d++) {
    const date = addDays(input.startDate, d - 1);
    let chosen = clusters[d - 1]
      .filter((p) => isOpenOn(p, date))                    // FR-8.4: zero closed venues
      .filter((p) => suitsAges(p, input.childAges))        // FR-7.2
      .slice(0, perDay);

    chosen = twoOpt(nearestNeighbour(chosen));             // FR-8.3
    while (walkingKm(chosen) > walkCap && chosen.length > 1) chosen.pop();  // FR-8.6

    days.push(...fitToClock(chosen, date, d, input));      // meals, travel legs, arrival/departure
  }
  return days;
}
```

Unit-test this directly — it is pure, so it needs no API key, and it is where the "plans that are actually possible" claim is either true or false.

### 7.10 Compliance — `lib/compliance.ts`

A thin wrapper over the SQL function. The model never decides a visa outcome.

```ts
import { q } from "./db";

export async function checkCompliance(input: {
  tripId: string; destination: string; departDate: string; returnDate: string;
}) {
  const travellers = await q<any>(
    `select tr.id, tr.name, tr.nationality, tr.passport_expiry,
            traveller_age_band(tr.birth_date, $2::date) as age_band
       from travellers tr
       join trip_travellers tt on tt.traveller_id = tr.id
      where tt.trip_id = $1`,
    [input.tripId, input.departDate]
  );

  const out = [];
  for (const t of travellers) {
    const rows = await q<any>(
      `select * from resolve_compliance($1, $2, $3::date, $4::date, $5::date)`,
      [t.nationality, input.destination, t.passport_expiry, input.departDate, input.returnDate]
    );
    for (const r of rows) {
      await q(
        `insert into compliance_checks
           (trip_id, traveller_id, document_type, status, severity, outcome,
            requirement, shortfall_days, source_url, verified_on)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (trip_id, traveller_id, document_type) do update
           set status = excluded.status, severity = excluded.severity,
               requirement = excluded.requirement, shortfall_days = excluded.shortfall_days,
               source_url = excluded.source_url, verified_on = excluded.verified_on`,
        [input.tripId, t.id, r.document_type, r.status, r.severity, r.outcome,
         r.requirement, r.shortfall_days, r.source_url, r.verified_on]
      );
    }
    out.push({ traveller: t, documents: rows });
  }

  // If any document is blocking, the trip itself is blocked. Not a soft warning.
  const blocking = out.some((t) => t.documents.some((d: any) => d.severity === "blocking"));
  if (blocking) await q(`update trips set state = 'blocked' where id = $1`, [input.tripId]);

  return {
    travellers: out,
    disclaimer: "Guidance only — confirm with the official source.",
    provenance: { tool: "check_compliance", fetchedAt: new Date().toISOString() },
  };
}
```

### 7.11 The system prompt — `lib/ai/prompt.ts`

Paste [`PRD.md` §13A.5](PRD.md) verbatim as `SYSTEM_PROMPT`. Keep it in its own file and **never interpolate anything into it** — trip state goes in a second system block so the prompt stays a byte-identical cacheable prefix. A `Date.now()` or a trip id in this string silently kills your cache hit rate and roughly doubles your input cost.

---

## 8. Seed data

Three files under `data/seed/`. Realism matters more than volume — fake-looking data destroys the credibility the UI just bought you.

| File | Rows | Must include |
|---|---|---|
| `flights.json` | ~40 | Real carriers (BA, QR, AI, EK), plausible fares, honest durations, one direct and one long-layover option per route so the value score has something to say |
| `hotels.json` | ~60 | Real property names per city, three tiers, occupancy limits, ratings with review counts, lat/lng so distance scoring works |
| `places.json` | ~120 | Real attractions with true opening hours, typical duration, age bands, ticket-required flags, coordinates |

Cover four destinations well (London, Dubai, Singapore, Bangkok) rather than twenty badly — those pair with the seeded visa rules to exercise every compliance outcome.

Label it honestly in the UI: a small "sample data" chip on the flights and stays tabs. Users forgive seeded data; they don't forgive being misled.

---

## 9. Verification

### Functional

```powershell
npm run build          # must pass with zero type errors
npm run lint
npx playwright test    # the one e2e path below
```

The single e2e test worth writing today: landing → signup → send the brief's sentence → plan renders → documents tab shows a blocking issue → PDF export produces a file.

### The chatbot gate

Run all fourteen tests in [`PRD.md` §13A.8](PRD.md) by hand against the running app. **14/14 or the chatbot doesn't ship.** The four that fail most often:

- **CB-1** — asks for headcount after "me, my wife and two kids"
- **CB-3** — a constraint stated at turn 4 is forgotten by turn 9 *(cause: you're sending the transcript instead of the trip state object)*
- **CB-4** — "make it cheaper" discards a locked item *(cause: regenerating instead of patching)*
- **CB-9** — silently exceeds the budget cap instead of naming the cause

### Done

1. Landing → signup → one sentence → full plan → PDF in under three minutes on a phone
2. All six workspace tabs real, no placeholder panels
3. Lighthouse ≥90 performance, ≥95 accessibility on dashboard and workspace
4. Zero console errors, zero layout shift
5. Blocking-passport and visa-required cases both render with source and verified date
6. Dark and light both pass 4.5:1 on body text

---

## 10. Run book

```powershell
# once
psql -U postgres -c "CREATE DATABASE journeyos;"
psql -U postgres -d journeyos -f "..\schema.sql"

# daily
cd "C:\Users\Udayshankar\Downloads\Mini project\journeyos"
npm run dev            # http://localhost:3000

# reset the database when the schema changes
psql -U postgres -d journeyos -f "..\schema.sql"
```

**Log in as:** `admin@journeyos.local` / `Admin@12345` → `/admin` is reachable only by this account.

**Change that password before anyone else can reach the app:**

```powershell
psql -U postgres -d journeyos -c "update users set password_hash = crypt('YOUR-NEW-PASSWORD', gen_salt('bf',10)) where email='admin@journeyos.local';"
```

---

## 11. Gotchas that will cost you an hour each

| Symptom | Cause | Fix |
|---|---|---|
| `password authentication failed for user "postgres"` | `pg_hba.conf` not saved, or service not restarted | Edit as Administrator, then `Restart-Service postgresql-x64-17` |
| `client password must be a string` | `PGPASSWORD=` read as `""` | Omit the `password` key from the `Pool` config entirely |
| `Module not found: crypto` in middleware | Node API in the edge runtime | Keep `jose` in middleware; keep `bcryptjs`/`pg` in route handlers with `runtime = "nodejs"` |
| SSE arrives all at once at the end | A proxy is buffering | `X-Accel-Buffering: no` and `Cache-Control: no-transform` |
| 400 `tool_choice type "any" is not supported` | Forcing a tool call on `claude-opus-5-5` | Leave `tool_choice` at `auto`; add `strict: true` and name the tool in the prompt |
| 400 on `thinking` | Sending `budget_tokens` or `{type:"disabled"}` | Omit `thinking` entirely; control depth with `output_config.effort` |
| `cache_read_input_tokens` always 0 | Something volatile inside the cached system block | Trip state belongs in a *second* system block, after the `cache_control` breakpoint |
| Model stops calling tools in parallel | `tool_result` blocks split across several user messages | Return them all in one user message |
| Itinerary schedules a closed museum | `isOpenOn` not applied before clustering | Filter, then cluster, then route |
| Plan loses a locked activity on re-plan | Regenerating instead of applying a `TripPatch` | `preserveLocked` defaults to true and must be honoured |

---

## 12. What to do after the day is done

In order, highest value first:

1. **Swap seeded flights and hotels for live APIs** behind the existing provider interface — nothing above it changes.
2. **Wire the fourteen chatbot tests into CI** as an eval suite, so prompt edits can't regress silently.
3. **Add the remaining visa rules** — 10 nationalities × 15 destinations ≈ 150 rows gets you real coverage.
4. **Rate-limit `/api/trips/[id]/chat`** — 20 requests per minute per user. One scripted loop can spend your whole model budget.
5. **Then** booking, payments and collaboration — Phase 2 in [`PRD.md` §22](PRD.md).
