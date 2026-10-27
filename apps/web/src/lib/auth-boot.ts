import { GUARDS, homeFor } from './nav';
import { ROLES } from './roles';

export const SESSION_KEY = 'af:mock-session';

const ROUTES = [...GUARDS]
  .sort((a, b) => b.href.length - a.href.length)
  .map((n) => [n.href, n.roles]);
const HOME = Object.fromEntries(ROLES.map((r) => [r, homeFor(r)]));

/**
 * Inline <head> script: runs before first paint, so signed-out visitors never see protected pages,
 * signed-in visitors skip /sign-in, and a role never sees a page outside its nav. Client-side
 * navigation is guarded by <AuthGate> with the same rules (lib/nav canSee/homeFor).
 */
export const authBootScript = `(function(){try{var R=${JSON.stringify(ROUTES)},H=${JSON.stringify(HOME)},p=location.pathname,s=null;try{s=JSON.parse(localStorage.getItem("${SESSION_KEY}")||"null")}catch(e){}var ok=!!(s&&s.userId),si=p==="/sign-in"||p.indexOf("/sign-in/")===0,pub=p==="/sign-up"||p==="/invite",to=null,role=ok&&(s.previewRole||s.role);if(pub){}else if(!ok&&!si){to="/sign-in"+(p!=="/"?"?next="+encodeURIComponent(p+location.search):"")}else if(ok&&si){to=H[role]||"/"}else if(ok&&role){for(var i=0;i<R.length;i++){var h=R[i][0];if(h==="/"?p==="/":p.indexOf(h)===0){if(R[i][1].indexOf(role)<0)to=H[role]||"/";break}}}if(to&&to!==p){document.documentElement.style.visibility="hidden";location.replace(to)}}catch(e){}})();`;
