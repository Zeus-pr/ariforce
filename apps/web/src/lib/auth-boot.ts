export const SESSION_KEY = 'af:session';
/** Pre-rename key; read once and moved to SESSION_KEY so existing sign-ins survive. */
export const LEGACY_SESSION_KEY = 'af:mock-session';

/** One-time move of the old session key (also done inline by authBootScript before paint). */
export function migrateLegacySession() {
  try {
    const old = localStorage.getItem(LEGACY_SESSION_KEY);
    if (old === null) return;
    if (localStorage.getItem(SESSION_KEY) === null) localStorage.setItem(SESSION_KEY, old);
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // storage blocked
  }
}

const PUBLIC_PATHS = ['/sign-up', '/invite', '/forgot-password'];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isSignIn(pathname: string) {
  return pathname === '/sign-in' || pathname.startsWith('/sign-in/');
}

/**
 * Where the pre-paint script may send the browser. It only knows whether a profile id is stored.
 * It does not read a role: page access waits for GET /v1/me.
 * Returns null when the current page should stay.
 */
export function bootTarget(pathname: string, search: string, hasUserId: boolean): string | null {
  if (isPublic(pathname)) return null;
  if (!hasUserId && !isSignIn(pathname)) {
    const next = pathname !== '/' ? `?next=${encodeURIComponent(pathname + search)}` : '';
    return `/sign-in${next}`;
  }
  return null;
}

/**
 * Runs before first paint. Signed-out visitors go to /sign-in. A stored role is ignored, including
 * previewRole, so editing localStorage cannot open another role's pages.
 */
export const authBootScript = `(function(){try{var p=location.pathname,s=null;try{var o=localStorage.getItem("${LEGACY_SESSION_KEY}");if(o!==null){if(localStorage.getItem("${SESSION_KEY}")===null)localStorage.setItem("${SESSION_KEY}",o);localStorage.removeItem("${LEGACY_SESSION_KEY}")}s=JSON.parse(localStorage.getItem("${SESSION_KEY}")||"null")}catch(e){}var ok=!!(s&&s.userId),pub=p==="/sign-up"||p.indexOf("/sign-up/")===0||p==="/invite"||p.indexOf("/invite/")===0||p==="/forgot-password"||p.indexOf("/forgot-password/")===0,si=p==="/sign-in"||p.indexOf("/sign-in/")===0,to=null;if(!pub&&!ok&&!si){to="/sign-in"+(p!=="/"?"?next="+encodeURIComponent(p+location.search):"")}if(to&&to!==p){document.documentElement.style.visibility="hidden";location.replace(to)}}catch(e){}})();`;
