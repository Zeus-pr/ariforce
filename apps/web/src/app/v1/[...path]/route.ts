import { type NextRequest } from 'next/server';

const LIVE = 'https://ariforce-api.arighnapharma.com';

async function forward(req: NextRequest, path: string[]) {
  if (process.env.NODE_ENV === 'production') return new Response(null, { status: 404 });
  const target = new URL(`/v1/${path.join('/')}`, LIVE);
  target.search = req.nextUrl.search;
  const headers = new Headers();
  for (const name of ['cookie', 'content-type', 'authorization', 'accept']) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const res = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
    redirect: 'manual',
  });
  const out = new Headers(res.headers);
  out.delete('set-cookie');
  for (const cookie of res.headers.getSetCookie()) {
    out.append('set-cookie', cookie.replace(/;\s*Domain=[^;]*/i, ''));
  }
  return new Response(res.body, { status: res.status, headers: out });
}

type Ctx = { params: Promise<{ path: string[] }> };

export const GET = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.path));
export const POST = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.path));
export const PUT = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.path));
export const PATCH = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.path));
export const DELETE = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.path));
