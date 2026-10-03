# JourneyOS — API Reference

Companion to [`PRD.md`](PRD.md) §15. Base path `/api/v1`. JSON only, bearer JWT, SSE for chat.

**Conventions**

| Concern | Rule |
|---|---|
| Auth | `Authorization: Bearer <access_jwt>` on everything except `/auth/*`, `/share/:token`, `/health` |
| Errors | `{ "error": { "code": "...", "message": "...", "requestId": "..." } }` with the correct HTTP status |
| Idempotency | `Idempotency-Key: <uuid>` on every POST and PATCH. 24-hour replay window |
| Pagination | `?limit=20&cursor=<opaque>` → `{ "data": [...], "nextCursor": "..." }` |
| Rate limits | 60 req/min/user; 20 req/min on `/chat`. `429` with `Retry-After` |
| Timestamps | ISO 8601 UTC, e.g. `2027-04-11T08:30:00Z` |
| Money | Minor-unit-safe decimal strings plus an explicit `currency` |

**Error codes**

`VALIDATION_FAILED` `UNAUTHENTICATED` `FORBIDDEN` `TRIP_NOT_FOUND` `TRAVELLER_NOT_FOUND` `RATE_LIMITED` `PROVIDER_UNAVAILABLE` `AI_UNAVAILABLE` `BUDGET_IMPOSSIBLE` `COMPLIANCE_RULE_MISSING` `IDEMPOTENCY_CONFLICT` `SHARE_REVOKED`

---

## Authentication

### `POST /auth/signup`

```json
{ "email": "priya@example.com", "password": "correct-horse-battery", "fullName": "Priya Raman" }
```

`201` → `{ "user": { "id": "...", "email": "...", "emailVerified": false }, "accessToken": "...", "refreshToken": "...", "expiresIn": 900 }`

A duplicate email returns the same `201`-shaped success envelope with `"verificationSent": true` and no tokens — never confirm whether an address is registered.

### `POST /auth/login`

```json
{ "email": "priya@example.com", "password": "..." }
```

`200` → tokens as above. `401 UNAUTHENTICATED` for both wrong password and unknown email. After 5 failures in 15 minutes: `429` with `Retry-After`.

### `GET /auth/google` → `GET /auth/google/callback`

Standard OIDC. Links to an existing account when the verified email matches; never creates a duplicate.

### `POST /auth/forgot` · `POST /auth/reset`

```json
{ "email": "priya@example.com" }
{ "token": "...", "password": "new-password-here" }
```

Both return `200` with an identical message regardless of whether the account exists. Reset revokes every refresh token for that user.

### `POST /auth/refresh` · `POST /auth/logout`

Refresh rotates the token. Reuse of a consumed refresh token revokes the whole family and returns `401`. `POST /auth/logout?all=true` revokes every device.

---

## Profile and travellers

### `GET /me` · `PATCH /me`

```json
{ "fullName": "Priya Raman", "homeCity": "Bengaluru", "homeIata": "BLR",
  "nationality": "IN", "travelStyle": "balanced", "currency": "INR",
  "theme": "dark", "locale": "en-IN" }
```

### `GET /travellers` · `POST /travellers`

```json
{ "name": "Vihaan Raman", "birthDate": "2021-02-14", "nationality": "IN",
  "passportStatus": "none" }
```

`201` → the traveller with a derived `ageBand`. Passport **numbers are never accepted** by this API in MVP; `passportStatus` and `passportExpiry` are sufficient to resolve compliance.

### `PATCH /travellers/:id` · `DELETE /travellers/:id`

---

## Trips

### `GET /trips`

`?status=draft|planned|upcoming|active|completed|archived&limit=20&cursor=`

```json
{ "data": [ { "id": "...", "title": "London · 11–18 April", "status": "planned",
              "state": "ready", "destination": { "city": "London", "country": "GB" },
              "dates": { "start": "2027-04-11", "end": "2027-04-18", "durationDays": 7 },
              "party": { "adults": 2, "children": [6, 11] },
              "completeness": 0.62, "alerts": { "blocking": 2 },
              "updatedAt": "2026-10-03T18:21:00Z" } ],
  "nextCursor": null }
```

### `POST /trips`

Everything is optional — a trip can be created from nothing and filled by conversation.

```json
{ "title": "London with the family", "destinationCity": "London", "durationDays": 7,
  "partyAdults": 2, "partyChildren": [6, 11], "travellerIds": ["...", "..."] }
```

`201` → the full `Trip` object plus `conversationId`.

### `GET /trips/:id`

Returns the trip, its itinerary grouped by day, selected options, compliance summary, budget and `assumptions`. This is the single read the workspace needs on load.

```json
{ "trip": { "...": "..." },
  "itinerary": [ { "dayNumber": 1, "date": "2027-04-11", "weather": { "tempC": 12, "summary": "light rain" },
                   "walkingKm": 2.1, "dayCost": "4200",
                   "items": [ { "id": "...", "slot": "afternoon", "type": "flight",
                                "title": "Land at Heathrow T5", "startTime": "14:05",
                                "durationMin": 40, "locked": false,
                                "source": { "tool": "search_flights", "fetchedAt": "..." } } ] } ],
  "selections": { "flight": { "...": "..." }, "hotel": { "...": "..." } },
  "compliance": { "blocking": 2, "required": 4, "satisfied": 2 },
  "budget": { "total": "459600", "cap": "420000", "overBy": "39600", "causedBy": "visas" },
  "assumptions": ["Departing from Bengaluru (from your profile)",
                  "Mid-range budget of ₹4,20,000 (from your travel style)"] }
```

### `PATCH /trips/:id` · `DELETE /trips/:id`

`DELETE` archives rather than destroys. Hard deletion happens through account deletion.

---

## Chat — the core endpoint

### `POST /trips/:id/chat`

```http
POST /api/v1/trips/8f3a.../chat
Authorization: Bearer <jwt>
Idempotency-Key: 4c1e-...
Accept: text/event-stream
Content-Type: application/json

{ "message": "Plan a 7-day London vacation for me, my wife and two kids",
  "inputMode": "text" }
```

Responds `200` with `Content-Type: text/event-stream`. Events arrive in this order; `token` and `patch` interleave.

| Event | Payload | Meaning |
|---|---|---|
| `state` | `{"state":"gathering"}` | Trip state changed — drives the UI header |
| `tool_start` | `{"tool":"search_flights","label":"Searching 42 airlines"}` | Render a tool chip |
| `tool_end` | `{"tool":"search_flights","count":7,"ms":2140,"warn":false}` | Resolve the chip |
| `token` | `{"text":"Seven days in London with a 6- and an 11-year-old — "}` | Append to the streaming bubble |
| `patch` | `{"op":"add","path":"/itinerary/day/1","value":{...}}` | Apply to the artifact pane |
| `question` | `{"slots":["dates","childAges"],"chips":["Next month","April","Summer holidays"]}` | Render quick replies |
| `done` | `{"state":"ready","tokensIn":4820,"tokensOut":1130,"costUsd":0.062,"messageId":"..."}` | Turn complete |
| `error` | `{"code":"PROVIDER_UNAVAILABLE","tool":"search_hotels","recoverable":true}` | Panel-level failure; the rest of the plan stands |

**Cancellation.** Close the stream, or `POST /trips/:id/chat/abort`. Partial output is discarded from history.

**Reconnection.** Re-open with `?resumeFrom=<messageId>` to continue an interrupted stream.

### `GET /trips/:id/messages`

`?limit=50&cursor=` — newest last. Tool calls are included for the admin inspector, stripped for normal users.

### `POST /trips/:id/generate`

Forces a full re-plan. `{ "reason": "dates changed", "preserveLocked": true }`. Returns the same SSE stream. `preserveLocked` defaults to `true` and must never be ignored.

---

## Discovery

### `GET /trips/:id/flights`

`?refresh=true` forces a re-fetch past the 30-minute cache.

```json
{ "data": [ { "id": "...", "kind": "flight", "provider": "amadeus",
              "price": { "amount": "224000", "currency": "INR", "perPerson": false },
              "slices": [ { "origin": "BLR", "destination": "LHR",
                            "departAt": "2027-04-11T01:45:00Z", "arriveAt": "2027-04-11T07:20:00Z",
                            "durationMin": 635, "stops": 0, "carrier": "BA",
                            "flightNumbers": ["BA118"] } ],
              "baggage": { "cabin": 1, "checked": 2 },
              "valueScore": 86.4,
              "reason": "Not the cheapest, but the cheap option has a 9-hour Doha layover.",
              "fetchedAt": "2026-10-03T18:19:00Z", "expiresAt": "2026-10-03T18:49:00Z",
              "deepLink": "https://..." } ],
  "stale": false }
```

### `GET /trips/:id/hotels`

`?tier=budget|mid|luxury` — tier boundaries are derived per city from the live price distribution, not from global thresholds.

### `GET /trips/:id/events`

`?categories=concert,festival,sport,local` — only events inside the trip window are ever returned.

### `POST /trips/:id/options/:optionId/select`

Selects an option, deselects the previous one of that kind, and re-derives the budget. `200` → `{ "selected": {...}, "budget": {...} }`.

---

## Itinerary

### `GET /trips/:id/itinerary`

Items grouped by day with per-day weather, walking distance and cost.

### `PATCH /trips/:id/itinerary/:itemId`

```json
{ "dayNumber": 5, "slot": "morning", "sortOrder": 0 }
{ "locked": true }
{ "remove": true }
```

`200` → the affected days, re-flowed, with any new conflicts named:

```json
{ "days": [ { "dayNumber": 3, "...": "..." }, { "dayNumber": 5, "...": "..." } ],
  "conflicts": [ { "itemId": "...", "reason": "Closed on Mondays",
                   "suggestion": "Move to Day 6" } ] }
```

Conflicts are reported, never silently resolved.

---

## Compliance

### `GET /trips/:id/compliance`

```json
{ "summary": { "blocking": 2, "required": 4, "satisfied": 2 },
  "travellers": [
    { "travellerId": "...", "name": "Vihaan Raman", "ageBand": "child", "nationality": "IN",
      "documents": [
        { "documentType": "passport", "status": "blocking", "severity": "blocking",
          "requirement": "No passport on file. Apply before anything else — the visa application is tied to the passport number.",
          "details": { "feeBand": "INR 1000", "processingDays": [30, 45] },
          "sourceUrl": "https://www.passportindia.gov.in", "verifiedOn": "2026-09-21",
          "isStale": false },
        { "documentType": "visa", "status": "required", "severity": "warning",
          "outcome": "embassy_required",
          "requirement": "UK Standard Visitor visa. £127, biometrics at a VFS centre, 3 weeks.",
          "sourceUrl": "https://www.gov.uk/standard-visitor", "verifiedOn": "2026-09-28",
          "isStale": false } ] } ],
  "sequence": [ { "step": 1, "task": "Vihaan's first passport", "by": "2026-11-15" },
                { "step": 2, "task": "Maya's passport renewal",  "by": "2026-12-20" },
                { "step": 3, "task": "Four UK visa applications","by": "2027-02-10" } ],
  "disclaimer": "Guidance only — confirm with the official source." }
```

`sourceUrl`, `verifiedOn` and `disclaimer` are **never** optional. A requirement with no verified source is returned as `COMPLIANCE_RULE_MISSING` with a pointer to the official source rather than a guess.

### `POST /trips/:id/compliance/recheck`

Re-resolves against the current rules corpus. Use after a passport renewal or a date change.

---

## Budget and essentials

### `GET /trips/:id/budget`

```json
{ "currency": "INR", "cap": "420000", "total": "459600",
  "categories": { "flights":   { "planned": "224000", "perPerson": "56000" },
                  "lodging":   { "planned": "138000", "perPerson": "34500" },
                  "activities":{ "planned": "34600",  "perPerson": "8650" },
                  "food":      { "planned": "28000",  "perPerson": "7000" },
                  "transport": { "planned": "19400",  "perPerson": "4850" },
                  "other":     { "planned": "53600",  "perPerson": "13400" } },
  "buffer": "42000",
  "variance": { "amount": "39600", "overBy": "39600", "causedBy": "visas",
                "suggestions": [ "Switch to the 1-stop Qatar flight, saving ₹48,000",
                                 "Raise the cap to ₹4,60,000" ] } }
```

When a plan cannot fit the cap, the API returns the plan **and** the variance. It never silently exceeds the cap, and it never returns an empty plan.

### `GET /trips/:id/essentials`

Packing list (grouped by traveller), weather (`isForecast` / `isNormals` flagged), currency (rate plus `asOf`), connectivity options and emergency contacts per nationality.

---

## Export and sharing

### `POST /trips/:id/export/pdf`

`202` → `{ "jobId": "..." }`. Poll `GET /exports/:jobId` → `{ "status": "queued|running|ready|failed", "url": "...", "expiresAt": "..." }`. URLs are signed and expire in 24 hours.

### `POST /trips/:id/share` · `DELETE /trips/:id/share`

```json
{ "expiresIn": 2592000 }
```

`201` → `{ "token": "...", "url": "https://journeyos.app/share/abc123", "expiresAt": "..." }`

### `GET /share/:token`

Public, unauthenticated. Returns the itinerary, flights and stays only. **Excludes** documents, traveller personal data, budget detail and the conversation. A revoked token returns `404 SHARE_REVOKED`.

---

## Admin

All admin endpoints require `role = admin` plus 2FA, and every call is written to `audit_log` with a reason code.

| Method | Path | Returns |
|---|---|---|
| `GET` | `/admin/metrics?from=&to=` | Signups, trips, plans completed, acceptance rate, retention cohorts |
| `GET` | `/admin/providers` | Per provider: volume, p50/p95 latency, error rate, quota headroom, spend today, breaker state |
| `GET` | `/admin/ai` | Tokens and cost by model and prompt version, eval scores, daily spend against cap |
| `GET` | `/admin/users?q=` | User search |
| `GET` | `/admin/users/:id` | Detail with trips and subscription |
| `POST` | `/admin/users/:id/suspend` | `{ "reason": "..." }` — revokes sessions within 5 s |
| `GET` | `/admin/conversations/:tripId?reason=` | Full replay with tool calls and retrieved chunks. `reason` is **required** |
| `POST` | `/admin/flags/:key` | `{ "enabled": false }` — effective within 60 s |

---

## Health

`GET /health` → `{ "status": "ok", "version": "1.0.3" }`
`GET /ready` → `503` until database, cache and the primary model provider all answer.

---

## Internal tool contracts

Not public HTTP endpoints — the registry the orchestrator calls. Listed here because the same Zod schemas validate both layers.

| Tool | Input | Output | LLM involved |
|---|---|---|---|
| `search_flights` | `{origin, destination, departDate, returnDate?, adults, children[], cabin?}` | `FlightOffer[]` | no |
| `search_hotels` | `{city, checkIn, checkOut, adults, children[], tier?, maxPrice?}` | `HotelOffer[]` | no |
| `search_places` | `{city, interests[], ageBands[], limit}` | `Place[]` with hours and duration | no |
| `search_events` | `{city, from, to, categories[]}` | `Event[]` | no |
| `get_weather` | `{city, from, to}` | `{daily[], isForecast, isNormals}` | no |
| `check_compliance` | `{nationalities[], destination, purpose, durationDays, departDate, passports[]}` | `ComplianceResult[]` | no |
| `build_itinerary` | `{trip, places[], anchors[], pace, constraints}` | `ItineraryItem[]` | **no — deterministic** |
| `compute_budget` | `{trip, selections, items}` | `Budget` | **no — deterministic** |
| `convert_currency` | `{from, to, amount}` | `{rate, amount, asOf}` | no |

`build_itinerary` and `compute_budget` contain no model call by design. Routing, time-fitting and arithmetic are the two places where a probabilistic answer is never acceptable.
