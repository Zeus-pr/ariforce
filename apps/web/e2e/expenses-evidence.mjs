// Expense claims (#52), MSW mock: BM drafts a claim, adds lines, uploads receipts (hotel needs one),
// submits; an ABM sends it back, BM resubmits, ABM approves; Director / System Admin pays; reconciliation + reports export.
// The mock keeps claims in page memory, so roles are switched in-page (preview role), never by reload.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/expenses-evidence.mjs
import { setup } from './lib.mjs';

const { check, open, shot, noOverflow, noBannedWords, finish } = await setup('expenses');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

async function as(page, role) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('af:session'));
    s.previewRole = r === s.role ? undefined : r;
    localStorage.setItem('af:session', JSON.stringify(s));
    window.dispatchEvent(new StorageEvent('storage', { key: 'af:session' }));
  }, role);
}
async function addLine(page, category, amount, notes) {
  await page.getByTestId('exp-add-line').click();
  const d = page.getByTestId('exp-line-dialog');
  await d.waitFor();
  await page.getByTestId('exp-line-date').fill(today);
  await page.getByTestId('exp-line-category').click();
  await page.getByRole('option', { name: category }).click();
  await page.getByTestId('exp-line-amount').fill(String(amount));
  await page.getByTestId('exp-line-notes').fill(notes);
  await page.getByTestId('exp-line-save').click();
  await d.waitFor({ state: 'hidden' });
}

for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open('business_manager', '/expenses', view);
  await page.getByTestId('exp-open-month').waitFor({ timeout: 20000 });
  if (view === 'mobile') await page.locator('[data-sidebar=trigger]').first().click();
  check(
    (await page.locator('a[href="/expenses"]:visible').count()) > 0,
    `${view}: sidebar has Expenses`,
  );
  if (view === 'mobile') await page.keyboard.press('Escape');
  await page.getByTestId('exp-empty').waitFor();
  await shot(page, `list-empty-${view}.png`);
  await page.getByTestId('exp-open-month').click();
  await page.getByTestId('exp-claim').waitFor({ timeout: 15000 });
  const claimUrl = new URL(page.url()).pathname;
  check(/^\/expenses\/[\w-]+$/.test(claimUrl), `${view}: draft claim opened (${claimUrl})`);

  await addLine(page, 'Travel', 450, 'Bus to Howrah');
  await addLine(page, 'Hotel', 1800, 'Hotel night');
  check((await page.getByTestId('exp-line').count()) === 2, `${view}: two lines listed`);
  check(
    (await page.getByTestId('exp-total').textContent()).replace(/\s/g, '').includes('2,250'),
    `${view}: total is 2,250`,
  );
  check(
    await page.getByTestId('exp-hotel-needs-receipt').isVisible(),
    `${view}: hotel line asks for a receipt`,
  );
  check(
    await page.getByTestId('exp-submit').isDisabled(),
    `${view}: submit blocked until hotel receipt`,
  );

  const hotel = page.getByTestId('exp-line').filter({ hasText: 'Hotel night' });
  const accept = await hotel.getByTestId('exp-file-input').getAttribute('accept');
  check(
    ['.heic', '.pdf', '.xlsx', '.xls', '.csv', '.jpg', '.png'].every((x) => accept.includes(x)),
    `${view}: picker accepts JPG/PNG/HEIC/PDF/XLSX/XLS/CSV`,
  );
  check(
    (await hotel.getByTestId('exp-camera').count()) > 0 || view === 'desktop',
    `${view}: camera option present`,
  );
  await hotel.getByTestId('exp-file-input').setInputFiles({
    name: 'big.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(11 * 1024 * 1024, 1),
  });
  await page.waitForTimeout(500);
  check(
    (await hotel.getByTestId('exp-receipt').count()) === 0,
    `${view}: 11 MB file refused client-side`,
  );
  await hotel
    .getByTestId('exp-file-input')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await page.waitForTimeout(300);
  check((await hotel.getByTestId('exp-receipt').count()) === 0, `${view}: .txt refused`);
  await hotel
    .getByTestId('exp-file-input')
    .setInputFiles({ name: 'hotel-bill.png', mimeType: 'image/png', buffer: PNG });
  await hotel.getByTestId('exp-receipt').first().waitFor({ timeout: 10000 });
  check(
    (await hotel.getByTestId('exp-receipt').count()) === 1,
    `${view}: receipt uploaded + confirmed`,
  );
  await page
    .waitForFunction(() => !document.querySelector('[data-testid=exp-submit]')?.disabled, null, {
      timeout: 5000,
    })
    .catch(() => {});
  check(
    !(await page.getByTestId('exp-submit').isDisabled()),
    `${view}: submit enabled with hotel receipt`,
  );
  await noOverflow(page, `${view} claim draft`);
  await noBannedWords(page, `${view} claim draft`);
  await shot(page, `draft-${view}.png`);
  await page.getByTestId('exp-submit').click();
  await page.getByText('Waiting for approval').first().waitFor({ timeout: 10000 });
  check(
    (await page.getByTestId('exp-add-line').count()) === 0,
    `${view}: submitted claim is read-only`,
  );

  // ABM sends back with a comment.
  await as(page, 'area_business_manager');
  await page.getByTestId('exp-reject').waitFor({ timeout: 10000 });
  check((await page.getByTestId('exp-recon').count()) > 0, `${view}: approver sees reconciliation`);
  await page.getByTestId('exp-reject').click();
  await page.getByTestId('exp-comment').fill('Add the bus ticket');
  await page.getByTestId('exp-decide-confirm').click();
  await page.getByText('Sent back').first().waitFor({ timeout: 10000 });
  check(true, `${view}: ABM sent the claim back`);

  // BM sees the comment, resubmits.
  await as(page, 'business_manager');
  await page.getByText('Add the bus ticket').waitFor({ timeout: 10000 });
  check(
    /^Rejected: Add the bus ticket, by [^,]+, \d/.test(
      await page.getByTestId('exp-reject-comment').innerText(),
    ),
    `${view}: owner sees "Rejected: <reason>, by <name>, <date>"`,
  );
  await page.getByTestId('exp-submit').click();
  await page.getByText('Waiting for approval').first().waitFor({ timeout: 10000 });
  check(true, `${view}: resubmitted`);

  // ABM approves; the owner cannot approve their own claim.
  check(
    (await page.getByTestId('exp-approve').count()) === 0,
    `${view}: owner has no approve button`,
  );
  await as(page, 'area_business_manager');
  await page.getByTestId('exp-approve').click();
  await page.getByTestId('exp-decide-confirm').click();
  await page.getByText('Approved').first().waitFor({ timeout: 10000 });
  check(true, `${view}: ABM approved`);

  // Only Director and System Admin pay. ABM (approver) and BM (owner) get no pay button.
  await page.waitForTimeout(500);
  check((await page.getByTestId('exp-pay').count()) === 0, `${view}: ABM has no pay button`);
  await as(page, 'business_manager');
  await page.getByText('Approved').first().waitFor({ timeout: 10000 });
  check((await page.getByTestId('exp-pay').count()) === 0, `${view}: BM has no pay button`);
  await as(page, view === 'desktop' ? 'director' : 'system_admin');
  await page.getByTestId('exp-pay').waitFor({ timeout: 10000 });
  await page.getByTestId('exp-pay').click();
  check(
    await page.getByTestId('exp-pay-confirm').isDisabled(),
    `${view}: pay needs a payment reference`,
  );
  await page.getByTestId('exp-payref').fill('NEFT-TEST-001');
  await page.getByTestId('exp-pay-confirm').click();
  await page.getByTestId('exp-paid').waitFor({ timeout: 10000 });
  check(
    /NEFT-TEST-001/.test(await page.getByTestId('exp-paid').innerText()),
    `${view}: ${view === 'desktop' ? 'Director' : 'System Admin'} marked the claim paid`,
  );
  await shot(page, `paid-${view}.png`);

  // Reports + export (as ABM).
  await as(page, 'area_business_manager');
  await ctx.close();
}

// Reports page and export (fresh page; the report renders even with no claims).
{
  const { ctx, page } = await open('area_business_manager', '/expenses/reports');
  await page.getByTestId('rep-export-xlsx').waitFor({ timeout: 20000 });
  await page
    .waitForFunction(
      () => !document.querySelector('[data-testid=rep-export-xlsx]')?.disabled,
      null,
      { timeout: 10000 },
    )
    .catch(() => {});
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
    page.getByTestId('rep-export-xlsx').click(),
  ]);
  check(
    !!dl && /\.xlsx$/.test(dl.suggestedFilename()),
    `reports: xlsx export downloads (${dl?.suggestedFilename()})`,
  );
  const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
    page.getByTestId('rep-export-pdf').click(),
  ]);
  check(
    !!dl2 && /\.pdf$/.test(dl2.suggestedFilename()),
    `reports: pdf export downloads (${dl2?.suggestedFilename()})`,
  );
  await shot(page, 'reports-desktop.png');
  await ctx.close();
}
// Role gate: a director without expense permissions or the right page.
{
  const { ctx, page } = await open('system_admin', '/');
  await page.waitForTimeout(1500);
  check(
    (await page.locator('a[href="/expenses"]').count()) > 0,
    'system admin: Expenses in sidebar (pays claims)',
  );
  await ctx.close();
}
await finish();
