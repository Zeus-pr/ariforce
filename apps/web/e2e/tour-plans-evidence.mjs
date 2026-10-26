// Checks + screenshots for attendance (#9) on the real contracts (MSW mock).
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3100 node e2e/tour-plans-evidence.mjs
import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const BROWSER = process.env.BROWSER ?? 'chromium';
const engine = { chromium, webkit }[BROWSER];
const OUT = path.resolve(import.meta.dirname, `../../../docs/evidence/tour-plans${BROWSER === 'chromium' ? '' : '-' + BROWSER}`);
fs.mkdirSync(OUT, { recursive: true });
let ok = true;
const check = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'} [${BROWSER}] ${m}`);
  if (!c) ok = false;
};
const VIEWS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const browser = await engine.launch();
const errors = [];


const session = (s) => JSON.stringify(s);
for (const view of ['desktop', 'mobile']) {
  const ctx = await browser.newContext(VIEWS[view]);
  await ctx.addInitScript((s) => {
    sessionStorage.setItem('af:splash-seen', '1');
    if (!localStorage.getItem('af:mock-session')) localStorage.setItem('af:mock-session', s);
  }, session({ userId: 'mock-director', role: 'director' }));
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${view}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${view}: ${e.message}`));

  await page.goto(`${BASE}/tour-plans`, { waitUntil: 'networkidle' });
  await page.getByTestId('tp-empty').waitFor({ timeout: 15000 });
  check(true, `${view}: month without a plan shows the start state (GET /v1/tour-plans/{month} 404)`);
  await page.screenshot({ path: path.join(OUT, `empty-${view}.png`), fullPage: true });
  await page.getByTestId('tp-start').click();
  await page.getByTestId('tp-calendar').waitFor();
  const days = await page.getByTestId('tp-day').count();
  check(days >= 28 && days <= 31, `${view}: calendar has every date (${days})`);
  check(await page.getByTestId('tp-submit').isDisabled(), `${view}: submit blocked until every date is planned`);
  check(/of \d+ days not planned/.test(await page.getByTestId('tp-missing').textContent()), `${view}: unplanned count shown`);

  await page.getByTestId('tp-day').first().click();
  await page.getByTestId('tp-wt').click();
  await page.getByRole('option', { name: 'Field work' }).click();
  await page.getByTestId('tp-terr').click();
  await page.getByRole('option').first().click();
  await page.getByTestId('tp-save').click();
  await page.getByTestId('tp-editor').waitFor({ state: 'hidden' });
  check((await page.getByTestId('tp-day').first().getAttribute('data-empty')) === 'false', `${view}: day 1 saved via PUT /v1/tour-plans/{month}`);

  await page.getByTestId('tp-fill').click();
  await page.getByTestId('tp-wt').click();
  await page.getByRole('option', { name: 'Meeting' }).click();
  await page.getByTestId('tp-save').click();
  await page.getByTestId('tp-editor').waitFor({ state: 'hidden' });
  check((await page.getByTestId('tp-missing').textContent()) === 'Every day planned', `${view}: bulk fill planned the rest`);
  check(await page.getByTestId('tp-submit').isEnabled(), `${view}: submit enabled`);
  await page.screenshot({ path: path.join(OUT, `planned-${view}.png`), fullPage: true });

  await page.getByTestId('tp-submit').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=tp-status]')?.textContent === 'Waiting for approval', null, { timeout: 10000 });
  check(true, `${view}: submitted (POST /submit)`);
  check(await page.getByTestId('tp-day').first().isDisabled(), `${view}: submitted plan is read-only`);
  const ym = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date());
  const mine = page.getByTestId('tp-approval').filter({ hasText: `Tour plan ${ym}` });
  await mine.waitFor({ timeout: 10000 });
  check(true, `${view}: approver sees the pending approval (GET /v1/approvals)`);
  await page.screenshot({ path: path.join(OUT, `approval-${view}.png`), fullPage: true });
  await mine.getByTestId('tp-approve').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=tp-status]')?.textContent === 'Approved', null, { timeout: 10000 });
  check(true, `${view}: approved via POST /v1/approvals/{id}/decision`);
  if (view === 'mobile') {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    check(w <= 390, `mobile: no horizontal page scroll (${w}px)`);
  }
  await page.screenshot({ path: path.join(OUT, `approved-${view}.png`), fullPage: true });

  await page.evaluate((s) => localStorage.setItem('af:mock-session', s), session({ userId: 'mock-bm', role: 'business_manager' }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('tp-empty').waitFor();
  check((await page.getByTestId('tp-approvals').count()) === 0, `${view}: BM has no approvals panel`);
  await ctx.close();
}

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
process.exit(ok ? 0 : 1);
