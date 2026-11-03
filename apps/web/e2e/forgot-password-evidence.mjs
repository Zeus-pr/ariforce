// Forgot password by email code (/forgot-password), mock mode. Every reset call is answered by the
// in-page MSW mock; a context route catches anything that would reach the network and the run fails if one does.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/forgot-password-evidence.mjs
import { setup, VIEWS } from './lib.mjs';

const { BASE, BROWSER, browser, check, shot, noOverflow, noBannedWords, finish } =
  await setup('forgot-password');
const CODE = '123456';
const GOOD = 'Correct-Horse-42!';
let leaked = 0;
const errors = [];

async function fresh(view = 'desktop', route = '/sign-in', clock = false) {
  const ctx = await browser.newContext(VIEWS[view]);
  await ctx.addInitScript(() => sessionStorage.setItem('af:splash-seen', '1'));
  await ctx.route(/\/v1\/auth\/password\/(forgot|reset)/, (r) => {
    leaked++;
    return r.fulfill({ status: 500, body: '{}' });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${view}: ${e.message}`));
  if (clock) await page.clock.install();
  await page.goto(BASE + route, { waitUntil: 'load' });
  return { ctx, page };
}
const toCode = async (page, email) => {
  await page.getByTestId('fp-email').fill(email);
  await page.getByTestId('fp-send').click();
  await page.getByTestId('fp-code-step').waitFor({ timeout: 15000 });
};
const fill = async (page, code, a = GOOD, b = a) => {
  await page.getByTestId('fp-code').fill(code);
  await page.getByTestId('fp-password').fill(a);
  await page.getByTestId('fp-password2').fill(b);
  await page.getByTestId('fp-submit').click();
};
const errText = (page, f) =>
  page
    .getByTestId(`fp-${f}-error`)
    .waitFor({ timeout: 8000 })
    .then(
      () => page.getByTestId(`fp-${f}-error`).textContent(),
      () => '',
    );

for (const view of ['desktop', 'mobile']) {
  // Link on sign-in, public page, happy path, toast on sign-in.
  const { ctx, page } = await fresh(view);
  const link = page.getByTestId('forgot-link');
  await link.waitFor({ timeout: 15000 });
  check(
    (await link.isVisible()) && (await link.textContent()) === 'Forgot password?',
    `${view}: "Forgot password?" visible on sign-in`,
  );
  const pwBox = await page.locator('input[name=password]').boundingBox();
  const lBox = await link.boundingBox();
  check(lBox.y > pwBox.y, `${view}: link sits under the password field`);
  await link.click();
  await page.getByTestId('fp-email-step').waitFor({ timeout: 15000 });
  check(
    new URL(page.url()).pathname === '/forgot-password',
    `${view}: /forgot-password opens signed out`,
  );
  await noOverflow(page, `${view} email step`);
  await noBannedWords(page, `${view} email step`);
  await shot(page, `email-${view}.png`);
  await page.getByTestId('fp-send').click();
  check(/work email/.test(await errText(page, 'email')), `${view}: empty email is caught`);
  await toCode(page, `Nisha.${view}@demo.ariforce.test`);
  check(
    (await page.getByTestId('fp-sent').textContent()).includes(
      'If the account exists, we sent a code',
    ),
    `${view}: generic sent message`,
  );
  check(
    (await page.getByTestId('fp-code').getAttribute('inputmode')) === 'numeric' &&
      (await page.getByTestId('fp-code').getAttribute('autocomplete')) === 'one-time-code',
    `${view}: numeric one-time-code input`,
  );
  check(
    /At least 12 characters/.test(await page.getByTestId('fp-strength').textContent()),
    `${view}: requirement hint shown`,
  );
  // Paste-friendly: spaces/dashes stripped, capped at 6.
  await page.getByTestId('fp-code').fill('24 68-10 99');
  check(
    (await page.getByTestId('fp-code').inputValue()) === CODE,
    `${view}: pasted code cleaned to 6 digits`,
  );
  // Too short, mismatch.
  await fill(page, CODE, 'short1');
  check(/at least 12/.test(await errText(page, 'pw')), `${view}: too-short password`);
  await fill(page, CODE, GOOD, GOOD + 'x');
  check(/do not match/.test(await errText(page, 'pw2')), `${view}: mismatched passwords`);
  await page.getByTestId('fp-password').fill(GOOD);
  check(
    /Good|Strong|Very strong/.test(await page.getByTestId('fp-strength').textContent()),
    `${view}: strength hint updates`,
  );
  await noOverflow(page, `${view} code step`);
  await noBannedWords(page, `${view} code step`);
  await shot(page, `code-${view}.png`);
  // Wrong code once, then right.
  await fill(page, '111111');
  check(/not right/.test(await errText(page, 'code')), `${view}: wrong code message`);
  await fill(page, CODE);
  await page.waitForURL(/\/sign-in/, { timeout: 15000 });
  check(true, `${view}: success goes to sign-in`);
  check(
    await page
      .getByText('Password changed. Sign in with your new password.')
      .first()
      .waitFor({ timeout: 8000 })
      .then(
        () => true,
        () => false,
      ),
    `${view}: success toast`,
  );
  check(
    await page.getByText('You were signed out on every other device.').first().isVisible(),
    `${view}: toast says other sessions were signed out`,
  );
  await shot(page, `done-${view}.png`);
  await ctx.close();
}

// Unknown email gets the same generic answer.
{
  const { ctx, page } = await fresh('desktop', '/forgot-password');
  await toCode(page, 'nobody.here@example.test');
  check(
    (await page.getByTestId('fp-sent').textContent()).includes(
      'If the account exists, we sent a code',
    ),
    'unknown email: same generic message',
  );
  await ctx.close();
}
// Expired code.
{
  const { ctx, page } = await fresh('desktop', '/forgot-password');
  await toCode(page, 'expired.user@example.test');
  await fill(page, CODE);
  check(/expired/.test(await errText(page, 'code')), 'expired code message');
  await ctx.close();
}
// Too many attempts.
{
  const { ctx, page } = await fresh('mobile', '/forgot-password');
  await toCode(page, 'many.tries@example.test');
  for (let i = 0; i < 2; i++) {
    await fill(page, '999999');
    await errText(page, 'code');
  }
  await fill(page, '999999');
  await page.waitForFunction(
    () =>
      /Too many wrong codes/.test(
        document.querySelector('[data-testid=fp-code-error]')?.textContent ?? '',
      ),
    null,
    { timeout: 8000 },
  );
  check(true, 'third wrong code: too many attempts');
  await fill(page, CODE);
  check(
    /Too many wrong codes/.test(await errText(page, 'code')),
    'right code still blocked until a new code is sent',
  );
  await ctx.close();
}
// 429 on send and on reset.
{
  const { ctx, page } = await fresh('desktop', '/forgot-password');
  await page.getByTestId('fp-email').fill('slow.sender@example.test');
  await page.getByTestId('fp-send').click();
  check(
    /try again in 30 seconds/.test(await errText(page, 'email')),
    '429 on send: wait time shown',
  );
  check(await page.getByTestId('fp-send').isDisabled(), '429 on send: button waits');
  await ctx.close();
  const b = await fresh('desktop', '/forgot-password');
  await toCode(b.page, 'busy.reset@example.test');
  await fill(b.page, CODE);
  check(
    /try again in 45 seconds/.test(await errText(b.page, 'form')),
    '429 on reset: wait time shown',
  );
  await b.ctx.close();
}
// Resend cooldown (fake clock).
{
  const { ctx, page } = await fresh('desktop', '/forgot-password', true);
  await toCode(page, 'resend.me@example.test');
  const rs = page.getByTestId('fp-resend');
  check(
    (await rs.isDisabled()) && /Resend code in 30s/.test(await rs.textContent()),
    `resend disabled with countdown (${await rs.textContent()})`,
  );
  const tick = async (n) => {
    for (let i = 0; i < n; i++) {
      await page.clock.runFor(1000);
      await page.waitForTimeout(20);
    }
  };
  await tick(10);
  check(/in 2\ds/.test(await rs.textContent()), `countdown ticks (${await rs.textContent()})`);
  await tick(21);
  await page
    .waitForFunction(() => !document.querySelector('[data-testid=fp-resend]')?.disabled, null, {
      timeout: 5000,
    })
    .catch(() => {});
  check(
    !(await rs.isDisabled()) && (await rs.textContent()) === 'Resend code',
    'resend enabled after 30 seconds',
  );
  await rs.click();
  check(
    await page
      .getByText('If the account exists, we sent a code')
      .first()
      .waitFor({ timeout: 5000 })
      .then(
        () => true,
        () => false,
      ),
    'resend shows the generic message',
  );
  check(await rs.isDisabled(), 'cooldown restarts after resend');
  await ctx.close();
}

check(leaked === 0, `no reset request reached the network (${leaked})`);
check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
console.log(`engine ${BROWSER}`);
await finish();
