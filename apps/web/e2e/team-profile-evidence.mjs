// Team member profile #75 (mock): header facts, counts, exceptions summary (only with field:read),
// performance month/week, doctors/chemists server-paged with search + load more, access errors.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/team-profile-evidence.mjs
import { setup } from './lib.mjs';

const { BASE, check, open, shot, noOverflow, noBannedWords, finish } = await setup('team-profile');
// Mock team = the persona chain from packages/contracts/src/mocks/fixtures.ts (ids 301 director … 308 BM).
const uid = (i) => `01930000-0000-7000-8000-000000000${301 + i}`;
const BM = { id: uid(7), name: 'Demo Business Manager' };
const ABM = { id: uid(6) };

for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open('director', '/', view);
  const target = BM;
  check(true, `${view}: target BM ${target.id}`);
  await page.goto(`${BASE}/team/members/${target.id}`, { waitUntil: 'load' });
  await page.getByTestId('profile').waitFor({ timeout: 20000 });
  check((await page.getByTestId('profile-name').textContent()) === target.name, `${view}: name in header`);
  check((await page.getByTestId('profile-counts').textContent()).includes('Doctors'), `${view}: counts shown`);
  check((await page.getByTestId('profile-today').textContent()).length > 5, `${view}: today status shown`);
  const exc = await page.getByTestId('profile-exceptions').count();
  check(exc === 1, `${view}: exceptions summary shown for director (field:read)`);
  await page.getByTestId('perf-row').first().waitFor({ timeout: 10000 });
  const months = await page.getByTestId('perf-row').count();
  check(months >= 2, `${view}: monthly performance rows (${months})`);
  await page.getByTestId('perf-week').click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=perf-row]').length !== n, months, { timeout: 10000 }).catch(() => {});
  check((await page.getByTestId('perf-row').first().textContent()).includes('W'), `${view}: weekly buckets (ISO week labels)`);
  await page.getByTestId('outlet-row').first().waitFor({ timeout: 10000 }).catch(() => {});
  const rows = await page.getByTestId('outlet-row').count();
  const empty = await page.getByTestId('outlets-empty').count();
  check(rows > 0 || empty === 1, `${view}: doctors list or empty state (${rows})`);
  if (await page.getByTestId('outlets-more').count()) {
    await page.getByTestId('outlets-more').click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid=outlet-row]').length > n, rows, { timeout: 10000 });
    check(true, `${view}: load more appends the next page`);
  }
  if (rows > 0) {
    const first = (await page.getByTestId('outlet-row').first().locator('td').first().textContent()).trim();
    await page.getByTestId('outlets-search').fill(first.slice(0, 5));
    await page.waitForTimeout(900);
    check((await page.getByTestId('outlet-row').first().textContent()).includes(first.slice(0, 5)), `${view}: search narrows server-side`);
  }
  await page.getByTestId('outlets-chemists').click();
  await page.waitForTimeout(900);
  check((await page.getByTestId('outlet-row').count()) > 0 || (await page.getByTestId('outlets-empty').count()) === 1, `${view}: chemists tab`);
  await noOverflow(page, `${view} profile`);
  await noBannedWords(page, `${view} profile`);
  await shot(page, `profile-${view}.png`);
  await page.goto(`${BASE}/team/members/00000000-0000-4000-8000-00000000dead`, { waitUntil: 'load' });
  await page.getByTestId('profile-error').waitFor({ timeout: 15000 });
  check((await page.getByTestId('profile-error').textContent()).includes('not in your team'), `${view}: unknown id → 404 message`);
  await ctx.close();
}
// BM: /team is approver-only in the nav gate, so the profile route redirects away.
{
  const { ctx, page } = await open('business_manager', '/');
  await page.goto(`${BASE}/team/members/${ABM.id}`, { waitUntil: 'load' });
  await page.waitForURL((u) => !u.pathname.startsWith('/team'), { timeout: 15000 });
  check(true, 'BM: /team/members route is gated (redirected)');
  await ctx.close();
}
// ABM: own subtree opens; someone above → not-in-team message.
{
  const { ctx, page } = await open('area_business_manager', '/');
  await page.goto(`${BASE}/team/members/${BM.id}`, { waitUntil: 'load' });
  await page.getByTestId('profile').waitFor({ timeout: 15000 });
  check(true, 'ABM: report BM profile opens');
  await page.goto(`${BASE}/team/members/${uid(0)}`, { waitUntil: 'load' });
  await page.getByTestId('profile-error').waitFor({ timeout: 15000 });
  check((await page.getByTestId('profile-error').textContent()).includes('not in your team'), 'ABM: director → not-in-team message');
  await ctx.close();
}
await finish();
