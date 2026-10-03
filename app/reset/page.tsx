"use client";

import { Suspense, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Brand, ErrorNote, ThemeToggle } from "@/components/ui";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The same line is shown whether or not the address exists. */
const SENT_MESSAGE = "If that email is registered, a reset link is on its way.";

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

/** No mail provider is wired up, so development returns the link inline. */
function devLinkOf(json: unknown): string | null {
  if (json && typeof json === "object" && "devLink" in json) {
    const link = (json as { devLink?: unknown }).devLink;
    if (typeof link === "string" && link.trim()) return link;
  }
  return null;
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

export default function ResetPage() {
  return (
    <Shell>
      <Suspense fallback={<div className="skel h-[320px] w-full max-w-[424px]" aria-hidden />}>
        <ResetCard />
      </Suspense>
    </Shell>
  );
}

function ResetCard() {
  const token = useSearchParams().get("token");
  return token ? <ChooseNewPassword token={token} /> : <RequestLink />;
}

/* ------------------------------------------------------- mode A: no token */

function RequestLink() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  const emailRef = useRef<HTMLInputElement>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setFormError(null);
    if (!EMAIL_RE.test(email.trim())) {
      setFieldError("Enter a valid email address.");
      emailRef.current?.focus();
      return;
    }
    setFieldError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const json: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setFormError(serverMessage(json, "Could not send the reset link. Please try again."));
        setSubmitting(false);
        return;
      }

      setDevLink(devLinkOf(json));
      setSent(true);
      setSubmitting(false);
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div className="fade-up w-full max-w-[424px]">
        <div className="glass p-7 sm:p-8">
          <span
            className="grid h-11 w-11 place-items-center rounded-[14px] text-[20px]"
            style={{ background: "var(--good-soft)" }}
            aria-hidden
          >
            ✉️
          </span>
          <h1 className="mt-4 text-[1.4rem] font-semibold tracking-[-0.025em]">Check your inbox</h1>
          <p className="mt-2 text-[13.5px]" style={{ color: "var(--text-2)" }} role="status">
            {SENT_MESSAGE}
          </p>
          <p className="mt-2 text-[12.5px]" style={{ color: "var(--text-3)" }}>
            The link is good for 60 minutes. Look in spam if it has not arrived in a few.
          </p>

          {devLink && (
            <a className="btn mt-5 w-full" href={devLink}>
              Open reset link (development only)
            </a>
          )}

          <Link href="/login" className="btn btn-ghost mt-2 w-full">
            Back to log in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-up w-full max-w-[424px]">
      <div className="glass p-7 sm:p-8">
        <h1 className="text-[1.6rem] font-semibold tracking-[-0.025em]">Reset your password</h1>
        <p className="mt-2 text-[13.5px]" style={{ color: "var(--text-2)" }}>
          Give us the email on your account and we will send a link to set a new password.
        </p>

        <form className="mt-6 grid gap-4" onSubmit={submit} noValidate>
          <div>
            <label className="field-label" htmlFor="reset-email">
              Email
            </label>
            <input
              id="reset-email"
              ref={emailRef}
              className="field-input"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              disabled={submitting}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? "reset-email-error" : undefined}
              onChange={(e) => setEmail(e.target.value)}
            />
            {fieldError && (
              <p id="reset-email-error" className="mt-1.5 text-[12.5px]" style={{ color: "var(--crit)" }}>
                {fieldError}
              </p>
            )}
          </div>

          {formError && <ErrorNote>{formError}</ErrorNote>}

          <button type="submit" className="btn btn-primary mt-1 w-full" disabled={submitting}>
            {submitting ? "Sending link…" : "Send reset link"}
          </button>
        </form>
      </div>

      <p className="mt-5 text-center text-[13.5px]" style={{ color: "var(--text-2)" }}>
        Remembered it?{" "}
        <Link href="/login" className="font-medium underline" style={{ color: "var(--accent-to)" }}>
          Log in
        </Link>
      </p>
    </div>
  );
}

/* ----------------------------------------------------- mode B: with token */

function ChooseNewPassword({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setFormError(null);
    if (password.length < 10) {
      setFieldError("Use at least 10 characters.");
      passwordRef.current?.focus();
      return;
    }
    setFieldError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (res.ok) {
        setDone(true);
        setSubmitting(false);
        return;
      }

      const json: unknown = await res.json().catch(() => null);
      setFormError(serverMessage(json, "That link has expired. Request a new one."));
      setSubmitting(false);
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="fade-up w-full max-w-[424px]">
        <div className="glass p-7 sm:p-8">
          <span
            className="grid h-11 w-11 place-items-center rounded-[14px] text-[20px]"
            style={{ background: "var(--good-soft)" }}
            aria-hidden
          >
            ✓
          </span>
          <h1 className="mt-4 text-[1.4rem] font-semibold tracking-[-0.025em]">Password changed</h1>
          <p className="mt-2 text-[13.5px]" style={{ color: "var(--text-2)" }} role="status">
            Your new password is live. Every other device has been signed out.
          </p>
          <Link href="/login" className="btn btn-primary mt-5 w-full">
            Log in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-up w-full max-w-[424px]">
      <div className="glass p-7 sm:p-8">
        <h1 className="text-[1.6rem] font-semibold tracking-[-0.025em]">Choose a new password</h1>
        <p className="mt-2 text-[13.5px]" style={{ color: "var(--text-2)" }}>
          Setting a new password signs you out everywhere else.
        </p>

        <form className="mt-6 grid gap-4" onSubmit={submit} noValidate>
          <div>
            <label className="field-label" htmlFor="reset-password">
              New password
            </label>
            <input
              id="reset-password"
              ref={passwordRef}
              className="field-input"
              type="password"
              name="new-password"
              autoComplete="new-password"
              minLength={10}
              placeholder="At least 10 characters"
              value={password}
              disabled={submitting}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? "reset-password-error" : "reset-password-hint"}
              onChange={(e) => setPassword(e.target.value)}
            />
            {fieldError ? (
              <p id="reset-password-error" className="mt-1.5 text-[12.5px]" style={{ color: "var(--crit)" }}>
                {fieldError}
              </p>
            ) : (
              <p id="reset-password-hint" className="mt-1.5 text-[12.5px]" style={{ color: "var(--text-3)" }}>
                At least 10 characters. A short phrase beats a clever word.
              </p>
            )}
          </div>

          {formError && <ErrorNote>{formError}</ErrorNote>}

          <button type="submit" className="btn btn-primary mt-1 w-full" disabled={submitting}>
            {submitting ? "Saving password…" : "Save new password"}
          </button>
        </form>
      </div>

      <p className="mt-5 text-center text-[13.5px]" style={{ color: "var(--text-2)" }}>
        Link not working?{" "}
        <Link href="/reset" className="font-medium underline" style={{ color: "var(--accent-to)" }}>
          Request a new one
        </Link>
      </p>
    </div>
  );
}
