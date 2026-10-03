"use client";

import { use, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { TopBar, Empty, Skeletons, ErrorNote, shortDate, weekday } from "@/components/ui";
import type { ItineraryItem, Trip } from "@/lib/types";

/* ------------------------------------------------------------------- types */

/** Exactly what /api/share/[token] hands out — no budget, no documents, no conversation. */
type ShareTrip = Pick<
  Trip,
  "title" | "destinationCity" | "startDate" | "endDate" | "durationDays" | "partyAdults" | "partyChildren" | "pace"
>;

type ShareItem = Pick<
  ItineraryItem,
  | "id"
  | "dayNumber"
  | "date"
  | "slot"
  | "sortOrder"
  | "type"
  | "title"
  | "description"
  | "placeName"
  | "startTime"
  | "durationMin"
  | "travelMode"
  | "travelMinutes"
>;

interface SharePayload {
  trip: ShareTrip;
  itinerary: ShareItem[];
}

type Phase = "loading" | "ready" | "gone" | "error";

/* ------------------------------------------------------------------ styles */

const LABEL: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".07em",
  textTransform: "uppercase",
  color: "var(--text-3)",
};

const ICON: Record<ShareItem["type"], string> = {
  flight: "✈️",
  checkin: "🏨",
  transport: "🚇",
  meal: "🍽️",
  activity: "📍",
  free: "🌤️",
};

/* ------------------------------------------------------------------ format */

function partySummary(adults: number, children: number[]) {
  const parts = [`${adults} adult${adults === 1 ? "" : "s"}`];
  if (children.length) {
    const kids = children.length === 1 ? "child" : "children";
    const ages = `age${children.length === 1 ? "" : "s"} ${children.join(", ")}`;
    parts.push(`${children.length} ${kids} (${ages})`);
  }
  return parts.join(" · ");
}

function dateRange(start: string | null, end: string | null) {
  if (!start && !end) return "Dates to confirm";
  if (start && end && start !== end) return `${shortDate(start)} – ${shortDate(end)}`;
  return shortDate(start ?? end);
}

const duration = (min: number | null) =>
  min == null ? null : min >= 60 ? `${Math.round((min / 60) * 10) / 10}h` : `${min} min`;

/* -------------------------------------------------------------------- page */

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<SharePayload | null>(null);
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await fetch(`/api/share/${encodeURIComponent(token)}`, { cache: "no-store" });
        const json: unknown = await res.json().catch(() => null);
        if (!alive) return;

        if (res.status === 404) {
          setPhase("gone");
          return;
        }
        if (!res.ok) {
          setMessage(
            (json as { error?: { message?: string } } | null)?.error?.message ??
              "This shared plan could not be loaded.",
          );
          setPhase("error");
          return;
        }
        setData(json as SharePayload);
        setPhase("ready");
      } catch {
        if (!alive) return;
        setMessage("Could not reach the server. Check the connection and reload.");
        setPhase("error");
      }
    })();

    return () => {
      alive = false;
    };
  }, [token]);

  /** Group into days, keeping the server's day/sort ordering. */
  const days = useMemo(() => {
    if (!data) return [];
    const map = new Map<number, ShareItem[]>();
    for (const item of data.itinerary) {
      const bucket = map.get(item.dayNumber);
      if (bucket) bucket.push(item);
      else map.set(item.dayNumber, [item]);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([dayNumber, items]) => ({
        dayNumber,
        date: items.find((i) => i.date)?.date ?? null,
        items: [...items].sort((a, b) => a.sortOrder - b.sortOrder),
      }));
  }, [data]);

  return (
    <div className="min-h-screen">
      <TopBar />

      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-5 sm:px-6">
        {/* ------------------------------------------------- share banner */}
        <div className="glass flex flex-col items-stretch gap-3 p-3.5 sm:flex-row sm:items-center sm:px-4">
          <div className="min-w-0 flex-1">
            <span className="text-[13.5px] font-medium">Shared with you · read-only</span>
            <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--text-3)" }}>
              Nothing here can be edited.
            </p>
          </div>
          <Link href="/signup" className="btn btn-primary w-full shrink-0 sm:w-auto">
            Plan your own trip
          </Link>
        </div>

        {phase === "loading" && (
          <div className="mt-5">
            <Skeletons n={4} height={120} />
          </div>
        )}

        {phase === "gone" && (
          <Empty
            icon="🔗"
            title="This link is no longer active"
            body="The person who shared it has revoked the link."
          >
            <div className="mt-5">
              <Link href="/" className="btn btn-primary">
                Explore JourneyOS
              </Link>
            </div>
          </Empty>
        )}

        {phase === "error" && (
          <div className="mt-5">
            <ErrorNote>{message}</ErrorNote>
          </div>
        )}

        {phase === "ready" && data && (
          <div className="fade-up">
            {/* ------------------------------------------------------ hero */}
            <header className="mt-5 border-b pb-5" style={{ borderColor: "var(--border)" }}>
              {data.trip.destinationCity && <div style={LABEL}>{data.trip.destinationCity}</div>}
              <h1 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-tight sm:text-[32px]">
                {data.trip.title}
              </h1>
              <p className="mt-2 text-[13.5px]" style={{ color: "var(--text-2)" }}>
                {dateRange(data.trip.startDate, data.trip.endDate)}
                {data.trip.durationDays
                  ? ` · ${data.trip.durationDays} day${data.trip.durationDays === 1 ? "" : "s"}`
                  : ""}
              </p>
              <p className="mt-1 text-[13.5px]" style={{ color: "var(--text-2)" }}>
                {partySummary(data.trip.partyAdults, data.trip.partyChildren)}
                {" · "}
                <span className="capitalize">{data.trip.pace}</span> pace
              </p>
            </header>

            {/* ------------------------------------------------ itinerary */}
            {days.length === 0 ? (
              <Empty
                icon="🗓"
                title="Nothing planned yet"
                body="The itinerary for this trip has not been drafted."
              />
            ) : (
              <div className="mt-6 grid gap-7">
                {days.map((day) => (
                  <section key={day.dayNumber}>
                    <div className="mb-3 flex items-center gap-3">
                      <span
                        className="grid shrink-0 place-items-center"
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 11,
                          background: "var(--surface-2)",
                          border: "1px solid var(--border)",
                          fontSize: 12.5,
                          fontWeight: 700,
                          letterSpacing: "-0.01em",
                        }}
                        aria-hidden
                      >
                        D{day.dayNumber}
                      </span>
                      <div className="min-w-0">
                        <h2 className="text-[14.5px] font-semibold tracking-tight">
                          {day.date ? `${weekday(day.date)} ${shortDate(day.date)}` : `Day ${day.dayNumber}`}
                        </h2>
                        <p className="text-[12px]" style={{ color: "var(--text-3)" }}>
                          {day.items.length} {day.items.length === 1 ? "stop" : "stops"}
                        </p>
                      </div>
                    </div>

                    <ul className="grid gap-2">
                      {day.items.map((item) => (
                        <li key={item.id} className="card flex gap-3 p-3.5">
                          <span className="shrink-0 text-[17px] leading-6" aria-hidden>
                            {ICON[item.type]}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                              {item.startTime && (
                                <span
                                  className="text-[12.5px]"
                                  style={{ color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}
                                >
                                  {item.startTime}
                                </span>
                              )}
                              <h3 className="text-[14.5px] font-semibold tracking-tight">{item.title}</h3>
                            </div>

                            {item.description && (
                              <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--text-2)" }}>
                                {item.description}
                              </p>
                            )}

                            {(item.placeName || item.durationMin || item.travelMinutes) && (
                              <p className="mt-1.5 text-[12px]" style={{ color: "var(--text-3)" }}>
                                {[
                                  item.placeName,
                                  duration(item.durationMin),
                                  item.travelMinutes
                                    ? `${item.travelMinutes} min ${item.travelMode ?? "travel"}`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}

            {/* --------------------------------------------------- footer */}
            <footer className="mt-9 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <p className="text-[12.5px]" style={{ color: "var(--text-3)" }}>
                Documents, budget and the conversation are not shared.
              </p>
            </footer>
          </div>
        )}
      </main>
    </div>
  );
}
