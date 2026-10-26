// Every DCR / Tour Plan dropdown opens, lists options, selects, and keeps the value (MSW mock).
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/dropdowns-evidence.mjs
import { chromium, webkit } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const BROWSER = process.env.BROWSER ?? 'chromium';
const engine = { chromium, webkit }[BROWSER];
let ok = true;
const check = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'} [${BROWSER}] ${m}`);
  if (!c) ok = false;
};
const VIEWS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: { viewport: { width: 390, height: 844 }, hasTouch: true, ...(BROWSER === 'webkit' ? {} : { isMobile: true }) },
};
const browser = await engine.launch();
/** Client-side nav through the sidebar; on mobile the links live in a closed sheet, so open it first. */
async function nav(page, href) {
  const a = page.locator(`a[href="${href}"]:visible`).first();
  if (!(await a.count())) await page.locator('[data-sidebar=trigger]').first().click();
  await page.locator(`a[href="${href}"]:visible`).first().click();
  await page.waitForURL(new RegExp(href + '$'));
}

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Open the trigger, expect options, choose one (by name or the last), expect the trigger to show it. */
async function dropdown(page, view, testId, name) {
  const tr = page.getByTestId(testId);
  if (view === 'mobile') await tr.tap();
  else await tr.click();
  const opts = page.getByRole('option');
  await opts.first().waitFor({ timeout: 5000 }).catch(() => {});
  const n = await opts.count();
  check(n > 0 && (await tr.getAttribute('aria-expanded')) === 'true', `${view} ${testId}: opens with ${n} options`);
  if (!n) return null;
  const opt = name ? page.getByRole('option', { name }) : opts.last();
  const label = (await opt.textContent()).trim();
  if (view === 'mobile') await opt.tap();
  else await opt.click();
  await page.waitForFunction((id) => document.querySelector(`[data-testid=${id}]`)?.getAttribute('aria-expanded') === 'false', testId);
  check((await tr.textContent()).includes(label), `${view} ${testId}: shows "${label}" after select`);
  return label;
}

for (const view of ['desktop', 'mobile']) {
  const ctx = await browser.newContext(VIEWS[view]);
  await ctx.addInitScript(() => {
    sessionStorage.setItem('af:splash-seen', '1');
    if (!localStorage.getItem('af:mock-session')) localStorage.setItem('af:mock-session', JSON.stringify({ userId: 'mock-director', role: 'director' }));
  });
  const page = await ctx.newPage();

  // Tour plan editor (Selects inside a Dialog).
  await page.goto(`${BASE}/tour-plans`, { waitUntil: 'networkidle' });
  const start = page.getByTestId('tp-start');
  await Promise.race([start.waitFor({ timeout: 15000 }), page.getByTestId('tp-calendar').waitFor({ timeout: 15000 })]);
  if (await start.count()) await start.click();
  const day = page.locator(`[data-testid=tp-day][data-date="${today}"]`);
  await day.click();
  await dropdown(page, view, 'tp-wt', 'Field work');
  const terr = await dropdown(page, view, 'tp-terr');
  await page.getByTestId('tp-save').click();
  await page.getByTestId('tp-editor').waitFor({ state: 'hidden' });
  await day.click();
  check((await page.getByTestId('tp-wt').textContent()).includes('Field work') && (await page.getByTestId('tp-terr').textContent()).includes(terr ?? '#'), `${view} tour plan: values persist after save + reopen`);
  await page.keyboard.press('Escape');
  await page.getByTestId('tp-editor').waitFor({ state: 'hidden' });

  // DCR: work type, territory, and the doctor picker inside the call dialog.
  await nav(page, '/dcr');
  await page.getByTestId('dcr-wt').waitFor({ timeout: 15000 });
  await dropdown(page, view, 'dcr-wt', 'Meeting');
  await dropdown(page, view, 'dcr-wt', 'Field work');
  const dTerr = await dropdown(page, view, 'dcr-terr');
  await page.getByTestId('dcr-add-call').click();
  const doc = await dropdown(page, view, 'call-doctor');
  await page.getByTestId('call-product').first().click();
  await page.getByTestId('call-add').click();
  await page.getByTestId('dcr-call').first().waitFor();
  check(doc && (await page.getByTestId('dcr-call').first().textContent()).includes(doc), `${view} call-doctor: chosen doctor kept on the call`);
  await page.getByTestId('dcr-save').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=dcr-status]')?.textContent === 'Draft', null, { timeout: 10000 });
  // Client-side round trip: go away and back, the saved draft reloads with the same values.
  await nav(page, '/tour-plans');
  await nav(page, '/dcr');
  await page.getByTestId('dcr-wt').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('[data-testid=dcr-status]')?.textContent === 'Draft', null, { timeout: 10000 });
  check((await page.getByTestId('dcr-wt').textContent()).includes('Field work') && (await page.getByTestId('dcr-terr').textContent()).includes(dTerr ?? '#'), `${view} dcr: values persist after save + revisit`);
  await ctx.close();
}
await browser.close();
process.exit(ok ? 0 : 1);
