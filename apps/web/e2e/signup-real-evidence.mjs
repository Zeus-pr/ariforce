// Real-mode (:3200) request-shape and account-state checks. Every /v1 call that would write is
// intercepted with page.route and fulfilled locally: nothing reaches the real API or DB.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3200 node e2e/signup-real-evidence.mjs
import { setup, VIEWS } from './lib.mjs';

const { BASE, browser, check, finish } = await setup('signup-real');
const ctx = await browser.newContext(VIEWS.mobile);
await ctx.addInitScript(() => sessionStorage.setItem('af:splash-seen', '1'));
const page = await ctx.newPage();
let body = null;
await page.route('**/v1/auth/sign-up-request', async (r) => {
  body = r.request().postDataJSON();
  await r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'pending', message: 'Request received.' }) });
});
await page.goto(`${BASE}/sign-up`);
await page.getByLabel('Full name').fill('Shape Check');
await page.getByLabel('Work email').fill('shape.check@example.test');
await page.getByLabel('Password', { exact: true }).fill('Fake!Throwaway99');
await page.getByLabel('Your role').selectOption('business_manager');
await page.getByTestId('signup-form').getByRole('button', { name: 'Send request' }).click();
await page.getByTestId('signup-sent').waitFor();
check(body && body.phone === null && body.territoryId === null && body.managerId === null, 'nulls, not empty strings');
check(body?.requestedRole === 'business_manager' && !('role' in body), 'sends requestedRole');
check(!Object.values(body ?? {}).includes(''), 'no empty strings in body');

for (const [status, code, re] of [
  [409, 'SIGNUP_UNAVAILABLE', /could not create/i],
  [429, 'RATE_LIMITED', /too many/i],
  [403, 'CAPTCHA_FAILED', /security check/i],
  [503, 'SIGNUP_DISABLED', /switched off/i],
  [422, 'VALIDATION_FAILED', /not valid/i],
]) {
  await page.unroute('**/v1/auth/sign-up-request');
  await page.route('**/v1/auth/sign-up-request', (r) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { code, message: code === 'SIGNUP_UNAVAILABLE' ? 'We could not create an account with these details.' : 'x' } }) }),
  );
  await page.goto(`${BASE}/sign-up`);
  await page.getByLabel('Full name').fill('Shape Check');
  await page.getByLabel('Work email').fill('shape.check@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Fake!Throwaway99');
  await page.getByLabel('Your role').selectOption('business_manager');
  await page.getByTestId('signup-form').getByRole('button', { name: 'Send request' }).click();
  const t = await page.getByTestId('signup-error').innerText();
  check(re.test(t), `${status} ${code} -> "${t.slice(0, 60)}"`);
}

for (const [code, re] of [['ACCOUNT_PENDING_APPROVAL', /Awaiting approval/], ['ACCOUNT_REJECTED', /not approved/]]) {
  await page.route('**/v1/auth/sign-in/email', (r) =>
    r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code, message: 'x' }) }),
  );
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel('Work email').fill('shape.check@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Fake!Throwaway99');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByTestId('signin-account-status').waitFor();
  check(re.test(await page.getByTestId('signin-account-status').innerText()), `sign-in 403 ${code} (bare body) -> banner`);
  await page.unroute('**/v1/auth/sign-in/email');
}
await page.goto(`${BASE}/sign-in?account=pending`);
check(/Awaiting approval/.test(await page.getByTestId('signin-account-status').innerText()), '?account=pending banner (from wrapped 403 on data calls)');
await ctx.close();
await finish();
