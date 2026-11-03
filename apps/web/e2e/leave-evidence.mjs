// Leave (#51), MSW mock: BM applies (balance + backdate check), ABM approves / rejects with comment,
// BM cancels, calendar shows it, and Tour Plans refuses field work on the approved leave day
// (422 LEAVE_DAY_BLOCKED). Mock leave state lives in page memory: roles switch in-page, nav is client-side.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/leave-evidence.mjs
import { setup } from './lib.mjs';

const { check, open, shot, noOverflow, noBannedWords, finish } = await setup('leave');
const ist = (d) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
const today = ist(new Date());
const add = (d, n) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const sun = (d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
// Working days at the start of next month (same year until December; then the start of this month's tail).
const nextMonth1 = (() => {
  const [y, m] = today.split('-').map(Number);
  return m === 12 ? null : `${y}-${String(m + 1).padStart(2, '0')}-01`;
})();
const days = [];
for (let d = nextMonth1 ?? add(today, 1); days.length < 3; d = add(d, 1)) if (!sun(d)) days.push(d);
const [D, D2, D3] = days;
const label = (d) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));

async function as(page, role) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('af:mock-session'));
    s.previewRole = r === s.role ? undefined : r;
    localStorage.setItem('af:mock-session', JSON.stringify(s));
    window.dispatchEvent(new StorageEvent('storage', { key: 'af:mock-session' }));
  }, role);
  await page.waitForTimeout(400);
}
async function apply(page, from, to, reason) {
  await page.getByTestId('leave-apply').click();
  const d = page.getByTestId('leave-apply-dialog');
  await d.waitFor();
  await page.getByTestId('leave-type').click();
  await page.getByRole('option', { name: 'Casual leave' }).click();
  await page.getByTestId('leave-from').fill(from);
  await page.getByTestId('leave-to').fill(to);
  await page.getByTestId('leave-reason').fill(reason);
  await page.getByTestId('leave-submit').click();
  await d.waitFor({ state: 'hidden', timeout: 10000 });
}
const avail = async (page) =>
  Number(
    await page
      .locator('[data-testid=leave-balance][data-code=CL] [data-testid=leave-available]')
      .textContent(),
  );

for (const view of ['desktop', 'mobile']) {
  // Signed in as director, previewing BM / ABM (preview only goes down the hierarchy).
  const { ctx, page } = await open('director', '/leave', view);
  await page.getByTestId('tab-mine').waitFor({ timeout: 20000 });
  await as(page, 'business_manager');
  await page.locator('[data-testid=leave-balance][data-code=CL]').waitFor({ timeout: 20000 });
  check(
    (await page.getByTestId('leave-balance').count()) >= 3,
    `${view}: balances listed per leave type`,
  );
  const before = await avail(page);
  check(before > 0, `${view}: CL balance shown (${before})`);
  await page.getByTestId('leave-none').waitFor();

  // Client-side backdate window: 30 days ago is refused before any request.
  await page.getByTestId('leave-apply').click();
  await page.getByTestId('leave-type').click();
  await page.getByRole('option', { name: 'Casual leave' }).click();
  const min = await page.getByTestId('leave-from').getAttribute('min');
  check(min === add(today, -14), `${view}: from-date min is today − 14 days (${min})`);
  await page.getByTestId('leave-from').fill(add(today, -30));
  await page.getByTestId('leave-to').fill(add(today, -30));
  await page.getByTestId('leave-reason').fill('Old');
  await page.getByTestId('leave-submit').click();
  await page.getByTestId('leave-apply-error').waitFor();
  check(
    /earlier than/i.test(await page.getByTestId('leave-apply-error').textContent()),
    `${view}: older than 14 days refused with a clear message`,
  );
  await page.getByTestId('leave-from').fill(D);
  await page.getByTestId('leave-to').fill(D);
  check(
    (await page.getByTestId('leave-days').textContent()) === '1 day',
    `${view}: summary counts 1 day`,
  );
  check(
    (await page.getByTestId('leave-balance-after').count()) === 1,
    `${view}: balance after shown in the form`,
  );
  await shot(page, `apply-${view}.png`);
  await page.keyboard.press('Escape');
  await page.getByTestId('leave-apply-dialog').waitFor({ state: 'hidden' });

  await apply(page, D, D, 'Family function');
  await page
    .locator('[data-testid=leave-row][data-status=pending]')
    .first()
    .waitFor({ timeout: 10000 });
  check(true, `${view}: request listed as waiting (POST /v1/leave/requests)`);
  check(
    (await page.locator('[data-testid=leave-balance][data-code=CL]').textContent()).includes(
      'waiting',
    ),
    `${view}: balance shows the waiting day`,
  );
  await noOverflow(page, `${view} my leave`);
  await noBannedWords(page, `${view} my leave`);
  await shot(page, `mine-${view}.png`);

  // Second request: BM cancels it.
  await apply(page, D2, D2, 'Plans changed');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid=leave-row][data-status=pending]').length === 2,
    null,
    { timeout: 10000 },
  );
  await page
    .getByTestId('leave-row')
    .filter({ has: page.getByTestId('leave-cancel') })
    .first()
    .waitFor();
  const pendingBefore = await page.locator('[data-testid=leave-row][data-status=pending]').count();
  await page
    .locator('[data-testid=leave-row][data-status=pending]')
    .filter({ hasText: label(D2) })
    .getByTestId('leave-cancel')
    .click();
  await page.getByTestId('leave-cancel-confirm').click();
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll('[data-testid=leave-row][data-status=pending]').length === n - 1,
    pendingBefore,
    { timeout: 10000 },
  );
  check(
    (await page
      .locator('[data-testid=leave-row][data-status=cancelled]')
      .filter({ hasText: label(D2) })
      .count()) === 1,
    `${view}: pending request cancelled (POST /cancel)`,
  );

  // Third request: ABM rejects (comment required).
  await apply(page, D3, D3, 'Short trip');
  await as(page, 'area_business_manager');
  await page.getByTestId('tab-approvals').click();
  await page.getByTestId('leave-approval').first().waitFor({ timeout: 10000 });
  check(
    (await page.getByTestId('leave-approval').count()) === 2,
    `${view}: ABM sees both waiting requests`,
  );
  await shot(page, `approvals-${view}.png`);
  await page
    .getByTestId('leave-approval')
    .filter({ hasText: 'Short trip' })
    .getByTestId('leave-reject')
    .click();
  check(
    await page.getByTestId('leave-decide-confirm').isDisabled(),
    `${view}: Reject disabled until a reason is typed`,
  );
  await page.getByTestId('leave-comment').fill('Month-end review that week');
  await page.getByTestId('leave-decide-confirm').click();
  await page.getByTestId('leave-decide-dialog').waitFor({ state: 'hidden' });
  await page
    .getByTestId('leave-approval')
    .filter({ hasText: 'Family function' })
    .getByTestId('leave-approve')
    .click();
  await page.getByTestId('leave-comment').fill('Enjoy');
  await page.getByTestId('leave-decide-confirm').click();
  await page.getByTestId('leave-approvals-empty').waitFor({ timeout: 10000 });
  check(true, `${view}: ABM approved one and rejected one (POST /decision)`);
  if (view === 'desktop') {
    await page.getByTestId('tab-admin').click();
    await page.getByTestId('leave-grant').waitFor();
    check(
      (await page.getByTestId('leave-settings').count()) === 0,
      `${view}: ABM gets grants but not company settings`,
    );
  }

  await as(page, 'business_manager');
  await page.getByTestId('tab-mine').click();
  await page.locator('[data-testid=leave-row][data-status=approved]').waitFor({ timeout: 10000 });
  check(
    (await page.locator('[data-testid=leave-row][data-status=rejected]').textContent()).includes(
      'Month-end review',
    ),
    `${view}: BM sees the reject comment`,
  );
  check(
    /^Rejected: Month-end review that week, by [^,]+, \d+ \w+ \d{4}$/.test(
      await page.getByTestId('leave-rejection').first().innerText(),
    ),
    `${view}: rejection reads "Rejected: <reason>, by <name>, <date>"`,
  );
  check((await avail(page)) === before - 1, `${view}: CL balance down by 1 after approval`);
  check(
    (await page.getByTestId('tab-approvals').count()) === 0,
    `${view}: BM has no approvals tab`,
  );

  await page.getByTestId('tab-calendar').click();
  await page.getByTestId('leave-calendar').waitFor();
  if (nextMonth1) await page.getByRole('button', { name: 'Next month' }).click();
  await page
    .locator(
      `[data-testid=leave-cal-day][data-date="${D}"] [data-testid=leave-cal-entry][data-status=approved]`,
    )
    .waitFor({ timeout: 10000 });
  check(true, `${view}: calendar shows the approved day (GET /v1/leave/calendar)`);
  await noOverflow(page, `${view} calendar`);
  await shot(page, `calendar-${view}.png`);

  // Tour Plans: field work on the approved leave day is blocked (client-side nav keeps mock state).
  if (view === 'mobile') await page.locator('[data-sidebar=trigger]').first().click();
  await page.locator('a[href="/tour-plans"]:visible').first().click();
  await page.getByTestId('tp-month').waitFor({ timeout: 15000 });
  if (nextMonth1) await page.getByRole('button', { name: 'Next month' }).click();
  await page
    .getByTestId('tp-empty')
    .or(page.getByTestId('tp-calendar'))
    .first()
    .waitFor({ timeout: 10000 });
  if (await page.getByTestId('tp-start').isVisible()) await page.getByTestId('tp-start').click();
  await page.getByTestId('tp-calendar').waitFor();
  await page.locator(`[data-testid=tp-day][data-date="${D}"]`).click();
  await page.getByTestId('tp-wt').click();
  await page.getByRole('option', { name: 'Field work' }).click();
  await page.getByTestId('tp-terr').click();
  await page.getByRole('option').first().click();
  await page.getByTestId('tp-save').click();
  await page
    .getByText(/You are on approved leave on/)
    .first()
    .waitFor({ timeout: 10000 });
  check(true, `${view}: Tour Plans shows LEAVE_DAY_BLOCKED in plain words`);
  check(
    await page.getByTestId('tp-editor').isVisible(),
    `${view}: editor stays open so the day can be changed`,
  );
  check(
    (await page.locator(`[data-testid=tp-day][data-date="${D}"]`).getAttribute('data-empty')) ===
      'true',
    `${view}: blocked day not saved`,
  );
  await shot(page, `tp-blocked-${view}.png`);
  await page.keyboard.press('Escape');
  await page.locator(`[data-testid=tp-day][data-date="${D2}"]`).click();
  await page.getByTestId('tp-wt').click();
  await page.getByRole('option', { name: 'Field work' }).click();
  await page.getByTestId('tp-terr').click();
  await page.getByRole('option').first().click();
  await page.getByTestId('tp-save').click();
  await page.getByTestId('tp-editor').waitFor({ state: 'hidden', timeout: 10000 });
  check(
    (await page.locator(`[data-testid=tp-day][data-date="${D2}"]`).getAttribute('data-empty')) ===
      'false',
    `${view}: a day without approved leave (cancelled request) saves`,
  );
  await ctx.close();
}

for (const role of ['system_admin']) {
  const { ctx, page } = await open(role, '/leave', 'desktop');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  check(
    (await page.getByTestId('tab-mine').count()) === 0,
    `${role}: no leave page content (${new URL(page.url()).pathname})`,
  );
  check((await page.locator('a[href="/leave"]').count()) === 0, `${role}: no Leave in the sidebar`);
  await ctx.close();
}
{
  const { ctx, page } = await open('director', '/leave', 'desktop');
  await page.getByTestId('tab-admin').waitFor({ timeout: 20000 });
  await page.getByTestId('tab-admin').click();
  await page.getByTestId('leave-settings').waitFor();
  check(
    (await page.getByTestId('ls-levels').inputValue()) === '2',
    'director: settings show 2 approval levels',
  );
  await page.getByTestId('ls-back').fill('10');
  await page.getByTestId('ls-save').click();
  await page.getByText('Leave settings saved').waitFor({ timeout: 10000 });
  check(true, 'director: settings saved (PUT /v1/leave/settings with version)');
  await shot(page, 'settings-desktop.png');
  await ctx.close();
}
await finish();
