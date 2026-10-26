// Hierarchy drill-down (#31): breadcrumb, drill to a person, Excel/PDF export. Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3100 node e2e/team-evidence.mjs
import { setup } from './lib.mjs';

const { check, open, shot, noOverflow, noBannedWords, finish } = await setup('team');
const crumbs = (page) => page.locator('[data-testid=breadcrumb] li').allTextContents();

{
  const { ctx, page } = await open('director', '/team');
  await page.getByTestId('team-row').first().waitFor();
  check((await crumbs(page)).length === 1, `director starts at the top (${await crumbs(page)})`);
  check((await page.getByTestId('kpi-card').count()) >= 4, 'scope KPI cards render');
  await page.locator('[role=img] .recharts-bar-rectangle').first().waitFor();
  check(true, 'coverage chart renders');
  await noBannedWords(page, 'team');
  await shot(page, 'top-desktop.png');

  // Drill down until people are listed.
  for (let depth = 2; depth < 8; depth++) {
    if (/People/.test(await page.getByTestId('team-list-title').textContent())) break;
    await page.getByTestId('team-row').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-testid=breadcrumb] li').length === n,
      depth,
    );
    await page.getByTestId('team-row').first().waitFor();
  }
  const trail = await crumbs(page);
  check(trail.length >= 3, `breadcrumb drills down (${trail.join(' › ')})`);
  check(new URL(page.url()).searchParams.has('t'), 'drill state is in the URL');
  const name = (
    await page.getByTestId('team-row').first().locator('td').first().textContent()
  ).trim();
  await page.getByTestId('team-row').first().click();
  await page.waitForURL((u) => u.searchParams.has('u'));
  await page.locator('[data-testid=breadcrumb] [aria-current=page]', { hasText: name }).waitFor();
  check(true, `person level shows ${name}`);
  await shot(page, 'person-desktop.png');

  // Breadcrumb back to the top.
  await page.locator('[data-testid=breadcrumb] button').first().click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid=breadcrumb] li').length === 1,
  );
  check(!new URL(page.url()).searchParams.has('u'), 'breadcrumb returns to the top');

  for (const [kind, ext] of [
    ['xlsx', '.xlsx'],
    ['pdf', '.pdf'],
  ]) {
    await page.getByTestId('team-row').first().waitFor();
    await page.getByTestId('export').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId(`export-${kind}`).click(),
    ]);
    const file = await dl.path();
    const { statSync, readFileSync } = await import('node:fs');
    const head = readFileSync(file).subarray(0, 4).toString('latin1');
    const ok =
      dl.suggestedFilename().endsWith(ext) &&
      statSync(file).size > 500 &&
      (kind === 'xlsx' ? head.startsWith('PK') : head === '%PDF');
    check(ok, `${kind} export downloads ${dl.suggestedFilename()} (${statSync(file).size} bytes)`);
  }
  await ctx.close();
}

{
  const { ctx, page } = await open('area_business_manager', '/team', 'mobile');
  await page.getByTestId('team-row').first().waitFor();
  await noOverflow(page, 'team mobile');
  await shot(page, 'abm-mobile.png');
  check(true, 'manager can open team performance on mobile');
  await ctx.close();
}

await finish();
