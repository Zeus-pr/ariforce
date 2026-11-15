'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const monthNow = () => new Date().toISOString().slice(0, 7);

type Draft = { openingQty: number | null; purchaseQty: number; secondaryQty: number; frsQty: number };

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
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

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
    return drafts[line.productId] ?? {
      openingQty: line.openingQty,
      purchaseQty: line.purchaseQty,
      secondaryQty: line.secondaryQty,
      frsQty: line.frsQty,
    };
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
      const closingQty = d.openingQty == null ? null : d.openingQty + d.purchaseQty - d.secondaryQty - d.frsQty;
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
        setError('Someone else saved this sheet. Your unsaved numbers are still here. Save again to keep them.');
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
        current = await saveLines(sheet.id, sheet.version, Object.entries(drafts).map(([productId, d]) => ({ productId, ...d })));
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
      await apiReady();
      const res = await fetch(`${API_URL}/v1/approvals/${sheet.approvalRequestId}/decision`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, comment: decision === 'reject' ? reason.trim() : undefined }),
      });
      if (!res.ok) throw await res.json();
      setSheet(await getStatement(sheet.id));
      setRejecting(false);
      setReason('');
      setWaiting((await listStatements({ waiting: true })).items);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  const history = (sheet?.history ?? []).filter((h) => historyStatus === 'all' || h.status === historyStatus);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-start">
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
                <button type="button" className="text-sm underline-offset-4 hover:underline" onClick={() => void getStatement(item.id).then(setSheet)}>
                  {item.stockistName}, {item.month}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {sheet && (
        <div key={sheet.id + sheet.month} className="af-sheet flex flex-col gap-4">
          <div className="sticky top-0 z-10 flex flex-col gap-3 bg-background/95 py-2 backdrop-blur-sm sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-lg font-medium tabular-nums">
                Actual secondary {inr.format(Math.round(actual * 100) / 100)}
              </p>
              <p className="text-sm text-muted-foreground">
                {sheet.stockistName}
                {sheet.address ? ` · ${sheet.address}` : ''} · {sheet.month} · {label(sheet.status)}
                {sheet.currentApproverName ? ` · with ${sheet.currentApproverName}` : ''}
              </p>
              {sheet.rejectionReason && <p className="text-sm text-destructive">Rejected: {sheet.rejectionReason}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <FileButton label={sheet.aws.status === 'confirmed' ? 'Replace AWS' : 'Upload AWS'} disabled={!sheet.editable || busy != null} onFile={(f) => void upload('aws', f)} />
              <FileButton label={sheet.ss.status === 'confirmed' ? 'Replace SS' : 'Upload SS'} disabled={!sheet.editable || busy != null} onFile={(f) => void upload('ss', f)} />
              {sheet.aws.status === 'confirmed' && <Button type="button" variant="ghost" onClick={() => void downloadFile('aws')}>AWS</Button>}
              {sheet.ss.status === 'confirmed' && <Button type="button" variant="ghost" onClick={() => void downloadFile('ss')}>SS</Button>}
              <Button type="button" variant="outline" disabled={!sheet.editable || busy != null || !Object.keys(drafts).length} onClick={() => void save()}>
                {busy === 'save' ? 'Saving…' : saved ? 'Saved' : 'Save draft'}
              </Button>
              <Button type="button" disabled={!sheet.canSubmit || busy != null} onClick={() => void submit()}>
                {busy === 'submit' ? 'Submitting…' : 'Submit'}
              </Button>
              <Button type="button" variant="outline" onClick={() => void downloadPdf(sheet.id, `${sheet.stockistName}-${sheet.month}.pdf`)}>
                Export
              </Button>
            </div>
          </div>
          {sheet.canDecide && (
            <div className="flex flex-wrap items-end gap-2">
              <Button type="button" disabled={busy != null} onClick={() => void decide('approve')}>Approve</Button>
              <Button type="button" variant="outline" onClick={() => setRejecting((v) => !v)}>Reject</Button>
              {rejecting && (
                <>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="max-w-sm" />
                  <Button type="button" disabled={reason.trim().length < 1 || busy != null} onClick={() => void decide('reject')}>
                    Send back
                  </Button>
                </>
              )}
            </div>
          )}
          <div className="overflow-auto rounded-md border">
            <table className="w-full min-w-[72rem] border-collapse text-sm tabular-nums">
              <thead className="sticky top-0 bg-muted text-left">
                <tr>
                  <th className="sticky left-0 bg-muted px-3 py-2 font-medium">Product</th>
                  <th className="px-2 py-2 font-medium">Pack</th>
                  <Group title="Opening" />
                  <Group title="Purchase" />
                  <Group title="Secondary" />
                  <Group title="Closing" />
                  <Group title="FRS" />
                </tr>
              </thead>
              <tbody>
                {view.map((line) => (
                  <tr key={line.productId} className="border-t">
                    <th className="sticky left-0 bg-background px-3 py-1 text-left font-normal">{line.name}</th>
                    <td className="px-2 text-muted-foreground">{line.packSize}</td>
                    <Qty value={line.openingQty} locked={!sheet.editable || line.openingLocked} onChange={(v) => setQty(line, 'openingQty', v)} />
                    <Money value={line.openingValue} />
                    <Qty value={line.purchaseQty} locked={!sheet.editable} onChange={(v) => setQty(line, 'purchaseQty', v)} />
                    <Money value={line.purchaseValue} />
                    <Qty value={line.secondaryQty} locked={!sheet.editable} onChange={(v) => setQty(line, 'secondaryQty', v)} />
                    <Money value={line.secondaryValue} />
                    <td className={cn('px-2 text-right', (line.closingQty ?? 0) < 0 && 'text-destructive')}>{line.closingQty ?? ''}</td>
                    <Money value={line.closingValue} />
                    <Qty value={line.frsQty} locked={!sheet.editable} onChange={(v) => setQty(line, 'frsQty', v)} />
                    <Money value={line.frsValue} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium">History</summary>
            <div className="mt-2 flex gap-2">
              {(['all', 'draft', 'pending', 'approved', 'rejected'] as const).map((s) => (
                <button key={s} type="button" className={cn('rounded-full px-2 py-1 text-xs', historyStatus === s ? 'bg-foreground text-background' : 'bg-muted')} onClick={() => setHistoryStatus(s)}>
                  {s}
                </button>
              ))}
            </div>
            <ul className="mt-2 flex flex-col">
              {history.filter((h) => h.id !== sheet.id).map((item) => (
                <li key={item.id}>
                  <button type="button" className="py-1 text-sm" onClick={() => void getStatement(item.id).then((next) => { setSheet(next); setDrafts({}); })}>
                    {item.month} · {label(item.status)} · {inr.format(item.actualSecondary)}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      <style>{`
        .af-sheet { animation: af-sheet-in 480ms cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes af-sheet-in { from { opacity: 0; transform: translateY(10px); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }
        @media (prefers-reduced-motion: reduce) { .af-sheet { animation: none; } }
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
    (s) => !needle || s.name.toLowerCase().includes(needle) || (s.city ?? '').toLowerCase().includes(needle),
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
        <ChevronDown aria-hidden className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute top-full z-20 mt-1 flex w-full flex-col gap-2 rounded-md border bg-background p-2 shadow-md">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or city" aria-label="Search stockists" />
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

function Group({ title }: { title: string }) {
  return (
    <>
      <th className="px-2 py-2 font-medium">{title} qty</th>
      <th className="px-2 py-2 font-medium">{title} value</th>
    </>
  );
}

function Qty({ value, locked, onChange }: { value: number | null; locked: boolean; onChange: (v: string) => void }) {
  return (
    <td className="px-1">
      <Input
        inputMode="numeric"
        disabled={locked}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-20 px-2 text-right tabular-nums"
        aria-label="Quantity"
      />
    </td>
  );
}

function Money({ value }: { value: number | null }) {
  return <td className="px-2 text-right text-muted-foreground">{value == null ? '' : inr.format(value)}</td>;
}

function FileButton({ label, disabled, onFile }: { label: string; disabled: boolean; onFile: (file: File) => void }) {
  return (
    <label className={cn('inline-flex h-9 cursor-pointer items-center rounded-md border px-3 text-sm', disabled && 'pointer-events-none opacity-50')}>
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
