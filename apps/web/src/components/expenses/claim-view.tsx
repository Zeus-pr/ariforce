'use client';

import { RejectionNote } from '@/components/approvals/rejection-note';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  Send,
  Trash2,
  Undo2,
  Wallet,
} from 'lucide-react';
import type { ExpenseClaim, ExpenseReconciliation } from '@ariforce/contracts';
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
import { toast } from '@ariforce/ui/components/sonner';
import { api, apiReady, toApiError } from '@/lib/api';
import { canPayExpenses } from '@/lib/permissions';
import {
  can,
  CATEGORY_LABEL,
  isEditable,
  messageFor,
  money,
  monthLabel,
  selfId,
} from '@/lib/expenses/model';
import { useRole } from '@/components/shell/role-context';
import { LineDialog, type LineDraft } from './line-dialog';
import { AllowanceDialog } from './allowance-dialog';
import { Receipts } from './receipts';
import { StatusBadge } from './status-badge';

type Claim = ExpenseClaim;
type Line = Claim['lines'][number];
const day = (d: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));
const FLAG: Record<string, string> = {
  no_dcr: 'No DCR',
  dcr_not_submitted: 'DCR not submitted',
  dcr_link_mismatch: 'Linked DCR is another day',
  non_field_day: 'Not a field day',
  outside_month: 'Outside the month',
};

export function ClaimView({ id }: { id: string }) {
  const { role, user } = useRole();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ line: Line | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [allowances, setAllowances] = useState(false);
  const [decide, setDecide] = useState<'approve' | 'reject' | null>(null);
  const [comment, setComment] = useState('');
  const [paying, setPaying] = useState(false);
  const [paymentRef, setPaymentRef] = useState('');
  const [recon, setRecon] = useState<Omit<ExpenseReconciliation, 'byCategory'> | null>(null);

  const load = useCallback(async () => {
    await apiReady();
    const [r, m] = await Promise.all([
      api.GET('/v1/expense-claims/{id}', { params: { path: { id } } }),
      selfId(role, user),
    ]);
    setMe(m);
    if (r.error || !r.data) return setError(messageFor(toApiError(r)));
    setError(null);
    setClaim(r.data);
  }, [id, role, user]);
  useEffect(() => void load(), [load]);

  const mine = !!claim && claim.userId === me;
  const editable = !!claim && mine && isEditable(claim.status) && can(role, 'expenses:write');
  const mayDecide =
    !!claim && !mine && claim.status === 'submitted' && can(role, 'expenses:approve');
  const mayPay = !!claim && claim.status === 'approved' && canPayExpenses(role);
  const seeRecon =
    !!claim &&
    claim.status !== 'draft' &&
    (!mine || can(role, 'expenses:approve') || can(role, 'finance:read'));

  useEffect(() => {
    if (!claim || !seeRecon) return setRecon(null);
    void api
      .GET('/v1/expense-claims/{id}/reconciliation', { params: { path: { id: claim.id } } })
      .then((r) => setRecon(r.data ?? null));
  }, [claim, seeRecon]);

  async function saveLine(d: LineDraft, line: Line | null): Promise<string | null> {
    if (!claim) return null;
    const r = line
      ? await api.PUT('/v1/expense-claims/{id}/lines/{lineId}', {
          params: { path: { id: claim.id, lineId: line.id } },
          body: { line: d, version: line.version },
        })
      : await api.POST('/v1/expense-claims/{id}/lines', {
          params: { path: { id: claim.id } },
          body: d,
        });
    if (r.error) {
      const e = toApiError(r);
      if (e.code === 'VERSION_CONFLICT') void load();
      return messageFor(e);
    }
    toast.success(line ? 'Line saved' : 'Line added');
    await load();
    return null;
  }

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
          <Link href="/expenses">Back to claims</Link>
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

  const hotelMissing = claim.lines.some(
    (l) => l.category === 'hotel' && !l.attachments.some((a) => a.status === 'confirmed'),
  );
  const lines = [...claim.lines].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="flex flex-col gap-4" data-testid="exp-claim" data-status={claim.status}>
      <div className="flex flex-col gap-2">
        <Link
          href="/expenses"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> All claims
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{monthLabel(claim.month)}</h1>
            <p className="text-sm text-muted-foreground">{mine ? 'Your claim' : claim.userName}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xl font-semibold tabular-nums" data-testid="exp-total">
              {money(claim.total)}
            </span>
            <StatusBadge status={claim.status} testId="exp-claim-status" />
          </div>
        </div>
      </div>

      {claim.status === 'rejected' && (claim.rejectionReason ?? claim.decisionComment) && (
        <RejectionNote
          reason={(claim.rejectionReason ?? claim.decisionComment)!}
          byName={claim.rejectedBy?.name}
          at={claim.rejectedAt ?? claim.decidedAt}
          hint={mine ? 'Fix the lines and submit again.' : undefined}
          testId="exp-reject-comment"
        />
      )}
      {claim.status === 'paid' && (
        <p className="rounded-lg border bg-sky-50 p-3 text-sm text-sky-900" data-testid="exp-paid">
          Paid · reference {claim.paymentRef}
        </p>
      )}

      <section aria-labelledby="exp-lines-h" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 id="exp-lines-h" className="text-base font-semibold">
            Lines
          </h2>
          {editable && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAllowances(true)}
                data-testid="exp-add-allowances"
              >
                Add allowances
              </Button>
              <Button size="sm" onClick={() => setEdit({ line: null })} data-testid="exp-add-line">
                <Plus aria-hidden /> Add line
              </Button>
            </div>
          )}
        </div>
        {lines.length === 0 ? (
          <p
            className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground"
            data-testid="exp-no-lines"
          >
            {editable ? 'No lines yet. Add what you spent this month.' : 'No lines.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="exp-lines">
            {lines.map((l) => (
              <li
                key={l.id}
                className="rounded-lg border p-3"
                data-testid="exp-line"
                data-category={l.category}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {CATEGORY_LABEL[l.category]}
                      {l.mileageKm != null && ` · ${l.mileageKm} km`}
                      <span
                        className={
                          l.source === 'auto'
                            ? 'rounded bg-sky-100 px-1.5 py-0.5 text-xs font-normal text-sky-900'
                            : 'rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground'
                        }
                        data-testid="exp-line-source"
                        data-source={l.source}
                        title={
                          l.source === 'auto'
                            ? 'Drafted from your DCR and the rate card. Editing it or adding a receipt makes it manual.'
                            : undefined
                        }
                      >
                        {l.source === 'auto' ? 'Auto' : 'Manual'}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {day(l.date)}
                      {l.dcrId && ' · DCR linked'}
                      {l.tourPlanId && ' · Tour plan linked'}
                    </p>
                    {l.notes && <p className="mt-1 text-sm break-words">{l.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="mr-1 text-sm font-semibold tabular-nums">
                      {money(l.amount)}
                    </span>
                    {editable && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label="Edit line"
                          onClick={() => setEdit({ line: l })}
                          data-testid="exp-line-edit"
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label="Delete line"
                          disabled={busy === l.id}
                          data-testid="exp-line-delete"
                          onClick={() =>
                            run(
                              l.id,
                              () =>
                                api.DELETE('/v1/expense-claims/{id}/lines/{lineId}', {
                                  params: { path: { id: claim.id, lineId: l.id } },
                                }),
                              'Line deleted',
                            )
                          }
                        >
                          {busy === l.id ? (
                            <LoaderCircle className="animate-spin" aria-hidden />
                          ) : (
                            <Trash2 aria-hidden />
                          )}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="mt-2">
                  <Receipts claimId={claim.id} line={l} editable={editable} onChange={load} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editable && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
          {hotelMissing && <p className="text-sm text-amber-800">Add the hotel receipt first.</p>}
          <Button
            disabled={busy === 'submit' || lines.length === 0 || hotelMissing}
            data-testid="exp-submit"
            onClick={() =>
              run(
                'submit',
                () =>
                  api.POST('/v1/expense-claims/{id}/submit', {
                    params: { path: { id: claim.id } },
                  }),
                'Sent for approval',
              )
            }
          >
            {busy === 'submit' ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <Send aria-hidden />
            )}
            {claim.status === 'rejected' ? 'Submit again' : 'Submit for approval'}
          </Button>
        </div>
      )}
      {mayDecide && (
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button
            variant="outline"
            onClick={() => {
              setComment('');
              setDecide('reject');
            }}
            data-testid="exp-reject"
          >
            <Undo2 aria-hidden /> Send back
          </Button>
          <Button
            onClick={() => {
              setComment('');
              setDecide('approve');
            }}
            data-testid="exp-approve"
          >
            <Check aria-hidden /> Approve
          </Button>
        </div>
      )}
      {mayPay && (
        <div className="flex justify-end border-t pt-4">
          <Button
            onClick={() => {
              setPaymentRef('');
              setPaying(true);
            }}
            data-testid="exp-pay"
          >
            <Wallet aria-hidden /> Mark as paid
          </Button>
        </div>
      )}

      {recon && (
        <section
          aria-labelledby="exp-recon-h"
          className="flex flex-col gap-2"
          data-testid="exp-recon"
        >
          <h2 id="exp-recon-h" className="text-base font-semibold">
            Check against DCRs
          </h2>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Days claimed', String(recon.claimedDays)],
              ['DCR days', String(recon.dcrDays)],
              ['Matched', String(recon.matchedDays)],
              ['On flagged days', money(recon.unmatchedAmount)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border p-2">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="text-sm font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <ul className="divide-y rounded-lg border text-sm">
            {recon.days.map((d) => (
              <li
                key={d.date}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                data-testid="exp-recon-day"
                data-flags={d.flags.join(' ')}
              >
                <span>{day(d.date)}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {d.flags.length ? (
                    d.flags.map((f) => (
                      <span
                        key={f}
                        className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900"
                      >
                        {FLAG[f] ?? f}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-emerald-800">Matches DCR</span>
                  )}
                  <span className="tabular-nums">{money(d.claimed)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editable && (
        <AllowanceDialog
          claimId={claim.id}
          open={allowances}
          onClose={() => setAllowances(false)}
          onDone={() => {
            toast.success('Allowances added');
            void load();
          }}
        />
      )}
      <LineDialog
        open={!!edit}
        month={claim.month}
        line={edit?.line ?? null}
        onClose={() => setEdit(null)}
        onSave={(d) => saveLine(d, edit?.line ?? null)}
      />

      <Dialog open={!!decide} onOpenChange={(o) => !o && setDecide(null)}>
        <DialogContent data-testid="exp-decide-dialog">
          <DialogHeader>
            <DialogTitle>
              {decide === 'approve' ? 'Approve this claim?' : 'Send this claim back?'}
            </DialogTitle>
            <DialogDescription>
              {claim.userName} · {monthLabel(claim.month)} · {money(claim.total)}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-comment">
              {decide === 'reject' ? 'What needs fixing' : 'Comment (optional)'}
            </Label>
            <textarea
              id="exp-comment"
              rows={3}
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-base shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
              data-testid="exp-comment"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDecide(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy === 'decide' || (decide === 'reject' && !comment.trim())}
              data-testid="exp-decide-confirm"
              onClick={async () => {
                const d = decide!;
                const ok = await run(
                  'decide',
                  () =>
                    api.POST('/v1/expense-claims/{id}/decision', {
                      params: { path: { id: claim.id } },
                      body: { decision: d, ...(comment.trim() ? { comment: comment.trim() } : {}) },
                    }),
                  d === 'approve' ? 'Claim approved' : 'Claim sent back',
                );
                if (ok) setDecide(null);
              }}
            >
              {busy === 'decide' && <LoaderCircle className="animate-spin" aria-hidden />}
              {decide === 'approve' ? 'Approve' : 'Send back'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paying} onOpenChange={setPaying}>
        <DialogContent data-testid="exp-pay-dialog">
          <DialogHeader>
            <DialogTitle>Mark as paid</DialogTitle>
            <DialogDescription>
              {claim.userName} · {money(claim.total)}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-payref">Payment reference</Label>
            <Input
              id="exp-payref"
              maxLength={100}
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
              placeholder="UTR or cheque number"
              data-testid="exp-payref"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPaying(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy === 'pay' || !paymentRef.trim()}
              data-testid="exp-pay-confirm"
              onClick={async () => {
                const ok = await run(
                  'pay',
                  () =>
                    api.POST('/v1/expense-claims/{id}/pay', {
                      params: { path: { id: claim.id } },
                      body: { paymentRef: paymentRef.trim() },
                    }),
                  'Marked as paid',
                );
                if (ok) setPaying(false);
              }}
            >
              {busy === 'pay' && <LoaderCircle className="animate-spin" aria-hidden />}
              Mark as paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
