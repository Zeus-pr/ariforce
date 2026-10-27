// Searchable server-side pickers (#26 approval status): DCR call picker (search, paging, region filter,
// approval badge) and Tour Plan planned doctors/chemists. Mock mode.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/pickers-evidence.mjs
import { setup } from './lib.mjs';

const { BASE, check, open, shot, noOverflow, noBannedWords, finish } = await setup('pickers');
const pick = async (page, trigger, name) => {
  await page.getByTestId(trigger).click();
  await (name ? page.getByRole('option', { name, exact: true }) : page.getByRole('option').first()).click();
};
// Field-added doctors (RBM creator) are created pending in the mock; copies of the first doctor's territory.
const seed = (page, names, territoryOf) =>
  page.evaluate(async ([names, territoryOf]) => {
    const h = { 'content-type': 'application/json', 'x-mock-user': 'regional_business_manager' };
    const base = 'http://localhost:4000/v1/doctors';
    let list;
    for (let i = 0; i < 20 && !list?.items; i++) {
      list = await (await fetch(`${base}?limit=1`, { headers: h })).json().catch(() => null);
      if (!list?.items) await new Promise((r) => setTimeout(r, 300));
    }
    const { id, version, createdAt, updatedAt, deletedAt, approvalStatus, ...rest } = list.items[0];
    if (territoryOf) {
      const me = await (await fetch('http://localhost:4000/v1/me', { headers: { 'x-mock-user': territoryOf } })).json();
      if (me.territoryIds?.[0]) rest.territoryId = me.territoryIds[0];
    }
    let out;
    for (const [i, name] of names.entries()) {
      const r = await fetch(base, { method: 'POST', headers: h, body: JSON.stringify({ ...rest, name, registrationNo: `PK${Date.now()}${i}`, pincode: `70009${i}` }) });
      out ??= { status: r.status, body: await r.json() };
    }
    return out;
  }, [names, territoryOf]);
const opts = (page, id) => page.getByTestId(`${id}-option`);

for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open('director', '/', view);
  await page.goto(`${BASE}/dcr`, { waitUntil: 'load' });
  await page.getByTestId('dcr-wt').waitFor({ timeout: 20000 });
  // A field-added doctor (RBM creator) is created pending in the mock.
  const created = await seed(page, ['Dr Pickertest Pending', 'Dr Pagefill One', 'Dr Pagefill Two']);
  check(created.status === 201 && created.body.approvalStatus === 'pending', `${view}: RBM-added doctor is pending (${created.status} ${created.body.approvalStatus ?? JSON.stringify(created.body.error)})`);

  await pick(page, 'dcr-wt', 'Field work');
  await pick(page, 'dcr-terr');
  await page.getByTestId('dcr-add-call').click();
  await opts(page, 'call-doctor').first().waitFor({ timeout: 15000 });
  check((await opts(page, 'call-doctor').count()) === 2, `${view}: first server page (2 rows in mock)`);
  if (await page.getByTestId('call-doctor-more').count()) {
    await page.getByTestId('call-doctor-more').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=call-doctor-option]').length > 2, null, { timeout: 10000 });
    check(true, `${view}: "Show more" loads the next page`);
  } else check(false, `${view}: expected more than one page of doctors`);
  // Region filter: everything in scope finds the pending doctor; search is server-side.
  await pick(page, 'call-area', 'All my territories');
  await page.getByTestId('call-doctor-search').fill('Pickertest');
  await page.waitForFunction(() => { const o = document.querySelectorAll('[data-testid=call-doctor-option]'); return o.length === 1 && o[0].textContent.includes('Pickertest'); }, null, { timeout: 10000 });
  check(true, `${view}: debounced server search finds the doctor`);
  check((await page.getByTestId('call-doctor-badge').first().textContent()) === 'Awaiting approval', `${view}: plain-text approval badge`);
  check((await page.locator('[data-testid=call-doctor] .rounded-full.size-2').count()) === 0, `${view}: no status dots`);
  await page.getByTestId('call-doctor-search').fill('zzzz-nobody');
  await page.getByTestId('call-doctor-empty').waitFor({ timeout: 10000 });
  check((await page.getByTestId('call-doctor-empty').textContent()).includes('No doctors found'), `${view}: empty state in plain words`);
  await page.getByTestId('call-doctor-search').fill('Pickertest');
  await opts(page, 'call-doctor').filter({ hasText: 'Pickertest' }).click();
  check((await opts(page, 'call-doctor').first().getAttribute('aria-selected')) === 'true', `${view}: option selected`);
  // Kind switch reloads the list from chemists.
  await shot(page, `dcr-picker-${view}.png`);
  await noOverflow(page, `${view} dcr picker`);
  await noBannedWords(page, `${view} dcr picker`);
  await page.getByTestId('call-product').first().click();
  await page.getByTestId('call-add').click();
  await page.getByTestId('dcr-call').first().waitFor();
  check((await page.getByTestId('dcr-call').first().textContent()).includes('Pickertest'), `${view}: picked doctor (beyond the first page) named on the call`);
  await page.getByTestId('dcr-add-call').click();
  await pick(page, 'call-kind', 'Chemist');
  await opts(page, 'call-doctor').first().waitFor({ timeout: 15000 });
  check((await page.getByTestId('call-doctor-badge').count()) === 0, `${view}: chemists carry no approval badge`);
  await page.keyboard.press('Escape');
  await ctx.close();

  // Tour plan: planned doctors and chemists for a field day.
  const t = await open('director', '/tour-plans', view);
  const p = t.page;
  await Promise.race([p.getByTestId('tp-start').waitFor({ timeout: 20000 }), p.getByTestId('tp-calendar').waitFor({ timeout: 20000 })]);
  if (await p.getByTestId('tp-start').count()) await p.getByTestId('tp-start').click();
  await p.getByTestId('tp-calendar').waitFor();
  await seed(p, ['Dr Planned One', 'Dr Planned Two']);
  await p.getByTestId('tp-day').nth(3).click();
  await pick(p, 'tp-wt', 'Field work');
  await pick(p, 'tp-terr', 'Kolkata North');
  await opts(p, 'tp-doctors').first().waitFor({ timeout: 15000 });
  await opts(p, 'tp-doctors').nth(0).click();
  await opts(p, 'tp-doctors').nth(1).click();
  check((await p.getByTestId('tp-doctors-chip').count()) === 2, `${view}: two doctors planned (chips)`);
  await opts(p, 'tp-chemists').first().waitFor({ timeout: 15000 });
  await opts(p, 'tp-chemists').first().click();
  await opts(p, 'tp-doctors').nth(1).click();
  check((await p.getByTestId('tp-doctors-chip').count()) === 1, `${view}: clicking again un-plans a doctor`);
  await shot(p, `tp-picker-${view}.png`);
  await noOverflow(p, `${view} tp picker`);
  await p.getByTestId('tp-save').click();
  await p.getByTestId('tp-editor').waitFor({ state: 'hidden' });
  await p.getByTestId('tp-day').nth(3).click();
  await p.getByTestId('tp-doctors-chip').first().waitFor({ timeout: 10000 });
  check((await p.getByTestId('tp-doctors-chip').count()) === 1 && (await p.getByTestId('tp-chemists-chip').count()) === 1, `${view}: planned doctor + chemist kept after save and reopen`);
  check(!(await p.getByTestId('tp-doctors-chip').first().textContent()).includes('Selected earlier'), `${view}: reopened chips show names`);
  await t.ctx.close();
}
await finish();
