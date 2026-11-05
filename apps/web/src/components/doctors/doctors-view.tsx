'use client';

import dynamic from 'next/dynamic';

import { PlaceholderTag } from '@/components/masters/placeholder';

import { ArrowLeft, FileSpreadsheet, Mail, MapPin, Pencil, Phone, Plus } from 'lucide-react';
import { RecordSheet } from '@/components/masters/record-sheet';
import type { MasterRow } from '@/components/masters/config';
import { Button } from '@ariforce/ui/components/button';
import { useRole } from '@/components/shell/role-context';
import { canWriteMasters } from '@/lib/permissions';
import { APPROVAL_LABEL } from '@/components/pickers/pickers';
import { RejectionNote } from '@/components/approvals/rejection-note';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { Dcr, Doctor } from '@ariforce/contracts';
import { Badge } from '@ariforce/ui/components/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@ariforce/ui/components/card';
import { cn } from '@ariforce/ui/lib/utils';
import { DataTable } from '@/components/data-table/data-table';
import type { Column } from '@/components/data-table/types';
import { OutletLocksCard } from '@/components/field/outlet-locks-card';
import { LookupsProvider, useLookups } from '@/components/masters/lookups';
import { masterSource } from '@/components/masters/source';
import { api, apiReady } from '@/lib/api';
import { addDays, monthLabel, shortDate, thisMonth, todayYmd } from '@/lib/period';
import {
  HISTORY_DAYS,
  productTally,
  SAMPLE_CAP_PER_MONTH,
  visitsFrom,
  type Visit,
} from './doctor-data';
import { useProductNames } from './products';

const VisitsChart = dynamic(() => import('./doctor-charts').then((m) => m.VisitsChart), {
  ssr: false,
  loading: () => (
    <div className="h-[170px] animate-pulse rounded-md bg-muted/40" aria-busy="true" />
  ),
});

function dayLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function DoctorsView() {
  const id = useSearchParams().get('id');
  return <LookupsProvider>{id ? <Doctor360 id={id} /> : <DoctorList />}</LookupsProvider>;
}

function DoctorList() {
  const { role } = useRole();
  const lk = useLookups();
  const router = useRouter();
  const source = useMemo(() => masterSource('doctors', lk), [lk]);
  const columns: Column<Doctor>[] = [
    {
      id: 'name',
      header: 'Doctor',
      mobile: 'primary',
      cell: (d) => (
        <>
          <Link
            href={`/doctors?id=${d.id}`}
            className="font-medium underline-offset-4 hover:underline"
            data-testid="doctor-link"
          >
            {d.name}
          </Link>
          <PlaceholderTag name={d.name} />
        </>
      ),
    },
    {
      id: 'specialty',
      header: 'Specialty',
      mobile: 'secondary',
      cell: (d) => (d.specialtyId ? lk.byId.get(d.specialtyId) : '—'),
    },
    {
      id: 'category',
      header: 'Category',
      mobile: 'secondary',
      cell: (d) => (d.categoryId ? lk.byId.get(d.categoryId) : '—'),
    },
    { id: 'territory', header: 'Territory', cell: (d) => lk.byId.get(d.territoryId) ?? '—' },
    { id: 'city', header: 'City', mobile: 'secondary', cell: (d) => d.city ?? '—' },
    {
      id: 'approval',
      header: 'Status',
      mobile: 'secondary',
      // Plain-text badge; approved doctors show nothing.
      cell: (d) =>
        d.approvalStatus && d.approvalStatus !== 'approved' ? (
          <Badge variant="outline" data-testid="doctor-approval" data-status={d.approvalStatus}>
            {APPROVAL_LABEL[d.approvalStatus] ?? d.approvalStatus}
          </Badge>
        ) : null,
    },
  ];
  const canWrite = canWriteMasters(role);
  const [adding, setAdding] = useState(false);
  const [reload, setReload] = useState(0);
  if (!lk.ready) return <div className="h-96" aria-busy="true" />;
  return (
    <>
      <RecordSheet
        kind="doctors"
        open={adding}
        row={null}
        onOpenChange={setAdding}
        onSaved={() => setReload((n) => n + 1)}
      />
      <DataTable
        reloadKey={reload}
        label="doctors"
        source={source as never}
        columns={columns}
        rowKey={(d) => d.id}
        onRowClick={(d) => router.push(`/doctors?id=${d.id}`)}
        searchPlaceholder="Search doctors"
        actions={
          canWrite ? (
            <>
              <Button variant="outline" asChild>
                <Link href="/doctors/import" data-testid="master-import">
                  <FileSpreadsheet /> Import
                </Link>
              </Button>
              <Button data-testid="master-add" onClick={() => setAdding(true)}>
                <Plus /> Add doctor
              </Button>
            </>
          ) : undefined
        }
        empty={<p className="py-10 text-center text-sm text-muted-foreground">No doctors match.</p>}
      />
    </>
  );
}

const FEEDBACK: Record<string, string> = {
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative',
};

function Doctor360({ id }: { id: string }) {
  const lk = useLookups();
  const names = useProductNames();
  const [doc, setDoc] = useState<Doctor | null | undefined>(undefined);
  const [real, setReal] = useState<Visit[] | null>(null);
  const { role } = useRole();
  const [editing, setEditing] = useState(false);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      await apiReady();
      const today = todayYmd();
      const from = addDays(today, -HISTORY_DAYS);
      // Check-ins are filtered on the server by doctor (outletKind + outletId). /v1/dcrs has no doctor
      // filter yet (blocked on API), so DCRs are paged through in full instead of stopping at 200.
      const allDcrs = async () => {
        const items: Dcr[] = [];
        let cursor: string | undefined;
        for (let i = 0; i < 20; i++) {
          const r = await api.GET('/v1/dcrs', {
            params: { query: { from, to: today, limit: 200, ...(cursor ? { cursor } : {}) } },
          });
          items.push(...(r.data?.items ?? []));
          cursor = r.data?.nextCursor ?? undefined;
          if (!cursor) break;
        }
        return items;
      };
      const [one, dcrs, ci] = await Promise.all([
        api.GET('/v1/doctors/{id}', { params: { path: { id } } }),
        allDcrs(),
        api.GET('/v1/check-ins', {
          params: {
            query: {
              from,
              to: today,
              kind: 'visit',
              outletKind: 'doctor',
              outletId: id,
              limit: 200,
            },
          },
        }),
      ]);
      if (!live) return;
      setDoc(one.data ?? null);
      setReal(visitsFrom(id, dcrs, ci.data?.items ?? []));
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [id, rev]);

  // Rejected field-added doctor: Doctor carries rejectionReason/rejectedBy/rejectedAt (latest approval
  // decision; null when the viewer is outside the adder's line or the approvers).
  const rejection =
    doc?.approvalStatus === 'rejected' && doc.rejectionReason
      ? { comment: doc.rejectionReason, by: doc.rejectedBy?.name, at: doc.rejectedAt ?? null }
      : null;

  const category = lk.categories.find((c) => c.id === doc?.categoryId);
  const target = category?.visitsPerMonth ?? 0;
  const today = todayYmd();
  const visits = real;
  const month = thisMonth();
  const thisMonthVisits = (visits ?? []).filter((v) => v.date.startsWith(month));
  const samplesThisMonth = thisMonthVisits.reduce(
    (s, v) => s + v.samples.reduce((a, x) => a + x.quantity, 0),
    0,
  );
  const tally = productTally(visits ?? []);
  const monthly = [-2, -1, 0].map((n) => {
    const d = new Date(`${month}-15T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    const m = d.toISOString().slice(0, 7);
    return {
      name: monthLabel(m).split(' ')[0]!.slice(0, 3),
      visits: (visits ?? []).filter((v) => v.date.startsWith(m)).length,
    };
  });

  if (doc === undefined || !visits || !lk.ready) return <div className="h-96" aria-busy="true" />;
  if (doc === null)
    return (
      <div className="flex flex-col items-start gap-3 py-10">
        <p className="text-sm text-muted-foreground">This doctor isn’t in your list.</p>
        <Button asChild size="sm" variant="outline">
          <Link href="/doctors">Back to doctors</Link>
        </Button>
      </div>
    );

  const pct = target ? Math.min(100, Math.round((thisMonthVisits.length / target) * 100)) : null;
  const last = visits[0];
  return (
    <div className="flex flex-col gap-5" data-testid="doctor-360">
      <RecordSheet
        kind="doctors"
        open={editing}
        row={doc as unknown as MasterRow}
        onOpenChange={setEditing}
        onSaved={() => setRev((n) => n + 1)}
      />
      <Link
        href="/doctors"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        data-testid="doctor-back"
      >
        <ArrowLeft className="size-4" /> Doctors
      </Link>
      {rejection && (
        <RejectionNote
          reason={rejection.comment}
          byName={rejection.by}
          at={rejection.at}
          testId="doctor-rejection"
        />
      )}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight" data-testid="doctor-name">
            {doc.name}
          </h2>
          {category && <Badge variant="secondary">{category.name}</Badge>}
          {doc.approvalStatus && doc.approvalStatus !== 'approved' && (
            <Badge variant="outline" data-testid="doctor-approval-status">
              {APPROVAL_LABEL[doc.approvalStatus] ?? doc.approvalStatus}
            </Badge>
          )}
          {canWriteMasters(role) && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              data-testid="doctor-edit"
              onClick={() => setEditing(true)}
            >
              <Pencil /> Edit
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {[
            doc.qualification,
            doc.specialtyId && lk.byId.get(doc.specialtyId),
            doc.registrationNo && `Reg. ${doc.registrationNo}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" />
            {[doc.addressLine, doc.city, lk.byId.get(doc.territoryId)].filter(Boolean).join(', ')}
          </span>
          {doc.phone && (
            <a
              href={`tel:${doc.phone}`}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <Phone className="size-3.5" />
              {doc.phone}
            </a>
          )}
          {doc.email && (
            <a
              href={`mailto:${doc.email}`}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <Mail className="size-3.5" />
              {doc.email}
            </a>
          )}
          {doc.dateOfBirth && <span>Born {dayLabel(doc.dateOfBirth)}</span>}
          {doc.anniversary && <span>Anniversary {dayLabel(doc.anniversary)}</span>}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          testid="d360-frequency"
          label={`Visits in ${monthLabel(month)}`}
          value={`${thisMonthVisits.length}${target ? ` of ${target}` : ''}`}
        >
          {pct !== null ? (
            <Meter value={pct} label="Visit frequency" />
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">No category visit norm</p>
          )}
        </Stat>
        <Stat testid="d360-last" label="Last visit" value={last ? shortDate(last.date) : 'Never'}>
          <p className="mt-1 text-xs text-muted-foreground">
            {last
              ? `${Math.round((Date.parse(today) - Date.parse(last.date)) / 864e5)} days ago`
              : '—'}
          </p>
        </Stat>
        <Stat
          testid="d360-samples"
          label="Samples this month"
          value={`${samplesThisMonth} of ${SAMPLE_CAP_PER_MONTH}`}
        >
          <Meter
            value={Math.min(100, (samplesThisMonth / SAMPLE_CAP_PER_MONTH) * 100)}
            label="Samples against cap"
            over={samplesThisMonth > SAMPLE_CAP_PER_MONTH}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Cap is a placeholder, to confirm with Arighna
          </p>
        </Stat>
        <Stat
          testid="d360-pob"
          label={`POB, last ${HISTORY_DAYS} days`}
          value={`₹${visits.reduce((s, v) => s + (v.pobValue ?? 0), 0).toLocaleString('en-IN')}`}
        >
          <p className="mt-1 text-xs text-muted-foreground">
            {visits.filter((v) => v.pobValue).length} orders
          </p>
        </Stat>
      </div>

      <OutletLocksCard outletKind="doctor" outletId={doc.id} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="gap-0 py-0 shadow-xs">
          <CardHeader className="border-b px-4 py-4">
            <CardTitle className="text-base">Visits</CardTitle>
            <CardDescription>
              Last {HISTORY_DAYS} days from DCR calls and visit check-ins.
            </CardDescription>
          </CardHeader>
          <ol className="divide-y" data-testid="d360-visits">
            {visits.map((v, i) => (
              <li
                key={v.id}
                className="af-enter flex flex-col gap-1 px-4 py-3 text-sm"
                style={{ '--i': Math.min(i, 8) } as React.CSSProperties}
                data-testid="d360-visit"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium tabular-nums">{shortDate(v.date)}</span>
                  {v.inFence === false && (
                    <Badge variant="outline" className="font-normal text-amber-700">
                      Outside geofence
                    </Badge>
                  )}
                  {v.inFence === true && (
                    <span className="text-xs text-muted-foreground">GPS verified</span>
                  )}
                  {v.pobValue ? (
                    <span className="ml-auto text-xs tabular-nums">
                      POB ₹{v.pobValue.toLocaleString('en-IN')}
                    </span>
                  ) : null}
                </div>
                {v.products.length > 0 && (
                  <p className="text-muted-foreground">
                    Detailed:{' '}
                    {v.products.map((p) => names.get(p.productId) ?? 'Product').join(', ')}
                  </p>
                )}
                {v.samples.length > 0 && (
                  <p className="text-muted-foreground">
                    Samples:{' '}
                    {v.samples
                      .map((s) => `${names.get(s.productId) ?? 'Product'} × ${s.quantity}`)
                      .join(', ')}
                  </p>
                )}
                {v.remarks && <p className="text-muted-foreground">“{v.remarks}”</p>}
              </li>
            ))}
            {visits.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                No visits in the last {HISTORY_DAYS} days.
              </li>
            )}
          </ol>
        </Card>
        <div className="flex flex-col gap-5">
          <Card className="gap-0 py-0 shadow-xs">
            <CardHeader className="px-4 pt-4 pb-0">
              <CardTitle className="text-sm">Visits per month</CardTitle>
            </CardHeader>
            <div className="px-2 pb-2">
              <VisitsChart monthly={monthly} />
            </div>
          </Card>
          <Card className="gap-0 py-0 shadow-xs">
            <CardHeader className="border-b px-4 py-4">
              <CardTitle className="text-base">Products detailed</CardTitle>
            </CardHeader>
            <ul className="divide-y" data-testid="d360-products">
              {tally.map((p) => (
                <li key={p.productId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {names.get(p.productId) ?? 'Product'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {p.times}× · {p.samples} samples
                  </span>
                  {p.feedback && (
                    <span
                      className={cn(
                        'text-xs',
                        p.feedback === 'negative' ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {FEEDBACK[p.feedback]}
                    </span>
                  )}
                </li>
              ))}
              {tally.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Nothing detailed yet.
                </li>
              )}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  children,
  testid,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
  testid: string;
}) {
  return (
    <Card className="gap-0 px-4 py-3 shadow-xs" data-testid={testid}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {children}
    </Card>
  );
}

function Meter({ value, label, over }: { value: number; label: string; over?: boolean }) {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          'h-full w-full origin-left rounded-full transition-transform duration-500',
          over ? 'bg-destructive' : 'bg-primary',
        )}
        style={{ transform: `scaleX(${value / 100})` }}
      />
    </div>
  );
}
