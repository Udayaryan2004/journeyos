"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Composer,
  Empty,
  ErrorNote,
  Skeletons,
  Tag,
  TopBar,
  inr,
  shortDate,
} from "@/components/ui";
import type { Trip, TripStatus } from "@/lib/types";

/* ------------------------------------------------------------------- types */

type TripCard = Trip & { blockingCount: number };

/* --------------------------------------------------------------- constants */

/** The landing page parks whatever the visitor typed here before sign-up. */
const PENDING_KEY = "jos-pending-prompt";

const SUGGESTIONS = [
  "Plan a 7-day London vacation for me, my wife and two kids",
  "5 days in Dubai with the kids",
  "A week in Singapore, food and gardens",
  "Long weekend in Bangkok",
  "Do I need a visa for the UK?",
];

/* Four covers, cycled deterministically by trip id so a card never changes
   its look between loads. Literal hex is confined to this artwork -- every
   piece of UI colour comes from a token. */
const COVERS = [
  "linear-gradient(135deg, #8b5cf6 0%, #22d3ee 100%)",
  "linear-gradient(135deg, #f59e0b 0%, #ec4899 100%)",
  "linear-gradient(135deg, #10b981 0%, #22d3ee 100%)",
  "linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)",
];

const PLACES: ReadonlyArray<readonly [string, string]> = [
  ["london", "🇬🇧"],
  ["dubai", "🏜"],
  ["singapore", "🌴"],
  ["bangkok", "🛕"],
  ["paris", "🗼"],
  ["tokyo", "🗾"],
];

/** Only trips that are live or imminent get a coloured tag; the rest stay quiet. */
const STATUS_KIND: Record<TripStatus, "good" | undefined> = {
  draft: undefined,
  planned: undefined,
  upcoming: "good",
  active: "good",
  completed: undefined,
  archived: undefined,
};

/* ----------------------------------------------------------------- helpers */

function coverFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COVERS[hash % COVERS.length];
}

function emojiFor(trip: Trip) {
  const haystack = `${trip.destinationCity ?? ""} ${trip.title}`.toLowerCase();
  for (const [needle, emoji] of PLACES) if (haystack.includes(needle)) return emoji;
  return "✈️";
}

/**
 * An approximation, deliberately: a real readiness score lives on the server.
 * This is a four-field smell test (destination, dates, budget, duration) so the
 * ring gives a feel for how far along a draft is -- 25% a field, nothing more.
 */
function completeness(trip: Trip) {
  const filled = [
    trip.destinationCity,
    trip.startDate && trip.endDate,
    trip.budgetTotal,
    trip.durationDays,
  ].filter(Boolean).length;
  return filled * 25;
}

function dateLine(trip: Trip) {
  if (trip.startDate && trip.endDate) return `${shortDate(trip.startDate)} – ${shortDate(trip.endDate)}`;
  if (trip.startDate) return shortDate(trip.startDate);
  if (trip.durationDays) return `${trip.durationDays} days, dates TBD`;
  return "Dates not set";
}

function travellerLine(trip: Trip) {
  const n = trip.partyAdults + trip.partyChildren.length;
  return `${n} traveller${n === 1 ? "" : "s"}`;
}

function issueLabel(n: number) {
  return `${n} document ${n === 1 ? "issue" : "issues"}`;
}

function statusLabel(status: TripStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/* The greeting belongs to the viewer's clock, which exists only in the browser.
   Subscribing to it as an external store means the server renders a neutral
   line and React swaps in the real one as it hydrates -- correct text, no
   hydration mismatch, no state written from an effect. */
const noopSubscribe = () => () => {};

function greetingFor(hour: number) {
  if (hour < 12) return "Good morning.";
  if (hour < 18) return "Good afternoon.";
  return "Good evening.";
}

const readGreeting = () => greetingFor(new Date().getHours());
const serverGreeting = () => "Welcome back.";

async function messageFrom(res: Response, fallback: string) {
  try {
    const payload = (await res.json()) as { error?: { message?: string } };
    return payload.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

async function fetchTrips(signal?: AbortSignal): Promise<TripCard[]> {
  const res = await fetch("/api/trips", { cache: "no-store", signal });
  if (!res.ok) throw new Error(await messageFrom(res, "Could not load your trips."));
  const payload = (await res.json()) as { data?: TripCard[] };
  return payload.data ?? [];
}

/* ------------------------------------------------------------------- page */

export default function DashboardPage() {
  const router = useRouter();

  const [trips, setTrips] = useState<TripCard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const greeting = useSyncExternalStore(noopSubscribe, readGreeting, serverGreeting);

  /* Pick up the prompt the visitor typed before they had an account. It is a
     one-shot read of a browser-only store, so it can only land in state here. */
  useEffect(() => {
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PENDING_KEY);
      if (pending) sessionStorage.removeItem(PENDING_KEY);
    } catch {
      /* private mode -- nothing to restore */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeding from sessionStorage after mount
    if (pending) setDraft(pending);
  }, []);

  const load = useCallback((signal?: AbortSignal) => {
    fetchTrips(signal).then(
      (data) => {
        setTrips(data);
        setLoadError(null);
      },
      (err: unknown) => {
        if (signal?.aborted) return;
        setLoadError(err instanceof Error ? err.message : "Could not load your trips.");
      },
    );
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  /** Creates an empty trip, then hands the workspace the opening message via ?q=. */
  const startTrip = useCallback(
    async (message?: string) => {
      if (busy) return;
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch("/api/trips", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error(await messageFrom(res, "Could not start a new trip."));
        const payload = (await res.json()) as { trip: Trip };
        const text = message?.trim();
        router.push(
          text
            ? `/trips/${payload.trip.id}?q=${encodeURIComponent(text)}`
            : `/trips/${payload.trip.id}`,
        );
        /* busy stays true -- the route change is the end of this interaction */
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Could not start a new trip.");
        setBusy(false);
      }
    },
    [busy, router],
  );

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* the cookie may already be gone -- leave anyway */
    }
    router.push("/");
    router.refresh();
  }, [router]);

  /* Most recently touched trip with blocking documents. */
  const blocked = useMemo(() => {
    const flagged = (trips ?? []).filter((t) => t.blockingCount > 0);
    flagged.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return flagged[0] ?? null;
  }, [trips]);

  /* The API returns trips newest-first, so the first unfinished one is the
     one they were last working on. */
  const resume = useMemo(
    () => (trips ?? []).find((t) => t.status === "draft" || t.status === "planned") ?? null,
    [trips],
  );

  return (
    <>
      <TopBar
        right={
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void startTrip()}
              disabled={busy}
            >
              New trip
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void logout()}>
              Log out
            </button>
          </div>
        }
      />

      <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-9">
        {blocked && (
          <div
            className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3.5"
            style={{ background: "var(--crit-soft)", borderColor: "rgb(248 113 113 / 0.3)" }}
          >
            <p className="min-w-0 flex-1 text-[13.5px]" style={{ color: "var(--text-1)" }}>
              <span aria-hidden>⚠️</span>{" "}
              <strong style={{ color: "var(--crit)", fontWeight: 650 }}>
                {issueLabel(blocked.blockingCount)}
              </strong>{" "}
              {blocked.blockingCount === 1 ? "needs" : "need"} your attention on {blocked.title}.
            </p>
            <Link href={`/trips/${blocked.id}`} className="btn btn-sm shrink-0">
              Review
            </Link>
          </div>
        )}

        <section className="fade-up">
          <h1 className="text-[clamp(26px,3.6vw,34px)] font-semibold leading-[1.15] tracking-tight">
            {greeting}
          </h1>
          <p className="mt-1 text-[14.5px]" style={{ color: "var(--text-2)" }}>
            Where are we going next?
          </p>
        </section>

        <div className="mt-5 w-full">
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={() => void startTrip(draft)}
            disabled={busy}
            placeholder="Describe the trip — where, when, who is coming…"
          />
        </div>

        <div className="mt-3.5 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="chip"
              disabled={busy}
              onClick={() => {
                setDraft(s);
                void startTrip(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {busy && (
          <p
            className="mt-3.5 flex items-center gap-2 text-[13px]"
            style={{ color: "var(--text-2)" }}
            role="status"
          >
            <span className="spin" aria-hidden />
            Setting up your trip…
          </p>
        )}

        {actionError && (
          <div className="mt-4">
            <ErrorNote>{actionError}</ErrorNote>
          </div>
        )}

        {resume && <ResumeCard trip={resume} onOpen={() => router.push(`/trips/${resume.id}`)} />}

        <section className="mt-8">
          <SectionLabel>Your trips</SectionLabel>

          <div className="mt-3">
            {loadError ? (
              <ErrorNote>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {loadError}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      setTrips(null);
                      setLoadError(null);
                      load();
                    }}
                  >
                    Try again
                  </button>
                </span>
              </ErrorNote>
            ) : trips === null ? (
              <Skeletons n={3} height={180} />
            ) : trips.length === 0 ? (
              <Empty
                icon="🧭"
                title="No trips yet"
                body="Describe a trip above and I'll build the whole thing — itinerary, flights, stays, documents and budget."
              />
            ) : (
              <div className="fade-up grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {trips.map((trip) => (
                  <TripTile key={trip.id} trip={trip} />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}

/* ------------------------------------------------------------------ pieces */

function SectionLabel({ children }: { children: string }) {
  return (
    <h2
      className="text-[12.5px] font-semibold uppercase"
      style={{ letterSpacing: ".07em", color: "var(--text-3)" }}
    >
      {children}
    </h2>
  );
}

function Ring({ pct }: { pct: number }) {
  return (
    <span
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full"
      style={{ background: `conic-gradient(var(--accent-to) 0 ${pct}%, var(--surface-2) ${pct}% 100%)` }}
      aria-hidden
    >
      <span
        className="grid h-[34px] w-[34px] place-items-center rounded-full text-[10.5px] font-bold tabular-nums"
        style={{ background: "var(--bg)", color: "var(--text-2)" }}
      >
        {pct}%
      </span>
    </span>
  );
}

function ResumeCard({ trip, onOpen }: { trip: TripCard; onOpen: () => void }) {
  const pct = completeness(trip);
  const bits = [
    trip.destinationCity ?? "Destination not set",
    trip.durationDays ? `${trip.durationDays} days` : null,
    trip.budgetTotal ? inr(trip.budgetTotal) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="mt-7">
      <SectionLabel>Continue planning</SectionLabel>
      <button
        type="button"
        onClick={onOpen}
        className="card card-hover mt-2.5 flex w-full items-center gap-4 p-4 text-left"
      >
        <Ring pct={pct} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15.5px] font-semibold">{trip.title}</span>
          <span
            className="mt-0.5 block text-[13px] leading-snug line-clamp-2"
            style={{ color: "var(--text-2)" }}
          >
            {pct}% ready · {bits}
          </span>
        </span>
        <Tag kind="ai">Resume</Tag>
      </button>
    </section>
  );
}

function TripTile({ trip }: { trip: TripCard }) {
  /* No aria-label: the title, dates and tags together make the better
     accessible name, and the document warning has to be part of it. */
  return (
    <Link href={`/trips/${trip.id}`} className="card card-hover block overflow-hidden text-left">
      <div className="grid place-items-center" style={{ height: 104, background: coverFor(trip.id) }}>
        <span
          className="text-[38px] leading-none"
          style={{ filter: "drop-shadow(0 4px 12px rgb(0 0 0 / 0.35))" }}
          aria-hidden
        >
          {emojiFor(trip)}
        </span>
      </div>

      <div className="p-3.5">
        <h3 className="truncate text-[15.5px] font-semibold">{trip.title}</h3>
        <p className="mt-0.5 truncate text-[13px]" style={{ color: "var(--text-2)" }}>
          {dateLine(trip)} · {travellerLine(trip)}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Tag kind={STATUS_KIND[trip.status]}>{statusLabel(trip.status)}</Tag>
          {trip.blockingCount > 0 && <Tag kind="crit">{issueLabel(trip.blockingCount)}</Tag>}
        </div>
      </div>
    </Link>
  );
}
