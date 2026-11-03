import { cn } from '@ariforce/ui/lib/utils';
import { STATUS_LABEL, STATUS_TONE, type LeaveStatus } from '@/lib/leave/model';

export function LeaveStatusBadge({ status }: { status: LeaveStatus }) {
  return (
    <span
      className={cn(
        'rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        STATUS_TONE[status],
      )}
      data-testid="leave-status"
      data-status={status}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
