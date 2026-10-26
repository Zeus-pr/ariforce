import type request from 'supertest';

type Http = () => ReturnType<typeof request>;

/** First visible product; imports a division + product as the director when the seed has none. */
export async function ensureProduct(http: Http, bm: string, director: string): Promise<string> {
  const first = await http().get('/v1/products?limit=1').set({ authorization: bm });
  if (first.body.items?.length) return first.body.items[0].id;
  const run = Date.now().toString(36).toUpperCase();
  await http()
    .post('/v1/divisions/import')
    .set({ authorization: director })
    .send({ dryRun: false, rows: [{ code: `DV${run}`, name: `Division ${run}`, active: 'Y' }] });
  const imp = await http()
    .post('/v1/products/import')
    .set({ authorization: director })
    .send({
      dryRun: false,
      rows: [{ code: `PX${run}`, name: 'Test product', division_code: `DV${run}` }],
    });
  if (imp.status >= 300) throw new Error(`product import failed: ${JSON.stringify(imp.body)}`);
  const again = await http().get(`/v1/products?q=PX${run}`).set({ authorization: director });
  return again.body.items[0].id;
}
