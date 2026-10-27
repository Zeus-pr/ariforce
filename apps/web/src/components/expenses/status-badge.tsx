import type { ExpenseStatus } from '@ariforce/contracts';
import { cn } from '@ariforce/ui/lib/utils';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/expenses/model';

export function StatusBadge({ status, testId }: { status: ExpenseStatus; testId?: string }) {
  return (
    <span className={cn('rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap', STATUS_TONE[status])} data-testid={testId ?? 'exp-status'} data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}
