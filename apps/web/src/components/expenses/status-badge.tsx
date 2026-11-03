import type { ExpenseStatus } from '@ariforce/contracts';
import { cn } from '@ariforce/ui/lib/utils';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/expenses/model';

export function StatusBadge({ status, testId }: { status: ExpenseStatus; testId?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        STATUS_TONE[status],
      )}
      data-testid={testId ?? 'exp-status'}
      data-status={status}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
