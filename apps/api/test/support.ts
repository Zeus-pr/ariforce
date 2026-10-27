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

/** A fresh product (in the first product's division) with the given PTR / active flag (#40). */
export async function createProduct(
  http: Http,
  bm: string,
  director: string,
  o: { ptr?: number | null; active?: boolean; admin?: string } = {},
): Promise<string> {
  const base = await ensureProduct(http, bm, director);
  const div = (await http().get(`/v1/products/${base}`).set({ authorization: director })).body
    .divisionId;
  const code = `PR${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const res = await http()
    .post('/v1/products')
    .set({ authorization: director })
    .send({
      divisionId: div,
      code,
      name: `Product ${code}`,
      brand: null,
      composition: null,
      packSize: null,
      form: null,
      mrp: null,
      ptr: null,
      pts: null,
      isSample: false,
      active: o.active ?? true,
    });
  if (res.status !== 201) throw new Error(`product create failed: ${JSON.stringify(res.body)}`);
  if (o.ptr != null) {
    // Prices are system_admin only (products:prices).
    if (!o.admin) throw new Error('createProduct: a ptr needs the system_admin token (o.admin)');
    const pr = await http()
      .patch(`/v1/admin/products/${res.body.id}/prices`)
      .set({ authorization: o.admin })
      .send({ ptr: o.ptr });
    if (pr.status !== 200) throw new Error(`price set failed: ${JSON.stringify(pr.body)}`);
  }
  return res.body.id;
}
