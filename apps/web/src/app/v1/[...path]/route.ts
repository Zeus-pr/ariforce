import { NextResponse, type NextRequest } from 'next/server';

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
  // The browser calls this local route. The live API must see the live site as the origin,
  // or sign-in is rejected before the password is checked and the page says the password is wrong.
  headers.set('origin', 'https://ariforce.arighnapharma.com');
  const res = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
    redirect: 'manual',
  });
  const out = new Headers();
  res.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    // fetch already decoded the body. Leaving these on makes the browser fail to read it.
    if (name === 'set-cookie' || name === 'content-encoding' || name === 'content-length') return;
    out.append(key, value);
  });
  const response = new NextResponse(res.body, { status: res.status, headers: out });
  for (const cookie of res.headers.getSetCookie())
    response.headers.append('set-cookie', localCookie(cookie));
  return response;
}

/**
 * The live cookie is named `__Secure-better-auth.session_token` and is scoped to the live site.
 * Drop Domain so localhost can store it. Keep Secure: a `__Secure-` cookie without it is discarded,
 * sign-in still returns success, and /v1/me then has no session.
 */
function localCookie(cookie: string) {
  return cookie.replace(/;\s*Domain=[^;]*/i, '');
}

type Ctx = { params: Promise<{ path: string[] }> };

export const GET = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.path));
export const POST = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.path));
export const PUT = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.path));
export const PATCH = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.path));
export const DELETE = (req: NextRequest, ctx: Ctx) => ctx.params.then((p) => forward(req, p.path));
