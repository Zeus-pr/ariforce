'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import { cn } from '@ariforce/ui/lib/utils';

export type Choice = { value: string; label: string; hint?: string | null; disabled?: boolean };

/**
 * Single-choice dropdown for short, fixed lists (Work on, Band, Mode, Duration...): the shadcn Select
 * from packages/ui, full width, opening under the trigger. Type a letter to jump; arrows and Enter pick.
 * The trigger shows the label only; hints are a second line in the list.
 */
export function ChoiceSelect({
  id,
  value,
  onValueChange,
  choices,
  placeholder,
  disabled = false,
  invalid = false,
  testId,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  choices: Choice[];
  placeholder: string;
  disabled?: boolean;
  invalid?: boolean;
  testId?: string;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  const chosen = choices.find((c) => c.value === value);
  return (
    <Select value={chosen ? value : ''} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-invalid={invalid || undefined}
        className={cn(
          'min-h-11 w-full bg-card text-base transition-[border-color,box-shadow] duration-(--duration-fast) ease-(--ease-out) hover:border-foreground/25 data-[state=open]:border-ring data-[state=open]:ring-[3px] data-[state=open]:ring-ring/30 md:min-h-9 md:text-sm [&>svg]:transition-transform [&>svg]:duration-(--duration-fast) [&>svg]:ease-(--ease-out) data-[state=open]:[&>svg]:rotate-180',
          className,
        )}
        data-testid={testId}
        data-value={value || undefined}
      >
        <SelectValue placeholder={placeholder}>{chosen?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent
        position="popper"
        collisionPadding={8}
        className="max-h-[min(20rem,var(--radix-select-content-available-height))] w-(--radix-select-trigger-width) min-w-[12rem]"
      >
        {choices.map((c) => (
          <SelectItem
            key={c.value}
            value={c.value}
            textValue={c.label}
            disabled={c.disabled}
            className="min-h-11 py-2 md:min-h-9"
            data-testid={testId ? `${testId}-option` : undefined}
            data-value={c.value}
          >
            <span className="flex min-w-0 flex-col items-start gap-0.5">
              <span className="truncate">{c.label}</span>
              {c.hint && <span className="text-xs text-muted-foreground">{c.hint}</span>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
