// Employee invites (mock): My Team "No login yet" -> Send invite / Re-invite (copyable link, expiry),
// Invite all pending (copy all), and the public /invite page (set password, token stripped, used/old/missing links).
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/invites-evidence.mjs
import { setup } from './lib.mjs';

const { BASE, BROWSER, check, open, shot, noOverflow, noBannedWords, finish } = await setup('invites');
const PW = 'Kolkata-Field-2026!';
const extra = BROWSER === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {};

for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open('area_business_manager', '/my-team', view, extra);
  await page.getByTestId('org-tree').waitFor({ timeout: 20000 });
  const all = page.getByTestId('invite-all');
  check((await all.textContent()).includes('(1)'), `${view}: "Invite all pending (1)" for the ABM's subtree`);
  const riya = page.getByTestId('tree-node').filter({ hasText: 'Riya Sarkar' });
  check((await riya.getByTestId('node-no-login').count()) === 1, `${view}: tree marks "No login yet"`);
  await riya.getByTestId('node-name').click();
  await page.getByTestId('invite-box').waitFor();
  check((await page.getByTestId('invite-send').textContent()).includes('Send invite'), `${view}: sheet offers Send invite`);
  await page.getByTestId('invite-send').click();
  const url = page.getByTestId('invite-url');
  await url.waitFor();
  const first = await url.inputValue();
  check(/\/invite\?token=mock-web-invite-[0-9a-f]{36}$/.test(first), `${view}: invite link shown`);
  check(/Expires .*2026|Expires/.test(await page.getByTestId('invite-expiry').textContent()), `${view}: expiry text shown`);
  await page.getByTestId('invite-copy').click();
  await page.getByTestId('invite-copy').filter({ hasText: 'Copied' }).waitFor({ timeout: 3000 }).catch(() => {});
  check((await page.getByTestId('invite-copy').textContent()).includes('Copied'), `${view}: copy button confirms`);
  check((await page.getByTestId('invite-send').textContent()).includes('Re-invite'), `${view}: button becomes Re-invite`);
  await page.getByTestId('invite-send').click();
  await page.waitForFunction((a) => document.querySelector('[data-testid=invite-url]')?.value !== a, first);
  const second = await url.inputValue();
  check(second !== first, `${view}: re-invite issues a new link`);
  await noOverflow(page, `${view} invite sheet`);
  await shot(page, `sheet-${view}.png`);
  await page.keyboard.press('Escape');

  await all.click();
  await page.getByTestId('invite-all-confirm').click();
  await page.getByTestId('invite-all-row').first().waitFor();
  check((await page.getByTestId('invite-all-row').count()) === 1 && (await page.getByTestId('invite-all-row').getByTestId('invite-url').count()) === 1, `${view}: invite-all lists name + link`);
  const third = await page.getByTestId('invite-all-row').getByTestId('invite-url').inputValue();
  await shot(page, `invite-all-${view}.png`);
  await page.keyboard.press('Escape');

  // The invitee opens the link (same browser profile, so the mock token store is shared).
  const inv = await ctx.newPage();
  await inv.goto(third, { waitUntil: 'load' });
  await inv.getByTestId('invite-form').waitFor({ timeout: 15000 });
  check(!inv.url().includes('token='), `${view}: token stripped from the address bar`);
  check((await inv.getByTestId('invite-password').getAttribute('autocomplete')) === 'new-password', `${view}: autocomplete=new-password`);
  await inv.getByTestId('invite-password').fill('short');
  check((await inv.getByTestId('pw-strength').textContent()).includes('Too short'), `${view}: strength hint`);
  await inv.getByTestId('invite-password2').fill('short');
  await inv.getByTestId('invite-submit').click();
  check((await inv.getByTestId('invite-error').textContent()).includes('12'), `${view}: min 12 enforced`);
  await inv.getByTestId('invite-password').fill(PW);
  await inv.getByTestId('invite-password2').fill(PW + 'x');
  await inv.getByTestId('invite-submit').click();
  check((await inv.getByTestId('invite-error').textContent()).includes('match'), `${view}: mismatch caught`);
  await inv.getByRole('button', { name: 'Show password' }).click();
  check((await inv.getByTestId('invite-password').getAttribute('type')) === 'text', `${view}: show/hide works`);
  await noOverflow(inv, `${view} invite form`);
  await noBannedWords(inv, `${view} invite form`);
  await shot(inv, `form-${view}.png`);
  await inv.getByTestId('invite-password2').fill(PW);
  await inv.getByTestId('invite-submit').click();
  await inv.getByTestId('invite-done').waitFor({ timeout: 10000 });
  check(true, `${view}: password set, sign-in offered`);
  await shot(inv, `done-${view}.png`);
  check(!(await inv.evaluate((p) => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(p), PW)), `${view}: password not stored in the browser`);
  for (const [u, what] of [[third, 'used link'], [second, 'replaced link']]) {
    await inv.goto(u, { waitUntil: 'load' });
    await inv.getByTestId('invite-form').waitFor();
    await inv.getByTestId('invite-password').fill(PW);
    await inv.getByTestId('invite-password2').fill(PW);
    await inv.getByTestId('invite-submit').click();
    await inv.getByTestId('invite-invalid').waitFor({ timeout: 10000 });
    check(true, `${view}: ${what} shows "no longer works"`);
  }
  await inv.goto(`${BASE}/invite`, { waitUntil: 'load' });
  await inv.getByTestId('invite-missing').waitFor();
  check(true, `${view}: missing token state`);
  await ctx.close();
}
// Signed-out visitor reaches /invite (public), and a BM never sees My Team invites.
{
  const { browser } = await setup('invites');
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => sessionStorage.setItem('af:splash-seen', '1'));
  const p = await ctx.newPage();
  await p.goto(`${BASE}/invite?token=${'x'.repeat(30)}`, { waitUntil: 'load' });
  await p.getByTestId('invite-form').waitFor({ timeout: 15000 });
  check(new URL(p.url()).pathname === '/invite', 'signed out: /invite is public (no redirect to sign-in)');
  await ctx.close();
  await browser.close();
}
{
  const { ctx, page } = await open('business_manager', '/my-team');
  await page.waitForTimeout(2500);
  check((await page.getByTestId('invite-all').count()) === 0 && (await page.getByTestId('invite-send').count()) === 0, 'BM: no invite controls');
  await ctx.close();
}
await finish();
