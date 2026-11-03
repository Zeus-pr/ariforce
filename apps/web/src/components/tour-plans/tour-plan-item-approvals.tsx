'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@ariforce/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@ariforce/ui/components/card';
import { toast } from '@ariforce/ui/components/sonner';
import { cn } from '@ariforce/ui/lib/utils';
import { RejectDialog } from '@/components/approvals/reject-dialog';
import { useRole } from '@/components/shell/role-context';
import { api, apiReady, toApiError } from '@/lib/api';
import { thrownMessage } from '@/lib/dcr/errors';
import { decideTourPlanItem, fetchPendingTourPlanItems, type TpItem } from '@/lib/tour-plans/items';
import { TourPlanItemEditor } from './tour-plan-item-editor';

const rangeLabel = (from: string, to: string) => {
  const label = (date: string) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  return from === to ? label(from) : `${label(from)} – ${label(to)}`;
};

export function TourPlanItemApprovals({ className }: { className?: string }) {
  const { user } = useRole();
  const [items, setItems] = useState<TpItem[] | null>(null);
  const [workTypeNames, setWorkTypeNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<TpItem | null>(null);
  const [reviewing, setReviewing] = useState<TpItem | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setError(null);
    try {
      const pending = await fetchPendingTourPlanItems(user.id);
      setItems(pending);
      await apiReady();
      const result = await api.GET('/v1/work-types', { params: { query: { limit: 100 } } });
      if (!result.data) throw new Error(toApiError(result).message || 'Could not load work types.');
      setWorkTypeNames(new Map(result.data.items.map((workType) => [workType.id, workType.name])));
    } catch (cause) {
      setError(thrownMessage(cause));
      setItems((current) => current ?? []);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (item: TpItem, decision: 'approve' | 'reject', comment?: string) => {
    if (deciding) return;
    setDeciding(item.id);
    try {
      await decideTourPlanItem(item.id, decision, comment);
      toast.success(
        decision === 'approve'
          ? `${item.userName}'s tour plan approved.`
          : 'Tour plan returned for changes.',
      );
      setRejecting(null);
      await load();
    } catch (cause) {
      toast.error(thrownMessage(cause));
    } finally {
      setDeciding(null);
    }
  };

  if (!items?.length && !error) return null;

  return (
    <Card className={cn(className)} data-testid="tp-item-approvals">
      <CardHeader>
        <CardTitle className="text-base">Tour plans awaiting your approval</CardTitle>
        <CardDescription>{items === null ? 'Loading…' : `${items.length} waiting`}</CardDescription>
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
        {items?.length ? (
          <ul className="divide-y rounded-lg border">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-3"
                data-testid="tp-item-approval"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.userName}</p>
                  <p className="text-sm">
                    {workTypeNames.get(item.plan.workTypeId) ?? 'Tour plan'} ·{' '}
                    {rangeLabel(item.from, item.to)}
                  </p>
                  {item.rejectionReason && (
                    <p className="text-xs text-muted-foreground">
                      Previously returned: {item.rejectionReason}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={deciding !== null}
                    onClick={() => setReviewing(item)}
                  >
                    View full plan
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={deciding !== null}
                    onClick={() => setRejecting(item)}
                  >
                    Reject
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={deciding !== null}
                    onClick={() => void decide(item, 'approve')}
                  >
                    {deciding === item.id ? 'Approving…' : 'Approve'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : !error ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing waiting.</p>
        ) : null}
      </CardContent>
      <RejectDialog
        open={rejecting !== null}
        onOpenChange={(open) => !open && setRejecting(null)}
        title={`Reject ${rejecting?.userName ?? ''}'s tour plan`}
        description="The submitter will see this reason and can update and resubmit the plan."
        onConfirm={(reason) => rejecting && void decide(rejecting, 'reject', reason)}
      />
      <TourPlanItemEditor
        date={reviewing?.from ?? null}
        item={reviewing}
        readOnly
        onClose={() => setReviewing(null)}
        onSaved={() => {}}
      />
    </Card>
  );
}
