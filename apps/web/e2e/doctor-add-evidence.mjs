// Doctor-add form (#26): RBM+ only, live duplicate check, 409 handling, pending status. Writes go to the in-page mock (MSW).
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/doctor-add-evidence.mjs
import { setup } from './lib.mjs';

const lib = await setup('doctor-add');
const { check, finish } = lib;
async function open(role) {
  const r = await lib.open(role, '/doctors');
  await r.page
    .getByRole('heading', { name: /Doctors/ })
    .first()
    .waitFor({ timeout: 15000 });
  await r.page.waitForLoadState('networkidle');
  return r;
}
const addBtn = (p) => p.getByRole('button', { name: /Add doctor/ });

for (const role of ['business_manager', 'area_business_manager']) {
  const { ctx, page } = await open(role);
  check((await addBtn(page).count()) === 0, `${role}: no Add doctor button`);
  await ctx.close();
}
{
  const { ctx, page } = await open('director');
  check(await addBtn(page).isVisible(), 'director: Add doctor button visible');
  await ctx.close();
}

const { ctx, page } = await open('regional_business_manager');
check(await addBtn(page).isVisible(), 'RBM: Add doctor button visible');
await addBtn(page).click();
const panel = page.getByTestId('dup-panel');
// Soft duplicate: same name (without "Dr.") + PIN.
await page.locator('#f-name').fill('A. Sen');
await page.locator('#f-territoryId').click();
await page.getByRole('option', { name: /Kolkata North/ }).click();
await page.locator('#f-pincode').fill('700004');
await panel.waitFor({ timeout: 5000 });
check(
  (await page.locator('[data-testid=dup-match][data-rule=name_pincode]').count()) > 0,
  'live check lists the name + PIN match',
);
check(
  await panel.getByText('Same name and PIN code').first().isVisible(),
  'match shows a plain-text rule badge',
);
await page.getByRole('button', { name: 'Add', exact: true }).click();
await page.locator('[data-testid=dup-panel][data-conflict=soft]').waitFor({ timeout: 5000 });
check(
  await page.getByTestId('dup-add-anyway').isVisible(),
  '409 DOCTOR_POSSIBLE_DUPLICATE offers Add anyway',
);
let body = null;
page.on('request', (r) => {
  if (r.method() === 'POST' && new URL(r.url()).pathname === '/v1/doctors') body = r.postDataJSON();
});
await page.getByTestId('dup-add-anyway').click();
await page.getByText('Added A. Sen. Awaiting approval.').waitFor({ timeout: 5000 });
check(body?.allowPossibleDuplicate === true, 'resend carries allowPossibleDuplicate: true');
check(true, 'RBM-added doctor is pending (toast says Awaiting approval)');
await page
  .getByPlaceholder(/search/i)
  .first()
  .fill('A. Sen');
await page.waitForTimeout(1200);
check(
  await page
    .locator('[data-testid=table-row]')
    .filter({ hasText: 'A. Sen' })
    .getByTestId('doctor-approval')
    .first()
    .isVisible()
    .catch(() => false),
  'list shows Awaiting approval badge on the new doctor',
);

// Hard duplicate: same registration number, never overridable.
await addBtn(page).click();
await page.locator('#f-name').fill('Dr. Someone Else');
await page.locator('#f-territoryId').click();
await page.getByRole('option', { name: /Kolkata North/ }).click();
await page.locator('#f-registrationNo').fill('WBMC-12345');
await page
  .locator('[data-testid=dup-match][data-rule=registration_no]')
  .first()
  .waitFor({ timeout: 5000 });
check(true, 'live check lists the registration-no. match');
await page.getByRole('button', { name: 'Add', exact: true }).click();
await page.locator('[data-testid=dup-panel][data-conflict=hard]').waitFor({ timeout: 5000 });
check(
  (await page.getByTestId('dup-add-anyway').count()) === 0,
  '409 DOCTOR_DUPLICATE has no override',
);
check(
  /cannot be added again/.test(await page.getByTestId('dup-title').textContent()),
  'hard duplicate message shown',
);
await ctx.close();
await finish();
