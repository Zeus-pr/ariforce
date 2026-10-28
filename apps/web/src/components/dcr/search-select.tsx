'use client';

import { Check, ChevronDown, RotateCw, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { cn } from '@ariforce/ui/lib/utils';

export type SelectOption = { id: string; label: string; hint?: string | null; group?: string; badge?: string | null; indent?: boolean; meta?: string };

/**
 * Searchable dropdown that opens inline (no popover), so it works the same on a phone and a desk.
 * Single select closes on pick; multi select keeps the list open until Done. Search is local unless
 * `onQuery` is given (server search; the parent then refreshes `options`).
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
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!onQuery) return;
    const t = setTimeout(() => onQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q, onQuery]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (onQuery || !t) return options;
    return options.filter((o) => `${o.label} ${o.hint ?? ''} ${o.group ?? ''}`.toLowerCase().includes(t));
  }, [options, q, onQuery]);
  const groups = useMemo(() => {
    const m = new Map<string, SelectOption[]>();
    shown.forEach((o) => m.set(o.group ?? '', [...(m.get(o.group ?? '') ?? []), o]));
    return [...m.entries()];
  }, [shown]);

  const names = value.map((id) => options.find((o) => o.id === id)?.label ?? labels?.get(id) ?? 'Selected earlier');
  const pick = (o: SelectOption) => {
    if (!multiple) {
      onChange([o.id]);
      setOpen(false);
      setQ('');
      onDone?.();
      return;
    }
    onChange(value.includes(o.id) ? value.filter((x) => x !== o.id) : [...value, o.id]);
  };

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={invalid || undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex min-h-11 w-full items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-left text-base shadow-xs transition-[border-color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 md:text-sm',
          invalid && 'border-destructive',
          open && 'border-ring',
        )}
        data-testid={`${testId}-trigger`}
      >
        <span className={cn('min-w-0 truncate', !value.length && 'text-muted-foreground')}>
          {value.length ? names.join(', ') : placeholder}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} aria-hidden />
      </button>

      {multiple && value.length > 0 && !open && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Chosen ${label.toLowerCase()}`}>
          {value.map((id, i) => (
            <li key={id} className="inline-flex items-center gap-1 rounded-md border bg-muted/60 py-0.5 pr-1 pl-2 text-xs" data-testid={`${testId}-chip`}>
              {names[i]}
              {!disabled && (
                <button type="button" className="rounded p-0.5 hover:bg-muted" aria-label={`Remove ${names[i]}`} onClick={() => onChange(value.filter((x) => x !== id))}>
                  <X className="size-3" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div id={listId} className="af-enter flex flex-col gap-2 rounded-lg border bg-card p-2" data-testid={`${testId}-panel`}>
          <Input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}`}
            aria-label={`Search ${label.toLowerCase()}`}
            className="md:text-base"
            data-testid={`${testId}-search`}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          <div role="listbox" aria-label={label} aria-multiselectable={multiple || undefined} className="max-h-72 overflow-y-auto overscroll-contain">
            {loading ? (
              <p className="p-3 text-sm text-muted-foreground" aria-busy="true">Loading {label.toLowerCase()}…</p>
            ) : error ? (
              <div className="flex items-center justify-between gap-2 p-3 text-sm" role="alert">
                <span className="text-destructive">{error}</span>
                {onRetry && (
                  <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                    <RotateCw aria-hidden /> Retry
                  </Button>
                )}
              </div>
            ) : shown.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground" data-testid={`${testId}-empty`}>{emptyText}</p>
            ) : (
              groups.map(([g, opts]) => (
                <div key={g || '_'} role="group" aria-label={g || undefined}>
                  {g && <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">{g}</p>}
                  {opts.map((o) => {
                    const on = value.includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        role="option"
                        aria-selected={on}
                        onClick={() => pick(o)}
                        className={cn(
                          'flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
                          o.indent && 'pl-7',
                          on && 'bg-brand-50 font-medium',
                        )}
                        data-testid={`${testId}-option`}
                        data-id={o.id}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{o.label}</span>
                          {o.hint && <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {o.badge && <span className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground uppercase tracking-wide">{o.badge}</span>}
                          <Check className={cn('size-4 text-primary', !on && 'invisible')} aria-hidden />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          {multiple && (
            <Button
              type="button"
              size="sm"
              className="self-end"
              onClick={() => {
                setOpen(false);
                setQ('');
                onDone?.();
              }}
              data-testid={`${testId}-done`}
            >
              {doneLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
