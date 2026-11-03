'use client';

import { useState } from 'react';
import { Button } from '@ariforce/ui/components/button';

type Page<T> = { data?: { items: T[]; nextCursor?: string | null }; error?: unknown };

/**
 * Follow `nextCursor` until the list ends (or `maxPages`), so a `limit` never truncates silently.
 * Keeps the openapi-fetch `{ data } | { error }` shape; `truncated` is true if `maxPages` was hit.
 */
export async function allPages<T>(
  page: (cursor?: string) => Promise<Page<T>>,
  maxPages = 20,
): Promise<{ data?: { items: T[]; nextCursor: null }; error?: unknown; truncated: boolean }> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const r = await page(cursor);
    if (!r.data) return { error: r.error, truncated: false };
    items.push(...r.data.items);
    cursor = r.data.nextCursor ?? undefined;
    if (!cursor) return { data: { items, nextCursor: null }, truncated: false };
  }
  return { data: { items, nextCursor: null }, truncated: true };
}

/** Render a long list in steps (first `step` rows, then "Show more"). */
export function useShowMore<T>(rows: readonly T[] | null | undefined, step = 50) {
  const [n, setN] = useState(step);
  const list = rows ?? [];
  return {
    visible: list.slice(0, n),
    more: list.length - Math.min(n, list.length),
    showMore: () => setN((x) => x + step),
  };
}

export function ShowMore({ more, onClick }: { more: number; onClick: () => void }) {
  if (more <= 0) return null;
  return (
    <Button variant="outline" size="sm" className="self-center" onClick={onClick}>
      Show more ({more} left)
    </Button>
  );
}

/** Plain notice when a list stops at the server's limit. */
export function LimitNotice({ shown, limit }: { shown: number; limit: number }) {
  if (shown < limit) return null;
  return (
    <p className="text-xs text-muted-foreground" data-testid="limit-notice">
      Showing the first {limit}. Narrow the search to see others.
    </p>
  );
}
