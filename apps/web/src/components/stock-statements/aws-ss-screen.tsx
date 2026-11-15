'use client';

import { ChevronDown } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { cn } from '@ariforce/ui/lib/utils';
import {
  confirmFile,
  downloadPdf,
  fileLink,
  getStatement,
  listStatements,
  listStockists,
  messageOf,
  openStatement,
  presignFile,
  saveLines,
  submitStatement,
  type HistoryItem,
  type Statement,
  type StatementLine,
  type StatementStatus,
  type StockistOption,
} from '@/lib/stock-statements/api';
import { API_URL, apiReady } from '@/lib/api';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});
const monthNow = () => new Date().toISOString().slice(0, 7);

const groups = [
  { title: 'Opening', head: 'bg-emerald-100', cell: 'bg-emerald-50' },
  { title: 'Purchase', head: 'bg-teal-100', cell: 'bg-teal-50' },
  { title: 'Secondary', head: 'bg-sky-100', cell: 'bg-sky-50' },
  { title: 'Closing', head: 'bg-violet-100', cell: 'bg-violet-50' },
  { title: 'FRS', head: 'bg-amber-100', cell: 'bg-amber-50' },
] as const;

type Draft = {
  openingQty: number | null;
  purchaseQty: number;
  secondaryQty: number;
  frsQty: number;
};

export function AwsSsScreen() {
  const [stockists, setStockists] = useState<StockistOption[] | null>(null);
  const [stockistId, setStockistId] = useState('');
  const [month, setMonth] = useState(monthNow);
  const [sheet, setSheet] = useState<Statement | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [waiting, setWaiting] = useState<HistoryItem[]>([]);
  const [historyStatus, setHistoryStatus] = useState<StatementStatus | 'all'>('all');
  const historyRef = useRef<HTMLDialogElement>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    listStockists()
      .then((r) => setStockists(r.items))
      .catch((e) => setError(messageOf(e)));
    listStatements({ waiting: true })
      .then((r) => setWaiting(r.items))
      .catch(() => setWaiting([]));
  }, []);

  const selected = (stockists ?? []).find((s) => s.id === stockistId) ?? null;

  async function load(id: string, m: string) {
    setBusy('open');
    setError(null);
    setSaved(false);
    try {
      const next = await openStatement(id, m);
      setSheet(next);
      setDrafts({});
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  function lineOf(line: StatementLine): Draft {
    return (
      drafts[line.productId] ?? {
        openingQty: line.openingQty,
        purchaseQty: line.purchaseQty,
        secondaryQty: line.secondaryQty,
        frsQty: line.frsQty,
      }
    );
  }

  function setQty(line: StatementLine, key: keyof Draft, raw: string) {
    const current = lineOf(line);
    const value = raw === '' && key === 'openingQty' ? null : Number(raw);
    if (value != null && (!Number.isInteger(value) || value < 0)) return;
    setDrafts((d) => ({ ...d, [line.productId]: { ...current, [key]: value } }));
    setSaved(false);
  }

  const view = useMemo(() => {
    if (!sheet) return [];
    return sheet.lines.map((line) => {
      const d = lineOf(line);
      const value = (qty: number | null) =>
        qty == null || line.pts == null ? null : Math.round(qty * line.pts * 100) / 100;
      const closingQty =
        d.openingQty == null ? null : d.openingQty + d.purchaseQty - d.secondaryQty - d.frsQty;
      return {
        ...line,
        ...d,
        openingValue: value(d.openingQty),
        purchaseValue: value(d.purchaseQty),
        secondaryValue: value(d.secondaryQty),
        frsValue: value(d.frsQty),
        closingQty,
        closingValue: value(closingQty),
      };
    });
  }, [sheet, drafts]);

  const actual = view.reduce((s, l) => s + (l.secondaryValue ?? 0) - (l.frsValue ?? 0), 0);

  async function save() {
    if (!sheet) return;
    const lines = Object.entries(drafts).map(([productId, d]) => ({ productId, ...d }));
    if (!lines.length) return;
    setBusy('save');
    setError(null);
    try {
      const next = await saveLines(sheet.id, sheet.version, lines);
      setSheet(next);
      setDrafts({});
      setSaved(true);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'VERSION_CONFLICT') {
        const fresh = await getStatement(sheet.id);
        setSheet(fresh);
        setError(
          'Someone else saved this sheet. Your unsaved numbers are still here. Save again to keep them.',
        );
      } else setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (!sheet) return;
    setBusy('submit');
    setError(null);
    try {
      let current = sheet;
      if (Object.keys(drafts).length) {
        current = await saveLines(
          sheet.id,
          sheet.version,
          Object.entries(drafts).map(([productId, d]) => ({ productId, ...d })),
        );
        setDrafts({});
      }
      const next = await submitStatement(current.id, current.version);
      setSheet(next);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function upload(kind: 'aws' | 'ss', file: File) {
    if (!sheet) return;
    setBusy(kind);
    setError(null);
    try {
      const up = await presignFile(sheet.id, kind, file);
      const put = await fetch(up.uploadUrl, { method: 'PUT', headers: up.headers, body: file });
      if (!put.ok) throw new Error('The file did not upload. Try again.');
      setSheet(await confirmFile(sheet.id, kind));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function downloadFile(kind: 'aws' | 'ss') {
    if (!sheet) return;
    const { downloadUrl } = await fileLink(sheet.id, kind);
    window.open(downloadUrl, '_blank', 'noopener');
  }

  async function decide(decision: 'approve' | 'reject') {
    if (!sheet?.approvalRequestId) return;
    setBusy('decide');
    setError(null);
    try {
      let current = sheet;
      if (Object.keys(drafts).length) {
        current = await saveLines(
          sheet.id,
          sheet.version,
          Object.entries(drafts).map(([productId, d]) => ({ productId, ...d })),
        );
        setDrafts({});
        setSheet(current);
      }
      await apiReady();
      const res = await fetch(`${API_URL}/v1/approvals/${current.approvalRequestId}/decision`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decision,
          comment: decision === 'reject' ? reason.trim() : undefined,
        }),
      });
      if (!res.ok) throw await res.json();
      setSheet(await getStatement(current.id));
      setRejecting(false);
      setReason('');
      setWaiting((await listStatements({ waiting: true })).items);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    setEditing(false);
  }, [sheet?.id, sheet?.status]);
  const fieldsOpen = !!sheet && sheet.editable && (sheet.status !== 'pending' || editing);
  const history = (sheet?.history ?? []).filter(
    (h) => historyStatus === 'all' || h.status === historyStatus,
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="relative z-50 grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-start">
        <StockistDropdown
          stockists={stockists}
          selected={selected}
          onSelect={(id) => {
            setStockistId(id);
            setSheet(null);
            setDrafts({});
            if (id) void load(id, month);
          }}
        />
        <label className="flex flex-col gap-1 text-sm">
          Month
          <Input
            type="month"
            value={month}
            max={monthNow()}
            onChange={(e) => {
              const next = e.target.value;
              setMonth(next);
              if (stockistId && next) void load(stockistId, next);
            }}
          />
        </label>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {waiting.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Waiting for you</h2>
          <ul className="flex flex-col">
            {waiting.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="text-sm underline-offset-4 hover:underline"
                  onClick={() => void getStatement(item.id).then(setSheet)}
                >
                  {item.stockistName}, {item.month}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {sheet && (
        <div key={sheet.id + sheet.month} className="af-sheet flex flex-col gap-4">
          <div className="min-w-0">
            {sheet.address && (
              <p className="break-words text-sm text-muted-foreground">{sheet.address}</p>
            )}
            <p className="text-sm text-muted-foreground">
              {sheet.month} · {label(sheet.status)}
              {sheet.currentApproverName ? ` · with ${sheet.currentApproverName}` : ''}
            </p>
            {sheet.rejectionReason && (
              <p className="text-sm text-destructive">Rejected: {sheet.rejectionReason}</p>
            )}
          </div>
          <div className="sticky top-0 z-40 -mx-4 flex min-h-[4.25rem] items-center gap-4 border-b bg-background/95 px-4 py-2 backdrop-blur-sm sm:-mx-6 sm:px-6">
            <div className="min-w-0">
              <p className="truncate font-medium" title={sheet.stockistName}>
                {sheet.stockistName}
              </p>
              <p className="text-lg font-medium tabular-nums">
                Actual secondary {inr.format(Math.round(actual * 100) / 100)}
              </p>
            </div>
            {sheet.canDecide && !editing && (
              <button
                type="button"
                className="h-9 w-28 shrink-0 rounded-md border text-sm"
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
            )}
            <div className="ml-auto grid w-[42rem] shrink-0 grid-cols-6 gap-2">
              <button
                type="button"
                className="h-9 w-full rounded-md border text-sm"
                onClick={() => historyRef.current?.showModal()}
              >
                History
              </button>
              <FileButton
                label={sheet.aws.status === 'confirmed' ? 'Replace AWS' : 'Upload AWS'}
                disabled={!fieldsOpen || busy != null}
                onFile={(f) => void upload('aws', f)}
              />
              <FileButton
                label={sheet.ss.status === 'confirmed' ? 'Replace SS' : 'Upload SS'}
                disabled={!fieldsOpen || busy != null}
                onFile={(f) => void upload('ss', f)}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={!fieldsOpen || busy != null || !Object.keys(drafts).length}
                onClick={() => void save()}
              >
                {busy === 'save' ? 'Saving…' : saved ? 'Saved' : 'Save draft'}
              </Button>
              <Button
                type="button"
                className="w-full"
                disabled={!sheet.canSubmit || busy != null}
                onClick={() => void submit()}
              >
                {busy === 'submit' ? 'Submitting…' : 'Submit'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() =>
                  void downloadPdf(sheet.id, `${sheet.stockistName}-${sheet.month}.pdf`)
                }
              >
                Export
              </Button>
            </div>
          </div>
          {(sheet.aws.status === 'confirmed' || sheet.ss.status === 'confirmed') && (
            <div className="flex gap-4 text-sm">
              {sheet.aws.status === 'confirmed' && (
                <button
                  type="button"
                  className="underline-offset-4 hover:underline"
                  onClick={() => void downloadFile('aws')}
                >
                  Download AWS
                </button>
              )}
              {sheet.ss.status === 'confirmed' && (
                <button
                  type="button"
                  className="underline-offset-4 hover:underline"
                  onClick={() => void downloadFile('ss')}
                >
                  Download SS
                </button>
              )}
            </div>
          )}
          {sheet.canDecide && (
            <div className="flex flex-wrap items-end gap-2">
              <Button type="button" disabled={busy != null} onClick={() => void decide('approve')}>
                Approve
              </Button>
              <Button type="button" variant="outline" onClick={() => setRejecting((v) => !v)}>
                Reject
              </Button>
              {rejecting && (
                <>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason"
                    className="max-w-sm"
                  />
                  <Button
                    type="button"
                    disabled={reason.trim().length < 1 || busy != null}
                    onClick={() => void decide('reject')}
                  >
                    Send back
                  </Button>
                </>
              )}
            </div>
          )}
          <div
            tabIndex={0}
            role="region"
            aria-label="Stock and sales lines"
            className="rounded-md border"
          >
            <table className="w-full min-w-[62rem] table-fixed border-separate border-spacing-0 border-border text-sm tabular-nums [&_tbody_td]:border-b [&_tbody_th]:border-b [&_td]:border-border [&_th]:border-border">
              <colgroup>
                <col className="w-[10rem]" />
                <col className="w-[3.5rem]" />
                {groups.map((group) => (
                  <Fragment key={group.title}>
                    <col className="w-[4.75rem]" />
                    <col className="w-[5.25rem]" />
                  </Fragment>
                ))}
              </colgroup>
              <thead className="sticky top-[4.25rem] z-20 text-left">
                <tr>
                  <th
                    rowSpan={2}
                    scope="col"
                    className="sticky left-0 z-30 border-r-2 border-b bg-background px-2 py-2 align-bottom font-medium"
                  >
                    Product
                  </th>
                  <th
                    rowSpan={2}
                    scope="col"
                    className="border-r-2 border-b bg-background px-1 py-2 align-bottom font-medium"
                  >
                    Pack
                  </th>
                  {groups.map((group) => (
                    <th
                      key={group.title}
                      colSpan={2}
                      scope="colgroup"
                      className={cn(
                        'border-r-2 border-b px-1 py-1 text-center font-medium',
                        group.head,
                      )}
                    >
                      {group.title}
                    </th>
                  ))}
                </tr>
                <tr>
                  {groups.map((group) => (
                    <Pair key={group.title} title={group.title} head={group.head} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.map((line) => (
                  <tr key={line.productId} className="border-t">
                    <th
                      className="sticky left-0 z-10 border-r-2 bg-background px-2 py-1 text-left font-normal"
                      title={line.name}
                    >
                      <span className="block truncate">{line.name}</span>
                    </th>
                    <td className="border-r-2 px-1 text-muted-foreground">{line.packSize}</td>
                    <Qty
                      tone={groups[0].cell}
                      value={line.openingQty}
                      locked={!fieldsOpen || line.openingLocked}
                      onChange={(v) => setQty(line, 'openingQty', v)}
                    />
                    <Money tone={groups[0].cell} value={line.openingValue} edge />
                    <Qty
                      tone={groups[1].cell}
                      value={line.purchaseQty}
                      locked={!fieldsOpen}
                      onChange={(v) => setQty(line, 'purchaseQty', v)}
                    />
                    <Money tone={groups[1].cell} value={line.purchaseValue} edge />
                    <Qty
                      tone={groups[2].cell}
                      value={line.secondaryQty}
                      locked={!fieldsOpen}
                      onChange={(v) => setQty(line, 'secondaryQty', v)}
                    />
                    <Money tone={groups[2].cell} value={line.secondaryValue} edge />
                    <td className={cn('border-r px-1', groups[3].cell)}>
                      <div
                        className={cn(
                          'flex h-8 items-center justify-end rounded-md border bg-background px-1',
                          (line.closingQty ?? 0) < 0 && 'text-destructive',
                        )}
                      >
                        {line.closingQty ?? ''}
                      </div>
                    </td>
                    <Money tone={groups[3].cell} value={line.closingValue} edge />
                    <Qty
                      tone={groups[4].cell}
                      value={line.frsQty}
                      locked={!fieldsOpen}
                      onChange={(v) => setQty(line, 'frsQty', v)}
                    />
                    <Money tone={groups[4].cell} value={line.frsValue} edge />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dialog
            ref={historyRef}
            aria-labelledby="aws-history-title"
            className="aws-history bg-background p-6 text-foreground"
            onClick={(e) => {
              const box = historyRef.current?.getBoundingClientRect();
              if (!box) return;
              const outside =
                e.clientX < box.left ||
                e.clientX > box.right ||
                e.clientY < box.top ||
                e.clientY > box.bottom;
              if (outside) historyRef.current?.close();
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="aws-history-title" className="text-lg font-medium">
                History
              </h2>
              <button
                type="button"
                className="h-9 rounded-md border px-3 text-sm"
                onClick={() => historyRef.current?.close()}
              >
                Close
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {(['all', 'draft', 'pending', 'approved', 'rejected'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={cn(
                    'h-8 rounded-full px-3 text-sm',
                    historyStatus === s ? 'bg-foreground text-background' : 'bg-muted',
                  )}
                  onClick={() => setHistoryStatus(s)}
                >
                  {s === 'all' ? 'All' : label(s)}
                </button>
              ))}
            </div>
            <ul className="mt-4 flex flex-col">
              {history
                .filter((h) => h.id !== sheet.id)
                .map((item) => (
                  <li key={item.id} className="border-b">
                    <button
                      type="button"
                      className="w-full py-3 text-left text-sm"
                      onClick={() => {
                        historyRef.current?.close();
                        void getStatement(item.id).then((next) => {
                          setSheet(next);
                          setDrafts({});
                        });
                      }}
                    >
                      {item.month} · {label(item.status)} · {inr.format(item.actualSecondary)}
                    </button>
                  </li>
                ))}
            </ul>
          </dialog>
        </div>
      )}
      <style>{`
        .af-sheet { animation: af-sheet-in 480ms cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes af-sheet-in { from { opacity: 0; transform: translateY(10px); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }
        .aws-history {
          position: fixed; top: 0; right: 0; bottom: 0; left: auto; width: 50vw; height: 100%; max-height: none; margin: 0; border: 0; overflow: auto;
          box-shadow: -24px 0 48px rgb(0 0 0 / 0.08);
          transform: translateX(100%);
          transition: transform 480ms cubic-bezier(0.16, 1, 0.3, 1), overlay 480ms allow-discrete, display 480ms allow-discrete;
        }
        .aws-history[open] {
          transform: translateX(0);
        }
        @starting-style { .aws-history[open] { transform: translateX(100%); } }
        dialog:modal { overscroll-behavior: contain; }
        .aws-history::backdrop {
          background: rgb(0 0 0 / 0.35);
          opacity: 0;
          transition: opacity 480ms ease, overlay 480ms allow-discrete, display 480ms allow-discrete;
        }
        .aws-history[open]::backdrop { opacity: 1; }
        @starting-style { .aws-history[open]::backdrop { opacity: 0; } }
        @media (prefers-reduced-motion: reduce) {
          .af-sheet, .aws-history, .aws-history::backdrop { animation: none; transition: none; }
        }
      `}</style>
    </div>
  );
}

function StockistDropdown({
  stockists,
  selected,
  onSelect,
}: {
  stockists: StockistOption[] | null;
  selected: StockistOption | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const needle = q.trim().toLowerCase();
  const items = (stockists ?? []).filter(
    (s) =>
      !needle ||
      s.name.toLowerCase().includes(needle) ||
      (s.city ?? '').toLowerCase().includes(needle),
  );
  return (
    <div ref={root} className="relative flex flex-col gap-1 text-sm">
      <span id="aws-ss-stockist-label">Stockist</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby="aws-ss-stockist-label"
        className="flex h-9 w-full items-center justify-between rounded-md border bg-background px-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={cn('truncate', !selected && 'text-muted-foreground')}>
          {selected ? selected.name : stockists ? 'Choose a stockist' : 'Loading stockists…'}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="absolute top-full z-50 mt-1 flex w-full flex-col gap-2 rounded-md border bg-background p-2 shadow-md">
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or city"
            aria-label="Search stockists"
          />
          <ul role="listbox" aria-label="Stockists" className="max-h-56 overflow-auto">
            {items.length === 0 ? (
              <li className="px-2 py-2 text-muted-foreground">No stockist matches.</li>
            ) : (
              items.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={s.id === selected?.id}
                    className={cn(
                      'flex w-full items-baseline justify-between rounded px-2 py-1.5 text-left hover:bg-muted',
                      s.id === selected?.id && 'bg-muted font-medium',
                    )}
                    onClick={() => {
                      onSelect(s.id);
                      setOpen(false);
                      setQ('');
                    }}
                  >
                    <span className="truncate">{s.name}</span>
                    <span className="ml-3 shrink-0 text-xs text-muted-foreground">{s.city}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function Pair({ title, head }: { title: string; head: string }) {
  return (
    <>
      <th scope="col" className={cn('border-r border-b px-1 py-1 text-right font-medium', head)}>
        <span className="sr-only">{title} </span>Qty
      </th>
      <th scope="col" className={cn('border-r-2 border-b px-1 py-1 text-right font-medium', head)}>
        <span className="sr-only">{title} </span>Value
      </th>
    </>
  );
}

function Qty({
  value,
  locked,
  tone,
  onChange,
}: {
  value: number | null;
  locked: boolean;
  tone: string;
  onChange: (v: string) => void;
}) {
  return (
    <td className={cn('border-r px-1', tone)}>
      <Input
        inputMode="numeric"
        disabled={locked}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full bg-background px-1 text-right tabular-nums"
        aria-label="Quantity"
      />
    </td>
  );
}

function Money({ value, tone, edge }: { value: number | null; tone: string; edge?: boolean }) {
  return (
    <td
      className={cn(
        'px-1 text-right text-muted-foreground',
        edge ? 'border-r-2' : 'border-r',
        tone,
      )}
    >
      <span className="block h-8 truncate leading-8">{value == null ? '' : inr.format(value)}</span>
    </td>
  );
}

function FileButton({
  label,
  disabled,
  onFile,
}: {
  label: string;
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <label
      className={cn(
        'inline-flex h-9 w-full cursor-pointer items-center justify-center rounded-md border px-2 text-sm',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      {label}
      <input
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

function label(status: StatementStatus) {
  if (status === 'draft') return 'Draft';
  if (status === 'pending') return 'Pending';
  if (status === 'approved') return 'Approved';
  return 'Rejected';
}
