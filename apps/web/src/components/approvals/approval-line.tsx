'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@ariforce/ui/components/button';
import type { Approval } from '@ariforce/contracts';
import { ReviewBar } from '@/components/dcr/team-dcr-detail';
import { SignupInline } from '@/components/signups/signup-requests-view';
import { ApprovalReview } from './approval-review';
import { DecisionBar } from './decision-bar';
import { InboxRow } from './inbox-row';
import { SUBJECT_LABEL } from './approvals-queue';

/**
 * An approval request, daily report or sign-up as one row. Approve and Reject (with a reason) sit on
 * the row itself; "View details" opens the full subject underneath.
 */
export function ApprovalLine({
  approval: a,
  meta,
  lead,
  decidable,
  onDone,
}: {
  approval: Approval;
  meta?: ReactNode;
  lead?: ReactNode;
  decidable: boolean;
  onDone?: () => void;
}) {
  const signup = a.subjectType === 'signup';
  const sheet =
    a.subjectType === 'stock_statement' || a.subjectType === 'stock_statement_unlock'
      ? `/aws-ss?statement=${a.subjectId}`
      : null;
  const decide =
    !decidable || signup ? undefined : a.subjectType === 'dcr' ? (
      <ReviewBar id={a.subjectId} onDone={() => onDone?.()} />
    ) : (
      <DecisionBar approval={a} onDone={onDone} />
    );
  return (
    <InboxRow
      name={a.requestedByName}
      role={a.requestedByRole}
      badge={SUBJECT_LABEL[a.subjectType] ?? a.subjectType}
      summary={a.summary}
      meta={meta}
      body={decidable && signup ? <SignupInline id={a.subjectId} onDecided={onDone} /> : undefined}
      actions={
        sheet ? (
          <>
            {decide}
            <Button asChild size="sm" variant="ghost">
              <Link href={sheet}>View details</Link>
            </Button>
          </>
        ) : (
          decide
        )
      }
      details={
        sheet || (signup && decidable) ? undefined : (
          <div className="flex flex-col gap-3">
            {lead}
            <ApprovalReview approval={a} readOnly />
          </div>
        )
      }
    />
  );
}
