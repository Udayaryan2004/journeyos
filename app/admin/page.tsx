"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { TopBar, Tag, Skeletons, ErrorNote, shortDate } from "@/components/ui";

/* ------------------------------------------------------------------- types */

interface Metrics {
  admin: string;
  aiProvider: { configured: boolean; planner: string; extractor: string; mode: string };
  totals: { users: number; trips: number; plansCompleted: number; messages: number };
  tripsByStatus: { status: string; count: number }[];
  ai: { model: string; calls: number; tokensIn: number; tokensOut: number; costUsd: number }[];
  spend: { todayUsd: number; dailyCapUsd: number; pctOfCap: number };
  compliance: { severity: string; count: number }[];
  recentTrips: { id: string; title: string; status: string; email: string; updatedAt: string }[];
}

/* ------------------------------------------------------------------ styles */

const LABEL: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".07em",
  textTransform: "uppercase",
  color: "var(--text-3)",
};

const BIG: CSSProperties = {
  fontSize: 26,
  fontWeight: 680,
  letterSpacing: "-0.025em",
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1.15,
};

const TH: CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".07em",
  textTransform: "uppercase",
  color: "var(--text-3)",
  padding: "0 12px 9px 0",
  whiteSpace: "nowrap",
};

const TH_NUM: CSSProperties = { ...TH, textAlign: "right", padding: "0 0 9px 12px" };

const TD: CSSProperties = {
  padding: "10px 12px 10px 0",
  borderTop: "1px solid var(--border)",
  verticalAlign: "middle",
};

const TD_NUM: CSSProperties = {
  ...TD,
  textAlign: "right",
  padding: "10px 0 10px 12px",
  fontVariantNumeric: "tabular-nums",
  color: "var(--text-2)",
};

/* ------------------------------------------------------------------ format */

const num = (n: number) => n.toLocaleString("en-IN");
const usd4 = (n: number) => `$${n.toFixed(4)}`;

/** Green while there is room, amber as it tightens, red once it is nearly gone. */
const capColour = (pct: number) => (pct < 60 ? "var(--good)" : pct <= 85 ? "var(--warn)" : "var(--crit)");

/** Matches the dashboard: only live or imminent trips get a coloured tag. */
const statusKind = (s: string): "good" | undefined =>
  s === "upcoming" || s === "active" ? "good" : undefined;

/* ------------------------------------------------------------------- pieces */

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {hint && (
          <span className="text-[12.5px]" style={{ color: "var(--text-3)" }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-3.5 sm:p-4">
      <div style={LABEL}>{label}</div>
      <div className="mt-1.5" style={BIG}>
        {num(value)}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- page */

export default function AdminPage() {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await fetch("/api/admin/metrics", { cache: "no-store" });
        const json: unknown = await res.json().catch(() => null);
        if (!alive) return;

        if (res.status === 401 || res.status === 403) {
          setError("This dashboard is for administrators. Sign in with an admin account to see it.");
          return;
        }
        if (!res.ok) {
          const message =
            (json as { error?: { message?: string } } | null)?.error?.message ??
            "Operations data could not be loaded.";
          setError(message);
          return;
        }
        setData(json as Metrics);
      } catch {
        if (alive) setError("Could not reach the server. Check the connection and reload.");
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const maxStatus = data ? Math.max(1, ...data.tripsByStatus.map((s) => s.count)) : 1;
  const complianceCount = (severity: string) =>
    data?.compliance.find((c) => c.severity === severity)?.count ?? 0;

  return (
    <div className="min-h-screen">
      <TopBar
        right={
          <Link href="/dashboard" className="btn btn-sm btn-ghost">
            Back to app
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6">
        <header className="mb-5">
          <h1 className="text-[25px] font-semibold tracking-tight sm:text-[28px]">Operations</h1>
          <p className="mt-1 text-[13.5px]" style={{ color: "var(--text-2)" }}>
            {data ? `Signed in as ${data.admin}` : "Live counts, model spend and the health of the plan pipeline."}
          </p>
        </header>

        {error && <ErrorNote>{error}</ErrorNote>}

        {!error && !data && <Skeletons n={4} height={90} />}

        {!error && data && (
          <div className="fade-up">
            {/* ------------------------------------------------- AI provider */}
            <section
              className="glass p-4 sm:px-5"
              style={{ borderLeft: `3px solid ${data.aiProvider.configured ? "var(--good)" : "var(--warn)"}` }}
              role="status"
            >
              <div className="flex flex-wrap items-center gap-2.5">
                <span style={LABEL}>AI provider</span>
                <Tag kind={data.aiProvider.configured ? "good" : "warn"}>
                  {data.aiProvider.configured ? "Live model" : "Fallback planner"}
                </Tag>
              </div>
              <p className="mt-2 text-[13.5px] leading-relaxed" style={{ color: "var(--text-2)" }}>
                {data.aiProvider.configured ? (
                  <>
                    Live — planner {data.aiProvider.planner}, extractor {data.aiProvider.extractor}.
                  </>
                ) : (
                  <>
                    Running on the deterministic fallback planner — no OPENAI_API_KEY is set. The product works end to
                    end; set a key in .env.local to switch to the live model.
                  </>
                )}
              </p>
            </section>

            {/* --------------------------------------------------- KPI tiles */}
            <div className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <Kpi label="Users" value={data.totals.users} />
              <Kpi label="Trips" value={data.totals.trips} />
              <Kpi label="Plans completed" value={data.totals.plansCompleted} />
              <Kpi label="Messages" value={data.totals.messages} />
            </div>

            {/* ---------------------------------------------------- AI spend */}
            <Section title="AI spend">
              <div className="card p-4 sm:p-5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span style={BIG}>{usd4(data.spend.todayUsd)}</span>
                  <span className="text-[13px]" style={{ color: "var(--text-2)" }}>
                    of ${data.spend.dailyCapUsd} daily cap
                  </span>
                  <span
                    className="ml-auto text-[13px]"
                    style={{ color: capColour(data.spend.pctOfCap), fontVariantNumeric: "tabular-nums" }}
                  >
                    {data.spend.pctOfCap}%
                  </span>
                </div>

                <div
                  className="mt-3"
                  style={{ height: 8, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}
                  role="meter"
                  aria-label="Share of the daily AI spend cap used"
                  aria-valuenow={data.spend.pctOfCap}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, Math.max(0, data.spend.pctOfCap))}%`,
                      borderRadius: 999,
                      background: capColour(data.spend.pctOfCap),
                      transition: "width .45s cubic-bezier(.2,.7,.3,1)",
                    }}
                  />
                </div>

                <p className="mt-2.5 text-[12.5px]" style={{ color: "var(--text-3)" }}>
                  Alert fires at 80% of cap.
                </p>
              </div>
            </Section>

            {/* ----------------------------------------------- model usage */}
            <Section title="Model usage">
              <div className="card px-4 py-3.5 sm:px-5">
                {data.ai.length === 0 ? (
                  <p className="py-2 text-[13.5px]" style={{ color: "var(--text-3)" }}>
                    No assistant turns recorded yet.
                  </p>
                ) : (
                  <div className="-mx-1 overflow-x-auto px-1">
                    <table style={{ width: "100%", minWidth: 480, borderCollapse: "collapse", fontSize: 13.5 }}>
                      <thead>
                        <tr>
                          <th style={TH}>Model</th>
                          <th style={TH_NUM}>Calls</th>
                          <th style={TH_NUM}>Tokens in</th>
                          <th style={TH_NUM}>Tokens out</th>
                          <th style={TH_NUM}>Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.ai.map((r) => (
                          <tr key={r.model}>
                            <td style={{ ...TD, fontWeight: 540 }}>{r.model}</td>
                            <td style={TD_NUM}>{num(r.calls)}</td>
                            <td style={TD_NUM}>{num(r.tokensIn)}</td>
                            <td style={TD_NUM}>{num(r.tokensOut)}</td>
                            <td style={{ ...TD_NUM, color: "var(--text-1)" }}>{usd4(r.costUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Section>

            {/* ------------------------------------------- trips by status */}
            <div className="mt-6 grid gap-2.5 lg:grid-cols-2">
              <section>
                <h2 className="mb-2.5 text-[15px] font-semibold tracking-tight">Trips by status</h2>
                <div className="card p-4 sm:p-5">
                  {data.tripsByStatus.length === 0 ? (
                    <p className="text-[13.5px]" style={{ color: "var(--text-3)" }}>
                      No trips yet.
                    </p>
                  ) : (
                    <ul className="grid gap-2.5">
                      {data.tripsByStatus.map((s) => (
                        <li key={s.status} className="flex items-center gap-3">
                          <span
                            className="shrink-0 truncate text-[12.5px] capitalize"
                            style={{ width: 82, color: "var(--text-2)" }}
                          >
                            {s.status}
                          </span>
                          <span
                            className="min-w-0 flex-1"
                            style={{ height: 8, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}
                          >
                            <span
                              className="block"
                              style={{
                                height: "100%",
                                width: `${Math.max(3, (s.count / maxStatus) * 100)}%`,
                                borderRadius: 999,
                                background: "linear-gradient(104deg, var(--accent-from), var(--accent-to))",
                              }}
                            />
                          </span>
                          <span
                            className="shrink-0 text-right text-[13px]"
                            style={{ width: 34, fontVariantNumeric: "tabular-nums" }}
                          >
                            {num(s.count)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              {/* --------------------------------------------- compliance */}
              <section>
                <h2 className="mb-2.5 text-[15px] font-semibold tracking-tight">Compliance</h2>
                <div className="card p-4 sm:p-5">
                  <div className="flex flex-wrap gap-2">
                    <Tag kind="crit">Blocking {num(complianceCount("blocking"))}</Tag>
                    <Tag kind="warn">Warning {num(complianceCount("warning"))}</Tag>
                    <Tag kind="good">Info {num(complianceCount("info"))}</Tag>
                  </div>
                  <p className="mt-3 text-[12.5px]" style={{ color: "var(--text-3)" }}>
                    Checks recorded across every trip. Blocking items stop a plan from being packaged.
                  </p>
                </div>
              </section>
            </div>

            {/* --------------------------------------------- recent trips */}
            <Section title="Recent trips" hint="Ten most recently touched">
              <div className="card px-4 py-3.5 sm:px-5">
                {data.recentTrips.length === 0 ? (
                  <p className="py-2 text-[13.5px]" style={{ color: "var(--text-3)" }}>
                    Nothing has been planned yet.
                  </p>
                ) : (
                  <div className="-mx-1 overflow-x-auto px-1">
                    <table style={{ width: "100%", minWidth: 480, borderCollapse: "collapse", fontSize: 13.5 }}>
                      <thead>
                        <tr>
                          <th style={TH}>Title</th>
                          <th style={TH}>User</th>
                          <th style={TH}>Status</th>
                          <th style={TH_NUM}>Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentTrips.map((t) => (
                          <tr key={t.id}>
                            <td style={{ ...TD, fontWeight: 540 }}>
                              <Link href={`/trips/${t.id}`} className="hover:underline">
                                {t.title}
                              </Link>
                            </td>
                            <td style={{ ...TD, color: "var(--text-2)" }}>
                              <span className="block max-w-[180px] truncate">{t.email}</span>
                            </td>
                            <td style={TD}>
                              <Tag kind={statusKind(t.status)}>{t.status}</Tag>
                            </td>
                            <td style={TD_NUM}>{shortDate(t.updatedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Section>
          </div>
        )}
      </main>
    </div>
  );
}
