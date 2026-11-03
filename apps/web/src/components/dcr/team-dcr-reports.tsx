'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Dcr } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@ariforce/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ariforce/ui/components/dialog';
import { cn } from '@ariforce/ui/lib/utils';
import { api, apiReady, toApiError } from '@/lib/api';
import { thrownMessage } from '@/lib/dcr/errors';
import { thisMonthIST } from '@/components/tour-plans/month';
import { useRole } from '@/components/shell/role-context';
import { isFieldRole } from '@/lib/roles';
import { DcrFlow } from './dcr-flow';

type DcrPage = { items: Dcr[]; nextCursor: string | null };
type RawResult = { data?: DcrPage; response: Response; error?: unknown };
type UserResult = {
  data?: { items: { id: string; name: string }[]; nextCursor: string | null };
  response: Response;
  error?: unknown;
};
const rawApi = api as unknown as {
  GET: (
    path: string,
    init?: { params?: { query?: Record<string, string | number> } },
  ) => Promise<RawResult>;
};

const dateLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function TeamDcrReports({ className }: { className?: string }) {
  const { user, role } = useRole();
  const [items, setItems] = useState<Dcr[]>([]);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<Dcr | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      await apiReady();
      const month = thisMonthIST();
      const from = `${month}-01`;
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const [submitted, locked] = await Promise.all([
        getDcrPages({ from, to: today, status: 'submitted' }),
        getDcrPages({ from, to: today, status: 'locked' }),
      ]);
      const reports = [...submitted, ...locked]
        .filter((dcr) => dcr.userId !== user.id && !!dcr.submittedAt)
        .sort((a, b) => b.date.localeCompare(a.date));
      setItems(reports);

      if (!isFieldRole(role)) {
        const names = new Map<string, string>();
        let cursor: string | undefined;
        do {
          const result = (await api.GET('/v1/users', {
            params: { query: { status: 'active', limit: 100, ...(cursor ? { cursor } : {}) } },
          })) as UserResult;
          if (!result.data)
            throw new Error(toApiError(result).message || 'Could not load team member names.');
          result.data.items.forEach((person) => names.set(person.id, person.name));
          cursor = result.data.nextCursor ?? undefined;
        } while (cursor && reports.some((report) => !names.has(report.userId)));
        setUserNames(names);
      }
    } catch (cause) {
      setError(thrownMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [role, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!items.length && !loading && !error) return null;

  return (
    <>
      <Card className={cn(className)} data-testid="team-dcr-reports">
        <CardHeader>
          <CardTitle className="text-base">Team DCRs this month</CardTitle>
          <CardDescription>
            {loading
              ? 'Loading…'
              : `${items.length} submitted report${items.length === 1 ? '' : 's'}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div
              className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-danger-soft p-3 text-sm"
              role="alert"
            >
              <span>{error}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          )}
          {items.length > 0 ? (
            <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border">
              {items.map((dcr) => (
                <li
                  key={dcr.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {userNames.get(dcr.userId) ?? 'Team member'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {dateLabel(dcr.date)} · {dcr.status === 'locked' ? 'Locked' : 'Submitted'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setSelected(dcr)}
                  >
                    View full DCR
                  </Button>
                </li>
              ))}
            </ul>
          ) : !loading && !error ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No team DCRs submitted this month.
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent
          className="max-h-[94dvh] max-w-5xl overflow-y-auto"
          data-testid="team-dcr-review"
        >
          <DialogHeader>
            <DialogTitle>
              DCR · {selected ? dateLabel(selected.date) : ''}
              {selected ? ` · ${userNames.get(selected.userId) ?? 'Team member'}` : ''}
            </DialogTitle>
            <DialogDescription>
              Full submitted report, including calls, products, joint work, and saved SFC route
              facts.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <DcrFlow
              key={selected.id}
              initialDate={selected.date}
              dateLocked
              reportId={selected.id}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

async function getDcrPages(query: Record<string, string>) {
  const items: Dcr[] = [];
  let cursor: string | undefined;
  do {
    const r = await rawApi.GET('/v1/dcrs', {
      params: { query: { ...query, limit: 100, ...(cursor ? { cursor } : {}) } },
    });
    if (!r.data || !('items' in r.data))
      throw new Error(toApiError(r).message || 'Could not load team DCRs.');
    items.push(...r.data.items);
    cursor = r.data.nextCursor ?? undefined;
  } while (cursor);
  return items;
}
