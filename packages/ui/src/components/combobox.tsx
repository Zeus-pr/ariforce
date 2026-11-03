'use client';

import * as React from 'react';
import {
  CheckIcon,
  ChevronDownIcon,
  Loader2Icon,
  RotateCwIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export type ComboboxOption = {
  value: string;
  label: string;
  /** Second line in the list (e.g. "Territory in Durgapur HQ"); searched too. */
  hint?: string | null;
  /** Options with the same group are listed under one heading, in first-seen order. */
  group?: string;
  badge?: string | null;
  indent?: boolean;
  disabled?: boolean;
};

type ComboboxProps = {
  options: ComboboxOption[];
  value: string[];
  onValueChange: (value: string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Server search: called (debounced) with the query; the parent refreshes `options`. Local filter otherwise. */
  onSearchChange?: (query: string) => void;
  /** Labels for chosen values that are not in `options` (e.g. after a server search). */
  labels?: Map<string, string>;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  className?: string;
  contentClassName?: string;
  doneLabel?: string;
  /** Chosen values as removable chips under the trigger (multiple only). Default true. */
  chips?: boolean;
  /** Base for data-testid on the parts: -trigger, -search, -option, -empty, -chip, -done. */
  testId?: string;
};

const matches = (o: ComboboxOption, q: string) => {
  const hay = `${o.label} ${o.hint ?? ''} ${o.group ?? ''} ${o.badge ?? ''}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
};

/**
 * Searchable dropdown (shadcn Popover based): type to filter, arrow keys to move, Enter to pick,
 * Escape to close. Single select closes on pick; multiple stays open until Done or outside click.
 */
function Combobox({
  options,
  value,
  onValueChange,
  multiple = false,
  placeholder = 'Choose',
  searchPlaceholder = 'Search',
  emptyText = 'Nothing found.',
  loading = false,
  error = null,
  onRetry,
  onSearchChange,
  labels,
  onOpenChange,
  disabled = false,
  invalid = false,
  id,
  className,
  contentClassName,
  doneLabel = 'Done',
  chips = true,
  testId,
  ...aria
}: ComboboxProps) {
  const [open, setOpenState] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const input = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();
  const tid = (part: string) => (testId ? `${testId}-${part}` : undefined);

  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (!next) setQuery('');
    onOpenChange?.(next);
  };

  React.useEffect(() => {
    if (!onSearchChange) return;
    const t = setTimeout(() => onSearchChange(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query, onSearchChange]);

  // Rendered order: grouped, groups in first-seen order. Keyboard moves over this same list.
  const ordered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = onSearchChange || !q ? options : options.filter((o) => matches(o, q));
    const groups = new Map<string, ComboboxOption[]>();
    shown.forEach((o) => groups.set(o.group ?? '', [...(groups.get(o.group ?? '') ?? []), o]));
    return [...groups.values()].flat();
  }, [options, query, onSearchChange]);

  React.useEffect(() => {
    if (!open) return;
    const first = ordered.findIndex((o) => value.includes(o.value) && !o.disabled);
    setActive(
      query
        ? Math.max(
            0,
            ordered.findIndex((o) => !o.disabled),
          )
        : Math.max(0, first),
    );
    // Reset only when the list itself changes (open, search, new options), not on every pick.
  }, [open, ordered]);

  React.useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, listId]);

  const nameOf = (v: string) =>
    options.find((o) => o.value === v)?.label ?? labels?.get(v) ?? 'Selected earlier';
  const names = value.map(nameOf);
  const summary = !value.length
    ? placeholder
    : names.length <= 2
      ? names.join(', ')
      : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;

  const pick = (o: ComboboxOption | undefined) => {
    if (!o || o.disabled) return;
    if (!multiple) {
      onValueChange([o.value]);
      setOpen(false);
      return;
    }
    onValueChange(
      value.includes(o.value) ? value.filter((x) => x !== o.value) : [...value, o.value],
    );
  };

  const move = (from: number, step: 1 | -1) => {
    if (!ordered.length) return from;
    let i = from;
    for (let n = 0; n < ordered.length; n++) {
      i = (i + step + ordered.length) % ordered.length;
      if (!ordered[i]!.disabled) return i;
    }
    return from;
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((i) => move(i, 1));
    else if (e.key === 'ArrowUp') setActive((i) => move(i, -1));
    else if (e.key === 'Home') setActive(move(-1, 1));
    else if (e.key === 'End') setActive(move(ordered.length, -1));
    else if (e.key === 'Enter') pick(ordered[active]);
    else return;
    e.preventDefault();
  };

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id={id}
          disabled={disabled}
          role="combobox"
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
          aria-invalid={invalid || undefined}
          {...aria}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
            } else if (
              e.key.length === 1 &&
              e.key !== ' ' &&
              !e.metaKey &&
              !e.ctrlKey &&
              !e.altKey
            ) {
              // Start typing on the closed trigger: open with that letter as the search.
              e.preventDefault();
              setOpen(true);
              setQuery(e.key);
            }
          }}
          className={cn(
            'group/combobox flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-2 text-left text-base shadow-xs outline-none transition-[border-color,box-shadow,background-color] duration-(--duration-fast) ease-(--ease-out) md:min-h-9 md:text-sm',
            'hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:border-ring data-[state=open]:ring-[3px] data-[state=open]:ring-ring/30',
            'disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-destructive/20',
          )}
          data-testid={tid('trigger')}
        >
          <span className={cn('min-w-0 truncate', !value.length && 'text-muted-foreground')}>
            {summary}
          </span>
          <ChevronDownIcon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) group-data-[state=open]/combobox:rotate-180"
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={8}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            input.current?.focus({ preventScroll: true });
          }}
          className={cn(
            'flex w-(--radix-popover-trigger-width) max-w-[calc(100vw-1rem)] min-w-[min(16rem,calc(100vw-1rem))] flex-col overflow-hidden p-0',
            contentClassName,
          )}
        >
          <div className="flex items-center gap-2 border-b px-3">
            <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onListKey}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-controls={listId}
              aria-activedescendant={ordered[active] ? `${listId}-${active}` : undefined}
              autoComplete="off"
              spellCheck={false}
              className="h-11 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
              data-testid={tid('search')}
            />
            {loading && (
              <Loader2Icon
                aria-hidden
                className="size-4 shrink-0 animate-spin text-muted-foreground"
              />
            )}
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label={aria['aria-label']}
            aria-multiselectable={multiple || undefined}
            aria-busy={loading || undefined}
            className="max-h-[min(18rem,calc(var(--radix-popover-content-available-height)-6rem))] overflow-y-auto overscroll-contain p-1"
          >
            {error ? (
              <div
                className="flex items-center justify-between gap-2 px-2 py-3 text-sm"
                role="alert"
              >
                <span className="text-destructive">{error}</span>
                {onRetry && (
                  <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                    <RotateCwIcon aria-hidden /> Retry
                  </Button>
                )}
              </div>
            ) : loading && !ordered.length ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">Loading…</p>
            ) : !ordered.length ? (
              <p className="px-2 py-3 text-sm text-muted-foreground" data-testid={tid('empty')}>
                {emptyText}
              </p>
            ) : (
              ordered.map((o, i) => {
                const on = value.includes(o.value);
                const heading = !!o.group && (i === 0 || ordered[i - 1]!.group !== o.group);
                return (
                  <React.Fragment key={o.value}>
                    {heading && (
                      <div
                        role="presentation"
                        className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                      >
                        {o.group}
                      </div>
                    )}
                    <div
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={on}
                      aria-disabled={o.disabled || undefined}
                      data-active={i === active || undefined}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => i !== active && setActive(i)}
                      onClick={() => pick(o)}
                      className={cn(
                        'flex min-h-11 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm select-none md:min-h-9',
                        'data-[active]:bg-accent data-[active]:text-accent-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50',
                        o.indent && 'pl-6',
                      )}
                      data-testid={tid('option')}
                      data-value={o.value}
                    >
                      {multiple && (
                        <span
                          aria-hidden
                          className={cn(
                            'flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-colors duration-(--duration-instant)',
                            on && 'border-primary bg-primary text-primary-foreground',
                          )}
                        >
                          {on && <CheckIcon className="size-3" />}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate', on && 'font-medium')}>{o.label}</span>
                        {o.hint && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {o.hint}
                          </span>
                        )}
                      </span>
                      {o.badge && (
                        <span className="shrink-0 rounded border px-1.5 py-0.5 text-[11px] tracking-wide text-muted-foreground uppercase">
                          {o.badge}
                        </span>
                      )}
                      {!multiple && (
                        <CheckIcon
                          aria-hidden
                          className={cn('size-4 shrink-0 text-primary', !on && 'invisible')}
                        />
                      )}
                    </div>
                  </React.Fragment>
                );
              })
            )}
          </div>
          <p className="sr-only" aria-live="polite">
            {loading ? '' : `${ordered.length} ${ordered.length === 1 ? 'result' : 'results'}`}
          </p>
          {multiple && (
            <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                {value.length ? `${value.length} selected` : 'None selected'}
              </span>
              <div className="flex gap-1">
                {value.length > 0 && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => onValueChange([])}>
                    Clear
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setOpen(false)}
                  data-testid={tid('done')}
                >
                  {doneLabel}
                </Button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {multiple && chips && value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Chosen">
          {value.map((v, i) => (
            <li
              key={v}
              className="inline-flex items-center gap-1 rounded-md border bg-muted/60 py-0.5 pr-1 pl-2 text-xs"
              data-testid={tid('chip')}
            >
              {names[i]}
              {!disabled && (
                <button
                  type="button"
                  className="rounded p-0.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                  aria-label={`Remove ${names[i]}`}
                  onClick={() => onValueChange(value.filter((x) => x !== v))}
                >
                  <XIcon aria-hidden className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { Combobox };
