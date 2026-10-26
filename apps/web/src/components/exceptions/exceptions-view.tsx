'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import { Card, CardHeader, CardTitle } from '@ariforce/ui/components/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@ariforce/ui/components/sheet';
import { cn } from '@ariforce/ui/lib/utils';
import { axisProps, CHART, ChartFrame, ChartTooltip } from '@/components/charts/chart';
import { DataTable } from '@/components/data-table/data-table';
import { memorySource } from '@/components/data-table/memory-source';
import type { Column } from '@/components/data-table/types';
import { useRole } from '@/components/shell/role-context';
import { isApprover } from '@/lib/roles';
import { shortDate } from '@/lib/period';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import {
  CATEGORY_LABEL,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  SEVERITY_TEXT,
  THRESHOLDS,
  type Category,
  type Exception,
} from './rules';
import { useExceptions } from './use-exceptions';
import { detailLinks } from './links';

export function ExceptionsView() {
  const { role } = useRole();
  const { rows, error } = useExceptions(role);
  const [open, setOpen] = useState<Exception | null>(null);
  const reduced = useReducedMotion();

  const source = useMemo(() => {
    const list = rows ?? [];
    const people = [...new Set(list.map((r) => r.who))].sort();
    const cats = [...new Set(list.map((r) => r.category))];
    return memorySource(list, {
      filters: [
        { id: 'severity', label: 'Severity', options: SEVERITY_ORDER.map((s) => ({ value: s, label: SEVERITY_LABEL[s] })) },
        { id: 'category', label: 'Type', options: cats.map((c) => ({ value: c, label: CATEGORY_LABEL[c] })) },
        { id: 'who', label: 'Person', options: people.map((p) => ({ value: p, label: p })) },
      ],
      match: (r, id, v) => (id === 'severity' ? r.severity === v : id === 'category' ? r.category === v : r.who === v),
      text: (r) => `${r.title} ${r.detail} ${r.who}`,
      sort: {
        severity: (r) => SEVERITY_ORDER.indexOf(r.severity),
        date: (r) => r.date,
        who: (r) => r.who,
      },
    });
  }, [rows]);

  const counts = useMemo(() => {
    const by = new Map<Category, Record<string, number>>();
    for (const r of rows ?? []) {
      const c = by.get(r.category) ?? { high: 0, medium: 0, low: 0 };
      c[r.severity] = (c[r.severity] ?? 0) + 1;
      by.set(r.category, c);
    }
    return [...by.entries()].map(([k, v]) => ({ name: CATEGORY_LABEL[k], ...v }));
  }, [rows]);
  const total = (s: string) => (rows ?? []).filter((r) => r.severity === s).length;

  const columns: Column<Exception>[] = [
    {
      id: 'severity',
      header: 'Severity',
      mobile: 'secondary',
      className: 'w-24',
      cell: (r) => (
        <span className={cn('text-xs font-medium tracking-wide uppercase', SEVERITY_TEXT[r.severity])}>
          {SEVERITY_LABEL[r.severity]}
        </span>
      ),
    },
    {
      id: 'title',
      header: 'Exception',
      mobile: 'primary',
      cell: (r) => (
        <div className="min-w-0">
          <p className="font-medium">
            {r.title} {r.sample && <Badge variant="outline" className="ml-1 border-dashed font-normal text-muted-foreground">Sample data</Badge>}
          </p>
          <p className="truncate text-sm text-muted-foreground">{r.detail}</p>
        </div>
      ),
    },
    { id: 'category', header: 'Type', mobile: 'hidden', cell: (r) => CATEGORY_LABEL[r.category] },
    { id: 'who', header: 'Person', mobile: 'secondary', cell: (r) => r.who },
    { id: 'date', header: 'Date', mobile: 'hidden', className: 'tabular-nums', cell: (r) => (r.date ? shortDate(r.date) : '—') },
  ];

  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <ul className="grid grid-cols-3 overflow-hidden rounded-lg border bg-card" aria-label="Exceptions by severity" data-testid="exc-summary">
          {SEVERITY_ORDER.map((s, i) => (
            <li key={s} className={cn('af-enter px-4 py-4', i > 0 && 'border-l')} style={{ '--i': i } as React.CSSProperties}>
              <p className={cn('text-xs font-medium tracking-wide uppercase', SEVERITY_TEXT[s])}>{SEVERITY_LABEL[s]}</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums" data-testid={`exc-count-${s}`}>
                {rows ? total(s) : '–'}
              </p>
            </li>
          ))}
        </ul>
        <Card className="gap-0 py-0 shadow-xs">
          <CardHeader className="px-4 pt-4 pb-0">
            <CardTitle className="text-sm">By type</CardTitle>
          </CardHeader>
          <div className="px-2 pb-2">
            <ChartFrame height={Math.max(120, counts.length * 30 + 20)} label="Exceptions by type and severity">
              <BarChart data={counts} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 0 }} barSize={14}>
                <CartesianGrid horizontal={false} stroke={CHART.grid} />
                <XAxis type="number" allowDecimals={false} {...axisProps} />
                <YAxis type="category" dataKey="name" width={96} {...axisProps} />
                <ChartTooltip />
                {SEVERITY_ORDER.map((s, i) => (
                  <Bar
                    key={s}
                    dataKey={s}
                    name={SEVERITY_LABEL[s]}
                    stackId="a"
                    fill={CHART[s]}
                    radius={i === 2 ? [0, 3, 3, 0] : 0}
                    isAnimationActive={!reduced}
                    animationDuration={500}
                  />
                ))}
              </BarChart>
            </ChartFrame>
          </div>
        </Card>
      </div>

      <DataTable
        label="exceptions"
        source={source}
        columns={columns}
        rowKey={(r) => r.id}
        onRowClick={setOpen}
        searchPlaceholder="Search exceptions"
        reloadKey={rows ? 1 : 0}
        empty={<p className="py-10 text-center text-sm text-muted-foreground">Nothing over the thresholds.</p>}
      />

      <p className="text-xs text-muted-foreground">
        Each exception is a fixed rule over attendance, DCR, tour-plan, approval and KPI data. Thresholds (e.g. coverage below{' '}
        {THRESHOLDS.coverageMinPct}%, punch-in after {THRESHOLDS.lateLogin} IST) are drafts, to confirm with Arighna.
      </p>

      <Sheet open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full sm:max-w-md" data-testid="exc-detail">
          {open && (
            <>
              <SheetHeader>
                <p className={cn('text-xs font-medium tracking-wide uppercase', SEVERITY_TEXT[open.severity])}>
                  {SEVERITY_LABEL[open.severity]} · {CATEGORY_LABEL[open.category]}
                </p>
                <SheetTitle>{open.title}</SheetTitle>
                <SheetDescription>{open.detail}</SheetDescription>
              </SheetHeader>
              <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 px-4 text-sm">
                <dt className="text-muted-foreground">Person</dt>
                <dd>{open.who}</dd>
                {open.date && (
                  <>
                    <dt className="text-muted-foreground">Date</dt>
                    <dd>{shortDate(open.date)}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Rule</dt>
                <dd>{open.rule}</dd>
              </dl>
              <div className="flex flex-col gap-2 px-4 pt-2">
                {detailLinks(open, isApprover(role)).map((l) => (
                  <Button key={l.href} variant="outline" asChild className="justify-between">
                    <Link href={l.href} data-testid="exc-drill">
                      {l.label}
                      <ArrowRight />
                    </Link>
                  </Button>
                ))}
              </div>
              {open.sample && <p className="px-4 pt-2 text-xs text-muted-foreground">Sample data: no contract covers this yet.</p>}
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
