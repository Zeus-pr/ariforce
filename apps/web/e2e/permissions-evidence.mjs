// Masters permissions: ABM/BM read-only, RBM+ read+write. Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3100 node e2e/permissions-evidence.mjs
import { setup } from './lib.mjs';

const { check, open, shot, finish } = await setup('permissions');
const API = 'http://localhost:4000';

for (const role of ['business_manager', 'area_business_manager']) {
  for (const kind of ['doctors', 'chemists']) {
    const { ctx, page } = await open(role, `/${kind}`);
    await page.locator('tbody tr').first().waitFor();
    await page.waitForLoadState('networkidle');
    check((await page.getByTestId('master-add').count()) === 0, `${role} ${kind}: no Add`);
    check((await page.getByTestId('master-import').count()) === 0, `${role} ${kind}: no Import`);
    await page.locator('tbody tr').first().click();
    if (kind === 'doctors') {
      await page.getByTestId('doctor-360').waitFor();
      check((await page.getByTestId('doctor-edit').count()) === 0, `${role} doctors: profile has no Edit`);
    } else await page.getByTestId('master-details').waitFor();
    check(
      (await page.getByRole('button', { name: /^(Save|Remove)/ }).count()) === 0,
      `${role} ${kind}: read-only detail, no Save/Remove`,
    );
    if (kind === 'chemists' && role === 'business_manager')
      await shot(page, 'bm-chemist-readonly.png');
    if (kind === 'doctors') {
      const status = await page.evaluate(
        (u) =>
          fetch(`${u}/v1/doctors`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          }).then((r) => r.status),
        API,
      );
      check(status === 403, `${role}: mock API answers writes with 403 (${status})`);
    }
    await ctx.close();
  }
  const { ctx, page } = await open(role, '/doctors');
  await page.locator('tbody tr').first().waitFor();
  check(
    (await page.getByTestId('master-add').count()) === 0,
    `${role} /doctors: no manage entry`,
  );
  await ctx.close();
  const r = await open(role, '/doctors/import');
  await r.page
    .waitForURL((u) => !u.pathname.endsWith('/import'), { timeout: 10000 })
    .catch(() => {});
  check(
    !new URL(r.page.url()).pathname.endsWith('/import'),
    `${role}: /doctors/import blocked → ${new URL(r.page.url()).pathname}`,
  );
  await r.ctx.close();
}

{
  const { ctx, page } = await open('regional_business_manager', '/doctors');
  await page.getByTestId('master-add').waitFor();
  check((await page.getByTestId('master-import').count()) === 1, 'RBM: Import shown');
  await page.locator('tbody tr').first().click();
  await page.getByTestId('doctor-edit').click();
  await page.getByRole('button', { name: /^Save/ }).waitFor();
  check(await page.getByRole('button', { name: /^Save/ }).isVisible(), 'RBM: doctor Edit opens form with Save');
  await shot(page, 'rbm-doctor-edit.png');
  await ctx.close();
  const r = await open('regional_business_manager', '/doctors/import');
  await r.page.waitForTimeout(1500);
  check(new URL(r.page.url()).pathname === '/doctors/import', 'RBM: import page opens');
  await r.ctx.close();
  for (const k of ['chemists', 'stockists']) {
    const d = await open('regional_business_manager', `/${k}`);
    await d.page.getByTestId('master-add').waitFor();
    check((await d.page.getByRole('heading', { name: 'Masters' }).count()) === 0, `/${k}: no Masters heading`);
    check((await d.page.getByRole('navigation', { name: 'Masters' }).count()) === 0, `/${k}: no tab strip`);
    const active = await d.page.locator(`[data-sidebar="menu-button"][data-active="true"]`).innerText().catch(() => '');
    check(active.trim().toLowerCase() === k, `/${k}: sidebar highlights ${k} (${active.trim()})`);
    await d.ctx.close();
  }
  for (const [from, to] of [['/masters/chemists?q=a', '/chemists?q=a'], ['/masters/stockists/import', '/stockists/import'], ['/masters', '/doctors']]) {
    const d = await open('regional_business_manager', from);
    const u = new URL(d.page.url());
    check(u.pathname + u.search === to, `redirect ${from} -> ${u.pathname + u.search}`);
    await d.ctx.close();
  }
}
await finish();
