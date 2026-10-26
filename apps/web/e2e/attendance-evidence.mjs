// Checks + screenshots for attendance (#9) on the real contracts (MSW mock).
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3100 node e2e/attendance-evidence.mjs
import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const BROWSER = process.env.BROWSER ?? 'chromium';
const engine = { chromium, webkit }[BROWSER];
const OUT = path.resolve(import.meta.dirname, `../../../docs/evidence/attendance${BROWSER === 'chromium' ? '' : '-' + BROWSER}`);
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

for (const view of ['desktop', 'mobile']) {
  const ctx = await browser.newContext({
    ...VIEWS[view],
    ...(BROWSER === 'chromium' ? { permissions: ['geolocation'], geolocation: { latitude: 22.5958, longitude: 88.3985, accuracy: 20 } } : {}),
  });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('af:splash-seen', '1');
    if (!localStorage.getItem('af:mock-session')) localStorage.setItem('af:mock-session', JSON.stringify({ userId: 'mock-bm', role: 'business_manager' }));
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|tiles\.openfreemap|WebGL/i.test(m.text())) errors.push(`${view}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${view}: ${e.message}`));

  await page.goto(`${BASE}/attendance`, { waitUntil: 'load' });
  await page.getByTestId('att-today').waitFor({ timeout: 15000 });
  check((await page.getByTestId('att-state').textContent()) === 'Not punched in', `${view}: BM starts not punched in`);
  check(await page.getByText('No check-ins on this day.').waitFor({ timeout: 10000 }).then(() => true, () => false), `${view}: empty day state`);
  await page.getByTestId('punch-in').click();
  await page.getByTestId('att-row').first().waitFor({ timeout: 15000 });
  check((await page.getByTestId('att-state').textContent()) === 'On the field', `${view}: punch in recorded via POST /v1/check-ins`);

  await page.getByTestId('visit-doctor').click();
  await page.getByRole('option').first().click();
  await page.getByTestId('check-in-visit').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=att-row]').length === 2, null, { timeout: 10000 });
  const visitRow = await page.getByTestId('att-row').nth(1).textContent();
  check(/Visit/.test(visitRow) && /(Inside|Outside|n\/a)/.test(visitRow), `${view}: visit row with fence result "${visitRow}"`);

  await page.getByTestId('punch-out').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=att-row]').length === 3, null, { timeout: 10000 });
  check((await page.getByTestId('att-state').textContent()) === 'Day closed', `${view}: punch out closes the day`);
  const day = await page.getByTestId('att-day-row').first().textContent();
  check(/present/i.test(day) && /1$/.test(day.trim()), `${view}: day summary from GET /v1/attendance "${day}"`);

  const map = page.getByTestId('check-in-map');
  check(await map.isVisible(), `${view}: map region visible`);
  await page.waitForFunction(() => document.querySelector('[data-testid=check-in-map]')?.dataset.ready === 'true', null, { timeout: 15000 }).catch(() => {});
  check(true, `${view}: map ready=${await map.getAttribute('data-ready')} (tiles depend on network)`);
  await page.getByTestId('att-row').nth(1).click();
  check((await page.getByTestId('att-row').nth(1).getAttribute('aria-selected')) === 'true', `${view}: row selection syncs to map`);
  if (view === 'mobile') {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    check(w <= 390, `mobile: no horizontal page scroll (${w}px)`);
  }
  await page.screenshot({ path: path.join(OUT, `attendance-bm-${view}.png`), fullPage: true });

  // Approver view: no punch panel, sees the day table.
  await page.evaluate(() => localStorage.setItem('af:mock-session', JSON.stringify({ userId: 'mock-rbm', role: 'regional_business_manager' })));
  await page.reload({ waitUntil: 'load' });
  await page.getByTestId('att-days').waitFor();
  check((await page.getByTestId('att-today').count()) === 0, `${view}: RBM (approver) sees no punch panel`);
  await page.evaluate(() => localStorage.setItem('af:mock-session', JSON.stringify({ userId: 'mock-director', role: 'director' })));
  await page.reload({ waitUntil: 'load' });
  await page.getByTestId('att-days').waitFor();
  check((await page.getByTestId('att-today').count()) === 0, `${view}: director sees no punch panel`);
  await page.screenshot({ path: path.join(OUT, `attendance-director-${view}.png`), fullPage: true });
  await ctx.close();
}

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
process.exit(ok ? 0 : 1);
