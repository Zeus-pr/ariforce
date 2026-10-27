// Reports pack (#55): four reports on the shared table, Excel/PDF export. Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3100 node e2e/reports-evidence.mjs
import { readFileSync } from 'node:fs';
import { setup } from './lib.mjs';

const { check, open, shot, noOverflow, noBannedWords, finish } = await setup('reports');

for (const [role, view] of [
  ['area_business_manager', 'desktop'],
  ['business_manager', 'mobile'],
]) {
  const { ctx, page } = await open(role, '/reports', view);
  // The tabs render after the client sets the month (placeholder first); wait instead of counting at once.
  await page.getByTestId('report-pick').first().waitFor({ timeout: 15000 });
  check((await page.getByTestId('report-pick').count()) === 4, `${role}: four reports offered`);
  for (const [i, name] of ['activity', 'coverage', 'sales', 'products'].entries()) {
    await page.getByTestId('report-pick').nth(i).click();
    await page.waitForURL((u) => u.searchParams.get('r') === name);
    await page.getByTestId('report-table').getByTestId('perf-row').first().waitFor();
    const n = await page.getByTestId('report-table').getByTestId('perf-row').count();
    check(n >= 1, `${role}: ${name} report has ${n} rows`);
    if (view === 'desktop' && (name === 'activity' || name === 'products')) {
      for (const kind of ['xlsx', 'pdf']) {
        await page.getByTestId('report-table').getByTestId('export').click();
        const [dl] = await Promise.all([
          page.waitForEvent('download'),
          page.getByTestId(`export-${kind}`).click(),
        ]);
        const head = readFileSync(await dl.path())
          .subarray(0, 4)
          .toString('latin1');
        check(
          kind === 'xlsx' ? head.startsWith('PK') : head === '%PDF',
          `${name}: ${kind} export ${dl.suggestedFilename()}`,
        );
      }
    }
  }
  if (view === 'desktop') {
    const t = await page.getByTestId('report-table').getByTestId('perf-row').first().textContent();
    await page.getByTestId('report-pick').nth(0).click();
    await page.waitForURL((u) => u.searchParams.get('r') === 'activity');
    const total = page.getByTestId('report-table').getByTestId('perf-row').first().filter({ hasText: 'Team total' });
    const ok = await total.waitFor({ timeout: 8000 }).then(() => true, () => false);
    check(ok, `manager report starts with a team total (was ${t.slice(0, 20)}…)`);
  }
  await noBannedWords(page, `reports ${role}`);
  if (view === 'mobile') await noOverflow(page, 'reports mobile');
  await shot(page, `reports-${role}-${view}.png`);
  await ctx.close();
}

await finish();
