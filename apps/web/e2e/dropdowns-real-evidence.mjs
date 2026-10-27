// Real-mode (:3200) DCR / Tour Plan dropdowns + request shapes. Every request to the API origin is intercepted
// with page.route and fulfilled locally (fallback included): nothing reaches the real API or DB.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3200 node e2e/dropdowns-real-evidence.mjs
import { chromium, webkit } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const BROWSER = process.env.BROWSER ?? 'chromium';
const engine = { chromium, webkit }[BROWSER];
let ok = true;
const check = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'} [${BROWSER}] ${m}`);
  if (!c) ok = false;
};
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const month = today.slice(0, 7);
const T = '2026-01-01T00:00:00.000Z';
const base = (id) => ({ id, companyId: '00000000-0000-7000-8000-000000000001', createdAt: T, updatedAt: T, deletedAt: null, version: 1 });
const id = (n) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const WT = [
  { ...base(id(11)), code: 'FIELD', name: 'Field work', kind: 'field', requiresCalls: true, active: true },
  { ...base(id(12)), code: 'MEET', name: 'Meeting', kind: 'non_field', requiresCalls: false, active: true },
  { ...base(id(13)), code: 'LEAVE', name: 'Leave', kind: 'leave', requiresCalls: false, active: true },
];
// Like the API's scoped list for a BM: the parent area plus the BM's leaf HQ; only the leaf is offered.
const TERR = [
  { ...base(id(20)), parentId: null, level: 'area', code: 'SB', name: 'South Bengal Area', path: id(20), centroid: null },
  { ...base(id(21)), parentId: id(20), level: 'hq', code: 'KOL', name: 'Kolkata HQ', path: `${id(20)}.${id(21)}`, centroid: null },
];
const page_ = (items) => ({ items, nextCursor: null });
const browser = await engine.launch();
/** Client-side nav through the sidebar; on mobile the links live in a closed sheet, so open it first. */
async function nav(page, href) {
  const a = page.locator(`a[href="${href}"]:visible`).first();
  if (!(await a.count())) await page.locator('[data-sidebar=trigger]').first().click();
  await page.locator(`a[href="${href}"]:visible`).first().click();
  await page.waitForURL(new RegExp(href + '$'));
}


async function run(view, emptyMasters) {
  const ctx = await browser.newContext(view === 'mobile' ? { viewport: { width: 390, height: 844 }, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('af:splash-seen', '1');
    localStorage.setItem('af:mock-session', JSON.stringify({ userId: '00000000-0000-7000-8000-000000000099', role: 'business_manager', user: { id: '00000000-0000-7000-8000-000000000099', name: 'Shape Check', email: 'shape@example.invalid', role: 'business_manager', territory: 'Test' } }));
  });
  const p = await ctx.newPage();
  const bodies = {};
  let plan = null;
  const leaked = [];
  await p.route(/^http:\/\/localhost:4000\//, async (r) => {
    const u = new URL(r.request().url());
    const m = r.request().method();
    const json = (b, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (m === 'GET' && u.pathname === '/v1/work-types') return json(page_(emptyMasters ? [] : WT));
    if (m === 'GET' && u.pathname === '/v1/territories') return json(page_(emptyMasters ? [] : TERR));
    if (m === 'GET' && u.pathname === `/v1/tour-plans/${month}/calendar`)
      return json({ month, todayIST: today, weeklyOffDays: [0], requiredDates: [today], days: (plan?.days ?? []).map((d) => ({ date: d.date, status: d.status ?? 'draft', submissionId: d.submissionId ?? null })) });
    if (m === 'GET' && u.pathname === `/v1/tour-plans/${month}`)
      return plan ? json(plan) : json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    if (m === 'POST' && u.pathname === `/v1/tour-plans/${month}/copy`) return json({ error: { code: 'NOT_FOUND', message: 'No standard plan' } }, 404);
    if (m === 'PUT' && u.pathname === `/v1/tour-plans/${month}`) {
      const b = r.request().postDataJSON();
      bodies.tp = b;
      // #86: days carry their own status; a fresh PUT leaves every day a draft.
      plan = { ...base(id(31)), userId: id(99), month, kind: 'mtp', status: 'draft', days: b.days.map((d) => ({ ...d, status: 'draft', submissionId: null })), submissions: [], submittedAt: null, decidedAt: null, decidedBy: null, decisionComment: null };
      return json(plan);
    }
    if (m === 'POST' && u.pathname === `/v1/tour-plans/${month}/submit`) {
      // Server rule since 0bb7b40: at least one planned day, no full coverage.
      if (!plan?.days?.some((d) => d.entries.length)) return json({ error: { code: 'EMPTY_PLAN', message: 'Add at least one day to the plan before submitting' } }, 422);
      // #86: one submission per call; body is { submitterNote?, dates? }.
      const sb = r.request().postDataJSON() ?? {};
      bodies.submitBody = sb;
      const sid = id(41);
      const dates = plan.days.filter((d) => d.entries.length && (!sb.dates || sb.dates.includes(d.date))).map((d) => d.date);
      plan = {
        ...plan,
        status: 'submitted',
        submittedAt: T,
        days: plan.days.map((d) => (dates.includes(d.date) ? { ...d, status: 'submitted', submissionId: sid } : d)),
        submissions: [{ id: sid, tourPlanId: plan.id, dates, status: 'submitted', approvalId: id(42), submitterNote: sb.submitterNote ?? null, submittedAt: T, decidedAt: null, decidedBy: null, decisionComment: null, rejectionReason: null, rejectedBy: null, rejectedAt: null }],
      };
      bodies.submitted = true;
      return json(plan);
    }
    if (m === 'PUT' && u.pathname === '/v1/dcrs') {
      const b = r.request().postDataJSON();
      bodies.dcr = b;
      return json({ ...base(id(41)), userId: id(99), date: b.date, workTypeId: b.workTypeId, territoryIds: b.territoryIds, tourPlanId: null, deviationReason: b.deviationReason ?? null, status: 'draft', calls: [], submittedAt: null, lockAt: T, unlockedUntil: null });
    }
    if (m === 'GET') return json(page_([]));
    leaked.push(`${m} ${u.pathname}`);
    return json({ error: { code: 'FORBIDDEN', message: 'stubbed' } }, 403);
  });
  const open = async (t) => {
    const tr = p.getByTestId(t);
    if (view === 'mobile') await tr.tap();
    else await tr.click();
    await p.waitForTimeout(250);
    return tr;
  };
  const choose = async (name) => {
    const o = p.getByRole('option', { name });
    if (view === 'mobile') await o.tap();
    else await o.click();
  };

  if (emptyMasters) {
    await p.goto(`${BASE}/dcr`, { waitUntil: 'networkidle' });
    await p.getByTestId('dcr-wt').waitFor({ timeout: 15000 });
    await open('dcr-wt');
    check((await p.getByTestId('select-empty').textContent()).includes('Ask your administrator'), `${view} real dcr: empty work types say what to do`);
    await ctx.close();
    return;
  }

  // Tour plan: start a blank month, plan today, check the PUT body shape.
  await p.goto(`${BASE}/tour-plans`, { waitUntil: 'networkidle' });
  await p.getByTestId('tp-start').click();
  await p.getByTestId('tp-missing').waitFor();
  check((await p.getByTestId('tp-missing').textContent()) === 'No days planned yet', `${view} real tp: informational count with nothing planned`);
  check(await p.getByTestId('tp-submit').isDisabled(), `${view} real tp: submit disabled with 0 planned days`);
  await p.locator(`[data-testid=tp-day][data-date="${today}"]`).click();
  await open('tp-wt');
  check((await p.getByRole('option').count()) === 3, `${view} real tp-wt: lists the 3 work types`);
  await choose('Field work');
  await open('tp-terr');
  check((await p.getByRole('option').allTextContents()).join('|') === 'Kolkata HQ', `${view} real tp-terr: offers only the BM's leaf HQ, not the parent area`);
  await choose('Kolkata HQ');
  await p.getByTestId('tp-save').click();
  await p.getByTestId('tp-editor').waitFor({ state: 'hidden' });
  const e = bodies.tp?.days?.find((d) => d.date === today)?.entries?.[0];
  check(e && e.workTypeId === WT[0].id && JSON.stringify(e.territoryIds) === JSON.stringify([TERR[1].id]) && e.session && Array.isArray(e.jointWorkUserIds), `${view} real PUT /v1/tour-plans/{month}: entry ${JSON.stringify(e)}`);
  check((await p.getByTestId('tp-missing').textContent()) === '1 day planned', `${view} real tp: "1 day planned"`);
  check(await p.getByTestId('tp-submit').isEnabled(), `${view} real tp: submit enabled with 1 planned day`);
  await p.getByTestId('tp-submit').click();
  await p.waitForFunction(() => document.querySelector('[data-testid=tp-status]')?.textContent === 'Waiting for approval', null, { timeout: 10000 });
  check(bodies.submitted === true, `${view} real tp: submit with 1 planned day works (POST /submit)`);

  // DCR: choose work type + territory, save draft, check the PUT body shape.
  await nav(p, '/dcr');
  await p.getByTestId('dcr-wt').waitFor({ timeout: 15000 });
  await open('dcr-wt');
  await choose('Field work');
  await open('dcr-terr');
  await choose('Kolkata HQ');
  check((await p.getByTestId('dcr-terr').textContent()).includes('Kolkata HQ'), `${view} real dcr-terr: value kept`);
  await open('dcr-wt');
  await choose('Meeting');
  await p.getByTestId('dcr-save').click();
  await p.waitForFunction(() => document.querySelector('[data-testid=dcr-status]')?.textContent === 'Draft', null, { timeout: 10000 });
  const d = bodies.dcr;
  check(d && d.date === today && d.workTypeId === WT[1].id && Array.isArray(d.territoryIds) && Array.isArray(d.calls) && d.submit === false, `${view} real PUT /v1/dcrs: ${JSON.stringify(d)}`);
  check(leaked.length === 0, `${view} real: no unexpected writes (${leaked.join(', ') || 'none'})`);
  await ctx.close();
}

for (const view of ['desktop', 'mobile']) {
  await run(view, true);
  await run(view, false);
}
await browser.close();
process.exit(ok ? 0 : 1);
