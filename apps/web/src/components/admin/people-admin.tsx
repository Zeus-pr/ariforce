'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@ariforce/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ariforce/ui/components/dialog';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@ariforce/ui/components/sheet';
import { toast } from '@ariforce/ui/components/sonner';
import { cn } from '@ariforce/ui/lib/utils';
import {
  UserSearch,
  functional,
  topRole,
  useHqs,
  type Terr,
} from '@/components/admin/invite-people';
import { useSession } from '@/lib/mock-auth';
import {
  failure,
  getPerson,
  listPeople,
  updatePerson,
  type Failure,
  type PeopleQuery,
  type Person,
  type PersonPatch,
} from '@/lib/people/adapter';
import { ROLES, ROLE_LABEL, roleLevel, type Role } from '@/lib/roles';

const ALL = '__all';
const STATUS_LABEL: Record<Person['status'], string> = {
  active: 'Active',
  invited: 'Invited',
  suspended: 'Suspended',
  pending: 'Pending',
  rejected: 'Rejected',
};
const loginLabel = (p: Person) =>
  p.hasLogin
    ? 'Signed in'
    : p.inviteStatus === 'pending'
      ? 'Invite sent'
      : p.inviteStatus === 'expired'
        ? 'Invite expired'
        : p.inviteStatus === 'none'
          ? 'Not invited'
          : '—';
const rolesByRank = [...ROLES].sort((a, b) => roleLevel(b) - roleLevel(a));
/** Territories come on each item, primary first. */
const hqOf = (p: Person) =>
  (p.territories ?? []).find((t) => t.level === 'headquarter') ?? (p.territories ?? [])[0] ?? null;

function Chip({
  children,
  tone = 'muted',
  testId,
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'good' | 'warn' | 'bad';
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      className={cn(
        'inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium',
        tone === 'good' && 'bg-success/10 text-success',
        tone === 'warn' && 'bg-warning/10 text-warning',
        tone === 'bad' && 'bg-destructive/10 text-destructive',
        tone === 'muted' && 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}
const statusTone = (s: Person['status']) =>
  s === 'active' ? 'good' : s === 'suspended' || s === 'rejected' ? 'bad' : 'warn';

export function PeopleAdmin() {
  const sp = useSearchParams();
  const pageSize = Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 200);
  const terrs = useHqs();
  const hqs = useMemo(() => (terrs ?? []).filter((t) => t.level === 'headquarter'), [terrs]);
  const me = useSession()?.user;
  const isMe = (p: Person) =>
    !!me && (p.id === me.id || p.email.toLowerCase() === me.email.toLowerCase());
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [role, setRole] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [hq, setHq] = useState(ALL);
  const [login, setLogin] = useState(ALL);
  const [rows, setRows] = useState<Person[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Person | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const query = useMemo<PeopleQuery>(() => {
    const x: PeopleQuery = { q: debounced, limit: pageSize };
    if (role !== ALL) x.role = role as Role;
    if (status !== ALL) x.status = status as Person['status'];
    if (hq !== ALL) x.territoryId = hq;
    if (login === 'yes') x.hasLogin = 'true';
    if (login === 'no') x.hasLogin = 'false';
    return x;
  }, [debounced, role, status, hq, login, pageSize]);

  const load = useCallback(
    async (more: boolean) => {
      const my = ++seq.current;
      setBusy(true);
      setErr(null);
      try {
        const r = await listPeople({ ...query, cursor: more ? (cursor ?? undefined) : undefined });
        if (my !== seq.current) return;
        setRows((old) => (more && old ? [...old, ...r.items] : r.items));
        setCursor(r.nextCursor);
      } catch (e) {
        if (my === seq.current) setErr((e as Failure).message ?? 'Could not load people.');
      } finally {
        if (my === seq.current) setBusy(false);
      }
    },
    [query, cursor],
  );
  useEffect(() => {
    void load(false);
    // Reload from the first page whenever the filters change.
  }, [query]);

  const replaceRow = (p: Person) => setRows((rs) => rs?.map((x) => (x.id === p.id ? p : x)) ?? rs);

  const filter = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    items: [string, string][],
  ) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={set}>
        <SelectTrigger id={id} className="w-full" data-testid={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="people-q">Search</Label>
          <Input
            id="people-q"
            data-testid="people-q"
            placeholder="Name, code or email"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
          />
        </div>
        {filter('people-f-role', 'Role', role, setRole, [
          [ALL, 'All roles'],
          ...rolesByRank.map((r) => [r, ROLE_LABEL[r]] as [string, string]),
        ])}
        {filter('people-f-status', 'Status', status, setStatus, [
          [ALL, 'Any status'],
          ...(['active', 'invited', 'suspended'] as const).map(
            (s) => [s, STATUS_LABEL[s]] as [string, string],
          ),
        ])}
        {filter('people-f-hq', 'HQ', hq, setHq, [
          [ALL, 'All HQs'],
          ...hqs.map((h) => [h.id, h.name] as [string, string]),
        ])}
        {filter('people-f-login', 'Sign-in', login, setLogin, [
          [ALL, 'Anyone'],
          ['yes', 'Signed in'],
          ['no', 'Not signed in yet'],
        ])}
      </div>

      {err && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          data-testid="people-error"
        >
          {err}
        </p>
      )}

      {rows === null ? (
        <div className="h-48 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
      ) : rows.length === 0 ? (
        <p
          className="rounded-lg border p-6 text-center text-sm text-muted-foreground"
          data-testid="people-empty"
        >
          No one matches these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">HQ</th>
                <th className="px-3 py-2 font-medium">Manager</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Sign-in</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((p) => {
                const r = topRole(p);
                const h = hqOf(p);
                return (
                  <tr
                    key={p.id}
                    className="cursor-pointer hover:bg-muted/40 focus-within:bg-muted/40"
                    data-testid="people-row"
                    data-id={p.id}
                    onClick={() => setOpen(p)}
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-left font-medium hover:underline"
                        data-testid="people-open"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(p);
                        }}
                      >
                        {p.name}
                      </button>
                      {isMe(p) && (
                        <span
                          className="ml-2 text-xs text-muted-foreground"
                          data-testid="people-you"
                        >
                          You
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground" data-testid="people-code">
                      {p.employeeCode ?? '—'}
                    </td>
                    <td
                      className="max-w-[16rem] truncate px-3 py-2 text-muted-foreground"
                      title={p.email}
                    >
                      {p.email}
                    </td>
                    <td className="px-3 py-2" data-testid="people-role">
                      {r ? ROLE_LABEL[r] : '—'}
                    </td>
                    <td className="px-3 py-2" data-testid="people-hq">
                      {h ? h.name : '—'}
                    </td>
                    <td className="px-3 py-2" data-testid="people-manager">
                      {p.managerName ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <Chip tone={statusTone(p.status)} testId="people-status">
                        {STATUS_LABEL[p.status]}
                      </Chip>
                    </td>
                    <td className="px-3 py-2">
                      <Chip testId="people-login">{loginLabel(p)}</Chip>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span data-testid="people-count">{rows ? `${rows.length} shown` : ''}</span>
        {cursor && (
          <Button
            variant="outline"
            onClick={() => void load(true)}
            disabled={busy}
            data-testid="people-more"
          >
            {busy ? 'Loading…' : 'Show more'}
          </Button>
        )}
      </div>

      <PersonSheet
        person={open}
        terrs={terrs}
        self={!!open && isMe(open)}
        onClose={() => setOpen(null)}
        onSaved={(p) => {
          replaceRow(p);
        }}
        onGone={() => {
          setOpen(null);
          void load(false);
        }}
      />
    </div>
  );
}

type Form = {
  name: string;
  email: string;
  phone: string;
  employeeCode: string;
  designation: string;
  joinedOn: string;
  role: Role;
  territoryId: string;
  managerId: string | null;
  status: Person['status'];
};
const toForm = (p: Person): Form => ({
  name: p.name,
  email: p.email,
  phone: p.phone ?? '',
  employeeCode: p.employeeCode ?? '',
  designation: p.designation ?? '',
  joinedOn: p.joinedOn ?? '',
  role: (topRole(p) ?? 'business_manager') as Role,
  territoryId: hqOf(p)?.id ?? p.territoryIds[0] ?? '',
  managerId: p.managerId,
  status: p.status,
});

function TerritoryPick({
  terrs,
  value,
  onChange,
  hqOnly,
}: {
  terrs: Terr[] | null;
  value: string;
  onChange: (id: string) => void;
  hqOnly: boolean;
}) {
  const [q, setQ] = useState('');
  const pool = (terrs ?? []).filter((t) =>
    // A level 'territory' row groups doctors/chemists and is never assigned to people.
    hqOnly ? t.level === 'headquarter' : t.level !== 'headquarter' && t.level !== 'territory',
  );
  const shown = pool
    .filter((t) => !q || `${t.name} ${t.code}`.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 100);
  const cur = terrs?.find((t) => t.id === value);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{hqOnly ? 'HQ' : 'Area or region'}</span>
      <p className="text-sm" data-testid="edit-hq-current">
        {cur ? `${cur.name} (${cur.code})` : 'None picked'}
      </p>
      <Input
        aria-label={hqOnly ? 'Search HQs' : 'Search areas and regions'}
        placeholder={hqOnly ? 'Search HQs' : 'Search areas and regions'}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        data-testid="edit-hq-search"
        autoComplete="off"
      />
      <ul
        className="max-h-44 divide-y overflow-y-auto rounded-md border"
        data-testid="edit-hq-options"
      >
        {terrs === null ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">Loading…</li>
        ) : shown.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">No match.</li>
        ) : (
          shown.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={cn(
                  'flex w-full justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/60',
                  t.id === value && 'bg-muted font-medium',
                )}
                onClick={() => onChange(t.id)}
                data-testid="edit-hq-option"
              >
                <span>{t.name}</span>
                <span className="text-xs text-muted-foreground">
                  {hqOnly ? t.code : `${t.level} · ${t.code}`}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function PersonSheet({
  person,
  terrs,
  self,
  onClose,
  onSaved,
  onGone,
}: {
  person: Person | null;
  terrs: Terr[] | null;
  self: boolean;
  onClose: () => void;
  onSaved: (p: Person) => void;
  onGone: () => void;
}) {
  const [base, setBase] = useState<Person | null>(person);
  const [f, setF] = useState<Form | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [mgrName, setMgrName] = useState<string | null>(null);
  const [reportNames, setReportNames] = useState<Record<string, string>>({});

  useEffect(() => {
    setBase(person);
    setF(person ? toForm(person) : null);
    setError(null);
    setMgrName(null);
    // Only when a different person opens.
  }, [person?.id]);

  if (!person || !f || !base) return <Sheet open={false} />;
  const set = (patch: Partial<Form>) => setF((x) => (x ? { ...x, ...patch } : x));
  const orig = toForm(base);
  const isFunctional = functional(f.role);
  const needsManager = !isFunctional && f.role !== 'director';
  const managerLabel = f.managerId
    ? mgrName && f.managerId !== base.managerId
      ? mgrName
      : ((f.managerId === base.managerId ? base.managerName : mgrName) ?? '…')
    : 'Nobody';

  function buildPatch(): PersonPatch | null {
    if (!f || !base) return null;
    const p: PersonPatch = { version: base.version ?? 0 };
    const t = (s: string) => s.trim();
    if (t(f.name) !== orig.name) p.name = t(f.name);
    if (!base.hasLogin && t(f.email) !== orig.email) p.email = t(f.email);
    if (t(f.phone) !== orig.phone) p.phone = t(f.phone) || null;
    if (t(f.employeeCode) !== orig.employeeCode) p.employeeCode = t(f.employeeCode) || null;
    if (t(f.designation) !== orig.designation) p.designation = t(f.designation) || null;
    if (f.joinedOn !== orig.joinedOn) p.joinedOn = f.joinedOn || null;
    if (f.role !== orig.role) p.role = f.role;
    if (isFunctional) {
      if (base.territoryIds.length) p.territoryIds = [];
      if (base.managerId) p.managerId = null;
    } else {
      if (f.territoryId !== orig.territoryId || p.role)
        p.territoryIds = f.territoryId ? [f.territoryId] : [];
      const m = f.role === 'director' ? null : f.managerId;
      if (m !== base.managerId) p.managerId = m;
    }
    if (f.status !== orig.status && (f.status === 'active' || f.status === 'suspended'))
      p.status = f.status;
    return p;
  }

  function risks(p: PersonPatch) {
    if (!base) return [];
    const out: string[] = [];
    const was = topRole(base);
    if (p.role)
      out.push(
        `Change role from ${was ? ROLE_LABEL[was] : 'none'} to ${ROLE_LABEL[p.role]}. Their access changes and they are signed out on every device.`,
      );
    if (p.status === 'suspended')
      out.push(
        `Suspend ${base.name}. They are signed out on every device and can’t sign in until reactivated.`,
      );
    if (p.status === 'active' && base.status === 'suspended')
      out.push(`Reactivate ${base.name}. They can sign in again.`);
    if (p.territoryIds && !isFunctional && f && f.territoryId !== orig.territoryId)
      out.push(
        'Move them to a different HQ or area. Who can see their work changes with it, from their next action in the app.',
      );
    if (p.managerId !== undefined && !isFunctional && p.managerId)
      out.push(
        'Change their manager. The new manager sees their territory, and their requests waiting for first approval move to the new manager.',
      );
    return out;
  }

  async function save(p: PersonPatch) {
    if (!base) return;
    setSaving(true);
    setError(null);
    try {
      await updatePerson(base.id, p);
      const fresh = await getPerson({ id: base.id, email: p.email ?? base.email });
      toast.success(`Saved ${p.name ?? base.name}`);
      if (fresh) onSaved(fresh);
      onClose();
    } catch (e) {
      const fail = (e as Failure).kind ? (e as Failure) : failure(e);
      setError(fail);
      if (fail.userIds?.length) {
        // Name the direct reports to move first (they report to this person).
        const r = await listPeople({ managerId: base.id, limit: 200 }).catch(() => null);
        setReportNames(Object.fromEntries((r?.items ?? []).map((x) => [x.id, x.name])));
      }
      if (fail.kind === 'conflict') {
        const fresh = await getPerson(base).catch(() => null);
        if (fresh) {
          setBase(fresh);
          setF(toForm(fresh));
          onSaved(fresh);
        }
      } else if (fail.kind === 'missing') {
        toast.error(fail.message);
        onGone();
      }
    } finally {
      setSaving(false);
      setConfirm(null);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const p = buildPatch();
    if (!p) return;
    if (Object.keys(p).length === 1) {
      toast.message('Nothing to save.');
      return;
    }
    if (!f?.name.trim())
      return setError({ code: 'LOCAL', kind: 'invalid', message: 'Name can’t be empty.' });
    if (!isFunctional && !f.territoryId)
      return setError({
        code: 'LOCAL',
        kind: 'invalid',
        message: f.role === 'business_manager' ? 'Pick an HQ.' : 'Pick an area or region.',
      });
    const r = risks(p);
    if (r.length) setConfirm(r);
    else void save(p);
  }

  const statusEditable = base.status === 'active' || base.status === 'suspended';

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent
          className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg"
          data-testid="person-sheet"
        >
          <SheetHeader>
            <SheetTitle>{base.name}</SheetTitle>
            <SheetDescription>
              {base.email}. Changes save for everyone straight away.
            </SheetDescription>
          </SheetHeader>
          <form className="flex flex-col gap-4 px-4 pb-4" onSubmit={onSubmit} noValidate>
            {error && (
              <p
                role="alert"
                className={cn(
                  'rounded-md border p-3 text-sm',
                  error.kind === 'conflict'
                    ? 'border-warning/40 bg-warning/5 text-foreground'
                    : 'border-destructive/30 bg-destructive/5 text-destructive',
                )}
                data-testid="edit-error"
                data-kind={error.kind}
              >
                {error.message}
                {error.userIds?.length ? (
                  <span className="mt-1 block" data-testid="edit-error-reports">
                    {error.userIds.map((id) => reportNames[id] ?? 'Unknown person').join(', ')}
                  </span>
                ) : null}
              </p>
            )}
            {self && (
              <p
                className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground"
                data-testid="edit-self"
              >
                This is you. Another System Admin has to change your own record.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  data-testid="edit-name"
                  value={f.name}
                  onChange={(e) => set({ name: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="edit-email">Email</Label>
                {base.hasLogin ? (
                  <p className="text-sm" data-testid="edit-email-readonly">
                    {base.email}
                    <span className="block text-xs text-muted-foreground">
                      They already sign in with this email, so it can’t be changed.
                    </span>
                  </p>
                ) : (
                  <>
                    <Input
                      id="edit-email"
                      data-testid="edit-email"
                      type="email"
                      value={f.email}
                      onChange={(e) => set({ email: e.target.value })}
                    />
                    <span className="text-xs text-muted-foreground">
                      A waiting invite is cancelled and sent again to the new email.
                    </span>
                  </>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-phone">Phone</Label>
                <Input
                  id="edit-phone"
                  data-testid="edit-phone"
                  type="tel"
                  inputMode="tel"
                  value={f.phone}
                  onChange={(e) => set({ phone: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-code">Employee code</Label>
                <Input
                  id="edit-code"
                  data-testid="edit-code"
                  value={f.employeeCode}
                  onChange={(e) => set({ employeeCode: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-designation">Designation</Label>
                <Input
                  id="edit-designation"
                  data-testid="edit-designation"
                  value={f.designation}
                  onChange={(e) => set({ designation: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-joined">Joined on</Label>
                <Input
                  id="edit-joined"
                  data-testid="edit-joined"
                  type="date"
                  value={f.joinedOn}
                  onChange={(e) => set({ joinedOn: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-role">Role</Label>
                <Select
                  value={f.role}
                  onValueChange={(v) =>
                    set({
                      role: v as Role,
                      territoryId:
                        (v === 'business_manager') === (orig.role === 'business_manager')
                          ? f.territoryId
                          : '',
                      managerId: v === 'director' || functional(v as Role) ? null : f.managerId,
                    })
                  }
                >
                  <SelectTrigger id="edit-role" className="w-full" data-testid="edit-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {rolesByRank.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-status">Status</Label>
                {statusEditable ? (
                  <Select
                    value={f.status}
                    onValueChange={(v) => set({ status: v as Person['status'] })}
                  >
                    <SelectTrigger id="edit-status" className="w-full" data-testid="edit-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="edit-status-readonly">
                    {STATUS_LABEL[base.status]}. Becomes active when they accept their invite.
                  </p>
                )}
              </div>
            </div>

            {isFunctional ? (
              <p className="text-sm text-muted-foreground" data-testid="edit-functional">
                {ROLE_LABEL[f.role]} works company-wide: no HQ and no manager.
              </p>
            ) : (
              <>
                <TerritoryPick
                  terrs={terrs}
                  value={f.territoryId}
                  onChange={(id) => set({ territoryId: id })}
                  hqOnly={f.role === 'business_manager'}
                />
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Reports to</span>
                  {needsManager ? (
                    <>
                      <p
                        className="flex items-center gap-2 text-sm"
                        data-testid="edit-manager-current"
                      >
                        {managerLabel}
                        {f.managerId && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => set({ managerId: null })}
                            data-testid="edit-manager-clear"
                          >
                            Remove
                          </Button>
                        )}
                      </p>
                      <UserSearch
                        key={f.role}
                        label="Pick a manager"
                        testId="edit-manager-search"
                        filter={(u) =>
                          u.id !== base.id &&
                          u.status !== 'suspended' &&
                          u.roles.some((r) => roleLevel(r as Role) > roleLevel(f.role))
                        }
                        onPick={(u) => {
                          set({ managerId: u.id });
                          setMgrName(u.name);
                        }}
                      />
                      <span
                        className="text-xs text-muted-foreground"
                        data-testid="edit-manager-hint"
                      >
                        Only people above {ROLE_LABEL[f.role]} are listed. The manager will also see
                        this person’s territory.
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      A director has no manager.
                    </span>
                  )}
                </div>
              </>
            )}
            <SheetFooter className="flex-row justify-end gap-2 px-0">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || self} data-testid="edit-save">
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent data-testid="edit-confirm">
          <DialogHeader>
            <DialogTitle>Confirm these changes</DialogTitle>
            <DialogDescription>These change what {base.name} can do or see.</DialogDescription>
          </DialogHeader>
          <ul
            className="flex list-disc flex-col gap-1.5 pl-5 text-sm"
            data-testid="edit-confirm-list"
          >
            {confirm?.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirm(null)}
              data-testid="edit-confirm-cancel"
            >
              Go back
            </Button>
            <Button
              variant={confirm?.some((c) => c.startsWith('Suspend')) ? 'destructive' : 'default'}
              disabled={saving}
              onClick={() => {
                const p = buildPatch();
                if (p) void save(p);
              }}
              data-testid="edit-confirm-ok"
            >
              {saving ? 'Saving…' : 'Yes, save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
