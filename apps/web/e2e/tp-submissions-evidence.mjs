// #86 per-day tour-plan submissions on the MSW mock.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/tp-submissions-evidence.mjs
import { setup } from './lib.mjs';

const { check, open, shot, noOverflow, finish } = await setup('tp-submissions');
const ym = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date());
const nextYm = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};

async function planDay(page, date) {
  await page.locator(`[data-testid=tp-day][data-date="${date}"]`).click();
  await page.getByTestId('tp-wt').click();
  await page.getByRole('option', { name: 'Field work' }).click();
  await page.getByTestId('tp-terr').click();
  await page.getByRole('option').first().click();
  await page.getByTestId('tp-save').click();
  await page.getByTestId('tp-editor').waitFor({ state: 'hidden' });
}
const day = (page, date) => page.locator(`[data-testid=tp-day][data-date="${date}"]`);
const subs = (page) => page.getByTestId('tp-submission');

for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open('director', '/tour-plans', view);
  let apiBase = null;
  page.on('request', (r) => {
    const m = r.url().match(/^(https?:\/\/[^/]+)\/v1\/tour-plans\//);
    if (m && !apiBase) apiBase = m[1];
  });
  const call = (method, p, body) =>
    page.evaluate(
      async ({ url, method, body }) => {
        const r = await fetch(url, {
          method,
          headers: { 'content-type': 'application/json', 'x-mock-user': 'director' },
          body: body ? JSON.stringify(body) : undefined,
        });
        return { status: r.status, json: await r.json().catch(() => null) };
      },
      { url: `${apiBase}${p}`, method, body },
    );

  await page.getByTestId('tp-empty').waitFor({ timeout: 20000 });
  await page.getByTestId('tp-start').click();
  await page.getByTestId('tp-calendar').waitFor();
  const d1 = `${ym}-01`;
  const d2 = `${ym}-02`;

  // 1. Plan day 1 and submit it with a note.
  await planDay(page, d1);
  check((await page.getByTestId('tp-select-day').count()) === 1, `${view}: one draft day offered for submission`);
  await page.getByTestId('tp-note').fill('Day one covers the hospital wing');
  check((await page.getByTestId('tp-note').getAttribute('maxlength')) === '1000', `${view}: note capped at 1000`);
  await page.getByTestId('tp-submit').click();
  await subs(page).first().waitFor({ timeout: 10000 });
  check((await day(page, d1).getAttribute('data-status')) === 'submitted', `${view}: day 1 is Submitted`);
  check((await day(page, d1).getByTestId('tp-day-status').textContent()) === 'Submitted', `${view}: day 1 chip reads "Submitted"`);
  check(await day(page, d1).isDisabled(), `${view}: submitted day 1 is locked`);
  check((await day(page, d1).getByTestId('tp-locked').textContent()) === 'Locked: submitted', `${view}: "Locked: submitted" hint`);
  check((await page.getByTestId('tp-submission-note').first().textContent())?.includes('Day one covers the hospital wing'), `${view}: submission shows the note`);
  check((await page.getByTestId('tp-status').textContent()) === 'Waiting for approval', `${view}: month status aggregates to submitted`);
  await shot(page, `day1-submitted-${view}.png`);

  // 2. Plan day 2 later and submit it separately.
  await planDay(page, d2);
  check((await day(page, d2).getAttribute('data-status')) === 'draft', `${view}: new day 2 added while day 1 is pending (Draft)`);
  const offered = await page.getByTestId('tp-select-day').evaluateAll((els) => els.map((e) => e.dataset.date));
  check(offered.length === 1 && offered[0] === d2, `${view}: only day 2 can be selected`);
  await page.getByTestId('tp-submit').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=tp-submission]').length === 2, null, { timeout: 10000 });
  check((await day(page, d2).getAttribute('data-status')) === 'submitted', `${view}: day 2 submitted in its own submission`);
  check((await subs(page).count()) === 2, `${view}: two submissions listed`);

  // 3. Locked days cannot be changed (409 DAY_LOCKED) and nothing is left to submit (422 EMPTY_PLAN).
  const cur = await call('GET', `/v1/tour-plans/${ym}`);
  const drop = await call('PUT', `/v1/tour-plans/${ym}`, { days: cur.json.days.filter((d) => d.date !== d1), version: cur.json.version });
  check(drop.status === 409 && drop.json?.error?.code === 'DAY_LOCKED' && drop.json.error.details.dates.includes(d1), `${view}: dropping a submitted day -> 409 DAY_LOCKED with its date`);
  const empty = await call('POST', `/v1/tour-plans/${ym}/submit`, {});
  check(empty.status === 422 && empty.json?.error?.code === 'EMPTY_PLAN', `${view}: nothing left to submit -> 422 EMPTY_PLAN`);
  const again = await call('POST', `/v1/tour-plans/${ym}/submit`, { dates: [d1] });
  check(again.status === 409 && again.json?.error?.code === 'DAY_LOCKED', `${view}: resubmitting a submitted day -> 409 DAY_LOCKED`);
  check(await page.getByTestId('tp-submit').isDisabled(), `${view}: submit disabled when every planned day is locked`);

  // 4. A rejected day is editable and resubmittable; approved days stay locked (seeded Feb 2027 plan).
  let m = ym;
  while (m !== '2027-02') {
    await page.getByRole('button', { name: 'Next month' }).click();
    m = nextYm(m);
  }
  await page.locator('[data-testid=tp-day][data-date="2027-02-01"][data-status=rejected]').waitFor({ timeout: 10000 });
  check((await page.getByTestId('tp-status').textContent()) === 'Sent back', `${view}: month with a rejected day reads "Sent back"`);
  check(await day(page, '2027-02-02').isDisabled(), `${view}: approved day is locked`);
  check((await day(page, '2027-02-02').getByTestId('tp-locked').textContent()) === 'Locked: approved', `${view}: "Locked: approved" hint`);
  check(/^Rejected: Wrong territory for the 1st, by [^,]+, /.test((await page.getByTestId('tp-submission-reason').first().textContent()) ?? ''), `${view}: submission shows "Rejected: <reason>, by <name>, <date>"`);
  await day(page, '2027-02-01').click();
  await page.getByTestId('tp-editor').waitFor();
  check((await page.getByTestId('tp-editor').textContent()).includes('Wrong territory for the 1st'), `${view}: editor shows the rejection reason`);
  await page.keyboard.press('Escape');
  await page.getByTestId('tp-editor').waitFor({ state: 'hidden' });
  await planDay(page, '2027-02-01');
  check((await day(page, '2027-02-01').getAttribute('data-status')) === 'rejected', `${view}: edited rejected day stays rejected until resubmitted`);
  await planDay(page, '2027-02-03');
  check((await page.getByTestId('tp-select-day').count()) === 2, `${view}: rejected and new draft day both selectable`);
  await page.locator('[data-testid=tp-select-day][data-date="2027-02-03"]').uncheck();
  check((await page.getByTestId('tp-submit').textContent()) === 'Submit selected days (1)', `${view}: "Submit selected days (1)"`);
  await page.getByTestId('tp-submit').click();
  await page.locator('[data-testid=tp-day][data-date="2027-02-01"][data-status=submitted]').waitFor({ timeout: 10000 });
  check(true, `${view}: rejected day resubmitted on its own`);
  check((await day(page, '2027-02-03').getAttribute('data-status')) === 'draft', `${view}: unselected day stays Draft`);
  await noOverflow(page, view);
  await shot(page, `resubmitted-${view}.png`);

  // 5. Approver sees only that submission's days (seeded BM plan: days 1-2 submitted, day 3 draft).
  const other = page.getByTestId('tp-approval').filter({ hasText: 'Business Manager' }).first();
  await other.waitFor({ timeout: 10000 });
  await other.getByTestId('approval-view').click();
  await other.getByTestId('review-day').first().waitFor({ timeout: 10000 });
  check((await other.getByTestId('review-day').count()) === 2, `${view}: approver sees only the 2 submitted days`);
  check((await other.getByTestId('review-plan-context').textContent()).startsWith('3 planned days'), `${view}: approver sees the plan context`);
  await other.getByTestId('tp-reject').click();
  check(await page.getByRole('button', { name: /^Reject/ }).last().isDisabled(), `${view}: rejecting needs a reason`);
  await shot(page, `approver-${view}.png`);
  await ctx.close();
}
await finish();
