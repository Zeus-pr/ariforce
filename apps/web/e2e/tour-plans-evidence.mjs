// Checks + screenshots for attendance (#9) on the real contracts (MSW mock).
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3100 node e2e/tour-plans-evidence.mjs
import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const BROWSER = process.env.BROWSER ?? 'chromium';
const engine = { chromium, webkit }[BROWSER];
const OUT = path.resolve(
  import.meta.dirname,
  `../../../docs/evidence/tour-plans${BROWSER === 'chromium' ? '' : '-' + BROWSER}`,
);
fs.mkdirSync(OUT, { recursive: true });
let ok = true;
const check = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'} [${BROWSER}] ${m}`);
  if (!c) ok = false;
};
const VIEWS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
};
const browser = await engine.launch();
const errors = [];

const session = (s) => JSON.stringify(s);
for (const view of ['desktop', 'mobile']) {
  const ctx = await browser.newContext(VIEWS[view]);
  await ctx.addInitScript(
    (s) => {
      sessionStorage.setItem('af:splash-seen', '1');
      if (!localStorage.getItem('af:session')) localStorage.setItem('af:session', s);
    },
    session({ userId: 'mock-director', role: 'director' }),
  );
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      errors.push(`${view}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${view}: ${e.message}`));

  await page.goto(`${BASE}/tour-plans`, { waitUntil: 'networkidle' });
  await page.getByTestId('tp-empty').waitFor({ timeout: 15000 });
  check(
    true,
    `${view}: month without a plan shows the start state (GET /v1/tour-plans/{month} 404)`,
  );
  await page.screenshot({ path: path.join(OUT, `empty-${view}.png`), fullPage: true });
  await page.getByTestId('tp-start').click();
  await page.getByTestId('tp-calendar').waitFor();
  const days = await page.getByTestId('tp-day').count();
  check(days >= 28 && days <= 31, `${view}: calendar has every date (${days})`);
  check(
    await page.getByTestId('tp-submit').isDisabled(),
    `${view}: submit disabled with 0 planned days`,
  );
  check(
    (await page.getByTestId('tp-missing').textContent()) === 'No days planned yet',
    `${view}: informational count with nothing planned`,
  );
  // Only today (IST) onward and not Sundays are required: past days and Sundays are muted and not counted.
  const todayIst = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const all = await page
    .getByTestId('tp-day')
    .evaluateAll((els) => els.map((e) => [e.dataset.date, e.dataset.optional ?? '']));
  const sun = (d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
  check(
    all.every(([d, o]) => (sun(d) ? o === 'weekly-off' : d < todayIst ? o === 'past' : o === '')),
    `${view}: past days marked "Past", Sundays "Weekly off", the rest required`,
  );

  await page.getByTestId('tp-day').first().click();
  await page.getByTestId('tp-wt').click();
  await page.getByRole('option', { name: 'Field work' }).click();
  await page.getByTestId('tp-terr').click();
  await page.getByRole('option').first().click();
  await page.getByTestId('tp-save').click();
  await page.getByTestId('tp-editor').waitFor({ state: 'hidden' });
  check(
    (await page.getByTestId('tp-day').first().getAttribute('data-empty')) === 'false',
    `${view}: day 1 (a past or off day is still clickable) saved via PUT /v1/tour-plans/{month}`,
  );
  check(
    (await page.getByTestId('tp-missing').textContent()) === '1 day planned',
    `${view}: "1 day planned"`,
  );
  check(
    await page.getByTestId('tp-submit').isEnabled(),
    `${view}: submit enabled with 1 planned day`,
  );

  await page.getByTestId('tp-fill').click();
  await page.getByTestId('tp-wt').click();
  await page.getByRole('option', { name: 'Meeting' }).click();
  await page.getByTestId('tp-save').click();
  await page.getByTestId('tp-editor').waitFor({ state: 'hidden' });
  const after = await page
    .getByTestId('tp-day')
    .evaluateAll((els) => els.map((e) => [e.dataset.optional ?? '', e.dataset.empty]));
  check(
    after.filter(([o]) => o === '').every(([, e]) => e === 'false'),
    `${view}: bulk fill planned every working day`,
  );
  check(
    after
      .filter(([o]) => o === 'weekly-off')
      .slice(1)
      .every(([, e]) => e === 'true'),
    `${view}: Fill unplanned days skipped weekly-off days`,
  );
  check(
    (await page.getByTestId('tp-missing').textContent()) ===
      `${after.filter(([, e]) => e === 'false').length} days planned`,
    `${view}: count is informational ("N days planned")`,
  );
  check(
    (await page.locator('[data-testid=tp-day][data-optional=past][data-empty=true]').count()) > 0 ||
      todayIst.endsWith('-01'),
    `${view}: Fill unplanned days skipped past days`,
  );
  check(await page.getByTestId('tp-submit').isEnabled(), `${view}: submit enabled`);
  await page.screenshot({ path: path.join(OUT, `planned-${view}.png`), fullPage: true });

  await page.getByTestId('tp-submit').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=tp-status]')?.textContent === 'Waiting for approval',
    null,
    { timeout: 10000 },
  );
  check(true, `${view}: submitted (POST /submit)`);
  check(
    await page.getByTestId('tp-day').first().isDisabled(),
    `${view}: submitted plan is read-only`,
  );
  const ym = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  // Approvals: the mock (like the API) forbids deciding your own request, so the author never sees their
  // own plan in the queue; approve another user's plan (seeded BM plan) instead.
  await page.getByTestId('tp-approvals').waitFor({ timeout: 10000 });
  check(
    (await page
      .getByTestId('tp-approval')
      .filter({ hasText: `Tour plan ${ym}` })
      .filter({ hasNotText: 'Business Manager' })
      .count()) === 0,
    `${view}: own plan is not in my approval queue (no self-approval)`,
  );
  const other = page.getByTestId('tp-approval').filter({ hasText: 'Business Manager' }).first();
  await other.waitFor({ timeout: 10000 });
  check(true, `${view}: approver sees another user's pending plan (GET /v1/approvals)`);
  await page.screenshot({ path: path.join(OUT, `approval-${view}.png`), fullPage: true });
  const before = await page.getByTestId('tp-approval').count();
  await other.getByTestId('tp-approve').click();
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-testid=tp-approval]').length < n,
    before,
    { timeout: 10000 },
  );
  check(true, `${view}: approved another user's plan via POST /v1/approvals/{id}/decision`);
  check(
    (await page.getByTestId('tp-status').textContent()) === 'Waiting for approval',
    `${view}: own plan still waits for a different approver`,
  );
  if (view === 'mobile') {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    check(w <= 390, `mobile: no horizontal page scroll (${w}px)`);
  }
  await page.screenshot({ path: path.join(OUT, `approved-${view}.png`), fullPage: true });

  await page.evaluate(
    (s) => localStorage.setItem('af:session', s),
    session({ userId: 'mock-bm', role: 'business_manager' }),
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('tp-month').waitFor();
  check(
    (await page.getByTestId('tp-approvals').count()) === 0,
    `${view}: BM has no approvals panel`,
  );
  // Future month: every non-Sunday date is required.
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByTestId('tp-empty').waitFor({ timeout: 10000 });
  await page.getByTestId('tp-start').click();
  await page.getByTestId('tp-calendar').waitFor();
  const nx = await page
    .getByTestId('tp-day')
    .evaluateAll((els) => els.map((e) => [e.dataset.date, e.dataset.optional ?? '']));
  const nReq = nx.filter(([d]) => !sun(d)).length;
  check(
    nx.every(([d, o]) => (sun(d) ? o === 'weekly-off' : o === '')),
    `${view}: next month: only Sundays optional`,
  );
  // Submit with exactly one planned day works (rule since fix/tp-submit-any-day 0bb7b40).
  await page.locator('[data-testid=tp-day]:not([data-optional])').nth(2).click();
  await page.getByTestId('tp-wt').click();
  await page.getByRole('option', { name: 'Meeting' }).click();
  await page.getByTestId('tp-save').click();
  await page.getByTestId('tp-editor').waitFor({ state: 'hidden' });
  check(
    await page.getByTestId('tp-submit').isEnabled(),
    `${view}: next month: submit enabled with 1 of ${nReq} days planned`,
  );
  await page.getByTestId('tp-submit').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=tp-status]')?.textContent === 'Waiting for approval',
    null,
    { timeout: 10000 },
  );
  check(true, `${view}: next month: submit with 1 planned day works`);
  await page.screenshot({ path: path.join(OUT, `next-month-${view}.png`), fullPage: true });
  // Past month: the server's rule leaves past months unchanged (every non-Sunday date required).
  await page.getByRole('button', { name: 'Previous month' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Previous month' }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  if (await page.getByTestId('tp-empty').isVisible()) {
    await page.getByTestId('tp-start').click();
    await page.getByTestId('tp-calendar').waitFor();
  }
  const pv = await page
    .getByTestId('tp-day')
    .evaluateAll((els) => els.map((e) => [e.dataset.date, e.dataset.optional ?? '']));
  check(
    pv.every(([d, o]) => (sun(d) ? o === 'weekly-off' : o === '')),
    `${view}: past month: Sundays "Weekly off", other days required (server rule: past months unchanged)`,
  );
  await ctx.close();
}

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
process.exit(ok ? 0 : 1);
