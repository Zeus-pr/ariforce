/**
 * Global search: one adapter behind the command palette.
 *
 * Today it fans out to the existing list endpoints (GET /v1/{doctors|chemists|stockists|users|products}
 * ?q=&limit=5), all server-side and scoped by the API to what the caller may see. Groups the role
 * cannot read (DEFAULT_ROLE_PERMISSIONS) or cannot open in the web (no visible page) are skipped
 * before any request; a 403 also just drops the group. Pages come from the role's nav.
 * When GET /v1/search?q= lands (CONTRACT-GAPS #24) only `fetchGroups` changes.
 */
import { DEFAULT_ROLE_PERMISSIONS, type Permission } from '@ariforce/contracts';
import { api, apiReady } from '@/lib/api';
import { NAV, canSee } from '@/lib/nav';
import { ROLE_LABEL, type Role } from '@/lib/roles';

export type GroupId = 'pages' | 'doctors' | 'chemists' | 'stockists' | 'employees' | 'products';
export type SearchHit = { id: string; title: string; subtitle?: string; href: string };
export type SearchGroup = { id: GroupId; label: string; hits: SearchHit[]; more?: string };
export type SearchResult = { groups: SearchGroup[]; failed: GroupId[] };

export const PER_GROUP = 5;

type Row = {
  id: string;
  name: string;
  code?: string | null;
  city?: string | null;
  employeeCode?: string | null;
  roles?: Role[];
  deletedAt?: string | null;
};
type Def = {
  id: Exclude<GroupId, 'pages'>;
  label: string;
  path: '/v1/doctors' | '/v1/chemists' | '/v1/stockists' | '/v1/users' | '/v1/products';
  perm: Permission;
  /** Page the hit opens on; the group is skipped when the role cannot see it. */
  page: string;
  href: (r: Row, q: string) => string;
  subtitle: (r: Row) => string | undefined;
};
const join = (...p: (string | null | undefined)[]) => p.filter(Boolean).join(' · ') || undefined;
const qs = (q: string) => encodeURIComponent(q);

const DEFS: Def[] = [
  {
    id: 'doctors',
    label: 'Doctors',
    path: '/v1/doctors',
    perm: 'masters:read',
    page: '/doctors',
    href: (r) => `/doctors?id=${encodeURIComponent(r.id)}`,
    subtitle: (r) => join(r.code, r.city),
  },
  {
    id: 'chemists',
    label: 'Chemists',
    path: '/v1/chemists',
    perm: 'masters:read',
    page: '/chemists',
    href: (r) => `/chemists?q=${qs(r.name)}`,
    subtitle: (r) => join(r.code, r.city),
  },
  {
    id: 'stockists',
    label: 'Stockists',
    path: '/v1/stockists',
    perm: 'stockists:read',
    page: '/stockists',
    href: (r) => `/stockists?q=${qs(r.name)}`,
    subtitle: (r) => join(r.code, r.city),
  },
  {
    id: 'employees',
    label: 'Team',
    path: '/v1/users',
    perm: 'users:read',
    page: '/my-team',
    href: (r) => `/my-team?q=${qs(r.employeeCode || r.name)}`,
    subtitle: (r) => join(r.roles?.[0] ? ROLE_LABEL[r.roles[0]] : null, r.employeeCode),
  },
  {
    // No product page yet (CONTRACT-GAPS #24): products open Sales by brand.
    id: 'products',
    label: 'Products',
    path: '/v1/products',
    perm: 'products:read',
    page: '/sales',
    href: () => `/sales`,
    subtitle: (r) => join(r.code),
  },
];

/** Groups this role can search (used for gating and by tests). */
export function searchableGroups(role: Role): GroupId[] {
  const perms = DEFAULT_ROLE_PERMISSIONS[role] ?? [];
  return [
    'pages',
    ...DEFS.filter((d) => perms.includes(d.perm) && canSee(role, d.page)).map((d) => d.id),
  ];
}

export function searchPages(role: Role, q: string): SearchHit[] {
  const t = q.trim().toLowerCase();
  return NAV.filter((n) => n.roles.includes(role))
    .filter((n) => !t || n.title.toLowerCase().includes(t))
    .slice(0, t ? PER_GROUP : 8)
    .map((n) => ({ id: `page:${n.href}`, title: n.title, href: n.href, subtitle: 'Page' }));
}

async function fetchGroups(role: Role, q: string, signal: AbortSignal): Promise<SearchResult> {
  await apiReady();
  const allowed = new Set(searchableGroups(role));
  const defs = DEFS.filter((d) => allowed.has(d.id));
  const settled = await Promise.allSettled(
    defs.map(async (d) => {
      const r = await api.GET(d.path, {
        params: { query: { q, limit: PER_GROUP } } as never,
        signal,
      });
      if (r.response.status === 403) return null; // not readable after all: drop the group quietly
      if (!r.data) throw new Error(String(r.response.status));
      const items = (r.data as { items: Row[]; nextCursor: string | null }).items.filter(
        (x) => !x.deletedAt,
      );
      const more = (r.data as { nextCursor: string | null }).nextCursor;
      return {
        id: d.id,
        label: d.label,
        hits: items.slice(0, PER_GROUP).map((x) => ({
          id: `${d.id}:${x.id}`,
          title: x.name,
          subtitle: d.subtitle(x),
          href: d.href(x, q),
        })),
        more: more && d.id !== 'products' ? `${d.page}?q=${qs(q)}` : undefined,
      } satisfies SearchGroup;
    }),
  );
  const groups: SearchGroup[] = [];
  const failed: GroupId[] = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') {
      if (s.value && s.value.hits.length) groups.push(s.value);
    } else failed.push(defs[i]!.id);
  });
  return { groups, failed };
}

export const searchAdapter = {
  /** Data groups for `q` (server-side). Pages are matched locally from the role's nav. */
  async search(role: Role, q: string, signal: AbortSignal): Promise<SearchResult> {
    const pages = searchPages(role, q);
    const data = await fetchGroups(role, q, signal);
    return {
      groups: [
        ...data.groups,
        ...(pages.length ? [{ id: 'pages' as const, label: 'Pages', hits: pages }] : []),
      ],
      failed: data.failed,
    };
  },
};
