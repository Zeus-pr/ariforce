// System Admin "People" (/admin/people): gating, server search/filters/paging, edit sheet for every
// field kind, confirm dialogs, version conflict, validation, HQ picker (empty HQ), outranking manager.
// Mock mode; every write goes to MSW.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/admin-people-evidence.mjs
import { setup } from './lib.mjs';

const { check, open, shot, noOverflow, noBannedWords, finish } = await setup('admin-people');
const API = process.env.MOCK_API_URL ?? 'http://localhost:4000';
const rows = (page) => page.getByTestId('people-row');
const waitRows = (page, pred, label) =>
  page.waitForFunction(pred, null, { timeout: 10000 }).then(() => true, () => { console.log('timeout', label); return false; });
const pick = async (page, trigger, name) => {
  await page.getByTestId(trigger).click();
  await page.getByRole('option', { name, exact: true }).click();
};
const row = (page, name) => rows(page).filter({ hasText: name });
const openPerson = async (page, name) => {
  await page.getByTestId('people-q').fill(name);
  await waitRows(page, `[...document.querySelectorAll('[data-testid=people-row]')].length === 1`, `search ${name}`);
  await row(page, name).getByTestId('people-open').click();
  await page.getByTestId('person-sheet').waitFor();
};
const clearSearch = async (page) => {
  await page.getByTestId('people-q').fill('');
  await waitRows(page, `document.querySelectorAll('[data-testid=people-row]').length > 1`, 'clear');
};

// Gating: other roles get no entry and are sent home.
for (const role of ['director', 'business_manager', 'area_business_manager']) {
  const { ctx, page } = await open(role, '/admin/people', 'desktop');
  await page.waitForTimeout(2500);
  check((await page.locator('a[href="/admin/people"]').count()) === 0, `${role}: no People nav entry`);
  check((await page.getByTestId('people-q').count()) === 0 && !/\/admin\/people/.test(page.url()), `${role}: redirected away (${new URL(page.url()).pathname})`);
  await ctx.close();
}

for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open('system_admin', '/admin/people?limit=5', view);
  await rows(page).first().waitFor({ timeout: 20000 });
  if (view === 'desktop')
    check(await page.locator('a[href="/admin/people"]').first().waitFor({ state: 'attached', timeout: 10000 }).then(() => true, () => false), 'sysadmin: People nav entry');
  check((await rows(page).count()) === 5, `${view}: first server page is 5 rows`);
  await page.getByTestId('people-more').click();
  check(await waitRows(page, `document.querySelectorAll('[data-testid=people-row]').length === 10`, 'more'), `${view}: Show more appends the next page`);
  await noOverflow(page, `${view} list`);
  await noBannedWords(page, `${view} list`);
  await shot(page, `list-${view}.png`);

  // Search + filters (server-side).
  await page.getByTestId('people-q').fill('ACC001');
  check(await waitRows(page, `(() => { const r = [...document.querySelectorAll('[data-testid=people-row]')]; return r.length === 1 && /Demo Accountant/.test(r[0].textContent) && /Other role/.test(r[0].textContent); })()`, 'q'), `${view}: search by employee code; retired role shows a neutral label`);
  await page.getByTestId('people-q').fill('');
  await pick(page, 'people-f-status', 'Invited');
  check(await waitRows(page, `(() => { const r = [...document.querySelectorAll('[data-testid=people-status]')]; return r.length >= 2 && r.every((x) => x.textContent === 'Invited'); })()`, 'status'), `${view}: status filter`);
  await pick(page, 'people-f-status', 'Any status');
  await page.getByTestId('people-f-role').click();
  check((await page.getByRole('option', { name: /Distribution Head|Accountant/ }).count()) === 0, `${view}: role filter has no Distribution Head or Accountant`);
  await page.keyboard.press('Escape');
  await pick(page, 'people-f-role', 'Director');
  check(await waitRows(page, `(() => { const r = [...document.querySelectorAll('[data-testid=people-role]')]; return r.length >= 1 && r.every((x) => x.textContent === 'Director'); })()`, 'role'), `${view}: role filter`);
  await pick(page, 'people-f-role', 'All roles');
  await pick(page, 'people-f-hq', 'Kolkata North HQ');
  check(await waitRows(page, `(() => { const r = [...document.querySelectorAll('[data-testid=people-row]')]; return r.length === 1 && /Nisha/.test(r[0].textContent); })()`, 'hq'), `${view}: HQ filter`);
  await pick(page, 'people-f-hq', 'All HQs');
  await pick(page, 'people-f-login', 'Signed in');
  check(await waitRows(page, `(() => { const r = [...document.querySelectorAll('[data-testid=people-login]')]; return r.length >= 5 && r.every((x) => x.textContent === 'Signed in'); })()`, 'login'), `${view}: sign-in filter`);
  await pick(page, 'people-f-login', 'Anyone');

  // Plain fields: name, phone, code, designation, joined date (no confirm needed).
  await openPerson(page, 'Nisha');
  await page.getByTestId('edit-name').fill(`Nisha Rao ${view}`);
  await page.getByTestId('edit-phone').fill('9812345678');
  await page.getByTestId('edit-code').fill(`EMP-N-${view}`);
  check((await page.getByTestId('edit-email').count()) === 1, `${view}: email editable for someone with no login`);
  await page.getByTestId('edit-email').fill(`nisha.${view}@demo.ariforce.test`);
  await page.getByTestId('edit-designation').fill('Medical Representative');
  await page.getByTestId('edit-joined').fill('2026-04-01');
  check((await page.getByTestId('edit-status-readonly').count()) === 1, `${view}: invited person's status is read-only`);
  await page.getByTestId('edit-save').click();
  await page.getByTestId('person-sheet').waitFor({ state: 'detached', timeout: 10000 });
  check(await page.getByText(`Saved Nisha Rao ${view}`).first().waitFor({ timeout: 5000 }).then(() => true, () => false), `${view}: toast after save`);
  check(await waitRows(page, `[...document.querySelectorAll('[data-testid=people-code]')].some((x) => x.textContent === 'EMP-N-${view}')`, 'row refresh'), `${view}: row refreshed with new code`);

  // HQ picker with an empty HQ, and outranking-manager list; HQ change asks to confirm.
  await openPerson(page, `Nisha Rao ${view}`);
  await page.getByTestId('edit-hq-search').fill('Howrah');
  await page.getByTestId('edit-hq-option').filter({ hasText: 'Howrah HQ' }).click();
  check(/Howrah HQ/.test(await page.getByTestId('edit-hq-current').textContent()), `${view}: empty HQ (Howrah) picked`);
  await page.getByTestId('edit-manager-search-option').first().waitFor();
  const mgrOpts = await page.getByTestId('edit-manager-search-option').allTextContents();
  check(mgrOpts.length > 0 && mgrOpts.every((t) => !/· Business Manager ·|· Accountant ·|· System Admin ·/.test(t)), `${view}: manager list only outranks BM (${mgrOpts.length})`);
  check((await page.getByTestId('edit-manager-hint').textContent()).includes('will also see'), `${view}: manager scope hint`);
  await page.getByTestId('edit-manager-search-option').filter({ hasText: 'Demo Regional Business Manager' }).click();
  await page.getByTestId('edit-save').click();
  await page.getByTestId('edit-confirm').waitFor();
  const conf = await page.getByTestId('edit-confirm-list').textContent();
  check(/different HQ/.test(conf) && /new manager/.test(conf) && /first approval/.test(conf) && /next action/.test(conf), `${view}: confirm lists HQ and manager change`);
  await page.getByTestId('edit-confirm-ok').click();
  await page.getByTestId('person-sheet').waitFor({ state: 'detached', timeout: 10000 });
  check(await waitRows(page, `[...document.querySelectorAll('[data-testid=people-hq]')].some((x) => x.textContent === 'Howrah HQ')`, 'hq row'), `${view}: row shows Howrah HQ`);

  // Role change: confirm, go back, then confirm for real.
  await clearSearch(page);
  await openPerson(page, 'Demo Distribution Head');
  await page.getByTestId('edit-role').click();
  check((await page.getByRole('option', { name: /Distribution Head|Accountant/ }).count()) === 0, `${view}: role picker has no Distribution Head or Accountant`);
  await page.keyboard.press('Escape');
  await pick(page, 'edit-role', 'System Admin');
  await page.getByTestId('edit-save').click();
  await page.getByTestId('edit-confirm').waitFor();
  check(/Change role from Other role to System Admin/.test(await page.getByTestId('edit-confirm-list').textContent()) && /every device/.test(await page.getByTestId('edit-confirm-list').textContent()), `${view}: role change asks to confirm and warns about sign-out`);
  await shot(page, `confirm-role-${view}.png`);
  await page.getByTestId('edit-confirm-cancel').click();
  check((await page.getByTestId('person-sheet').count()) === 1, `${view}: Go back keeps the sheet open, nothing saved`);
  await page.getByTestId('edit-save').click();
  await page.getByTestId('edit-confirm-ok').click();
  await page.getByTestId('person-sheet').waitFor({ state: 'detached', timeout: 10000 });
  check(await waitRows(page, `[...document.querySelectorAll('[data-testid=people-role]')].some((x) => x.textContent === 'System Admin') && [...document.querySelectorAll('[data-testid=people-row]')].length === 1`, 'role row'), `${view}: role saved`);

  // Suspend: confirm.
  await openPerson(page, 'Demo Distribution Head');
  check((await page.getByTestId('edit-email-readonly').count()) === 1 && (await page.getByTestId('edit-email').count()) === 0, `${view}: email read-only once they sign in`);
  check((await page.getByTestId('edit-functional').count()) === 1 && (await page.getByTestId('edit-hq-search').count()) === 0, `${view}: functional role has no HQ/manager fields`);
  await pick(page, 'edit-status', 'Suspended');
  await page.getByTestId('edit-save').click();
  await page.getByTestId('edit-confirm').waitFor();
  check(/Suspend Demo Distribution Head.*every device/.test(await page.getByTestId('edit-confirm-list').textContent()), `${view}: suspend asks to confirm and warns about sign-out`);
  await page.getByTestId('edit-confirm-ok').click();
  await page.getByTestId('person-sheet').waitFor({ state: 'detached', timeout: 10000 });
  check(await waitRows(page, `[...document.querySelectorAll('[data-testid=people-status]')].some((x) => x.textContent === 'Suspended')`, 'susp'), `${view}: suspended chip`);
  // Reactivate puts it back.
  await openPerson(page, 'Demo Distribution Head');
  await pick(page, 'edit-status', 'Active');
  await page.getByTestId('edit-save').click();
  check(/Reactivate Demo Distribution Head/.test(await page.getByTestId('edit-confirm-list').textContent()), `${view}: reactivate asks to confirm`);
  await page.getByTestId('edit-confirm-ok').click();
  await page.getByTestId('person-sheet').waitFor({ state: 'detached', timeout: 10000 });
  check(await waitRows(page, `[...document.querySelectorAll('[data-testid=people-status]')].some((x) => x.textContent === 'Active')`, 'react'), `${view}: reactivated`);

  // 422 MANAGER_RANK: ABM to RBM while keeping their RBM manager.
  await openPerson(page, 'Demo Area Business Manager');
  await pick(page, 'edit-role', 'Regional Business Manager');
  await page.getByTestId('edit-hq-option').first().click();
  await page.getByTestId('edit-save').click();
  await page.getByTestId('edit-confirm-ok').click();
  await page.getByTestId('edit-error').waitFor({ timeout: 10000 });
  check(/Pick a new manager/.test(await page.getByTestId('edit-error').textContent()), `${view}: MANAGER_RANK asks for a new manager`);
  await page.keyboard.press('Escape');
  await page.getByTestId('person-sheet').waitFor({ state: 'detached', timeout: 10000 });

  // 422 REPORTS_OUTRANK: ZBM down to BM while an RBM still reports to them; names are listed.
  await openPerson(page, 'Demo Zonal Business Manager');
  await pick(page, 'edit-role', 'Business Manager');
  await page.getByTestId('edit-hq-search').fill('Howrah');
  await page.getByTestId('edit-hq-option').filter({ hasText: 'Howrah HQ' }).click();
  await page.getByTestId('edit-save').click();
  await page.getByTestId('edit-confirm-ok').click();
  await page.getByTestId('edit-error-reports').waitFor({ timeout: 10000 });
  check(/Move them to another manager first/.test(await page.getByTestId('edit-error').textContent()) && /Demo Regional Business Manager/.test(await page.getByTestId('edit-error-reports').textContent()), `${view}: REPORTS_OUTRANK names the reports (${await page.getByTestId('edit-error-reports').textContent()})`);
  await shot(page, `reports-outrank-${view}.png`);
  await page.keyboard.press('Escape');
  await page.getByTestId('person-sheet').waitFor({ state: 'detached', timeout: 10000 });

  // 422 from the server: bad phone.
  await openPerson(page, 'Demo Area Business Manager');
  await page.getByTestId('edit-phone').fill('abc');
  await page.getByTestId('edit-save').click();
  await page.getByTestId('edit-error').waitFor({ timeout: 10000 });
  check((await page.getByTestId('edit-error').getAttribute('data-kind')) === 'invalid', `${view}: validation error shown (${await page.getByTestId('edit-error').textContent()})`);

  // 409: someone else saves first (direct PATCH in the page), then our save conflicts and reloads.
  const id = await row(page, 'Demo Area Business Manager').getAttribute('data-id');
  const status = await page.evaluate(async ([api, id]) => {
    const u = await (await fetch(`${api}/v1/users?q=abm@demo&limit=5`, { headers: { 'x-mock-user': 'system_admin' } })).json();
    const v = u.items.find((x) => x.id === id).version;
    const r = await fetch(`${api}/v1/employees/${id}`, { method: 'PATCH', headers: { 'x-mock-user': 'system_admin', 'content-type': 'application/json' }, body: JSON.stringify({ version: v, designation: 'Changed elsewhere' }) });
    return r.status;
  }, [API, id]);
  check(status === 200, `${view}: concurrent change applied (${status})`);
  await page.getByTestId('edit-phone').fill('9800011111');
  await page.getByTestId('edit-save').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=edit-error]')?.dataset.kind === 'conflict', null, { timeout: 10000 });
  check(true, `${view}: 409 shows a conflict message`);
  check((await page.getByTestId('edit-designation').inputValue()) === 'Changed elsewhere', `${view}: latest record reloaded into the form`);
  await noOverflow(page, `${view} sheet`);
  await shot(page, `conflict-${view}.png`);
  await page.keyboard.press('Escape');
  await ctx.close();
}
await finish();
