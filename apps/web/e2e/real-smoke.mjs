// Real-mode smoke (fresh context, no storage). Needs a real-mode build on :3200:
//   NEXT_PUBLIC_API_MODE=real pnpm build && NEXT_PUBLIC_API_MODE=real pnpm exec next start -p 3200
// Usage: BROWSER=chromium|webkit [BASE_URL=http://localhost:3200] [API_URL=http://localhost:4000] node e2e/real-smoke.mjs
// Uses a bogus credential only; never signs in. "API down" is simulated by aborting API requests.
import { chromium, webkit } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const API = process.env.API_URL ?? 'http://localhost:4000';
const BROWSER = process.env.BROWSER ?? 'chromium';
const browser = await { chromium, webkit }[BROWSER].launch();
let ok = true;
const check = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'} [${BROWSER}] ${m}`);
  if (!c) ok = false;
};

for (const apiDown of [false, true]) {
  const tag = apiDown ? 'API down' : 'API up';
  const ctx = await browser.newContext();
  if (apiDown) await ctx.route(`${API}/**`, (r) => r.abort('connectionrefused'));
  const page = await ctx.newPage();
  const bad = [];
  page.on('pageerror', (e) => bad.push(`pageerror: ${e.message}`));
  page.on('response', (r) => r.url().startsWith(BASE) && r.status() >= 500 && bad.push(`${r.status()} ${r.url()}`));
  let navs = 0;
  page.on('framenavigated', (f) => f === page.mainFrame() && navs++);

  await page.goto(`${BASE}/doctors`, { waitUntil: 'load' });
  await page.waitForURL(/\/sign-in/, { timeout: 10000 }).catch(() => {});
  check(/\/sign-in\?next=%2Fdoctors/.test(page.url()), `${tag}: protected page → sign-in (${new URL(page.url()).pathname})`);
  await page.waitForTimeout(4500);
  check(navs <= 3, `${tag}: no redirect loop (${navs} navigations)`);
  const splash = await page.evaluate(() => document.documentElement.classList.contains('af-splash'));
  check(!splash, `${tag}: splash gone within 4.5s`);
  const hydrated = await page.evaluate(() => {
    const f = document.querySelector('form');
    return !!f && Object.keys(f).some((k) => k.startsWith('__react'));
  });
  check(hydrated, `${tag}: sign-in form hydrated`);
  const sw = await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations?.())?.length ?? 0);
  check(sw === 0, `${tag}: no service worker (MSW) registered`);
  { const m = (await page.locator('body').innerText()).match(/.{0,40}(demo account|mock\w*).{0,40}/i); check(!m, `${tag}: no mock/demo text${m ? ' (found "' + m[0] + '")' : ''}`); }

  await page.getByLabel(/email/i).fill('nobody@example.invalid');
  await page.getByRole('textbox', { name: 'Password' }).fill('not-a-real-password');
  const t0 = Date.now();
  await page.getByRole('button', { name: /sign in/i }).click();
  const msg = page.getByText(apiDown ? /could not reach the server/i : /email or password is wrong/i);
  const shown = await msg.first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  check(shown, `${tag}: bogus sign-in shows an error (${Date.now() - t0}ms)`);
  check(/\/sign-in/.test(page.url()), `${tag}: stays on sign-in`);
  check(bad.length === 0, `${tag}: no page errors or 5xx${bad.length ? ': ' + bad.join(' | ') : ''}`);
  await ctx.close();
}
// The original bug: JS chunks fail to load (500). The splash must still clear and show the page.
{
  const ctx = await browser.newContext();
  await ctx.route(`${BASE}/_next/static/chunks/**`, (r) => r.fulfill({ status: 500, body: '' }));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'load' });
  await page.waitForTimeout(4500);
  const st = await page.evaluate(() => ({
    splash: document.documentElement.classList.contains('af-splash'),
    overlay: (() => { const o = document.querySelector('.af-splash-overlay'); return o ? getComputedStyle(o).visibility : 'none'; })(),
  }));
  check(!st.splash || st.overlay === 'hidden', `chunks failing: splash still clears (class ${st.splash}, overlay ${st.overlay})`);
  await ctx.close();
}
await browser.close();
process.exit(ok ? 0 : 1);
