'use client';

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import { Skeleton } from '@ariforce/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ariforce/ui/components/table';
import { cn } from '@ariforce/ui/lib/utils';
import { PAGE_SIZES, type Column, type DataSource, type TableResult } from './types';
import { useTableQuery } from './use-table-query';

const ALL = '__all';

type Props<T> = {
  source: DataSource<T>;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  searchPlaceholder?: string;
  actions?: ReactNode;
  empty?: ReactNode;
  /** Bump to refetch the current page (after a create/edit/delete). */
  reloadKey?: number;
  label: string;
};

type State<T> =
  | { status: 'loading'; data?: TableResult<T> }
  | { status: 'ready'; data: TableResult<T> }
  | { status: 'error'; message: string };

/**
 * Server-side table: page, pageSize, query, sort and filters live in the URL and go to the server;
 * nothing is sorted or filtered in the browser. Desktop shows a table, phones a card list.
 */
export function DataTable<T>({
  source,
  columns,
  rowKey,
  onRowClick,
  searchPlaceholder = 'Search',
  actions,
  empty,
  reloadKey = 0,
  label,
}: Props<T>) {
  const [query, setQuery] = useTableQuery();
  const [state, setState] = useState<State<T>>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState(query.query);
  const lastQuery = useRef(query.query);

  // Keep the box in sync when the URL changes (back/forward).
  useEffect(() => {
    if (query.query !== lastQuery.current) {
      lastQuery.current = query.query;
      setSearch(query.query);
    }
  }, [query.query]);

  // Debounced search -> URL.
  useEffect(() => {
    if (search === query.query) return;
    const t = setTimeout(() => {
      lastQuery.current = search;
      setQuery({ query: search });
    }, 300);
    return () => clearTimeout(t);
  }, [search, query.query, setQuery]);

  const key = JSON.stringify(query);
  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ status: 'loading', data: s.status === 'ready' ? s.data : undefined }));
    source
      .fetch(JSON.parse(key), ctrl.signal)
      .then((data) => setState({ status: 'ready', data }))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({
          status: 'error',
          message: e instanceof Error ? e.message : 'Something went wrong.',
        });
      });
    return () => ctrl.abort();
  }, [key, source, reloadKey, retry]);

  const data = state.status === 'error' ? undefined : state.data;
  const loading = state.status === 'loading';
  const totalPages =
    data?.total != null ? Math.max(1, Math.ceil(data.total / query.pageSize)) : null;
  const from = (query.page - 1) * query.pageSize + 1;

  const toggleSort = (id: string) => {
    const s = query.sort;
    setQuery({
      sort: !s || s.id !== id ? { id, desc: false } : s.desc ? null : { id, desc: true },
    });
  };

  return (
    <div className="flex flex-col gap-3" aria-busy={loading}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {source.searchable && (
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              inputMode="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={`Search ${label}`}
              className="pl-8"
            />
          </div>
        )}
        {source.filters.map((f) => (
          <Select
            key={f.id}
            value={query.filters[f.id] ?? ALL}
            onValueChange={(v) =>
              setQuery({ filters: { ...query.filters, [f.id]: v === ALL ? '' : v } })
            }
          >
            <SelectTrigger className="sm:w-48" aria-label={f.label}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All {f.label.toLowerCase()}</SelectItem>
              {f.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        {actions && <div className="flex gap-2 sm:ml-auto">{actions}</div>}
      </div>

      {state.status === 'error' ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border bg-card p-8 text-center"
        >
          <p className="font-medium">Couldn&apos;t load {label}</p>
          <p className="text-sm text-muted-foreground">{state.message}</p>
          <Button variant="outline" size="sm" onClick={() => setRetry((n) => n + 1)}>
            <RotateCw /> Try again
          </Button>
        </div>
      ) : (
        <>
          {/* Desktop / tablet */}
          <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  {columns.map((c) => {
                    const canSort = source.sortable.includes(c.id);
                    const active = query.sort?.id === c.id ? query.sort : null;
                    return (
                      <TableHead
                        key={c.id}
                        className={c.className}
                        aria-sort={active ? (active.desc ? 'descending' : 'ascending') : undefined}
                      >
                        {canSort ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(c.id)}
                            className="-ml-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground"
                          >
                            {c.header}
                            {active ? (
                              active.desc ? (
                                <ArrowDown className="size-3.5" />
                              ) : (
                                <ArrowUp className="size-3.5" />
                              )
                            ) : (
                              <ArrowUpDown className="size-3.5 opacity-40" />
                            )}
                          </button>
                        ) : (
                          c.header
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody className={cn(loading && data && 'opacity-60 transition-opacity')}>
                {!data
                  ? Array.from({ length: 6 }, (_, i) => (
                      <TableRow key={i}>
                        {columns.map((c) => (
                          <TableCell key={c.id}>
                            <Skeleton className="h-4 w-3/4" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : data.items.map((row, i) => (
                      <TableRow
                        key={rowKey(row)}
                        style={{ '--i': i } as React.CSSProperties}
                        data-testid="table-row"
                        tabIndex={onRowClick ? 0 : undefined}
                        onClick={onRowClick && (() => onRowClick(row))}
                        onKeyDown={
                          onRowClick &&
                          ((e) => {
                            if (e.key === 'Enter') onRowClick(row);
                          })
                        }
                        className={cn(
                          'af-enter',
                          onRowClick &&
                            'cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none',
                        )}
                      >
                        {columns.map((c) => (
                          <TableCell key={c.id} className={c.className}>
                            {c.cell(row)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </div>

          {/* Phones */}
          <ul className={cn('flex flex-col gap-2 md:hidden', loading && data && 'opacity-60')}>
            {!data
              ? Array.from({ length: 4 }, (_, i) => (
                  <li key={i} className="rounded-lg border bg-card p-4">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="mt-2 h-3 w-3/4" />
                  </li>
                ))
              : data.items.map((row, i) => {
                  const primary = columns.find((c) => c.mobile === 'primary') ?? columns[0]!;
                  const rest = columns.filter((c) => c !== primary && c.mobile === 'secondary');
                  return (
                    <li
                      key={rowKey(row)}
                      data-testid="card-row"
                      className="af-enter"
                      style={{ '--i': i } as React.CSSProperties}
                    >
                      <button
                        type="button"
                        disabled={!onRowClick}
                        onClick={onRowClick && (() => onRowClick(row))}
                        className="w-full rounded-lg border bg-card p-4 text-left transition-transform duration-(--duration-fast) ease-(--ease-out) active:scale-[0.99] active:bg-muted/60 motion-reduce:active:scale-100"
                      >
                        <div className="font-medium">{primary.cell(row)}</div>
                        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                          {rest.map((c) => (
                            <div key={c.id} className="contents">
                              <dt className="text-muted-foreground">{c.header}</dt>
                              <dd className="min-w-0 truncate">{c.cell(row)}</dd>
                            </div>
                          ))}
                        </dl>
                      </button>
                    </li>
                  );
                })}
          </ul>

          {data && data.items.length === 0 && !loading && (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {query.query || Object.keys(query.filters).length ? (
                <>
                  No {label} match these filters.{' '}
                  <Button
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => {
                      setSearch('');
                      setQuery({ query: '', filters: {} });
                    }}
                  >
                    <X /> Clear
                  </Button>
                </>
              ) : (
                (empty ?? `No ${label} yet.`)
              )}
            </div>
          )}
        </>
      )}

      <nav
        aria-label={`${label} pages`}
        className="flex flex-wrap items-center justify-between gap-2 text-sm"
      >
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="hidden sm:inline">Rows per page</span>
          <Select
            value={String(query.pageSize)}
            onValueChange={(v) => setQuery({ pageSize: Number(v) })}
          >
            <SelectTrigger size="sm" className="w-20" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground tabular-nums" data-testid="page-status">
            {data && data.items.length > 0
              ? data.total != null
                ? `${from}–${from + data.items.length - 1} of ${data.total}`
                : `Page ${query.page}`
              : `Page ${query.page}${totalPages ? ` of ${totalPages}` : ''}`}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            aria-label="Previous page"
            disabled={query.page <= 1 || loading}
            onClick={() => setQuery({ page: query.page - 1 })}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            aria-label="Next page"
            disabled={!data?.hasNext || loading}
            onClick={() => setQuery({ page: query.page + 1 })}
          >
            <ChevronRight />
          </Button>
        </div>
      </nav>
    </div>
  );
}
