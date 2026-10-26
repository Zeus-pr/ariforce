'use client';

import { ArrowLeft, Check, CircleAlert, Download, FileSpreadsheet, Upload } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { components } from '@ariforce/contracts';
import { api, apiReady, toApiError } from '@/lib/api';
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ariforce/ui/components/table';
import { cn } from '@ariforce/ui/lib/utils';
import { MASTERS, normHeader, type FieldDef, type MasterKind } from './config';
import { LookupsProvider, useLookups, type Lookups } from './lookups';

const SKIP = '__skip';
const STEPS = ['Upload', 'Match columns', 'Review', 'Import'] as const;
const MAX_ROWS = 5000;

type Sheet = { fileName: string; headers: string[]; rows: string[][] };
type Checked = { line: number; ok: boolean; errors: string[]; body: Record<string, unknown> };

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function readFile(file: File): Promise<Sheet> {
  let data: string[][];
  if (/\.csv$/i.test(file.name)) data = parseCsv(await file.text());
  else {
    const { readSheet } = await import('read-excel-file/browser');
    const raw = await readSheet(file);
    data = raw.map((r) => r.map((c) => (c == null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c))));
  }
  const nonEmpty = data.filter((r) => r.some((c) => c.trim() !== ''));
  const [headers = [], ...rows] = nonEmpty;
  return { fileName: file.name, headers: headers.map((h) => h.trim()), rows };
}

function autoMatch(fields: FieldDef[], headers: string[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const f of fields) {
    const i = headers.findIndex((h) => f.aliases.includes(normHeader(h)) || normHeader(h) === normHeader(f.label));
    out[f.key] = i >= 0 ? i : null;
  }
  return out;
}

/** Resolve a lookup cell by code or name (case-insensitive). */
function resolver(lk: Lookups, type: FieldDef['type']) {
  const list =
    type === 'territory' ? lk.territories : type === 'specialty' ? lk.specialties : type === 'category' ? lk.categories : [];
  const map = new Map<string, string>();
  for (const r of list) {
    map.set(normHeader(r.name), r.id);
    if ('code' in r) map.set(normHeader(r.code), r.id);
  }
  return (v: string) => map.get(normHeader(v));
}

function check(kind: MasterKind, sheet: Sheet, mapping: Record<string, number | null>, lk: Lookups): Checked[] {
  const cfg = MASTERS[kind];
  const resolvers = Object.fromEntries(cfg.fields.map((f) => [f.key, resolver(lk, f.type)]));
  return sheet.rows.map((cells, i) => {
    const errors: string[] = [];
    const body: Record<string, unknown> = { location: null };
    for (const f of cfg.fields) {
      const col = mapping[f.key];
      const raw = col == null ? '' : (cells[col] ?? '').trim();
      if (!raw) {
        body[f.key] = f.required ? '' : null;
        continue;
      }
      if (['territory', 'specialty', 'category'].includes(f.type)) {
        const id = resolvers[f.key]!(raw);
        if (!id) errors.push(`${f.label} “${raw}” not found`);
        body[f.key] = id ?? null;
      } else body[f.key] = f.type === 'pincode' ? raw.replace(/\s/g, '') : raw;
    }
    const parsed = cfg.create.safeParse(body);
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const f = cfg.fields.find((x) => x.key === issue.path[0]);
        const label = f?.label ?? String(issue.path[0]);
        const msg =
          f?.type === 'pincode' ? `${label} must be 6 digits` : issue.code === 'too_small' || body[f?.key ?? ''] === '' ? `${label} is required` : `${label}: ${issue.message}`;
        if (!errors.some((e) => e.startsWith(label))) errors.push(msg);
      }
    return { line: i + 2, ok: errors.length === 0, errors, body };
  });
}

function downloadTemplate(kind: MasterKind) {
  const cols = MASTERS[kind].fields.map((f) => f.label);
  const blob = new Blob([cols.join(',') + '\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ariforce-${kind}-template.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2 text-sm" aria-label="Import steps">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i === step ? 'step' : undefined}>
          <span
            className={cn(
              'grid size-6 place-items-center rounded-md border text-xs tabular-nums',
              i < step && 'border-primary bg-primary text-primary-foreground',
              i === step && 'border-primary text-primary',
            )}
          >
            {i < step ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={cn('hidden sm:inline', i === step ? 'font-medium' : 'text-muted-foreground')}>{s}</span>
          {i < STEPS.length - 1 && <span className="h-px w-4 bg-border sm:w-8" />}
        </li>
      ))}
    </ol>
  );
}

function Wizard({ kind }: { kind: MasterKind }) {
  const cfg = MASTERS[kind];
  const lk = useLookups();
  const [step, setStep] = useState(0);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () => (sheet && step >= 2 ? check(kind, sheet, mapping, lk) : []),
    [sheet, step, kind, mapping, lk],
  );
  const valid = results.filter((r) => r.ok).length;
  const missingRequired = cfg.fields.filter((f) => f.required && mapping[f.key] == null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    try {
      const s = await readFile(file);
      if (!s.headers.length || !s.rows.length) throw new Error('The first sheet has no rows under a header row.');
      if (s.rows.length > MAX_ROWS) throw new Error(`Up to ${MAX_ROWS.toLocaleString('en-IN')} rows per file. Split the sheet and import in parts.`);
      setSheet(s);
      setMapping(autoMatch(cfg.fields, s.headers));
      setStep(1);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Could not read that file.');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Stepper step={step} />

      {step === 0 && (
        <div className="flex flex-col gap-3">
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFile(e.dataTransfer.files[0]);
            }}
            className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border border-dashed bg-card p-10 text-center transition-colors hover:bg-muted/40"
          >
            <Upload className="size-6 text-muted-foreground" />
            <span className="font-medium">Choose an Excel or CSV file</span>
            <span className="text-sm text-muted-foreground">
              .xlsx or .csv, first sheet, one header row. Up to {MAX_ROWS.toLocaleString('en-IN')} rows.
            </span>
            <input
              ref={input}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="sr-only"
              data-testid="import-file"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
          {fileError && (
            <p role="alert" className="flex items-center gap-2 text-sm text-danger">
              <CircleAlert className="size-4" /> {fileError}
            </p>
          )}
          <Button variant="link" className="self-start px-0" onClick={() => downloadTemplate(kind)}>
            <Download /> Download a template
          </Button>
        </div>
      )}

      {step === 1 && sheet && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            <FileSpreadsheet className="mr-1 inline size-4" />
            {sheet.fileName} · {sheet.rows.length.toLocaleString('en-IN')} rows. Match each AriForce field to a column in your sheet.
          </p>
          <div className="grid gap-2 rounded-lg border bg-card p-4 sm:grid-cols-2">
            {cfg.fields.map((f) => (
              <div key={f.key} className="grid grid-cols-[8rem_1fr] items-center gap-3">
                <span className="text-sm">
                  {f.label}
                  {f.required && <span className="text-danger">*</span>}
                </span>
                <Select
                  value={mapping[f.key] == null ? SKIP : String(mapping[f.key])}
                  onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === SKIP ? null : Number(v) }))}
                >
                  <SelectTrigger className="w-full" aria-label={`Column for ${f.label}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SKIP}>Don&apos;t import</SelectItem>
                    {sheet.headers.map((h, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {h || `Column ${i + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          {missingRequired.length > 0 && (
            <p className="text-sm text-danger">Match the required fields: {missingRequired.map((f) => f.label).join(', ')}.</p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button disabled={missingRequired.length > 0 || !lk.ready} onClick={() => setStep(2)}>
              Check rows
            </Button>
          </div>
        </div>
      )}

      {step === 2 && sheet && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2" data-testid="import-summary">
            <Badge className="bg-success-soft text-success">{valid.toLocaleString('en-IN')} ready</Badge>
            <Badge className="bg-danger-soft text-danger">{(results.length - valid).toLocaleString('en-IN')} with problems</Badge>
            <label className="ml-auto flex items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} className="size-4" />
              Only rows with problems
            </label>
          </div>
          <div className="max-h-[50dvh] overflow-auto rounded-lg border bg-card">
            <Table>
              <TableHeader className="sticky top-0 bg-muted">
                <TableRow>
                  <TableHead className="w-16">Row</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results
                  .filter((r) => !onlyErrors || !r.ok)
                  .slice(0, 500)
                  .map((r) => (
                    <TableRow key={r.line}>
                      <TableCell className="tabular-nums text-muted-foreground">{r.line}</TableCell>
                      <TableCell>{String(r.body.name || '—')}</TableCell>
                      <TableCell className="whitespace-normal">
                        {r.ok ? (
                          <span className="text-success">Ready</span>
                        ) : (
                          <span className="text-danger">{r.errors.join(' · ')}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button disabled={valid === 0} onClick={() => setStep(3)}>
              Continue with {valid.toLocaleString('en-IN')} rows
            </Button>
          </div>
        </div>
      )}

      {step === 3 && sheet && (
        <ServerImport kind={kind} fileName={sheet.fileName} rows={results.filter((r) => r.ok)} onBack={() => setStep(2)} />
      )}
    </div>
  );
}

type Job = components['schemas']['ImportJob'];

/**
 * Step 4: POST /v1/{entity}/import. First a dry run (default; writes nothing) for server-side
 * validation and duplicate detection, then the same request with dryRun:false and the same
 * Idempotency-Key to save. See docs/IMPORT.md.
 */
function ServerImport({ kind, fileName, rows, onBack }: { kind: MasterKind; fileName: string; rows: Checked[]; onBack: () => void }) {
  const cfg = MASTERS[kind];
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'update' | 'error'>('skip');
  const [preview, setPreview] = useState<Job | null>(null);
  const [saved, setSaved] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(crypto.randomUUID());

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      await apiReady();
      const { data, error: e } = await api.POST(`${cfg.path}/import`, {
        params: { header: { 'idempotency-key': dryRun ? `${key.current}-dry-${onDuplicate}` : key.current } },
        body: { dryRun, onDuplicate, fileName, rows: rows.map((r) => r.body as Record<string, unknown>) },
      });
      if (e || !data) throw new Error(toApiError(e).message);
      if (dryRun) setPreview(data);
      else setSaved(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setPreview(null);
    void run(true);
  }, [onDuplicate]);

  const job = saved ?? preview;
  const problems = job?.results.filter((r) => r.status === 'error' || r.status === 'duplicate') ?? [];
  const t = job?.totals;
  const willSave = t ? t.valid : 0;

  return (
    <div className="flex flex-col gap-4" data-testid="server-import">
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Rows that match an existing record</span>
          <Select value={onDuplicate} onValueChange={(v) => setOnDuplicate(v as typeof onDuplicate)} disabled={busy || !!saved}>
            <SelectTrigger className="w-56" aria-label="Rows that match an existing record">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="skip">Skip them</SelectItem>
              <SelectItem value="update">Update the existing record</SelectItem>
              <SelectItem value="error">Treat as errors</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {busy ? (saved ? 'Saving' : 'Checking on the server') : saved ? 'Saved' : preview ? 'Server check done. Nothing saved yet.' : ''}
        </p>
      </div>

      {error && <p className="border-l-2 border-destructive pl-3 text-sm text-destructive">{error}</p>}

      {t && (
        <dl className="grid grid-cols-2 divide-y rounded-lg border sm:grid-cols-5 sm:divide-x sm:divide-y-0" data-testid="import-totals">
          {(
            [
              ['Rows', t.rows],
              [saved ? 'Created' : 'Valid', saved ? t.created : t.valid],
              [saved ? 'Updated' : 'Duplicates', saved ? t.updated : t.duplicate],
              ['Skipped', t.skipped],
              ['Errors', t.error],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="px-4 py-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{n.toLocaleString('en-IN')}</dd>
            </div>
          ))}
        </dl>
      )}

      {problems.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20 pl-4">Row</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {problems.slice(0, 100).map((r) => (
                <TableRow key={r.row}>
                  <TableCell className="pl-4 tabular-nums">{rows[r.row - 1]?.line ?? r.row}</TableCell>
                  <TableCell className={cn('text-xs font-medium uppercase', r.status === 'error' ? 'text-destructive' : 'text-warning-text')}>
                    {r.status}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.errors.length ? r.errors.map((e) => e.message).join('; ') : `Matches an existing record by ${r.duplicateRule ?? 'key'}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {saved ? (
          <Button asChild>
            <Link href={`/masters/${kind}`}>Back to {cfg.title.toLowerCase()}</Link>
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={onBack} disabled={busy}>
              Back
            </Button>
            <Button data-testid="import-commit" disabled={busy || !preview || willSave === 0} onClick={() => run(false)}>
              Import {willSave.toLocaleString('en-IN')} {cfg.title.toLowerCase()}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function ImportWizard({ kind }: { kind: MasterKind }) {
  const cfg = MASTERS[kind];
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
          <Link href={`/masters/${kind}`}>
            <ArrowLeft /> {cfg.title}
          </Link>
        </Button>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Import {cfg.title.toLowerCase()}</h1>
      </div>
      <LookupsProvider>
        <Wizard kind={kind} />
      </LookupsProvider>
    </div>
  );
}
