"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Composer, TopBar } from "@/components/ui";

/** The hero prompt is parked here and replayed by the dashboard after signup. */
const PENDING_KEY = "jos-pending-prompt";

const SUGGESTIONS = [
  "Plan a 7-day London vacation for me, my wife and two kids",
  "5 days in Dubai with the kids",
  "A week in Singapore, food and gardens",
  "Do I need a visa for Thailand?",
  "Weekend in Goa under ₹30,000",
  "Is my passport still valid for Europe in June?",
];

const FEATURES = [
  {
    icon: "💬",
    title: "It asks, then it builds",
    body: "Dates, budget, who is coming — it asks the few things it genuinely needs, then writes the plan. No forty-field form.",
  },
  {
    icon: "🛡",
    title: "It catches what ruins trips",
    body: "Visa windows, passport validity, monsoon weeks, museums shut on Tuesdays. Flagged before you book, not after.",
  },
  {
    icon: "🗺",
    title: "Plans that are possible",
    body: "Every day is checked against real travel times and opening hours, so the itinerary survives contact with the pavement.",
  },
];

interface Tier {
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  perks: string[];
  cta: string;
  popular?: boolean;
}

const TIERS: Tier[] = [
  {
    name: "Free",
    price: "$0",
    cadence: "forever",
    blurb: "Enough to plan your next trip end to end.",
    perks: ["2 active trips", "Full itinerary builder", "Visa and weather checks", "Packing list"],
    cta: "Start free",
  },
  {
    name: "Explorer",
    price: "$9",
    cadence: "per month",
    blurb: "For people who travel more than once a year.",
    perks: [
      "Unlimited trips",
      "Budget tracking in ₹ or $",
      "PDF export and share links",
      "Priority planning queue",
    ],
    cta: "Get Explorer",
    popular: true,
  },
  {
    name: "Concierge",
    price: "$29",
    cadence: "per month",
    blurb: "When the trip cannot go wrong.",
    perks: [
      "Everything in Explorer",
      "Live re-planning when flights move",
      "Group trips with shared edits",
      "Escalate to a human",
    ],
    cta: "Get Concierge",
  },
];

export default function Landing() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");

  /** Park the prompt, then send the visitor to signup. The dashboard replays it. */
  const handoff = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      sessionStorage.setItem(PENDING_KEY, trimmed);
    } catch {
      /* private mode — the prompt simply is not carried over */
    }
    router.push("/signup");
  };

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar
        right={
          <div className="flex items-center gap-1.5">
            <Link href="/login" className="btn btn-sm btn-ghost">
              Log in
            </Link>
            <Link href="/signup" className="btn btn-sm btn-primary">
              Get started
            </Link>
          </div>
        }
      />

      <main className="flex-1">
        {/* ------------------------------------------------------------- hero */}
        <section className="mx-auto w-full max-w-6xl px-5 pt-14 pb-16 sm:px-6 sm:pt-20 lg:pt-28">
          <div className="fade-up mx-auto max-w-3xl text-center">
            <p
              className="inline-flex min-h-8 items-center gap-2 rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium"
              style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-2)" }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--good)", boxShadow: "0 0 0 3px var(--good-soft)" }}
                aria-hidden
              />
              Your AI Travel Operating System
            </p>

            <h1 className="mt-6 text-[2.15rem] leading-[1.1] font-semibold tracking-[-0.03em] sm:text-5xl lg:text-[3.5rem]">
              Describe the trip.
              <br className="hidden sm:block" /> Get the <span className="grad-text">whole plan</span>.
            </h1>

            <p
              className="mx-auto mt-5 max-w-xl text-[15.5px] leading-relaxed sm:text-base"
              style={{ color: "var(--text-2)" }}
            >
              One sentence in. Out comes a day-by-day itinerary, flights and stays, a budget that adds up, the visa
              rules that apply to you, and a packing list for the weather you will actually get.
            </p>
          </div>

          <div className="fade-up mx-auto mt-9 max-w-2xl">
            <Composer
              value={prompt}
              onChange={setPrompt}
              onSubmit={() => handoff(prompt)}
              placeholder="Plan a 10-day trip to Japan in April for two, mid-range budget…"
            />

            <div className="mt-5" role="group" aria-labelledby="jos-suggest-label">
              <p
                id="jos-suggest-label"
                className="mb-2.5 text-center text-[12.5px] font-medium"
                style={{ color: "var(--text-3)" }}
              >
                Or start from one of these
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="chip min-h-11" onClick={() => handoff(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <p className="mt-6 text-center text-[12.5px]" style={{ color: "var(--text-3)" }}>
              No credit card. Your draft is waiting on the other side of signup.
            </p>
          </div>
        </section>

        {/* --------------------------------------------------------- features */}
        <section className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-6">
          <div className="grid gap-5 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="glass fade-up p-6">
                <span
                  className="grid h-11 w-11 place-items-center rounded-[14px] text-[20px]"
                  style={{ background: "var(--accent-soft)" }}
                  aria-hidden
                >
                  {f.icon}
                </span>
                <h3 className="mt-4 text-[16.5px] font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--text-2)" }}>
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------- pricing */}
        <section className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-6" aria-labelledby="jos-pricing-title">
          <div className="mx-auto mb-10 max-w-xl text-center">
            <h2 id="jos-pricing-title" className="text-[1.75rem] font-semibold tracking-[-0.025em] sm:text-4xl">
              Plans for how often you go
            </h2>
            <p className="mt-3 text-[14.5px]" style={{ color: "var(--text-2)" }}>
              Start free. Move up when a trip is worth it. Cancel whenever.
            </p>
          </div>

          <div className="grid items-start gap-5 lg:grid-cols-3">
            {TIERS.map((t) => (
              <div key={t.name} className={`glass fade-up relative p-6${t.popular ? " card-accent lg:-mt-3" : ""}`}>
                {t.popular && (
                  <span
                    className="tag absolute -top-3 left-6"
                    style={{ background: "var(--accent)", color: "var(--bg)", borderColor: "transparent" }}
                  >
                    Most popular
                  </span>
                )}

                <h3 className="text-[15px] font-semibold tracking-tight">{t.name}</h3>
                <p className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-[2.1rem] font-semibold tracking-[-0.03em]">{t.price}</span>
                  <span className="text-[13px]" style={{ color: "var(--text-3)" }}>
                    {t.cadence}
                  </span>
                </p>
                <p className="mt-2 text-[13.5px]" style={{ color: "var(--text-2)" }}>
                  {t.blurb}
                </p>

                <ul className="mt-5 grid gap-2.5 text-[13.5px]">
                  {t.perks.map((p) => (
                    <li key={p} className="flex items-start gap-2.5">
                      <span style={{ color: "var(--good)" }} aria-hidden>
                        ✓
                      </span>
                      <span style={{ color: "var(--text-2)" }}>{p}</span>
                    </li>
                  ))}
                </ul>

                <Link href="/signup" className={`btn mt-6 w-full${t.popular ? " btn-primary" : ""}`}>
                  {t.cta}
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* -------------------------------------------------------- final cta */}
        <section className="mx-auto w-full max-w-6xl px-5 pt-6 pb-20 sm:px-6">
          <div className="glass flex flex-col items-center gap-5 p-8 text-center lg:flex-row lg:justify-between lg:p-10 lg:text-left">
            <div>
              <h2 className="text-[1.5rem] font-semibold tracking-[-0.025em] sm:text-[1.9rem]">
                Your next trip is one sentence away
              </h2>
              <p className="mt-2 text-[14.5px]" style={{ color: "var(--text-2)" }}>
                Tell JourneyOS where you are headed. It handles the rest.
              </p>
            </div>
            <Link href="/signup" className="btn btn-primary w-full lg:w-auto">
              Get started free
            </Link>
          </div>
        </section>
      </main>

      <footer
        className="border-t px-5 py-8 text-center text-[12.5px] sm:px-6"
        style={{ borderColor: "var(--border)", color: "var(--text-3)" }}
      >
        JourneyOS — plans you can actually take. Built for the trip, not the brochure.
      </footer>
    </div>
  );
}
