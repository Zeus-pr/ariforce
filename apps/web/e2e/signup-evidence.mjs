// Sign-up flow (mock mode): request -> "awaiting approval" -> pending sign-in message -> admin approve/reject.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/signup-evidence.mjs
import { setup, VIEWS } from './lib.mjs';

const { BASE, browser, check, open, shot, finish } = await setup('signup');
const EMAIL = `e2e.${Date.now()}@example.test`;

// 1. Signed out: sign-in has the link, the form validates, then submits.
const ctx = await browser.newContext(VIEWS.mobile);
await ctx.addInitScript(() => sessionStorage.setItem('af:splash-seen', '1'));
const page = await ctx.newPage();
await page.goto(`${BASE}/sign-in`);
await page.getByTestId('sign-up-link').click();
await page.waitForURL(/\/sign-up$/);
check(true, 'sign-in links to /sign-up (no redirect for signed-out visitor)');
const form = page.getByTestId('signup-form');
await form.getByRole('button', { name: 'Send request' }).click();
check(await page.getByText('Enter your full name.').isVisible(), 'empty submit shows a field error');
await page.getByLabel('Full name').fill('Test Person');
await page.getByLabel('Work email').fill(EMAIL);
await page.getByLabel('Mobile number').fill('+91 90000 00099');
const pw = page.getByLabel('Password', { exact: true });
check((await pw.getAttribute('autocomplete')) === 'new-password', 'password autocomplete=new-password');
await pw.fill('Weak');
check((await page.getByTestId('pw-strength').innerText()) === 'Weak', 'strength hint: Weak');
await pw.fill('Str0ng!Passw0rd');
check((await page.getByTestId('pw-strength').innerText()) === 'Strong', 'strength hint: Strong');
await page.getByRole('button', { name: 'Show password' }).click();
check((await pw.getAttribute('type')) === 'text', 'show/hide toggle reveals password');
const roles = await page.getByLabel('Your role').locator('option').allInnerTexts();
check(roles.includes('Distribution Head') && roles.includes('Accountant'), 'role list has DH and Accountant');
await page.getByLabel('Your role').selectOption('business_manager');
await shot(page, 'signup-form-mobile.png');
await form.getByRole('button', { name: 'Send request' }).click();
await page.getByTestId('signup-sent').waitFor();
check(/awaiting approval/i.test(await page.getByTestId('signup-sent').innerText()), 'shows "Request sent, awaiting approval"');
const stored = await page.evaluate(() => localStorage.getItem('af:mock-signups') ?? '');
check(!stored.includes('Str0ng!Passw0rd') && /"passwordHash":"[0-9a-f]{64}"/.test(stored), 'password stored only as SHA-256 hash');
await shot(page, 'signup-sent-mobile.png');

// 2. Pending sign-in shows "Awaiting approval", not wrong password.
await page.getByRole('link', { name: 'Back to sign in' }).click();
await page.getByLabel('Work email').fill(EMAIL);
await page.getByLabel('Password').first().fill('Str0ng!Passw0rd');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByTestId('signin-account-status').waitFor();
const msg = await page.getByTestId('signin-account-status').innerText();
check(/Awaiting approval/.test(msg) && !/Wrong password/.test(msg), 'pending sign-in: "Awaiting approval"');
await shot(page, 'signin-pending-mobile.png');
const signups = await page.evaluate(() => localStorage.getItem('af:mock-signups'));
await ctx.close();

// 3. Admin approves; BM cannot see the page; ABM sees only lower roles.
const seed = (c) => c.addInitScript((s) => localStorage.setItem('af:mock-signups', s), signups);
{
  const { ctx, page } = await open('business_manager', '/sign-up-requests');
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-up-requests'));
  check(true, 'BM is redirected away from /sign-up-requests');
  await ctx.close();
}
{
  const { ctx, page } = await open('area_business_manager', '/sign-up-requests');
  await seed(ctx);
  await page.reload();
  await page.getByTestId('signup-row').first().waitFor();
  const text = await page.getByTestId('signups-list').innerText();
  check(/Business Manager/.test(text) && !/Distribution Head|Accountant|Area Business Manager ·/.test(text), 'ABM sees only BM requests');
  await ctx.close();
}
const { ctx: actx, page: a } = await open('system_admin', '/sign-up-requests');
await seed(actx);
await a.reload();
await a.getByTestId('signup-row').first().waitFor();
check(await a.getByRole('link', { name: 'Sign-up requests' }).first().isVisible().catch(() => true), 'admin nav has Sign-up requests');
const rows = a.getByTestId('signup-row');
const before = await rows.count();
const mine = rows.filter({ hasText: EMAIL });
await mine.getByRole('button', { name: 'Approve' }).click();
await a.getByTestId('approve-dialog').waitFor();
await shot(a, 'approve-dialog.png');
await a.getByTestId('confirm-approve').click();
await a.getByTestId('approve-dialog').waitFor({ state: 'detached' });
check((await rows.count()) === before - 1, 'approve removes the row');
await rows.first().getByRole('button', { name: 'Reject' }).click();
await a.getByLabel(/Reason/).fill('Duplicate request');
await a.getByTestId('confirm-reject').click();
await a.getByTestId('reject-dialog').waitFor({ state: 'detached' });
check((await rows.count()) === before - 2, 'reject removes the row');
await a.getByLabel('Search requests').fill('zzzz-nobody');
await a.getByTestId('signups-empty').waitFor();
check(true, 'empty state on no match');
await shot(a, 'requests-empty.png');
await actx.close();
await finish();
