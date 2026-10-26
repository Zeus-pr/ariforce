import type { ReactNode } from 'react';

/** The server-side list query every table speaks. Mirrors the owner's spec. */
export type SortState = { id: string; desc: boolean } | null;
export type TableQuery = {
  page: number; // 1-based
  pageSize: number;
  query: string;
  sort: SortState;
  filters: Record<string, string>;
};

export type TableResult<T> = {
  items: T[];
  /** Total rows across all pages; null when the API does not report it. */
  total: number | null;
  hasNext: boolean;
};

export type FilterDef = { id: string; label: string; options: { value: string; label: string }[] };

export type DataSource<T> = {
  fetch: (q: TableQuery, signal: AbortSignal) => Promise<TableResult<T>>;
  /** Column ids the server can sort by. Columns not listed here render without sort controls. */
  sortable: string[];
  filters: FilterDef[];
  /** Whether the server supports free-text search. */
  searchable: boolean;
};

export type Column<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Shown on the mobile card list. The first `primary` column is the card title. */
  mobile?: 'primary' | 'secondary' | 'hidden';
};

export const PAGE_SIZES = [10, 25, 50, 100] as const;
