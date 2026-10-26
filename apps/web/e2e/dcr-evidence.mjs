// Checks + screenshots for attendance (#9) on the real contracts (MSW mock).
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3100 node e2e/dcr-evidence.mjs
import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const BROWSER = process.env.BROWSER ?? 'chromium';
const engine = { chromium, webkit }[BROWSER];
const OUT = path.resolve(import.meta.dirname, `../../../docs/evidence/dcr${BROWSER === 'chromium' ? '' : '-' + BROWSER}`);
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
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const pick = async (page, trigger, name) => {
  await page.getByTestId(trigger).click();
  await (name ? page.getByRole('option', { name }) : page.getByRole('option').first()).click();
};

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

  if (view === 'desktop') {
    // Approved tour plan first (same page, so the in-browser mock keeps its state), then client-side nav to /dcr.
    await page.goto(`${BASE}/tour-plans`, { waitUntil: 'networkidle' });
    await page.getByTestId('tp-start').click();
    await page.locator(`[data-testid=tp-day][data-date="${today}"]`).click();
    await pick(page, 'tp-wt', 'Field work');
    await pick(page, 'tp-terr');
    await page.getByTestId('tp-save').click();
    await page.getByTestId('tp-editor').waitFor({ state: 'hidden' });
    await page.getByTestId('tp-fill').click();
    await pick(page, 'tp-wt', 'Meeting');
    await page.getByTestId('tp-save').click();
    await page.getByTestId('tp-editor').waitFor({ state: 'hidden' });
    await page.getByTestId('tp-submit').click();
    const mine = page.getByTestId('tp-approval').filter({ hasText: `Tour plan ${today.slice(0, 7)}` });
    await mine.getByTestId('tp-approve').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=tp-status]')?.textContent === 'Approved');
    await page.locator('a[href="/dcr"]').first().click();
    await page.waitForURL(/\/dcr$/);
    await page.getByTestId('dcr-planned').waitFor({ timeout: 10000 });
    check(/Field work/.test(await page.getByTestId('dcr-planned').textContent()), `${view}: prefilled from the approved tour plan`);
    check(/Field work/.test(await page.getByTestId('dcr-wt').textContent()), `${view}: work type prefilled`);
    await pick(page, 'dcr-wt', 'Meeting');
    await page.getByTestId('dcr-reason').waitFor();
    check(await page.getByTestId('dcr-submit').isDisabled(), `${view}: deviation from TP needs a reason`);
    await page.screenshot({ path: path.join(OUT, `deviation-${view}.png`), fullPage: true });
    await pick(page, 'dcr-wt', 'Field work');
    check((await page.getByTestId('dcr-reason').count()) === 0, `${view}: back on plan, no reason needed`);
  } else {
    await page.goto(`${BASE}/dcr`, { waitUntil: 'networkidle' });
    await page.getByText('Not started').waitFor({ timeout: 15000 });
    check((await page.getByTestId('dcr-planned').count()) === 0, `${view}: no approved TP, nothing prefilled`);
    await pick(page, 'dcr-wt', 'Field work');
    await pick(page, 'dcr-terr');
  }

  check(/Field work needs at least one call/.test(await page.getByTestId('dcr-problems').textContent()), `${view}: field day without calls is flagged`);
  check(await page.getByTestId('dcr-submit').isDisabled(), `${view}: submit blocked without calls`);
  await page.getByTestId('dcr-add-call').click();
  await pick(page, 'call-doctor');
  await page.getByTestId('call-product').first().click();
  const sample = page.locator('[data-testid=dcr-call-dialog] input[inputmode=numeric]').first();
  if (await sample.count()) await sample.fill('2');
  await page.locator('#call-remarks').fill('Discussed dosing');
  await page.getByTestId('call-add').click();
  await page.getByTestId('dcr-call').first().waitFor();
  check((await page.getByTestId('dcr-call').count()) === 1, `${view}: call added`);
  await page.getByTestId('dcr-save').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=dcr-status]')?.textContent === 'Draft', null, { timeout: 10000 });
  check(true, `${view}: draft saved via PUT /v1/dcrs`);
  await page.screenshot({ path: path.join(OUT, `draft-${view}.png`), fullPage: true });
  await page.getByTestId('dcr-submit').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=dcr-status]')?.textContent === 'Submitted', null, { timeout: 10000 });
  check(true, `${view}: submitted`);
  check((await page.getByTestId('dcr-submit').count()) === 0 && (await page.getByTestId('dcr-add-call').count()) === 0, `${view}: submitted DCR is read-only`);
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
