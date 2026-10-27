// SFC (/sfc): who sees it, HQ picker scope (Burdwan ABM), employee list, the TA/DA table columns,
// the 2.95/km calculation, ACTUAL FARE, add/delete/reorder rows, DA edit, save, 409, 422, unsaved warning.
// Mock mode; every write goes to the in-page MSW SFC mock.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/sfc-evidence.mjs
import { setup } from './lib.mjs';

const { check, open, shot, noOverflow, noBannedWords, finish } = await setup('sfc');
const API = process.env.MOCK_API_URL ?? 'http://localhost:4000';
const COLS = ['SL No', 'From place', 'To place', 'Distance one way (km)', 'Distance both way (km)', 'Amount one way', 'Amount both way', 'Travel mode', 'Category', 'DA'];
const texts = (page, id) => page.getByTestId(id).allTextContents();
const vals = (page, id) => page.getByTestId(id).evaluateAll((els) => els.map((e) => e.value));

// Who sees it.
for (const role of ['business_manager']) {
  const { ctx, page } = await open(role, '/sfc', 'desktop');
  await page.waitForTimeout(2500);
  check((await page.locator('a[href="/sfc"]').count()) === 0, `${role}: no SFC nav entry`);
  check(!/\/sfc/.test(page.url()), `${role}: redirected away (${new URL(page.url()).pathname})`);
  await ctx.close();
}
for (const role of ['area_business_manager', 'regional_business_manager', 'director', 'system_admin']) {
  const { ctx, page } = await open(role, '/sfc', 'desktop');
  check(await page.locator('a[href="/sfc"]').first().waitFor({ state: 'attached', timeout: 15000 }).then(() => true, () => false), `${role}: SFC nav entry`);
  check(await page.getByTestId('sfc-hq-option').first().waitFor({ timeout: 15000 }).then(() => true, () => false), `${role}: SFC page opens`);
  check((await page.locator('a[href="/settings/allowances"]').count()) === 0, `${role}: no TA/DA rates entry`);
  await ctx.close();
}
{
  const { ctx, page } = await open('system_admin', '/settings/allowances', 'desktop');
  await page.waitForTimeout(2500);
  check(!/settings\/allowances/.test(page.url()) || (await page.getByText(/not found|404/i).count()) > 0, `old TA/DA rates page is gone (${new URL(page.url()).pathname})`);
  await ctx.close();
}

for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open('area_business_manager', '/sfc', view);
  await page.getByTestId('sfc-hq-option').first().waitFor({ timeout: 20000 });
  const areas = await texts(page, 'sfc-area-name');
  const hqs = await texts(page, 'sfc-hq-option');
  check(areas.length === 1 && areas[0] === 'Burdwan Area', `${view}: Burdwan ABM sees only Burdwan Area (${areas})`);
  check(hqs.length === 2 && hqs.some((h) => /Bmch/.test(h)) && hqs.some((h) => /Anamoy/.test(h)), `${view}: both Burdwan HQs listed`);
  await page.getByTestId('sfc-hq-search').fill('anamoy');
  check((await page.getByTestId('sfc-hq-option').count()) === 1, `${view}: HQ search filters`);
  await page.getByTestId('sfc-hq-search').fill('');
  await page.getByTestId('sfc-hq-option').filter({ hasText: 'Bmch' }).click();
  await page.getByTestId('sfc-emp').first().waitFor();
  const emps = await texts(page, 'sfc-emp');
  check(emps.length === 2 && emps.every((e) => /Demo BM Bmch/.test(e)), `${view}: employees under me at Bmch (${emps.length})`);
  await page.getByTestId('sfc-emp').filter({ hasText: /^Demo BM Bmch(?! New)/ }).first().click();
  await page.getByTestId('sfc-tab-tada').waitFor();
  check((await page.getByTestId('sfc-tab-tada').textContent()) === 'TA/DA', `${view}: TA/DA tab`);
  await page.getByTestId('sfc-row').first().waitFor();
  const cols = await texts(page, 'sfc-col');
  check(JSON.stringify(cols) === JSON.stringify(COLS), `${view}: columns match the SFC format plus DA`);
  check(/2\.95/.test(await page.getByTestId('sfc-rate').textContent()), `${view}: rate 2.95 per km shown`);
  const n0 = await page.getByTestId('sfc-row').count();
  check(n0 === 9, `${view}: seeded routes (${n0})`);
  // Row 2: KATWA 65 km -> 191.75 / 383.50, both-way 130.
  check((await texts(page, 'sfc-amt1'))[1] === '191.75' && (await texts(page, 'sfc-amt2'))[1] === '383.50' && (await texts(page, 'sfc-km2'))[1] === '130', `${view}: 65 km -> 191.75 one way, 383.50 both way, 130 km`);
  const last = n0 - 1;
  check((await texts(page, 'sfc-amt1'))[last] === 'ACTUAL FARE' && (await texts(page, 'sfc-amt2'))[last] === 'ACTUAL FARE', `${view}: ACTUAL FARE row shows text`);
  if (view === 'mobile') {
    const sticky = await page.locator('[data-testid=sfc-sl]').first().evaluate((e) => getComputedStyle(e).position);
    check(sticky === 'sticky', `${view}: first column is sticky`);
    const scrolls = await page.getByTestId('sfc-scroll').evaluate((e) => e.scrollWidth > e.clientWidth);
    check(scrolls, `${view}: table scrolls sideways`);
  }
  await noOverflow(page, `${view} sfc`);
  await noBannedWords(page, `${view} sfc`);
  await shot(page, `table-${view}.png`);

  // Add row: obvious labelled button; amounts fill as km is typed.
  const add = page.getByTestId('sfc-add');
  check((await add.isVisible()) && (await add.textContent()).includes('Add row'), `${view}: "Add row" button visible`);
  await add.click();
  check((await page.getByTestId('sfc-row').count()) === n0 + 1, `${view}: Add row adds a row`);
  const nr = page.getByTestId('sfc-row').last();
  await nr.getByTestId('sfc-to').fill('Memari');
  check((await nr.getByTestId('sfc-to').inputValue()) === 'MEMARI', `${view}: places edit in place (upper case)`);
  await nr.getByTestId('sfc-km').fill('3');
  check((await nr.getByTestId('sfc-amt1').textContent()) === '8.85', `${view}: 3 km -> 8.85 as you type`);
  await nr.getByTestId('sfc-km').fill('35');
  check((await nr.getByTestId('sfc-amt1').textContent()) === '103.25' && (await nr.getByTestId('sfc-amt2').textContent()) === '206.50' && (await nr.getByTestId('sfc-km2').textContent()) === '70', `${view}: 35 km -> 103.25 / 206.50 / 70 km`);
  await nr.getByTestId('sfc-mode').selectOption('BUS');
  await nr.getByTestId('sfc-cat').selectOption('EX / OS');
  await nr.getByTestId('sfc-da').fill('250');
  check((await nr.getByTestId('sfc-da').inputValue()) === '250', `${view}: DA is editable`);
  await nr.getByTestId('sfc-actual').check();
  check((await nr.getByTestId('sfc-amt1').textContent()) === 'ACTUAL FARE', `${view}: actual fare toggle`);
  await nr.getByTestId('sfc-actual').uncheck();
  check(await page.getByTestId('sfc-unsaved').isVisible(), `${view}: unsaved changes marked`);

  // Reorder: move the new row up one, then delete row 3 (KANDRA).
  await nr.getByTestId('sfc-up').click();
  let tos = await vals(page, 'sfc-to');
  check(tos[n0 - 1] === 'MEMARI' && tos[n0] === 'KOLKATA', `${view}: row moved up`);
  check((await texts(page, 'sfc-sl'))[n0 - 1] === String(n0), `${view}: SL No follows order`);
  await page.getByTestId('sfc-row').nth(2).getByTestId('sfc-del').click();
  tos = await vals(page, 'sfc-to');
  check(!tos.includes('KANDRA') && tos.length === n0, `${view}: row deleted`);

  // Unsaved warning: switching employee asks first; Keep editing keeps the rows.
  await page.getByTestId('sfc-emp').filter({ hasText: 'New' }).click();
  await page.getByTestId('sfc-discard').waitFor();
  check(true, `${view}: unsaved warning on switching employee`);
  await page.getByTestId('sfc-discard-cancel').click();
  check((await vals(page, 'sfc-to')).includes('MEMARI'), `${view}: Keep editing keeps changes`);

  // Save.
  await page.getByTestId('sfc-save').click();
  check(await page.getByText('SFC saved for Demo BM Bmch').first().waitFor({ timeout: 8000 }).then(() => true, () => false), `${view}: toast after save`);
  check((await page.getByTestId('sfc-unsaved').count()) === 0 && (await vals(page, 'sfc-da')).includes('250'), `${view}: refreshed after save, DA kept`);

  await page.mouse.move(1, 1);
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  // 422: distance over 2000 km.
  await page.getByTestId('sfc-row').nth(1).getByTestId('sfc-km').fill('5000');
  await page.getByTestId('sfc-save').click();
  await page.getByTestId('sfc-error').waitFor({ timeout: 8000 });
  check((await page.getByTestId('sfc-error').getAttribute('data-kind')) === 'invalid' && /Row 2/.test(await page.getByTestId('sfc-error').textContent()), `${view}: validation error names the row`);
  await page.getByTestId('sfc-reset').click();

  // 409: someone else saves first.
  const st = await page.evaluate(async (api) => {
    const h = { 'x-mock-user': 'area_business_manager', 'content-type': 'application/json' };
    const s = await (await fetch(`${api}/v1/sfc/sfc-u-bmch`, { headers: h })).json();
    const rows = s.rows.map((r, i) => (i === 0 ? { ...r, da: 'Elsewhere' } : r));
    return (await fetch(`${api}/v1/sfc/sfc-u-bmch`, { method: 'PUT', headers: h, body: JSON.stringify({ version: s.version, rows }) })).status;
  }, API);
  check(st === 200, `${view}: concurrent save applied (${st})`);
  await page.getByTestId('sfc-row').nth(1).getByTestId('sfc-da').fill('100');
  await page.getByTestId('sfc-save').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=sfc-error]')?.dataset.kind === 'conflict', null, { timeout: 8000 });
  check(/Someone else saved/.test(await page.getByTestId('sfc-error').textContent()), `${view}: 409 shows a clear message`);
  const reloaded = await page.waitForFunction(() => document.querySelector('[data-testid=sfc-da]')?.value === 'Elsewhere', null, { timeout: 8000 }).then(() => true, () => false);
  check(reloaded, `${view}: latest version reloaded`);
  await shot(page, `conflict-${view}.png`);

  // Discard path: edit, switch HQ, confirm discard.
  await page.getByTestId('sfc-row').first().getByTestId('sfc-da').fill('x');
  await page.getByTestId('sfc-hq-option').filter({ hasText: 'Anamoy' }).click();
  await page.getByTestId('sfc-discard-ok').click();
  await page.getByTestId('sfc-emp').first().waitFor();
  check((await page.getByTestId('sfc-step-table').count()) === 0 && (await texts(page, 'sfc-emp')).length === 1, `${view}: discard moves to the other HQ`);
  await ctx.close();
}
await finish();
