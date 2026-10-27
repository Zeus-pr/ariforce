// System Admin "Invite people": nav/route gating, existing-employee link, manual add with an empty HQ,
// pending list with a new link. Mock mode.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/admin-invites-evidence.mjs
import { setup } from './lib.mjs';

const { check, open, shot, noOverflow, noBannedWords, finish } = await setup('admin-invites');
const navLink = (page) => page.locator('a[href="/admin/invites"]');

for (const role of ['director', 'business_manager', 'area_business_manager']) {
  const { ctx, page } = await open(role, '/admin/invites', 'desktop');
  await page.waitForTimeout(2500);
  check((await navLink(page).count()) === 0, `${role}: no Invite people nav entry`);
  check((await page.getByTestId('invite-mode-existing').count()) === 0, `${role}: page is blocked`);
  await ctx.close();
}

for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open('system_admin', '/admin/invites', view);
  await page.getByTestId('invite-mode-existing').waitFor({ timeout: 20000 });
  if (view === 'desktop') check(await navLink(page).first().waitFor({ state: 'attached', timeout: 10000 }).then(() => true, () => false), 'sysadmin: nav entry shown');
  // Existing employee: someone already signed in has no link; a not-yet-joined person gets one.
  const opts = page.getByTestId('employee-search-option');
  await opts.first().waitFor({ timeout: 15000 });
  await opts.first().click();
  await page.getByTestId('employee-details').waitFor();
  check((await page.getByTestId('invite-not-allowed').count()) === 1, `${view}: joined employee → no link, plain note`);
  await page.getByTestId('employee-search').fill('Nisha');
  await page.waitForFunction(() => { const o = document.querySelectorAll('[data-testid=employee-search-option]'); return o.length === 1 && /Nisha/.test(o[0].textContent); }, null, { timeout: 10000 });
  await opts.first().click();
  await page.getByTestId('detail-name').filter({ hasText: 'Nisha' }).waitFor();
  check((await page.getByTestId('detail-email').textContent()) === 'nisha.pending@example.test', `${view}: details show saved email`);
  check(/Kolkata North HQ/.test(await page.getByTestId('detail-hq').textContent()), `${view}: details show HQ`);
  await page.waitForFunction(() => !/Loading/.test(document.querySelector('[data-testid=detail-manager]')?.textContent ?? 'Loading'), null, { timeout: 10000 });
  check((await page.getByTestId('detail-manager').textContent()) !== 'Nobody', `${view}: details show manager`);
  await page.getByTestId('invite-existing-send').click();
  await page.getByTestId('invite-url').waitFor({ timeout: 10000 });
  check(/\/invite\?token=/.test(await page.getByTestId('invite-url').inputValue()), `${view}: existing → link shown`);
  await noOverflow(page, `${view} existing`);
  await shot(page, `${view}-existing.png`);

  // Manual entry.
  await page.getByTestId('invite-mode-manual').click();
  const em = `new.${view}@example.test`;
  await page.getByTestId('manual-name').fill(`New Person ${view}`);
  await page.getByTestId('manual-email').fill(em);
  await page.getByTestId('manual-phone').fill('9800000000');
  await page.getByTestId('manual-role').click();
  check((await page.getByRole('option', { name: /System Admin/ }).getAttribute('aria-disabled')) !== 'true', `${view}: every role offered incl. System Admin`);
  check((await page.getByRole('option', { name: /Distribution Head|Accountant/ }).count()) === 0, `${view}: no Distribution Head or Accountant`);
  await page.getByRole('option', { name: /System Admin/ }).first().click();
  await page.getByTestId('manual-functional').waitFor();
  check((await page.getByTestId('manual-hq').count()) === 0, `${view}: functional role → no HQ/manager`);
  await page.getByTestId('manual-role').click();
  await page.getByRole('option', { name: 'Business Manager', exact: true }).click();
  await page.getByTestId('manual-hq').click();
  await page.getByRole('option', { name: /Howrah HQ/ }).click();
  check(true, `${view}: empty HQ (Howrah) selectable`);
  await page.getByTestId('manager-search-option').first().waitFor({ timeout: 10000 });
  await page.getByTestId('manager-search-option').first().click();
  await page.getByTestId('manual-manager-picked').waitFor();
  await page.getByTestId('manual-send').click();
  await page.locator('[data-testid=manual-result][data-status=invited]').waitFor({ timeout: 10000 });
  check(/\/invite\?token=/.test(await page.getByTestId('invite-url').first().inputValue()), `${view}: manual → link shown`);
  await noOverflow(page, `${view} manual`);
  await noBannedWords(page, `${view} manual`);
  await shot(page, `${view}-manual.png`);

  // Pending list includes the new person; resend gives a fresh link.
  const row = page.getByTestId('pending-row').filter({ hasText: em });
  await row.waitFor({ timeout: 10000 });
  check(true, `${view}: pending list shows new invite`);
  await row.getByTestId('pending-resend').click();
  await row.getByTestId('invite-url').waitFor({ timeout: 10000 });
  check(true, `${view}: pending resend shows link`);
  await shot(page, `${view}-pending.png`);
  await ctx.close();
}
await finish();
