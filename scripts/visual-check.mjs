#!/usr/bin/env node
/**
 * Responsive audit. Drives the real pages in headless Chrome at a range of
 * widths, measures horizontal overflow, and names the exact elements that are
 * wider than the viewport.
 *
 *   npm run visual        # audit only
 *   npm run visual -- --shots   # also write PNGs to .visual/
 *
 * Uses the Chrome already installed on the machine; no browser download.
 */

import { existsSync, mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.argv.includes("--shots");
const OUT = ".visual";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && existsSync(p));

const WIDTHS = [
  { w: 1920, h: 1080, name: "desktop-wide" },
  { w: 1440, h: 900, name: "desktop" },
  { w: 1280, h: 800, name: "laptop" },
  { w: 1024, h: 768, name: "tablet-landscape" },
  { w: 768, h: 1024, name: "tablet" },
  { w: 430, h: 932, name: "phone-large" },
  { w: 390, h: 844, name: "phone" },
  { w: 320, h: 640, name: "phone-small" },
];

const c = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  d: (s) => `\x1b[90m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

if (!CHROME) {
  console.log(c.r("No Chrome/Edge found. Install one, or set it in scripts/visual-check.mjs.\n"));
  process.exit(1);
}
if (SHOTS && !existsSync(OUT)) mkdirSync(OUT, { recursive: true });

/** Runs in the page: find anything sticking out past the viewport. */
function auditInPage() {
  const docW = document.documentElement.clientWidth;
  const offenders = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const over = Math.round(r.right - docW);
    if (over > 1) {
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" && cs.visibility === "hidden") continue;
      offenders.push({
        over,
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute("class") ?? "").slice(0, 70),
        text: (el.textContent ?? "").trim().slice(0, 48),
      });
    }
  }
  offenders.sort((a, b) => b.over - a.over);
  return {
    scrollW: document.documentElement.scrollWidth,
    clientW: docW,
    bodyScrollW: document.body.scrollWidth,
    offenders: offenders.slice(0, 6),
  };
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();

  /* sign in once */
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 60_000 });
  const res = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@journeyos.local", password: "Admin@12345" }),
    });
    return r.status;
  }, BASE);
  if (res !== 200) {
    console.log(c.y(`\nCould not sign in (HTTP ${res}) — the login limiter may be cooling down.`));
    console.log(c.d("Public pages will still be audited.\n"));
  }

  /* newest trip, for the workspace */
  let tripId = null;
  try {
    tripId = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/api/trips?limit=1`);
      if (!r.ok) return null;
      const j = await r.json();
      return j.data?.[0]?.id ?? null;
    }, BASE);
  } catch { /* ignore */ }

  const targets = [
    { path: "/", label: "landing" },
    { path: "/login", label: "login" },
    { path: "/signup", label: "signup" },
    { path: "/dashboard", label: "dashboard" },
    ...(tripId ? [{ path: `/trips/${tripId}`, label: "workspace" }] : []),
    { path: "/admin", label: "admin" },
  ];

  let problems = 0;
  for (const t of targets) {
    console.log(`\n${c.b(t.label)} ${c.d(t.path)}`);
    for (const vp of WIDTHS) {
      await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
      await page.goto(BASE + t.path, { waitUntil: "networkidle2", timeout: 60_000 });
      await new Promise((r) => setTimeout(r, 450));

      const a = await page.evaluate(auditInPage);
      const overflow = a.scrollW - a.clientW;

      if (overflow > 1) {
        problems++;
        console.log(`  ${c.r("OVERFLOW")} ${String(vp.w).padStart(4)}px  ${c.r(`+${overflow}px`)} ${c.d(`(scrollW ${a.scrollW} vs ${a.clientW})`)}`);
        for (const o of a.offenders) {
          console.log(c.d(`           +${o.over}px  <${o.tag} class="${o.cls}">  "${o.text}"`));
        }
      } else {
        console.log(`  ${c.g("ok      ")} ${String(vp.w).padStart(4)}px`);
      }

      if (SHOTS) {
        await page.screenshot({ path: `${OUT}/${t.label}-${vp.w}.png`, fullPage: false });
      }
    }
  }

  console.log(`\n${"=".repeat(46)}`);
  console.log(problems ? c.r(`${problems} viewport(s) overflow horizontally`) : c.g("No horizontal overflow at any width"));
  if (SHOTS) console.log(c.d(`screenshots in ./${OUT}/`));
  console.log("");
  process.exit(problems ? 1 : 0);
} finally {
  await browser.close();
}
