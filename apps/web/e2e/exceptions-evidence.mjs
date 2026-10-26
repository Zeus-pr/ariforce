// Exceptions (#29, #56): rule-based list by severity, filters, drill-down. Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3100 node e2e/exceptions-evidence.mjs
import { setup } from './lib.mjs';

const { check, open, shot, noOverflow, noBannedWords, finish } = await setup('exceptions');

{
  const { ctx, page } = await open('director', '/exceptions');
  await page.getByTestId('exc-count-high').filter({ hasText: /\d/ }).waitFor();
  const n = (s) => page.getByTestId(`exc-count-${s}`).textContent().then(Number);
  const [h, m, l] = [await n('high'), await n('medium'), await n('low')];
  check(h + m + l > 0, `exceptions found (high ${h}, medium ${m}, low ${l})`);
  await page.locator('[role=img][aria-label="Exceptions by type and severity"] .recharts-bar-rectangle').first().waitFor();
  check(true, 'by-type chart renders');
  const sev = await page.locator('[data-testid=table-row] td:first-child').allTextContents();
  const rank = { High: 0, Medium: 1, Low: 2 };
  check(sev.every((s, i) => i === 0 || rank[sev[i - 1]] <= rank[s]), `sorted by severity (${sev.join(',')})`);
  check((await page.getByText('Sample data').count()) >= 1, 'uncovered rule rows labelled Sample data');
  check((await page.getByText('to confirm with Arighna').count()) >= 1, 'thresholds labelled to confirm with Arighna');
  await noBannedWords(page, 'exceptions');
  await shot(page, 'director-desktop.png');

  // Filter by severity through the URL-backed table state.
  await page.goto(page.url().split('?')[0] + '?f.severity=medium', { waitUntil: 'load' });
  await page.locator('[data-testid=table-row]').first().waitFor();
  const filtered = await page.locator('[data-testid=table-row] td:first-child').allTextContents();
  check(filtered.length > 0 && filtered.every((s) => s === 'Medium'), `severity filter (${filtered.length} medium rows)`);

  // Drill: open one, it names the rule and links to the source record.
  await page.locator('[data-testid=table-row]').first().click();
  const sheet = page.getByTestId('exc-detail');
  await sheet.waitFor();
  check(/Rule/.test(await sheet.textContent()), 'detail shows the rule that raised it');
  const drill = sheet.getByTestId('exc-drill').first();
  const href = await drill.getAttribute('href');
  await shot(page, 'detail-desktop.png');
  await drill.click();
  await page.waitForURL((u) => u.pathname === href.split('?')[0]);
  check(true, `drill navigates to ${href}`);
  await ctx.close();
}

for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open('business_manager', '/exceptions', view);
  await page.getByTestId('exc-count-high').filter({ hasText: /\d/ }).waitFor();
  const people = await page.locator('[data-testid=table-row], [data-testid=card-row]').allTextContents();
  check(!people.some((t) => /Demo Business Manager 2/.test(t)), `BM sees only their own exceptions (${view})`);
  if (view === 'mobile') await noOverflow(page, 'exceptions mobile');
  await shot(page, `bm-${view}.png`);
  await ctx.close();
}

await finish();
