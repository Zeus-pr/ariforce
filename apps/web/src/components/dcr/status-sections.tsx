'use client';

import { ChevronRight, Trash2 } from 'lucide-react';
import type { Dcr } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { cn } from '@ariforce/ui/lib/utils';
import { dateLabel } from '@/components/attendance/format';
import { dcrSummary } from '@/components/dcr/dcr-card-parts';
import type { TpDraftCard } from '@/lib/dcr/calendar';

const TONE = {
  draft: 'bg-info-soft text-info',
  pending: 'bg-accent/10 text-teal-700',
  locked: 'bg-muted text-foreground',
  approved: 'bg-success-soft text-success',
  rejected: 'bg-danger-soft text-destructive',
  tp: 'border border-dashed border-teal-600/40 bg-teal-50 text-teal-900',
} as const;

function Section({
  title,
  count,
  children,
  testId,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  testId: string;
}) {
  if (!count) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby={`${testId}-h`} data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={`${testId}-h`} className="text-sm font-medium text-muted-foreground">
          {title}
        </h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          {count} {count === 1 ? 'day' : 'days'}
        </span>
      </div>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function Row({
  title,
  subtitle,
  badge,
  tone,
  onOpen,
  onDelete,
  testId,
}: {
  title: string;
  subtitle: string;
  badge: string;
  tone: string;
  onOpen: () => void;
  onDelete?: () => void;
  testId: string;
}) {
  return (
    <li>
      <div
        className={cn(
          'group/card flex items-stretch gap-1 rounded-xl border bg-card p-1.5 shadow-xs',
          'transition-[border-color,box-shadow] duration-(--duration-fast) ease-(--ease-out) hover:border-foreground/20',
        )}
      >
        <button
          type="button"
          onClick={onOpen}
          data-testid={testId}
          className={cn(
            'flex min-w-0 flex-1 items-start gap-3 rounded-lg py-2.5 pr-1.5 pl-2.5 text-left outline-none',
            'transition-[background-color,transform] duration-(--duration-fast) ease-(--ease-out)',
            'hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.99] motion-reduce:active:scale-100',
          )}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold tracking-tight">{title}</span>
              <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', tone)}>
                {badge}
              </span>
            </span>
            <span className="text-sm text-muted-foreground">{subtitle}</span>
          </span>
          <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
        {onDelete && (
          <>
            <span className="my-3 w-px shrink-0 bg-border" aria-hidden />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10 shrink-0 self-center text-muted-foreground hover:bg-danger-soft hover:text-destructive"
              onClick={onDelete}
              aria-label={`Delete draft for ${title}`}
              data-testid="dcr-row-delete"
            >
              <Trash2 aria-hidden />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/** Status lists under the DCR calendar — same card language as the existing drafts list. */
export function DcrStatusSections({
  drafts,
  pending,
  locked,
  approved,
  rejected,
  tpCards,
  wtName,
  placeName,
  onOpenDcr,
  onOpenTp,
  onDeleteDraft,
}: {
  drafts: Dcr[];
  pending: Dcr[];
  locked: Dcr[];
  approved: Dcr[];
  rejected: Dcr[];
  tpCards: TpDraftCard[];
  wtName: (id: string) => string | undefined;
  placeName: Map<string, string>;
  onOpenDcr: (d: Dcr) => void;
  onOpenTp: (t: TpDraftCard) => void;
  onDeleteDraft: (d: Dcr) => void;
}) {
  return (
    <div className="flex flex-col gap-6" data-testid="dcr-status-sections">
      <Section title="Drafts" count={drafts.length} testId="dcr-sec-drafts">
        {drafts.map((d) => (
          <Row
            key={d.id}
            title={dateLabel(d.date)}
            subtitle={dcrSummary(d, wtName(d.workTypeId), placeName)}
            badge="Draft"
            tone={TONE.draft}
            onOpen={() => onOpenDcr(d)}
            onDelete={() => onDeleteDraft(d)}
            testId="dcr-row-draft"
          />
        ))}
      </Section>
      <Section title="Pending review" count={pending.length} testId="dcr-sec-pending">
        {pending.map((d) => (
          <Row
            key={d.id}
            title={dateLabel(d.date)}
            subtitle={dcrSummary(d, wtName(d.workTypeId), placeName)}
            badge="Pending"
            tone={TONE.pending}
            onOpen={() => onOpenDcr(d)}
            testId="dcr-row-pending"
          />
        ))}
      </Section>
      <Section title="Locked" count={locked.length} testId="dcr-sec-locked">
        {locked.map((d) => (
          <Row
            key={d.id}
            title={dateLabel(d.date)}
            subtitle={dcrSummary(d, wtName(d.workTypeId), placeName)}
            badge="Locked"
            tone={TONE.locked}
            onOpen={() => onOpenDcr(d)}
            testId="dcr-row-locked"
          />
        ))}
      </Section>
      <Section title="Approved" count={approved.length} testId="dcr-sec-approved">
        {approved.map((d) => (
          <Row
            key={d.id}
            title={dateLabel(d.date)}
            subtitle={dcrSummary(d, wtName(d.workTypeId), placeName)}
            badge="Approved"
            tone={TONE.approved}
            onOpen={() => onOpenDcr(d)}
            testId="dcr-row-approved"
          />
        ))}
      </Section>
      <Section title="Rejected" count={rejected.length} testId="dcr-sec-rejected">
        {rejected.map((d) => (
          <Row
            key={d.id}
            title={dateLabel(d.date)}
            subtitle={dcrSummary(d, wtName(d.workTypeId), placeName)}
            badge="Rejected"
            tone={TONE.rejected}
            onOpen={() => onOpenDcr(d)}
            testId="dcr-row-rejected"
          />
        ))}
      </Section>
      <Section title="Drafts from tour plan" count={tpCards.length} testId="dcr-sec-tp">
        {tpCards.map((t) => (
          <Row
            key={t.id}
            title={
              t.pendingDates.length === 1
                ? dateLabel(t.pendingDates[0]!)
                : `${dateLabel(t.from)} – ${dateLabel(t.to)}`
            }
            subtitle={
              t.label ||
              `${t.pendingDates.length} day${t.pendingDates.length === 1 ? '' : 's'} to file`
            }
            badge="From TP"
            tone={TONE.tp}
            onOpen={() => onOpenTp(t)}
            testId="dcr-row-tp"
          />
        ))}
      </Section>
    </div>
  );
}
