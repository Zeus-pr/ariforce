'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Approval } from '@ariforce/contracts';
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@ariforce/ui/components/card';
import { toast } from '@ariforce/ui/components/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ariforce/ui/components/tabs';
import { cn } from '@ariforce/ui/lib/utils';
import { api, apiReady, toApiError } from '@/lib/api';
import { approvalDecisionMessage } from '@/lib/leave/model';
import { ApprovalReview } from './approval-review';
import { RejectDialog } from './reject-dialog';

/** Moved unchanged from the dashboard so the dashboard card and /approvals share one queue. */
const APPROVAL_TABS = [
  { value: 'all', label: 'All' },
  { value: 'tour_plan', label: 'Tour plans' },
  { value: 'dcr_unlock', label: 'DCR unlock' },
  { value: 'leave', label: 'Leave' },
] as const;
export const SUBJECT_LABEL: Partial<Record<Approval['subjectType'], string>> = {
  tour_plan: 'Tour plan',
  dcr_unlock: 'DCR unlock',
  leave: 'Leave',
  doctor: 'Doctor',
  chemist: 'Chemist',
  stockist: 'Stockist',
  device: 'Device',
  expense: 'Expense',
  dcr: 'DCR',
  signup: 'Sign-up',
};

export function ApprovalsQueue({ className, bare }: { className?: string; bare?: boolean }) {
  const [items, setItems] = useState<Approval[] | null>(null);
  const [returning, setReturning] = useState<Approval | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(async () => {
    await apiReady();
    const r = await api.GET('/v1/approvals', {
      params: { query: { status: 'pending', mine: 'to_decide', limit: 50 } },
    });
    setItems(r.data?.items ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const [deciding, setDeciding] = useState<string | null>(null);
  async function decide(a: Approval, decision: 'approve' | 'reject', note?: string) {
    if (deciding) return;
    setDeciding(a.id);
    let r;
    try {
      r = await api.POST('/v1/approvals/{id}/decision', {
        params: { path: { id: a.id } },
        body: decision === 'approve' ? { decision } : { decision, comment: note },
      });
    } catch {
      return toast.error('Could not reach the server. Nothing was saved; try again.');
    } finally {
      setDeciding(null);
    }
    // LEAVE_DCR_CONFLICT: nothing saved, the approval stays pending in the list.
    if (r.error) return toast.error(approvalDecisionMessage(toApiError(r)), { duration: 10000 });
    toast.success(decision === 'approve' ? `${a.summary} approved` : `${a.summary} rejected`);
    setReturning(null);
    void load();
  }

  return (
    <Card className={cn('gap-0 py-0 shadow-xs', className)} data-testid="dash-approvals">
      <CardHeader className="border-b px-4 py-4">
        {!bare && <CardTitle className="text-base">Approvals</CardTitle>}
        <CardDescription>
          {items === null ? 'Loading…' : `${items.length} waiting on you`}
        </CardDescription>
      </CardHeader>
      <Tabs defaultValue="all" className="gap-0">
        <TabsList className="mx-4 mt-3">
          {APPROVAL_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {APPROVAL_TABS.map((t) => {
          const rows = (items ?? []).filter((a) => t.value === 'all' || a.subjectType === t.value);
          return (
            <TabsContent key={t.value} value={t.value}>
              {rows.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Nothing waiting.
                </p>
              ) : (
                <ul className="divide-y">
                  {rows.map((a, i) => (
                    <li
                      key={a.id}
                      style={{ '--i': i } as React.CSSProperties}
                      className="af-enter px-4 py-3"
                      data-testid="dash-approval"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{a.requestedByName}</p>
                        <Badge variant="secondary" className="font-normal">
                          {SUBJECT_LABEL[a.subjectType] ?? a.subjectType}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{a.summary}</p>
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          disabled={deciding !== null}
                          onClick={() => void decide(a, 'approve')}
                          data-testid="dash-approve"
                        >
                          {deciding === a.id ? 'Approving…' : 'Approve'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={deciding !== null}
                          onClick={() => setReturning(a)}
                          data-testid="dash-reject"
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={openId === a.id}
                          onClick={() => setOpenId(openId === a.id ? null : a.id)}
                          data-testid="approval-view"
                        >
                          {openId === a.id ? 'Hide details' : 'View details'}
                        </Button>
                      </div>
                      {openId === a.id && <ApprovalReview approval={a} />}
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
      <RejectDialog
        open={returning !== null}
        onOpenChange={(o) => !o && setReturning(null)}
        title={`Reject ${returning?.summary ?? ''}`}
        description={`${returning?.requestedByName ?? ''} sees this reason and can resubmit.`}
        onConfirm={(reason) => returning && decide(returning, 'reject', reason)}
      />
    </Card>
  );
}
