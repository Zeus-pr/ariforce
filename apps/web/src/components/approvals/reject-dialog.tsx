'use client';

import { useEffect, useState } from 'react';
import { Button } from '@ariforce/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ariforce/ui/components/dialog';
import { Label } from '@ariforce/ui/components/label';

/** API limit for decision comments (ApprovalDecision / LeaveDecision / ExpenseDecision: max 1000). */
export const REJECT_REASON_MAX = 1000;

/** Every rejection needs a reason: Reject stays disabled until one is typed. */
export function RejectDialog({
  open,
  title,
  description,
  confirmLabel = 'Reject',
  busy = false,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  busy?: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const ok = reason.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="reject-reason">
            Reason<span className="text-danger">*</span>
          </Label>
          <textarea
            id="reject-reason"
            data-testid="reject-reason"
            value={reason}
            maxLength={REJECT_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder="What needs to change?"
            className="w-full rounded-md border bg-background px-3 py-2 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
          />
          <p className="text-right text-xs text-muted-foreground tabular-nums">
            {reason.length}/{REJECT_REASON_MAX}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!ok || busy}
            onClick={() => onConfirm(reason.trim())}
            data-testid="reject-confirm"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
