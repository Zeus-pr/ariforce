'use client';

import { useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronRight, Minus } from 'lucide-react';
import { toast } from '@ariforce/ui/components/sonner';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ariforce/ui/components/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ariforce/ui/components/tabs';
import { cn } from '@ariforce/ui/lib/utils';
import { useRole } from '@/components/shell/role-context';
import { isFieldRole } from '@/lib/roles';
import {
  MOCK_APPROVALS,
  MOCK_ATTENTION,
  MOCK_KPIS,
  MOCK_SCOPE,
  MOCK_TEAM,
  type Approval,
  type Severity,
} from '@/mocks/dashboard';

const SEVERITY: Record<Severity, { label: string; text: string }> = {
  high: { label: 'High', text: 'text-danger' },
  medium: { label: 'Medium', text: 'text-warning-text' },
  low: { label: 'Low', text: 'text-muted-foreground' },
};

function MockBadge() {
  return (
    <Badge variant="outline" className="border-dashed font-normal text-muted-foreground">
      Sample data
    </Badge>
  );
}

export function DashboardView() {
  const { role } = useRole();
  const [approvals, setApprovals] = useState(MOCK_APPROVALS);
  const [returning, setReturning] = useState<Approval | null>(null);
  const [comment, setComment] = useState('');

  const approve = (a: Approval) => {
    setApprovals((list) => list.filter((x) => x.id !== a.id));
    toast.success(`${a.type} approved`, {
      description: `${a.rep} · ${a.area} (mock, nothing was saved)`,
      action: { label: 'Undo', onClick: () => setApprovals((list) => [a, ...list]) },
    });
  };

  if (isFieldRole(role)) {
    return (
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your day: check in from Attendance, file calls in DCR, and keep this month's Tour plan complete.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Hierarchy" className="flex items-center gap-1 text-xs text-muted-foreground">
            {MOCK_SCOPE.breadcrumb.map((b, i) => (
              <span key={b} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3" />}
                <span className={cn(i === MOCK_SCOPE.breadcrumb.length - 1 && 'text-foreground')}>{b}</span>
              </span>
            ))}
          </nav>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Needs attention</h1>
          <p className="text-sm text-muted-foreground">
            {MOCK_SCOPE.cycle} · day {MOCK_SCOPE.cycleDay} of {MOCK_SCOPE.cycleDays}
          </p>
        </div>
        <MockBadge />
      </div>

      <section
        aria-label="Key metrics"
        className="grid grid-cols-2 divide-border overflow-hidden rounded-lg border bg-card max-xl:[&>*:nth-child(-n+2)]:border-b max-xl:[&>*:nth-child(odd)]:border-r xl:grid-cols-4 xl:divide-x"
      >
        {MOCK_KPIS.map((k) => {
          const Trend = k.trend === 'up' ? ArrowUpRight : k.trend === 'down' ? ArrowDownRight : Minus;
          return (
            <div key={k.key} className="min-w-0 px-4 py-3.5">
              <p className="truncate text-xs font-medium text-muted-foreground">{k.label}</p>
              <div className="mt-1">
                <NumberTicker
                  value={k.value}
                  decimalPlaces={k.decimals ?? 0}
                  suffix={k.suffix}
                  className="text-2xl font-semibold tracking-tight tabular-nums sm:text-[28px]"
                />
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 text-xs">
                  <span className="text-muted-foreground">{k.target}</span>
                  <span
                    className={cn(
                      'flex items-center gap-0.5',
                      k.trend === 'up' && 'text-success',
                      k.trend === 'down' && 'text-danger',
                      k.trend === 'flat' && 'text-muted-foreground',
                    )}
                  >
                    <Trend className="size-3.5" />
                    {k.delta}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="gap-0 py-0 shadow-xs xl:col-span-3">
          <CardHeader className="border-b px-4 py-4">
            <CardTitle className="text-base">Exceptions</CardTitle>
            <CardDescription>Sorted by severity. Each item links to the Business Manager or record.</CardDescription>
          </CardHeader>
          <ul className="divide-y">
            {MOCK_ATTENTION.map((a, i) => (
              <li key={a.id} style={{ '--i': i } as React.CSSProperties} className="af-enter grid grid-cols-[4.5rem_1fr_auto] items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
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
                <Button variant="ghost" size="sm" className="shrink-0">
                  {a.action}
                  <ArrowRight className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="gap-0 py-0 shadow-xs xl:col-span-2">
          <CardHeader className="border-b px-4 py-4">
            <CardTitle className="text-base">Approvals</CardTitle>
            <CardDescription>{approvals.length} waiting on you</CardDescription>
          </CardHeader>
          <Tabs defaultValue="all" className="gap-0">
            <TabsList className="mx-4 mt-3">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="Tour plan">Tour plans</TabsTrigger>
              <TabsTrigger value="DCR">DCR</TabsTrigger>
              <TabsTrigger value="Leave">Leave</TabsTrigger>
            </TabsList>
            {['all', 'Tour plan', 'DCR', 'Leave'].map((tab) => {
              const rows = approvals.filter((a) => tab === 'all' || a.type === tab);
              return (
                <TabsContent key={tab} value={tab}>
                  {rows.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing waiting.</p>
                  ) : (
                    <ul className="divide-y">
                      {rows.map((a, i) => (
                        <li key={a.id} style={{ '--i': i } as React.CSSProperties} className="af-enter px-4 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-medium">{a.rep}</p>
                            <Badge variant="secondary" className="font-normal">
                              {a.type}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {a.summary} · {a.submitted}
                          </p>
                          <div className="mt-2 flex gap-2">
                            <Button size="sm" onClick={() => approve(a)}>
                              Approve
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setReturning(a)}>
                              Return
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        </Card>
      </div>

      <Card className="gap-0 py-0 shadow-xs">
        <CardHeader className="flex flex-row items-center justify-between border-b px-4 py-4">
          <div>
            <CardTitle className="text-base">Team this cycle</CardTitle>
            <CardDescription>Kolkata area · 4 Business Managers</CardDescription>
          </div>
          <MockBadge />
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Business Manager</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Call avg</TableHead>
              <TableHead>Coverage</TableHead>
              <TableHead className="text-right">Missed A-class</TableHead>
              <TableHead className="pr-4 text-right">DCR on time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MOCK_TEAM.map((r) => (
              <TableRow key={r.rep}>
                <TableCell className="pl-4">
                  <p className="font-medium">{r.rep}</p>
                  <p className="text-xs text-muted-foreground">{r.area}</p>
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.calls}</TableCell>
                <TableCell className="text-right tabular-nums">{r.callAvg.toFixed(1)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div
                      role="progressbar"
                      aria-valuenow={r.coverage}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${r.rep} coverage`}
                      className="h-1.5 w-20 overflow-hidden rounded-sm bg-muted"
                    >
                      <div
                        className="h-full origin-left bg-primary transition-transform duration-(--duration-slow) ease-(--ease-out)"
                        style={{ transform: `scaleX(${r.coverage / 100})` }}
                      />
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">{r.coverage}%</span>
                  </div>
                </TableCell>
                <TableCell className={cn('text-right tabular-nums', r.missedA >= 10 && 'font-medium text-danger')}>
                  {r.missedA}
                </TableCell>
                <TableCell className="pr-4 text-right tabular-nums">{r.dcrOnTime}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={returning !== null} onOpenChange={(o) => !o && setReturning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return {returning?.type.toLowerCase()}</DialogTitle>
            <DialogDescription>
              {returning?.rep} sees this comment and can resubmit. (Mock, nothing is saved.)
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            placeholder="What needs to change?"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturning(null)}>
              Cancel
            </Button>
            <Button
              disabled={!comment.trim()}
              onClick={() => {
                if (returning) setApprovals((l) => l.filter((x) => x.id !== returning.id));
                toast(`Returned to ${returning?.rep}`, { description: comment });
                setComment('');
                setReturning(null);
              }}
            >
              Return with comment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
