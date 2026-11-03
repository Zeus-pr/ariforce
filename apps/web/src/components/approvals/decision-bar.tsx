'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Approval } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { toast } from '@ariforce/ui/components/sonner';
import { api, apiReady, toApiError } from '@/lib/api';
import { approvalDecisionMessage } from '@/lib/leave/model';
import { RejectDialog } from './reject-dialog';

/** Approve / Reject (reason required) for one approval request, in place. */
export function DecisionBar({ approval: a }: { approval: Approval }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  async function decide(decision: 'approve' | 'reject', note?: string) {
    if (busy) return;
    setBusy(true);
    try {
      await apiReady();
      const r = await api.POST('/v1/approvals/{id}/decision', {
        params: { path: { id: a.id } },
        body: decision === 'approve' ? { decision } : { decision, comment: note },
      });
      if (r.error) return toast.error(approvalDecisionMessage(toApiError(r)), { duration: 10000 });
      toast.success(decision === 'approve' ? `${a.summary} approved` : `${a.summary} rejected`);
      setRejecting(false);
      void qc.invalidateQueries({ queryKey: ['approvals-org'] });
    } catch {
      toast.error('Could not reach the server. Nothing was saved; try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex gap-2" data-testid="decision-bar">
      <Button size="sm" disabled={busy} onClick={() => void decide('approve')}>
        {busy ? 'Saving…' : 'Approve'}
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
        Reject
      </Button>
      <RejectDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={`Reject ${a.summary}`}
        description={`${a.requestedByName} sees this reason and can resubmit.`}
        onConfirm={(reason) => void decide('reject', reason)}
      />
    </div>
  );
}
