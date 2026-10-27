'use client';

import Link from 'next/link';
import { ArrowLeft, Download, LoaderCircle, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  EXCEPTION_RULES,
  type KpiKey,
  type TeamPerformance,
  type TeamProfile,
} from '@ariforce/contracts';
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@ariforce/ui/components/card';
import { Input } from '@ariforce/ui/components/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ariforce/ui/components/table';
import { Tabs, TabsList, TabsTrigger } from '@ariforce/ui/components/tabs';
import { formatKpi, KPI_META } from '@/components/dashboard/kpi-meta';
import { API_URL, api, apiReady, toApiError } from '@/lib/api';
import { roleLabel } from '@/lib/roles';

const dt = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso)) : '—';
const day = (d: string | null) =>
  d ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)) : '—';
const TODAY: Record<TeamProfile['today']['status'], string> = {
  present: 'Present',
  absent: 'Not punched in',
  leave: 'On leave',
  holiday: 'Holiday',
  incomplete: 'Punched in, not out',
  weekly_off: 'Weekly off',
};
const PERF_KPIS: KpiKey[] = ['call_average', 'chemist_call_average', 'dcr_compliance_pct', 'dcr_on_time_pct', 'pob_value'];

function errorText(status: number | undefined, fallback: string) {
  if (status === 404) return 'This person is not in your team, or does not exist.';
  if (status === 403) return 'You can only view your own profile, or people below you as ABM or above.';
  return fallback;
}

/** #75: GET /v1/team/members/{userId}/profile, /performance, /doctors, /chemists, /export. Read-only. */
export function ProfileView({ userId }: { userId: string }) {
  const [p, setP] = useState<TeamProfile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/team/members/{userId}/profile', { params: { path: { userId } } }).catch(() => null);
      if (!live) return;
      if (r?.data) setP(r.data as TeamProfile);
      else setErr(errorText(r?.response.status, r ? toApiError(r).message || 'Could not load this profile.' : 'Could not reach the server.'));
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [userId]);

  if (err)
    return (
      <div className="grid gap-3">
        <BackLink />
        <p role="alert" className="text-sm text-destructive" data-testid="profile-error">{err}</p>
      </div>
    );
  if (!p) return <div className="h-96" aria-busy="true" />;
  const m = p.member;
  return (
    <div className="grid gap-5" data-testid="profile">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="profile-name">{m.name}</h1>
          <p className="text-sm text-muted-foreground">
            {m.role ? roleLabel(m.role) : 'No role'}
            {m.employeeCode ? ` · ${m.employeeCode}` : ''}
            {m.designation ? ` · ${m.designation}` : ''}
          </p>
        </div>
        <ExportButtons userId={userId} name={m.name} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="HQ" value={p.hq?.name ?? 'Not assigned'} testId="profile-hq" />
        <Fact label="Reports to" value={p.manager?.name ?? 'No manager'} />
        <Fact label="Today" value={TODAY[p.today.status]} sub={p.today.punchInAt ? `In ${dt(p.today.punchInAt)}${p.today.punchOutAt ? `, out ${dt(p.today.punchOutAt)}` : ''}` : p.lastPunchInAt ? `Last punch-in ${dt(p.lastPunchInAt)}` : 'No punch-in yet'} testId="profile-today" />
        <Fact label="Contact" value={m.email ?? '—'} sub={m.phone ?? undefined} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="profile-counts">
        <Fact label="Doctors" value={String(p.counts.doctors)} />
        <Fact label="Chemists" value={String(p.counts.chemists)} />
        <Fact label="Direct reports" value={String(p.counts.directReports)} />
        <Fact label="Everyone below" value={String(p.counts.subtreeSize)} />
      </div>

      {p.exceptions && (
        <Card className="gap-3 p-4" data-testid="profile-exceptions">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Exceptions</h2>
            <p className="text-sm text-muted-foreground">
              {p.exceptions.open} open · {p.exceptions.openHigh} high · {p.exceptions.last30Days} in the last 30 days
            </p>
          </div>
          {p.exceptions.byRule.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {p.exceptions.byRule.map((r) => (
                <li key={r.ruleCode}><Badge variant="secondary">{EXCEPTION_RULES[r.ruleCode]?.name ?? r.ruleCode}: {r.count}</Badge></li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None open.</p>
          )}
        </Card>
      )}

      <Performance userId={userId} canSeeExpenses={p.canSeeExpenses} />
      <Outlets userId={userId} />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/my-team" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden /> My team
    </Link>
  );
}

function Fact({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) {
  return (
    <Card className="gap-1 p-4" data-testid={testId}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
      {sub && <span className="truncate text-xs text-muted-foreground">{sub}</span>}
    </Card>
  );
}

function Performance({ userId, canSeeExpenses }: { userId: string; canSeeExpenses: boolean }) {
  const [g, setG] = useState<'month' | 'week'>('month');
  const [data, setData] = useState<TeamPerformance | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setErr(null);
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/team/members/{userId}/performance', { params: { path: { userId }, query: { granularity: g } } }).catch(() => null);
      if (!live) return;
      if (r?.data) setData(r.data as TeamPerformance);
      else setErr(r ? toApiError(r).message || 'Could not load performance.' : 'Could not reach the server.');
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [userId, g]);
  const val = (b: TeamPerformance['buckets'][number], k: KpiKey) => {
    const v = b.metrics.find((x) => x.kpi === k);
    return v ? formatKpi(v.value, v.unit) : '—';
  };
  const rows = data ? [...data.buckets, data.total] : [];
  return (
    <Card className="gap-0 p-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 p-4">
        <div>
          <CardTitle>Performance</CardTitle>
          <CardDescription>{g === 'month' ? 'Last 6 months' : 'Last 8 weeks'}</CardDescription>
        </div>
        <Tabs value={g} onValueChange={(v) => setG(v as 'month' | 'week')}>
          <TabsList>
            <TabsTrigger value="month" data-testid="perf-month">Monthly</TabsTrigger>
            <TabsTrigger value="week" data-testid="perf-week">Weekly</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      {err ? (
        <p role="alert" className="px-4 pb-4 text-sm text-destructive">{err}</p>
      ) : !data ? (
        <div className="h-40" aria-busy="true" />
      ) : (
        <div className="overflow-x-auto">
          <Table data-testid="perf-table">
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                {PERF_KPIS.map((k) => <TableHead key={k} className="text-right">{KPI_META[k].label}</TableHead>)}
                <TableHead className="text-right">Present</TableHead>
                <TableHead className="text-right">Leave</TableHead>
                <TableHead className="text-right">Absent</TableHead>
                {canSeeExpenses && <TableHead className="text-right">Claimed</TableHead>}
                {canSeeExpenses && <TableHead className="text-right">Approved</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => (
                <TableRow key={b.label} data-testid="perf-row" className={b.label === 'total' ? 'font-medium' : undefined}>
                  <TableCell className="whitespace-nowrap">{b.label === 'total' ? 'Total' : b.label}</TableCell>
                  {PERF_KPIS.map((k) => <TableCell key={k} className="text-right tabular-nums">{val(b, k)}</TableCell>)}
                  <TableCell className="text-right tabular-nums">{b.attendance.presentDays}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.attendance.leaveDays}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.attendance.absentDays}</TableCell>
                  {canSeeExpenses && <TableCell className="text-right tabular-nums">{b.expenses ? formatKpi(b.expenses.claimed, 'inr') : '—'}</TableCell>}
                  {canSeeExpenses && <TableCell className="text-right tabular-nums">{b.expenses ? formatKpi(b.expenses.approved, 'inr') : '—'}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

type OutletRow = { id: string; name: string; territoryName: string; city: string | null; lastVisitDate: string | null; specialty?: string | null; category?: string | null; visitsThisMonth?: number; requiredVisits?: number };

function Outlets({ userId }: { userId: string }) {
  const [kind, setKind] = useState<'doctors' | 'chemists'>('doctors');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<OutletRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const load = useCallback(
    async (after: string | null) => {
      setBusy(true);
      await apiReady();
      const query = { limit: 25, includeTotal: true, ...(after ? { cursor: after } : {}), ...(term ? { q: term } : {}) };
      const r =
        kind === 'doctors'
          ? await api.GET('/v1/team/members/{userId}/doctors', { params: { path: { userId }, query: query as never } }).catch(() => null)
          : await api.GET('/v1/team/members/{userId}/chemists', { params: { path: { userId }, query: query as never } }).catch(() => null);
      setBusy(false);
      if (!r?.data) return setErr(r ? toApiError(r).message || 'Could not load the list.' : 'Could not reach the server.');
      setErr(null);
      const d = r.data as { items: OutletRow[]; nextCursor: string | null; total?: number };
      setRows((prev) => (after ? [...(prev ?? []), ...d.items] : d.items));
      setCursor(d.nextCursor);
      if (d.total !== undefined) setTotal(d.total);
    },
    [userId, kind, term],
  );
  useEffect(() => {
    setRows(null);
    void load(null);
  }, [load]);
  return (
    <Card className="gap-0 p-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 p-4">
        <Tabs value={kind} onValueChange={(v) => setKind(v as 'doctors' | 'chemists')}>
          <TabsList>
            <TabsTrigger value="doctors" data-testid="outlets-doctors">Doctors</TabsTrigger>
            <TabsTrigger value="chemists" data-testid="outlets-chemists">Chemists</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:w-64">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${kind}`} aria-label={`Search ${kind}`} className="pl-8 text-base md:text-sm" data-testid="outlets-search" />
        </div>
      </CardHeader>
      {err && <p role="alert" className="px-4 pb-3 text-sm text-destructive">{err}</p>}
      {!rows ? (
        <div className="h-32" aria-busy="true" />
      ) : !rows.length ? (
        <p className="px-4 pb-6 text-sm text-muted-foreground" data-testid="outlets-empty">{term ? 'No matches.' : `No ${kind} in this person's territories.`}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table data-testid="outlets-table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                {kind === 'doctors' && <TableHead>Specialty</TableHead>}
                <TableHead>Territory</TableHead>
                {kind === 'doctors' && <TableHead className="text-right">Visits this month</TableHead>}
                <TableHead>Last visit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((o) => (
                <TableRow key={o.id} data-testid="outlet-row">
                  <TableCell className="font-medium">{o.name}</TableCell>
                  {kind === 'doctors' && <TableCell>{o.specialty ?? '—'}</TableCell>}
                  <TableCell>{o.territoryName}{o.city ? `, ${o.city}` : ''}</TableCell>
                  {kind === 'doctors' && <TableCell className="text-right tabular-nums">{o.visitsThisMonth ?? 0} / {o.requiredVisits ?? 0}</TableCell>}
                  <TableCell className="whitespace-nowrap">{day(o.lastVisitDate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 p-4 text-sm text-muted-foreground">
        <span data-testid="outlets-count">{rows ? `${rows.length}${total !== null ? ` of ${total}` : ''}` : ''}</span>
        {cursor && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void load(cursor)} data-testid="outlets-more">
            {busy && <LoaderCircle className="animate-spin" aria-hidden />} Load more
          </Button>
        )}
      </div>
    </Card>
  );
}

/** GET /export?format=xlsx|pdf: server-built file, downloaded with the session cookie. */
function ExportButtons({ userId, name }: { userId: string; name: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = async (format: 'xlsx' | 'pdf') => {
    setBusy(format);
    setErr(null);
    await apiReady();
    try {
      const url = `${API_URL}/v1/team/members/${encodeURIComponent(userId)}/export?format=${format}`;
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) throw new Error(r.status === 403 || r.status === 404 ? errorText(r.status, '') : 'Could not build the file. Try again.');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name.replace(/[^\w.-]+/g, '-')}-profile.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not build the file.');
    }
    setBusy(null);
  };
  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex gap-2">
        {(['xlsx', 'pdf'] as const).map((f) => (
          <Button key={f} variant="outline" size="sm" disabled={!!busy} onClick={() => void go(f)} data-testid={`export-${f}`}>
            {busy === f ? <LoaderCircle className="animate-spin" aria-hidden /> : <Download aria-hidden />} {f === 'xlsx' ? 'Excel' : 'PDF'}
          </Button>
        ))}
      </div>
      {err && <p role="alert" className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
