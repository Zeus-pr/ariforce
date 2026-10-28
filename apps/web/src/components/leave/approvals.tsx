'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@ariforce/ui/components/dialog';
import { Label } from '@ariforce/ui/components/label';
import { toast } from '@ariforce/ui/components/sonner';
import { useRole } from '@/components/shell/role-context';
import { api, apiReady, toApiError } from '@/lib/api';
import { selfId } from '@/lib/expenses/model';
import { daysLabel, leaveMessage, rangeLabel, type LeaveReq } from '@/lib/leave/model';

type Decision = { req: LeaveReq; kind: 'approve' | 'reject' };

/** Pending leave from my reporting line (the API returns only requests I may see; never my own). */
export function LeaveApprovals({ levels, onDecided }: { levels: number; onDecided: () => void }) {
  const { role, user } = useRole();
  const [rows, setRows] = useState<LeaveReq[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      await apiReady();
      const me = await selfId(role, user);
      const r = await api.GET('/v1/leave/requests', { params: { query: { status: 'pending', mine: 'false' } }, signal: ac.signal }).catch(() => null);
      if (ac.signal.aborted || !r) return;
      if (r.error) return setError(leaveMessage(toApiError(r)));
      setError(null);
      setRows((r.data?.items ?? []).filter((x) => x.userId !== me).sort((a, z) => a.fromDate.localeCompare(z.fromDate)));
    })().catch(() => {});
    return () => ac.abort();
  }, [role, user, tick]);

  return (
    <section aria-labelledby="leave-appr-h" className="flex flex-col gap-3" data-testid="leave-approvals">
      <h2 id="leave-appr-h" className="text-base font-semibold">
        Waiting for your decision{rows?.length ? ` (${rows.length})` : ''}
      </h2>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : rows === null ? (
        <div className="h-32 animate-pulse rounded-lg bg-muted/60" />
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground" data-testid="leave-approvals-empty">
          Nothing waiting. Leave your team applies for shows up here.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-testid="leave-approval">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.userName}</p>
                <p className="text-sm text-muted-foreground">
                  {r.typeName} · {rangeLabel(r)} · {daysLabel(r.days)}
                </p>
                {r.reason && <p className="mt-1 text-sm">“{r.reason}”</p>}
                {r.approvalStep && levels > 1 && (
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="leave-step">
                    Step {r.approvalStep} of {levels}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setDeciding({ req: r, kind: 'reject' })} data-testid="leave-reject">
                  Reject
                </Button>
                <Button size="sm" onClick={() => setDeciding({ req: r, kind: 'approve' })} data-testid="leave-approve">
                  Approve
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <DecisionDialog
        d={deciding}
        onClose={() => setDeciding(null)}
        onDone={() => {
          reload();
          onDecided();
        }}
      />
    </section>
  );
}

function DecisionDialog({ d, onClose, onDone }: { d: Decision | null; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reject = d?.kind === 'reject';
  async function go() {
    if (!d) return;
    if (reject && !comment.trim()) return setError('Add a comment so they know why.');
    setBusy(true);
    let r;
    try {
      r = await api.POST('/v1/leave/requests/{id}/decision', {
        params: { path: { id: d.req.id } },
        body: { decision: d.kind, ...(comment.trim() ? { comment: comment.trim() } : {}) },
      });
    } catch {
      return setError('Could not reach the server. Nothing was saved; try again.');
    } finally {
      setBusy(false);
    }
    // LEAVE_DCR_CONFLICT (approve): nothing saved, the request stays pending; the dialog stays open with why.
    if (r.error) return setError(leaveMessage(toApiError(r)));
    toast.success(
      r.data.status === 'pending' ? `Approved; sent to the next approver` : reject ? 'Leave rejected' : 'Leave approved',
    );
    setComment('');
    setError(null);
    onClose();
    onDone();
  }
  return (
    <Dialog open={!!d} onOpenChange={(o) => !o && (setError(null), setComment(''), onClose())}>
      <DialogContent className="sm:max-w-sm" data-testid="leave-decide-dialog">
        <DialogHeader>
          <DialogTitle>{reject ? 'Reject leave' : 'Approve leave'}</DialogTitle>
          <DialogDescription>{d ? `${d.req.userName}: ${d.req.typeName}, ${rangeLabel(d.req)}` : ''}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="leave-comment">{reject ? 'Reason (required)' : 'Comment (optional)'}</Label>
          <textarea
            id="leave-comment"
            data-testid="leave-comment"
            rows={3}
            maxLength={1000}
            value={comment}
            onChange={(e) => (setComment(e.target.value), setError(null))}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
          />
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert" data-testid="leave-decide-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Back
          </Button>
          <Button variant={reject ? 'destructive' : 'default'} onClick={go} disabled={busy || (reject && !comment.trim())} data-testid="leave-decide-confirm">
            {busy && <LoaderCircle className="animate-spin" />}
            {reject ? 'Reject' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
