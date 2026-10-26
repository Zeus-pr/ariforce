// Doctor 360 (#34): list, profile, visits, samples vs cap, products detailed. Usage: BROWSER=chromium|webkit BASE_URL=http://localhost:3100 node e2e/doctors-evidence.mjs
import { setup } from './lib.mjs';

const { check, open, shot, noOverflow, noBannedWords, finish } = await setup('doctors');

for (const view of ['desktop', 'mobile']) {
  const { ctx, page } = await open('business_manager', '/doctors', view);
  const rows = page.locator(
    view === 'mobile' ? '[data-testid=card-row]' : '[data-testid=table-row]',
  );
  await rows.first().waitFor();
  check((await rows.count()) > 0, `doctor list renders (${view}, ${await rows.count()} rows)`);
  await page.getByPlaceholder('Search doctors').fill('zzzz-no-such');
  await page.waitForFunction(() => /zzzz/.test(location.search));
  await page.getByText('No doctors match these filters.').waitFor();
  check(true, `search goes to the URL and server (${view})`);
  await page.goto(page.url().split('?')[0], { waitUntil: 'load' });
  await rows.first().waitFor();
  const name = (await rows.first().getByTestId('doctor-link').textContent()).trim();
  await rows.first().getByTestId('doctor-link').click();
  await page.getByTestId('doctor-360').waitFor();
  check(
    (await page.getByTestId('doctor-name').textContent()).trim() === name,
    `opens 360 for ${name} (${view})`,
  );
  check(new URL(page.url()).searchParams.has('id'), 'doctor id is in the URL');
  await page.getByTestId('d360-visit').first().waitFor();
  check(
    (await page.getByTestId('d360-visit').count()) > 0,
    `visit history (${await page.getByTestId('d360-visit').count()})`,
  );
  check(
    (await page.getByTestId('sample-badge').count()) === 1,
    'no recorded calls: history labelled sample',
  );
  check(
    /of \d+/.test(await page.getByTestId('d360-samples').textContent()),
    'samples vs cap shown',
  );
  check(
    /Visits in/.test(await page.getByTestId('d360-frequency').textContent()),
    'visit frequency vs category norm',
  );
  check(
    (await page.locator('[data-testid=d360-products] li').count()) > 0,
    'products detailed listed',
  );
  await page
    .locator('[role=img][aria-label="Visits per month"] .recharts-bar-rectangle')
    .first()
    .waitFor();
  check(true, 'visits chart renders');
  await noBannedWords(page, `doctor 360 ${view}`);
  if (view === 'mobile') await noOverflow(page, 'doctor 360 mobile');
  await shot(page, `360-${view}.png`);
  await page.getByTestId('doctor-back').click();
  await rows.first().waitFor();
  check(!new URL(page.url()).searchParams.has('id'), 'back returns to the list');
  await ctx.close();
}

{
  const { ctx, page } = await open('director', '/doctors?id=00000000-0000-7000-8000-000000000000');
  await page.getByText('isn’t in your list').waitFor();
  check(true, 'unknown doctor id shows a clear message');
  await ctx.close();
}

await finish();
