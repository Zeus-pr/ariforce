// Real-mode (:3200) request-shape and account-state checks. Every /v1 call that would write is
// intercepted with page.route and fulfilled locally: nothing reaches the real API or DB.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3200 node e2e/signup-real-evidence.mjs
import { setup, VIEWS } from './lib.mjs';

const { BASE, browser, check, finish } = await setup('signup-real');
const ctx = await browser.newContext(VIEWS.mobile);
await ctx.addInitScript(() => sessionStorage.setItem('af:splash-seen', '1'));
const page = await ctx.newPage();
let body = null;
const OPTS = {
  territories: [{ id: '00000000-0000-4000-8000-0000000000a1', name: 'Fake HQ', code: 'FHQ' }],
  managers: [
    {
      id: '00000000-0000-4000-8000-0000000000b1',
      name: 'Fake Manager',
      role: 'area_business_manager',
    },
  ],
};
await page.route('**/v1/auth/sign-up-options', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OPTS) }),
);
await page.route('**/v1/auth/sign-up-request', async (r) => {
  body = r.request().postDataJSON();
  await r.fulfill({
    status: 202,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'pending', message: 'Request received.' }),
  });
});
await page.goto(`${BASE}/sign-up`);
await page.getByLabel('Full name').fill('Shape Check');
await page.getByLabel('Work email').fill('shape.check@example.test');
await page.getByLabel('Password', { exact: true }).fill('Fake!Throwaway99');
await page.getByLabel('Your role').selectOption('business_manager');
await page.getByLabel(/^HQ/).selectOption(OPTS.territories[0].id);
await page.getByTestId('signup-manager').selectOption(OPTS.managers[0].id);
await page.getByTestId('signup-form').getByRole('button', { name: 'Send request' }).click();
await page.getByTestId('signup-sent').waitFor();
check(
  body?.territoryId === OPTS.territories[0].id && body?.managerId === OPTS.managers[0].id,
  'sends picked territoryId and managerId',
);
check(body && body.phone === null, 'empty phone sent as null');

// Options endpoint down (503): pickers hidden, form still submits with nulls.
await page.unroute('**/v1/auth/sign-up-options');
await page.route('**/v1/auth/sign-up-options', (r) =>
  r.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'SIGNUP_DISABLED', message: 'x' } }),
  }),
);
await page.goto(`${BASE}/sign-up`);
await page.getByLabel('Full name').fill('Shape Check');
await page.getByLabel('Work email').fill('shape.check@example.test');
await page.getByLabel('Password', { exact: true }).fill('Fake!Throwaway99');
await page.getByLabel('Your role').selectOption('business_manager');
await page.waitForTimeout(300);
check(
  (await page.getByLabel(/^HQ/).count()) === 0 &&
    (await page.getByTestId('signup-manager').count()) === 0,
  'options 503: pickers hidden quietly',
);
await page.getByTestId('signup-form').getByRole('button', { name: 'Send request' }).click();
await page.getByTestId('signup-sent').waitFor();
check(
  body && body.phone === null && body.territoryId === null && body.managerId === null,
  'nulls, not empty strings',
);
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
    r.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code,
          message:
            code === 'SIGNUP_UNAVAILABLE'
              ? 'We could not create an account with these details.'
              : 'x',
        },
      }),
    }),
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

for (const [code, re] of [
  ['ACCOUNT_PENDING_APPROVAL', /Awaiting approval/],
  ['ACCOUNT_REJECTED', /not approved/],
  [
    'ACCOUNT_SUSPENDED',
    /Account suspended[\s\S]*This account is suspended\. Contact your administrator\./,
  ],
]) {
  await page.route('**/v1/auth/sign-in/email', (r) =>
    r.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code, message: 'x' }),
    }),
  );
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel('Work email').fill('shape.check@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Fake!Throwaway99');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByTestId('signin-account-status').waitFor();
  check(
    re.test(await page.getByTestId('signin-account-status').innerText()),
    `sign-in 403 ${code} (bare body) -> banner`,
  );
  await page.unroute('**/v1/auth/sign-in/email');
}
await page.goto(`${BASE}/sign-in?account=pending`);
check(
  /Awaiting approval/.test(await page.getByTestId('signin-account-status').innerText()),
  '?account=pending banner (from wrapped 403 on data calls)',
);
await page.goto(`${BASE}/sign-in?account=suspended`);
check(
  /This account is suspended\. Contact your administrator\./.test(
    await page.getByTestId('signin-account-status').innerText(),
  ),
  '?account=suspended banner (from ACCOUNT_SUSPENDED on data calls)',
);

// 429 RATE_LIMITED: wait time from Retry-After, else details.retryAfterSeconds; 403 ACCOUNT_SUSPENDED on sign-up.
const limited = (r, header, details) =>
  r.fulfill({
    status: 429,
    contentType: 'application/json',
    headers: header
      ? { 'Retry-After': header, 'Access-Control-Expose-Headers': 'Retry-After' }
      : {},
    body: JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'x', details } }),
  });
const signUp = async () => {
  await page.goto(`${BASE}/sign-up`);
  await page.getByLabel('Full name').fill('Shape Check');
  await page.getByLabel('Work email').fill('shape.check@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Fake!Throwaway99');
  await page.getByLabel('Your role').selectOption('business_manager');
  await page.getByTestId('signup-form').getByRole('button', { name: 'Send request' }).click();
  return page.getByTestId('signup-error').innerText();
};
for (const [label, handler, re] of [
  ['429 Retry-After: 30', (r) => limited(r, '30'), /Too many attempts, try again in 30 seconds\./],
  [
    '429 details.retryAfterSeconds 17',
    (r) => limited(r, null, { retryAfterSeconds: 17 }),
    /try again in 17 seconds/,
  ],
  ['429 no hint', (r) => limited(r, null), /Too many attempts, try again in a minute/],
  [
    '403 ACCOUNT_SUSPENDED',
    (r) =>
      r.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'ACCOUNT_SUSPENDED', message: 'x' } }),
      }),
    /This account is suspended\. Contact your administrator\./,
  ],
]) {
  await page.unroute('**/v1/auth/sign-up-request');
  await page.route('**/v1/auth/sign-up-request', handler);
  const t = await signUp();
  check(re.test(t), `sign-up ${label} -> "${t.slice(0, 70)}"`);
}
for (const [label, handler, re] of [
  ['429 Retry-After: 45', (r) => limited(r, '45'), /Too many attempts, try again in 45 seconds\./],
  [
    '429 bare details 9',
    (r) =>
      r.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'RATE_LIMITED',
          message: 'x',
          details: { retryAfterSeconds: 9 },
        }),
      }),
    /try again in 9 seconds/,
  ],
]) {
  await page.route('**/v1/auth/sign-in/email', handler);
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel('Work email').fill('shape.check@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Fake!Throwaway99');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page
    .getByText(/Too many attempts/)
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  const t = await page.locator('body').innerText();
  check(re.test(t), `sign-in ${label} -> message shown`);
  await page.unroute('**/v1/auth/sign-in/email');
}
await ctx.close();
await finish();
