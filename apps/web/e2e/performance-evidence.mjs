// Coverage and Sales/Targets (#49). Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3100 node e2e/performance-evidence.mjs
import { setup } from './lib.mjs';

const { check, open, shot, noOverflow, noBannedWords, finish } = await setup('performance');

for (const [route, table, chart] of [
  ['/coverage', 'coverage-table', 'Coverage over six months'],
  ['/sales', 'sales-table', 'Sales against target, six months'],
]) {
  for (const [role, view] of [
    ['director', 'desktop'],
    ['area_business_manager', 'desktop'],
    ['business_manager', 'mobile'],
  ]) {
    const { ctx, page } = await open(role, route, view);
    await page.getByTestId(table).getByTestId('perf-row').first().waitFor();
    const n = await page.getByTestId(table).getByTestId('perf-row').count();
    check(role === 'business_manager' ? n === 1 : n >= 1, `${route} ${role}: ${n} breakdown rows`);
    check((await page.getByTestId('kpi-card').count()) >= 4, `${route} ${role}: KPI cards`);
    await page.locator(`[role=img][aria-label="${chart}"] .recharts-surface`).first().waitFor();
    check(true, `${route} ${role}: trend chart`);
    check(
      (await page.getByTestId('sample-badge').count()) >= 1,
      `${route} ${role}: sample data labelled`,
    );
    await noBannedWords(page, `${route} ${role}`);
    if (view === 'mobile') await noOverflow(page, `${route} mobile`);
    if (role === 'area_business_manager') {
      const before = await page.getByTestId('month-label').textContent();
      await page.getByRole('button', { name: 'Previous month' }).click();
      await page.waitForURL((u) => u.searchParams.has('m'));
      await page.getByTestId('month-label').filter({ hasNotText: before }).waitFor();
      check(true, `${route}: month switch goes to the URL`);
      await page.getByTestId(table).getByTestId('perf-row').first().waitFor();
      await page.getByTestId(table).getByTestId('export').click();
      const [dl] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-xlsx').click(),
      ]);
      check(
        dl.suggestedFilename().endsWith('.xlsx'),
        `${route}: Excel export ${dl.suggestedFilename()}`,
      );
    }
    await shot(page, `${route.slice(1)}-${role}-${view}.png`);
    await ctx.close();
  }
}

await finish();
