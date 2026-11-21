'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TERRITORY_LEVELS,
  type RoleKey,
  type Territory,
  type TerritoryLevel,
} from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { api, apiReady, toApiError } from '@/lib/api';
import { adminMessage } from '@/lib/admin/messages';
import { invalidateTerritories, useTerritories } from '@/lib/query';
import { TreeFlow } from '@/components/flow/tree-flow';

const NEXT: Partial<Record<TerritoryLevel, TerritoryLevel>> = {
  national: 'zone',
  zone: 'region',
  region: 'area',
  area: 'headquarter',
  headquarter: 'territory',
};
const LABEL: Record<TerritoryLevel, string> = {
  national: 'Country',
  zone: 'State',
  region: 'RBM HQ',
  area: 'ABM HQ',
  headquarter: 'BM HQ',
  territory: 'Territory',
};
const PLACE_COLOR: Record<TerritoryLevel, string> = {
  national: '#1e3a5f',
  zone: '#1d4ed8',
  region: '#0369a1',
  area: '#0f766e',
  headquarter: '#b45309',
  territory: '#7c3aed',
};

type Person = {
  id: string;
  name: string;
  version: number;
  primaryRole: string | null;
  territoryIds: string[];
  territories: { id: string; name: string; level: string }[];
};
type FormKind = 'rename' | 'add' | 'move' | 'people' | 'retire' | 'role';

const STATE_ROLES: { role: RoleKey; label: string }[] = [
  { role: 'zonal_business_manager', label: 'Add ZBM' },
  { role: 'sales_manager', label: 'Add Sales Manager' },
  { role: 'general_manager', label: 'Add General Manager' },
  { role: 'vice_president', label: 'Add Vice President' },
  { role: 'director', label: 'Add Director' },
];

function parentLevel(level: TerritoryLevel): TerritoryLevel | null {
  const index = TERRITORY_LEVELS.indexOf(level);
  return index <= 0 ? null : TERRITORY_LEVELS[index - 1]!;
}

function inside(rootId: string, place: Territory, byId: Map<string, Territory>) {
  let current: string | null = place.id;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    if (current === rootId) return true;
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

export function OrganizationScreen() {
  const terrs = useTerritories();
  const live = useMemo(() => (terrs.data ?? []).filter((t) => !t.deletedAt), [terrs.data]);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [form, setForm] = useState<{
    id: string;
    kind: FormKind;
    level: TerritoryLevel | null;
    role: RoleKey | null;
  } | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Set<string> | null>(null);
  const node = live.find((t) => t.id === (form?.id ?? menu?.id)) ?? null;

  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const byId = new Map(live.map((t) => [t.id, t]));
    const kids = new Map<string, Territory[]>();
    for (const t of live) {
      if (!t.parentId) continue;
      kids.set(t.parentId, [...(kids.get(t.parentId) ?? []), t]);
    }
    const keep = new Set<string>();
    if (!needle) {
      for (const t of live) keep.add(t.id);
      return keep;
    }
    const hit = (id: string): boolean => {
      const place = byId.get(id);
      if (!place) return false;
      if (place.name.toLowerCase().includes(needle)) return true;
      return (kids.get(id) ?? []).some((k) => hit(k.id));
    };
    for (const t of live) if (hit(t.id)) keep.add(t.id);
    return keep;
  }, [live, needle]);
  const kidsOf = useMemo(() => {
    const map = new Map<string, Territory[]>();
    for (const t of live) {
      if (!t.parentId) continue;
      map.set(t.parentId, [...(map.get(t.parentId) ?? []), t]);
    }
    return map;
  }, [live]);
  useEffect(() => {
    if (openIds || !live.length) return;
    setOpenIds(new Set(live.filter((t) => t.level === 'national').map((t) => t.id)));
  }, [live, openIds]);
  const folded = useMemo(() => {
    if (needle || !openIds) return visible;
    const byId = new Map(live.map((t) => [t.id, t]));
    const show = (id: string, seen: Set<string>): boolean => {
      if (seen.has(id)) return false;
      const place = byId.get(id);
      if (!place?.parentId) return true;
      const next = new Set(seen);
      next.add(id);
      return openIds.has(place.parentId) && show(place.parentId, next);
    };
    return new Set(live.filter((t) => show(t.id, new Set())).map((t) => t.id));
  }, [live, needle, openIds, visible]);
  const items = live
    .filter((t) => folded.has(t.id))
    .map((t) => ({
      id: t.id,
      parentId: t.parentId && folded.has(t.parentId) ? t.parentId : null,
      title: t.name,
      subtitle: LABEL[t.level],
      color: PLACE_COLOR[t.level],
      hasChildren: (kidsOf.get(t.id) ?? []).some((child) => !needle || visible.has(child.id)),
      open: openIds?.has(t.id) ?? false,
      onToggle: () =>
        setOpenIds((cur) => {
          const next = new Set(cur ?? []);
          if (next.has(t.id)) next.delete(t.id);
          else next.add(t.id);
          return next;
        }),
    }));

  function fail(e: unknown) {
    const a = toApiError(e);
    setError(adminMessage(a.code, a.message));
  }
  async function saved() {
    setError(null);
    setForm(null);
    await invalidateTerritories();
  }

  return (
    <div className="relative h-[calc(100dvh-var(--header-height))] min-h-0">
      <TreeFlow
        nodes={items}
        label="Company map"
        onMenu={(id, x, y) => {
          if (!id || x < 0) setMenu(null);
          else setMenu({ id, x, y });
        }}
      />
      <Input
        aria-label="Find a place"
        placeholder="Find a place"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="absolute top-3 right-3 z-10 w-56 bg-white"
      />
      {error && (
        <p
          role="alert"
          className="absolute bottom-3 left-14 z-10 max-w-md rounded-md border border-destructive/30 bg-white px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {menu && node && (
        <PlaceMenu
          node={node}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onPick={(kind, level, role) => {
            setMenu(null);
            setForm({ id: node.id, kind, level: level ?? null, role: role ?? null });
          }}
        />
      )}
      {form && node && (
        <PlaceDialog
          node={node}
          nodes={live}
          kind={form.kind}
          level={form.level}
          role={form.role}
          onClose={() => setForm(null)}
          onError={fail}
          onSaved={saved}
        />
      )}
    </div>
  );
}

function PlaceMenu({
  node,
  x,
  y,
  onClose,
  onPick,
}: {
  node: Territory;
  x: number;
  y: number;
  onClose: () => void;
  onPick: (kind: FormKind, level?: TerritoryLevel, role?: RoleKey) => void;
}) {
  const next = NEXT[node.level];
  const items: { kind: FormKind; label: string; level?: TerritoryLevel; role?: RoleKey }[] = [
    { kind: 'rename', label: 'Rename' },
    ...(next
      ? [
          {
            kind: 'add' as const,
            label: node.level === 'zone' && next === 'region' ? 'Add RBM' : `Add ${LABEL[next]}`,
            level: next,
          },
        ]
      : []),
    ...(node.level === 'zone'
      ? STATE_ROLES.map((role) => ({ kind: 'role' as const, label: role.label, role: role.role }))
      : []),
    ...(node.level === 'national' ? [] : [{ kind: 'move' as const, label: 'Move under…' }]),
    { kind: 'people', label: 'People' },
    { kind: 'retire', label: 'Retire' },
  ];
  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        className="fixed inset-0 z-40"
        onClick={onClose}
      />
      <ul
        role="menu"
        className="fixed z-50 max-h-80 min-w-44 overflow-auto rounded-lg border bg-white p-1 shadow-lg"
        style={{
          left: Math.min(x, window.innerWidth - 200),
          top: Math.min(y, window.innerHeight - 320),
        }}
      >
        {items.map((item) => (
          <li key={`${item.kind}-${item.level ?? ''}-${item.role ?? ''}`}>
            <button
              type="button"
              role="menuitem"
              className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => onPick(item.kind, item.level, item.role)}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function PlaceDialog({
  node,
  nodes,
  kind,
  level,
  role,
  onClose,
  onError,
  onSaved,
}: {
  node: Territory;
  nodes: Territory[];
  kind: FormKind;
  level: TerritoryLevel | null;
  role: RoleKey | null;
  onClose: () => void;
  onError: (e: unknown) => void;
  onSaved: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const parents = nodes.filter((t) => NEXT[t.level] === node.level);
  const adding = kind === 'add' ? level : null;
  const needs = adding ? parentLevel(adding) : null;
  const byId = useMemo(() => new Map(nodes.map((t) => [t.id, t])), [nodes]);
  const holders =
    needs === null ? [] : nodes.filter((t) => t.level === needs && inside(node.id, t, byId));
  const direct = needs !== null && node.level === needs;
  const [name, setName] = useState(node.name);
  const [child, setChild] = useState('');
  const [email, setEmail] = useState('');
  const [parentId, setParentId] = useState('');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [find, setFind] = useState('');
  const [found, setFound] = useState<Person[]>([]);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    if (kind !== 'people') return;
    let live = true;
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/users', {
        params: { query: { territoryId: node.id, limit: 100 } },
      });
      if (!live) return;
      if (r.error) return onError(r);
      const items = (r.data?.items ?? []) as Person[];
      setPeople(
        items.filter(
          (p) => p.territoryIds.includes(node.id) || p.territories?.some((t) => t.id === node.id),
        ),
      );
    })();
    return () => {
      live = false;
    };
  }, [kind, node.id]);

  async function rename() {
    const nextName = name.trim();
    if (!nextName || nextName === node.name) {
      onClose();
      return;
    }
    const r = await api.PATCH('/v1/territories/{id}', {
      params: { path: { id: node.id } },
      body: { version: node.version, name: nextName },
    });
    if (r.error) return onError(r);
    await onSaved();
  }
  async function addChild() {
    const nextName = child.trim();
    const parent = direct ? node.id : parentId;
    if (!adding || !nextName || !parent) return;
    const r = await api.POST('/v1/territories', {
      body: { name: nextName, level: adding, parentId: parent },
    });
    if (r.error) return onError(r);
    await onSaved();
  }
  async function addRole() {
    const nextName = name.trim();
    const nextEmail = email.trim();
    if (!role || !nextName || !nextEmail) return;
    const r = await api.POST('/v1/employees', {
      body: {
        name: nextName,
        email: nextEmail,
        phone: null,
        employeeCode: null,
        designation: null,
        joinedOn: null,
        dateOfBirth: null,
        role,
        territoryIds: [node.id],
        managerId: null,
      },
    });
    if (r.error) return onError(r);
    await onSaved();
  }
  async function move() {
    if (!parentId) return;
    const r = await api.POST('/v1/territories/{id}/move', {
      params: { path: { id: node.id } },
      body: { version: node.version, parentId },
    });
    if (r.error) return onError(r);
    await onSaved();
  }
  async function retire() {
    const r = await api.DELETE('/v1/territories/{id}', { params: { path: { id: node.id } } });
    if (r.error) return onError(r);
    await onSaved();
  }
  async function searchPeople(q: string) {
    setFind(q);
    if (q.trim().length < 2) return setFound([]);
    const r = await api.GET('/v1/users', {
      params: { query: { q: q.trim(), limit: 8, status: 'active' } },
    });
    if (r.error) return onError(r);
    setFound((r.data?.items ?? []) as Person[]);
  }
  async function addPerson(person: Person) {
    const ids = person.territoryIds.includes(node.id)
      ? person.territoryIds
      : [...person.territoryIds, node.id];
    const r = await api.PATCH('/v1/employees/{id}', {
      params: { path: { id: person.id } },
      body: { version: person.version, territoryIds: ids },
    });
    if (r.error) return onError(r);
    setFind('');
    setFound([]);
    setPeople((list) => [
      ...(list ?? []).filter((p) => p.id !== person.id),
      { ...person, territoryIds: ids },
    ]);
  }
  async function removePerson(person: Person) {
    const ids = person.territoryIds.filter((id) => id !== node.id);
    const r = await api.PATCH('/v1/employees/{id}', {
      params: { path: { id: person.id } },
      body: { version: person.version, territoryIds: ids },
    });
    if (r.error) return onError(r);
    setPeople((list) => (list ?? []).filter((p) => p.id !== person.id));
  }

  const title =
    kind === 'rename'
      ? `Rename ${node.name}`
      : kind === 'add' && adding
        ? `Add ${LABEL[adding]}`
        : kind === 'role' && role
          ? `Add ${STATE_ROLES.find((item) => item.role === role)?.label.replace('Add ', '') ?? 'person'} on ${node.name}`
          : kind === 'move'
            ? `Move ${node.name}`
            : kind === 'people'
              ? `People on ${node.name}`
              : `Retire ${node.name}`;

  return (
    <dialog
      ref={ref}
      closedby="any"
      className="master-record m-auto w-[min(28rem,calc(100vw-2rem))] flex-col gap-3 rounded-xl border bg-card p-4 shadow-xl"
      onClose={onClose}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      {kind === 'rename' && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <Input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      )}
      {kind === 'add' && adding && needs && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void addChild();
          }}
        >
          {!direct && holders.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Add a {LABEL[needs]} under {node.name} first. A {LABEL[adding]} sits under a{' '}
              {LABEL[needs]}.
            </p>
          )}
          {!direct && holders.length > 0 && (
            <select
              aria-label={LABEL[needs]}
              className="rounded-md border bg-background px-2 py-2 text-sm"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">Choose a {LABEL[needs]}</option>
              {holders.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
          )}
          {(direct || holders.length > 0) && (
            <Input
              aria-label={`${LABEL[adding]} name`}
              placeholder={`${LABEL[adding]} name`}
              value={child}
              onChange={(e) => setChild(e.target.value)}
            />
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!direct && !parentId}>
              Add
            </Button>
          </div>
        </form>
      )}
      {kind === 'role' && role && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void addRole();
          }}
        >
          <Input
            aria-label="Name"
            placeholder="Name"
            value={name === node.name ? '' : name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            aria-label="Email"
            type="email"
            placeholder="Work email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!email.trim() || !name.trim() || name === node.name}>
              Add
            </Button>
          </div>
        </form>
      )}
      {kind === 'move' && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void move();
          }}
        >
          <select
            aria-label="New parent"
            className="rounded-md border bg-background px-2 py-2 text-sm"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">Choose a place</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!parentId}>
              Move
            </Button>
          </div>
        </form>
      )}
      {kind === 'people' && (
        <div className="flex flex-col gap-3">
          <ul className="flex max-h-40 flex-col gap-1 overflow-auto">
            {(people ?? []).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{p.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void removePerson(p)}
                >
                  Remove
                </Button>
              </li>
            ))}
            {people && people.length === 0 && (
              <li className="text-sm text-muted-foreground">Nobody is assigned here.</li>
            )}
          </ul>
          <Input
            aria-label="Find a person to add"
            placeholder="Find a person"
            value={find}
            onChange={(e) => void searchPeople(e.target.value)}
          />
          {found.length > 0 && (
            <ul className="rounded-md border">
              {found.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => void addPerson(p)}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      )}
      {kind === 'retire' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {node.name} can be retired only when nothing still uses it.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void retire()}>
              Retire
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
