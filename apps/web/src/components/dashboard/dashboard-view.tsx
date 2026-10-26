'use client';

import { ArrowRight, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Approval, KpiReport, ProductKpiReport } from '@ariforce/contracts';
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@ariforce/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ariforce/ui/components/dialog';
import { NumberTicker } from '@ariforce/ui/components/number-ticker';
import { toast } from '@ariforce/ui/components/sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ariforce/ui/components/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ariforce/ui/components/tabs';
import { cn } from '@ariforce/ui/lib/utils';
import { useRole } from '@/components/shell/role-context';
import { api, apiReady, toApiError } from '@/lib/api';
import { isApprover, isFieldRole, type Role } from '@/lib/roles';
import { MOCK_ATTENTION, type Severity } from '@/mocks/dashboard';
import { formatKpi, HEADLINE, KPI_META, TEAM_COLUMNS } from './kpi-meta';

type Metric = KpiReport['rows'][number]['metrics'][number];
type Rollup = KpiReport['rollup'];

const SEVERITY: Record<Severity, { label: string; text: string }> = {
  high: { label: 'High', text: 'text-danger' },
  medium: { label: 'Medium', text: 'text-warning-text' },
  low: { label: 'Low', text: 'text-muted-foreground' },
};
const SCOPE: Record<Rollup, string> = {
  company: 'Whole company',
  team: 'Your team',
  self: 'Your own numbers',
  byUser: 'By person',
  byTerritory: 'By territory',
};

const monthFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' });
const thisMonth = () => monthFmt.format(new Date());
const noop = () => () => {};
const monthLabel = (m: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));

/** The widest rollup the contract allows this role (docs/kpi-definitions.md). */
export function rollupFor(role: Role): Rollup {
  if (role === 'director') return 'company';
  return isApprover(role) ? 'team' : 'self';
}

function SampleBadge() {
  return (
    <Badge variant="outline" className="border-dashed font-normal text-muted-foreground">
      Sample data
    </Badge>
  );
}

function FormulaNote() {
  return <p className="text-xs text-muted-foreground">KPI formulas are drafts, to confirm with Arighna.</p>;
}

export function DashboardView() {
  const { role } = useRole();
  const month = useSyncExternalStore(noop, thisMonth, () => null);
  if (!month) return <div className="mx-auto h-[640px] w-full max-w-7xl" aria-busy="true" />;
  return <Dashboard role={role} month={month} />;
}

export function useKpis(month: string, rollup: Rollup, kpis?: readonly string[]) {
  const [data, setData] = useState<KpiReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = kpis?.join(',');
  useEffect(() => {
    let live = true;
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/kpis', {
        params: { query: { month, rollup, ...(key ? { kpis: key } : {}) } as never },
      });
      if (!live) return;
      if (r.error) setError(toApiError(r).message);
      else setData(r.data);
    })();
    return () => {
      live = false;
    };
  }, [month, rollup, key]);
  return { data, error };
}

function Dashboard({ role, month }: { role: Role; month: string }) {
  const rollup = rollupFor(role);
  const field = isFieldRole(role);
  const approver = isApprover(role);
  const head = useKpis(month, rollup, HEADLINE);
  const team = useKpis(month, approver ? 'byUser' : 'self', [...TEAM_COLUMNS, 'dcr_compliance_pct']);
  const metrics = head.data?.rows[0]?.metrics ?? [];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground" data-testid="kpi-scope">
            {SCOPE[rollup]} · {monthLabel(month)}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{field ? 'Your month' : 'Needs attention'}</h1>
          {field && (
            <p className="mt-1 text-sm text-muted-foreground">
              Check in from <Link className="underline underline-offset-4" href="/attendance">Attendance</Link>, file calls in{' '}
              <Link className="underline underline-offset-4" href="/dcr">DCR</Link>, and keep this month&apos;s{' '}
              <Link className="underline underline-offset-4" href="/tour-plans">Tour plan</Link> complete.
            </p>
          )}
        </div>
        <FormulaNote />
      </div>

      <KpiCards metrics={metrics} error={head.error} loading={!head.data && !head.error} />

      {!field && (
        <div className="grid gap-6 xl:grid-cols-5">
          <Attention className="xl:col-span-3" rows={approver ? (team.data?.rows ?? []) : []} />
          <Approvals className="xl:col-span-2" />
        </div>
      )}

      {approver && <TeamTable report={team.data} />}

      <ProductKpis month={month} />
    </div>
  );
}

export function KpiCards({ metrics, error, loading }: { metrics: Metric[]; error: string | null; loading: boolean }) {
  const [open, setOpen] = useState(false);
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  return (
    <section aria-label="Key metrics" className="flex flex-col gap-2">
      <ul
        data-testid="kpi-cards"
        className="grid grid-cols-2 overflow-hidden rounded-lg border bg-card sm:grid-cols-4 [&>li]:border-b [&>li]:border-r"
      >
        {(loading ? HEADLINE.map((k) => ({ kpi: k }) as Partial<Metric>) : metrics).map((m, i) => {
          const meta = KPI_META[m.kpi!];
          const ready = 'unit' in m;
          const met = ready && m.target != null && m.value != null ? m.value >= m.target : null;
          return (
            <li
              key={m.kpi}
              data-testid="kpi-card"
              data-kpi={m.kpi}
              style={{ '--i': i } as React.CSSProperties}
              className="af-enter -mb-px -mr-px min-w-0 px-4 py-3.5"
              title={ready ? `${meta.num}${meta.den ? ` ÷ ${meta.den}` : ''} (to confirm with Arighna)` : undefined}
            >
              <p className="truncate text-xs font-medium text-muted-foreground">{meta.label}</p>
              <div className="mt-1 h-8 text-2xl font-semibold tracking-tight tabular-nums sm:text-[28px]">
                {!ready ? (
                  <span className="inline-block h-6 w-16 animate-pulse rounded bg-muted" />
                ) : m.value === null ? (
                  '—'
                ) : m.unit === 'inr' ? (
                  formatKpi(m.value ?? null, 'inr')
                ) : (
                  <NumberTicker
                    value={m.value!}
                    decimalPlaces={m.unit === 'count' ? 0 : 1}
                    suffix={m.unit === 'percent' ? '%' : ''}
                  />
                )}
              </div>
              {ready && (
                <p className="mt-1 text-xs">
                  {m.target == null ? (
                    <span className="text-muted-foreground">No target set</span>
                  ) : (
                    <span className={cn(met ? 'text-success' : 'text-warning-text')}>
                      Target {formatKpi(m.target, m.unit!)}
                    </span>
                  )}
                </p>
              )}
              {ready && open && (
                <p className="af-fade mt-2 text-xs leading-snug text-muted-foreground" data-testid="kpi-formula">
                  {m.denominator != null ? (
                    <>
                      <span className="tabular-nums text-foreground">{formatKpi(m.numerator!, 'count')}</span> {meta.num}
                      <br />÷ <span className="tabular-nums text-foreground">{formatKpi(m.denominator, 'count')}</span> {meta.den}
                    </>
                  ) : (
                    <>Count of {meta.num}</>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="kpi-expand"
      >
        <ChevronDown className={cn('transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-180')} />
        {open ? 'Hide how each number is worked out' : 'Show how each number is worked out'}
      </Button>
    </section>
  );
}

function metric(row: KpiReport['rows'][number], k: string) {
  return row.metrics.find((m) => m.kpi === k);
}

function Attention({ rows, className }: { rows: KpiReport['rows']; className?: string }) {
  // Derived from GET /v1/kpis?rollup=byUser. Thresholds are placeholders, to confirm with Arighna.
  const derived = rows.flatMap((r) => {
    const out: { id: string; severity: Severity; title: string; detail: string; who: string }[] = [];
    const missed = metric(r, 'missed_doctor_pct');
    if (missed?.value != null && missed.value >= 30)
      out.push({
        id: `${r.label}-missed`,
        severity: 'high',
        title: `${formatKpi(missed.value, 'percent')} of must-see doctors not visited`,
        detail: `${missed.numerator} of ${missed.denominator} MSL doctors have no visit this month.`,
        who: r.label,
      });
    const dcr = metric(r, 'dcr_compliance_pct');
    if (dcr?.value != null && dcr.value < 90)
      out.push({
        id: `${r.label}-dcr`,
        severity: 'medium',
        title: `DCR compliance ${formatKpi(dcr.value, 'percent')}`,
        detail: `${dcr.numerator} of ${dcr.denominator} expected working days have a DCR.`,
        who: r.label,
      });
    return out;
  });
  const order: Severity[] = ['high', 'medium', 'low'];
  derived.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

  return (
    <Card className={cn('gap-0 py-0 shadow-xs', className)}>
      <CardHeader className="border-b px-4 py-4">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">Exceptions</CardTitle>
          <Link href="/exceptions" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" data-testid="see-all-exceptions">
            See all
          </Link>
        </div>
        <CardDescription>From this month&apos;s KPIs, most serious first. Thresholds to confirm with Arighna.</CardDescription>
      </CardHeader>
      <ul className="divide-y" data-testid="attention-kpi">
        {derived.length === 0 && <li className="px-4 py-6 text-sm text-muted-foreground">Nothing over the thresholds.</li>}
        {derived.map((a, i) => (
          <li key={a.id} style={{ '--i': i } as React.CSSProperties} className="af-enter grid grid-cols-[4.5rem_1fr] items-start gap-3 px-4 py-3">
            <span className={cn('pt-0.5 text-xs font-medium tracking-wide uppercase', SEVERITY[a.severity].text)}>
              {SEVERITY[a.severity].label}
            </span>
            <div className="min-w-0">
              <p className="font-medium">{a.title}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{a.detail}</p>
              <p className="mt-1 text-xs text-muted-foreground">{a.who}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2 border-t bg-muted/30 px-4 py-2">
        <p className="text-xs font-medium text-muted-foreground">Not in the API yet: geofence, late DCR, sample stock</p>
        <SampleBadge />
      </div>
      <ul className="divide-y opacity-80" data-testid="attention-sample">
        {MOCK_ATTENTION.filter((a) => /geofence|stock|DCR missing/i.test(a.title)).map((a) => (
          <li key={a.id} className="grid grid-cols-[4.5rem_1fr_auto] items-start gap-3 px-4 py-3">
            <span className={cn('pt-0.5 text-xs font-medium tracking-wide uppercase', SEVERITY[a.severity].text)}>
              {SEVERITY[a.severity].label}
            </span>
            <div className="min-w-0">
              <p className="font-medium">{a.title}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{a.detail}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {a.who} · {a.area} · {a.age}
              </p>
            </div>
            <Button variant="ghost" size="sm" className="shrink-0" disabled>
              {a.action}
              <ArrowRight className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const APPROVAL_TABS = [
  { value: 'all', label: 'All' },
  { value: 'tour_plan', label: 'Tour plans' },
  { value: 'dcr_unlock', label: 'DCR unlock' },
  { value: 'leave', label: 'Leave' },
] as const;
const SUBJECT_LABEL: Partial<Record<Approval['subjectType'], string>> = {
  tour_plan: 'Tour plan',
  dcr_unlock: 'DCR unlock',
  leave: 'Leave',
  doctor: 'Doctor',
  chemist: 'Chemist',
  stockist: 'Stockist',
  device: 'Device',
};

function Approvals({ className }: { className?: string }) {
  const [items, setItems] = useState<Approval[] | null>(null);
  const [returning, setReturning] = useState<Approval | null>(null);
  const [comment, setComment] = useState('');
  const load = useCallback(async () => {
    await apiReady();
    const r = await api.GET('/v1/approvals', { params: { query: { status: 'pending', mine: 'to_decide', limit: 50 } } });
    setItems(r.data?.items ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function decide(a: Approval, decision: 'approve' | 'reject', note?: string) {
    const r = await api.POST('/v1/approvals/{id}/decision', {
      params: { path: { id: a.id } },
      body: decision === 'approve' ? { decision } : { decision, comment: note },
    });
    if (r.error) return toast.error(toApiError(r).message);
    toast.success(decision === 'approve' ? `${a.summary} approved` : `${a.summary} sent back`);
    setReturning(null);
    setComment('');
    void load();
  }

  return (
    <Card className={cn('gap-0 py-0 shadow-xs', className)} data-testid="dash-approvals">
      <CardHeader className="border-b px-4 py-4">
        <CardTitle className="text-base">Approvals</CardTitle>
        <CardDescription>{items === null ? 'Loading…' : `${items.length} waiting on you`}</CardDescription>
      </CardHeader>
      <Tabs defaultValue="all" className="gap-0">
        <TabsList className="mx-4 mt-3">
          {APPROVAL_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        {APPROVAL_TABS.map((t) => {
          const rows = (items ?? []).filter((a) => t.value === 'all' || a.subjectType === t.value);
          return (
            <TabsContent key={t.value} value={t.value}>
              {rows.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing waiting.</p>
              ) : (
                <ul className="divide-y">
                  {rows.map((a, i) => (
                    <li key={a.id} style={{ '--i': i } as React.CSSProperties} className="af-enter px-4 py-3" data-testid="dash-approval">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{a.requestedByName}</p>
                        <Badge variant="secondary" className="font-normal">{SUBJECT_LABEL[a.subjectType] ?? a.subjectType}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{a.summary}</p>
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" onClick={() => decide(a, 'approve')}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => setReturning(a)}>Return</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
      <Dialog open={returning !== null} onOpenChange={(o) => !o && setReturning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return {returning?.summary}</DialogTitle>
            <DialogDescription>{returning?.requestedByName} sees this comment and can resubmit.</DialogDescription>
          </DialogHeader>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            aria-label="Comment"
            placeholder="What needs to change?"
            className="w-full rounded-md border bg-background px-3 py-2 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturning(null)}>Cancel</Button>
            <Button disabled={!comment.trim()} onClick={() => returning && decide(returning, 'reject', comment.trim())}>
              Return with comment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function TeamTable({ report }: { report: KpiReport | null }) {
  return (
    <Card className="gap-0 py-0 shadow-xs">
      <CardHeader className="border-b px-4 py-4">
        <CardTitle className="text-base">Team this month</CardTitle>
        <CardDescription>
          {report ? `${report.rows.length} people in your reporting line` : 'Loading…'} · hover a number for how it is worked out
        </CardDescription>
      </CardHeader>
      <div className="overflow-x-auto">
        <Table data-testid="kpi-team">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Person</TableHead>
              {TEAM_COLUMNS.map((k) => (
                <TableHead key={k} className="text-right last:pr-4">{KPI_META[k].label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(report?.rows ?? []).map((r) => (
              <TableRow key={r.userId ?? r.label} data-testid="kpi-team-row">
                <TableCell className="pl-4 font-medium">{r.label}</TableCell>
                {TEAM_COLUMNS.map((k) => {
                  const m = metric(r, k);
                  const meta = KPI_META[k];
                  return (
                    <TableCell
                      key={k}
                      className="text-right tabular-nums last:pr-4"
                      title={m && m.denominator != null ? `${m.numerator} ${meta.num} ÷ ${m.denominator} ${meta.den}` : undefined}
                    >
                      {m ? formatKpi(m.value, m.unit) : '—'}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function ProductKpis({ month }: { month: string }) {
  const [data, setData] = useState<ProductKpiReport | null>(null);
  useEffect(() => {
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/kpis/products', { params: { query: { month } as never } });
      if (r.data) setData(r.data);
    })();
  }, [month]);
  const max = useMemo(() => Math.max(1, ...(data?.rows ?? []).map((r) => r.detailedCalls)), [data]);
  const inr = (v: number) => formatKpi(v, 'inr');

  return (
    <Card className="gap-0 py-0 shadow-xs">
      <CardHeader className="border-b px-4 py-4">
        <CardTitle className="text-base">Products this month</CardTitle>
        <CardDescription>Detailing, samples and orders by product. Share = calls detailing the product ÷ doctor calls.</CardDescription>
      </CardHeader>
      <div className="overflow-x-auto">
        <Table data-testid="kpi-products">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Product</TableHead>
              <TableHead>Detailed in calls</TableHead>
              <TableHead className="text-right">First position</TableHead>
              <TableHead className="text-right">Share</TableHead>
              <TableHead className="text-right">Samples</TableHead>
              <TableHead className="text-right">POB qty</TableHead>
              <TableHead className="pr-4 text-right">POB value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.rows ?? []).map((r) => (
              <TableRow key={r.productId} data-testid="kpi-product-row">
                <TableCell className="pl-4 font-medium">{r.productName}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-sm bg-muted" aria-hidden>
                      <div
                        className="h-full origin-left bg-primary transition-transform duration-500 ease-(--ease-out) motion-reduce:transition-none"
                        style={{ transform: `scaleX(${r.detailedCalls / max})` }}
                      />
                    </div>
                    <span className="tabular-nums">{r.detailedCalls}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.firstPositionCalls}</TableCell>
                <TableCell className="text-right tabular-nums">{formatKpi(r.detailingSharePct, 'percent')}</TableCell>
                <TableCell className="text-right tabular-nums">{r.sampleQty}</TableCell>
                <TableCell className="text-right tabular-nums">{r.pobQty}</TableCell>
                <TableCell className="pr-4 text-right tabular-nums">{inr(r.pobValue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
