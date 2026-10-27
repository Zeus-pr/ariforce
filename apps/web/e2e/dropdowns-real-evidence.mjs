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
      return json({ month, todayIST: today, weeklyOffDays: [0], requiredDates: [today] });
    if (m === 'GET' && u.pathname === `/v1/tour-plans/${month}`)
      return plan ? json(plan) : json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    if (m === 'POST' && u.pathname === `/v1/tour-plans/${month}/copy`) return json({ error: { code: 'NOT_FOUND', message: 'No standard plan' } }, 404);
    if (m === 'PUT' && u.pathname === `/v1/tour-plans/${month}`) {
      const b = r.request().postDataJSON();
      bodies.tp = b;
      plan = { ...base(id(31)), userId: id(99), month, kind: 'mtp', status: 'draft', days: b.days, submittedAt: null, decidedAt: null, decidedBy: null, decisionComment: null };
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
  check((await p.getByTestId('tp-missing').textContent()) === '1 of 1 working days not planned', `${view} real tp: missing count from GET /v1/tour-plans/{month}/calendar requiredDates`);
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
