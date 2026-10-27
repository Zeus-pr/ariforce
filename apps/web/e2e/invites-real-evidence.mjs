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
await finish();
