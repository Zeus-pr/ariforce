'use client';

import { useEffect, useState } from 'react';
import type { Approval } from '@ariforce/contracts';
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import { api, apiReady } from '@/lib/api';
import { openReceipt } from '@/lib/expenses/upload';

/**
 * Read-only view of what an approval decides on, loaded from the subject's own endpoints
 * (the Approval itself carries only subjectType/subjectId/summary).
 */
export function ApprovalReview({ approval }: { approval: Approval }) {
  const t = approval.subjectType;
  return (
    <div className="mt-2 rounded-md border bg-muted/40 p-3 text-sm" data-testid="approval-review" data-type={t}>
      {t === 'tour_plan' ? (
        <TourPlanReview a={approval} />
      ) : t === 'leave' ? (
        <LeaveReview a={approval} />
      ) : t === 'expense' ? (
        <ExpenseReview a={approval} />
      ) : t === 'doctor' ? (
        <DoctorReview a={approval} />
      ) : (
        <p>{approval.summary}</p>
      )}
    </div>
  );
}

const Loading = () => <p className="text-muted-foreground">Loading…</p>;
const Missing = ({ what }: { what: string }) => (
  <p className="text-muted-foreground" data-testid="review-missing">
    {what} could not be loaded.
  </p>
);
const dayLabel = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  );
const monthLabel = (m: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
const money = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex gap-2">
    <dt className="w-28 shrink-0 text-muted-foreground">{k}</dt>
    <dd className="min-w-0">{v}</dd>
  </div>
);

type Plan = {
  id: string;
  month: string;
  days: {
    date: string;
    entries: { session: string; workTypeId: string; territoryIds: string[]; plannedDoctorIds?: string[]; notes?: string | null }[];
  }[];
};

function TourPlanReview({ a }: { a: Approval }) {
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let live = true;
    void (async () => {
      await apiReady();
      // No GET /v1/tour-plans/{id}: list the submitter's plans (approvers have field:read over their team) and pick this one.
      let found: Plan | null = null;
      let cursor: string | undefined;
      for (let i = 0; i < 5 && !found; i++) {
        const r = await api.GET('/v1/tour-plans', {
          params: { query: { userId: a.requestedBy, limit: 50, cursor } as never },
        });
        const items = (r.data?.items ?? []) as unknown as Plan[];
        found = items.find((p) => p.id === a.subjectId) ?? null;
        cursor = (r.data as { nextCursor?: string | null } | undefined)?.nextCursor ?? undefined;
        if (!cursor) break;
      }
      if (!live) return;
      setPlan(found);
      if (!found) return;
      const [wt, tr] = await Promise.all([
        api.GET('/v1/work-types', { params: { query: { limit: 100 } } }),
        api.GET('/v1/territories', { params: { query: { limit: 200 } as never } }),
      ]);
      const m = new Map<string, string>();
      for (const w of wt.data?.items ?? []) m.set(w.id, w.name);
      for (const t of (tr.data?.items ?? []) as { id: string; name: string }[]) m.set(t.id, t.name);
      // No batch lookup by ids on /v1/doctors: fetch each planned doctor (deduplicated).
      const ids = [...new Set(found.days.flatMap((d) => d.entries.flatMap((e) => e.plannedDoctorIds ?? [])))];
      for (let i = 0; i < ids.length; i += 8) {
        const got = await Promise.all(
          ids.slice(i, i + 8).map((id) => api.GET('/v1/doctors/{id}', { params: { path: { id } } })),
        );
        got.forEach((r, j) => r.data && m.set(ids[i + j]!, r.data.name));
      }
      if (live) setNames(m);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [a.requestedBy, a.subjectId]);

  if (plan === undefined) return <Loading />;
  if (plan === null) return <Missing what="This tour plan" />;
  const days = plan.days.filter((d) => d.entries.length).sort((x, y) => x.date.localeCompare(y.date));
  const n = (id: string) => names.get(id) ?? '…';
  return (
    <div className="grid gap-2">
      <dl className="grid gap-1">
        <Row k="Submitted by" v={a.requestedByName} />
        <Row k="Month" v={<span data-testid="review-month">{monthLabel(plan.month)}</span>} />
        <Row k="Planned days" v={days.length} />
      </dl>
      {days.length === 0 ? (
        <p className="text-muted-foreground">No days planned.</p>
      ) : (
        <ul className="max-h-80 divide-y overflow-y-auto overscroll-contain rounded-md border bg-background">
          {days.map((d) =>
            d.entries.map((e, i) => (
              <li key={`${d.date}-${i}`} className="grid gap-0.5 px-3 py-2" data-testid="review-day" data-date={d.date}>
                <p className="font-medium">
                  {dayLabel(d.date)}
                  {e.session !== 'full' && <span className="text-muted-foreground"> · {e.session.toUpperCase()}</span>}
                  <span className="font-normal"> · {n(e.workTypeId)}</span>
                </p>
                {e.territoryIds.length > 0 && (
                  <p className="text-muted-foreground">{e.territoryIds.map(n).join(', ')}</p>
                )}
                {(e.plannedDoctorIds ?? []).length > 0 && (
                  <p data-testid="review-doctors">Doctors: {(e.plannedDoctorIds ?? []).map(n).join(', ')}</p>
                )}
                {e.notes && <p className="text-muted-foreground">Note: {e.notes}</p>}
              </li>
            )),
          )}
        </ul>
      )}
    </div>
  );
}

type Leave = { typeName: string; typeCode: string; fromDate: string; toDate: string; half: string | null; days: number; reason: string | null; year: number };
function LeaveReview({ a }: { a: Approval }) {
  const [lv, setLv] = useState<Leave | null | undefined>(undefined);
  const [bal, setBal] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/leave/requests/{id}', { params: { path: { id: a.subjectId } } });
      const l = (r.data as unknown as Leave | undefined) ?? null;
      if (!live) return;
      setLv(l);
      if (!l) return;
      const b = await api.GET('/v1/leave/balances', { params: { query: { userId: a.requestedBy, year: l.year } } });
      const it = b.data?.items.find((x) => x.typeCode === l.typeCode);
      if (live && it) setBal(it.unlimited || it.available === null ? 'Unlimited' : `${it.available} available, ${it.pending} pending`);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [a.subjectId, a.requestedBy]);
  if (lv === undefined) return <Loading />;
  if (lv === null) return <Missing what="This leave request" />;
  return (
    <dl className="grid gap-1">
      <Row k="Submitted by" v={a.requestedByName} />
      <Row k="Type" v={<span data-testid="review-leave-type">{lv.typeName}</span>} />
      <Row k="Dates" v={lv.fromDate === lv.toDate ? dayLabel(lv.fromDate) : `${dayLabel(lv.fromDate)} – ${dayLabel(lv.toDate)}`} />
      <Row k="Days" v={`${lv.days}${lv.half ? ` (${lv.half})` : ''}`} />
      <Row k="Reason" v={lv.reason || '—'} />
      <Row k="Balance" v={<span data-testid="review-balance">{bal ?? '—'}</span>} />
    </dl>
  );
}

type Claim = {
  month: string;
  total: number;
  lines: { id: string; date: string; category: string; amount: number; notes: string | null; attachments: { id: string }[] }[];
};
function ExpenseReview({ a }: { a: Approval }) {
  const [c, setC] = useState<Claim | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/expense-claims/{id}', { params: { path: { id: a.subjectId } } });
      if (live) setC((r.data as unknown as Claim | undefined) ?? null);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [a.subjectId]);
  if (c === undefined) return <Loading />;
  if (c === null) return <Missing what="This expense claim" />;
  return (
    <div className="grid gap-2">
      <dl className="grid gap-1">
        <Row k="Submitted by" v={a.requestedByName} />
        <Row k="Month" v={monthLabel(c.month)} />
        <Row k="Total" v={<span data-testid="review-total">{money(c.total)}</span>} />
      </dl>
      <ul className="max-h-80 divide-y overflow-y-auto overscroll-contain rounded-md border bg-background">
        {c.lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid="review-line">
            <span className="w-24 text-muted-foreground">{dayLabel(l.date)}</span>
            <span className="flex-1 capitalize">
              {l.category.replace(/_/g, ' ')}
              {l.notes && <span className="text-muted-foreground"> · {l.notes}</span>}
            </span>
            <span className="tabular-nums">{money(l.amount)}</span>
            {l.attachments.map((f, i) => (
              <Button key={f.id} size="sm" variant="outline" onClick={() => void openReceipt(f.id)} data-testid="review-receipt">
                Receipt{l.attachments.length > 1 ? ` ${i + 1}` : ''}
              </Button>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

type Dup = { id: string; name: string; territoryName: string; rule: string };
type Doc = { name: string; registrationNo?: string | null; pincode?: string | null; territoryId: string; qualification?: string | null };
function DoctorReview({ a }: { a: Approval }) {
  const [d, setD] = useState<Doc | null | undefined>(undefined);
  const [terr, setTerr] = useState('');
  const [dups, setDups] = useState<Dup[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/doctors/{id}', { params: { path: { id: a.subjectId } } });
      const doc = (r.data as unknown as Doc | undefined) ?? null;
      if (!live) return;
      setD(doc);
      if (!doc) return;
      const [t, m] = await Promise.all([
        api.GET('/v1/territories', { params: { query: { limit: 200 } as never } }),
        api.POST('/v1/doctors/duplicate-check', {
          body: { name: doc.name, pincode: doc.pincode ?? null, registrationNo: doc.registrationNo ?? null },
        }),
      ]);
      if (!live) return;
      setTerr(((t.data?.items ?? []) as { id: string; name: string }[]).find((x) => x.id === doc.territoryId)?.name ?? '');
      setDups(((m.data?.matches ?? []) as Dup[]).filter((x) => x.id !== a.subjectId));
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [a.subjectId]);
  if (d === undefined) return <Loading />;
  if (d === null) return <Missing what="This doctor" />;
  return (
    <div className="grid gap-2">
      <dl className="grid gap-1">
        <Row k="Added by" v={a.requestedByName} />
        <Row k="Name" v={<span data-testid="review-doctor-name">{d.name}</span>} />
        <Row k="Registration no." v={d.registrationNo || '—'} />
        <Row k="Qualification" v={d.qualification || '—'} />
        <Row k="Territory" v={terr || '—'} />
        <Row k="PIN code" v={d.pincode || '—'} />
      </dl>
      {dups.length > 0 && (
        <div data-testid="review-dups">
          <p className="font-medium">Possible duplicates</p>
          <ul className="grid gap-1">
            {dups.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2">
                {x.name} <span className="text-muted-foreground">{x.territoryName}</span>
                <Badge variant="outline">{x.rule === 'registration_no' ? 'Same registration no.' : 'Same name and PIN code'}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
