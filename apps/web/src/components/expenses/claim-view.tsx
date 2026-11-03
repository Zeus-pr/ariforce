'use client';

import { RejectionNote } from '@/components/approvals/rejection-note';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  LoaderCircle,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  Wallet,
} from 'lucide-react';
import type { ExpenseCategory, ExpenseClaim, ExpenseReconciliation } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@ariforce/ui/components/sheet';
import { toast } from '@ariforce/ui/components/sonner';
import { cn } from '@ariforce/ui/lib/utils';
import { api, apiReady, toApiError } from '@/lib/api';
import { canPayExpenses } from '@/lib/permissions';
import {
  can,
  CATEGORY_LABEL,
  dayLabel,
  isEditable,
  messageFor,
  money,
  monthLabel,
  selfId,
} from '@/lib/expenses/model';
import { useRole } from '@/components/shell/role-context';
import { AllowanceDialog } from './allowance-dialog';
import { ApprovalTrail } from './approval-trail';
import { ExpenseFlow } from './expense-flow';
import { Receipts } from './receipts';
import { StatusBadge } from './status-badge';

type Claim = ExpenseClaim;
type Line = Claim['lines'][number];
type Recon = Omit<ExpenseReconciliation, 'byCategory'> & {
  byCategory?: Partial<Record<ExpenseCategory, number>>;
};
const DCR_TONE: Record<string, string> = {
  approved: 'bg-emerald-50 text-emerald-700',
  submitted: 'bg-teal-50 text-teal-700',
  draft: 'bg-slate-100 text-slate-700',
  locked: 'bg-slate-100 text-slate-700',
  rejected: 'bg-red-50 text-red-700',
};

export function ClaimView({ id }: { id: string }) {
  const { role, user } = useRole();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ line: Line | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [allowances, setAllowances] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [paying, setPaying] = useState(false);
  const [paymentRef, setPaymentRef] = useState('');
  const [recon, setRecon] = useState<Recon | null>(null);

  const load = useCallback(async () => {
    await apiReady();
    const [r, m] = await Promise.all([
      api.GET('/v1/expense-claims/{id}', { params: { path: { id } } }),
      selfId(role, user),
    ]);
    setMe(m);
    if (r.error || !r.data) return setError(messageFor(toApiError(r)));
    setError(null);
    setClaim(r.data as Claim);
  }, [id, role, user]);
  useEffect(() => void load(), [load]);

  const mine = !!claim && claim.userId === me;
  const editable = !!claim && mine && isEditable(claim.status) && can(role, 'expenses:write');
  // Server flags (PR #93) when present; role checks for older responses.
  const mayDecide =
    !!claim &&
    (claim.canDecide ?? (!mine && claim.status === 'submitted' && can(role, 'expenses:approve')));
  const mayPay =
    !!claim && (claim.canPay ?? (!mine && claim.status === 'approved' && canPayExpenses(role)));
  const seeRecon =
    !!claim &&
    claim.status !== 'draft' &&
    (!mine || can(role, 'expenses:approve') || can(role, 'finance:read'));

  useEffect(() => {
    if (!claim || !seeRecon) return setRecon(null);
    void api
      .GET('/v1/expense-claims/{id}/reconciliation', { params: { path: { id: claim.id } } })
      .then((r) => setRecon((r.data as Recon) ?? null));
  }, [claim, seeRecon]);

  async function run(key: string, fn: () => Promise<{ error?: unknown }>, ok: string) {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (r.error) {
      toast.error(messageFor(toApiError(r)));
      return false;
    }
    toast.success(ok);
    await load();
    return true;
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        data-testid="exp-error"
      >
        {error}
        <Button size="sm" variant="outline" asChild>
          <Link href="/expenses">Back to expenses</Link>
        </Button>
      </div>
    );
  }
  if (!claim)
    return (
      <div
        className="h-48 animate-pulse rounded-lg bg-muted/60"
        aria-busy="true"
        data-testid="exp-loading"
      />
    );

  const c = claim;
  const lines = [...c.lines].sort((a, b) => a.date.localeCompare(b.date));
  const autoLines = editable ? lines.filter((l) => l.source === 'auto') : [];
  const shown = editable ? lines.filter((l) => l.source !== 'auto') : lines;
  const byDay = shown.reduce<Record<string, Line[]>>((m, l) => {
    (m[l.date] ??= []).push(l);
    return m;
  }, {});
  const hotelMissing = c.lines.some(
    (l) => l.category === 'hotel' && !l.attachments.some((a) => a.status === 'confirmed'),
  );
  const dcrGapDays = recon?.days.filter((d) => d.dcrStatus !== 'approved') ?? [];
  const approveBlock =
    c.dcrRejectedDates.length > 0
      ? `DCR rejected on ${c.dcrRejectedDates.map(dayLabel).join(', ')}`
      : dcrGapDays.length > 0
        ? `DCR not approved for ${dcrGapDays.length} day${dcrGapDays.length === 1 ? '' : 's'}`
        : null;
  const byCategory =
    recon?.byCategory ??
    c.lines.reduce<Partial<Record<ExpenseCategory, number>>>((m, l) => {
      m[l.category] = (m[l.category] ?? 0) + l.amount;
      return m;
    }, {});

  async function confirmAuto(l: Line) {
    await run(
      l.id,
      () =>
        api.PUT('/v1/expense-claims/{id}/lines/{lineId}', {
          params: { path: { id: c.id, lineId: l.id } },
          body: {
            line: {
              date: l.date,
              category: l.category,
              amount: l.amount,
              notes: l.notes,
              mileageKm: l.mileageKm,
              dcrId: l.dcrId,
              tourPlanId: l.tourPlanId,
            },
            version: l.version,
          },
        }),
      'Confirmed',
    );
  }

  const submit = () =>
    run(
      'submit',
      () => api.POST('/v1/expense-claims/{id}/submit', { params: { path: { id: c.id } } }),
      'Submitted for approval',
    );
  const decide = (decision: 'approve' | 'reject') =>
    run(
      decision,
      () =>
        api.POST('/v1/expense-claims/{id}/decision', {
          params: { path: { id: c.id } },
          body: decision === 'reject' ? { decision, comment: comment.trim() } : { decision },
        }),
      decision === 'approve' ? 'Approved' : 'Rejected',
    ).then((ok) => ok && setRejecting(false));

  const hasBar = editable || mayDecide || mayPay;

  return (
    <div
      className={cn('flex flex-col gap-5', hasBar && 'pb-24')}
      data-testid="exp-claim"
      data-status={c.status}
    >
      <div className="flex flex-col gap-2">
        <Link
          href="/expenses"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Expenses
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-brand-600">
              {monthLabel(c.month)}
            </h1>
            {!mine && <p className="text-sm text-muted-foreground">{c.userName}</p>}
            {c.status === 'submitted' && c.currentApprover && (
              <p className="text-sm text-teal-700" data-testid="exp-current-approver">
                Waiting for {c.currentApprover.name}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-semibold tabular-nums" data-testid="exp-total">
              {money(c.total)}
            </span>
            <StatusBadge status={c.status} testId="exp-claim-status" />
          </div>
        </div>
      </div>

      {c.status !== 'draft' && (
        <section className="rounded-xl border bg-background p-4" aria-label="Approval">
          <ApprovalTrail claim={c} />
        </section>
      )}

      {mine && c.status === 'rejected' && (c.rejectionReason ?? c.decisionComment) && (
        <RejectionNote
          reason={(c.rejectionReason ?? c.decisionComment)!}
          byName={c.rejectedBy?.name}
          at={c.rejectedAt ?? c.decidedAt}
          testId="exp-reject-comment"
        />
      )}

      {editable &&
        (autoLines.length > 0 ? (
          <section
            className="flex flex-col gap-3 rounded-xl border border-teal-200 bg-teal-50/60 p-4"
            data-testid="exp-auto"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-medium text-teal-700">
                <Sparkles className="size-4" aria-hidden /> Auto-filled from your DCR
              </h2>
              <Button
                size="sm"
                variant="ghost"
                className="text-teal-700"
                onClick={() => setAllowances(true)}
                data-testid="exp-add-allowances"
              >
                Recalculate
              </Button>
            </div>
            <ul className="flex flex-col gap-2">
              {autoLines.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg bg-background px-3 py-2"
                  data-testid="exp-auto-line"
                >
                  <span className="min-w-0 flex-1 text-sm">
                    <b className="font-medium">{CATEGORY_LABEL[l.category]}</b>
                    <span className="text-muted-foreground">
                      {' '}
                      · {dayLabel(l.date)}
                      {l.mileageKm != null && ` · ${l.mileageKm} km`}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">{money(l.amount)}</span>
                  <Button size="sm" variant="ghost" onClick={() => setEdit({ line: l })}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    className="bg-teal-600 hover:bg-teal-700"
                    disabled={busy === l.id}
                    onClick={() => confirmAuto(l)}
                    data-testid="exp-auto-confirm"
                  >
                    {busy === l.id ? (
                      <LoaderCircle className="animate-spin" aria-hidden />
                    ) : (
                      <Check aria-hidden />
                    )}
                    Confirm
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <button
            type="button"
            onClick={() => setAllowances(true)}
            className="flex items-center gap-2 rounded-xl border border-dashed border-teal-300 px-4 py-3 text-sm font-medium text-teal-700 hover:bg-teal-50"
            data-testid="exp-add-allowances"
          >
            <Sparkles className="size-4" aria-hidden /> Fill TA/DA from your DCRs
          </button>
        ))}

      {(mayDecide || mayPay || (!mine && recon)) && (
        <section className="grid gap-3 sm:grid-cols-2" data-testid="exp-approver-summary">
          <div className="rounded-xl border p-4">
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">By type</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {Object.entries(byCategory)
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <li key={k} className="flex justify-between">
                    <span>{CATEGORY_LABEL[k as ExpenseCategory]}</span>
                    <span className="tabular-nums">{money(v!)}</span>
                  </li>
                ))}
            </ul>
          </div>
          {recon && (
            <div className="rounded-xl border p-4" data-testid="exp-recon">
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">DCR by day</h2>
              <ul className="flex flex-wrap gap-1.5 text-xs">
                {recon.days.map((d) => (
                  <li
                    key={d.date}
                    className={cn(
                      'rounded px-1.5 py-0.5',
                      DCR_TONE[d.dcrStatus ?? ''] ?? 'bg-amber-100 text-amber-900',
                    )}
                    title={d.dcrStatus ?? 'No DCR'}
                    data-testid="exp-recon-day"
                    data-flags={d.flags.join(' ')}
                  >
                    {dayLabel(d.date)} · {d.dcrStatus ?? 'no DCR'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3" aria-label="Expenses" data-testid="exp-lines">
        {Object.keys(byDay).length === 0 && !editable && (
          <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            No expenses.
          </p>
        )}
        {Object.entries(byDay).map(([d, ls]) => (
          <article key={d} className="rounded-xl border bg-background" data-testid="exp-day">
            <header className="flex items-center justify-between px-4 pt-3 text-sm">
              <span className="font-medium">{dayLabel(d)}</span>
              <span className="text-muted-foreground tabular-nums">
                {money(ls.reduce((s, l) => s + l.amount, 0))}
              </span>
            </header>
            <ul className="flex flex-col">
              {ls.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-col gap-2 px-4 py-3"
                  data-testid="exp-line"
                  data-category={l.category}
                >
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={!editable}
                      onClick={() => setEdit({ line: l })}
                      className="min-w-0 flex-1 text-left disabled:cursor-default"
                      data-testid="exp-line-edit"
                    >
                      <p className="text-sm font-medium">
                        {CATEGORY_LABEL[l.category]}
                        {l.mileageKm != null && (
                          <span className="font-normal text-muted-foreground">
                            {' '}
                            · {l.mileageKm} km
                          </span>
                        )}
                        {c.dcrRejectedDates.includes(l.date) && (
                          <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">
                            DCR rejected
                          </span>
                        )}
                      </p>
                      {l.notes && (
                        <p className="truncate text-xs text-muted-foreground">{l.notes}</p>
                      )}
                    </button>
                    <span className="font-semibold tabular-nums">{money(l.amount)}</span>
                    {editable && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground"
                        aria-label="Delete expense"
                        disabled={busy === l.id}
                        data-testid="exp-line-delete"
                        onClick={() =>
                          run(
                            l.id,
                            () =>
                              api.DELETE('/v1/expense-claims/{id}/lines/{lineId}', {
                                params: { path: { id: c.id, lineId: l.id } },
                              }),
                            'Deleted',
                          )
                        }
                      >
                        {busy === l.id ? (
                          <LoaderCircle className="animate-spin" aria-hidden />
                        ) : (
                          <Trash2 aria-hidden />
                        )}
                      </Button>
                    )}
                  </div>
                  {(editable || l.attachments.length > 0) && (
                    <Receipts claimId={c.id} line={l} editable={editable} onChange={load} />
                  )}
                </li>
              ))}
            </ul>
          </article>
        ))}
        {editable && (
          <button
            type="button"
            onClick={() => setEdit({ line: null })}
            className="flex items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-4 text-sm font-medium text-brand-600 hover:border-brand-300 hover:bg-brand-50"
            data-testid="exp-add-expense"
          >
            <Plus className="size-4" aria-hidden /> Add expense
          </button>
        )}
      </section>

      {hasBar && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur"
          data-testid="exp-action-bar"
        >
          <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-end gap-3 px-4 py-3 sm:px-6">
            {editable && (
              <>
                {(hotelMissing || autoLines.length > 0) && (
                  <span className="mr-auto text-sm text-amber-800">
                    {hotelMissing ? 'Hotel receipt missing' : 'Confirm auto-filled TA/DA first'}
                  </span>
                )}
                <Button
                  className="bg-brand-600 hover:bg-brand-700"
                  disabled={busy === 'submit' || c.lines.length === 0 || hotelMissing}
                  onClick={submit}
                  data-testid="exp-submit"
                >
                  {busy === 'submit' ? (
                    <LoaderCircle className="animate-spin" aria-hidden />
                  ) : (
                    <Send aria-hidden />
                  )}
                  {c.status === 'rejected' ? 'Resubmit' : 'Submit'} · {money(c.total)}
                </Button>
              </>
            )}
            {mayDecide &&
              (rejecting ? (
                <div className="flex w-full flex-wrap items-center gap-2">
                  <Input
                    autoFocus
                    value={comment}
                    maxLength={1000}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Reason for rejecting"
                    className="min-w-0 flex-1"
                    data-testid="exp-decide-comment"
                  />
                  <Button variant="ghost" onClick={() => setRejecting(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={!comment.trim() || busy === 'reject'}
                    onClick={() => decide('reject')}
                    data-testid="exp-decide-confirm"
                  >
                    {busy === 'reject' && <LoaderCircle className="animate-spin" aria-hidden />}
                    Reject
                  </Button>
                </div>
              ) : (
                <>
                  {approveBlock && (
                    <span
                      className="mr-auto text-sm text-amber-800"
                      data-testid="exp-approve-block"
                    >
                      {approveBlock}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setComment('');
                      setRejecting(true);
                    }}
                    data-testid="exp-reject"
                  >
                    <Undo2 aria-hidden /> Reject
                  </Button>
                  <Button
                    className="bg-brand-600 hover:bg-brand-700"
                    disabled={!!approveBlock || busy === 'approve'}
                    onClick={() => decide('approve')}
                    data-testid="exp-approve"
                  >
                    {busy === 'approve' ? (
                      <LoaderCircle className="animate-spin" aria-hidden />
                    ) : (
                      <Check aria-hidden />
                    )}
                    Approve
                  </Button>
                </>
              ))}
            {mayPay && (
              <Button
                className="bg-brand-600 hover:bg-brand-700"
                onClick={() => {
                  setPaymentRef('');
                  setPaying(true);
                }}
                data-testid="exp-pay"
              >
                <Wallet aria-hidden /> Mark paid · {money(c.total)}
              </Button>
            )}
          </div>
        </div>
      )}

      {editable && (
        <AllowanceDialog
          claimId={c.id}
          open={allowances}
          onClose={() => setAllowances(false)}
          onDone={() => {
            toast.success('TA/DA filled');
            void load();
          }}
        />
      )}
      {editable && (
        <ExpenseFlow
          open={!!edit}
          claim={c}
          line={edit?.line ?? null}
          onClose={() => setEdit(null)}
          onSaved={(_, submitted) => {
            toast.success(submitted ? 'Submitted for approval' : 'Saved');
            void load();
          }}
        />
      )}

      <Sheet open={paying} onOpenChange={setPaying}>
        <SheetContent
          side="bottom"
          className="mx-auto max-w-lg rounded-t-2xl"
          data-testid="exp-pay-dialog"
        >
          <SheetHeader>
            <SheetTitle>
              Mark paid · {c.userName} · {money(c.total)}
            </SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-1.5 px-4">
            <Label htmlFor="exp-pay-ref">Payment reference</Label>
            <Input
              id="exp-pay-ref"
              autoFocus
              value={paymentRef}
              maxLength={200}
              onChange={(e) => setPaymentRef(e.target.value)}
              placeholder="UTR / cheque no."
              data-testid="exp-pay-ref"
            />
          </div>
          <SheetFooter>
            <Button
              className="bg-brand-600 hover:bg-brand-700"
              disabled={!paymentRef.trim() || busy === 'pay'}
              data-testid="exp-pay-confirm"
              onClick={async () => {
                const ok = await run(
                  'pay',
                  () =>
                    api.POST('/v1/expense-claims/{id}/pay', {
                      params: { path: { id: c.id } },
                      body: { paymentRef: paymentRef.trim() },
                    }),
                  'Marked as paid',
                );
                if (ok) setPaying(false);
              }}
            >
              {busy === 'pay' && <LoaderCircle className="animate-spin" aria-hidden />}
              Mark paid
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
