"use client";

import { Suspense, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Brand, ErrorNote, ThemeToggle } from "@/components/ui";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type FieldKey = "email" | "password";
type FieldErrors = Partial<Record<FieldKey, string>>;

/** Pull the documented error envelope: { error: { code, message, requestId } }. */
function serverMessage(json: unknown, fallback: string): string {
  if (json && typeof json === "object" && "error" in json) {
    const err = (json as { error?: unknown }).error;
    if (err && typeof err === "object" && "message" in err) {
      const msg = (err as { message?: unknown }).message;
      if (typeof msg === "string" && msg.trim()) return msg;
    }
  }
  return fallback;
}

/** Only ever bounce back to a path on this origin. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/dashboard";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/dashboard";
  return raw;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-3 px-5 py-4 sm:px-6">
        <Brand />
        <div className="flex-1" />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-6">{children}</main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Shell>
      <Suspense fallback={<div className="skel h-[420px] w-full max-w-[424px]" aria-hidden />}>
        <LoginCard />
      </Suspense>
    </Shell>
  );
}

function LoginCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const destination = safeNext(searchParams.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setFormError(null);
    const problems: FieldErrors = {};
    if (!EMAIL_RE.test(email.trim())) problems.email = "Enter a valid email address.";
    if (!password) problems.password = "Enter your password.";
    setFieldErrors(problems);

    const order: Array<[FieldKey, React.RefObject<HTMLInputElement | null>]> = [
      ["email", emailRef],
      ["password", passwordRef],
    ];
    const firstBad = order.find(([key]) => problems[key]);
    if (firstBad) {
      firstBad[1].current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      if (res.ok) {
        router.push(destination);
        router.refresh();
        return; // stay disabled while the navigation happens
      }

      const json: unknown = await res.json().catch(() => null);
      setFormError(serverMessage(json, "Email or password is incorrect."));
      setSubmitting(false);
      passwordRef.current?.focus();
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fade-up w-full max-w-[424px]">
      <div className="glass p-7 sm:p-8">
        <h1 className="text-[1.6rem] font-semibold tracking-[-0.025em]">Welcome back</h1>
        <p className="mt-2 text-[13.5px]" style={{ color: "var(--text-2)" }}>
          Log in to pick your trips up where you left them.
        </p>

        <form className="mt-6 grid gap-4" onSubmit={submit} noValidate>
          <div>
            <label className="field-label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              ref={emailRef}
              className="field-input"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              disabled={submitting}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
              onChange={(e) => setEmail(e.target.value)}
            />
            {fieldErrors.email && (
              <p id="login-email-error" className="mt-1.5 text-[12.5px]" style={{ color: "var(--crit)" }}>
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <label className="field-label" htmlFor="login-password">
                Password
              </label>
              <Link
                href="/reset"
                className="mb-1.5 text-[12.5px] font-medium underline"
                style={{ color: "var(--accent-to)" }}
              >
                Forgot password?
              </Link>
            </div>
            <input
              id="login-password"
              ref={passwordRef}
              className="field-input"
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              disabled={submitting}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
            {fieldErrors.password && (
              <p id="login-password-error" className="mt-1.5 text-[12.5px]" style={{ color: "var(--crit)" }}>
                {fieldErrors.password}
              </p>
            )}
          </div>

          {formError && <ErrorNote>{formError}</ErrorNote>}

          <button type="submit" className="btn btn-primary mt-1 w-full" disabled={submitting}>
            {submitting ? "Logging in…" : "Log in"}
          </button>
        </form>

        <div
          className="mt-5 rounded-xl border px-3.5 py-2.5 text-[12.5px]"
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-3)" }}
        >
          Demo admin — admin@journeyos.local / Admin@12345
        </div>
      </div>

      <p className="mt-5 text-center text-[13.5px]" style={{ color: "var(--text-2)" }}>
        New to JourneyOS?{" "}
        <Link href="/signup" className="font-medium underline" style={{ color: "var(--accent-to)" }}>
          Create an account
        </Link>
      </p>
    </div>
  );
}
