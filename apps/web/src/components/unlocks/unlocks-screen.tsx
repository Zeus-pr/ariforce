'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Approval } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Skeleton } from '@ariforce/ui/components/skeleton';
import { toast } from '@ariforce/ui/components/sonner';
import { RejectDialog } from '@/components/approvals/reject-dialog';
import { api, apiReady } from '@/lib/api';
import { failureMessage } from '@/lib/dcr/errors';

const KINDS = ['dcr_unlock', 'stock_statement_unlock'] as const;

const LABEL = {
  dcr_unlock: 'DCR',
  stock_statement_unlock: 'Stock sheet',
} as const;

/** Pending DCR and stock-sheet unlocks only. Directors and system admin decide them here. */
export function UnlocksScreen() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Approval | null>(null);

  const q = useQuery({
    queryKey: ['unlocks'],
    queryFn: async () => {
      await apiReady();
      const pages = await Promise.all(
        KINDS.map((subjectType) =>
          api.GET('/v1/approvals', {
            params: { query: { mine: 'to_decide', status: 'pending', subjectType, limit: 100 } },
          }),
        ),
      );
      const bad = pages.find((r) => !r.data);
      if (bad) throw new Error(failureMessage(bad, 'Could not load unlock requests.'));
      return pages.flatMap((r) => r.data?.items ?? []);
    },
  });

  async function decide(id: string, decision: 'approve' | 'reject', comment?: string) {
    setBusy(id);
    const r = await api.POST('/v1/approvals/{id}/decision', {
      params: { path: { id } },
      body: { decision, comment },
    });
    setBusy(null);
    if (r.error) {
      toast.error(failureMessage(r, 'Could not save the decision.'));
      return;
    }
    toast.success(decision === 'approve' ? 'Unlocked' : 'Unlock refused');
    setRejecting(null);
    void qc.invalidateQueries({ queryKey: ['unlocks'] });
  }

  const items = q.data ?? [];

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Unlocks</h1>
        <p className="text-sm text-muted-foreground">
          Reopen a locked daily report or a locked stock sheet. Nothing else is decided here.
        </p>
      </div>
      {q.isPending ? (
        <Skeleton className="h-24" />
      ) : q.isError ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No unlock requests are waiting.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {items.map((a) => (
            <li key={a.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{a.requestedByName}</p>
                <p className="text-sm text-muted-foreground">
                  {LABEL[a.subjectType as keyof typeof LABEL] ?? 'Unlock'} · {a.summary}
                </p>
                {a.comment ? <p className="text-sm">{a.comment}</p> : null}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={busy === a.id}
                  onClick={() => void decide(a.id, 'approve')}
                >
                  Unlock
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === a.id}
                  onClick={() => setRejecting(a)}
                >
                  Refuse
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <RejectDialog
        open={!!rejecting}
        title="Refuse this unlock?"
        description={rejecting?.summary}
        confirmLabel="Refuse"
        busy={busy === rejecting?.id}
        onOpenChange={(o) => !o && setRejecting(null)}
        onConfirm={(reason) => rejecting && void decide(rejecting.id, 'reject', reason)}
      />
    </div>
  );
}
