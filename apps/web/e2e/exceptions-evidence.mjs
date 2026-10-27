// Exceptions (#56): server-paged list with filters, detail with explain/resolve/dismiss/assign/follow-up,
// rule settings for settings:write, role-gated nav. Mock mode.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/exceptions-evidence.mjs
import { setup } from './lib.mjs';

const { BASE, check, open, shot, noOverflow, noBannedWords, finish } = await setup('exceptions');
const pick = async (page, trigger, name) => {
  await page.getByTestId(trigger).click();
  await page.getByRole('option', { name, exact: true }).click();
};
const rows = (page) => page.getByTestId('exc-row');

for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open('director', '/exceptions', view);
  await page.getByTestId('exc-count-open').waitFor({ timeout: 20000 });
  const openCount = Number(await page.getByTestId('exc-count-open').textContent());
  check(openCount === 4, `${view}: summary open count ${openCount}`);
  await rows(page).first().waitFor();
  check((await rows(page).count()) === 2, `${view}: first server page has 2 rows`);
  await page.getByTestId('exc-more').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=exc-row]').length === 4, null, { timeout: 10000 });
  check((await page.getByTestId('exc-more').count()) === 0, `${view}: cursor exhausted after 4 rows`);
  const sev = await rows(page).evaluateAll((r) => r.map((x) => x.dataset.severity));
  const rank = { high: 0, medium: 1, low: 2 };
  check(sev.every((s, i) => i === 0 || rank[sev[i - 1]] <= rank[s]), `${view}: most serious first (${sev.join(',')})`);
  await pick(page, 'exc-f-severity', 'Medium');
  await page.waitForFunction(() => { const r = [...document.querySelectorAll('[data-testid=exc-row]')]; return r.length > 0 && r.every((x) => x.dataset.severity === 'medium'); }, null, { timeout: 10000 });
  check(true, `${view}: severity filter is server-side`);
  await pick(page, 'exc-f-severity', 'All');
  await pick(page, 'exc-f-rule', 'DCR submitted late');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=exc-row]').length === 1, null, { timeout: 10000 });
  check(true, `${view}: type filter`);
  await page.getByTestId('exc-f-mine').check();
  await page.getByTestId('exc-empty').waitFor({ timeout: 10000 });
  check(true, `${view}: assigned-to-me empty state`);
  await page.getByTestId('exc-f-mine').uncheck();
  await pick(page, 'exc-f-rule', 'All types');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=exc-row]').length === 2, null, { timeout: 10000 });
  await noOverflow(page, `${view} list`);
  await noBannedWords(page, `${view} list`);
  await shot(page, `list-${view}.png`);

  // Detail as manager: assign, follow-up, resolve.
  await rows(page).first().click();
  await page.getByTestId('exc-action').waitFor();
  check((await page.getByTestId('exc-source').count()) === 1, `${view}: detail links to the source record`);
  check((await page.getByTestId('exc-explain').count()) === 0, `${view}: manager cannot explain someone else's exception`);
  await page.getByTestId('exc-assign').click();
  await page.getByTestId('exc-unassign').waitFor();
  check((await page.getByTestId('exc-owner').textContent()) !== 'Nobody yet', `${view}: assigned to me`);
  await page.getByTestId('exc-follow').fill('2026-12-01');
  await page.getByTestId('exc-follow-save').click();
  await page.getByText('Follow-up date saved').first().waitFor();
  check(true, `${view}: follow-up saved (version sent)`);
  await page.getByTestId('exc-resolve').click();
  check((await page.getByTestId('exc-detail-error').textContent()).includes('note'), `${view}: resolve needs a note`);
  await page.getByTestId('exc-note').fill('Spoke to the rep; DCR correction requested.');
  await page.getByTestId('exc-resolve').click();
  await page.getByTestId('exc-resolution').waitFor();
  check((await page.getByTestId('exc-detail-status').textContent()) === 'Resolved', `${view}: resolved`);
  await shot(page, `detail-${view}.png`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('[data-testid=exc-count-open]')?.textContent === '3', null, { timeout: 10000 });
  check(true, `${view}: summary refreshed after resolve`);
  await pick(page, 'exc-f-status', 'Resolved or dismissed');
  await page.waitForFunction(() => { const r = [...document.querySelectorAll('[data-testid=exc-row]')]; return r.length >= 1 && r.every((x) => x.dataset.status === 'resolved'); }, null, { timeout: 10000 });
  check(true, `${view}: closed filter shows the resolved one`);
  // Dismiss another (in-page mock state carries on).
  await pick(page, 'exc-f-status', 'Open and explained');
  await page.locator('[data-testid=exc-row][data-status=open]').first().waitFor();
  await page.waitForTimeout(300);
  await page.locator('[data-testid=exc-row][data-status=open]').first().click();
  await page.getByTestId('exc-note').fill('Known network outage that day.');
  await page.getByTestId('exc-dismiss').click();
  await page.getByTestId('exc-resolution').waitFor();
  check((await page.getByTestId('exc-detail-status').textContent()) === 'Dismissed', `${view}: dismissed`);
  await page.keyboard.press('Escape');

  // Rules (in-app nav keeps state).
  if (view === 'mobile') await page.locator('[data-sidebar=trigger]').first().click();
  check((await page.locator('a[href="/settings/exception-rules"]:visible').count()) === 1, `${view}: director sees Exception rules in nav`);
  await page.locator('a[href="/settings/exception-rules"]:visible').first().click();
  const card = page.locator('[data-testid=rule-card][data-code=low_call_average]');
  await card.waitFor({ timeout: 15000 });
  check((await page.getByTestId('rule-card').count()) === 8, `${view}: 8 rules listed`);
  await card.getByTestId('rule-threshold').fill('99');
  await card.getByTestId('rule-save').click();
  check((await card.getByTestId('rule-error').textContent()).includes('between 1 and 50'), `${view}: threshold range checked`);
  await card.getByTestId('rule-threshold').fill('6');
  await card.getByTestId('rule-save').click();
  await card.getByTestId('rule-custom').waitFor();
  check(true, `${view}: rule saved as customised`);
  await card.getByTestId('rule-reset').click();
  await card.getByTestId('rule-custom').waitFor({ state: 'detached' });
  check((await card.getByTestId('rule-threshold').inputValue()) === '8', `${view}: reset to default threshold`);
  await noOverflow(page, `${view} rules`);
  await noBannedWords(page, `${view} rules`);
  await shot(page, `rules-${view}.png`);
  await ctx.close();

  // BM: explains own exception, no manager actions, no rules nav.
  const b = await open('business_manager', '/exceptions', view);
  await rows(b.page).first().waitFor({ timeout: 20000 });
  check((await b.page.locator('a[href="/settings/exception-rules"]').count()) === 0, `${view}: BM has no rules nav`);
  await rows(b.page).first().click();
  await b.page.getByTestId('exc-explain').waitFor();
  check((await b.page.getByTestId('exc-resolve').count()) === 0 && (await b.page.getByTestId('exc-assign').count()) === 0, `${view}: BM cannot close or assign own exception`);
  await b.page.getByTestId('exc-note').fill('Was at a CME, will request a correction.');
  await b.page.getByTestId('exc-explain').click();
  await b.page.getByTestId('exc-explanation').waitFor();
  check((await b.page.getByTestId('exc-detail-status').textContent()) === 'Explained', `${view}: explanation recorded`);
  await shot(b.page, `bm-explain-${view}.png`);
  await b.ctx.close();

  // System Admin: no field:read → no Exceptions nav, route redirects.
  const s = await open('system_admin', '/', view);
  await s.page.waitForTimeout(800);
  check((await s.page.locator('a[href="/exceptions"]').count()) === 0, `${view}: System Admin has no Exceptions nav`);
  await s.page.goto(`${BASE}/exceptions`, { waitUntil: 'load' });
  await s.page.waitForTimeout(1500);
  check(!s.page.url().endsWith('/exceptions'), `${view}: System Admin redirected from /exceptions`);
  check((await s.page.locator('a[href="/settings/exception-rules"]').count()) === 0, `${view}: System Admin has no Exception rules nav`);
  await s.page.goto(`${BASE}/settings/exception-rules`, { waitUntil: 'load' });
  await s.page.waitForTimeout(1500);
  check(!s.page.url().includes('/settings/exception-rules'), `${view}: System Admin redirected from /settings/exception-rules`);
  check((await s.page.getByText('Missing permission').count()) === 0, `${view}: no "Missing permission" page for System Admin`);
  await s.ctx.close();
}
await finish();
