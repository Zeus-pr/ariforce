// Shared harness for page evidence scripts. Not a suite itself (no -evidence suffix).
import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ID = {
  business_manager: 'bm',
  area_business_manager: 'abm',
  regional_business_manager: 'rbm',
  zonal_business_manager: 'zbm',
  sales_manager: 'sm',
  general_manager: 'gm',
  vice_president: 'vp',
  director: 'director',
  system_admin: 'admin',
};
export const VIEWS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
/** Wording the owner ruled out (AI features are parked). */
export const BANNED = /\b(AI|A\.I\.|smart|insights?|copilot|magic|predict(ed|ive)?)\b|✨/i;

export async function setup(name) {
  const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
  const BROWSER = process.env.BROWSER ?? 'chromium';
  const OUT = path.resolve(import.meta.dirname, `../../../docs/evidence/${name}${BROWSER === 'chromium' ? '' : '-' + BROWSER}`);
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await { chromium, webkit }[BROWSER].launch();
  const errors = [];
  let ok = true;
  const check = (c, m) => {
    console.log(`${c ? 'PASS' : 'FAIL'} [${BROWSER}] ${m}`);
    if (!c) ok = false;
  };
  async function open(role, route, view = 'desktop', extra = {}) {
    const ctx = await browser.newContext({ ...VIEWS[view], ...extra });
    await ctx.addInitScript((s) => {
      sessionStorage.setItem('af:splash-seen', '1');
      localStorage.setItem('af:mock-session', s);
    }, JSON.stringify({ userId: `mock-${ID[role]}`, role }));
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${role}/${view}: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`${role}/${view}: ${e.message}`));
    await page.goto(`${BASE}${route}`, { waitUntil: 'load' });
    return { ctx, page };
  }
  const shot = (page, file) => page.screenshot({ path: path.join(OUT, file), fullPage: true });
  const noOverflow = async (page, label) => {
    const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(o <= 0, `${label}: no horizontal page overflow (${o}px)`);
  };
  const noBannedWords = async (page, label) => {
    const t = await page.locator('body').innerText();
    const m = t.match(BANNED);
    check(!m, `${label}: no AI/smart wording${m ? ` (found "${m[0]}")` : ''}`);
  };
  async function finish() {
    check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    await browser.close();
    process.exit(ok ? 0 : 1);
  }
  return { BASE, BROWSER, OUT, browser, check, open, shot, noOverflow, noBannedWords, finish };
}
