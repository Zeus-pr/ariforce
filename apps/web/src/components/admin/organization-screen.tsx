'use client';

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { Territory, TerritoryLevel } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { api, apiReady, toApiError } from '@/lib/api';
import { adminMessage } from '@/lib/admin/messages';
import { invalidateTerritories, useTerritories } from '@/lib/query';

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
const HEALTH: Record<string, string> = {
  no_territory: 'No place assigned',
  sfc_hq_invisible: 'Not on a BM HQ',
  bm_without_hq: 'Business manager without a BM HQ',
  hq_without_bm: 'BM HQ with no business manager',
  area_without_holder: 'ABM HQ with nobody on it',
  assignment_to_deleted: 'Assigned to a retired place',
};

type HealthItem = {
  code: string;
  count: number;
  people: { id: string; name: string; territoryId: string | null }[];
  places: { id: string; name: string }[];
};
type Person = {
  id: string;
  name: string;
  version: number;
  primaryRole: string | null;
  territoryIds: string[];
  territories: { id: string; name: string; level: string }[];
};

export function OrganizationScreen() {
  const terrs = useTerritories();
  const live = useMemo(() => (terrs.data ?? []).filter((t) => !t.deletedAt), [terrs.data]);
  const [health, setHealth] = useState<HealthItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const node = live.find((t) => t.id === selected) ?? null;

  async function loadHealth() {
    await apiReady();
    const r = await api.GET('/v1/territories/health');
    if (r.error) {
      const a = toApiError(r);
      if (a.code === 'NOT_FOUND') return;
      return setError(adminMessage(a.code, a.message));
    }
    setHealth(r.data?.items ?? []);
  }
  useEffect(() => {
    void loadHealth();
  }, []);

  function fail(e: unknown) {
    const a = toApiError(e);
    setNotice(null);
    setError(adminMessage(a.code, a.message));
  }
  async function refresh(message: string) {
    setError(null);
    setNotice(message);
    await invalidateTerritories();
    await loadHealth();
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p
          role="alert"
          className="af-fade rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {notice && <p className="af-fade text-sm text-muted-foreground">{notice}</p>}
      <section className="flex flex-col gap-2" aria-label="Setup problems">
        {(health ?? [])
          .filter((h) => h.count > 0)
          .map((h) => (
            <div key={h.code} className="rounded-lg border p-3">
              <p className="text-sm font-medium">
                {HEALTH[h.code] ?? h.code} · {h.count}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {h.people.map((person) => (
                  <Button
                    key={person.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (person.territoryId) setSelected(person.territoryId);
                      else
                        setError(
                          `${person.name} has no place yet. Add them from a place in the tree.`,
                        );
                    }}
                  >
                    {person.name}
                  </Button>
                ))}
                {h.places.map((place) => (
                  <Button
                    key={place.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSelected(place.id)}
                  >
                    {place.name}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        {health && health.every((h) => h.count === 0) && (
          <p className="text-sm text-muted-foreground">The map has no setup problems.</p>
        )}
      </section>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(18rem,26rem)_1fr]">
        <Tree nodes={live} selected={selected} onSelect={setSelected} />
        {node ? (
          <NodePanel node={node} nodes={live} onError={fail} onSaved={refresh} />
        ) : (
          <p className="text-sm text-muted-foreground">Choose a place in the tree.</p>
        )}
      </div>
    </div>
  );
}

function startsOpen(node: Territory, siblings: number, kids: Territory[]) {
  if (node.level === 'headquarter' || node.level === 'territory') return false;
  if (node.level === 'zone' || node.level === 'region' || node.level === 'area') return true;
  if (siblings > 1) return true;
  const childLevel = kids[0]?.level;
  return (
    childLevel === 'zone' ||
    childLevel === 'region' ||
    childLevel === 'area' ||
    childLevel === 'headquarter'
  );
}

function countLabel(kids: Territory[]) {
  const level = kids[0]?.level;
  if (!level || kids.some((k) => k.level !== level)) return `${kids.length} places`;
  const plural: Record<TerritoryLevel, [string, string]> = {
    national: ['country', 'countries'],
    zone: ['state', 'states'],
    region: ['RBM HQ', 'RBM HQs'],
    area: ['ABM HQ', 'ABM HQs'],
    headquarter: ['BM HQ', 'BM HQs'],
    territory: ['territory', 'territories'],
  };
  const [one, many] = plural[level];
  return `${kids.length} ${kids.length === 1 ? one : many}`;
}

function initialOpen(nodes: Territory[], kidsOf: Map<string, Territory[]>) {
  const open = new Set<string>();
  const roots = nodes.filter((t) => !t.parentId || !nodes.some((p) => p.id === t.parentId));
  const walk = (node: Territory, siblings: number) => {
    const kids = kidsOf.get(node.id) ?? [];
    if (startsOpen(node, siblings, kids)) open.add(node.id);
    for (const kid of kids) walk(kid, kids.length);
  };
  for (const root of roots) walk(root, roots.length);
  return open;
}

function Tree({
  nodes,
  selected,
  onSelect,
}: {
  nodes: Territory[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const kidsOf = useMemo(() => {
    const m = new Map<string, Territory[]>();
    for (const t of nodes) {
      if (!t.parentId) continue;
      const list = m.get(t.parentId) ?? [];
      list.push(t);
      m.set(t.parentId, list);
    }
    return m;
  }, [nodes]);
  const byId = useMemo(() => new Map(nodes.map((t) => [t.id, t])), [nodes]);
  const [openIds, setOpenIds] = useState<Set<string> | null>(null);
  const [query, setQuery] = useState('');
  if (openIds === null && nodes.length > 0) setOpenIds(initialOpen(nodes, kidsOf));

  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const keep = new Set<string>();
    if (!needle) {
      for (const t of nodes) keep.add(t.id);
      return keep;
    }
    const hit = (id: string): boolean => {
      const node = byId.get(id);
      if (!node) return false;
      if (node.name.toLowerCase().includes(needle)) return true;
      return (kidsOf.get(id) ?? []).some((k) => hit(k.id));
    };
    for (const t of nodes) if (hit(t.id)) keep.add(t.id);
    return keep;
  }, [needle, nodes, byId, kidsOf]);

  useEffect(() => {
    if (!needle) return;
    setOpenIds((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      for (const t of nodes) {
        if (!t.name.toLowerCase().includes(needle)) continue;
        let parent = t.parentId;
        while (parent) {
          next.add(parent);
          parent = byId.get(parent)?.parentId ?? null;
        }
      }
      return next.size === prev.size ? prev : next;
    });
  }, [needle, nodes, byId]);

  useEffect(() => {
    if (!selected) return;
    setOpenIds((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      let parent = byId.get(selected)?.parentId;
      let changed = false;
      while (parent) {
        if (!next.has(parent)) {
          next.add(parent);
          changed = true;
        }
        parent = byId.get(parent)?.parentId;
      }
      return changed ? next : prev;
    });
  }, [selected, byId]);

  const roots = nodes.filter((t) => !t.parentId || !byId.has(t.parentId));
  const shown = roots.filter((t) => visible.has(t.id));

  return (
    <div className="flex flex-col gap-2">
      <Input
        aria-label="Find a place"
        placeholder="Find a place"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No place matches.</p>
      ) : (
        <ul className="org-place flex flex-col gap-0.5 text-sm" aria-label="Company map">
          {shown.map((n) => (
            <Branch
              key={n.id}
              node={n}
              kidsOf={kidsOf}
              visible={visible}
              selected={selected}
              openIds={openIds ?? new Set()}
              setOpenIds={setOpenIds}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Branch({
  node,
  kidsOf,
  visible,
  selected,
  openIds,
  setOpenIds,
  onSelect,
}: {
  node: Territory;
  kidsOf: Map<string, Territory[]>;
  visible: Set<string>;
  selected: string | null;
  openIds: Set<string>;
  setOpenIds: Dispatch<SetStateAction<Set<string> | null>>;
  onSelect: (id: string) => void;
}) {
  const kids = (kidsOf.get(node.id) ?? []).filter((k) => visible.has(k.id));
  const row = `flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted ${selected === node.id ? 'bg-muted font-medium' : ''}`;
  if (kids.length === 0) {
    return (
      <li>
        <button type="button" className={row} onClick={() => onSelect(node.id)}>
          <span className="inline-block size-2 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{LABEL[node.level]}</span>
        </button>
      </li>
    );
  }
  return (
    <li>
      <details
        open={openIds.has(node.id)}
        onToggle={(e) => {
          const open = e.currentTarget.open;
          setOpenIds((prev) => {
            if (!prev || prev.has(node.id) === open) return prev;
            const next = new Set(prev);
            if (open) next.add(node.id);
            else next.delete(node.id);
            return next;
          });
        }}
      >
        <summary className={row} onClick={() => onSelect(node.id)}>
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{LABEL[node.level]}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{countLabel(kids)}</span>
        </summary>
        <ul className="ms-3 border-s border-border ps-1">
          {kids.map((k) => (
            <Branch
              key={k.id}
              node={k}
              kidsOf={kidsOf}
              visible={visible}
              selected={selected}
              openIds={openIds}
              setOpenIds={setOpenIds}
              onSelect={onSelect}
            />
          ))}
        </ul>
      </details>
    </li>
  );
}

function NodePanel({
  node,
  nodes,
  onError,
  onSaved,
}: {
  node: Territory;
  nodes: Territory[];
  onError: (e: unknown) => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [name, setName] = useState(node.name);
  const [child, setChild] = useState('');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [find, setFind] = useState('');
  const [found, setFound] = useState<Person[]>([]);
  const next = NEXT[node.level];
  const parents = nodes.filter((t) => NEXT[t.level] === node.level);

  useEffect(() => {
    setName(node.name);
    setChild('');
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/users', {
        params: { query: { territoryId: node.id, limit: 100 } },
      });
      if (r.error) return onError(r);
      const items = (r.data?.items ?? []) as Person[];
      setPeople(
        items.filter(
          (p) => p.territoryIds.includes(node.id) || p.territories?.some((t) => t.id === node.id),
        ),
      );
    })();
  }, [node.id, node.name]);

  async function saveName() {
    const nextName = name.trim();
    if (!nextName || nextName === node.name) return;
    const r = await api.PATCH('/v1/territories/{id}', {
      params: { path: { id: node.id } },
      body: { version: node.version, name: nextName },
    });
    if (r.error) return onError(r);
    await onSaved(`Renamed to ${nextName}.`);
  }

  async function addChild() {
    const nextName = child.trim();
    if (!next || !nextName) return;
    const r = await api.POST('/v1/territories', {
      body: { name: nextName, level: next, parentId: node.id },
    });
    if (r.error) return onError(r);
    setChild('');
    await onSaved(`${LABEL[next]} “${nextName}” added.`);
  }

  async function moveTo(parentId: string) {
    const parent = nodes.find((t) => t.id === parentId);
    if (!parent) return;
    if (!window.confirm(`Move ${node.name} under ${parent.name}? Everything under it moves too.`))
      return;
    const r = await api.POST('/v1/territories/{id}/move', {
      params: { path: { id: node.id } },
      body: { version: node.version, parentId },
    });
    if (r.error) return onError(r);
    await onSaved(`${node.name} now sits under ${parent.name}.`);
  }

  async function retire() {
    if (!window.confirm(`Retire ${node.name}? This only works when nothing still uses it.`)) return;
    const r = await api.DELETE('/v1/territories/{id}', { params: { path: { id: node.id } } });
    if (r.error) return onError(r);
    await onSaved(`${node.name} was retired.`);
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
    await onSaved(`${person.name} is now on ${node.name}.`);
    const again = await api.GET('/v1/users', {
      params: { query: { territoryId: node.id, limit: 100 } },
    });
    if (again.data) {
      const items = again.data.items as Person[];
      setPeople(items.filter((p) => p.territoryIds.includes(node.id)));
    }
  }

  async function removePerson(person: Person) {
    const ids = person.territoryIds.filter((id) => id !== node.id);
    if (
      ids.length === 0 &&
      !window.confirm(`${person.name} would have no place. Remove them anyway?`)
    )
      return;
    const r = await api.PATCH('/v1/employees/{id}', {
      params: { path: { id: person.id } },
      body: { version: person.version, territoryIds: ids },
    });
    if (r.error) return onError(r);
    await onSaved(`${person.name} was removed from ${node.name}.`);
  }

  return (
    <div className="af-reveal flex flex-col gap-4" data-open="true">
      <div>
        <p className="text-sm text-muted-foreground">{LABEL[node.level]}</p>
        <Input
          aria-label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void saveName()}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Code {node.code}. A code change is a separate save because it moves the path.
        </p>
      </div>
      {next && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void addChild();
          }}
        >
          <Input
            aria-label={`New ${LABEL[next]} name`}
            placeholder={`New ${LABEL[next].toLowerCase()} name`}
            value={child}
            onChange={(e) => setChild(e.target.value)}
          />
          <Button type="submit">Add</Button>
        </form>
      )}
      {parents.length > 0 && node.level !== 'national' && (
        <label className="flex flex-col gap-1 text-sm">
          Move under
          <select
            className="rounded-md border bg-background px-2 py-2"
            defaultValue=""
            onChange={(e) => e.target.value && void moveTo(e.target.value)}
          >
            <option value="">Choose…</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div>
        <h2 className="text-sm font-medium">People on this place</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {(people ?? []).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {p.name} <span className="text-muted-foreground">{p.primaryRole}</span>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => void removePerson(p)}>
                Remove
              </Button>
            </li>
          ))}
          {people && people.length === 0 && (
            <li className="text-sm text-muted-foreground">Nobody is assigned here.</li>
          )}
        </ul>
        <Input
          className="mt-2"
          aria-label="Find a person to add"
          placeholder="Find a person"
          value={find}
          onChange={(e) => void searchPeople(e.target.value)}
        />
        {found.length > 0 && (
          <ul className="mt-1 rounded-md border">
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
      </div>
      <Button type="button" variant="outline" onClick={() => void retire()}>
        Retire this place
      </Button>
    </div>
  );
}
