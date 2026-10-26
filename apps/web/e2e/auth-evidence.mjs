// Mock sign-in, route guard, role landing and splash handoff. Usage: BROWSER=chromium BASE_URL=http://localhost:3100 node e2e/auth-evidence.mjs
import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const BROWSER = process.env.BROWSER ?? 'chromium';
const engine = { chromium, webkit }[BROWSER];
const OUT = path.resolve(import.meta.dirname, `../../../docs/evidence/auth${BROWSER === 'chromium' ? '' : '-' + BROWSER}`);
fs.mkdirSync(OUT, { recursive: true });
let ok = true;
const check = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'} ${m}`);
  if (!c) ok = false;
};
const browser = await engine.launch();
const errors = [];
const pathOf = (p) => new URL(p.url()).pathname;

// 1. Signed-out visit to a protected page: never paints protected content, lands on /sign-in?next=.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    sessionStorage.setItem('af:splash-seen', '1');
    window.__sawProtected = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-af-header-logo]') && !location.pathname.startsWith('/sign-in') && document.documentElement.style.visibility !== 'hidden')
        window.__sawProtected = true;
    }).observe(document, { childList: true, subtree: true });
  });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE + '/masters/doctors', { waitUntil: 'networkidle' });
  check(pathOf(page) === '/sign-in' && page.url().includes('next=%2Fmasters%2Fdoctors'), `signed-out /masters/doctors -> ${page.url()}`);
  check(!(await page.evaluate(() => window.__sawProtected)), 'no protected content painted before redirect');
  check(await page.getByTestId('mock-note').isVisible(), 'mock sign-in note visible');
  const fs16 = await page.$$eval('input', (els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  check(fs16.every((f) => f >= 16), `inputs >= 16px (${fs16})`);
  await page.screenshot({ path: path.join(OUT, 'sign-in-desktop.png') });

  // Inline errors, no shake (no transform animation on the message).
  await page.getByLabel('Work email').fill('nobody@demo.ariforce.test');
  await page.getByLabel('Password', { exact: true }).fill('x');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  const emailErr = page.locator('[id$="-email-err"]');
  check(await emailErr.isVisible(), `unknown email shows inline error: ${await emailErr.textContent()}`);
  check((await page.getByLabel('Work email').getAttribute('aria-invalid')) === 'true', 'email marked aria-invalid');
  await page.getByLabel('Work email').fill('sm@demo.ariforce.test');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  check(await page.locator('[id$="-password-err"]').isVisible(), 'wrong password shows inline error');
  await page.screenshot({ path: path.join(OUT, 'sign-in-error.png') });

  // Show/hide password.
  await page.getByRole('button', { name: 'Show password' }).click();
  check((await page.getByLabel('Password', { exact: true }).getAttribute('type')) === 'text', 'show password reveals text');
  await page.getByRole('button', { name: 'Hide password' }).click();

  // System Admin via the demo list -> next is honoured only if allowed (masters is admin-only).
  await page.getByText('Demo accounts (one per role)').click();
  await page.getByRole('button', { name: /System Admin/ }).click();
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await page.waitForURL(/\/masters\/doctors/, { timeout: 10000 }).catch(() => {});
  check(pathOf(page) === '/masters/doctors', `System Admin honours next -> ${pathOf(page)}`);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  check(pathOf(page).startsWith('/masters'), `System Admin is kept out of the dashboard (${pathOf(page)})`);
  await page.goto(BASE + '/sign-in', { waitUntil: 'networkidle' });
  check(pathOf(page).startsWith('/masters'), `signed-in visitor skips /sign-in (${pathOf(page)})`);

  // Sign out.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByTestId('sign-out').click();
  await page.waitForURL(/\/sign-in/, { timeout: 5000 }).catch(() => {});
  check(pathOf(page) === '/sign-in', 'sign out returns to /sign-in');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  check(pathOf(page) === '/sign-in', 'after sign out the dashboard is guarded');
  await ctx.close();
}

// 2. Business Manager lands on the dashboard; field nav only.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => sessionStorage.setItem('af:splash-seen', '1'));
  const page = await ctx.newPage();
  await page.goto(BASE + '/sign-in', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(OUT, 'sign-in-mobile.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `sign-in mobile has no horizontal overflow (${overflow}px)`);
  await page.getByLabel('Work email').fill('bm@demo.ariforce.test');
  await page.getByLabel('Password', { exact: true }).fill('ariforce-demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(BASE + '/', { timeout: 10000 }).catch(() => {});
  check(pathOf(page) === '/', `Business Manager lands on dashboard (${pathOf(page)})`);
  await page.goto(BASE + '/masters/doctors', { waitUntil: 'networkidle' });
  check(pathOf(page) === '/masters/doctors' && (await page.getByTestId('master-add').count()) === 0, `Business Manager opens masters read-only (${pathOf(page)})`);
  await page.goto(BASE + '/masters/doctors/import', { waitUntil: 'networkidle' });
  check(pathOf(page) === '/', `Business Manager cannot open masters import (${pathOf(page)})`);
  await ctx.close();
}

// 3. Splash on /sign-in (first visit this session) lands on the card logo with no layout shift.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/sign-in', { waitUntil: 'commit' });
  await page.waitForSelector('[data-af-header-logo]');
  const before = await page.$eval('[data-af-header-logo]', (e) => e.getBoundingClientRect().toJSON());
  await page.waitForFunction(() => !document.documentElement.classList.contains('af-splash'), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const after = await page.$eval('[data-af-header-logo]', (e) => e.getBoundingClientRect().toJSON());
  const done = await page.evaluate(() => sessionStorage.getItem('af:splash-seen'));
  check(done === '1', 'splash plays once on /sign-in and is marked seen');
  check(Math.abs(before.x - after.x) < 1 && Math.abs(before.y - after.y) < 1, `card logo did not move during splash (${before.x},${before.y} -> ${after.x},${after.y})`);
  await page.screenshot({ path: path.join(OUT, 'sign-in-after-splash.png') });
  await ctx.close();
}

check(errors.length === 0, `no console errors (${errors.join(' | ')})`);
await browser.close();
process.exit(ok ? 0 : 1);
