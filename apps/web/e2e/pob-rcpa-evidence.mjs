// POB/RCPA on DCR #40 (mock): POB on doctor and chemist calls, RCPA only on chemist calls,
// server-computed order value shown after save, duplicate-line 422 in plain words.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/pob-rcpa-evidence.mjs
import { setup } from './lib.mjs';

const { BASE, check, open, shot, noOverflow, noBannedWords, finish } = await setup('pob-rcpa');
const pick = async (page, trigger, idx = 0, name) => {
  await page.getByTestId(trigger).last().click();
  await (name ? page.getByRole('option', { name }) : page.getByRole('option').nth(idx)).click();
};
const pickOutlet = async (page) => {
  const o = page.locator('[data-testid=call-doctor-option]:not([aria-disabled=true])').first();
  await o.waitFor({ timeout: 15000 });
  const name = (await o.locator('span span').first().textContent()).trim();
  await o.click();
  return name;
};
for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open('director', '/', view);
  await page.goto(`${BASE}/dcr`, { waitUntil: 'load' });
  await page.getByTestId('dcr-wt').waitFor({ timeout: 20000 });
  await pick(page, 'dcr-wt', 0, 'Field work');
  await pick(page, 'dcr-terr');
  // Doctor call with an order line (POB allowed on doctor calls), no RCPA section.
  await page.getByTestId('dcr-add-call').click();
  await pickOutlet(page);
  check((await page.getByTestId('rcpa').count()) === 0, `${view}: no RCPA on a doctor call`);
  await page.getByTestId('pob-add').click();
  await pick(page, 'pob-product', 0);
  await page.getByTestId('pob-qty').last().fill('10');
  await page.getByTestId('call-add').click();
  await page.getByTestId('dcr-call-pob').first().waitFor();
  check((await page.getByTestId('dcr-call-pob').first().textContent()).includes('value after save'), `${view}: no client-side order value`);
  // Chemist call with POB + RCPA (competitor brand).
  await page.getByTestId('dcr-add-call').click();
  await pick(page, 'call-kind', 0, 'Chemist');
  await pickOutlet(page);
  await page.getByTestId('rcpa').waitFor();
  await page.getByTestId('pob-add').click();
  await pick(page, 'pob-product', 1);
  await page.getByTestId('pob-qty').last().fill('5');
  await page.getByTestId('rcpa-add').click();
  await pick(page, 'rcpa-product', 0);
  await page.getByTestId('rcpa-brand').last().fill('Rivalcin');
  await page.getByTestId('rcpa-company').last().fill('Other Pharma');
  await page.getByTestId('rcpa-qty').last().fill('12');
  await page.getByTestId('rcpa-rx').last().fill('3');
  await noOverflow(page, `${view} call dialog`);
  await shot(page, `chemist-call-${view}.png`);
  await page.getByTestId('call-add').click();
  await page.getByTestId('dcr-call-rcpa').first().waitFor();
  check(true, `${view}: chemist call with RCPA added`);
  await page.getByTestId('dcr-save').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=dcr-status]')?.textContent === 'Draft', null, { timeout: 10000 });
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=dcr-call-pob]')].every((e) => !e.textContent.includes('after save')), null, { timeout: 10000 });
  const t = await page.getByTestId('dcr-call-pob').first().textContent();
  check(/₹|price/.test(t), `${view}: order value from server after save (${t})`);
  await noOverflow(page, `${view} dcr`);
  await noBannedWords(page, `${view} dcr`);
  await shot(page, `saved-${view}.png`);
  // Duplicate product in one order → plain 422 message.
  await page.getByTestId('dcr-add-call').click();
  await pickOutlet(page);
  for (let i = 0; i < 2; i++) {
    await page.getByTestId('pob-add').click();
    await pick(page, 'pob-product', 0);
    await page.getByTestId('pob-qty').last().fill('2');
  }
  await page.getByTestId('call-add').click();
  await page.getByTestId('dcr-save').click();
  await page.getByText('A product appears twice in one order').waitFor({ timeout: 10000 });
  check(true, `${view}: duplicate POB 422 shown in plain words`);
  await ctx.close();
}
await finish();
