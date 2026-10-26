'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, LoaderCircle, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@ariforce/ui/components/dialog';
import { searchAdapter, searchPages, type SearchGroup } from '@/lib/search/adapter';
import type { Role } from '@/lib/roles';

const DEBOUNCE = 200;
type State =
  | { kind: 'idle' }
  | { kind: 'loading'; prev: SearchGroup[] }
  | { kind: 'ready'; groups: SearchGroup[]; partial: boolean }
  | { kind: 'error' };

/** Command palette: Radix Dialog gives the focus trap, Esc and focus return; the input is an ARIA combobox. */
export function CommandPalette({
  role,
  open,
  onOpenChange,
}: {
  role: Role;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  // Remember what had focus when the palette opened (bar, or anything for Cmd/Ctrl+K) and return there.
  const [returnTo, setReturnTo] = useState<HTMLElement | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && typeof document !== 'undefined')
      setReturnTo(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  }
  const router = useRouter();
  const id = useId();
  const listId = `${id}-list`;
  const [q, setQ] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [active, setActive] = useState(0);
  const [retry, setRetry] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const term = q.trim();

  // Debounced server search; each new term aborts the previous request.
  useEffect(() => {
    if (!open || !term) {
      setState({ kind: 'idle' });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({
      kind: 'loading',
      prev: s.kind === 'ready' ? s.groups : s.kind === 'loading' ? s.prev : [],
    }));
    const t = setTimeout(() => {
      searchAdapter
        .search(role, term, ctrl.signal)
        .then((r) => {
          if (ctrl.signal.aborted) return;
          if (!r.groups.length && r.failed.length) setState({ kind: 'error' });
          else setState({ kind: 'ready', groups: r.groups, partial: r.failed.length > 0 });
        })
        .catch(() => !ctrl.signal.aborted && setState({ kind: 'error' }));
    }, DEBOUNCE);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, term, role, retry]);

  const groups: SearchGroup[] = useMemo(() => {
    if (!term) {
      const pages = searchPages(role, '');
      return pages.length ? [{ id: 'pages', label: 'Go to', hits: pages }] : [];
    }
    if (state.kind === 'ready') return state.groups;
    if (state.kind === 'loading') return state.prev;
    return [];
  }, [term, state, role]);
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);

  useEffect(() => setActive(0), [groups]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) setQ('');
  };
  const go = (href: string) => {
    close(false);
    router.push(href);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && flat.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % flat.length);
    } else if (e.key === 'ArrowUp' && flat.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + flat.length) % flat.length);
    } else if (e.key === 'Home' && flat.length) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && flat.length) {
      e.preventDefault();
      setActive(flat.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = flat[active];
      if (hit) go(hit.href);
    }
  };

  const loading = state.kind === 'loading';
  const optionId = (i: number) => `${id}-opt-${i}`;
  let i = -1;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        showCloseButton={false}
        data-testid="command-palette"
        className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl motion-reduce:animate-none"
        aria-describedby={undefined}
        onCloseAutoFocus={(e) => {
          if (returnTo?.isConnected) {
            e.preventDefault();
            returnTo.focus();
          }
        }}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat.length ? optionId(active) : undefined}
            aria-label="Search doctors, chemists, stockists, team, products and pages"
            data-testid="palette-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search doctors, chemists, team, pages…"
            enterKeyHint="go"
            autoComplete="off"
            spellCheck={false}
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
          />
          {loading && (
            <LoaderCircle
              className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
              aria-label="Searching"
              data-testid="palette-loading"
            />
          )}
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground sm:inline">
            Esc
          </kbd>
        </div>

        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Results"
          className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain p-1.5"
        >
          {groups.map((g) => (
            <div
              key={g.id}
              role="group"
              aria-labelledby={`${id}-g-${g.id}`}
              data-testid={`palette-group-${g.id}`}
            >
              <div
                id={`${id}-g-${g.id}`}
                role="presentation"
                className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground"
              >
                {g.label}
              </div>
              {g.hits.map((h) => {
                i++;
                const idx = i;
                const sel = idx === active;
                return (
                  <div
                    key={h.id}
                    id={optionId(idx)}
                    role="option"
                    aria-selected={sel}
                    data-index={idx}
                    data-testid="palette-option"
                    data-href={h.href}
                    onMouseMove={() => setActive(idx)}
                    onClick={() => go(h.href)}
                    className={`flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm ${sel ? 'bg-secondary text-foreground' : 'text-foreground/90'}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{h.title}</span>
                      {h.subtitle && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {h.subtitle}
                        </span>
                      )}
                    </span>
                    {sel && (
                      <CornerDownLeft className="size-3.5 text-muted-foreground" aria-hidden />
                    )}
                  </div>
                );
              })}
              {g.more && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => go(g.more!)}
                  className="w-full rounded-md px-2 py-1.5 text-left text-xs text-primary hover:underline"
                >
                  All {g.label.toLowerCase()} matching “{term}”
                </button>
              )}
            </div>
          ))}

          {term && state.kind === 'ready' && groups.length === 0 && (
            <p
              className="px-3 py-8 text-center text-sm text-muted-foreground"
              data-testid="palette-empty"
            >
              Nothing found for “{term}”.
            </p>
          )}
          {state.kind === 'loading' && groups.length === 0 && (
            <div className="grid gap-1.5 p-1" aria-hidden>
              {[0, 1, 2].map((k) => (
                <div
                  key={k}
                  className="h-10 animate-pulse rounded-md bg-muted/60 motion-reduce:animate-none"
                />
              ))}
            </div>
          )}
          {state.kind === 'error' && (
            <div role="alert" className="px-3 py-6 text-center text-sm" data-testid="palette-error">
              Search is not responding.{' '}
              <button
                type="button"
                className="font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => setRetry((r) => r + 1)}
              >
                Try again
              </button>
            </div>
          )}
          {state.kind === 'ready' && state.partial && groups.length > 0 && (
            <p className="px-2 pt-2 pb-1 text-xs text-muted-foreground">
              Some groups could not load.
            </p>
          )}
        </div>
        <div aria-live="polite" className="sr-only">
          {state.kind === 'ready' ? `${flat.length} results` : ''}
        </div>
      </DialogContent>
    </Dialog>
  );
}
