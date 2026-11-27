'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getNodesBounds,
  getViewportForBounds,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { toPng } from 'html-to-image';
import {
  Building2,
  Download,
  House,
  Landmark,
  Lock,
  Map as MapIcon,
  UserRound,
} from 'lucide-react';
import {
  TERRITORY_LEVELS,
  type RoleKey,
  type Territory,
  type TerritoryLevel,
} from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import '@xyflow/react/dist/style.css';
import { api, apiReady, toApiError } from '@/lib/api';
import { adminMessage } from '@/lib/admin/messages';
import { allPages } from '@/lib/paging';
import { invalidateTerritories, useTerritories } from '@/lib/query';
import { ROLE_LABEL, roleLevel, type Role } from '@/lib/roles';

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
const STATE_ROLES: { role: RoleKey; label: string }[] = [
  { role: 'zonal_business_manager', label: 'Add ZBM' },
  { role: 'sales_manager', label: 'Add Sales Manager' },
  { role: 'general_manager', label: 'Add General Manager' },
  { role: 'vice_president', label: 'Add Vice President' },
  { role: 'director', label: 'Add Director' },
];

type Person = {
  id: string;
  name: string;
  version: number;
  primaryRole: string | null;
  status?: string | null;
  hrStatus?: string | null;
  territoryIds: string[];
  territories?: { id: string; name: string; level: string }[];
};

type Dialog =
  | { kind: 'move' }
  | { kind: 'add' }
  | { kind: 'person' }
  | { kind: 'retire'; blocked: string | null }
  | { kind: 'role'; role: RoleKey };

function parentLevel(level: TerritoryLevel): TerritoryLevel | null {
  const index = TERRITORY_LEVELS.indexOf(level);
  return index <= 0 ? null : TERRITORY_LEVELS[index - 1]!;
}

function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name);
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

function onPlace(person: Person, id: string) {
  return person.territoryIds?.includes(id) || !!person.territories?.some((t) => t.id === id);
}

function levelLabel(level: TerritoryLevel) {
  return LABEL[level] ?? level;
}

function roleText(role: string | null) {
  if (role && role in ROLE_LABEL) return ROLE_LABEL[role as Role] ?? '';
  return '';
}

function rankOf(role: string | null) {
  return role && role in ROLE_LABEL ? roleLevel(role as Role) : 0;
}

/** Everyone assigned to this place. An active person is listed before an invited one. */
function peopleOn(place: Territory, people: readonly Person[]): Person[] {
  return people
    .filter((p) => onPlace(p, place.id))
    .sort(
      (a, b) =>
        Number(b.status === 'active') - Number(a.status === 'active') ||
        rankOf(b.primaryRole) - rankOf(a.primaryRole) ||
        a.name.localeCompare(b.name),
    );
}

function kidsOf(places: readonly Territory[]) {
  const map = new Map<string, Territory[]>();
  for (const place of places) {
    if (!place.parentId) continue;
    const list = map.get(place.parentId) ?? [];
    list.push(place);
    map.set(place.parentId, list);
  }
  for (const list of map.values()) list.sort(byName);
  return map;
}

function blockedLine(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, number>;
  const bits: string[] = [];
  const push = (n: number | undefined, one: string, many: string) => {
    if (!n) return;
    bits.push(`${n} ${n === 1 ? one : many}`);
  };
  push(d.doctors, 'doctor', 'doctors');
  push(d.chemists, 'chemist', 'chemists');
  push(d.stockists, 'stockist', 'stockists');
  push(d.people, 'person', 'people');
  push(d.children, 'place under it', 'places under it');
  push(d.sfcRoutes, 'route', 'routes');
  push(d.allowancePlaces, 'allowance', 'allowances');
  push(d.productHqMappings, 'product mapping', 'product mappings');
  if (!bits.length) return null;
  if (bits.length === 1 && d.doctors)
    return `${d.doctors} doctor${d.doctors === 1 ? '' : 's'} are still on this territory.`;
  return `${bits.join(', ')} still on this place.`;
}

export function OrganizationScreen() {
  const terrs = useTerritories();
  const live = useMemo(() => (terrs.data ?? []).filter((t) => !t.deletedAt), [terrs.data]);
  const byId = useMemo(() => new Map(live.map((t) => [t.id, t])), [live]);
  const children = useMemo(() => kidsOf(live), [live]);
  const [people, setPeople] = useState<Person[]>([]);
  const [peopleTick, setPeopleTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openIds, setOpenIds] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chart, setChart] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (openIds || !live.length) return;
    setOpenIds(new Set());
  }, [live, openIds]);

  useEffect(() => {
    let live = true;
    void (async () => {
      await apiReady();
      const r = await allPages(
        (cursor) => api.GET('/v1/users', { params: { query: { limit: 100, cursor } } }),
        100,
      );
      if (!live) return;
      if (r.error) {
        setError(toApiError(r.error).message || 'Could not load people.');
        return;
      }
      setPeople((r.data?.items ?? []) as Person[]);
    })();
    return () => {
      live = false;
    };
  }, [peopleTick]);

  const selected = live.find((t) => t.id === selectedId) ?? null;
  useEffect(() => {
    setName(selected?.name ?? '');
  }, [selected?.id, selected?.name]);

  const needle = query.trim().toLowerCase();
  const keep = useMemo(() => {
    if (!needle) return null;
    const ids = new Set<string>();
    const matches = (place: Territory) => {
      if (place.name.toLowerCase().includes(needle)) return true;
      return peopleOn(place, people).some((p) => p.name.toLowerCase().includes(needle));
    };
    for (const place of live) {
      if (!matches(place)) continue;
      let id: string | null = place.id;
      const seen = new Set<string>();
      while (id && !seen.has(id)) {
        seen.add(id);
        ids.add(id);
        id = byId.get(id)?.parentId ?? null;
      }
    }
    return ids;
  }, [byId, live, needle, people]);

  const rows = useMemo(() => {
    const out: { place: Territory; depth: number }[] = [];
    const walk = (id: string | null, depth: number) => {
      const list = id ? (children.get(id) ?? []) : live.filter((t) => !t.parentId).sort(byName);
      for (const place of list) {
        if (keep && !keep.has(place.id)) continue;
        out.push({ place, depth });
        if (needle || openIds?.has(place.id)) walk(place.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [children, keep, live, needle, openIds]);

  function fail(e: unknown) {
    const a = toApiError(e);
    setError(adminMessage(a.code, a.message));
  }

  function choose(id: string) {
    setSelectedId(id);
    setError(null);
    setDialog(null);
    const place = byId.get(id);
    if (place?.level === 'headquarter') {
      setOpenIds((cur) => {
        const next = new Set(cur ?? []);
        next.add(id);
        return next;
      });
    }
  }

  function toggle(id: string) {
    setOpenIds((cur) => {
      const next = new Set(cur ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveName() {
    if (!selected) return;
    const next = name.trim();
    if (!next || next === selected.name) {
      setName(selected.name);
      return;
    }
    setSavingName(true);
    const r = await api.PATCH('/v1/territories/{id}', {
      params: { path: { id: selected.id } },
      body: { version: selected.version, name: next },
    });
    setSavingName(false);
    if (r.error) {
      setName(selected.name);
      return fail(r);
    }
    await invalidateTerritories();
  }

  const nextLevel = selected ? NEXT[selected.level] : undefined;
  const addLabel =
    selected?.level === 'zone' && nextLevel === 'region'
      ? 'Add RBM'
      : nextLevel
        ? `Add ${levelLabel(nextLevel)}`
        : '';
  const assigned = selected ? peopleOn(selected, people) : [];
  const childList = selected ? (children.get(selected.id) ?? []) : [];
  const shownKids = childList.slice(0, 3);
  const moreKids = childList.length - shownKids.length;

  return (
    <div className="flex h-[calc(100dvh-var(--header-height))] min-h-0 flex-col bg-[#F8FAFC]">
      <div className="flex items-center justify-end gap-2 px-4 py-3">
        <Button
          type="button"
          variant="outline"
          className="border-[#0CAAC1] text-[#0C8498]"
          onClick={() => setChart(true)}
        >
          View org tree
        </Button>
        <Input
          aria-label="Find a place"
          placeholder="Find a place"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-56 bg-white"
        />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-4 pb-4 lg:grid-cols-[minmax(0,1.2fr)_22rem]">
        <section className="min-h-0 overflow-auto rounded-xl border bg-white p-3">
          <h2 className="px-2 pb-2 text-sm font-semibold text-[#0F2A4A]">Places</h2>
          {terrs.isPending && <p className="px-2 text-sm text-muted-foreground">Loading places.</p>}
          {terrs.isError && <p className="px-2 text-sm text-destructive">Could not load places.</p>}
          <ul>
            {rows.map(({ place, depth }) => {
              const assignedHere = peopleOn(place, people);
              const kids = children.get(place.id) ?? [];
              const open = needle || !!openIds?.has(place.id);
              return (
                <li key={place.id}>
                  <div
                    className={`flex items-center gap-1 rounded-md pr-2 ${
                      selectedId === place.id ? 'bg-[#E8F6F9]' : 'hover:bg-slate-50'
                    }`}
                    style={{ paddingLeft: 8 + depth * 16 }}
                  >
                    {kids.length > 0 ? (
                      <button
                        type="button"
                        aria-label={open ? `Fold ${place.name}` : `Open ${place.name}`}
                        className="grid size-6 shrink-0 place-items-center text-slate-500"
                        onClick={() => toggle(place.id)}
                      >
                        {open ? '▾' : '▸'}
                      </button>
                    ) : (
                      <span className="size-6 shrink-0" />
                    )}
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
                      onClick={() => choose(place.id)}
                    >
                      <span className="truncate text-sm font-medium text-[#0F2A4A]">
                        {place.name}
                      </span>
                      {place.level !== 'national' && place.level !== 'zone' && (
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          {levelLabel(place.level)}
                        </span>
                      )}
                      {(assignedHere.length > 0 ||
                        (place.level !== 'territory' && place.level !== 'national')) && (
                        <span className="ml-auto text-right text-xs text-slate-500">
                          {assignedHere.length
                            ? assignedHere.map((p) => p.name).join(', ')
                            : 'Vacant'}
                        </span>
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="min-h-0 overflow-auto rounded-xl border bg-white p-4">
          {!selected && (
            <p className="text-sm text-muted-foreground">Choose a place to see who holds it.</p>
          )}
          {selected && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-[#0F2A4A]">{selected.name}</h2>
                <span className="rounded-md bg-[#0CAAC1] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {levelLabel(selected.level)}
                </span>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <label className="flex flex-col gap-1 text-sm">
                Name
                <Input
                  aria-label="Name"
                  value={name}
                  disabled={savingName}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => void saveName()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void saveName();
                    }
                  }}
                />
              </label>
              <div className="text-sm">
                <div className="text-slate-500">Parent</div>
                <div className="font-medium text-[#0F2A4A]">
                  {selected.parentId ? (byId.get(selected.parentId)?.name ?? '—') : '—'}
                </div>
              </div>
              <div className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-slate-500">People</div>
                  <button
                    type="button"
                    className="text-sm font-medium text-[#0C8498]"
                    onClick={() => setDialog({ kind: 'person' })}
                  >
                    Change
                  </button>
                </div>
                {assigned.length === 0 && (
                  <div className="font-semibold text-[#0F2A4A]">Vacant</div>
                )}
                <ul className="mt-1 flex flex-col gap-1">
                  {assigned.map((person) => (
                    <li key={person.id}>
                      <div className="font-semibold text-[#0F2A4A]">{person.name}</div>
                      <div className="text-xs text-slate-500">{roleText(person.primaryRole)}</div>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="text-sm">
                <div className="text-slate-500">Children</div>
                {shownKids.length === 0 && <div className="text-slate-500">None</div>}
                <ul>
                  {shownKids.map((child) => (
                    <li key={child.id}>
                      <button
                        type="button"
                        className="text-left text-[#0F2A4A] hover:underline"
                        onClick={() => choose(child.id)}
                      >
                        {child.name}
                      </button>
                    </li>
                  ))}
                </ul>
                {moreKids > 0 && <div className="text-slate-500">+{moreKids} more</div>}
              </div>
              {selected.level === 'zone' && (
                <div className="flex flex-wrap gap-2">
                  {STATE_ROLES.map((role) => (
                    <Button
                      key={role.role}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDialog({ kind: 'role', role: role.role })}
                    >
                      {role.label}
                    </Button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {parentLevel(selected.level) && (
                  <Button type="button" onClick={() => setDialog({ kind: 'move' })}>
                    Move under
                  </Button>
                )}
                {nextLevel && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDialog({ kind: 'add' })}
                  >
                    {addLabel}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialog({ kind: 'retire', blocked: null })}
                >
                  Retire
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
      {chart && (
        <ChartDialog places={live} people={people} onClose={() => setChart(false)} onError={fail} />
      )}
      {dialog && selected && (
        <PlaceDialog
          key={dialog.kind === 'role' ? dialog.role : dialog.kind}
          node={selected}
          nodes={live}
          people={people}
          dialog={dialog}
          onClose={() => setDialog(null)}
          onError={fail}
          onSaved={async () => {
            setDialog(null);
            setError(null);
            setPeopleTick((n) => n + 1);
            await invalidateTerritories();
          }}
          onBlocked={(line) => setDialog({ kind: 'retire', blocked: line })}
        />
      )}
    </div>
  );
}

function ChartDialog({
  places,
  people,
  onClose,
  onError,
}: {
  places: Territory[];
  people: Person[];
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      closedby="any"
      className="m-auto flex h-[min(40rem,calc(100dvh-2rem))] w-[min(64rem,calc(100vw-2rem))] flex-col gap-3 rounded-xl border bg-white p-4 shadow-xl"
      onClose={onClose}
    >
      <ReactFlowProvider>
        <ChartBody places={places} people={people} onClose={onClose} onError={onError} />
      </ReactFlowProvider>
    </dialog>
  );
}

type ChartData = {
  title: string;
  subtitle: string;
  person: string;
  extra: string;
  level: TerritoryLevel;
};
type ChartNode = Node<ChartData, 'place'>;

const LEVEL_ICON: Record<TerritoryLevel, typeof House> = {
  national: Landmark,
  zone: MapIcon,
  region: House,
  area: Building2,
  headquarter: UserRound,
  territory: MapIcon,
};

function ChartCard({ data }: NodeProps<ChartNode>) {
  const Icon = LEVEL_ICON[data.level];
  return (
    <div className="flex w-[232px] items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm">
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Icon className="size-7 shrink-0 text-[#0C8498]" strokeWidth={1.5} aria-hidden />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-[#0F2A4A]">{data.title}</div>
        <div className="truncate text-[11px] text-slate-500">{data.subtitle}</div>
        <div className="truncate text-xs text-slate-600" title={data.person}>
          {data.person}
        </div>
        {data.extra && <div className="truncate text-[11px] text-slate-400">{data.extra}</div>}
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}

const chartTypes = { place: ChartCard };

function chartLayout(places: readonly Territory[], people: readonly Person[]) {
  const shown = places.filter((p) => p.level !== 'territory');
  const kids = kidsOf(shown);
  const patches = kidsOf(places);
  const W = 248;
  const H = 96;
  const GX = 28;
  const GY = 64;
  const widthOf = (id: string): number => {
    const list = kids.get(id) ?? [];
    if (!list.length) return W;
    return list.reduce((sum, child) => sum + widthOf(child.id), 0) + GX * (list.length - 1);
  };
  const pos = new Map<string, { x: number; y: number }>();
  const placeAt = (id: string, left: number, depth: number) => {
    const list = kids.get(id) ?? [];
    const w = widthOf(id);
    pos.set(id, { x: left + w / 2 - W / 2, y: depth * (H + GY) });
    let x = left;
    for (const child of list) {
      placeAt(child.id, x, depth + 1);
      x += widthOf(child.id) + GX;
    }
  };
  const roots = shown.filter((p) => !p.parentId || !shown.some((s) => s.id === p.parentId));
  let left = 0;
  for (const root of roots.sort(byName)) {
    placeAt(root.id, left, 0);
    left += widthOf(root.id) + GX;
  }
  const nodes: ChartNode[] = shown.map((place) => {
    const names = peopleOn(place, people).map((p) => p.name);
    const hqCount = (kids.get(place.id) ?? []).filter((c) => c.level === 'headquarter').length;
    const patchCount = (patches.get(place.id) ?? []).filter((c) => c.level === 'territory').length;
    const extra =
      place.level === 'area' && hqCount > 0
        ? `${hqCount} BM HQ${hqCount === 1 ? '' : 's'}`
        : place.level === 'headquarter' && patchCount > 0
          ? `${patchCount} territor${patchCount === 1 ? 'y' : 'ies'}`
          : '';
    return {
      id: place.id,
      type: 'place',
      position: pos.get(place.id) ?? { x: 0, y: 0 },
      data: {
        title: place.name,
        subtitle: levelLabel(place.level),
        person: names.length ? names.join(', ') : 'Vacant',
        extra,
        level: place.level,
      },
      draggable: false,
      connectable: false,
      selectable: false,
    };
  });
  const edges: Edge[] = [];
  for (const place of shown) {
    for (const child of kids.get(place.id) ?? []) {
      edges.push({
        id: `${place.id}-${child.id}`,
        source: place.id,
        target: child.id,
        type: 'step',
        style: { stroke: '#64748b', strokeWidth: 1.25 },
      });
    }
  }
  return { nodes, edges };
}

function ChartBody({
  places,
  people,
  onClose,
  onError,
}: {
  places: Territory[];
  people: Person[];
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const laid = useMemo(() => chartLayout(places, people), [places, people]);

  async function download() {
    const pane = box.current?.querySelector('.react-flow__viewport');
    if (!(pane instanceof HTMLElement)) return;
    setDownloading(true);
    try {
      const bounds = getNodesBounds(laid.nodes);
      const width = 2048;
      const height = 1152;
      const viewport = getViewportForBounds(bounds, width, height, 0.2, 2, 0.12);
      const dataUrl = await toPng(pane, {
        backgroundColor: '#f8fafc',
        width,
        height,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        },
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'organization-tree.png';
      a.click();
    } catch (e) {
      onError(e);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[#0F2A4A]">Organization tree</h2>
        <div className="flex items-center gap-3">
          <p className="flex items-center gap-1 text-xs text-slate-500">
            <Lock className="size-3" aria-hidden />
            View only, cannot move or edit
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={downloading}
            onClick={() => void download()}
          >
            <Download className="size-4" aria-hidden />
            {downloading ? 'Downloading…' : 'Download'}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
      </div>
      <div ref={box} className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-white">
        <ReactFlow
          nodes={laid.nodes}
          edges={laid.edges}
          nodeTypes={chartTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.05}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        />
      </div>
      <p className="text-center text-xs text-slate-500">
        Picture only. Changes are made in the tree.
      </p>
    </>
  );
}

function PlaceDialog({
  node,
  nodes,
  people,
  dialog,
  onClose,
  onError,
  onSaved,
  onBlocked,
}: {
  node: Territory;
  nodes: Territory[];
  people: Person[];
  dialog: Dialog;
  onClose: () => void;
  onError: (e: unknown) => void;
  onSaved: () => Promise<void>;
  onBlocked: (line: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const byId = useMemo(() => new Map(nodes.map((t) => [t.id, t])), [nodes]);
  const parents = nodes
    .filter((t) => NEXT[t.level] === node.level && t.id !== node.id && !inside(node.id, t, byId))
    .sort(byName);
  const [parentId, setParentId] = useState(node.parentId ?? '');
  const [child, setChild] = useState('');
  const [email, setEmail] = useState('');
  const [personName, setPersonName] = useState('');
  const [find, setFind] = useState('');
  const [found, setFound] = useState<Person[]>([]);
  const holders = peopleOn(node, people);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function move() {
    if (!parentId || parentId === node.parentId) return;
    setBusy(true);
    const r = await api.POST('/v1/territories/{id}/move', {
      params: { path: { id: node.id } },
      body: { version: node.version, parentId },
    });
    setBusy(false);
    if (r.error) return onError(r);
    await onSaved();
  }

  async function addChild() {
    const nextName = child.trim();
    const level = NEXT[node.level];
    if (!level || !nextName) return;
    setBusy(true);
    const r = await api.POST('/v1/territories', {
      body: { name: nextName, level, parentId: node.id },
    });
    setBusy(false);
    if (r.error) return onError(r);
    await onSaved();
  }

  async function addRole() {
    if (dialog.kind !== 'role') return;
    const nextName = personName.trim();
    const nextEmail = email.trim();
    if (!nextName || !nextEmail) return;
    setBusy(true);
    const r = await api.POST('/v1/employees', {
      body: {
        name: nextName,
        email: nextEmail,
        phone: null,
        employeeCode: null,
        designation: null,
        joinedOn: null,
        dateOfBirth: null,
        role: dialog.role,
        territoryIds: [node.id],
        managerId: null,
      },
    });
    setBusy(false);
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
    if (onPlace(person, node.id)) return;
    setBusy(true);
    const ids = person.territoryIds.includes(node.id)
      ? person.territoryIds
      : [...person.territoryIds, node.id];
    const r = await api.PATCH('/v1/employees/{id}', {
      params: { path: { id: person.id } },
      body: { version: person.version, territoryIds: ids },
    });
    setBusy(false);
    if (r.error) return onError(r);
    setFind('');
    setFound([]);
    await onSaved();
  }

  async function removePerson(person: Person) {
    setBusy(true);
    const ids = person.territoryIds.filter((id) => id !== node.id);
    const r = await api.PATCH('/v1/employees/{id}', {
      params: { path: { id: person.id } },
      body: { version: person.version, territoryIds: ids },
    });
    setBusy(false);
    if (r.error) return onError(r);
    await onSaved();
  }

  async function retire() {
    setBusy(true);
    const r = await api.DELETE('/v1/territories/{id}', { params: { path: { id: node.id } } });
    setBusy(false);
    if (r.error) {
      const a = toApiError(r);
      if (a.code === 'TERRITORY_IN_USE') {
        onBlocked(blockedLine(a.details) || a.message);
        return;
      }
      return onError(r);
    }
    await onSaved();
  }

  const adding = NEXT[node.level];
  const hits = found.filter((p) => !onPlace(p, node.id));

  return (
    <dialog
      ref={ref}
      closedby="any"
      className="master-record m-auto w-[min(28rem,calc(100vw-2rem))] flex-col gap-3 rounded-xl border bg-white p-4 shadow-xl"
      onClose={onClose}
    >
      {dialog.kind === 'move' && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void move();
          }}
        >
          <h2 className="text-base font-semibold text-[#0F2A4A]">Move {node.name}</h2>
          <p className="text-sm text-slate-600">
            Put this {levelLabel(node.level)} under a{' '}
            {(() => {
              const parent = parentLevel(node.level);
              return parent ? levelLabel(parent) : 'place';
            })()}
            .
          </p>
          <div className="flex max-h-64 flex-col gap-2 overflow-auto">
            {parents.map((place) => (
              <label key={place.id} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="parent"
                  checked={parentId === place.id}
                  onChange={() => setParentId(place.id)}
                />
                {place.name}
                {place.id === node.parentId ? ', current' : ''}
              </label>
            ))}
            {parents.length === 0 && (
              <p className="text-sm text-muted-foreground">No place can hold this.</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !parentId || parentId === node.parentId}>
              Move
            </Button>
          </div>
        </form>
      )}
      {dialog.kind === 'add' && adding && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void addChild();
          }}
        >
          <h2 className="text-base font-semibold text-[#0F2A4A]">
            Add {levelLabel(adding).toLowerCase()}
          </h2>
          <p className="text-sm text-slate-600">under {node.name}</p>
          <label className="flex flex-col gap-1 text-sm">
            Name
            <Input
              aria-label="Name"
              placeholder={`${levelLabel(adding)} name`}
              value={child}
              onChange={(e) => setChild(e.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !child.trim()}>
              Add
            </Button>
          </div>
        </form>
      )}
      {dialog.kind === 'person' && (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold text-[#0F2A4A]">People on {node.name}</h2>
            <p className="text-sm text-slate-500">{levelLabel(node.level)}</p>
          </div>
          <ul className="flex max-h-40 flex-col gap-1 overflow-auto">
            {holders.map((person) => (
              <li key={person.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  <span className="block font-medium text-[#0F2A4A]">{person.name}</span>
                  <span className="block text-xs text-slate-500">
                    {roleText(person.primaryRole)}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void removePerson(person)}
                >
                  Remove
                </Button>
              </li>
            ))}
            {holders.length === 0 && (
              <li className="text-sm text-muted-foreground">Nobody is assigned here.</li>
            )}
          </ul>
          <Input
            aria-label="Find a person"
            placeholder="Find a person"
            value={find}
            onChange={(e) => void searchPeople(e.target.value)}
          />
          {hits.length > 0 && (
            <ul className="rounded-md border">
              {hits.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    disabled={busy}
                    onClick={() => void addPerson(person)}
                  >
                    {person.name}
                    {roleText(person.primaryRole) ? ` · ${roleText(person.primaryRole)}` : ''}
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
      {dialog.kind === 'retire' && (
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-[#0F2A4A]">Retire {node.name}</h2>
          <p className="text-sm text-slate-600">
            This place can be retired only when nothing still uses it.
          </p>
          {dialog.blocked && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{dialog.blocked}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" disabled={busy || !!dialog.blocked} onClick={() => void retire()}>
              Retire
            </Button>
          </div>
        </div>
      )}
      {dialog.kind === 'role' && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void addRole();
          }}
        >
          <h2 className="text-base font-semibold text-[#0F2A4A]">
            {STATE_ROLES.find((item) => item.role === dialog.role)?.label ?? 'Add person'} on{' '}
            {node.name}
          </h2>
          <Input
            aria-label="Name"
            placeholder="Name"
            value={personName}
            onChange={(e) => setPersonName(e.target.value)}
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
            <Button type="submit" disabled={busy || !personName.trim() || !email.trim()}>
              Add
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
