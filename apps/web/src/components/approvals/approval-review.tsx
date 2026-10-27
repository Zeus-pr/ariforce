'use client';

import { useEffect, useState } from 'react';
import type { Approval, ApprovalDetail, ApprovalSubject } from '@ariforce/contracts';
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import { api, apiReady } from '@/lib/api';
import { openReceipt } from '@/lib/expenses/upload';

/**
 * Read-only view of what an approval decides on. Primary source: GET /v1/approvals/{id} (ApprovalDetail,
 * subject resolved server-side). `subject: null` means the caller may decide but not read the subject
 * (e.g. a manager above the requester) — shown plainly. Leave/expense/doctor requests that are not in the
 * approvals store (mock leave/expense flows) fall back to the subject's own endpoint.
 */
export function ApprovalReview({ approval }: { approval: Approval }) {
  const t = approval.subjectType;
  const [detail, setDetail] = useState<ApprovalDetail | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/approvals/{id}', { params: { path: { id: approval.id } } });
      if (live) setDetail((r.data as ApprovalDetail | undefined) ?? null);
    })().catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [approval.id]);
  const s = detail?.subject ?? null;
  return (
    <div className="mt-2 rounded-md border bg-muted/40 p-3 text-sm" data-testid="approval-review" data-type={t}>
      {detail === undefined ? (
        <Loading />
      ) : s ? (
        <SubjectView a={approval} s={s} />
      ) : detail && t === 'tour_plan' ? (
        <p className="text-muted-foreground" data-testid="review-no-access">
          {approval.summary}. You can decide this request, but its details are not visible to you.
        </p>
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

function SubjectView({ a, s }: { a: Approval; s: ApprovalSubject }) {
  if (s.type === 'tour_plan') return <TourPlanDetail a={a} s={s} />;
  if (s.type === 'leave') {
    const lv = s.request;
    return (
      <div className="grid gap-2">
        <dl className="grid gap-1">
          <Row k="Submitted by" v={a.requestedByName} />
          <Row k="Type" v={<span data-testid="review-leave-type">{lv.typeName}</span>} />
          <Row k="Dates" v={lv.fromDate === lv.toDate ? dayLabel(lv.fromDate) : `${dayLabel(lv.fromDate)} – ${dayLabel(lv.toDate)}`} />
          <Row k="Days" v={`${lv.days}${lv.half ? ` (${lv.half})` : ''}`} />
          <Row k="Reason" v={lv.reason || '—'} />
          <Row
            k="Balance"
            v={
              <span data-testid="review-balance">
                {!s.balance
                  ? '—'
                  : s.balance.availableBefore === null
                    ? 'Unlimited'
                    : `${s.balance.availableBefore} available now, ${s.balance.availableAfter ?? '—'} after this request`}
              </span>
            }
          />
        </dl>
        {s.overlaps.length > 0 && (
          <div data-testid="review-overlaps">
            <p className="font-medium">Also away on these dates</p>
            <ul className="grid gap-0.5">
              {s.overlaps.map((o) => (
                <li key={`${o.userId}-${o.fromDate}`}>
                  {o.userName} <span className="text-muted-foreground">{o.typeCode}, {dayLabel(o.fromDate)}{o.toDate !== o.fromDate ? ` – ${dayLabel(o.toDate)}` : ''}, {o.status === 'approved' ? 'Approved' : 'Pending'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (s.type === 'expense') {
    const c = s.claim;
    const receipts = (lineId: string) => s.receipts.filter((r) => r.lineId === lineId);
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
              {receipts(l.id).map((f, i, all) => (
                <Button key={f.attachmentId} asChild size="sm" variant="outline">
                  <a href={f.downloadUrl} target="_blank" rel="noreferrer" data-testid="review-receipt">
                    Receipt{all.length > 1 ? ` ${i + 1}` : ''}
                  </a>
                </Button>
              ))}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (s.type === 'doctor') {
    const d = s.doctor;
    return (
      <div className="grid gap-2">
        <dl className="grid gap-1">
          <Row k="Added by" v={a.requestedByName} />
          <Row k="Name" v={<span data-testid="review-doctor-name">{d.name}</span>} />
          <Row k="Registration no." v={d.registrationNo || '—'} />
          <Row k="Specialty" v={d.specialtyName || '—'} />
          <Row k="Category" v={d.categoryName || '—'} />
          <Row k="Territory" v={d.territory?.name || '—'} />
          <Row k="City" v={[d.city, d.pincode].filter(Boolean).join(', ') || '—'} />
        </dl>
        {s.possibleDuplicates.length > 0 && (
          <div data-testid="review-dups">
            <p className="font-medium">Possible duplicates flagged when added</p>
            <ul className="grid gap-0.5">
              {s.possibleDuplicates.map((x) => (
                <li key={x.id}>{x.name}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  return (
    <dl className="grid gap-1">
      <Row k="Requested by" v={a.requestedByName} />
      <Row k="DCR date" v={s.date ? dayLabel(s.date) : '—'} />
      <Row k="Reason" v={s.reason || '—'} />
    </dl>
  );
}

function TourPlanDetail({ a, s }: { a: Approval; s: Extract<ApprovalSubject, { type: 'tour_plan' }> }) {
  const sub = (s as { submission?: { submitterNote?: string | null; dates?: string[] } | null }).submission ?? null;
  const note = sub?.submitterNote ?? (s.plan as { submitterNote?: string | null }).submitterNote ?? null;
  const days = s.days.filter((d) => d.entries.length > 0);
  return (
    <div className="grid gap-2">
      <dl className="grid gap-1">
        <Row k="Submitted by" v={a.requestedByName} />
        <Row k="Month" v={<span data-testid="review-month">{monthLabel(s.plan.month)}</span>} />
        <Row k="Days in request" v={days.length} />
        {note && <Row k="Note" v={<span data-testid="review-note" className="whitespace-pre-wrap">{note}</span>} />}
      </dl>
      <ul className="max-h-80 divide-y overflow-y-auto overscroll-contain rounded-md border bg-background">
        {days.map((d) => (
          <li key={d.date} className="px-3 py-2" data-testid="review-day">
            <div className="font-medium">{dayLabel(d.date)}</div>
            {d.entries.map((e, i) => (
              <div key={i} className="text-muted-foreground">
                {e.session !== 'full' && <span className="uppercase">{e.session} · </span>}
                <span className="text-foreground">{e.workType?.name || 'Work type'}</span>
                {e.territories.length > 0 && <> · {e.territories.map((x) => x.name || '—').join(', ')}</>}
                {e.doctors.length > 0 && (
                  <div data-testid="review-doctors">Doctors: {e.doctors.map((x) => x.name || '—').join(', ')}</div>
                )}
                {e.chemists.length > 0 && <div>Chemists: {e.chemists.map((x) => x.name || '—').join(', ')}</div>}
                {e.jointWorkUsers.length > 0 && <div>Joint work: {e.jointWorkUsers.map((x) => x.name).join(', ')}</div>}
                {e.notes && <div className="italic">{e.notes}</div>}
              </div>
            ))}
          </li>
        ))}
      </ul>
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
