'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { cn } from '@ariforce/ui/lib/utils';

export type PickOption = { id: string; name: string; hint?: string | null; badge?: string | null; disabledReason?: string | null };
export type PickPage = { items: PickOption[]; nextCursor: string | null; error?: string };

/**
 * Searchable list backed by a server query: debounced search, cursor "Show more", single or multi select.
 * The API scopes rows to the caller's team; this only asks for pages.
 */
export function AsyncPicker({
  label,
  fetchPage,
  value,
  onChange,
  multiple = false,
  labels,
  testId,
  deps = [],
  emptyText = 'Nothing found.',
}: {
  label: string;
  fetchPage: (q: string, cursor?: string) => Promise<PickPage>;
  value: string[];
  onChange: (ids: string[], picked: PickOption[]) => void;
  multiple?: boolean;
  /** Known names for already-selected ids (e.g. from a saved plan). */
  labels?: Map<string, string>;
  testId: string;
  deps?: unknown[];
  emptyText?: string;
}) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [items, setItems] = useState<PickOption[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Map<string, PickOption>());
  const req = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const n = ++req.current;
    setItems(null);
    void fetchPage(dq).then((p) => {
      if (n !== req.current) return;
      p.items.forEach((o) => seen.current.set(o.id, o));
      setItems(p.items);
      setCursor(p.nextCursor);
      setError(p.error ?? null);
    });
  }, [dq, ...deps]);

  async function more() {
    if (!cursor) return;
    setBusy(true);
    const n = req.current;
    const p = await fetchPage(dq, cursor);
    setBusy(false);
    if (n !== req.current) return;
    p.items.forEach((o) => seen.current.set(o.id, o));
    setItems((cur) => [...(cur ?? []), ...p.items]);
    setCursor(p.nextCursor);
    if (p.error) setError(p.error);
  }
  const name = (id: string) => seen.current.get(id)?.name ?? labels?.get(id) ?? 'Selected earlier';
  const toggle = (o: PickOption) => {
    if (o.disabledReason) return;
    const next = multiple ? (value.includes(o.id) ? value.filter((x) => x !== o.id) : [...value, o.id]) : [o.id];
    onChange(next, next.map((id) => seen.current.get(id) ?? { id, name: name(id) }));
  };

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      {multiple && value.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid={`${testId}-chips`}>
          {value.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-0.5 text-xs" data-testid={`${testId}-chip`}>
              {name(id)}
              <button type="button" aria-label={`Remove ${name(id)}`} onClick={() => onChange(value.filter((x) => x !== id), [])}><X className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label.toLowerCase()}`} className="md:text-base" data-testid={`${testId}-search`} />
      <div role="listbox" aria-label={label} aria-multiselectable={multiple} className="max-h-56 overflow-y-auto rounded-md border" data-testid={`${testId}-list`}>
        {items === null ? (
          <p className="p-3 text-sm text-muted-foreground" aria-busy="true">Loading…</p>
        ) : items.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground" data-testid={`${testId}-empty`}>{error ?? emptyText}</p>
        ) : (
          items.map((o) => {
            const on = value.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={on}
                aria-disabled={!!o.disabledReason}
                onClick={() => toggle(o)}
                className={cn('flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0', on && 'bg-primary/10 font-medium', o.disabledReason ? 'cursor-not-allowed text-muted-foreground' : 'hover:bg-muted')}
                data-testid={`${testId}-option`}
                data-id={o.id}
              >
                <span className="min-w-0">
                  <span className="block truncate">{o.name}</span>
                  {(o.disabledReason || o.hint) && <span className="block truncate text-xs text-muted-foreground">{o.disabledReason ?? o.hint}</span>}
                </span>
                {o.badge && <span className="shrink-0 rounded border px-1.5 py-0.5 text-xs" data-testid={`${testId}-badge`}>{o.badge}</span>}
              </button>
            );
          })
        )}
      </div>
      {error && items && items.length > 0 && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {cursor && (
        <Button type="button" size="sm" variant="outline" className="self-start" disabled={busy} onClick={() => void more()} data-testid={`${testId}-more`}>
          {busy ? 'Loading…' : 'Show more'}
        </Button>
      )}
    </div>
  );
}
