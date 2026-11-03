'use client';

import { ChevronsDownUp, ChevronsUpDown, Search, Send, UserPlus, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@ariforce/ui/components/card';
import { Input } from '@ariforce/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import { toast } from '@ariforce/ui/components/sonner';
import { useRole } from '@/components/shell/role-context';
import { ROLE_SHORT } from '@/lib/roles';
import { REAL, api, apiReady } from '@/lib/api';
import { apiTeamAdapter } from '@/lib/team-adapter/adapter';
import type { Employee, Hq, OrgTree } from '@/lib/team-adapter/types';
import { EmployeeSheet, type SheetState } from './employee-sheet';
import { OrgTree as Tree } from './org-tree';
import { InviteAll } from '@/components/invites/invite-links';
import { BulkInvite } from '@/components/invites/bulk-invite';

export function MyTeamView() {
  const { role } = useRole();
  const [tree, setTree] = useState<OrgTree | null>(null);
  const [unassigned, setUnassigned] = useState<Employee[]>([]);
  const [hqs, setHqs] = useState<Hq[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  // ?q= from the search palette prefills the box.
  const [q, setQ] = useState('');
  useEffect(() => {
    const v = new URLSearchParams(location.search).get('q');
    if (v) setQ(v);
  }, []);
  // Real mode: search is server-side (GET /v1/users?q=, scoped to the caller), debounced, stale calls cancelled.
  const [matchIds, setMatchIds] = useState<Set<string> | null>(null);
  /** The user search returns at most 100 matches. */
  const [matchCapped, setMatchCapped] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (!REAL || !term) {
      setMatchIds(null);
      setMatchCapped(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      await apiReady();
      const r = await api
        .GET('/v1/users', { params: { query: { q: term, limit: 100 } }, signal: ctrl.signal })
        .catch(() => null);
      if (ctrl.signal.aborted) return;
      setMatchIds(new Set((r?.data?.items ?? []).map((u) => u.id)));
      setMatchCapped((r?.data?.items.length ?? 0) >= 100);
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [inviteAll, setInviteAll] = useState(false);
  const [bulk, setBulk] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, u, h] = await Promise.all([
        apiTeamAdapter.tree(role),
        apiTeamAdapter.unassigned(role),
        apiTeamAdapter.hqs(role),
      ]);
      setTree(t);
      setUnassigned(u.items);
      setHqs(h);
      setError(null);
      // First load (or a different signed-in role): open the caller and their direct reports.
      setExpanded((prev) => (prev?.has(t.rootId) ? prev : new Set([t.rootId])));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your team.');
    }
  }, [role]);
  useEffect(() => {
    void load();
  }, [load]);

  const hqMap = useMemo(() => new Map(apiTeamAdapter.allHqs().map((h) => [h.id, h])), [tree]);
  const pending = useMemo(
    () => (tree ? tree.nodes.filter((e) => e.id !== tree.rootId && e.invited && e.active) : []),
    [tree],
  );
  const below = useMemo(() => (tree ? tree.nodes.filter((e) => e.id !== tree.rootId) : []), [tree]);
  const managers = useMemo(
    () => (tree ? tree.nodes.filter((e) => e.role !== 'business_manager' && e.active) : []),
    [tree],
  );
  const summary = useMemo(() => {
    const by = (key: (h: Hq) => string) => {
      const m = new Map<string, number>();
      for (const e of below) {
        const h = e.hqId ? hqMap.get(e.hqId) : undefined;
        const k = h ? key(h) : 'No HQ';
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    };
    return { hq: by((h) => h.name), city: by((h) => h.city), state: by((h) => h.state) };
  }, [below, hqMap]);

  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!tree || !expanded) return <div className="h-96" aria-busy="true" />;

  const withKids = new Set(tree.nodes.map((e) => e.managerId).filter((x): x is string => !!x));
  const query = q.trim().toLowerCase();
  const done = (msg: string) => {
    toast.success(msg);
    setSheet(null);
    void load();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-testid="team-count">
          {below.length} {below.length === 1 ? 'person' : 'people'} in your team ·{' '}
          {below.filter((e) => e.active).length} active
        </p>
        <div className="flex flex-wrap gap-2">
          {pending.length > 0 && (
            <Button variant="outline" onClick={() => setInviteAll(true)} data-testid="invite-all">
              <Send /> Invite all pending ({pending.length})
            </Button>
          )}
          {apiTeamAdapter.creatableRoles(role).length > 0 && (
            <Button variant="outline" onClick={() => setBulk(true)} data-testid="add-several">
              <Users /> Add several
            </Button>
          )}
          <Button onClick={() => setSheet({ mode: 'add' })} data-testid="add-employee">
            <UserPlus /> Add employee
          </Button>
        </div>
      </div>

      <Card className="gap-0 py-0 shadow-xs" data-testid="location-summary">
        <CardHeader className="px-4 pt-4 pb-2">
          <CardTitle className="text-sm">Where your team is</CardTitle>
        </CardHeader>
        <div className="flex flex-col gap-2 px-4 pb-4 text-sm">
          {(['state', 'city', 'hq'] as const).map((k) => (
            <div key={k} className="flex flex-wrap items-center gap-1.5">
              <span className="w-12 text-xs text-muted-foreground">
                {k === 'hq' ? 'HQ' : k === 'city' ? 'City' : 'State'}
              </span>
              {summary[k].map(([name, n]) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setQ(name)}
                  className="rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:bg-muted"
                  data-testid={`loc-${k}`}
                >
                  {name} <span className="text-muted-foreground tabular-nums">{n}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </Card>

      <Card className="min-w-0 gap-0 py-0 shadow-xs">
        <CardHeader className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Hierarchy</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={REAL ? 'Search name or code' : 'Search name, code, HQ, city'}
                aria-label="Search your team"
                className="pl-8"
                data-testid="team-search"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded(new Set(withKids))}
              data-testid="expand-all"
            >
              <ChevronsUpDown /> Expand all
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded(new Set())}
              data-testid="collapse-all"
            >
              <ChevronsDownUp /> Collapse all
            </Button>
          </div>
        </CardHeader>
        <div className="p-2">
          {matchCapped && (
            <p className="px-2 pb-2 text-xs text-muted-foreground" data-testid="limit-notice">
              Showing the first 100 matches. Narrow the search to see others.
            </p>
          )}
          <Tree
            rootId={tree.rootId}
            nodes={tree.nodes}
            hqs={hqMap}
            expanded={expanded}
            setExpanded={setExpanded}
            query={query}
            matchIds={matchIds}
            onOpen={(e) => setSheet({ mode: 'edit', employee: e })}
          />
        </div>
      </Card>

      <Card className="gap-0 py-0 shadow-xs" data-testid="unassigned">
        <CardHeader className="border-b px-4 py-4">
          <CardTitle className="flex items-center gap-2 text-base">
            Unassigned <Badge variant="secondary">{unassigned.length}</Badge>
          </CardTitle>
          <CardDescription>
            People with no reporting manager yet. Assign them to someone in your team.
          </CardDescription>
        </CardHeader>
        <ul className="divide-y">
          {unassigned.map((e) => (
            <li
              key={e.id}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center"
              data-testid="unassigned-row"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {e.name}{' '}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {ROLE_SHORT[e.role]} · {e.employeeCode} ·{' '}
                    {e.hqId ? hqMap.get(e.hqId)?.name : 'No HQ'}
                  </span>
                </p>
              </div>
              <Assign employee={e} managers={managers} onDone={done} />
            </li>
          ))}
          {!unassigned.length && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              Everyone has a reporting manager.
            </li>
          )}
        </ul>
      </Card>

      {bulk && (
        <BulkInvite
          role={role}
          managerId={tree.rootId}
          hqs={hqs}
          onClose={(changed) => {
            setBulk(false);
            if (changed) void load();
          }}
        />
      )}
      {inviteAll && <InviteAll role={role} people={pending} onClose={() => setInviteAll(false)} />}
      <EmployeeSheet
        state={sheet}
        onClose={() => setSheet(null)}
        onDone={done}
        role={role}
        rootId={tree.rootId}
        managers={managers}
        hqs={hqs}
      />
    </div>
  );
}

function Assign({
  employee,
  managers,
  onDone,
}: {
  employee: Employee;
  managers: Employee[];
  onDone: (m: string) => void;
}) {
  const { role } = useRole();
  const options = managers.filter(
    (m) => m.role !== employee.role && (ROLE_RANK[m.role] ?? 0) > (ROLE_RANK[employee.role] ?? 0),
  );
  return (
    <Select
      onValueChange={async (id) => {
        try {
          await apiTeamAdapter.update(role, employee.id, { managerId: id });
          onDone(`${employee.name} now reports to ${managers.find((m) => m.id === id)?.name}.`);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Could not assign.');
        }
      }}
    >
      <SelectTrigger
        className="w-full sm:w-64"
        aria-label={`Assign ${employee.name} to a manager`}
        data-testid="assign"
      >
        <SelectValue placeholder="Assign to…" />
      </SelectTrigger>
      <SelectContent>
        {options.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name} ({ROLE_SHORT[m.role]})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const ROLE_RANK: Record<string, number> = {
  business_manager: 1,
  area_business_manager: 2,
  regional_business_manager: 3,
  zonal_business_manager: 4,
  sales_manager: 5,
  general_manager: 6,
  vice_president: 7,
  director: 8,
};
