// My Team: hierarchy tree, search, keyboard, add/edit/deactivate/move, Unassigned. Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3100 node e2e/my-team-evidence.mjs
import { setup } from './lib.mjs';

const { check, open, shot, noOverflow, noBannedWords, finish } = await setup('my-team');
const nodes = (page) => page.getByTestId('tree-node');
const names = async (page) =>
  (await page.getByTestId('node-name').allTextContents()).map((s) => s.trim());

// ABM sees himself and his BMs only.
{
  const { ctx, page } = await open('area_business_manager', '/my-team');
  await nodes(page).first().waitFor();
  await page.getByTestId('expand-all').click();
  const n = await names(page);
  check(n[0] === 'Rahul Chatterjee' && n.length === 3, `ABM tree: ${n.join(', ')}`);
  check(
    !/\b(PAN|CTC|salary|bank)\b/i.test(await page.locator('main').textContent()),
    'no payroll fields',
  );
  const roles = await page.getByTestId('role-select').count();
  check(roles === 0, 'form closed by default');
  await page.getByTestId('add-employee').click();
  await page.getByTestId('role-select').click();
  const opts = (await page.getByRole('option').allTextContents()).map((s) => s.trim());
  check(
    JSON.stringify(opts) === JSON.stringify(['Business Manager']),
    `ABM can create only below: ${opts}`,
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await ctx.close();
}

// RBM: ABMs and their BMs; search, keyboard, add, edit/move, deactivate, assign.
for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open('regional_business_manager', '/my-team', view);
  await nodes(page).first().waitFor();
  await page
    .waitForFunction(() => document.querySelectorAll('[data-testid=tree-node]').length >= 3, null, {
      timeout: 5000,
    })
    .catch(() => {});
  check(
    (await nodes(page).count()) === 3,
    `RBM starts with self + direct reports (${await nodes(page).count()})`,
  );
  await page.getByTestId('expand-all').click();
  check(
    (await nodes(page).count()) === 7,
    `expand all shows the downline (${await nodes(page).count()})`,
  );
  check(
    /2 direct reports/.test(await nodes(page).first().textContent()),
    'direct-report count shown',
  );
  await page.getByTestId('collapse-all').click();
  check((await nodes(page).count()) === 1, 'collapse all');

  // Keyboard: focus root, ArrowRight opens, ArrowDown moves, ArrowLeft goes to parent.
  await nodes(page).first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute('aria-level'))) === '2',
    'arrow keys move into the tree',
  );
  await page.keyboard.press('ArrowLeft');
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute('aria-level'))) === '1',
    'ArrowLeft goes to the parent',
  );

  await page.getByTestId('team-search').fill('barasat');
  await page.locator('mark').first().waitFor();
  const hits = await names(page);
  check(
    hits.includes('Riya Sarkar') && hits.length === 3,
    `search filters and auto-expands: ${hits.join(', ')}`,
  );
  await page.getByTestId('team-search').fill('');
  check((await page.getByTestId('loc-hq').count()) >= 3, 'location summary by HQ');

  if (view === 'desktop') {
    await page.getByTestId('add-employee').click();
    const sheet = page.getByTestId('employee-sheet');
    await sheet.getByLabel('Name').fill('Test Person');
    await sheet.getByLabel('Phone').fill('+91 98300 11111');
    await sheet.getByLabel('Work email').fill('rahul.chatterjee@demo.ariforce.test');
    await page.getByTestId('save-employee').click();
    await sheet.getByText('Pick an HQ.', { exact: true }).waitFor();
    check(true, 'HQ and manager are required');
    await page.getByTestId('hq-select').click();
    await page.getByRole('option', { name: /Barasat/ }).click();
    await page.getByTestId('manager-select').click();
    await page.getByRole('option', { name: /Rahul Chatterjee/ }).click();
    await page.getByTestId('save-employee').click();
    await sheet.getByText('already uses this email').waitFor();
    check(true, 'duplicate email rejected');
    await sheet.getByLabel('Work email').fill('test.person@demo.ariforce.test');
    await page.getByTestId('save-employee').click();
    await page.getByText('Test Person added').waitFor();
    await page.getByTestId('team-count').getByText('7 people').waitFor();
    await page.getByTestId('expand-all').click();
    check(
      (await names(page)).includes('Test Person'),
      'new employee appears under the chosen manager',
    );

    // Move: Test Person to Sourav Mondal.
    await nodes(page).filter({ hasText: 'Test Person' }).getByTestId('node-name').click();
    await page.getByTestId('manager-select').click();
    await page.getByRole('option', { name: /Sourav Mondal/ }).click();
    await page.getByTestId('save-employee').click();
    await page.getByText('Test Person updated').waitFor();
    await page.waitForTimeout(400);
    const order = await names(page);
    check(
      order.indexOf('Test Person') > order.indexOf('Sourav Mondal'),
      'moved to a new reporting manager',
    );

    await nodes(page).filter({ hasText: 'Test Person' }).getByTestId('node-name').click();
    await page.getByTestId('deactivate').click();
    await page.getByText('Test Person deactivated').waitFor();
    await page.getByTestId('team-count').getByText('6 active').waitFor();
    check(
      /Inactive/.test(await nodes(page).filter({ hasText: 'Test Person' }).textContent()),
      'deactivated shows Inactive',
    );

    const before = await page.getByTestId('unassigned-row').count();
    await page.getByTestId('unassigned-row').first().getByTestId('assign').click();
    await page.getByRole('option', { name: /Rahul Chatterjee/ }).click();
    await page.getByText('now reports to Rahul Chatterjee').waitFor();
    await page
      .getByTestId('unassigned')
      .getByText(`Unassigned ${before - 1}`)
      .waitFor({ timeout: 3000 })
      .catch(() => {});
    check(
      (await page.getByTestId('unassigned-row').count()) === before - 1,
      'Unassigned person assigned to a manager',
    );
  }
  await noBannedWords(page, `my team ${view}`);
  if (view === 'mobile') await noOverflow(page, 'my team mobile');
  await shot(page, `rbm-${view}.png`);
  await ctx.close();
}

// Director sees the full downline.
{
  const { ctx, page } = await open('director', '/my-team');
  await nodes(page).first().waitFor();
  await page.getByTestId('expand-all').click();
  check(
    (await nodes(page).count()) === 20,
    `Director sees everyone assigned (${await nodes(page).count()})`,
  );
  await shot(page, 'director-desktop.png');
  await ctx.close();
}

await finish();
