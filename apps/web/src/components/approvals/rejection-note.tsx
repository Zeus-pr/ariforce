'use client';

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(
    new Date(iso),
  );

/**
 * "Rejected: <reason>, by <name>, <date>". The API returns the reason and date on tour plans, leave
 * and expense claims, but not the rejecter's name (decidedBy is an id), so the name shows only when known.
 */
export function rejectionText(reason: string, byName?: string | null, at?: string | null) {
  return [`Rejected: ${reason}`, byName ? `by ${byName}` : null, at ? fmt(at) : null].filter(Boolean).join(', ');
}

export function RejectionNote({
  reason,
  byName,
  at,
  hint,
  testId = 'rejection-note',
}: {
  reason: string;
  byName?: string | null;
  at?: string | null;
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="note" data-testid={testId}>
      <p className="font-medium">{rejectionText(reason, byName, at)}</p>
      {hint && <p className="mt-1 text-xs">{hint}</p>}
    </div>
  );
}
