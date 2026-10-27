// TA/DA allowances #39 (mock): rate card + places settings (settings:write), "Add allowances" preview + confirm
// on a draft claim, Auto/Manual line badges, nav gating.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/allowances-evidence.mjs
import { setup } from './lib.mjs';

const { BASE, check, open, shot, noOverflow, noBannedWords, finish } = await setup('allowances');
const pick = async (page, trigger, name) => {
  await page.getByTestId(trigger).click();
  await (name ? page.getByRole('option', { name, exact: true }) : page.getByRole('option').first()).click();
};
for (const view of ['desktop', 'mobile']) {
  // Settings as director.
  const { ctx, page } = await open('director', '/', view);
  await page.goto(`${BASE}/settings/allowances`, { waitUntil: 'load' });
  await Promise.race([page.getByTestId('rate-row').first().waitFor({ timeout: 20000 }), page.getByTestId('rate-empty').waitFor({ timeout: 20000 })]);
  const before = await page.getByTestId('rate-row').count();
  await page.getByTestId('rate-add').click();
  await pick(page, 'rate-band', 'Outstation');
  await pick(page, 'rate-role', 'Business Manager');
  await page.getByTestId('rate-from').fill('2026-11-01');
  await page.getByTestId('rate-da').fill('12.345');
  await page.getByTestId('rate-save').click();
  check((await page.getByTestId('rate-error').textContent()).includes('at most 2 decimals'), `${view}: rate amount validation`);
  await page.getByTestId('rate-da').fill('450');
  await page.getByTestId('rate-km').fill('3.5');
  await page.getByTestId('rate-save').click();
  await page.getByTestId('rate-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=rate-row]').length === n + 1, before, { timeout: 10000 });
  check(true, `${view}: rate added (${before} → ${before + 1})`);
  // Same band/role/date again → DUPLICATE_RATE message.
  await page.getByTestId('rate-add').click();
  await pick(page, 'rate-band', 'Outstation');
  await pick(page, 'rate-role', 'Business Manager');
  await page.getByTestId('rate-from').fill('2026-11-01');
  await page.getByTestId('rate-da').fill('400');
  await page.getByTestId('rate-save').click();
  await page.getByTestId('rate-error').waitFor();
  check((await page.getByTestId('rate-error').textContent()).includes('already exists'), `${view}: duplicate rate message`);
  await page.keyboard.press('Escape');
  const mine = () => page.getByTestId('rate-row').filter({ hasText: '2026-11-01' }).filter({ hasText: 'Outstation' });
  await mine().getByTestId('rate-edit').click();
  await page.getByTestId('rate-da').fill('475');
  await page.getByTestId('rate-save').click();
  await page.getByTestId('rate-dialog').waitFor({ state: 'hidden' });
  await mine().filter({ hasText: '475' }).waitFor({ timeout: 10000 });
  check(true, `${view}: rate edited (version sent)`);
  await mine().getByTestId('rate-delete').click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=rate-row]').length === n, before, { timeout: 10000 });
  check(true, `${view}: rate deleted`);
  await shot(page, `rates-${view}.png`);
  // Places.
  await page.getByTestId('alw-tab-places').click();
  await page.getByTestId('place-add').waitFor();
  await page.waitForTimeout(600);
  const p0 = await page.getByTestId('place-row').count();
  await page.getByTestId('place-add').click();
  await pick(page, 'place-hq');
  await page.getByTestId('place-name').fill('Testpur');
  await page.getByTestId('place-km').fill('0');
  await page.getByTestId('place-save').click();
  check((await page.getByTestId('place-error').textContent()).includes('more than 0'), `${view}: km validation`);
  await page.getByTestId('place-km').fill('42.5');
  await page.getByTestId('place-save').click();
  await page.getByTestId('place-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=place-row]').length === n + 1, p0, { timeout: 10000 });
  check(true, `${view}: place added`);
  await page.getByTestId('place-search').fill('Testpur');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=place-row]').length === 1, null, { timeout: 10000 });
  check(true, `${view}: server-side search`);
  await page.getByTestId('place-delete').click();
  await page.getByTestId('place-empty').waitFor({ timeout: 10000 });
  check(true, `${view}: place removed (mock hard-deletes; real API soft-deletes, see CONTRACT-GAPS)`);
  await page.getByTestId('place-inactive').check();
  await page.getByTestId('place-search').fill('');
  await noOverflow(page, `${view} settings`);
  await noBannedWords(page, `${view} settings`);
  await shot(page, `places-${view}.png`);
  // Add an HQ rate, then navigate in-app (keeps the in-page mock state) and draft allowances.
  await page.getByTestId('alw-tab-rates').click();
  await page.getByTestId('rate-add').click();
  await page.getByTestId('rate-from').fill('2020-01-01');
  await page.getByTestId('rate-da').fill('300');
  await page.getByTestId('rate-fixed').fill('50');
  await page.getByTestId('rate-save').click();
  await page.getByTestId('rate-dialog').waitFor({ state: 'hidden' });
  if (view === 'mobile') await page.locator('[data-sidebar=trigger]').first().click();
  await page.locator('a[href="/expenses"]:visible').first().click();
  await page.getByTestId('exp-empty').waitFor({ timeout: 20000 });
  await page.getByTestId('exp-open-month').click();
  await page.getByTestId('exp-claim').waitFor({ timeout: 15000 });
  await page.getByTestId('exp-add-allowances').click();
  await page.getByTestId('alw-totals').waitFor({ timeout: 15000 });
  check((await page.getByTestId('alw-day').count()) > 0, `${view}: dry-run lists days`);
  check(/[1-9]/.test((await page.getByTestId('alw-totals').textContent()).replace(/\d+ (day|line)s?/g, '')), `${view}: totals use the rate`);
  await shot(page, `preview-${view}.png`);
  await page.getByTestId('alw-confirm').click();
  await page.getByTestId('alw-dialog').waitFor({ state: 'hidden', timeout: 15000 });
  await page.locator('[data-testid=exp-line-source][data-source=auto]').first().waitFor({ timeout: 10000 });
  check(true, `${view}: confirmed; lines show Auto badge`);
  check((await page.getByTestId('exp-line').filter({ hasText: 'Daily allowance' }).count()) > 0, `${view}: allowance category label`);
  await noOverflow(page, `${view} claim with allowances`);
  await shot(page, `claim-auto-${view}.png`);
  await ctx.close();

  // Claim allowances as BM.
  const b = await open('business_manager', '/expenses', view);
  await b.page.getByTestId('exp-open-month').waitFor({ timeout: 20000 });
  check((await b.page.locator('a[href="/settings/allowances"]').count()) === 0, `${view}: BM has no TA/DA settings nav`);
  await b.page.getByTestId('exp-empty').waitFor();
  await b.page.getByTestId('exp-open-month').click();
  await b.page.getByTestId('exp-claim').waitFor({ timeout: 15000 });
  await b.page.getByTestId('exp-add-allowances').click();
  await b.page.getByTestId('alw-totals').waitFor({ timeout: 15000 });
  const days = await b.page.getByTestId('alw-day').count();
  check(days > 0 || (await b.page.getByTestId('alw-empty').count()) === 1, `${view}: dry-run preview (${days} days)`);
  await noOverflow(b.page, `${view} allowance preview`);
  await shot(b.page, `preview-norate-${view}.png`);
  check((await b.page.getByTestId('alw-issue').first().textContent()).includes('No allowance rate set'), `${view}: missing rate explained in plain words`);
  check(await b.page.getByTestId('alw-confirm').isDisabled(), `${view}: confirm disabled when nothing to add`);
  await shot(b.page, `claim-${view}.png`);
  await b.ctx.close();
}
await finish();
