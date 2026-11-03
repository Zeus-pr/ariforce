'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  EXCEPTION_RULE_CODES,
  EXCEPTION_RULES,
  type ExceptionItem,
  type ExceptionSummary,
} from '@ariforce/contracts';
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@ariforce/ui/components/sheet';
import { toast } from '@ariforce/ui/components/sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ariforce/ui/components/table';
import { useRole } from '@/components/shell/role-context';
import { api, apiReady, toApiError } from '@/lib/api';
import {
  STATUS_FILTERS,
  STATUS_LABEL,
  SEVERITY_LABEL,
  can,
  exceptionMessage,
  isClosed,
  measured,
  sourceLink,
} from './model';

const ALL = 'all';
const PAGE = 50;
const sevClass = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-amber-100 text-amber-900',
  low: 'bg-slate-100 text-slate-700',
} as const;
const fmt = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export function ExceptionsView() {
  const [status, setStatus] = useState('active');
  const [severity, setSeverity] = useState(ALL);
  const [rule, setRule] = useState(ALL);
  const [mine, setMine] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [items, setItems] = useState<ExceptionItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [summary, setSummary] = useState<ExceptionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const query = useCallback(
    (c?: string) => ({
      ...(STATUS_FILTERS[status]?.value ? { status: STATUS_FILTERS[status]!.value } : {}),
      ...(severity !== ALL ? { severity } : {}),
      ...(rule !== ALL ? { ruleCode: rule } : {}),
      ...(mine ? { assignedToMe: 'true' as const } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      limit: PAGE,
      ...(c ? { cursor: c } : {}),
    }),
    [status, severity, rule, mine, from, to],
  );

  const load = useCallback(async () => {
    if (from && to && from > to)
      return setError('The start date must be on or before the end date.');
    await apiReady();
    const [l, s] = await Promise.all([
      api.GET('/v1/exceptions', { params: { query: query() as never } }),
      api.GET('/v1/exceptions/summary', { params: { query: {} } }),
    ]);
    if (!l.data) {
      setItems([]);
      return setError(exceptionMessage(toApiError(l).code, toApiError(l).message));
    }
    setError(null);
    setItems(l.data.items);
    setCursor(l.data.nextCursor);
    if (s.data) setSummary(s.data);
  }, [query, from, to]);
  useEffect(() => void load(), [load]);

  async function more() {
    if (!cursor) return;
    setLoadingMore(true);
    const l = await api.GET('/v1/exceptions', { params: { query: query(cursor) as never } });
    setLoadingMore(false);
    if (!l.data) return toast.error(exceptionMessage(toApiError(l).code, toApiError(l).message));
    setItems((cur) => [...(cur ?? []), ...l.data.items]);
    setCursor(l.data.nextCursor);
  }
  const replace = (x: ExceptionItem) =>
    setItems((cur) => cur?.map((y) => (y.id === x.id ? x : y)) ?? null);

  return (
    <div className="flex flex-col gap-4">
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="exc-summary">
          <Stat label="Open" value={summary.open} testId="exc-count-open" />
          {(['high', 'medium', 'low'] as const).map((s) => (
            <Stat
              key={s}
              label={`${SEVERITY_LABEL[s]} (open)`}
              value={summary.openBySeverity[s]}
              testId={`exc-count-${s}`}
            />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Filter
          label="Status"
          value={status}
          onChange={setStatus}
          testId="exc-f-status"
          options={Object.entries(STATUS_FILTERS).map(([k, v]) => [k, v.label])}
        />
        <Filter
          label="Severity"
          value={severity}
          onChange={setSeverity}
          testId="exc-f-severity"
          options={[
            [ALL, 'All'],
            ['high', 'High'],
            ['medium', 'Medium'],
            ['low', 'Low'],
          ]}
        />
        <Filter
          label="Type"
          value={rule}
          onChange={setRule}
          testId="exc-f-rule"
          options={[
            [ALL, 'All types'],
            ...EXCEPTION_RULE_CODES.map((c) => [c, EXCEPTION_RULES[c].name] as [string, string]),
          ]}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="exc-from">From</Label>
          <Input
            id="exc-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-40"
            data-testid="exc-f-from"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="exc-to">To</Label>
          <Input
            id="exc-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-40"
            data-testid="exc-f-to"
          />
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={mine}
            onChange={(e) => setMine(e.target.checked)}
            data-testid="exc-f-mine"
          />{' '}
          Assigned to me
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="exc-error">
          {error}
        </p>
      )}
      {items === null ? (
        <div className="h-48 animate-pulse rounded-lg bg-muted" aria-busy="true" />
      ) : items.length === 0 ? (
        <p
          className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
          data-testid="exc-empty"
        >
          Nothing needs attention for these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((x) => (
                <TableRow
                  key={x.id}
                  className="cursor-pointer"
                  onClick={() => setOpenId(x.id)}
                  data-testid="exc-row"
                  data-severity={x.severity}
                  data-status={x.status}
                >
                  <TableCell>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${sevClass[x.severity]}`}
                    >
                      {SEVERITY_LABEL[x.severity]}
                    </span>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="text-left font-medium hover:underline"
                      onClick={() => setOpenId(x.id)}
                    >
                      {x.ruleName}
                    </button>
                  </TableCell>
                  <TableCell>{x.user.name}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmt(x.periodDate)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{STATUS_LABEL[x.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    {x.assignee?.name ?? '—'}
                    {x.followUpOn && (
                      <span className="block text-xs text-muted-foreground">
                        Follow up {fmt(x.followUpOn)}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {cursor && (
        <Button
          variant="outline"
          className="self-center"
          disabled={loadingMore}
          onClick={() => void more()}
          data-testid="exc-more"
        >
          {loadingMore ? 'Loading…' : 'Show more'}
        </Button>
      )}
      <ExceptionDetail
        id={openId}
        onClose={() => setOpenId(null)}
        onChange={(x) => {
          replace(x);
          void api
            .GET('/v1/exceptions/summary', { params: { query: {} } })
            .then((s) => s.data && setSummary(s.data));
        }}
      />
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-48" aria-label={label} data-testid={testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([k, v]) => (
            <SelectItem key={k} value={k}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ExceptionDetail({
  id,
  onClose,
  onChange,
}: {
  id: string | null;
  onClose: () => void;
  onChange: (x: ExceptionItem) => void;
}) {
  const { role } = useRole();
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    // Mock: /v1/me is not persona-scoped by default, so name the persona explicitly.
    void apiReady()
      .then(() => api.GET('/v1/me'))
      .then((r) => r.data && setMe(r.data.id));
  }, [role]);
  const user = me ? { id: me } : null;
  const [x, setX] = useState<ExceptionItem | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [follow, setFollow] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setX(null);
    setErr(null);
    setNote('');
    if (!id) return;
    void api.GET('/v1/exceptions/{id}', { params: { path: { id } } }).then((r) => {
      if (!r.data) return setErr(exceptionMessage(toApiError(r).code, toApiError(r).message));
      setX(r.data);
      setFollow(r.data.followUpOn ?? '');
    });
  }, [id]);

  const subject = !!x && !!user && x.user.id === user.id;
  const manager = !!x && can(role, 'approvals:decide') && !subject;
  const open = !!x && !isClosed(x);

  async function run(kind: 'explain' | 'resolve' | 'dismiss' | 'assign' | 'unassign' | 'follow') {
    if (!x) return;
    if ((kind === 'explain' || kind === 'resolve' || kind === 'dismiss') && !note.trim())
      return setErr('Write a short note first.');
    setBusy(true);
    setErr(null);
    const path = { params: { path: { id: x.id } } };
    const r =
      kind === 'explain'
        ? await api.POST('/v1/exceptions/{id}/explain', { ...path, body: { note: note.trim() } })
        : kind === 'resolve'
          ? await api.POST('/v1/exceptions/{id}/resolve', { ...path, body: { note: note.trim() } })
          : kind === 'dismiss'
            ? await api.POST('/v1/exceptions/{id}/dismiss', {
                ...path,
                body: { note: note.trim() },
              })
            : await api.PATCH('/v1/exceptions/{id}', {
                ...path,
                body:
                  kind === 'follow'
                    ? { followUpOn: follow || null, version: x.version }
                    : { assigneeId: kind === 'assign' ? user!.id : null, version: x.version },
              });
    setBusy(false);
    if (!r.data) return setErr(exceptionMessage(toApiError(r).code, toApiError(r).message));
    setX(r.data);
    setNote('');
    onChange(r.data);
    toast.success(
      {
        explain: 'Explanation sent',
        resolve: 'Marked resolved',
        dismiss: 'Dismissed',
        assign: 'Assigned to you',
        unassign: 'Owner cleared',
        follow: 'Follow-up date saved',
      }[kind],
    );
  }

  const link = x && sourceLink(x);
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg" data-testid="exc-detail">
        <SheetHeader>
          <SheetTitle>{x?.ruleName ?? 'Exception'}</SheetTitle>
          <SheetDescription>
            {x ? `${x.user.name} · ${fmt(x.periodDate)}` : 'Loading…'}
          </SheetDescription>
        </SheetHeader>
        {x && (
          <div className="flex flex-col gap-4 px-4 pb-6 text-sm">
            <div className="flex flex-wrap gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${sevClass[x.severity]}`}>
                {SEVERITY_LABEL[x.severity]}
              </span>
              <Badge variant="outline" data-testid="exc-detail-status">
                {STATUS_LABEL[x.status]}
              </Badge>
              {x.autoResolved && <Badge variant="outline">Cleared automatically</Badge>}
            </div>
            {measured(x) && (
              <p>
                <span className="text-muted-foreground">Measured: </span>
                {measured(x)}
              </p>
            )}
            <div>
              <div className="text-xs font-medium text-muted-foreground">Suggested action</div>
              <p data-testid="exc-action">{x.suggestedAction}</p>
            </div>
            {link && (
              <Button asChild size="sm" variant="outline" className="w-fit">
                <Link href={link.href} data-testid="exc-source">
                  {link.label}
                </Link>
              </Button>
            )}
            {x.explanation && (
              <div data-testid="exc-explanation">
                <div className="text-xs font-medium text-muted-foreground">
                  Explanation from {x.user.name}
                </div>
                <p className="whitespace-pre-wrap">{x.explanation}</p>
              </div>
            )}
            {x.resolutionNote && (
              <div data-testid="exc-resolution">
                <div className="text-xs font-medium text-muted-foreground">
                  {x.status === 'dismissed' ? 'Dismissed' : 'Resolved'}
                  {x.resolvedBy ? ` by ${x.resolvedBy.name}` : ''}
                </div>
                <p className="whitespace-pre-wrap">{x.resolutionNote}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-muted-foreground">Owner</div>
                <div data-testid="exc-owner">{x.assignee?.name ?? 'Nobody yet'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Follow up on</div>
                <div>{x.followUpOn ? fmt(x.followUpOn) : '—'}</div>
              </div>
            </div>
            {open && (subject || manager) && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="exc-note">{subject ? 'Your explanation' : 'Note'}</Label>
                <textarea
                  id="exc-note"
                  maxLength={1000}
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="rounded-md border bg-background px-3 py-2 text-base md:text-sm"
                  data-testid="exc-note"
                />
                <div className="flex flex-wrap gap-2">
                  {subject && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void run('explain')}
                      data-testid="exc-explain"
                    >
                      Send explanation
                    </Button>
                  )}
                  {manager && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void run('resolve')}
                      data-testid="exc-resolve"
                    >
                      Resolve
                    </Button>
                  )}
                  {manager && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void run('dismiss')}
                      data-testid="exc-dismiss"
                    >
                      Dismiss
                    </Button>
                  )}
                </div>
              </div>
            )}
            {open && manager && (
              <div className="flex flex-col gap-2 border-t pt-3">
                <div className="flex flex-wrap gap-2">
                  {x.assignee?.id !== user?.id ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void run('assign')}
                      data-testid="exc-assign"
                    >
                      Assign to me
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void run('unassign')}
                      data-testid="exc-unassign"
                    >
                      Clear owner
                    </Button>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="exc-follow">Follow up on</Label>
                    <Input
                      id="exc-follow"
                      type="date"
                      value={follow}
                      onChange={(e) => setFollow(e.target.value)}
                      className="w-44"
                      data-testid="exc-follow"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run('follow')}
                    data-testid="exc-follow-save"
                  >
                    Save date
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        {err && (
          <p role="alert" className="px-4 text-sm text-destructive" data-testid="exc-detail-error">
            {err}
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
