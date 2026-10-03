"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand, ErrorNote, ThemeToggle } from "@/components/ui";

const PENDING_KEY = "jos-pending-prompt";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type FieldKey = "fullName" | "email" | "password";
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

/* sessionStorage is an external store, so it is read the way React wants it read:
   false on the server, the real value once hydration is past. */
const subscribeNever = () => () => {};
const readPending = () => {
  try {
    return Boolean(sessionStorage.getItem(PENDING_KEY));
  } catch {
    return false; // private mode
  }
};
const noPendingOnServer = () => false;

export default function SignupPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const hasPending = useSyncExternalStore(subscribeNever, readPending, noPendingOnServer);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (fullName.trim().length < 2) next.fullName = "Enter your full name.";
    if (!EMAIL_RE.test(email.trim())) next.email = "Enter a valid email address.";
    if (password.length < 10) next.password = "Use at least 10 characters.";
    return next;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setFormError(null);
    const problems = validate();
    setFieldErrors(problems);

    // Send focus to the first field that needs attention.
    const order: Array<[FieldKey, React.RefObject<HTMLInputElement | null>]> = [
      ["fullName", nameRef],
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
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          fullName: fullName.trim(),
        }),
      });

      if (res.ok) {
        router.push("/dashboard");
        router.refresh();
        return; // stay disabled while the navigation happens
      }

      const json: unknown = await res.json().catch(() => null);
      setFormError(serverMessage(json, "We could not create that account. Please try again."));
      setSubmitting(false);
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  };

  const describe = (key: FieldKey, ...extra: string[]) => {
    const ids = [...extra];
    if (fieldErrors[key]) ids.push(`signup-${key}-error`);
    return ids.length ? ids.join(" ") : undefined;
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-3 px-5 py-4 sm:px-6">
        <Brand />
        <div className="flex-1" />
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-6">
        <div className="fade-up w-full max-w-[424px]">
          <div className="glass p-7 sm:p-8">
            <h1 className="text-[1.6rem] font-semibold tracking-[-0.025em]">Create your account</h1>
            <p className="mt-2 text-[13.5px]" style={{ color: "var(--text-2)" }}>
              Free to start. No card, no sales call.
            </p>

            {hasPending && (
              <p
                className="mt-4 rounded-xl border px-3.5 py-2.5 text-[12.5px]"
                style={{
                  background: "var(--accent-soft)",
                  borderColor: "var(--accent)",
                  color: "var(--text-2)",
                }}
              >
                Your trip idea is saved — JourneyOS picks it up the moment you are in.
              </p>
            )}

            <form className="mt-6 grid gap-4" onSubmit={submit} noValidate>
              <div>
                <label className="field-label" htmlFor="signup-fullName">
                  Full name
                </label>
                <input
                  id="signup-fullName"
                  ref={nameRef}
                  className="field-input"
                  type="text"
                  name="name"
                  autoComplete="name"
                  placeholder="Priya Raghavan"
                  value={fullName}
                  disabled={submitting}
                  aria-invalid={Boolean(fieldErrors.fullName)}
                  aria-describedby={describe("fullName")}
                  onChange={(e) => setFullName(e.target.value)}
                />
                {fieldErrors.fullName && (
                  <p id="signup-fullName-error" className="mt-1.5 text-[12.5px]" style={{ color: "var(--crit)" }}>
                    {fieldErrors.fullName}
                  </p>
                )}
              </div>

              <div>
                <label className="field-label" htmlFor="signup-email">
                  Email
                </label>
                <input
                  id="signup-email"
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
                  aria-describedby={describe("email")}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {fieldErrors.email && (
                  <p id="signup-email-error" className="mt-1.5 text-[12.5px]" style={{ color: "var(--crit)" }}>
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              <div>
                <label className="field-label" htmlFor="signup-password">
                  Password
                </label>
                <input
                  id="signup-password"
                  ref={passwordRef}
                  className="field-input"
                  type="password"
                  name="new-password"
                  autoComplete="new-password"
                  minLength={10}
                  placeholder="At least 10 characters"
                  value={password}
                  disabled={submitting}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={describe("password", "signup-password-hint")}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {fieldErrors.password ? (
                  <p id="signup-password-error" className="mt-1.5 text-[12.5px]" style={{ color: "var(--crit)" }}>
                    {fieldErrors.password}
                  </p>
                ) : (
                  <p id="signup-password-hint" className="mt-1.5 text-[12.5px]" style={{ color: "var(--text-3)" }}>
                    At least 10 characters. A short phrase beats a clever word.
                  </p>
                )}
              </div>

              {formError && <ErrorNote>{formError}</ErrorNote>}

              <button type="submit" className="btn btn-primary mt-1 w-full" disabled={submitting}>
                {submitting ? "Creating account…" : "Create account"}
              </button>
            </form>
          </div>

          <p className="mt-5 text-center text-[13.5px]" style={{ color: "var(--text-2)" }}>
            Already have an account?{" "}
            <Link href="/login" className="font-medium underline" style={{ color: "var(--accent-to)" }}>
              Log in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
