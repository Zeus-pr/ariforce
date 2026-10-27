'use client';

import { RejectionNote } from '@/components/approvals/rejection-note';
import { useState } from 'react';
import { LoaderCircle, Plus } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@ariforce/ui/components/dialog';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { toast } from '@ariforce/ui/components/sonner';
import { api, toApiError } from '@/lib/api';
import { daysLabel, leaveMessage, rangeLabel, today, type LeaveReq } from '@/lib/leave/model';
import { ApplyLeaveDialog } from './apply-dialog';
import { LeaveStatusBadge } from './status-badge';
import type { LeaveData } from './use-leave';

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

export function MyLeave({ data, year }: { data: LeaveData; year: number }) {
  const [applying, setApplying] = useState(false);
  const [cancelling, setCancelling] = useState<LeaveReq | null>(null);
  const t = today();
  const cancellable = (r: LeaveReq) => r.status === 'pending' || (r.status === 'approved' && r.fromDate > t);

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="leave-bal-h" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="leave-bal-h" className="text-base font-semibold">
            Balances {year}
          </h2>
          <Button onClick={() => setApplying(true)} disabled={!data.balances} data-testid="leave-apply">
            <Plus />
            Apply for leave
          </Button>
        </div>
        {data.balances === null ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-muted/60" />
            ))}
          </div>
        ) : data.balances.length === 0 ? (
          <p className="text-sm text-muted-foreground">No leave types are set up yet. Ask your administrator.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {data.balances.map((b) => (
              <li key={b.typeCode} className="rounded-lg border bg-card p-3" data-testid="leave-balance" data-code={b.typeCode}>
                <p className="truncate text-sm text-muted-foreground" title={b.typeName}>
                  {b.typeName}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums" data-testid="leave-available">
                  {b.available === null ? 'No limit' : n(b.available)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {n(b.used)} used{b.pending ? ` · ${n(b.pending)} waiting` : ''}
                  {b.quota !== null && !b.unlimited ? ` · of ${n(b.opening + b.quota + b.granted)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="leave-hist-h" className="flex flex-col gap-3">
        <h2 id="leave-hist-h" className="text-base font-semibold">
          My requests
        </h2>
        {data.mine === null ? (
          <div className="h-32 animate-pulse rounded-lg bg-muted/60" />
        ) : data.mine.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground" data-testid="leave-none">
            No leave requests in {year}.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {data.mine.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-testid="leave-row" data-status={r.status}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {r.typeName} <span className="font-normal text-muted-foreground">· {daysLabel(r.days)}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">{rangeLabel(r)}</p>
                  {r.decisionComment &&
                    (r.status === 'rejected' ? (
                      <div className="mt-1">
                        <RejectionNote reason={r.decisionComment} at={r.decidedAt} testId="leave-rejection" />
                      </div>
                    ) : (
                      <p className="mt-1 text-sm">Manager: {r.decisionComment}</p>
                    ))}
                  {r.status === 'pending' && r.approvalStep && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Approval step {r.approvalStep} of {data.settings?.approvalLevels ?? r.approvalStep}
                    </p>
                  )}
                </div>
                <LeaveStatusBadge status={r.status} />
                {cancellable(r) && (
                  <Button variant="outline" size="sm" onClick={() => setCancelling(r)} data-testid="leave-cancel">
                    Cancel
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ApplyLeaveDialog
        open={applying}
        onOpenChange={setApplying}
        types={data.types}
        settings={data.settings}
        balances={data.balances ?? []}
        onApplied={data.reload}
      />
      <CancelDialog req={cancelling} onClose={() => setCancelling(null)} onDone={data.reload} />
    </div>
  );
}

function CancelDialog({ req, onClose, onDone }: { req: LeaveReq | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    if (!req) return;
    setBusy(true);
    const r = await api.POST('/v1/leave/requests/{id}/cancel', {
      params: { path: { id: req.id } },
      body: { reason: reason.trim() || null },
    });
    setBusy(false);
    if (r.error) return setError(leaveMessage(toApiError(r)));
    toast.success('Leave cancelled');
    setReason('');
    setError(null);
    onClose();
    onDone();
  }
  return (
    <Dialog open={!!req} onOpenChange={(o) => !o && (setError(null), onClose())}>
      <DialogContent className="sm:max-w-sm" data-testid="leave-cancel-dialog">
        <DialogHeader>
          <DialogTitle>Cancel this leave?</DialogTitle>
          <DialogDescription>{req ? `${req.typeName}, ${rangeLabel(req)}. The days go back to your balance.` : ''}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="leave-cancel-reason">Reason (optional)</Label>
          <Input id="leave-cancel-reason" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert" data-testid="leave-cancel-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={go} disabled={busy} data-testid="leave-cancel-confirm">
            {busy && <LoaderCircle className="animate-spin" />}Cancel leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
