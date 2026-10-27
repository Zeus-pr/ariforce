// Approval detail before deciding, required rejection reason, action buttons (#approvals fix).
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/approvals-evidence.mjs
import { setup } from './lib.mjs';

const { check, open, shot, finish } = await setup('approvals');

for (const view of ['desktop', 'mobile']) {
  // Tour plan: approver opens the plan before deciding.
  const { ctx, page } = await open('director', '/tour-plans', view);
  const item = page.getByTestId('tp-approval').filter({ hasText: 'Business Manager' }).first();
  await item.waitFor({ timeout: 15000 });
  await item.getByTestId('approval-view').click();
  const review = item.getByTestId('approval-review');
  await review.getByTestId('review-month').waitFor({ timeout: 10000 });
  check(/\w+ \d{4}/.test(await review.getByTestId('review-month').innerText()), `${view}: plan review shows the month`);
  check(await review.getByText('Business Manager').first().isVisible(), `${view}: plan review shows the submitter`);
  const days = await review.getByTestId('review-day').count();
  check(days > 0, `${view}: plan review lists planned days (${days})`);
  const first = days ? await review.getByTestId('review-day').first().innerText() : '';
  check(/·/.test(first) && !/…/.test(first), `${view}: day shows work type and names ("${first.replace(/\n/g, ' | ')}")`);
  await shot(page, `tp-review-${view}.png`);
  check(await item.getByTestId('tp-approve').isVisible(), `${view}: Approve still offered`);
  await item.getByTestId('tp-reject').click();
  const confirm = page.getByTestId('reject-confirm');
  await confirm.waitFor();
  check(await confirm.isDisabled(), `${view}: Reject disabled with no reason`);
  await page.getByTestId('reject-reason').fill('   ');
  check(await confirm.isDisabled(), `${view}: whitespace is not a reason`);
  check((await page.getByTestId('reject-reason').getAttribute('maxlength')) === '1000', `${view}: reason capped at the API limit (1000)`);
  await page.getByTestId('reject-reason').fill('Add Kolkata North doctors on Mondays');
  check(await confirm.isEnabled(), `${view}: Reject enabled once a reason is typed`);
  await shot(page, `tp-reject-${view}.png`);
  await confirm.click();
  await page.getByText(/rejected$/).first().waitFor({ timeout: 10000 });
  check(true, `${view}: plan rejected with a reason`);
  await ctx.close();

  // Dashboard: every approval type has "View details" and a reason-gated Reject.
  const d = await open('director', '/', view);
  const row = d.page.getByTestId('dash-approval').first();
  await row.waitFor({ timeout: 15000 });
  await row.getByTestId('approval-view').click();
  await row.getByTestId('approval-review').waitFor({ timeout: 10000 });
  await d.page.waitForTimeout(800);
  const txt = await row.getByTestId('approval-review').innerText();
  check(!/could not be loaded/.test(txt) && txt.length > 20, `${view}: dashboard approval shows details (${(await row.getByTestId('approval-review').getAttribute('data-type'))})`);
  await row.getByTestId('dash-reject').click();
  check(await d.page.getByTestId('reject-confirm').isDisabled(), `${view}: dashboard Reject disabled until a reason is typed`);
  await d.page.keyboard.press('Escape');
  await d.ctx.close();
}

// Team: "View full profile" is a real button (focusable, button styling).
{
  const { ctx, page } = await open('director', '/team');
  const link = page.getByTestId('open-profile');
  for (let i = 0; i < 6 && !(await link.count()); i++) {
    await page.getByTestId('team-row').first().waitFor({ timeout: 15000 });
    await page.getByTestId('team-row').first().click();
    await page.waitForTimeout(1200);
  }
  const has = (await link.count()) > 0;
  if (has) {
    const slot = await link.first().getAttribute('data-slot');
    check(slot === 'button', `team: View full profile renders as Button (data-slot=${slot})`);
    await link.first().focus();
    check(await link.first().evaluate((e) => e === document.activeElement), 'team: View full profile is keyboard-focusable');
    const bg = await link.first().evaluate((e) => getComputedStyle(e).backgroundColor);
    check(bg !== 'rgba(0, 0, 0, 0)', `team: View full profile has a filled brand background (${bg})`);
  } else check(false, 'team: View full profile not found');
  await ctx.close();
}
await finish();
