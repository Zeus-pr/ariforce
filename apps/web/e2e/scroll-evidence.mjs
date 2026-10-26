// Header never moves: only <main> scrolls; wheel overscroll does not drag the header or the page.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/scroll-evidence.mjs
import { setup } from './lib.mjs';

const { BASE, browser, check, open, finish } = await setup('scroll');
const PAGES = {
  regional_business_manager: ['/', '/attendance', '/dcr', '/tour-plans', '/doctors', '/chemists', '/stockists', '/sales', '/coverage', '/team', '/reports', '/exceptions', '/my-team', '/sign-up-requests', '/doctors/import'],
  system_admin: ['/doctors', '/sign-up-requests'],
};
const headerTop = (p) => p.locator('header').first().evaluate((h) => h.getBoundingClientRect().top);

for (const view of ['desktop', 'mobile']) {
  for (const [role, routes] of Object.entries(PAGES)) {
    const { ctx, page } = await open(role, routes[0], view);
    for (const r of routes) {
      await page.goto(`${BASE}${r}`, { waitUntil: 'load' });
      await page.getByTestId('app-main').waitFor();
      await page.waitForTimeout(400);
      const m = page.getByTestId('app-main');
      await m.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
      const box = await m.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + Math.min(200, box.height / 2));
      try {
        for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 1500);
        for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -4000); // overscroll past the top
      } catch {
        // Mobile WebKit has no wheel: emulate a hard fling past the top.
        await m.evaluate((el) => { el.scrollBy(0, 99999); el.scrollBy(0, -99999); window.scrollBy(0, -500); });
      }
      await page.waitForTimeout(150);
      const top = await headerTop(page);
      const winY = await page.evaluate(() => window.scrollY);
      check(top === 0 && winY === 0, `${view} ${role} ${r}: header top ${top}, window.scrollY ${winY}`);
    }
    // New route starts at the top of <main>.
    await page.getByTestId('app-main').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await page.evaluate(() => {
      const a = document.querySelector('a[href="/chemists"]');
      if (a) return a.click();
      // Mobile: sidebar links are in a closed sheet; do a client-side push via a temporary Next link-free anchor.
      const t = document.createElement('a'); t.href = '/chemists'; document.getElementById('af-main').appendChild(t); t.click();
    });
    await page.waitForURL(/\/chemists/);
    await page.waitForTimeout(300);
    check((await page.getByTestId('app-main').evaluate((el) => el.scrollTop)) === 0, `${view} ${role}: navigation resets <main> scroll`);
    await ctx.close();
  }
  // Public pages: page may scroll but never bounces the html/body.
  const ctx = await browser.newContext(view === 'mobile' ? { viewport: { width: 390, height: 600 }, isMobile: browser.browserType().name() !== 'webkit' ? true : undefined } : {});
  await ctx.addInitScript(() => sessionStorage.setItem('af:splash-seen', '1'));
  const p = await ctx.newPage();
  for (const r of ['/sign-in', '/sign-up']) {
    await p.goto(`${BASE}${r}`);
    const ob = await p.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY + '/' + getComputedStyle(document.body).overscrollBehaviorY);
    check(ob === 'none/none', `${view} ${r}: overscroll-behavior ${ob}`);
  }
  await ctx.close();
}
await finish();
