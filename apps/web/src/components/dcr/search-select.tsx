'use client';

import { useRef } from 'react';
import { Combobox } from '@ariforce/ui/components/combobox';

export type SelectOption = {
  id: string;
  label: string;
  hint?: string | null;
  group?: string;
  badge?: string | null;
  indent?: boolean;
  meta?: string;
  imageUrl?: string | null;
  /** Price to stockist (INR); POB is valued at it. */
  pts?: number | null;
};

/**
 * DCR adapter over the packages/ui Combobox (searchable dropdown) for long lists: territories,
 * people, customers, products. Search is local unless `onQuery` is given (server search).
 * `onDone` runs when the dropdown closes after being opened (pick, Done, Escape or outside click).
 */
export function SearchSelect({
  label,
  options,
  value,
  onChange,
  multiple = false,
  placeholder = 'Choose',
  loading = false,
  error = null,
  onRetry,
  emptyText = 'Nothing found.',
  onQuery,
  onDone,
  disabled = false,
  invalid = false,
  testId,
  doneLabel = 'Done',
  labels,
  id,
}: {
  label: string;
  options: SelectOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyText?: string;
  onQuery?: (q: string) => void;
  onDone?: () => void;
  disabled?: boolean;
  invalid?: boolean;
  testId: string;
  doneLabel?: string;
  /** Names for chosen ids that are not in `options` (e.g. after a server search). */
  labels?: Map<string, string>;
  id?: string;
}) {
  const changed = useRef(false);
  return (
    <div data-testid={testId}>
      <Combobox
        id={id}
        aria-label={label}
        options={options.map((o) => ({
          value: o.id,
          label: o.label,
          hint: o.hint,
          group: o.group,
          badge: o.badge,
          indent: o.indent,
        }))}
        value={value}
        onValueChange={(v) => {
          changed.current = true;
          onChange(v);
        }}
        multiple={multiple}
        placeholder={placeholder}
        searchPlaceholder={`Search ${label.toLowerCase()}`}
        emptyText={emptyText}
        loading={loading}
        error={error}
        onRetry={onRetry}
        onSearchChange={onQuery}
        labels={labels}
        onOpenChange={(open) => {
          if (open) changed.current = false;
          // Multi select: closing counts as "done" (also with nothing picked). Single: only after a pick.
          else if (multiple || changed.current) onDone?.();
        }}
        disabled={disabled}
        invalid={invalid}
        doneLabel={doneLabel}
        testId={testId}
      />
    </div>
  );
}
