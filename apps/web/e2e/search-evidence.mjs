// Global search palette: shortcut + click open, debounce, arrows/enter/esc, aria, role gating.
// Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3000 node e2e/search-evidence.mjs
import { setup } from './lib.mjs';

const { BROWSER, check, open, shot, noBannedWords, finish } = await setup('search');
const MOD = BROWSER === 'webkit' ? 'Meta' : 'Control';

async function groupsFor(page, q) {
  const input = page.getByTestId('palette-input');
  await input.fill(q);
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-testid=palette-loading]') &&
      document.querySelector(
        '[data-testid=palette-option],[data-testid=palette-empty],[data-testid=palette-error]',
      ),
  );
  await page.waitForTimeout(350);
  await page.waitForFunction(() => !document.querySelector('[data-testid=palette-loading]'));
  return page
    .locator('[data-testid^=palette-group-]')
    .evaluateAll((els) => els.map((e) => e.dataset.testid.replace('palette-group-', '')));
}

// --- RBM: full flow ---
{
  const { ctx, page } = await open('regional_business_manager', '/doctors');
  await page.getByTestId('search-trigger').waitFor();
  const calls = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (
      /^\/v1\/(doctors|chemists|stockists|users|products)$/.test(u.pathname) &&
      u.searchParams.get('limit') === '5'
    )
      calls.push(u.searchParams.get('q'));
  });
  await page.keyboard.press(`${MOD}+k`);
  await page.getByTestId('command-palette').waitFor();
  check(
    await page.getByTestId('palette-input').evaluate((e) => e === document.activeElement),
    `${MOD}+K opens palette with focus in the input`,
  );
  const input = page.getByTestId('palette-input');
  check(
    (await input.getAttribute('role')) === 'combobox' &&
      !!(await input.getAttribute('aria-controls')),
    'input is an ARIA combobox wired to the listbox',
  );
  check(
    (await page.locator('[role=listbox] [role=option]').count()) > 0,
    'empty query lists pages the role can go to',
  );
  await input.pressSequentially('sen', { delay: 40 });
  await page.getByTestId('palette-group-doctors').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-testid=palette-loading]'));
  check(
    calls.length > 0 && calls.every((q) => q === 'sen'),
    `debounced: only the final term hits the API (${[...new Set(calls)].join(',')})`,
  );
  const g = await page
    .locator('[data-testid^=palette-group-]')
    .evaluateAll((els) => els.map((e) => e.dataset.testid.replace('palette-group-', '')));
  check(
    g.includes('doctors') && g.includes('chemists'),
    `RBM "sen": doctors + chemists groups (${g.join(',')})`,
  );
  await shot(page, 'palette-rbm.png');
  // Arrows move aria-selected and aria-activedescendant; Enter opens.
  const opts = page.getByTestId('palette-option');
  check(
    (await opts.first().getAttribute('aria-selected')) === 'true',
    'first option active by default',
  );
  await input.press('ArrowDown');
  check(
    (await opts.nth(1).getAttribute('aria-selected')) === 'true',
    'ArrowDown moves the active option',
  );
  check(
    (await input.getAttribute('aria-activedescendant')) === (await opts.nth(1).getAttribute('id')),
    'aria-activedescendant follows',
  );
  await input.press('ArrowUp');
  const href = await opts.first().getAttribute('data-href');
  await input.press('Enter');
  await page.waitForURL((u) => `${u.pathname}${u.search}` === href);
  check(true, `Enter opens ${href}`);
  check((await page.getByTestId('command-palette').count()) === 0, 'palette closes after Enter');
  if (href.startsWith('/doctors?id=')) {
    await page.getByTestId('doctor-360').waitFor();
    check(true, 'doctor hit opens the doctor profile');
  }
  // Click opens; Esc closes and focus returns to the trigger.
  await page.getByTestId('search-trigger').click();
  await page.getByTestId('command-palette').waitFor();
  check(true, 'click on the bar opens palette');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  check(
    await page.getByTestId('command-palette').evaluate((d) => d.contains(document.activeElement)),
    'focus stays trapped in the palette',
  );
  await page.keyboard.press('Escape');
  await page.getByTestId('command-palette').waitFor({ state: 'detached' });
  const back = await page
    .waitForFunction(
      () => document.activeElement?.getAttribute('data-testid') === 'search-trigger',
      null,
      { timeout: 2000 },
    )
    .then(
      () => true,
      () => false,
    );
  check(back, 'Esc closes and returns focus to the bar');
  // Chemist hit opens the list filtered by ?q=.
  await page.keyboard.press(`${MOD}+k`);
  await groupsFor(page, 'sen medical');
  await page.getByTestId('palette-group-chemists').getByTestId('palette-option').first().click();
  await page.waitForURL(/\/chemists\?q=/);
  const filtered = await page
    .locator('table')
    .getByText('Sen Medical')
    .first()
    .waitFor({ timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
  check(
    filtered && (await page.getByLabel('Search chemists').inputValue()) !== '',
    'chemist hit opens /chemists?q= filtered',
  );
  // Team group present for RBM.
  await page.keyboard.press(`${MOD}+k`);
  const t = await groupsFor(page, 'demo');
  check(t.includes('employees'), `RBM sees Team group (${t.join(',')})`);
  await page.getByTestId('palette-group-employees').getByTestId('palette-option').first().click();
  await page.waitForURL(/\/my-team\?q=/);
  check(true, 'team hit opens /my-team?q=');
  // Empty state.
  await page.keyboard.press(`${MOD}+k`);
  await groupsFor(page, 'zzqx-nothing');
  check(await page.getByTestId('palette-empty').isVisible(), 'empty state for no matches');
  await noBannedWords(page, 'palette');
  await page.keyboard.press('Escape');
  // Error state: MSW's service worker answers before page.route can, so it is checked by code review only in mock mode.
  await ctx.close();
}

// --- BM: no Team group, no admin pages ---
{
  const { ctx, page } = await open('business_manager', '/');
  await page.getByTestId('search-trigger').waitFor();
  await page.keyboard.press(`${MOD}+k`);
  const g = await groupsFor(page, 'demo');
  check(!g.includes('employees'), `BM: no Team group (${g.join(',')})`);
  const pages = await groupsFor(page, 'team');
  const titles = await page.getByTestId('palette-option').allInnerTexts();
  check(
    !titles.some((t) => /My Team|Sign-up requests/.test(t)),
    `BM: no My Team / Sign-up pages (${pages.join(',')})`,
  );
  await ctx.close();
}

// --- System Admin: no field pages, no products/team groups it cannot open ---
{
  const { ctx, page } = await open('system_admin', '/doctors');
  await page.getByTestId('search-trigger').waitFor();
  await page.keyboard.press(`${MOD}+k`);
  const g = await groupsFor(page, 'sen');
  check(
    g.includes('doctors') && !g.includes('products'),
    `admin "sen": doctors, no products (${g.join(',')})`,
  );
  await groupsFor(page, 'dcr');
  const titles = await page.getByTestId('palette-option').allInnerTexts();
  check(!titles.some((t) => /^DCR/.test(t)), 'admin: DCR page not offered');
  await groupsFor(page, 'sign');
  check(
    (await page.getByTestId('palette-option').allInnerTexts()).some((t) =>
      /Sign-up requests/.test(t),
    ),
    'admin: Sign-up requests page offered',
  );
  await ctx.close();
}

// --- Mobile: icon opens the palette ---
{
  const { ctx, page } = await open('regional_business_manager', '/doctors', 'mobile');
  await page.getByTestId('search-trigger-mobile').click();
  await page.getByTestId('command-palette').waitFor();
  check(true, 'mobile search icon opens palette');
  await groupsFor(page, 'sen');
  await shot(page, 'palette-mobile.png');
  await ctx.close();
}
await finish();
