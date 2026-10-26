// Drives the splash in headless Chromium and writes frames + assertions to docs/evidence/splash.
// Usage: BASE_URL=http://localhost:3000 node e2e/splash-evidence.mjs
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = path.resolve(import.meta.dirname, "../../../docs/evidence/splash");
fs.mkdirSync(OUT, { recursive: true });
const SEEK = [0, 150, 300, 500, 850];

const probe = () => {
  window.__cls = 0;
  window.__props = new Set();
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
  }).observe({ type: "layout-shift", buffered: true });
  const tick = () => {
    const el = document.querySelector("[data-af-splash-logo]");
    if (el && getComputedStyle(el.closest("[data-testid=splash]")).display !== "none") {
      const r = el.getBoundingClientRect();
      window.__lastSplashRect = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    for (const a of document.getAnimations())
      for (const k of a.effect?.getKeyframes?.() ?? [])
        for (const p of Object.keys(k)) if (!["offset", "easing", "composite", "computedOffset"].includes(p)) window.__props.add(p);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function run(name, ctxOpts) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...ctxOpts, recordVideo: { dir: OUT, size: ctxOpts.viewport } });
  await ctx.addInitScript(probe);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "commit" });
  // Headless screenshots stall the page clock, so wall-clock frames are unreliable.
  // Instead: capture the hold state, then pause the WAAPI timeline and seek it to exact offsets.
  await page.waitForSelector("[data-testid=splash]", { state: "attached" });
  const frames = [];
  const shot = async (label) => {
    const f = path.join(OUT, `${name}-${label}.png`);
    await page.screenshot({ path: f, animations: "allow" });
    frames.push(f);
  };
  await shot("hold");
  await page.waitForFunction(() => document.getAnimations().length > 0, null, { timeout: 5000 });
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  for (const t of SEEK) {
    await page.evaluate((ms) => document.getAnimations().forEach((a) => (a.currentTime = ms)), t);
    await shot(`${String(t).padStart(4, "0")}ms`);
  }
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const h = document.querySelector("[data-af-header-logo]").getBoundingClientRect();
    return {
      cls: window.__cls,
      animatedProps: [...window.__props],
      splashEnd: window.__lastSplashRect ?? null,
      header: { x: h.x, y: h.y, w: h.width, h: h.height },
      htmlClass: document.documentElement.className.includes("af-splash"),
      seen: sessionStorage.getItem("af:splash-seen"),
    };
  });
  // Second visit in the same session (tab reload): splash must not show.
  await page.reload({ waitUntil: "commit" });
  await page.waitForTimeout(50);
  const second = await page.evaluate(() => ({
    overlayVisible: [...document.querySelectorAll("[data-testid=splash]")].some((e) => getComputedStyle(e).display !== "none"),
    pageOpacity: getComputedStyle(document.querySelector("main")).opacity,
  }));
  await page.screenshot({ path: path.join(OUT, `${name}-second-visit.png`) });
  const video = await page.video().path();
  await ctx.close();
  await browser.close();
  fs.renameSync(video, path.join(OUT, `${name}.webm`));
  return { name, frames, ...r, second };
}

const results = [];
results.push(await run("desktop", { viewport: { width: 1280, height: 800 } }));
results.push(await run("mobile", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }));
results.push(await run("reduced-motion", { viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" }));

let ok = true;
const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) ok = false; };
for (const r of results) {
  check(r.cls === 0, `${r.name}: CLS = ${r.cls}`);
  check(r.animatedProps.every((p) => p === "transform" || p === "opacity"), `${r.name}: animated props = [${r.animatedProps}]`);
  check(r.seen === "1" && !r.htmlClass, `${r.name}: session flag set, splash class removed`);
  check(!r.second.overlayVisible && r.second.pageOpacity === "1", `${r.name}: second visit shows no splash`);
  if (r.name === "reduced-motion") {
    check(!r.animatedProps.includes("transform"), `${r.name}: no transform animation`);
  } else {
    const d = r.splashEnd && Math.max(...["x", "y", "w", "h"].map((k) => Math.abs(r.splashEnd[k] - r.header[k])));
    check(d !== null && d < 0.5, `${r.name}: splash logo end box ${JSON.stringify(r.splashEnd)} vs header ${JSON.stringify(r.header)} (max diff ${d?.toFixed(3)}px)`);
  }
}
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results.map(({ frames, ...r }) => r), null, 2));
process.exit(ok ? 0 : 1);
