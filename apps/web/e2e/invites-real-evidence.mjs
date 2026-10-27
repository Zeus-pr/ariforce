// Real-mode (:3200) invite request/response shapes. Every call to the API (:4000) is intercepted
// with page.route and fulfilled locally: nothing reaches the real API or DB.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3200 node e2e/invites-real-evidence.mjs
import { setup, VIEWS } from './lib.mjs';

const { BASE, browser, check, finish } = await setup('invites-real');
const id = (n) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const T = '2026-10-27T08:00:00.000Z';
const node = (n, name, role, status, managerId, depth) => ({
  id: id(n), name, role, roles: [role], designation: null, employeeCode: `E${n}`, joinedOn: null, phone: null,
  email: `${name.split(' ')[0].toLowerCase()}@example.invalid`, status, managerId, depth,
  territories: [{ id: id(500 + n), name: `Fake HQ ${n}`, code: `F${n}`, city: null, state: null }],
  version: 1, createdAt: T, updatedAt: T,
});
const TEAM = {
  rootId: id(99),
  nodes: [
    node(99, 'Shape Check', 'area_business_manager', 'active', null, 0),
    node(1, 'Fake Invitee', 'business_manager', 'invited', id(99), 1),
    node(2, 'Fake Active', 'business_manager', 'active', id(99), 1),
  ],
  unassigned: [],
};

for (const mode of ['link', 'email']) {
  const ctx = await browser.newContext(VIEWS.desktop);
  await ctx.addInitScript(() => {
    sessionStorage.setItem('af:splash-seen', '1');
    localStorage.setItem('af:mock-session', JSON.stringify({ userId: '00000000-0000-7000-8000-000000000099', role: 'area_business_manager', user: { id: '00000000-0000-7000-8000-000000000099', name: 'Shape Check', email: 'shape@example.invalid', role: 'area_business_manager', territory: 'Test' } }));
  });
  const p = await ctx.newPage();
  const seen = [];
  const leaked = [];
  let accept = null;
  await p.route(/^http:\/\/localhost:4000\//, async (r) => {
    const u = new URL(r.request().url());
    const m = r.request().method();
    const json = (b, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (m === 'GET' && u.pathname === '/v1/team') return json(TEAM);
    const inv = u.pathname.match(/^\/v1\/employees\/([^/]+)\/invite$/);
    if (m === 'POST' && inv) {
      seen.push(inv[1]);
      return json({ id: id(900 + seen.length), userId: inv[1], expiresAt: '2026-11-03T08:00:00.000Z',
        inviteUrl: mode === 'link' ? `/invite?token=${'t'.repeat(40)}${seen.length}` : null }, 201);
    }
    if (m === 'POST' && u.pathname === '/v1/invites/accept') {
      accept = r.request().postDataJSON();
      return json({ userId: id(1), email: 'fake@example.invalid' });
    }
    if (m === 'GET') return json({ items: [], nextCursor: null });
    leaked.push(`${m} ${u.pathname}`);
    return json({ error: { code: 'FORBIDDEN', message: 'stubbed' } }, 403);
  });
  await p.goto(`${BASE}/my-team`, { waitUntil: 'load' });
  await p.getByTestId('invite-all').waitFor({ timeout: 20000 });
  check((await p.getByTestId('invite-all').textContent()).includes('(1)'), `${mode}: one pending invitee from status=invited`);
  await p.getByTestId('tree-node').filter({ hasText: 'Fake Invitee' }).getByTestId('node-name').click();
  await p.getByTestId('invite-send').click();
  if (mode === 'link') {
    await p.getByTestId('invite-url').waitFor();
    const url = await p.getByTestId('invite-url').inputValue();
    check(seen[0] === id(1), `${mode}: POST /v1/employees/{id}/invite with the person's id`);
    check(url.startsWith(`${BASE}/invite?token=`), `${mode}: relative inviteUrl made absolute (${url.slice(0, 40)}…)`);
    check((await p.getByTestId('invite-expiry').textContent()).length > 5, `${mode}: expiry text`);
    // The accept page in real mode: body shape.
    const q = await ctx.newPage();
    await q.route(/^http:\/\/localhost:4000\//, (r) => {
      accept = r.request().postDataJSON();
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ userId: id(1), email: 'fake@example.invalid' }) });
    });
    await q.goto(url, { waitUntil: 'load' });
    await q.getByTestId('invite-form').waitFor({ timeout: 15000 });
    await q.getByTestId('invite-password').fill('Fake!Throwaway99');
    await q.getByTestId('invite-password2').fill('Fake!Throwaway99');
    await q.getByTestId('invite-submit').click();
    await q.getByTestId('invite-done').waitFor({ timeout: 10000 });
    check(accept && accept.token === `${'t'.repeat(40)}1` && accept.password === 'Fake!Throwaway99' && Object.keys(accept).length === 2, `${mode}: POST /v1/invites/accept {token,password}`);
    // 404 from accept → invalid state.
    await q.unroute(/^http:\/\/localhost:4000\//);
    await q.route(/^http:\/\/localhost:4000\//, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INVITE_INVALID', message: 'Invalid' } }) }));
    await q.goto(url, { waitUntil: 'load' });
    await q.getByTestId('invite-password').fill('Fake!Throwaway99');
    await q.getByTestId('invite-password2').fill('Fake!Throwaway99');
    await q.getByTestId('invite-submit').click();
    await q.getByTestId('invite-invalid').waitFor({ timeout: 10000 });
    check(true, `${mode}: accept 404 → "no longer works" state`);
  } else {
    await p.getByTestId('invite-emailed').waitFor({ timeout: 10000 });
    check((await p.getByTestId('invite-url').count()) === 0, `${mode}: inviteUrl null → "sent by email" message, no link box`);
  }
  check(leaked.length === 0, `${mode}: no unexpected writes (${leaked.join(', ') || 'none'})`);
  await ctx.close();
}
// Bulk: 205 rows → two POST /v1/employees/invite-bulk calls (200 + 5), per-row results with offset indexes.
{
  const ctx = await browser.newContext(VIEWS.desktop);
  await ctx.addInitScript(() => {
    sessionStorage.setItem('af:splash-seen', '1');
    localStorage.setItem('af:mock-session', JSON.stringify({ userId: '00000000-0000-7000-8000-000000000099', role: 'area_business_manager', user: { id: '00000000-0000-7000-8000-000000000099', name: 'Shape Check', email: 'shape@example.invalid', role: 'area_business_manager', territory: 'Test' } }));
  });
  const p = await ctx.newPage();
  const bodies = [];
  const leaked = [];
  await p.route(/^http:\/\/localhost:4000\//, async (r) => {
    const u = new URL(r.request().url());
    const m = r.request().method();
    const json = (b, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (m === 'GET' && u.pathname === '/v1/team') return json(TEAM);
    if (m === 'POST' && u.pathname === '/v1/employees/invite-bulk') {
      const b = r.request().postDataJSON();
      bodies.push(b);
      const results = b.employees.map((e, index) => {
        const skip = e.email.startsWith('dup');
        const bad = e.email.startsWith('bad');
        return { index, email: e.email, status: skip ? 'skipped' : bad ? 'failed' : 'invited', code: skip ? 'CONFLICT' : bad ? 'VALIDATION' : null,
          message: skip ? 'Email already exists' : bad ? 'Territory outside your team' : null, employeeId: skip || bad ? null : id(2000 + index),
          inviteId: null, inviteUrl: skip || bad ? null : `/invite?token=${'b'.repeat(40)}${bodies.length}-${index}` };
      });
      const n = (s) => results.filter((x) => x.status === s).length;
      return json({ results, summary: { invited: n('invited'), skipped: n('skipped'), failed: n('failed') } });
    }
    if (m === 'GET') return json({ items: [], nextCursor: null });
    leaked.push(`${m} ${u.pathname}`);
    return json({ error: { code: 'FORBIDDEN', message: 'stubbed' } }, 403);
  });
  await p.goto(`${BASE}/my-team`, { waitUntil: 'load' });
  await p.getByTestId('add-several').waitFor({ timeout: 20000 });
  await p.getByTestId('add-several').click();
  const lines = Array.from({ length: 205 }, (_, i) => `Fake Person ${i}, ${i === 201 ? 'dup' : i === 203 ? 'bad' : 'p'}${i}@example.invalid`);
  await p.getByTestId('bulk-text').fill(lines.join('\n'));
  check((await p.getByTestId('bulk-count').textContent()).includes('2 batches'), 'bulk: 205 rows announced as 2 batches');
  await p.getByTestId('bulk-confirm').click();
  await p.getByTestId('bulk-summary').waitFor({ timeout: 20000 });
  check(bodies.length === 2 && bodies[0].employees.length === 200 && bodies[1].employees.length === 5, `bulk: chunked 200 + 5 (${bodies.map((b) => b.employees.length).join('+')})`);
  const e0 = bodies[0].employees[0];
  check(e0.name === 'Fake Person 0' && e0.role === 'business_manager' && e0.territoryIds.length === 1 && e0.managerId === id(99) && e0.phone === null, 'bulk: EmployeeCreate shape (role, territoryIds, managerId)');
  check((await p.getByTestId('bulk-summary').textContent()).includes('203 invited · 1 skipped · 1 failed'), 'bulk: summary summed across chunks');
  check((await p.getByTestId('bulk-row').count()) === 205, 'bulk: one result row per person');
  const dup = p.locator('[data-testid=bulk-row][data-status=skipped]');
  check((await dup.textContent()).includes('Fake Person 201') && (await dup.textContent()).includes('already exists'), 'bulk: skipped row mapped to the right person (offset index)');
  check((await p.locator('[data-testid=bulk-row][data-status=failed]').textContent()).includes('Fake Person 203'), 'bulk: failed row shows reason');
  const last = await p.locator('[data-testid=bulk-row]').last().getByTestId('invite-url').inputValue();
  check(last.startsWith(`${BASE}/invite?token=`), 'bulk: relative inviteUrl made absolute');
  check(leaked.length === 0, `bulk: no unexpected writes (${leaked.join(', ') || 'none'})`);
  await ctx.close();
}

// Accept errors: distinct messages per code.
{
  const ctx = await browser.newContext(VIEWS.desktop);
  await ctx.addInitScript(() => sessionStorage.setItem('af:splash-seen', '1'));
  const q = await ctx.newPage();
  const cases = [
    [404, 'INVITE_INVALID', 'invite-invalid', 'not valid'],
    [409, 'INVITE_USED', 'invite-used', 'already used'],
    [410, 'INVITE_EXPIRED', 'invite-expired', 'expired'],
    [422, 'VALIDATION', 'invite-error', 'at least 12'],
    [429, 'RATE_LIMITED', 'invite-error', 'try again in 42 seconds'],
    [403, 'ACCOUNT_SUSPENDED', 'invite-error', 'suspended. Contact your administrator'],
  ];
  for (const [status, code, tid, text] of cases) {
    await q.unroute(/^http:\/\/localhost:4000\//).catch(() => {});
    await q.route(/^http:\/\/localhost:4000\//, (r) => r.fulfill({ status, contentType: 'application/json',
      headers: status === 429 ? { 'Retry-After': '42', 'Access-Control-Expose-Headers': 'Retry-After' } : {},
      body: JSON.stringify({ error: { code, message: code === 'VALIDATION' ? 'Password must be at least 12 characters' : code, details: status === 429 ? { retryAfterSeconds: 42 } : undefined } }) }));
    await q.goto(`${BASE}/invite?token=${'t'.repeat(40)}`, { waitUntil: 'load' });
    await q.getByTestId('invite-form').waitFor({ timeout: 15000 });
    await q.getByTestId('invite-password').fill('Fake!Throwaway99');
    await q.getByTestId('invite-password2').fill('Fake!Throwaway99');
    await q.getByTestId('invite-submit').click();
    await q.getByTestId(tid).waitFor({ timeout: 10000 });
    check((await q.getByTestId(tid).textContent()).includes(text), `accept ${status} ${code} → "${text}"`);
  }
  await q.getByTestId('invite-password').fill('elevenchars');
  await q.getByTestId('invite-password2').fill('elevenchars');
  await q.getByTestId('invite-submit').click();
  check((await q.getByTestId('invite-error').textContent()).includes('12'), 'accept: 11 chars blocked client-side (min 12)');
  await ctx.close();
}
await finish();
