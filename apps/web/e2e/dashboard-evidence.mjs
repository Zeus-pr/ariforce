// KPI dashboard (#12) on the real contracts (MSW mock): role scope, KPI cards, product view, approvals.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3100 node e2e/dashboard-evidence.mjs
import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const BROWSER = process.env.BROWSER ?? 'chromium';
const engine = { chromium, webkit }[BROWSER];
const OUT = path.resolve(
  import.meta.dirname,
  `../../../docs/evidence/dashboard${BROWSER === 'chromium' ? '' : '-' + BROWSER}`,
);
fs.mkdirSync(OUT, { recursive: true });
let ok = true;
const check = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'} [${BROWSER}] ${m}`);
  if (!c) ok = false;
};
const VIEWS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
};
const browser = await engine.launch();
const errors = [];
const ID = { director: 'director', area_business_manager: 'abm', business_manager: 'bm' };

async function open(role, view = 'desktop') {
  const ctx = await browser.newContext(VIEWS[view]);
  await ctx.addInitScript(
    (s) => {
      sessionStorage.setItem('af:splash-seen', '1');
      localStorage.setItem('af:mock-session', s);
    },
    JSON.stringify({ userId: `mock-${ID[role]}`, role }),
  );
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      errors.push(`${role}/${view}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${role}/${view}: ${e.message}`));
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.getByTestId('kpi-card').first().waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[data-testid=kpi-card] .animate-pulse'),
  );
  return { ctx, page };
}

{
  const { ctx, page } = await open('director');
  const scope = await page.getByTestId('kpi-scope').textContent();
  check(scope.startsWith('Whole company'), `director scope is company (${scope})`);
  check((await page.getByTestId('kpi-card').count()) === 8, '8 KPI cards');
  const cov = page.locator('[data-testid=kpi-card][data-kpi=coverage_pct]');
  check(/%/.test(await cov.textContent()), 'coverage shows a percent');
  check(/Target|No target set/.test(await cov.textContent()), 'card shows target state');
  check(
    (await page.getByText('to confirm with Arighna').count()) > 0,
    '"to confirm with Arighna" label present',
  );
  check((await page.getByTestId('kpi-formula').count()) === 0, 'formulas collapsed by default');
  await page.getByTestId('kpi-expand').click();
  check(
    (await page.getByTestId('kpi-expand').getAttribute('aria-expanded')) === 'true',
    'expand sets aria-expanded',
  );
  const f = await page.locator('[data-kpi=coverage_pct] [data-testid=kpi-formula]').textContent();
  check(
    /÷/.test(f) && /MSL size/.test(f),
    `coverage numerator ÷ denominator (${f.replace(/\s+/g, ' ')})`,
  );
  check(
    (await cov.getAttribute('title'))?.includes('to confirm with Arighna'),
    'hover title carries formula',
  );
  await page.getByTestId('kpi-product-row').first().waitFor();
  check((await page.getByTestId('kpi-product-row').count()) >= 1, 'product-wise KPI rows');
  check((await page.getByTestId('kpi-team').count()) === 1, 'director sees team table');
  check(
    (await page.getByText('Sample data').count()) >= 1,
    'uncovered exceptions labelled Sample data',
  );
  await page
    .getByTestId('dash-approvals')
    .getByText(/waiting on you/)
    .waitFor();
  await page.screenshot({ path: path.join(OUT, 'director-desktop.png'), fullPage: true });
  await ctx.close();
}

{
  const { ctx, page } = await open('area_business_manager');
  const scope = await page.getByTestId('kpi-scope').textContent();
  check(scope.startsWith('Your team'), `ABM scope is team (${scope})`);
  await page.getByTestId('kpi-team-row').first().waitFor();
  check((await page.getByTestId('kpi-team-row').count()) >= 1, 'ABM team rows from byUser');
  check(
    (await page.getByRole('heading', { name: 'Needs attention' }).count()) === 1,
    'Needs attention layout kept',
  );
  await page.screenshot({ path: path.join(OUT, 'abm-desktop.png'), fullPage: true });
  await ctx.close();
}

for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open('business_manager', view);
  const scope = await page.getByTestId('kpi-scope').textContent();
  check(scope.startsWith('Your own numbers'), `BM scope is self (${view})`);
  check((await page.getByTestId('kpi-team').count()) === 0, `BM has no team table (${view})`);
  check((await page.getByTestId('dash-approvals').count()) === 0, `BM has no approvals (${view})`);
  if (view === 'mobile') {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    check(!overflow, 'no horizontal page overflow on mobile');
  }
  await page.screenshot({ path: path.join(OUT, `bm-${view}.png`), fullPage: true });
  await ctx.close();
}

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
process.exit(ok ? 0 : 1);
