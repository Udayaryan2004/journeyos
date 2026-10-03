"use client";

/**
 * The trip workspace — the screen the whole product hangs off.
 *
 * Left: the conversation (SSE streamed, tool chips, quick replies).
 * Right: the living artifact (six tabs) — a pane on desktop, a pull-up sheet on mobile.
 *
 * Everything here is presentational plus fetch calls. No globals.css edits: only the
 * documented design-system classes, Tailwind utilities and inline CSS-variable styles.
 */

import {
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Composer,
  Empty,
  ErrorNote,
  Skeletons,
  Tag,
  ThemeToggle,
  inr,
  shortDate,
  weekday,
} from "@/components/ui";
import type {
  Budget,
  BudgetCategory,
  ChatEvent,
  ComplianceDocument,
  ComplianceResult,
  ComplianceTraveller,
  Essentials,
  EventOffer,
  FlightOffer,
  HotelOffer,
  HotelTier,
  ItineraryItem,
  Trip,
  TripState,
} from "@/lib/types";

/* ========================================================================== */
/* Shapes                                                                     */
/* ========================================================================== */

type FlightRow = FlightOffer & { selected: boolean };
type HotelRow = HotelOffer & { selected: boolean };

interface Payload {
  trip: Trip;
  itinerary: ItineraryItem[];
  flights: FlightRow[];
  hotels: HotelRow[];
  events: EventOffer[];
  compliance: ComplianceResult | null;
  budget: Budget | null;
  essentials: Essentials | null;
}

interface ToolLine {
  tool: string;
  label: string;
  done: boolean;
  warn?: boolean;
  count?: number;
  ms?: number;
}

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: ToolLine[];
  streaming?: boolean;
}

interface Conflict {
  itemId: string;
  reason: string;
}

type TabKey = "itinerary" | "flights" | "stays" | "documents" | "budget" | "essentials";

const TABS: { key: TabKey; label: string }[] = [
  { key: "itinerary", label: "Itinerary" },
  { key: "flights", label: "Flights" },
  { key: "stays", label: "Stays" },
  { key: "documents", label: "Documents" },
  { key: "budget", label: "Budget" },
  { key: "essentials", label: "Essentials" },
];

/* ========================================================================== */
/* Tiny helpers                                                               */
/* ========================================================================== */

let seq = 0;
const uid = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

const errMessage = (e: unknown) =>
  e instanceof Error && e.message ? e.message : "Something went wrong. Try again.";

/* --- two client-only stores, read the way React wants them read ----------- */

const DESKTOP_Q = "(min-width: 1024px)";

const subscribeDesktop = (notify: () => void) => {
  const mq = window.matchMedia(DESKTOP_Q);
  mq.addEventListener("change", notify);
  return () => mq.removeEventListener("change", notify);
};
const desktopNow = () => window.matchMedia(DESKTOP_Q).matches;
const desktopOnServer = () => false;

let cachedInitial: string | null = null;
/** The session cookie is httpOnly, so the avatar letter is best effort. */
function userInitial(): string {
  if (cachedInitial) return cachedInitial;
  let letter = "Y";
  try {
    const first = localStorage.getItem("jos-email")?.trim().slice(0, 1).toUpperCase();
    if (first && /[A-Z0-9]/.test(first)) letter = first;
  } catch {
    /* private mode */
  }
  cachedInitial = letter;
  return letter;
}
const initialOnServer = () => "Y";
const noSubscribe = () => () => {};

/** One fetch wrapper that understands the API's error envelope. */
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* a proxy returned HTML — fall through to the status message */
  }
  if (!res.ok) {
    const envelope = parsed as { error?: { message?: string } } | null;
    throw new Error(envelope?.error?.message ?? `Request failed (${res.status})`);
  }
  // the route handlers serialise exactly the documented shape
  return parsed as T;
}

const TIER_LABEL: Record<HotelTier, string> = {
  budget: "budget",
  mid: "mid-range",
  luxury: "luxury",
};

const TYPE_EMOJI: Record<ItineraryItem["type"], string> = {
  activity: "🎟",
  meal: "🍽",
  transport: "🚌",
  flight: "✈️",
  checkin: "🏨",
  free: "🌿",
};

const DOC_EMOJI: Record<ComplianceDocument["documentType"], string> = {
  passport: "🛂",
  visa: "📄",
  insurance: "🛡",
  health: "💉",
};

const CAT_COLOR: Record<BudgetCategory, string> = {
  flights: "#8B5CF6",
  lodging: "#22D3EE",
  activities: "#34D399",
  food: "#FBBF24",
  transport: "#EC4899",
  other: "#6B7280",
};

const CAT_LABEL: Record<BudgetCategory, string> = {
  flights: "Flights",
  lodging: "Lodging",
  activities: "Activities",
  food: "Food",
  transport: "Transport",
  other: "Other",
};

function stateTag(state: TripState): { kind?: "good" | "warn" | "crit" | "ai"; label: string } {
  switch (state) {
    case "ready":
      return { kind: "good", label: "Ready" };
    case "packaged":
      return { kind: "good", label: "Packaged" };
    case "blocked":
      return { kind: "crit", label: "Blocked" };
    case "drafting":
      return { kind: "ai", label: "Drafting" };
    case "refining":
      return { kind: "ai", label: "Refining" };
    case "gathering":
      return { label: "Gathering" };
    default:
      return { label: "Idle" };
  }
}

function nightsBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const from = new Date(`${a}T00:00:00Z`).getTime();
  const to = new Date(`${b}T00:00:00Z`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

function subLine(trip: Trip): string {
  const people = trip.partyAdults + trip.partyChildren.length;
  const parts: string[] = [];
  if (people > 0) parts.push(`${people} traveller${people === 1 ? "" : "s"}`);
  const nights = trip.durationDays
    ? Math.max(1, trip.durationDays - 1)
    : nightsBetween(trip.startDate, trip.endDate);
  if (nights) parts.push(`${nights} night${nights === 1 ? "" : "s"}`);
  if (trip.hotelTier) parts.push(TIER_LABEL[trip.hotelTier]);
  else parts.push(`${trip.pace} pace`);
  if (trip.destinationCity) parts.push(trip.destinationCity);
  return parts.join(" · ");
}

function hhmm(iso: string): string {
  // provider departure times carry no zone — read the wall clock literally
  const m = /T(\d{2}:\d{2})/.exec(iso);
  return m ? m[1] : "—";
}

/**
 * `arriveAt` comes back as a UTC instant while `departAt` is a bare wall clock, so
 * deriving the arrival from the duration is the only self-consistent reading — and it
 * cannot drift with the viewer's timezone.
 */
function arrivalClock(departAt: string, durationMin: number): string {
  const m = /T(\d{2}):(\d{2})/.exec(departAt);
  if (!m) return "—";
  const total = Number(m[1]) * 60 + Number(m[2]) + durationMin;
  const dayShift = Math.floor(total / 1440);
  const mins = ((total % 1440) + 1440) % 1440;
  const clock = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  return dayShift > 0 ? `${clock} +${dayShift}d` : clock;
}

function duration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function ago(iso: string | null | undefined): string {
  if (!iso) return "recently";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `on ${shortDate(iso.slice(0, 10))}`;
}

function daysSince(dateOnly: string): number {
  const t = new Date(`${dateOnly}T00:00:00Z`).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The right word for the local transit network — "12 min · Tube" should be true. */
function transitWord(city: string | null): string {
  const c = (city ?? "").toLowerCase();
  if (c.includes("london")) return "Tube";
  if (c.includes("singapore")) return "MRT";
  if (c.includes("paris")) return "Métro";
  if (c.includes("bangkok")) return "BTS";
  if (c.includes("tokyo") || c.includes("dubai") || c.includes("delhi")) return "Metro";
  return "Transit";
}

function legLabel(item: ItineraryItem, transit: string): string {
  const mode = item.travelMode;
  const word =
    mode === "walk"
      ? "Walk"
      : mode === "taxi"
        ? "Taxi"
        : mode === "drive"
          ? "Drive"
          : mode === "flight"
            ? "Flight"
            : transit;
  const bits = [`${item.travelMinutes} min`, word];
  if (mode === "walk" && item.travelKm) bits.push(`${item.travelKm.toFixed(1)} km`);
  return bits.join(" · ");
}

function weatherEmoji(summary: string, rainChance: number): string {
  const s = summary.toLowerCase();
  if (/storm|thunder/.test(s)) return "⛈";
  if (/snow|sleet/.test(s)) return "🌨";
  if (/rain|shower|drizzle/.test(s) || rainChance >= 55) return "🌧";
  if (/overcast|cloud/.test(s)) return "☁️";
  if (/clear|sun/.test(s)) return "☀️";
  return "🌤";
}

const docStatus = (
  d: ComplianceDocument,
): { kind?: "good" | "warn" | "crit" | "ai"; label: string } => {
  switch (d.status) {
    case "blocking":
      return { kind: "crit", label: "Blocking" };
    case "required":
      return { kind: "warn", label: "Action needed" };
    case "in_progress":
      return { kind: "ai", label: "In progress" };
    default:
      return { kind: "good", label: "Satisfied" };
  }
};

const travellerStatus = (t: ComplianceTraveller) =>
  t.documents.some((d) => d.status === "blocking")
    ? { kind: "crit" as const, label: "Blocking" }
    : t.documents.some((d) => d.status === "required")
      ? { kind: "warn" as const, label: "Action needed" }
      : { kind: "good" as const, label: "All clear" };

/* ========================================================================== */
/* The smallest markdown renderer that still reads well                       */
/* ========================================================================== */

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "h"; text: string };

function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      blocks.push({ kind: "p", lines: para });
      para = [];
    }
  };

  for (const raw of src.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "h", text: heading[1] });
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      const prev = blocks[blocks.length - 1];
      if (prev && prev.kind === "ul") prev.items.push(bullet[1]);
      else blocks.push({ kind: "ul", items: [bullet[1]] });
      continue;
    }
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flush();
      const prev = blocks[blocks.length - 1];
      if (prev && prev.kind === "ol") prev.items.push(numbered[1]);
      else blocks.push({ kind: "ol", items: [numbered[1]] });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

const SAFE_HREF = /^(https?:|mailto:)/i;

/** **bold**, `code`, [text](url) — built as React elements, never as HTML. */
function inlineNodes(text: string, base: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([\s\S]+?)\*\*|`([^`]+?)`|\[([^\]]+?)\]\(([^)\s]+?)\)/g;
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null = re.exec(text);
  while (m) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${base}-${n++}`;
    if (m[1] !== undefined) {
      out.push(<strong key={key}>{m[1]}</strong>);
    } else if (m[2] !== undefined) {
      out.push(
        <code
          key={key}
          style={{
            background: "var(--surface-2)",
            borderRadius: 5,
            padding: "1px 5px",
            fontSize: "0.92em",
          }}
        >
          {m[2]}
        </code>,
      );
    } else if (m[3] !== undefined && m[4] !== undefined) {
      out.push(
        SAFE_HREF.test(m[4]) ? (
          <a key={key} href={m[4]} target="_blank" rel="noreferrer noopener">
            {m[3]}
          </a>
        ) : (
          <span key={key}>{m[3]}</span>
        ),
      );
    }
    last = re.lastIndex;
    m = re.exec(text);
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function RichText({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === "h") {
          return (
            <p key={i}>
              <strong>{inlineNodes(b.text, `h${i}`)}</strong>
            </p>
          );
        }
        if (b.kind === "ul") {
          return (
            <ul key={i}>
              {b.items.map((it, j) => (
                <li key={j}>{inlineNodes(it, `u${i}_${j}`)}</li>
              ))}
            </ul>
          );
        }
        if (b.kind === "ol") {
          return (
            <ol key={i}>
              {b.items.map((it, j) => (
                <li key={j}>{inlineNodes(it, `o${i}_${j}`)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i}>
            {b.lines.map((ln, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                {inlineNodes(ln, `p${i}_${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

/* ========================================================================== */
/* Page                                                                       */
/* ========================================================================== */

export default function TripWorkspacePage() {
  return (
    <Suspense fallback={<BootShell />}>
      <Workspace />
    </Suspense>
  );
}

function BootShell() {
  return (
    <div className="mx-auto grid max-w-md gap-3 p-6" aria-busy>
      <div className="skel" style={{ height: 44 }} />
      <Skeletons n={4} height={76} />
    </div>
  );
}

function Workspace() {
  const routeParams = useParams<{ id: string }>();
  const id = typeof routeParams?.id === "string" ? routeParams.id : "";
  const router = useRouter();
  const searchParams = useSearchParams();

  /* ---------------------------------------------------------------- state */

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [chips, setChips] = useState<string[]>([]);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [liveScope, setLiveScope] = useState<string | null>(null);

  const [tab, setTab] = useState<TabKey>("itinerary");
  const [isDesktop, setIsDesktop] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [printMode, setPrintMode] = useState(false);

  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const [tierFilter, setTierFilter] = useState<HotelTier | "all">("all");
  const [packed, setPacked] = useState<Record<string, boolean>>({});
  const [initial, setInitial] = useState("Y");

  const threadRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const streamRef = useRef(false);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstQuestion = useRef<string | null>(null);
  const qTaken = useRef(false);
  const sheetOpenRef = useRef(false);
  const desktopRef = useRef(false);

  sheetOpenRef.current = sheetOpen;
  desktopRef.current = isDesktop;

  /* ------------------------------------------------------------- loading */

  const refetch = useCallback(async () => {
    if (!id) return;
    try {
      const next = await api<Payload>(`/api/trips/${id}`);
      setData(next);
      setLoadError(null);
    } catch (e) {
      setArtifactError(errMessage(e));
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [payload, thread] = await Promise.all([
          api<Payload>(`/api/trips/${id}`),
          api<{ data: { id: string; role: "user" | "assistant"; content: string }[] }>(
            `/api/trips/${id}/messages`,
          ).catch(() => ({ data: [] })),
        ]);
        if (!alive) return;
        setData(payload);
        setMessages(
          thread.data.map((m) => ({ id: m.id, role: m.role, content: m.content, tools: [] })),
        );
        setLoadError(null);
      } catch (e) {
        if (alive) setLoadError(errMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const after = () => setPrintMode(false);
    window.addEventListener("afterprint", after);
    return () => window.removeEventListener("afterprint", after);
  }, []);

  useEffect(() => {
    // the session cookies are httpOnly, so the avatar letter is best effort
    try {
      const letter = localStorage.getItem("jos-email")?.trim().slice(0, 1).toUpperCase();
      if (letter && /[A-Z0-9]/.test(letter)) setInitial(letter);
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(
    () => () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    },
    [],
  );

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      void refetch();
    }, 450);
  }, [refetch]);

  /* ----------------------------------------------------------- streaming */

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || !id || streamRef.current) return;

      streamRef.current = true;
      setStreaming(true);
      setTurnError(null);
      setChips([]);
      stickRef.current = true;

      const aiId = uid();
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "user", content: message, tools: [] },
        { id: aiId, role: "assistant", content: "", tools: [], streaming: true },
      ]);

      const patchAi = (fn: (m: ChatMsg) => ChatMsg) =>
        setMessages((prev) => prev.map((m) => (m.id === aiId ? fn(m) : m)));

      const apply = (ev: ChatEvent | null) => {
        if (!ev) return;
        switch (ev.type) {
          case "state":
            setData((d) => (d ? { ...d, trip: { ...d.trip, state: ev.state } } : d));
            break;
          case "tool_start":
            patchAi((m) => ({
              ...m,
              tools: [...m.tools, { tool: ev.tool, label: ev.label, done: false }],
            }));
            break;
          case "tool_end":
            patchAi((m) => {
              const tools = [...m.tools];
              let hit = -1;
              for (let i = tools.length - 1; i >= 0; i--) {
                if (!tools[i].done && tools[i].tool === ev.tool) {
                  hit = i;
                  break;
                }
              }
              const done: ToolLine = {
                tool: ev.tool,
                label: ev.label,
                done: true,
                warn: ev.warn,
                count: ev.count,
                ms: ev.ms,
              };
              if (hit >= 0) tools[hit] = done;
              else tools.push(done);
              return { ...m, tools };
            });
            break;
          case "token":
            patchAi((m) => ({ ...m, content: m.content + ev.text }));
            break;
          case "patch":
            setLiveScope(ev.scope);
            if (!desktopRef.current && !sheetOpenRef.current) setUnseen((n) => n + 1);
            scheduleRefetch();
            break;
          case "question":
            setChips(ev.chips.slice(0, 6));
            break;
          case "done":
            setData((d) => (d ? { ...d, trip: { ...d.trip, state: ev.state } } : d));
            break;
          case "error":
            setTurnError(ev.message || ev.code);
            break;
        }
      };

      try {
        const res = await fetch(`/api/trips/${id}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, inputMode: "text" }),
        });

        if (!res.ok || !res.body) {
          const text = await res.text();
          let envelope: { error?: { message?: string } } | null = null;
          try {
            envelope = text ? (JSON.parse(text) as { error?: { message?: string } }) : null;
          } catch {
            /* not JSON */
          }
          throw new Error(envelope?.error?.message ?? `The chat stream failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let cut = buffer.indexOf("\n\n");
          while (cut !== -1) {
            apply(parseFrame(buffer.slice(0, cut)));
            buffer = buffer.slice(cut + 2);
            cut = buffer.indexOf("\n\n");
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) apply(parseFrame(buffer));
      } catch (e) {
        setTurnError(errMessage(e));
      } finally {
        streamRef.current = false;
        setStreaming(false);
        setLiveScope(null);
        patchAi((m) => ({ ...m, streaming: false }));
        void refetch();
      }
    },
    [id, refetch, scheduleRefetch],
  );

  /* --------------------------------------------------- the ?q= first turn */

  useEffect(() => {
    if (qTaken.current) return;
    const q = searchParams.get("q");
    if (!q) return;
    qTaken.current = true;
    firstQuestion.current = q;
    router.replace(`/trips/${id}`, { scroll: false });
  }, [searchParams, router, id]);

  useEffect(() => {
    if (loading || !firstQuestion.current) return;
    const q = firstQuestion.current;
    firstQuestion.current = null;
    void send(q);
  }, [loading, send]);

  /* ------------------------------------------------------- auto-scrolling */

  useEffect(() => {
    const el = threadRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, chips, streaming, loading, turnError]);

  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };

  /* ----------------------------------------------------- artifact actions */

  const patchItem = useCallback(
    async (itemId: string, patch: { dayNumber?: number; locked?: boolean; remove?: boolean }) => {
      if (!id) return;
      setBusyItem(itemId);
      setArtifactError(null);
      try {
        const res = await api<{ itinerary: ItineraryItem[]; conflicts: Conflict[] }>(
          `/api/trips/${id}/itinerary/${itemId}`,
          { method: "PATCH", body: JSON.stringify(patch) },
        );
        setData((d) => (d ? { ...d, itinerary: res.itinerary ?? [] } : d));
        setConflicts(res.conflicts ?? []);
      } catch (e) {
        setArtifactError(errMessage(e));
      } finally {
        setBusyItem(null);
      }
    },
    [id],
  );

  const makeShare = async () => {
    if (!id) return;
    setShareBusy(true);
    setArtifactError(null);
    try {
      const res = await api<{ token: string; url: string }>(`/api/trips/${id}/share`, {
        method: "POST",
      });
      setShareUrl(res.url);
    } catch (e) {
      setArtifactError(errMessage(e));
    } finally {
      setShareBusy(false);
    }
  };

  const copyShare = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setArtifactError("Could not reach the clipboard — select the link and copy it manually.");
    }
  };

  const exportPdf = () => {
    setPrintMode(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        setPrintMode(false);
      });
    });
  };

  const openSheet = () => {
    setSheetOpen((o) => {
      if (!o) setUnseen(0);
      return !o;
    });
  };

  /* --------------------------------------------------------------- derived */

  const trip = data?.trip ?? null;
  const itinerary = data?.itinerary ?? [];
  const flights = data?.flights ?? [];
  const hotels = data?.hotels ?? [];
  const compliance = data?.compliance ?? null;
  const budget = data?.budget ?? null;
  const essentials = data?.essentials ?? null;
  const events = data?.events ?? [];

  const people = trip ? trip.partyAdults + trip.partyChildren.length : 1;
  const transit = transitWord(trip?.destinationCity ?? null);
  const blocking = compliance?.summary.blocking ?? 0;
  const required = compliance?.summary.required ?? 0;

  const dayOptions = useMemo(() => {
    const list = data?.itinerary ?? [];
    const maxFromItems = list.reduce((n, i) => Math.max(n, i.dayNumber), 0);
    const total = Math.max(maxFromItems, data?.trip.durationDays ?? 0, 1);
    return Array.from({ length: total }, (_, i) => i + 1);
  }, [data?.itinerary, data?.trip.durationDays]);

  const badgeFor = (key: TabKey): { text: string; crit?: boolean } | null => {
    if (key === "flights") return flights.length ? { text: String(flights.length) } : null;
    if (key === "stays") return hotels.length ? { text: String(hotels.length) } : null;
    if (key === "documents") {
      if (blocking > 0) return { text: String(blocking), crit: true };
      if (required > 0) return { text: String(required) };
      return null;
    }
    return null;
  };

  /* ----------------------------------------------------------------- style */

  const asSheet = !isDesktop && !printMode;
  const rootStyle: CSSProperties | undefined = printMode
    ? { display: "block", height: "auto" }
    : undefined;

  const paneStyle: CSSProperties = asSheet
    ? {
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 60,
        height: "88vh",
        transform: sheetOpen ? "translateY(0)" : "translateY(calc(100% - 64px))",
        transition: "transform 0.34s cubic-bezier(0.2, 0.7, 0.3, 1)",
        background: "var(--bg-elev)",
        borderTop: "1px solid var(--border-strong)",
        borderRadius: "18px 18px 0 0",
        boxShadow: "var(--shadow)",
      }
    : printMode
      ? { height: "auto", overflow: "visible" }
      : { borderLeft: "1px solid var(--border)" };

  const scrollStyle: CSSProperties = printMode
    ? { overflow: "visible" }
    : { overflowY: "auto", overscrollBehavior: "contain" };

  const state = stateTag(trip?.state ?? "idle");

  /* ------------------------------------------------------------------ view */

  return (
    <div
      className="relative h-[100dvh] overflow-hidden lg:grid lg:h-[calc(100vh-0px)] lg:grid-cols-[minmax(360px,38%)_1fr] lg:overflow-visible"
      style={rootStyle}
    >
      {/* ---------------------------------------------------------- chat */}
      <section
        className="no-print flex h-full min-h-0 flex-col"
        style={{ paddingBottom: asSheet ? 64 : 0 }}
      >
        <header
          className="flex shrink-0 items-center gap-2.5 px-3 py-2.5"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <Link href="/dashboard" className="icon-btn" aria-label="Back to your trips" title="Back">
            <span aria-hidden>←</span>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold tracking-tight">
              {trip?.title ?? (loading ? "Loading trip…" : "Trip")}
            </h1>
            <p className="truncate text-[12px]" style={{ color: "var(--text-2)" }}>
              {trip ? subLine(trip) : "—"}
            </p>
          </div>
          <Tag kind={state.kind}>{state.label}</Tag>
        </header>

        <div
          ref={threadRef}
          onScroll={onThreadScroll}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-4"
          aria-busy={streaming}
        >
          <div className="mx-auto grid max-w-[720px] gap-3.5">
            {loading ? (
              <Skeletons n={3} height={68} />
            ) : loadError ? (
              <ErrorNote>
                {loadError}{" "}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setLoadError(null);
                    setLoading(true);
                    void refetch().finally(() => setLoading(false));
                  }}
                >
                  Retry
                </button>
              </ErrorNote>
            ) : messages.length === 0 ? (
              <Empty
                icon="🧭"
                title="Tell me about the trip"
                body="Dates, who is coming, what you want out of it. I draft the whole plan and show every source."
              />
            ) : null}

            {messages.map((m) => (
              <MessageBlock key={m.id} msg={m} initial={initial} />
            ))}

            {chips.length > 0 && !streaming ? (
              <div className="ml-[39px] flex flex-wrap gap-2 fade-up">
                {chips.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="chip"
                    onClick={() => {
                      setChips([]);
                      void send(c);
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            ) : null}

            {turnError ? <ErrorNote>{turnError}</ErrorNote> : null}
          </div>
        </div>

        <div className="shrink-0 px-3 pb-3">
          <div className="mx-auto max-w-[720px]">
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={() => {
                const text = draft;
                setDraft("");
                void send(text);
              }}
              placeholder={streaming ? "Working on it…" : "Change anything — dates, pace, budget…"}
              disabled={streaming || loading || !!loadError}
              compact
            />
            <p className="mt-2 text-center text-[11.5px]" style={{ color: "var(--text-3)" }}>
              Grounded in live data · guidance only for visa and passport rules
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- backdrop */}
      {asSheet && sheetOpen ? (
        <button
          type="button"
          aria-label="Close the trip plan"
          onClick={openSheet}
          className="no-print fixed inset-0 z-50"
          style={{ background: "rgb(0 0 0 / 0.45)", border: 0, cursor: "pointer" }}
        />
      ) : null}

      {/* ------------------------------------------------------- artifact */}
      <aside
        id="trip-artifact"
        className={`flex min-h-0 flex-col${sheetOpen ? " open" : ""}`}
        style={paneStyle}
      >
        {asSheet ? (
          <button
            type="button"
            onClick={openSheet}
            aria-expanded={sheetOpen}
            aria-controls="trip-artifact"
            className="no-print w-full shrink-0 text-left"
            style={{ height: 64, padding: "0 16px", background: "transparent", border: 0, cursor: "pointer" }}
          >
            <div className="flex h-full flex-col justify-center gap-2">
              <div
                className="mx-auto"
                style={{ width: 38, height: 4, borderRadius: 999, background: "var(--border-strong)" }}
                aria-hidden
              />
              <div className="flex items-center gap-2">
                <span className="truncate text-[13.5px] font-semibold">
                  {trip?.title ?? "Trip plan"}
                </span>
                {unseen > 0 ? <span className="badge badge-crit">{unseen}</span> : null}
                {blocking > 0 ? <span className="badge badge-crit">{blocking}</span> : null}
                <span className="ml-auto shrink-0 text-[12px]" style={{ color: "var(--text-2)" }}>
                  {sheetOpen ? "Close ▾" : "The plan ▴"}
                </span>
              </div>
            </div>
          </button>
        ) : null}

        <div
          className="flex shrink-0 items-center gap-2 px-3 py-2.5"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[13px] font-semibold tracking-tight">
                <span className="grad-text">Trip artifact</span>
              </h2>
              {liveScope ? <Tag kind="ai">updating {liveScope}</Tag> : null}
            </div>
            {trip?.assumptions.length ? (
              <p className="truncate text-[11.5px]" style={{ color: "var(--text-3)" }}>
                Assumed: {trip.assumptions.join(" · ")}
              </p>
            ) : null}
          </div>
          <div className="no-print flex shrink-0 items-center gap-1.5">
            <button className="btn btn-ghost btn-sm" onClick={makeShare} disabled={shareBusy}>
              {shareBusy ? <span className="spin" /> : <span aria-hidden>🔗</span>}
              <span className="hidden sm:inline">Share</span>
            </button>
            <button className="btn btn-ghost btn-sm" onClick={exportPdf} title="Export as PDF">
              <span aria-hidden>⎙</span>
              <span className="hidden sm:inline">PDF</span>
            </button>
            <ThemeToggle />
          </div>
        </div>

        {shareUrl ? (
          <div className="no-print flex shrink-0 items-center gap-2 px-3 py-2">
            <input
              readOnly
              value={shareUrl}
              aria-label="Public share link"
              className="field-input"
              style={{ fontSize: 12.5, padding: "8px 10px" }}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button className="btn btn-sm" onClick={copyShare}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : null}

        <div
          className="no-print flex shrink-0 gap-1 overflow-x-auto px-2"
          style={{ borderBottom: "1px solid var(--border)" }}
          role="tablist"
          aria-label="Trip plan sections"
        >
          {TABS.map((t) => {
            const b = badgeFor(t.key);
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`tab-${t.key}`}
                aria-selected={tab === t.key}
                aria-controls={`panel-${t.key}`}
                className={`tab${tab === t.key ? " tab-on" : ""}`}
                onClick={() => setTab(t.key)}
              >
                <span>{t.label}</span>
                {b ? <span className={`badge${b.crit ? " badge-crit" : ""}`}>{b.text}</span> : null}
              </button>
            );
          })}
        </div>

        <div
          className="min-h-0 flex-1 px-3 py-4 sm:px-4"
          style={scrollStyle}
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
        >
          <div key={tab} className="mx-auto max-w-[760px] fade-up">
            {artifactError ? (
              <div className="mb-3">
                <ErrorNote>{artifactError}</ErrorNote>
              </div>
            ) : null}

            {loading ? (
              <Skeletons n={5} height={76} />
            ) : loadError ? (
              <ErrorNote>{loadError}</ErrorNote>
            ) : tab === "itinerary" ? (
              <ItineraryTab
                items={itinerary}
                weather={essentials?.weather ?? []}
                conflicts={conflicts}
                dayOptions={dayOptions}
                busyItem={busyItem}
                transit={transit}
                events={events}
                onPatch={patchItem}
              />
            ) : tab === "flights" ? (
              <FlightsTab flights={flights} />
            ) : tab === "stays" ? (
              <StaysTab
                hotels={hotels}
                tier={tierFilter}
                onTier={setTierFilter}
                nights={
                  trip?.durationDays
                    ? Math.max(1, trip.durationDays - 1)
                    : nightsBetween(trip?.startDate ?? null, trip?.endDate ?? null)
                }
              />
            ) : tab === "documents" ? (
              <DocumentsTab compliance={compliance} />
            ) : tab === "budget" ? (
              <BudgetTab
                budget={budget}
                people={people}
                onSuggestion={(s) => {
                  if (!isDesktop) setSheetOpen(false);
                  void send(s);
                }}
              />
            ) : (
              <EssentialsTab
                essentials={essentials}
                packed={packed}
                onToggle={(key) => setPacked((p) => ({ ...p, [key]: !p[key] }))}
              />
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

/** "event: x\ndata: {...}" → a typed ChatEvent. */
function parseFrame(frame: string): ChatEvent | null {
  let name = "";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (!data.length) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.join("\n"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const merged = { type: name, ...(parsed as Record<string, unknown>) };
  // the server serialises the ChatEvent union verbatim; the event name is the fallback tag
  return merged as unknown as ChatEvent;
}

/* ========================================================================== */
/* Chat pieces                                                                */
/* ========================================================================== */

function MessageBlock({ msg, initial }: { msg: ChatMsg; initial: string }) {
  const mine = msg.role === "user";
  return (
    <div className="grid gap-[7px] fade-up">
      <div className="flex items-start gap-[11px]">
        <div className={`msg-av ${mine ? "msg-av-me" : "msg-av-ai"}`} aria-hidden>
          {mine ? initial : "J"}
        </div>
        <div className={`bubble${mine ? " bubble-me" : ""}`}>
          {mine ? (
            <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
          ) : msg.content ? (
            <RichText text={msg.content} />
          ) : msg.streaming ? (
            <div className="typing" aria-label="Thinking">
              <i />
              <i />
              <i />
            </div>
          ) : (
            <span style={{ color: "var(--text-3)" }}>No answer came back for that turn.</span>
          )}
        </div>
      </div>

      {msg.tools.length > 0 ? (
        <div className="grid gap-[7px] ml-[39px]">
          {msg.tools.map((t, i) => (
            <div className="tool-chip" key={`${t.tool}-${i}`}>
              {t.done ? (
                <span aria-hidden style={{ color: t.warn ? "var(--warn)" : "var(--good)" }}>
                  {t.warn ? "⚠" : "✓"}
                </span>
              ) : (
                <div className="spin" />
              )}
              <span style={{ color: t.done ? "var(--text-2)" : "var(--text-1)" }}>
                {t.label}
                {t.done ? "" : "…"}
              </span>
              {t.done && t.count != null ? (
                <span style={{ color: "var(--text-3)" }}>· {t.count}</span>
              ) : null}
              {t.done && t.ms != null ? (
                <span style={{ color: "var(--text-3)" }}>
                  · {t.ms >= 1000 ? `${(t.ms / 1000).toFixed(1)}s` : `${Math.round(t.ms)}ms`}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ========================================================================== */
/* Shared artifact atoms                                                      */
/* ========================================================================== */

function Meta({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px]" style={{ color: "var(--text-2)" }}>
      {children}
    </span>
  );
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3">
        <h3 className="text-[13.5px] font-semibold">{title}</h3>
        {sub ? (
          <p className="text-[12px]" style={{ color: "var(--text-2)" }}>
            {sub}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function AmberNote({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[12.5px]"
      style={{
        background: "var(--warn-soft)",
        borderColor: "rgb(251 191 36 / 0.32)",
        color: "var(--warn)",
      }}
      role="status"
    >
      <span aria-hidden>⚠</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* ========================================================================== */
/* 1 · Itinerary                                                              */
/* ========================================================================== */

interface Day {
  dayNumber: number;
  date: string | null;
  items: ItineraryItem[];
}

function ItineraryTab({
  items,
  weather,
  conflicts,
  dayOptions,
  busyItem,
  transit,
  events,
  onPatch,
}: {
  items: ItineraryItem[];
  weather: Essentials["weather"];
  conflicts: Conflict[];
  dayOptions: number[];
  busyItem: string | null;
  transit: string;
  events: EventOffer[];
  onPatch: (itemId: string, patch: { dayNumber?: number; locked?: boolean; remove?: boolean }) => void;
}) {
  const days = useMemo<Day[]>(() => {
    const map = new Map<number, Day>();
    for (const it of items) {
      const day = map.get(it.dayNumber) ?? { dayNumber: it.dayNumber, date: it.date, items: [] };
      if (!day.date && it.date) day.date = it.date;
      day.items.push(it);
      map.set(it.dayNumber, day);
    }
    return [...map.values()].sort((a, b) => a.dayNumber - b.dayNumber);
  }, [items]);

  const placed = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i.dayNumber]));
    const byDay = new Map<number, string[]>();
    const orphans: string[] = [];
    for (const c of conflicts) {
      let day = byId.get(c.itemId) ?? null;
      if (day == null) {
        const m = /day\s+(\d+)/i.exec(c.reason);
        day = m ? Number(m[1]) : null;
      }
      if (day == null) {
        orphans.push(c.reason);
        continue;
      }
      byDay.set(day, [...(byDay.get(day) ?? []), c.reason]);
    }
    return { byDay, orphans };
  }, [conflicts, items]);

  if (!items.length) {
    return (
      <Empty
        icon="🗓"
        title="Your plan will appear here"
        body="Describe the trip in the chat and I'll build it — day by day, as each piece lands."
      />
    );
  }

  return (
    <div className="grid gap-6">
      {placed.orphans.length > 0 ? (
        <AmberNote>
          {placed.orphans.map((r, i) => (
            <p key={i}>{r}</p>
          ))}
        </AmberNote>
      ) : null}

      {days.map((day) => {
        const temp = weather.find((w) => w.date === day.date);
        const walkKm = day.items
          .filter((i) => i.travelMode === "walk")
          .reduce((s, i) => s + (i.travelKm ?? 0), 0);
        const cost = day.items.reduce((s, i) => s + (i.cost ?? 0), 0);
        const notes = placed.byDay.get(day.dayNumber) ?? [];

        return (
          <section key={day.dayNumber}>
            <div className="mb-2.5 flex items-center gap-3">
              <div
                className="grid shrink-0 place-items-center"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 11,
                  background: "linear-gradient(135deg, var(--accent-from), var(--accent-to))",
                  color: "#0a0b0f",
                  fontWeight: 750,
                  fontSize: 12.5,
                }}
                aria-hidden
              >
                D{day.dayNumber}
              </div>
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold">
                  {day.date ? `${weekday(day.date)} · ${shortDate(day.date)}` : `Day ${day.dayNumber}`}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  {temp ? (
                    <Meta>
                      <span aria-hidden>{weatherEmoji(temp.summary, temp.rainChance)}</span>
                      {Math.round(temp.tempC)}° · {temp.summary}
                    </Meta>
                  ) : null}
                  {walkKm > 0.05 ? (
                    <Meta>
                      <span aria-hidden>🚶</span>
                      {walkKm.toFixed(1)} km
                    </Meta>
                  ) : null}
                  {cost > 0 ? (
                    <Meta>
                      <span aria-hidden>💰</span>
                      {inr(cost)}
                    </Meta>
                  ) : null}
                </div>
              </div>
            </div>

            {notes.length > 0 ? (
              <div className="mb-2.5">
                <AmberNote>
                  {notes.map((r, i) => (
                    <p key={i}>{r}</p>
                  ))}
                </AmberNote>
              </div>
            ) : null}

            <div>
              {day.items.map((it, i) => {
                const leg = i > 0 && it.travelMinutes ? legLabel(it, transit) : null;
                return (
                  <Fragment key={it.id}>
                    {i > 0 ? (
                      leg ? (
                        <div className="connector">
                          <span>{leg}</span>
                        </div>
                      ) : (
                        <div style={{ height: 10 }} />
                      )
                    ) : null}
                    <ItemRow
                      item={it}
                      dayOptions={dayOptions}
                      busy={busyItem === it.id}
                      onPatch={onPatch}
                    />
                  </Fragment>
                );
              })}
            </div>
          </section>
        );
      })}

      {events.length > 0 ? (
        <Panel title="Also on while you are there" sub="Worth a look — not yet in the plan">
          <div className="grid gap-2">
            {events.slice(0, 6).map((e) => (
              <div key={e.id} className="flex items-start gap-3">
                <span aria-hidden className="text-[17px]">
                  🎪
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px]" style={{ fontWeight: 560 }}>
                    {e.name}
                  </div>
                  <p className="text-[12px]" style={{ color: "var(--text-2)" }}>
                    {e.venue} · {shortDate(e.date)} {e.time} · {e.priceBand}
                    {e.familyFriendly ? " · family friendly" : ""}
                  </p>
                </div>
                <a
                  className="btn btn-ghost btn-sm shrink-0"
                  href={e.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open
                </a>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function ItemRow({
  item,
  dayOptions,
  busy,
  onPatch,
}: {
  item: ItineraryItem;
  dayOptions: number[];
  busy: boolean;
  onPatch: (itemId: string, patch: { dayNumber?: number; locked?: boolean; remove?: boolean }) => void;
}) {
  const [menu, setMenu] = useState(false);

  const controls = menu ? (
    <div
      className="no-print mt-3 flex flex-wrap items-center gap-2 pt-3"
      style={{ borderTop: "1px solid var(--border)" }}
    >
      <label className="text-[12px]" style={{ color: "var(--text-2)" }} htmlFor={`move-${item.id}`}>
        Move to day…
      </label>
      <select
        id={`move-${item.id}`}
        className="field-input"
        style={{ width: "auto", padding: "6px 10px", fontSize: 13 }}
        value={item.dayNumber}
        disabled={busy}
        onChange={(e) => onPatch(item.id, { dayNumber: Number(e.target.value) })}
      >
        {dayOptions.map((n) => (
          <option key={n} value={n}>
            Day {n}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        aria-pressed={item.locked}
        onClick={() => onPatch(item.id, { locked: !item.locked })}
      >
        <span aria-hidden>{item.locked ? "🔒" : "🔓"}</span>
        {item.locked ? "Locked" : "Lock"}
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        style={{ color: "var(--crit)" }}
        onClick={() => onPatch(item.id, { remove: true })}
      >
        Remove
      </button>
      {busy ? <div className="spin" /> : null}
    </div>
  ) : null;

  const menuToggle = (
    <button
      type="button"
      className="no-print btn btn-ghost btn-sm"
      style={{ minHeight: 28, padding: "2px 8px" }}
      aria-expanded={menu}
      aria-label={`Options for ${item.title}`}
      onClick={() => setMenu((m) => !m)}
    >
      <span aria-hidden>⋯</span>
    </button>
  );

  if (item.type === "free") {
    return (
      <div
        className="px-3.5 py-3"
        style={{ border: "1px dashed var(--border-strong)", borderRadius: 14 }}
      >
        <div className="flex items-start gap-3">
          <span className="text-[18px]" aria-hidden>
            🌿
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {item.startTime ? (
                <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent-to)" }}>
                  {item.startTime}
                </span>
              ) : null}
              {item.locked ? <span aria-label="Locked">🔒</span> : null}
            </div>
            <div className="text-[13.5px]" style={{ fontWeight: 560 }}>
              {item.title}
            </div>
            {item.description ? (
              <p className="text-[12.5px]" style={{ color: "var(--text-2)" }}>
                {item.description}
              </p>
            ) : null}
          </div>
          {menuToggle}
        </div>
        {controls}
      </div>
    );
  }

  return (
    <div className="card card-hover p-3">
      <div className="flex items-start gap-3">
        <div
          className="grid shrink-0 place-items-center text-[18px]"
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
          }}
          aria-hidden
        >
          {TYPE_EMOJI[item.type]}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent-to)" }}>
              {item.startTime ?? "—"}
            </span>
            {item.durationMin ? (
              <span className="text-[11.5px]" style={{ color: "var(--text-3)" }}>
                {item.durationMin} min
              </span>
            ) : null}
            {item.locked ? <span aria-label="Locked">🔒</span> : null}
            {item.ticketRequired ? <Tag kind="warn">ticket</Tag> : null}
          </div>
          <div className="text-[14px] leading-snug" style={{ fontWeight: 560 }}>
            {item.title}
          </div>
          {item.description ? (
            <p className="text-[12.5px]" style={{ color: "var(--text-2)" }}>
              {item.description}
            </p>
          ) : null}
          {item.bookingUrl ? (
            <a
              className="text-[12px]"
              style={{ color: "var(--accent-to)" }}
              href={item.bookingUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Book this →
            </a>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span style={{ fontSize: 13, fontWeight: 620 }}>{item.cost ? inr(item.cost) : "Free"}</span>
          {menuToggle}
        </div>
      </div>
      {controls}
    </div>
  );
}

/* ========================================================================== */
/* 2 · Flights                                                                */
/* ========================================================================== */

function FlightsTab({ flights }: { flights: FlightRow[] }) {
  if (!flights.length) {
    return (
      <Empty
        icon="✈️"
        title="No fares pulled yet"
        body="Once I know where and when, I price the route and rank what is actually worth booking."
      />
    );
  }

  return (
    <div className="grid gap-3">
      {flights.map((f, i) => (
        <div key={f.id} className={`relative p-3.5 ${i === 0 ? "card card-accent" : "card card-hover"}`}>
          {i === 0 ? (
            <span
              className="tag tag-ai absolute -top-2 right-3.5"
              style={{ fontSize: 10, letterSpacing: "0.07em" }}
            >
              BEST VALUE
            </span>
          ) : null}

          <div className="flex items-start gap-3">
            <div
              className="grid shrink-0 place-items-center"
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                fontWeight: 700,
                fontSize: 12,
              }}
              aria-hidden
            >
              {f.carrier}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold tracking-tight">{f.origin}</span>
                <span style={{ color: "var(--text-3)", letterSpacing: "-0.08em" }} aria-hidden>
                  ——✈——
                </span>
                <span className="text-[14px] font-semibold tracking-tight">{f.destination}</span>
                {f.selected ? <Tag kind="good">selected</Tag> : null}
              </div>

              <p className="text-[12.5px]" style={{ color: "var(--text-2)" }}>
                {f.carrierName} · {hhmm(f.departAt)} → {arrivalClock(f.departAt, f.durationMin)}
              </p>
              <p className="text-[12.5px]" style={{ color: "var(--text-2)" }}>
                {duration(f.durationMin)} ·{" "}
                {f.stops === 0
                  ? "direct"
                  : `${f.stops} stop${f.stops === 1 ? "" : "s"}${
                      f.layovers.length
                        ? ` (${f.layovers
                            .map((l) => `${l.airport} ${duration(l.minutes)}`)
                            .join(", ")})`
                        : ""
                    }`}{" "}
                · {f.baggage.checked} checked, {f.baggage.cabin} cabin
              </p>

              {f.reason ? (
                <p className="mt-1 text-[12.5px]" style={{ color: "var(--accent-to)" }}>
                  <span aria-hidden>✦ </span>
                  {f.reason}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1">
              <span style={{ fontSize: 17, fontWeight: 680, letterSpacing: "-0.02em" }}>
                {inr(f.price)}
              </span>
              <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
                {f.perGroup ? "whole party" : "per person"}
              </span>
              <a
                className="no-print btn btn-ghost btn-sm"
                href={f.deepLink}
                target="_blank"
                rel="noreferrer noopener"
              >
                View
              </a>
            </div>
          </div>

          <p className="mt-2 text-[11px]" style={{ color: "var(--text-3)" }}>
            {f.provider} · fetched {ago(f.fetchedAt)}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ========================================================================== */
/* 3 · Stays                                                                  */
/* ========================================================================== */

function StaysTab({
  hotels,
  tier,
  onTier,
  nights,
}: {
  hotels: HotelRow[];
  tier: HotelTier | "all";
  onTier: (t: HotelTier | "all") => void;
  nights: number | null;
}) {
  const shown = tier === "all" ? hotels : hotels.filter((h) => h.tier === tier);

  const switcher = (
    <div className="no-print mb-3 flex flex-wrap gap-2">
      {(["all", "budget", "mid", "luxury"] as const).map((t) => {
        const on = tier === t;
        return (
          <button
            key={t}
            type="button"
            className="chip"
            aria-pressed={on}
            onClick={() => onTier(t)}
            style={
              on
                ? { borderColor: "var(--accent)", background: "var(--accent-soft)", fontWeight: 600 }
                : undefined
            }
          >
            {t === "all" ? "All" : t === "mid" ? "Mid" : t === "budget" ? "Budget" : "Luxury"}
            {t !== "all" ? (
              <span className="badge">{hotels.filter((h) => h.tier === t).length}</span>
            ) : (
              <span className="badge">{hotels.length}</span>
            )}
          </button>
        );
      })}
    </div>
  );

  if (!hotels.length) {
    return (
      <Empty
        icon="🏨"
        title="No stays shortlisted yet"
        body="I look at location first, then price — a cheap room an hour from everything is not cheap."
      />
    );
  }

  return (
    <div>
      {switcher}
      {!shown.length ? (
        <Empty
          icon="🔍"
          title="Nothing in that tier"
          body="Try another tier, or ask me in the chat to search it properly."
        />
      ) : (
        <div className="grid gap-3">
          {shown.map((h) => (
            <div key={h.id} className="card card-hover p-3.5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-[14px] font-semibold tracking-tight">{h.name}</h4>
                    <Tag>{TIER_LABEL[h.tier]}</Tag>
                    {h.selected ? <Tag kind="good">selected</Tag> : null}
                  </div>

                  <p className="text-[12.5px]" style={{ color: "var(--text-2)" }}>
                    {h.area}
                    {h.stars ? ` · ${h.stars}★ hotel` : ""} · {h.distanceToCentreKm.toFixed(1)} km to
                    centre
                  </p>

                  <p className="text-[12.5px]" style={{ color: "var(--text-2)" }}>
                    <span style={{ color: "var(--warn)" }} aria-hidden>
                      ★
                    </span>{" "}
                    <strong style={{ color: "var(--text-1)" }}>{h.rating.score.toFixed(1)}</strong> (
                    {h.rating.count.toLocaleString("en-IN")})
                  </p>

                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {h.amenities.slice(0, 6).map((a) => (
                      <span key={a} className="tag">
                        {a}
                      </span>
                    ))}
                    {h.familyFriendly ? <span className="tag tag-good">family friendly</span> : null}
                    {h.stepFree ? <span className="tag tag-good">step free</span> : null}
                  </div>

                  {h.reason ? (
                    <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--accent-to)" }}>
                      <span aria-hidden>✦ </span>
                      {h.reason}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span style={{ fontSize: 17, fontWeight: 680, letterSpacing: "-0.02em" }}>
                    {inr(h.nightly)}
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
                    per night
                  </span>
                  <span className="text-[12px]" style={{ color: "var(--text-2)" }}>
                    {inr(h.total)} total{nights ? ` · ${nights} nights` : ""}
                  </span>
                  <a
                    className="no-print btn btn-ghost btn-sm"
                    href={h.deepLink}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    View
                  </a>
                </div>
              </div>

              <p className="mt-2 text-[11px]" style={{ color: "var(--text-3)" }}>
                {h.provider} · fetched {ago(h.fetchedAt)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/* 4 · Documents                                                              */
/* ========================================================================== */

function DocumentsTab({ compliance }: { compliance: ComplianceResult | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const firstBlocking = compliance?.travellers.find((t) =>
    t.documents.some((d) => d.status === "blocking"),
  );
  const expanded = open ?? firstBlocking?.travellerId ?? compliance?.travellers[0]?.travellerId ?? null;

  if (!compliance) {
    return (
      <Empty
        icon="🛂"
        title="Nothing to check yet"
        body="Tell me who is travelling and where, and I check passports, visas and insurance against the official pages."
      />
    );
  }

  const { summary, travellers, sequence, disclaimer } = compliance;

  return (
    <div className="grid gap-3">
      {summary.blocking > 0 ? (
        <ErrorNote>
          <strong>
            {summary.blocking} blocking {summary.blocking === 1 ? "issue" : "issues"}
          </strong>
          <span>
            {" "}
            — this trip cannot be booked until they are cleared. Everything below is ordered by what
            gates what.
          </span>
        </ErrorNote>
      ) : (
        <div
          className="flex items-center gap-2.5 rounded-xl border px-4 py-3 text-[13px]"
          style={{ background: "var(--good-soft)", borderColor: "transparent", color: "var(--good)" }}
          role="status"
        >
          <span aria-hidden>✓</span>
          <span>
            Nothing is blocking. {summary.required} item{summary.required === 1 ? "" : "s"} still need
            action, {summary.satisfied} already satisfied.
          </span>
        </div>
      )}

      {sequence.length > 0 ? (
        <Panel title="Do it in this order" sub="Each step unlocks the next">
          <ol className="grid gap-1.5 pl-5 text-[13px]">
            {sequence.map((s) => (
              <li key={`${s.step}-${s.task}`}>
                {s.task}
                {s.by ? (
                  <span style={{ color: "var(--text-2)" }}> · by {shortDate(s.by)}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

      <div className="grid gap-2">
        {travellers.map((t) => {
          const status = travellerStatus(t);
          const isOpen = expanded === t.travellerId;
          return (
            <div key={t.travellerId} className="card overflow-hidden">
              <button
                type="button"
                className="flex w-full items-center gap-3 p-3 text-left"
                style={{ background: "transparent", border: 0, cursor: "pointer" }}
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? "" : t.travellerId)}
              >
                <span
                  className="grid shrink-0 place-items-center text-[13px] font-bold"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                  }}
                  aria-hidden
                >
                  {t.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold">{t.name}</span>
                  <span className="block text-[12px]" style={{ color: "var(--text-2)" }}>
                    {t.nationality} · {t.ageBand} · {t.documents.length} document
                    {t.documents.length === 1 ? "" : "s"}
                  </span>
                </span>
                <Tag kind={status.kind}>{status.label}</Tag>
                <span aria-hidden style={{ color: "var(--text-3)" }}>
                  {isOpen ? "▾" : "▸"}
                </span>
              </button>

              {isOpen ? (
                <div className="grid gap-2.5 px-3 pb-3">
                  {t.documents.map((d) => {
                    const st = docStatus(d);
                    return (
                      <div
                        key={`${t.travellerId}-${d.documentType}`}
                        className="flex items-start gap-3 rounded-xl p-3"
                        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                      >
                        <span className="shrink-0 text-[17px]" aria-hidden>
                          {DOC_EMOJI[d.documentType]}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13px] font-semibold capitalize">
                              {d.documentType}
                            </span>
                            <Tag kind={st.kind}>{st.label}</Tag>
                            {d.shortfallDays ? (
                              <Tag kind="crit">{d.shortfallDays} days short</Tag>
                            ) : null}
                          </div>
                          <p className="text-[12.5px]" style={{ color: "var(--text-2)" }}>
                            {d.requirement}
                          </p>
                          {d.outcome ? (
                            <p className="text-[12.5px]" style={{ color: "var(--text-1)" }}>
                              {d.outcome}
                            </p>
                          ) : null}
                          <p className="mt-1 text-[11px]" style={{ color: "var(--text-3)" }}>
                            Source:{" "}
                            <a href={d.sourceUrl} target="_blank" rel="noreferrer noopener">
                              {hostOf(d.sourceUrl)}
                            </a>{" "}
                            · verified {shortDate(d.verifiedOn)}
                          </p>
                          {d.isStale ? (
                            <p className="mt-1 text-[11.5px]" style={{ color: "var(--warn)" }}>
                              <span aria-hidden>⚠ </span>
                              verified {daysSince(d.verifiedOn)} days ago — rules change, re-check
                              before you pay for anything.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div
        className="rounded-xl border px-4 py-3 text-[11.5px]"
        style={{ borderColor: "var(--border)", color: "var(--text-2)" }}
      >
        {disclaimer}
      </div>
    </div>
  );
}

/* ========================================================================== */
/* 5 · Budget                                                                 */
/* ========================================================================== */

function BudgetTab({
  budget,
  people,
  onSuggestion,
}: {
  budget: Budget | null;
  people: number;
  onSuggestion: (text: string) => void;
}) {
  if (!budget) {
    return (
      <Empty
        icon="💰"
        title="No numbers yet"
        body="Once there is a plan I cost every line of it — flights, beds, tickets, food, transport, and a 10% buffer."
      />
    );
  }

  const subtotal = Math.max(0, budget.total - budget.buffer);
  const entries = (Object.entries(budget.categories) as [BudgetCategory, { planned: number; perPerson: number }][])
    .filter(([, v]) => v.planned > 0)
    .sort((a, b) => b[1].planned - a[1].planned);

  const over = budget.variance.overBy;
  const under = budget.cap != null && !over ? budget.cap - budget.total : null;

  return (
    <div className="grid gap-4">
      <section className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.1 }}>
              {inr(budget.total)}
            </div>
            <p className="text-[12.5px]" style={{ color: "var(--text-2)" }}>
              {budget.cap != null
                ? `against a ${inr(budget.cap)} cap · ${inr(Math.round(budget.total / Math.max(1, people)))} per person`
                : `no cap set · ${inr(Math.round(budget.total / Math.max(1, people)))} per person`}
            </p>
          </div>
          <div className="ml-auto">
            {over ? (
              <Tag kind="crit">{inr(over)} over</Tag>
            ) : under != null ? (
              <Tag kind="good">{inr(under)} under</Tag>
            ) : (
              <Tag>no cap</Tag>
            )}
          </div>
        </div>

        <div
          className="mt-3.5 flex overflow-hidden"
          style={{ height: 12, borderRadius: 999, background: "var(--surface-2)" }}
          role="img"
          aria-label="How the budget splits across categories"
        >
          {subtotal > 0
            ? entries.map(([k, v]) => (
                <div
                  key={k}
                  style={{ width: `${(v.planned / subtotal) * 100}%`, background: CAT_COLOR[k] }}
                  title={`${CAT_LABEL[k]} · ${inr(v.planned)}`}
                />
              ))
            : null}
        </div>

        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
          {entries.map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1.5 text-[11.5px]">
              <i
                aria-hidden
                style={{ width: 9, height: 9, borderRadius: 3, background: CAT_COLOR[k], display: "block" }}
              />
              <span>{CAT_LABEL[k]}</span>
              <span style={{ color: "var(--text-3)" }}>
                {subtotal > 0 ? `${Math.round((v.planned / subtotal) * 100)}%` : "—"}
              </span>
            </span>
          ))}
        </div>
      </section>

      {over ? (
        <AmberNote>
          <strong>{inr(over)} over your cap</strong>
          {budget.variance.causedBy ? (
            <span> — driven by {CAT_LABEL[budget.variance.causedBy].toLowerCase()}.</span>
          ) : null}
          {budget.variance.suggestions.length ? (
            <div className="no-print mt-2 flex flex-wrap gap-2">
              {budget.variance.suggestions.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => onSuggestion(s)}>
                  {s}
                </button>
              ))}
            </div>
          ) : null}
        </AmberNote>
      ) : null}

      <section className="card p-4">
        <h3 className="mb-2.5 text-[13.5px] font-semibold">Where it goes</h3>
        <div className="grid gap-0.5">
          {entries.map(([k, v]) => (
            <div
              key={k}
              className="flex items-center gap-3 py-2"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <i
                aria-hidden
                style={{ width: 9, height: 9, borderRadius: 3, background: CAT_COLOR[k], display: "block" }}
              />
              <span className="min-w-0 flex-1 truncate text-[13px]">{CAT_LABEL[k]}</span>
              <span className="shrink-0 text-[11.5px]" style={{ color: "var(--text-2)" }}>
                {inr(v.perPerson)} × {people}
              </span>
              <span className="shrink-0 text-[13px]" style={{ fontWeight: 620 }}>
                {inr(v.planned)}
              </span>
            </div>
          ))}

          <div
            className="flex items-center gap-3 py-2"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <i
              aria-hidden
              style={{
                width: 9,
                height: 9,
                borderRadius: 3,
                border: "1px dashed var(--border-strong)",
                display: "block",
              }}
            />
            <span className="min-w-0 flex-1 text-[13px]">
              Buffer
              <span style={{ color: "var(--text-2)" }}> · 10% for the things nobody plans for</span>
            </span>
            <span className="shrink-0 text-[13px]" style={{ fontWeight: 620 }}>
              {inr(budget.buffer)}
            </span>
          </div>

          <div
            className="flex items-center gap-3 py-2.5"
            style={{ borderTop: "1px solid var(--border-strong)" }}
          >
            <span className="min-w-0 flex-1 text-[13px] font-semibold">Total</span>
            <span className="shrink-0 text-[14px]" style={{ fontWeight: 700 }}>
              {inr(budget.total)}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ========================================================================== */
/* 6 · Essentials                                                             */
/* ========================================================================== */

function EssentialsTab({
  essentials,
  packed,
  onToggle,
}: {
  essentials: Essentials | null;
  packed: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  if (!essentials) {
    return (
      <Empty
        icon="🎒"
        title="Essentials come with the plan"
        body="Weather, a packing list built from it, money, connectivity and the numbers you hope never to call."
      />
    );
  }

  const groups: { group: string; items: string[] }[] = [];
  for (const p of essentials.packing) {
    const g = groups.find((x) => x.group === p.group);
    if (g) g.items.push(p.label);
    else groups.push({ group: p.group, items: [p.label] });
  }
  const totalPack = essentials.packing.length;
  const donePack = essentials.packing.filter((p) => packed[`${p.group}|${p.label}`]).length;
  const fx = essentials.currency;

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {/* ------------------------------------------------------- weather */}
      <Panel
        title="Weather"
        sub={
          essentials.isForecast
            ? "Live forecast for your dates"
            : "Climate normals — your dates are beyond any forecast window"
        }
      >
        <div className="mb-2.5">
          {essentials.isForecast ? (
            <Tag kind="good">live forecast</Tag>
          ) : (
            <Tag kind="warn">climate normals</Tag>
          )}
        </div>
        {essentials.weather.length ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {essentials.weather.map((w) => (
              <div
                key={w.date}
                className="shrink-0 px-2.5 py-2 text-center"
                style={{
                  minWidth: 64,
                  borderRadius: 12,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                }}
                title={`${w.summary} · ${w.rainChance}% rain`}
              >
                <div className="text-[11px]" style={{ color: "var(--text-2)" }}>
                  {weekday(w.date)}
                </div>
                <div className="text-[18px]" aria-hidden>
                  {weatherEmoji(w.summary, w.rainChance)}
                </div>
                <div className="text-[13px]" style={{ fontWeight: 620 }}>
                  {Math.round(w.tempC)}°
                </div>
                <div className="text-[10.5px]" style={{ color: "var(--text-3)" }}>
                  {w.rainChance}%
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px]" style={{ color: "var(--text-2)" }}>
            No weather yet — I need the dates first.
          </p>
        )}
      </Panel>

      {/* ------------------------------------------------------- packing */}
      <Panel title="Packing" sub={totalPack ? `${donePack} of ${totalPack} packed` : undefined}>
        {groups.length ? (
          <div className="grid gap-3">
            {groups.map((g) => (
              <div key={g.group}>
                <h4
                  className="mb-1.5 text-[11px] font-semibold uppercase"
                  style={{ letterSpacing: "0.06em", color: "var(--text-3)" }}
                >
                  {g.group}
                </h4>
                <div className="grid gap-1.5">
                  {g.items.map((label) => {
                    const key = `${g.group}|${label}`;
                    const on = !!packed[key];
                    return (
                      <label key={key} className="flex items-start gap-2.5 text-[13px]">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => onToggle(key)}
                          style={{ accentColor: "var(--accent)", width: 16, height: 16, marginTop: 2 }}
                        />
                        <span
                          style={{
                            textDecoration: on ? "line-through" : "none",
                            color: on ? "var(--text-3)" : "var(--text-1)",
                          }}
                        >
                          {label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px]" style={{ color: "var(--text-2)" }}>
            The list builds itself from the weather and who is coming.
          </p>
        )}
      </Panel>

      {/* --------------------------------------------------------- money */}
      <Panel title="Money" sub={fx ? `${fx.from} → ${fx.to}` : undefined}>
        {fx ? (
          <>
            <div className="text-[17px]" style={{ fontWeight: 680 }}>
              1 {fx.to} = ₹{fx.rate.toFixed(2)}
            </div>
            <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-2)" }}>
              {fx.note}
            </p>
            <p className="mt-1.5 text-[11px]" style={{ color: "var(--text-3)" }}>
              Rate taken {ago(fx.asOf)}
            </p>
          </>
        ) : (
          <p className="text-[12.5px]" style={{ color: "var(--text-2)" }}>
            No exchange rate yet.
          </p>
        )}
      </Panel>

      {/* -------------------------------------------------- connectivity */}
      <Panel title="Connectivity" sub="Cheapest first — roaming is almost never it">
        {essentials.connectivity.length ? (
          <div className="grid gap-0.5">
            {essentials.connectivity.map((c) => (
              <div
                key={c.label}
                className="flex items-center gap-3 py-2"
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <span className="min-w-0 flex-1 text-[13px]">{c.label}</span>
                <span className="shrink-0 text-[13px]" style={{ fontWeight: 620 }}>
                  {inr(c.price)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px]" style={{ color: "var(--text-2)" }}>
            Nothing to compare yet.
          </p>
        )}
      </Panel>

      {/* ----------------------------------------------------- emergency */}
      <Panel title="Emergency" sub="Save these to your phone before you fly">
        {essentials.emergency.length ? (
          <div className="grid gap-0.5">
            {essentials.emergency.map((e) => (
              <div
                key={`${e.label}-${e.value}`}
                className="flex items-center gap-3 py-2"
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <span className="min-w-0 flex-1 text-[13px]" style={{ color: "var(--text-2)" }}>
                  {e.label}
                </span>
                <span className="shrink-0 text-[13px]" style={{ fontWeight: 620 }}>
                  {e.value}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px]" style={{ color: "var(--text-2)" }}>
            No local numbers yet.
          </p>
        )}
      </Panel>

      {/* ---------------------------------------------------------- tips */}
      <Panel title="Things only a local would tell you" sub="The stuff guidebooks leave out">
        {essentials.tips.length ? (
          <ul className="grid gap-2 pl-5 text-[13px]">
            {essentials.tips.map((t) => (
              <li key={t} style={{ color: "var(--text-1)" }}>
                {t}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px]" style={{ color: "var(--text-2)" }}>
            Pick a destination and I will tell you what I know.
          </p>
        )}
      </Panel>
    </div>
  );
}
