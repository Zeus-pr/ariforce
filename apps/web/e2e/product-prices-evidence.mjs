// System Admin product prices (mock, contract feat/product-prices-admin): nav gating, missing-PTR filter,
// inline per-row save, PTR above MRP message, bulk save with per-row summary, price history drawer.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/product-prices-evidence.mjs
import { setup } from './lib.mjs';

const { BASE, check, open, shot, noOverflow, noBannedWords, finish } =
  await setup('product-prices');
for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open('system_admin', '/', view);
  await page.goto(`${BASE}/admin/product-prices`, { waitUntil: 'load' });
  await page.getByTestId('pp-row').first().waitFor({ timeout: 20000 });
  const n = await page.getByTestId('pp-row').count();
  check(n > 0, `${view}: products listed (${n})`);
  const noPtr = await page.getByTestId('pp-no-ptr').count();
  await page.getByTestId('pp-missing').check();
  await page.waitForTimeout(800);
  const m = await page.getByTestId('pp-row').count();
  const e = await page.getByTestId('pp-empty').count();
  check(
    (m > 0 && (await page.getByTestId('pp-no-ptr').count()) === m) || e === 1,
    `${view}: missing-PTR filter (${m} rows, flagged ${noPtr} before)`,
  );
  await page.getByTestId('pp-missing').uncheck();
  await page.waitForTimeout(800);
  const row = page.getByTestId('pp-row').first();
  // PTR above MRP → message, nothing sent.
  await row.getByTestId('pp-mrp').fill('100');
  await row.getByTestId('pp-ptr').fill('150');
  await row.getByTestId('pp-save').click();
  check(
    (await row.getByTestId('pp-row-error').textContent()).includes('PTR cannot be above MRP'),
    `${view}: PTR above MRP message`,
  );
  await row.getByTestId('pp-ptr').fill('80.5');
  await row.getByTestId('pp-pts').fill('70');
  await row.getByTestId('pp-save').click();
  await page.waitForFunction(
    () => !document.querySelector('[data-testid=pp-row]')?.hasAttribute('data-dirty'),
    null,
    { timeout: 10000 },
  );
  check(
    (await row.getByTestId('pp-ptr').inputValue()) === '80.5',
    `${view}: row saved with server values`,
  );
  await row.getByTestId('pp-history').click();
  await page.getByTestId('pp-history-item').first().waitFor({ timeout: 10000 });
  check(
    (await page.getByTestId('pp-history-item').first().textContent()).includes('80.50'),
    `${view}: history shows the change`,
  );
  await page.keyboard.press('Escape');
  await page.getByTestId('pp-history-sheet').waitFor({ state: 'hidden' });
  // Bulk: two rows edited, one invalid on the server side is not reachable here, so check summary counts.
  const r2 = page.getByTestId('pp-row').nth(1);
  const r3 = page.getByTestId('pp-row').nth(0);
  await r2.getByTestId('pp-mrp').fill('500');
  await r2.getByTestId('pp-ptr').fill('400');
  await r3.getByTestId('pp-ptr').fill('');
  check(
    (await page.getByTestId('pp-save-all').textContent()).includes('(2)'),
    `${view}: save all counts edited rows`,
  );
  await page.getByTestId('pp-save-all').click();
  await page.getByTestId('pp-bulk-summary').waitFor({ timeout: 10000 });
  const sum = await page.getByTestId('pp-bulk-summary').textContent();
  check(/Saved 2 rows: 2 updated/.test(sum), `${view}: bulk summary (${sum.trim()})`);
  await page.waitForTimeout(800);
  check(
    (await page.getByTestId('pp-row').nth(0).getByTestId('pp-no-ptr').count()) === 1,
    `${view}: cleared PTR is flagged`,
  );
  await noOverflow(page, `${view} prices`);
  await noBannedWords(page, `${view} prices`);
  await shot(page, `prices-${view}.png`);
  await ctx.close();
}
{
  const { ctx, page } = await open('director', '/');
  check(
    (await page.locator('a[href="/admin/product-prices"]').count()) === 0,
    'director: no Product prices nav',
  );
  await page.goto(`${BASE}/admin/product-prices`, { waitUntil: 'load' });
  await page.waitForURL((u) => !u.pathname.startsWith('/admin'), { timeout: 15000 });
  check(true, 'director: route gated');
  await ctx.close();
}
{
  const { ctx, page } = await open('system_admin', '/');
  await page.locator('a[href="/admin/product-prices"]').first().waitFor({ timeout: 15000 });
  check(true, 'system admin: Product prices in nav');
  await ctx.close();
}
await finish();
