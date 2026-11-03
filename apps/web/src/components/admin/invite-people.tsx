'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { components } from '@ariforce/contracts';
import { assignMessage, territoryQueryFor } from '@/lib/assign-errors';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import { toast } from '@ariforce/ui/components/sonner';
import { InviteLink } from '@/components/invites/invite-links';
import { api, apiReady, toApiError } from '@/lib/api';
import { ROLES, ROLE_LABEL, roleLevel, type Role } from '@/lib/roles';
import type { InviteResult } from '@/lib/team-adapter/types';
import { cn } from '@ariforce/ui/lib/utils';

type User = components['schemas']['UserSummary'];
export type Terr = { id: string; name: string; code: string; level: string };

/** System admin may invite any role (feat/sysadmin-invite-any). Functional roles have no territory or manager. */
export const functional = (r: Role) => roleLevel(r) === 0;
export const topRole = (u: User) =>
  ([...u.roles].sort((a, b) => roleLevel(b as Role) - roleLevel(a as Role))[0] ??
    null) as Role | null;
const absolute = (u: string | null | undefined) =>
  !u ? null : /^https?:\/\//.test(u) ? u : new URL(u, window.location.origin).toString();

async function searchUsers(q: string, extra: Record<string, string> = {}) {
  await apiReady();
  const r = await api.GET('/v1/users', {
    params: { query: { q: q || undefined, limit: 20, ...extra } as never },
  });
  return r.data?.items ?? [];
}

/** Every territory in the company (HQs included, even ones with nobody assigned yet). */
export function useHqs() {
  const [hqs, setHqs] = useState<Terr[] | null>(null);
  useEffect(() => {
    void (async () => {
      await apiReady();
      const out = new Map<string, Terr>();
      // HQs first via the BM-assignable list (HQ only; a filtered list also catches HQs a plain list
      // may page past), then everything else. The level check in the pickers stays as a fallback.
      for (const extra of [territoryQueryFor('business_manager'), {}]) {
        let cursor: string | undefined;
        for (let i = 0; i < 20; i++) {
          const r = await api.GET('/v1/territories', {
            params: { query: { ...extra, limit: 200, cursor, sort: 'name' } as never },
          });
          if (!r.data) break;
          for (const t of r.data.items)
            out.set(t.id, { id: t.id, name: t.name, code: t.code, level: t.level });
          cursor = r.data.nextCursor ?? undefined;
          if (!cursor) break;
        }
      }
      setHqs([...out.values()]);
    })().catch(() => setHqs([]));
  }, []);
  return hqs;
}

export function InvitePeople() {
  const [mode, setMode] = useState<'existing' | 'manual'>('existing');
  const hqs = useHqs();
  const [pendingKey, setPendingKey] = useState(0);
  const refresh = () => setPendingKey((k) => k + 1);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2" role="tablist" aria-label="How to invite">
        <Button
          role="tab"
          aria-selected={mode === 'existing'}
          variant={mode === 'existing' ? 'default' : 'outline'}
          onClick={() => setMode('existing')}
          data-testid="invite-mode-existing"
        >
          Existing employee
        </Button>
        <Button
          role="tab"
          aria-selected={mode === 'manual'}
          variant={mode === 'manual' ? 'default' : 'outline'}
          onClick={() => setMode('manual')}
          data-testid="invite-mode-manual"
        >
          New person
        </Button>
      </div>
      {mode === 'existing' ? (
        <ExistingInvite hqs={hqs} onSent={refresh} />
      ) : (
        <ManualInvite hqs={hqs} onSent={refresh} />
      )}
      <PendingInvites key={pendingKey} hqs={hqs} />
    </div>
  );
}

export function UserSearch({
  label,
  testId,
  onPick,
  filter,
  extra,
}: {
  label: string;
  testId: string;
  onPick: (u: User) => void;
  filter?: (u: User) => boolean;
  extra?: Record<string, string>;
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<User[] | null>(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void searchUsers(q.trim(), extra).then((r) => live && setRows(r));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  const shown = (rows ?? []).filter((u) => !filter || filter(u));
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={testId}>{label}</Label>
      <Input
        id={testId}
        data-testid={testId}
        placeholder="Search by name, code or email"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoComplete="off"
      />
      <ul
        className="max-h-56 divide-y overflow-y-auto rounded-md border"
        data-testid={`${testId}-results`}
      >
        {rows === null ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">Loading…</li>
        ) : shown.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">No one matches.</li>
        ) : (
          shown.map((u) => {
            const r = topRole(u);
            return (
              <li key={u.id}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-baseline justify-between gap-x-3 px-3 py-2 text-left text-sm hover:bg-muted/60"
                  onClick={() => onPick(u)}
                  data-testid={`${testId}-option`}
                >
                  <span className="font-medium">{u.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {[u.employeeCode, r ? ROLE_LABEL[r] : null, u.email]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

function hqName(hqs: Terr[] | null, ids: string[]) {
  const all = ids.map((i) => hqs?.find((h) => h.id === i)).filter((t): t is Terr => !!t);
  const t = all.find((x) => x.level === 'headquarter') ?? all[0];
  return t ? `${t.name} (${t.code})` : ids.length ? 'Loading…' : 'None';
}

function ExistingInvite({ hqs, onSent }: { hqs: Terr[] | null; onSent: () => void }) {
  const [pick, setPick] = useState<User | null>(null);
  const [mgr, setMgr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<InviteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setMgr(null);
    setRes(null);
    setError(null);
    if (!pick?.managerId) return;
    // The directory has no id filter; find the manager by searching the company list.
    void (async () => {
      await apiReady();
      let cursor: string | undefined;
      for (let i = 0; i < 20; i++) {
        const r = await api.GET('/v1/users', {
          params: { query: { limit: 200, cursor } as never },
        });
        const hit = r.data?.items.find((u) => u.id === pick.managerId);
        if (hit) return setMgr(hit.name);
        cursor = r.data?.nextCursor ?? undefined;
        if (!cursor) return setMgr('Not found');
      }
    })().catch(() => {});
  }, [pick]);
  const role = pick ? topRole(pick) : null;
  const joined = !!pick?.hasLogin || pick?.status === 'active' || pick?.status === 'suspended';
  const allowed = !!pick && !joined;
  async function send() {
    if (!pick) return;
    setBusy(true);
    setError(null);
    const r = await api.POST('/v1/employees/{id}/invite', { params: { path: { id: pick.id } } });
    setBusy(false);
    if (r.error || !r.data) {
      const err = toApiError(r);
      return setError(
        err.code === 'CONFLICT'
          ? `${pick.name} has already joined and signs in with their own password. No link is needed.`
          : err.message || 'Could not create the invite.',
      );
    }
    setRes({
      id: pick.id,
      name: pick.name,
      expiresAt: r.data.expiresAt,
      inviteUrl: absolute(r.data.inviteUrl),
    });
    toast.success(`Invite created for ${pick.name}`);
    onSent();
  }
  return (
    <section
      className="grid gap-4 rounded-lg border p-4 md:grid-cols-2"
      data-testid="invite-existing"
    >
      <UserSearch label="Find the employee" testId="employee-search" onPick={setPick} />
      <div className="flex flex-col gap-3">
        {!pick ? (
          <p className="text-sm text-muted-foreground">Pick someone to see their details.</p>
        ) : (
          <>
            <dl
              className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm"
              data-testid="employee-details"
            >
              <dt className="text-muted-foreground">Name</dt>
              <dd data-testid="detail-name">{pick.name}</dd>
              <dt className="text-muted-foreground">Code</dt>
              <dd>{pick.employeeCode ?? 'None'}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="break-all" data-testid="detail-email">
                {pick.email}
              </dd>
              <dt className="text-muted-foreground">Role</dt>
              <dd data-testid="detail-role">{role ? ROLE_LABEL[role] : 'None'}</dd>
              <dt className="text-muted-foreground">HQ</dt>
              <dd data-testid="detail-hq">{hqName(hqs, pick.territoryIds)}</dd>
              <dt className="text-muted-foreground">Reports to</dt>
              <dd data-testid="detail-manager">
                {pick.managerId ? (mgr ?? 'Loading…') : 'Nobody'}
              </dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd data-testid="detail-status">{pick.status}</dd>
            </dl>
            <p className="text-xs text-muted-foreground">
              The link is for {pick.email}. Sending a new link cancels any earlier one.
            </p>
            {joined && (
              <p className="text-sm text-muted-foreground" data-testid="invite-not-allowed">
                {pick.name} has already joined, so there is no link to send.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive" data-testid="invite-error">
                {error}
              </p>
            )}
            {res && <InviteLink r={res} />}
            <div>
              <Button onClick={send} disabled={busy || !allowed} data-testid="invite-existing-send">
                {busy ? 'Creating link…' : 'Send invite link'}
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

type Row = {
  name: string;
  email: string;
  phone: string;
  role: Role;
  hqId: string;
  managerId: string;
  managerName: string;
};
const blank = (): Row => ({
  name: '',
  email: '',
  phone: '',
  role: 'business_manager',
  hqId: '',
  managerId: '',
  managerName: '',
});

function ManualInvite({ hqs, onSent }: { hqs: Terr[] | null; onSent: () => void }) {
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<
    | {
        name: string;
        email: string;
        status: string;
        message: string | null;
        link: InviteResult | null;
      }[]
    | null
  >(null);
  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const ready = rows.every(
    (r) => r.name.trim() && r.email.trim() && (functional(r.role) || r.hqId),
  );
  async function send() {
    setBusy(true);
    const r = await api.POST('/v1/employees/invite-bulk', {
      body: {
        employees: rows.map((x) => ({
          name: x.name.trim(),
          email: x.email.trim(),
          phone: x.phone.trim() || null,
          role: x.role,
          territoryIds: functional(x.role) ? [] : [x.hqId],
          managerId: x.role === 'director' || functional(x.role) ? null : x.managerId || null,
        })),
      } as never,
    });
    setBusy(false);
    if (r.error || !r.data) return toast.error(toApiError(r).message || 'Could not send.');
    const data = r.data as {
      results: {
        index: number;
        status: string;
        message: string | null;
        code?: string | null;
        inviteUrl: string | null;
      }[];
    };
    setResults(
      data.results.map((x) => {
        const row = rows[x.index]!;
        return {
          name: row.name,
          email: row.email,
          status: x.status,
          message: assignMessage({ code: x.code ?? undefined }) ?? x.message,
          link:
            x.status === 'invited'
              ? {
                  id: String(x.index),
                  name: row.name,
                  expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
                  inviteUrl: absolute(x.inviteUrl),
                }
              : null,
        };
      }),
    );
    if (data.results.some((x) => x.status === 'invited')) {
      onSent();
      setRows((rs) =>
        rs.filter((_, i) => data.results.find((x) => x.index === i)?.status !== 'invited'),
      );
    }
  }
  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4" data-testid="invite-manual">
      {rows.map((r, i) => (
        <fieldset
          key={i}
          className="grid gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="manual-row"
        >
          <legend className="px-1 text-xs text-muted-foreground">Person {i + 1}</legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`m-name-${i}`}>Name</Label>
            <Input
              id={`m-name-${i}`}
              data-testid="manual-name"
              value={r.name}
              onChange={(e) => set(i, { name: e.target.value })}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`m-email-${i}`}>Work email</Label>
            <Input
              id={`m-email-${i}`}
              data-testid="manual-email"
              type="email"
              value={r.email}
              onChange={(e) => set(i, { email: e.target.value })}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`m-phone-${i}`}>Phone (optional)</Label>
            <Input
              id={`m-phone-${i}`}
              data-testid="manual-phone"
              type="tel"
              inputMode="tel"
              value={r.phone}
              onChange={(e) => set(i, { phone: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`m-role-${i}`}>Role</Label>
            <Select
              value={r.role}
              onValueChange={(x) =>
                set(i, { role: x as Role, hqId: '', managerId: '', managerName: '' })
              }
            >
              <SelectTrigger id={`m-role-${i}`} className="w-full" data-testid="manual-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...ROLES]
                  .sort((a, b) => roleLevel(b) - roleLevel(a))
                  .map((x) => (
                    <SelectItem key={x} value={x}>
                      {ROLE_LABEL[x]}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {functional(r.role) ? (
            <p
              className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-1"
              data-testid="manual-functional"
            >
              {ROLE_LABEL[r.role]} works company-wide: no HQ and no manager.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`m-hq-${i}`}>
                  {r.role === 'business_manager' ? 'HQ' : 'Territory'}
                </Label>
                <Select value={r.hqId} onValueChange={(x) => set(i, { hqId: x })}>
                  <SelectTrigger id={`m-hq-${i}`} className="w-full" data-testid="manual-hq">
                    <SelectValue
                      placeholder={
                        hqs === null
                          ? 'Loading…'
                          : r.role === 'business_manager'
                            ? 'Pick an HQ'
                            : 'Pick a territory'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {hqs?.length === 0 && (
                      <p className="px-2 py-1.5 text-sm text-muted-foreground">
                        No territories yet.
                      </p>
                    )}
                    {hqs
                      ?.filter(
                        (h) =>
                          h.level !== 'territory' &&
                          (r.role !== 'business_manager' || h.level === 'headquarter'),
                      )
                      .map((h) => (
                        <SelectItem key={h.id} value={h.id}>
                          {h.name} ({h.code})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Reports to</span>
                {r.role === 'director' ? (
                  <span className="text-sm text-muted-foreground">A director has no manager.</span>
                ) : r.managerId ? (
                  <span
                    className="flex items-center gap-2 text-sm"
                    data-testid="manual-manager-picked"
                  >
                    {r.managerName}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => set(i, { managerId: '', managerName: '' })}
                    >
                      Change
                    </Button>
                  </span>
                ) : (
                  <ManagerPick
                    role={r.role}
                    onPick={(u) => set(i, { managerId: u.id, managerName: u.name })}
                  />
                )}
                {r.role !== 'director' && (
                  <span className="text-xs text-muted-foreground">
                    The manager will also see this person’s territory.
                  </span>
                )}
              </div>
            </>
          )}
          {rows.length > 1 && (
            <div className="sm:col-span-2 lg:col-span-3">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden /> Remove
              </Button>
            </div>
          )}
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setRows((rs) => [...rs, blank()])}
          data-testid="manual-add-row"
          disabled={rows.length >= 50}
        >
          <Plus aria-hidden /> Add several
        </Button>
        <Button onClick={send} disabled={busy || !ready} data-testid="manual-send">
          {busy
            ? 'Sending…'
            : rows.length === 1
              ? 'Add and send invite'
              : `Add ${rows.length} and send invites`}
        </Button>
      </div>
      {results && (
        <ul className="flex flex-col gap-3" data-testid="manual-results">
          {results.map((x, i) => (
            <li
              key={i}
              className="flex flex-col gap-1.5 rounded-md border p-3"
              data-testid="manual-result"
              data-status={x.status}
            >
              <p className="text-sm">
                <span className="font-medium">{x.name}</span>{' '}
                <span className="text-muted-foreground">{x.email}</span>{' '}
                <span
                  className={cn(
                    'rounded px-1.5 text-xs font-medium',
                    x.status === 'invited'
                      ? 'bg-success/10 text-success'
                      : 'bg-destructive/10 text-destructive',
                  )}
                >
                  {x.status === 'invited'
                    ? 'Invited'
                    : x.status === 'skipped'
                      ? 'Skipped'
                      : 'Failed'}
                </span>
              </p>
              {x.message && <p className="text-sm text-destructive">{x.message}</p>}
              {x.link && <InviteLink r={x.link} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ManagerPick({ role, onPick }: { role: Role; onPick: (u: User) => void }) {
  const above = useCallback(
    (u: User) =>
      u.status !== 'suspended' && u.roles.some((r) => roleLevel(r as Role) > roleLevel(role)),
    [role],
  );
  return (
    <div className="flex flex-col gap-1">
      <UserSearch
        label="Search a manager (optional)"
        testId="manager-search"
        onPick={onPick}
        filter={above}
      />
    </div>
  );
}

function PendingInvites({ hqs }: { hqs: Terr[] | null }) {
  const [rows, setRows] = useState<User[] | null>(null);
  const [links, setLinks] = useState(new Map<string, InviteResult>());
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    await apiReady();
    const r = await api.GET('/v1/users', {
      params: { query: { status: 'invited', limit: 200 } as never },
    });
    setRows(r.data?.items ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function resend(u: User) {
    const r = await api.POST('/v1/employees/{id}/invite', { params: { path: { id: u.id } } });
    if (r.error || !r.data) {
      toast.error(`${u.name}: ${toApiError(r).message || 'Could not create the invite.'}`);
      return false;
    }
    const d = r.data;
    setLinks((m) =>
      new Map(m).set(u.id, {
        id: u.id,
        name: u.name,
        expiresAt: d.expiresAt,
        inviteUrl: absolute(d.inviteUrl),
      }),
    );
    return true;
  }
  const invitableRows = useMemo(() => (rows ?? []).filter((u) => !u.hasLogin), [rows]);
  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="pending-h"
      data-testid="pending-invites"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pending-h" className="text-base font-semibold">
          Waiting to join {rows ? `(${rows.length})` : ''}
        </h2>
        {invitableRows.length > 1 && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            data-testid="invite-all-pending"
            onClick={async () => {
              setBusy('all');
              let ok = 0;
              for (const u of invitableRows) if (await resend(u)) ok += 1;
              setBusy(null);
              toast.success(`${ok} new ${ok === 1 ? 'link' : 'links'} created`);
            }}
          >
            Invite all pending
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        People invited but not signed in yet. A new link cancels the old one. Links can’t be
        cancelled on their own yet.
      </p>
      {rows === null ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
      ) : rows.length === 0 ? (
        <p
          className="rounded-lg border p-4 text-sm text-muted-foreground"
          data-testid="pending-empty"
        >
          Nobody is waiting to join.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((u) => {
            const r = topRole(u);
            const link = links.get(u.id);
            return (
              <li key={u.id} className="flex flex-col gap-2 px-3 py-2.5" data-testid="pending-row">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {u.name}
                      {u.inviteStatus === 'expired' && (
                        <span
                          className="ml-2 rounded bg-warning/10 px-1.5 text-xs font-medium text-warning"
                          data-testid="pending-expired"
                        >
                          Link expired
                        </span>
                      )}
                    </p>
                    <p className="break-all text-xs text-muted-foreground">
                      {[u.email, r ? ROLE_LABEL[r] : null, hqName(hqs, u.territoryIds)]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  {!u.hasLogin && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      data-testid="pending-resend"
                      onClick={async () => {
                        setBusy(u.id);
                        await resend(u);
                        setBusy(null);
                      }}
                    >
                      Send new link
                    </Button>
                  )}
                </div>
                {link && <InviteLink r={link} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
