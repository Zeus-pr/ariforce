// Notifications #35 (mock): bell unread count, panel list, load more, mark read on open + deep link, read all.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/notifications-evidence.mjs
import { setup } from './lib.mjs';

const { check, open, shot, noOverflow, noBannedWords, finish } = await setup('notifications');
for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open('director', '/', view);
  await page.getByTestId('notif-count').waitFor({ timeout: 20000 });
  const c0 = Number(await page.getByTestId('notif-count').textContent());
  check(c0 === 2, `${view}: unread count shown (${c0})`);
  await page.getByTestId('notif-bell').click();
  await page.getByTestId('notif-item').first().waitFor({ timeout: 10000 });
  const n1 = await page.getByTestId('notif-item').count();
  check(n1 === 3, `${view}: first page (${n1})`);
  await page.getByTestId('notif-more').click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid=notif-item]').length > 3,
    null,
    { timeout: 10000 },
  );
  check(true, `${view}: load more appends`);
  check(!(await page.getByTestId('notif-more').count()), `${view}: no more after last page`);
  const rej = await page
    .getByTestId('notif-rejection')
    .first()
    .innerText()
    .catch(() => '');
  check(
    /^Rejected: Month-end review that week, by Anita Rao, \d+ \w+ 2026$/.test(rej),
    `${view}: rejection notification reads "${rej}"`,
  );
  await noOverflow(page, `${view} panel`);
  await noBannedWords(page, `${view} panel`);
  await shot(page, `panel-${view}.png`);
  // Second item: expense approved (unread) → /expenses/{id}
  await page.getByTestId('notif-item').nth(1).click();
  await page.waitForURL(/\/expenses\/[0-9a-f-]+$/, { timeout: 15000 });
  check(true, `${view}: expense notification deep-links to /expenses/{id}`);
  await page.waitForFunction(
    () => document.querySelector('[data-testid=notif-count]')?.textContent === '1',
    null,
    { timeout: 10000 },
  );
  check(true, `${view}: opening marks it read (count 1)`);
  await page.getByTestId('notif-bell').click();
  await page.getByTestId('notif-item').first().click();
  await page.waitForURL(/\/leave$/, { timeout: 15000 });
  check(true, `${view}: leave notification deep-links to /leave`);
  check(!(await page.getByTestId('notif-count').count()), `${view}: count cleared`);
  await ctx.close();
}
{
  const { ctx, page } = await open('director', '/');
  await page.getByTestId('notif-count').waitFor({ timeout: 20000 });
  await page.getByTestId('notif-bell').click();
  await page.getByTestId('notif-read-all').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=notif-count]'), null, {
    timeout: 10000,
  });
  check(
    (await page.locator('[data-testid=notif-item][data-unread]').count()) === 0,
    'read all clears unread',
  );
  await ctx.close();
}
await finish();
