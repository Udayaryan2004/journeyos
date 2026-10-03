"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";

/* The Web Speech API is not in lib.dom, so declare the slice we actually use. */
interface SpeechAlternative { transcript: string }
interface SpeechResult { 0: SpeechAlternative; length: number }
interface SpeechResultEvent { results: ArrayLike<SpeechResult> }
interface SpeechErrorEvent { error: string }
interface SpeechRecognizer {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognizerCtor = new () => SpeechRecognizer;

/* ------------------------------------------------------------------- brand */

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 font-semibold tracking-tight">
      <span
        className="grid h-7 w-7 place-items-center rounded-[9px] text-sm font-extrabold"
        style={{
          background: "linear-gradient(135deg, var(--accent-from), var(--accent-to))",
          color: "#0a0b0f",
          boxShadow: "0 6px 18px -6px rgb(139 92 246 / 0.7)",
        }}
      >
        J
      </span>
      <span>
        Journey<span className="grad-text">OS</span>
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------- theme */

/**
 * The inline script in app/layout.tsx has already set data-theme before paint,
 * so the DOM is the source of truth. useSyncExternalStore reads it without a
 * setState-in-effect (which this eslint config rejects) and without a flash.
 */
const themeStore = {
  subscribe(onChange: () => void) {
    const obs = new MutationObserver(onChange);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  },
  get(): "dark" | "light" {
    return (document.documentElement.getAttribute("data-theme") as "dark" | "light") ?? "dark";
  },
  server(): "dark" | "light" {
    return "dark";
  },
};

export function ThemeToggle() {
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.get, themeStore.server);

  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("jos-theme", next); } catch { /* private mode */ }
  };

  return (
    <button className="icon-btn" onClick={flip} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title="Toggle theme">
      <span aria-hidden>{theme === "dark" ? "◐" : "◑"}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ topbar */

export function TopBar({ right, children }: { right?: ReactNode; children?: ReactNode }) {
  return (
    <header
      className="no-print sticky top-0 z-50 flex items-center gap-3 border-b px-4 py-2.5 sm:px-6"
      style={{
        borderColor: "var(--border)",
        background: "color-mix(in srgb, var(--bg) 80%, transparent)",
        backdropFilter: "blur(18px)",
      }}
    >
      <Brand />
      {children}
      <div className="flex-1" />
      {right}
      <ThemeToggle />
    </header>
  );
}

/* ---------------------------------------------------------------- composer */

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
  autoFocus?: boolean;
}

/** Text + voice. Every voice action has a typed equivalent. */
export function Composer({ value, onChange, onSubmit, placeholder, disabled, compact, autoFocus }: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [recording, setRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognition = useRef<SpeechRecognizer | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [value]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const toggleVoice = () => {
    if (recording) {
      recognition.current?.stop();
      setRecording(false);
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognizerCtor;
      webkitSpeechRecognition?: SpeechRecognizerCtor;
    };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      setVoiceError("Voice input needs Chrome or Edge. Typing works everywhere.");
      return;
    }
    const r = new SR();
    r.lang = "en-IN";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e: SpeechResultEvent) => {
      const text = Array.from(e.results).map((x) => x[0].transcript).join("");
      onChange(text);
    };
    r.onerror = (e: SpeechErrorEvent) => {
      setVoiceError(e.error === "not-allowed" ? "Microphone permission denied. Typing still works." : "Voice input failed.");
      setRecording(false);
    };
    r.onend = () => setRecording(false);
    recognition.current = r;
    setVoiceError(null);
    setRecording(true);
    r.start();
  };

  return (
    <div>
      <div className="composer-shell">
        <div className="composer-glow" />
        <div className="composer" style={compact ? { padding: "8px 8px 8px 15px", borderRadius: 14 } : undefined}>
          <textarea
            ref={ref}
            rows={1}
            value={value}
            disabled={disabled}
            placeholder={placeholder ?? "Tell me about the trip…"}
            aria-label="Describe your trip"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!disabled && value.trim()) onSubmit();
              }
            }}
            style={compact ? { fontSize: 14.5, minHeight: 40, padding: "9px 0" } : undefined}
          />
          <button
            type="button"
            className={`icon-btn${recording ? " rec" : ""}`}
            onClick={toggleVoice}
            disabled={disabled}
            aria-label={recording ? "Stop recording" : "Use voice input"}
            title="Voice input"
            style={compact ? { width: 36, height: 36 } : undefined}
          >
            {recording ? <Wave /> : <span aria-hidden>🎙</span>}
          </button>
          <button
            type="button"
            className="send-btn"
            onClick={onSubmit}
            disabled={disabled || !value.trim()}
            aria-label="Send"
            style={compact ? { width: 36, height: 36 } : undefined}
          >
            <span aria-hidden>↗</span>
          </button>
        </div>
      </div>
      {voiceError && (
        <p className="mt-2 text-[12.5px]" style={{ color: "var(--warn)" }} role="status">
          {voiceError}
        </p>
      )}
    </div>
  );
}

function Wave() {
  return (
    <span className="flex h-[18px] items-center gap-[3px]" aria-hidden>
      {[6, 13, 18, 10, 5].map((h, i) => (
        <i
          key={i}
          className="block w-[2.5px] rounded-sm"
          style={{ height: h, background: "currentColor", animation: `tp 0.9s ease-in-out ${i * 0.1}s infinite` }}
        />
      ))}
    </span>
  );
}

/* --------------------------------------------------------------- feedback */

export function Tag({ kind, children }: { kind?: "good" | "warn" | "crit" | "ai"; children: ReactNode }) {
  return <span className={`tag${kind ? ` tag-${kind}` : ""}`}>{children}</span>;
}

export function Empty({ icon, title, body, children }: { icon: string; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-sm py-14 text-center">
      <div className="mb-3.5 text-[34px] opacity-50" aria-hidden>{icon}</div>
      <h4 className="mb-1.5 text-base font-semibold">{title}</h4>
      <p className="text-[13.5px]" style={{ color: "var(--text-2)" }}>{body}</p>
      {children}
    </div>
  );
}

export function Skeletons({ n = 3, height = 72 }: { n?: number; height?: number }) {
  return (
    <div className="grid gap-2.5" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skel" style={{ height }} />
      ))}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-start gap-3 rounded-xl border px-4 py-3 text-sm"
      style={{ background: "var(--crit-soft)", borderColor: "rgb(248 113 113 / 0.3)" }}
      role="alert"
    >
      <span aria-hidden>⚠️</span>
      <span>{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ format */

export const inr = (n: number | null | undefined) =>
  n == null ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;

export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "—";

export const weekday = (iso: string | null | undefined) =>
  iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }) : "";
