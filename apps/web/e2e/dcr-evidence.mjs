// Checks + screenshots for attendance (#9) on the real contracts (MSW mock).
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3100 node e2e/dcr-evidence.mjs
import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const BROWSER = process.env.BROWSER ?? 'chromium';
const engine = { chromium, webkit }[BROWSER];
const OUT = path.resolve(
  import.meta.dirname,
  `../../../docs/evidence/dcr${BROWSER === 'chromium' ? '' : '-' + BROWSER}`,
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
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const pick = async (page, trigger, name) => {
  await page.getByTestId(trigger).click();
  await (name ? page.getByRole('option', { name }) : page.getByRole('option').first()).click();
};

const pickOutlet = async (page) => {
  const o = page.locator('[data-testid=call-doctor-option]:not([aria-disabled=true])').first();
  await o.waitFor({ timeout: 15000 });
  const name = (await o.locator('span span').first().textContent()).trim();
  await o.click();
  return name;
};
for (const view of ['desktop', 'mobile']) {
  const ctx = await browser.newContext(VIEWS[view]);
  await ctx.addInitScript(
    (s) => {
      sessionStorage.setItem('af:splash-seen', '1');
      if (!localStorage.getItem('af:mock-session')) localStorage.setItem('af:mock-session', s);
    },
    session({ userId: 'mock-director', role: 'director' }),
  );
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      errors.push(`${view}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${view}: ${e.message}`));

  if (view === 'desktop') {
    // Submit a tour plan, then check it cannot be self-approved (the mock enforces "not your own request").
    // TP prefill into the DCR needs an approved plan from a different approver; that is covered by
    // e2e/dropdowns-real-evidence.mjs with a stubbed approved plan.
    await page.goto(`${BASE}/tour-plans`, { waitUntil: 'networkidle' });
    const start = page.getByTestId('tp-start');
    await Promise.race([
      start.waitFor({ timeout: 15000 }),
      page.getByTestId('tp-calendar').waitFor({ timeout: 15000 }),
    ]);
    if (await start.count()) await start.click();
    await page.locator(`[data-testid=tp-day][data-date="${today}"]`).click();
    await pick(page, 'tp-wt', 'Field work');
    await pick(page, 'tp-terr');
    await page.getByTestId('tp-save').click();
    await page.getByTestId('tp-editor').waitFor({ state: 'hidden' });
    if (await page.getByTestId('tp-fill').count()) {
      await page.getByTestId('tp-fill').click();
      await pick(page, 'tp-wt', 'Meeting');
      await page.getByTestId('tp-save').click();
      await page.getByTestId('tp-editor').waitFor({ state: 'hidden' });
    }
    await page.getByTestId('tp-submit').click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid=tp-status]')?.textContent === 'Waiting for approval',
      null,
      { timeout: 10000 },
    );
    check(
      (await page
        .getByTestId('tp-approval')
        .filter({ hasText: `Tour plan ${today.slice(0, 7)}` })
        .filter({ hasNotText: 'Business Manager' })
        .count()) === 0,
      `${view}: own tour plan cannot be self-approved`,
    );
    await page.locator('a[href="/dcr"]').first().click();
    await page.waitForURL(/\/dcr$/);
    await page.getByTestId('dcr-wt').waitFor({ timeout: 15000 });
    check(
      (await page.getByTestId('dcr-planned').count()) === 0,
      `${view}: plan not approved yet, nothing prefilled`,
    );
    await pick(page, 'dcr-wt', 'Field work');
    await pick(page, 'dcr-terr');
  } else {
    await page.goto(`${BASE}/dcr`, { waitUntil: 'networkidle' });
    await page.getByText('Not started').waitFor({ timeout: 15000 });
    check(
      (await page.getByTestId('dcr-planned').count()) === 0,
      `${view}: no approved TP, nothing prefilled`,
    );
    await pick(page, 'dcr-wt', 'Field work');
    await pick(page, 'dcr-terr');
  }

  check(
    /Field work needs at least one call/.test(await page.getByTestId('dcr-problems').textContent()),
    `${view}: field day without calls is flagged`,
  );
  check(await page.getByTestId('dcr-submit').isDisabled(), `${view}: submit blocked without calls`);
  await page.getByTestId('dcr-add-call').click();
  await pickOutlet(page);
  await page.getByTestId('call-product').first().click();
  const sample = page.locator('[data-testid=dcr-call-dialog] input[inputmode=numeric]').first();
  if (await sample.count()) await sample.fill('2');
  await page.locator('#call-remarks').fill('Discussed dosing');
  await page.getByTestId('call-add').click();
  await page.getByTestId('dcr-call').first().waitFor();
  check((await page.getByTestId('dcr-call').count()) === 1, `${view}: call added`);
  await page.getByTestId('dcr-save').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=dcr-status]')?.textContent === 'Draft',
    null,
    { timeout: 10000 },
  );
  check(true, `${view}: draft saved via PUT /v1/dcrs`);
  await page.screenshot({ path: path.join(OUT, `draft-${view}.png`), fullPage: true });
  await page.getByTestId('dcr-submit').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=dcr-status]')?.textContent === 'Submitted',
    null,
    { timeout: 10000 },
  );
  check(true, `${view}: submitted`);
  check(
    (await page.getByTestId('dcr-submit').count()) === 0 &&
      (await page.getByTestId('dcr-add-call').count()) === 0,
    `${view}: submitted DCR is read-only`,
  );
  if (view === 'mobile') {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    check(w <= 390, `mobile: no horizontal page scroll (${w}px)`);
  }
  await page.screenshot({ path: path.join(OUT, `submitted-${view}.png`), fullPage: true });
  await ctx.close();
}

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
process.exit(ok ? 0 : 1);
