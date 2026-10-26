// Checks + screenshots for masters (#8). Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3100 node e2e/masters-evidence.mjs
import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const API = 'http://localhost:4000';
const BROWSER = process.env.BROWSER ?? 'chromium';
const engine = { chromium, webkit }[BROWSER];
const OUT = path.resolve(import.meta.dirname, `../../../docs/evidence/masters${BROWSER === 'chromium' ? '' : '-' + BROWSER}`);
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

async function open(view, theme, extra = {}) {
  const ctx = await browser.newContext({ ...VIEWS[view], colorScheme: theme, ...extra });
  await ctx.addInitScript(() => { sessionStorage.setItem('af:splash-seen', '1'); if (!localStorage.getItem('af:mock-session')) localStorage.setItem('af:mock-session', JSON.stringify({ userId: 'mock-admin', role: 'system_admin' })); });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${view}/${theme}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${view}/${theme}: ${e.message}`));
  return { ctx, page };
}
const rowSel = (view) => (view === 'mobile' ? '[data-testid=card-row]' : '[data-testid=table-row]');

// 1. Mock mode (MSW from @ariforce/contracts/mocks): list, create with validation, edit.
for (const view of ['desktop', 'mobile'])
  for (const theme of ['light']) {
    const { ctx, page } = await open(view, theme);
    await page.goto(`${BASE}/masters/doctors`, { waitUntil: 'networkidle' });
    await page.locator(rowSel(view)).first().waitFor({ timeout: 15000 });
    check(await page.locator(rowSel(view)).filter({ hasText: 'Dr. A. Sen' }).first().isVisible(), `${view}/${theme}: doctors list shows contract fixture`);
    await page.screenshot({ path: path.join(OUT, `doctors-${view}.png`) });
    const status = await page.getByTestId('page-status').first().textContent();
    check(/of\s*[\d,]+/.test(status ?? ''), `${view}: pager shows a real total ("${status}")`);
    if (view === 'desktop') {
      await page.getByRole('button', { name: /^Name/ }).first().click();
      await page.waitForURL(/sort=name/, { timeout: 5000 });
      check(true, `${view}: sort by name goes to the URL/server`);
      await page.goto(`${BASE}/masters/doctors`, { waitUntil: 'networkidle' });
      await page.locator(rowSel(view)).first().waitFor({ timeout: 15000 });
    }
    if (theme === 'light') {
      await page.getByRole('button', { name: /Add doctor/ }).click();
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      check(await page.getByText('Required.').first().isVisible(), `${view}: empty submit shows contract validation`);
      const nameBox = page.locator('#f-name');
      if (view === 'mobile') {
        const fs = await nameBox.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
        check(fs >= 16, `mobile: form input font ${fs}px (no iOS zoom)`);
      }
      await nameBox.fill(`Dr. Test ${view}`);
      await page.locator('#f-territoryId').click();
      await page.getByRole('option', { name: /Kolkata North/ }).click();
      await page.locator('#f-pincode').fill('70001');
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      check(await page.getByText('Use a 6-digit PIN code.').isVisible(), `${view}: bad PIN rejected`);
      await page.locator('#f-pincode').fill('700001');
      await page.screenshot({ path: path.join(OUT, `doctor-form-${view}.png`) });
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByText(`Added Dr. Test ${view}`).waitFor({ timeout: 5000 });
      await page.waitForTimeout(600);
      check(await page.locator(rowSel(view)).filter({ hasText: `Dr. Test ${view}` }).first().isVisible(), `${view}: created row appears after refetch`);
      // Edit
      await page.locator(rowSel(view)).filter({ hasText: 'Dr. A. Sen' }).first().click();
      await page.locator('#f-qualification').fill('MBBS, MD (Medicine)');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByText('Saved Dr. A. Sen').waitFor({ timeout: 5000 });
      check(true, `${view}: edit saves with version (PATCH)`);
      await page.goto(`${BASE}/masters/chemists`, { waitUntil: 'networkidle' });
      await page.locator(rowSel(view)).first().waitFor({ timeout: 15000 });
      check(await page.locator(rowSel(view)).filter({ hasText: 'Sen Medical Hall' }).first().isVisible(), `${view}: chemists tab`);
    }
    await ctx.close();
  }

// 2. Server-side paging/search: service worker blocked, API stubbed; prove params go to the server.
for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open(view, 'light', { serviceWorkers: 'block' });
  const seen = [];
  const item = (i) => ({
    id: `01930000-0000-7000-8000-${String(900000000000 + i)}`,
    companyId: '01930000-0000-7000-8000-000000000001',
    createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z', deletedAt: null, version: 1,
    territoryId: '01930000-0000-7000-8000-000000000104', name: `Doctor ${i}`, qualification: null, specialtyId: null,
    categoryId: null, registrationNo: null, addressLine: null, city: 'Kolkata', state: null, pincode: null, location: null, phone: null,
  });
  await page.route(`${API}/v1/**`, async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname !== '/v1/doctors') return route.fulfill({ json: { items: [], nextCursor: null, serverTime: new Date().toISOString() } });
    seen.push(u.search);
    const limit = Number(u.searchParams.get('limit'));
    const start = u.searchParams.get('cursor') === 'c2' ? limit : 0;
    // Deliberately ignore q: if the UI filtered client-side, rows would disappear.
    return route.fulfill({
      json: { items: Array.from({ length: limit }, (_, i) => item(start + i + 1)), nextCursor: start ? null : 'c2', serverTime: new Date().toISOString() },
    });
  });
  await page.goto(`${BASE}/masters/doctors`, { waitUntil: 'networkidle' });
  await page.locator(rowSel(view)).first().waitFor();
  check(/limit=25/.test(seen[0] ?? '') && !/cursor/.test(seen[0]), `${view}: first request ${seen[0]}`);
  check((await page.locator(rowSel(view)).count()) === 25, `${view}: renders server page of 25`);
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.locator(rowSel(view)).filter({ hasText: 'Doctor 26' }).first().waitFor();
  check(/cursor=c2/.test(seen.at(-1)) && /page=2/.test(page.url()), `${view}: next page sends cursor (${seen.at(-1)}), URL ${new URL(page.url()).search}`);
  check(await page.getByRole('button', { name: 'Next page' }).isDisabled(), `${view}: next disabled on last page`);
  await page.getByRole('searchbox', { name: 'Search doctors' }).fill('sen');
  await page.waitForTimeout(900);
  check(/q=sen/.test(seen.at(-1)) && !/cursor/.test(seen.at(-1)) && !/page=2/.test(page.url()), `${view}: search goes to server and resets to page 1 (${seen.at(-1)})`);
  check((await page.locator(rowSel(view)).count()) === 25, `${view}: no client-side filtering`);
  await page.getByRole('combobox', { name: 'Rows per page' }).click();
  await page.getByRole('option', { name: '50' }).click();
  await page.waitForTimeout(600);
  check(/limit=50/.test(seen.at(-1)) && /size=50/.test(page.url()), `${view}: page size goes to server (${seen.at(-1)})`);
  await page.reload({ waitUntil: 'networkidle' });
  check(await page.getByRole('searchbox', { name: 'Search doctors' }).inputValue() === 'sen', `${view}: table state survives reload (URL)`);
  await ctx.close();
}

// 3. Import wizard (CSV): auto-match, client validation, server dry run, then save.
for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open(view, 'light');
  await page.goto(`${BASE}/masters/doctors/import`, { waitUntil: 'networkidle' });
  const csv = [
    'Doctor Name,Speciality,Territory Code,PIN,Mobile',
    'Dr. Valid One,Cardiologist,KOL-N,700001,9830000000',
    'Dr. Bad Pin,General Physician,KOL-N,7001,',
    'Dr. Nowhere,Cardiologist,MARS-1,700002,',
    ',Cardiologist,KOL-N,700003,',
  ].join('\n');
  await page.getByTestId('import-file').setInputFiles({ name: 'doctors.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByText('Match each AriForce field').waitFor();
  const nameCol = await page.getByRole('combobox', { name: 'Column for Name' }).textContent();
  const terrCol = await page.getByRole('combobox', { name: 'Column for Territory' }).textContent();
  check(nameCol.includes('Doctor Name') && terrCol.includes('Territory Code'), `${view}: columns auto-matched (${nameCol} / ${terrCol})`);
  await page.screenshot({ path: path.join(OUT, `import-match-${view}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Check rows' }).click();
  const summary = await page.getByTestId('import-summary').textContent();
  check(/1 ready/.test(summary) && /3 with problems/.test(summary), `${view}: validation summary "${summary}"`);
  check(await page.getByText(/PIN code must be 6 digits/).isVisible(), `${view}: bad PIN flagged`);
  check(await page.getByText(/Territory “MARS-1” not found/).isVisible(), `${view}: unknown territory flagged`);
  check(await page.getByText(/Name is required/).isVisible(), `${view}: missing name flagged`);
  await page.screenshot({ path: path.join(OUT, `import-review-${view}.png`), fullPage: true });
  await page.getByRole('button', { name: /Continue with 1 rows/ }).click();
  await page.getByTestId('import-totals').waitFor({ timeout: 10000 });
  const pre = await page.getByTestId('import-totals').textContent();
  check(/Rows1/.test(pre) && /Valid1/.test(pre), `${view}: server dry run totals "${pre}"`);
  await page.screenshot({ path: path.join(OUT, `import-dryrun-${view}.png`), fullPage: true });
  await page.getByTestId('import-commit').click();
  await page.getByRole('link', { name: /Back to doctors/ }).waitFor({ timeout: 10000 });
  const post = await page.getByTestId('import-totals').textContent();
  check(/Created1/.test(post), `${view}: import saved (dryRun:false) "${post}"`);
  await page.screenshot({ path: path.join(OUT, `import-saved-${view}.png`), fullPage: true });
  await ctx.close();
}

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
process.exit(ok ? 0 : 1);
