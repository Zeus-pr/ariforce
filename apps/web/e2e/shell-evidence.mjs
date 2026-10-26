// Screenshots + checks for the app shell (#3). Usage: BASE_URL=http://localhost:3000 node e2e/shell-evidence.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = path.resolve(import.meta.dirname, '../../../docs/evidence/shell');
fs.mkdirSync(OUT, { recursive: true });
let ok = true;
const check = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'} ${m}`);
  if (!c) ok = false;
};
const navLabels = (page) =>
  page.$$eval('[data-sidebar="menu-button"]', (els) => els.map((e) => e.textContent.trim()).filter(Boolean));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => sessionStorage.setItem('af:splash-seen', '1'));
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, 'dashboard-desktop.png'), fullPage: true });
const managerNav = await navLabels(page);
check(['Masters', 'Attendance', 'DCR', 'Tour plans', 'Reports'].every((l) => managerNav.some((n) => n.startsWith(l))), `manager nav: ${managerNav}`);
const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
check(/Google_Sans|googleSans|Google Sans/i.test(font), `body font: ${font}`);

await page.keyboard.press('Control+b');
await page.waitForTimeout(400);
const state = await page.$eval('[data-slot="sidebar"][data-state]', (e) => e.getAttribute('data-state'));
check(state === 'collapsed', `Ctrl+B collapses sidebar (${state})`);
await page.screenshot({ path: path.join(OUT, 'sidebar-collapsed.png') });
await page.keyboard.press('Control+b');

await page.getByRole('button', { name: 'Approve' }).first().click();
await page.waitForSelector('[data-sonner-toast]');
await page.screenshot({ path: path.join(OUT, 'toast.png') });
await page.getByRole('button', { name: 'Return', exact: true }).first().click();
await page.waitForSelector('[role="dialog"]');
await page.screenshot({ path: path.join(OUT, 'return-dialog.png') });
await page.keyboard.press('Escape');

await page.getByRole('button', { name: 'Account menu' }).click();
await page.getByRole('menuitemradio', { name: 'Medical rep' }).click();
await page.waitForTimeout(300);
const repNav = await navLabels(page);
check(!repNav.some((n) => n.startsWith('Masters') || n.startsWith('Reports')), `rep nav hides Masters/Reports: ${repNav}`);
await page.goto(BASE + '/masters', { waitUntil: 'networkidle' });
await page.screenshot({ path: path.join(OUT, 'placeholder-masters.png') });

const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await m.addInitScript(() => sessionStorage.setItem('af:splash-seen', '1'));
const mp = await m.newPage();
await mp.goto(BASE, { waitUntil: 'networkidle' });
await mp.waitForTimeout(1200);
await mp.screenshot({ path: path.join(OUT, 'dashboard-mobile.png') });
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 0, `mobile has no horizontal page overflow (${overflow}px)`);
await mp.locator('[data-sidebar="trigger"]').click();
await mp.waitForSelector('[data-mobile="true"]');
await mp.waitForTimeout(400);
await mp.screenshot({ path: path.join(OUT, 'mobile-sidebar-sheet.png') });
check(true, 'mobile sidebar opens as a sheet');
check(errors.length === 0, `no console errors (${errors.join(' | ')})`);
await browser.close();
process.exit(ok ? 0 : 1);
