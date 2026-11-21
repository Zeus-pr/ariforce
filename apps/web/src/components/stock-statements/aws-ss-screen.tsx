'use client';

import { ChevronDown, Trash2 } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { cn } from '@ariforce/ui/lib/utils';
import {
  confirmFile,
  downloadPdf,
  fileLink,
  getStatement,
  removeFile,
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
import { useRole } from '@/components/shell/role-context';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});
const monthNow = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const groups = [
  { title: 'Opening', head: 'bg-emerald-100', cell: 'bg-emerald-50' },
  { title: 'Purchase', head: 'bg-teal-100', cell: 'bg-teal-50' },
  { title: 'Free', head: 'bg-rose-100', cell: 'bg-rose-50' },
  { title: 'Secondary', head: 'bg-sky-100', cell: 'bg-sky-50' },
  { title: 'Closing', head: 'bg-violet-100', cell: 'bg-violet-50' },
  { title: 'FRS', head: 'bg-amber-100', cell: 'bg-amber-50' },
] as const;

type Draft = {
  openingQty: number | null;
  purchaseQty: number;
  freeQty: number;
  secondaryQty: number;
  frsQty: number;
};

export function AwsSsScreen() {
  const { role } = useRole();
  const viewOnly = role === 'distribution_head';
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
  const versionRef = useRef(0);

  useEffect(() => {
    listStockists()
      .then((r) => setStockists(r.items))
      .catch((e) => setError(messageOf(e)));
    listStatements({ waiting: true })
      .then((r) => setWaiting(r.items))
      .catch(() => setWaiting([]));
  }, []);

  const selected = (stockists ?? []).find((s) => s.id === stockistId) ?? null;

  function remember(stockist: string, m: string) {
    const q = new URLSearchParams(window.location.search);
    if (stockist) q.set('stockist', stockist);
    else q.delete('stockist');
    if (m) q.set('month', m);
    window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
  }

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get('stockist');
    const m = q.get('month');
    if (m) setMonth(m);
    if (s) {
      setStockistId(s);
      void load(s, m || monthNow());
    }
  }, []);

  async function load(id: string, m: string) {
    setBusy('open');
    setError(null);
    setSaved(false);
    setDrafts({});
    try {
      const next = await openStatement(id, m);
      setSheet(next);
    } catch (e) {
      setSheet(null);
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
        freeQty: line.freeQty ?? 0,
        secondaryQty: line.secondaryQty,
        frsQty: line.frsQty,
      }
    );
  }

  function setQty(line: StatementLine, key: keyof Draft, raw: string) {
    const current = lineOf(line);
    const trimmed = raw.trim();
    const value = trimmed === '' && key === 'openingQty' ? null : Number(trimmed);
    if (value != null && (!Number.isInteger(value) || value < 0)) return;
    setDrafts((d) => ({ ...d, [line.productId]: { ...current, [key]: value } }));
    setSaved(false);
  }

  const view = useMemo(() => {
    if (!sheet) return [];
    return sheet.lines.map((line) => {
      const d = lineOf(line);
      const value = (qty: number | null) =>
        qty == null ? null : line.pts == null ? 0 : Math.round(qty * line.pts * 100) / 100;
      const closingQty =
        d.openingQty == null
          ? null
          : d.openingQty + d.purchaseQty + d.freeQty - d.secondaryQty - d.frsQty;
      return {
        ...line,
        ...d,
        openingValue: value(d.openingQty),
        purchaseValue: value(d.purchaseQty),
        freeValue: value(d.freeQty),
        secondaryValue: value(d.secondaryQty),
        frsValue: value(d.frsQty),
        closingQty,
        closingValue: value(closingQty),
      };
    });
  }, [sheet, drafts]);

  const actual = view.reduce((s, l) => s + (l.secondaryValue ?? 0) - (l.frsValue ?? 0), 0);
  const actualPrimary = view.reduce((s, l) => s + (l.purchaseValue ?? 0), 0);
  const totals = useMemo(() => {
    const sum = (pick: (line: (typeof view)[number]) => number | null) =>
      view.reduce((s, line) => s + (pick(line) ?? 0), 0);
    return {
      openingQty: sum((l) => l.openingQty),
      openingValue: sum((l) => l.openingValue),
      purchaseQty: sum((l) => l.purchaseQty),
      purchaseValue: sum((l) => l.purchaseValue),
      freeQty: sum((l) => l.freeQty),
      freeValue: sum((l) => l.freeValue),
      secondaryQty: sum((l) => l.secondaryQty),
      secondaryValue: sum((l) => l.secondaryValue),
      closingQty: sum((l) => l.closingQty),
      closingValue: sum((l) => l.closingValue),
      frsQty: sum((l) => l.frsQty),
      frsValue: sum((l) => l.frsValue),
    };
  }, [view]);

  useEffect(() => {
    if (sheet) versionRef.current = sheet.version;
  }, [sheet]);

  async function save() {
    if (!sheet) return;
    const lines = Object.entries(drafts).map(([productId, d]) => ({ productId, ...d }));
    if (!lines.length) return;
    setBusy('save');
    setError(null);
    const send = (version: number) => saveLines(sheet.id, version, lines);
    try {
      const next = await send(versionRef.current);
      versionRef.current = next.version;
      setSheet(next);
      setDrafts({});
      setSaved(true);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'VERSION_CONFLICT') {
        const fresh = await getStatement(sheet.id);
        versionRef.current = fresh.version;
        try {
          const next = await send(fresh.version);
          versionRef.current = next.version;
          setSheet(next);
          setDrafts({});
          setSaved(true);
          return;
        } catch {
          setSheet(fresh);
        }
      }
      setError(messageOf(e));
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
          versionRef.current,
          Object.entries(drafts).map(([productId, d]) => ({ productId, ...d })),
        );
        versionRef.current = current.version;
        setDrafts({});
      }
      const next = await submitStatement(current.id, versionRef.current);
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
      const contentType = sheetFileType(file);
      if (!contentType) {
        setError('Use a PDF, a photo, or an Excel file.');
        return;
      }
      const up = await presignFile(sheet.id, kind, file, contentType);
      const put = await fetch(up.uploadUrl, { method: 'PUT', headers: up.headers, body: file });
      if (!put.ok) throw new Error('The file did not upload. Try again.');
      setSheet(await confirmFile(sheet.id, kind));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function deleteFile(kind: 'aws' | 'ss') {
    if (!sheet) return;
    setBusy(kind);
    setError(null);
    try {
      const next = await removeFile(sheet.id, kind);
      versionRef.current = next.version;
      setSheet(next);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function downloadFile(kind: 'aws' | 'ss') {
    if (!sheet) return;
    setError(null);
    try {
      const { downloadUrl } = await fileLink(sheet.id, kind);
      window.open(downloadUrl, '_blank', 'noopener');
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function decide(decision: 'approve' | 'reject') {
    if (!sheet?.approvalRequestId) return;
    setBusy('decide');
    setError(null);
    try {
      let current = sheet;
      if (decision === 'approve' && Object.keys(drafts).length) {
        current = await saveLines(
          sheet.id,
          versionRef.current,
          Object.entries(drafts).map(([productId, d]) => ({ productId, ...d })),
        );
        versionRef.current = current.version;
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
  const fieldsOpen =
    !viewOnly && !!sheet && sheet.editable && (sheet.status !== 'pending' || editing);
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
            setDrafts({});
            if (id) {
              remember(id, month);
              void load(id, month);
            }
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
              if (stockistId && next) {
                remember(stockistId, next);
                void load(stockistId, next);
              }
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
                  onClick={() => {
                    const next = item.month.slice(0, 7);
                    setStockistId(item.stockistId);
                    setMonth(next);
                    remember(item.stockistId, next);
                    void load(item.stockistId, next);
                  }}
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
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-lg font-medium tabular-nums">
              <p>Actual primary {inr.format(Math.round(actualPrimary * 100) / 100)}</p>
              <p>Actual secondary {inr.format(Math.round(actual * 100) / 100)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9"
                onClick={() => historyRef.current?.showModal()}
              >
                History
              </Button>
              {!viewOnly && (
                <FileButton
                  label={sheet.aws.status === 'confirmed' ? 'Replace AWS' : 'Upload AWS'}
                  disabled={!fieldsOpen || busy != null}
                  onFile={(f) => void upload('aws', f)}
                />
              )}
              {!viewOnly && (
                <FileButton
                  label={sheet.ss.status === 'confirmed' ? 'Replace SS' : 'Upload SS'}
                  disabled={!fieldsOpen || busy != null}
                  onFile={(f) => void upload('ss', f)}
                />
              )}
              {!viewOnly && sheet.canDecide && !editing && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
              )}
              {!viewOnly && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  disabled={!fieldsOpen || busy != null || !Object.keys(drafts).length}
                  onClick={() => void save()}
                >
                  {busy === 'save' ? 'Saving…' : saved ? 'Saved' : 'Save draft'}
                </Button>
              )}
              {!viewOnly && (
                <Button
                  type="button"
                  className="h-9"
                  disabled={!sheet.canSubmit || busy != null}
                  onClick={() => void submit()}
                >
                  {busy === 'submit' ? 'Submitting…' : 'Submit'}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="h-9"
                onClick={() =>
                  void downloadPdf(sheet.id, `${sheet.stockistName}-${sheet.month}.pdf`)
                }
              >
                Export
              </Button>
            </div>
            {(sheet.aws.status === 'confirmed' || sheet.ss.status === 'confirmed') && (
              <div className="flex flex-wrap gap-3">
                {sheet.aws.status === 'confirmed' && (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9"
                      onClick={() => void downloadFile('aws')}
                    >
                      Download AWS
                    </Button>
                    {fieldsOpen && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-9"
                        aria-label="Delete AWS"
                        disabled={busy != null}
                        onClick={() => void deleteFile('aws')}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                )}
                {sheet.ss.status === 'confirmed' && (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9"
                      onClick={() => void downloadFile('ss')}
                    >
                      Download SS
                    </Button>
                    {fieldsOpen && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-9"
                        aria-label="Delete SS"
                        disabled={busy != null}
                        onClick={() => void deleteFile('ss')}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="sticky top-0 z-40 -mx-4 border-b bg-background/95 px-4 py-2 backdrop-blur-sm sm:-mx-6 sm:px-6">
            <p className="truncate font-medium" title={sheet.stockistName}>
              {sheet.stockistName}
            </p>
          </div>
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
            className="overflow-x-auto rounded-md border"
          >
            <table className="w-full min-w-[74rem] table-fixed border-separate border-spacing-0 border-border text-sm tabular-nums [&_tbody_td]:border-b [&_tbody_th]:border-b [&_td]:border-border [&_th]:border-border">
              <colgroup>
                <col className="w-[10rem]" />
                <col className="w-[3.5rem]" />
                {groups.map((group) => (
                  <Fragment key={group.title}>
                    <col className="w-[4.75rem]" />
                    <col className="w-[7rem]" />
                  </Fragment>
                ))}
              </colgroup>
              <thead className="sticky top-10 z-20 text-left">
                <tr>
                  <th
                    rowSpan={3}
                    scope="col"
                    className="sticky left-0 z-30 border-r-2 border-b bg-background px-2 py-2 align-bottom font-medium"
                  >
                    Product
                  </th>
                  <th
                    rowSpan={3}
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
                <tr>
                  <Total label="Qty" value={totals.openingQty} tone={groups[0].head} />
                  <Total
                    label="Value"
                    value={totals.openingValue}
                    money
                    tone={groups[0].head}
                    edge
                  />
                  <Total label="Qty" value={totals.purchaseQty} tone={groups[1].head} />
                  <Total
                    label="Value"
                    value={totals.purchaseValue}
                    money
                    tone={groups[1].head}
                    edge
                  />
                  <Total label="Qty" value={totals.freeQty} tone={groups[2].head} />
                  <Total label="Value" value={totals.freeValue} money tone={groups[2].head} edge />
                  <Total label="Qty" value={totals.secondaryQty} tone={groups[3].head} />
                  <Total
                    label="Value"
                    value={totals.secondaryValue}
                    money
                    tone={groups[3].head}
                    edge
                  />
                  <Total label="Qty" value={totals.closingQty} tone={groups[4].head} />
                  <Total
                    label="Value"
                    value={totals.closingValue}
                    money
                    tone={groups[4].head}
                    edge
                  />
                  <Total label="Qty" value={totals.frsQty} tone={groups[5].head} />
                  <Total label="Value" value={totals.frsValue} money tone={groups[5].head} edge />
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
                      value={line.freeQty}
                      locked={!fieldsOpen}
                      onChange={(v) => setQty(line, 'freeQty', v)}
                    />
                    <Money tone={groups[2].cell} value={line.freeValue} edge />
                    <Qty
                      tone={groups[3].cell}
                      value={line.secondaryQty}
                      locked={!fieldsOpen}
                      onChange={(v) => setQty(line, 'secondaryQty', v)}
                    />
                    <Money tone={groups[3].cell} value={line.secondaryValue} edge />
                    <td className={cn('border-r px-1', groups[4].cell)}>
                      <div
                        className={cn(
                          'flex h-8 items-center justify-end rounded-md border bg-background px-1',
                          (line.closingQty ?? 0) < 0 && 'text-destructive',
                        )}
                      >
                        {line.closingQty ?? ''}
                      </div>
                    </td>
                    <Money tone={groups[4].cell} value={line.closingValue} edge />
                    <Qty
                      tone={groups[5].cell}
                      value={line.frsQty}
                      locked={!fieldsOpen}
                      onChange={(v) => setQty(line, 'frsQty', v)}
                    />
                    <Money tone={groups[5].cell} value={line.frsValue} edge />
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
              {history.length === 0 && (
                <li className="py-3 text-sm text-muted-foreground">No months for this stockist.</li>
              )}
              {history.map((item) => (
                <li key={item.id} className="border-b">
                  <button
                    type="button"
                    className={cn(
                      'w-full py-3 text-left text-sm',
                      item.id === sheet.id && 'font-medium',
                    )}
                    onClick={() => {
                      const next = item.month.slice(0, 7);
                      historyRef.current?.close();
                      setMonth(next);
                      remember(sheet.stockistId, next);
                      void load(sheet.stockistId, next);
                    }}
                  >
                    {item.month.slice(0, 7)} · {label(item.status)} ·{' '}
                    {inr.format(item.actualSecondary)}
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

function Total({
  label,
  value,
  money,
  tone,
  edge,
}: {
  label: string;
  value: number;
  money?: boolean;
  tone: string;
  edge?: boolean;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b px-1 py-1 text-right font-medium tabular-nums',
        edge ? 'border-r-2' : 'border-r',
        tone,
      )}
    >
      <span className="sr-only">Total {label} </span>
      {money ? inr.format(Math.round(value * 100) / 100) : value}
    </th>
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
      <span className="block h-8 leading-8">{value == null ? '' : inr.format(value)}</span>
    </td>
  );
}

const SHEET_FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
};

function sheetFileType(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return SHEET_FILE_TYPES[ext] || file.type;
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
        'inline-flex h-9 cursor-pointer items-center justify-center rounded-md border px-3 text-sm',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      {label}
      <input
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp,.xls,.xlsx,.xlsm,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
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
