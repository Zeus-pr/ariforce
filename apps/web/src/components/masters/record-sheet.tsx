'use client';

import { Loader2, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ariforce/ui/components/dialog';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { toast } from '@ariforce/ui/components/sonner';
import { api, toApiError } from '@/lib/api';
import { APPROVAL_LABEL } from '@/components/pickers/pickers';
import { OutletLocksCard } from '@/components/field/outlet-locks-card';
import { blankRecord, MASTERS, type MasterKind, type MasterRow } from './config';
import { FieldInput } from './field-input';
import { useLookups } from './lookups';

type Values = Record<string, string | null>;
type Match = {
  id: string;
  name: string;
  territoryName: string;
  rule: 'registration_no' | 'name_pincode';
  approvalStatus: string;
};
const RULE_LABEL = {
  registration_no: 'Same registration no.',
  name_pincode: 'Same name and PIN code',
};

/** Create / edit / delete one master record. Validation is the contract's zod schema. */
export function RecordSheet({
  kind,
  open,
  row,
  onOpenChange,
  onSaved,
  readOnly = false,
}: {
  /** Read-only roles (lib/permissions canWriteMasters): details only, no form or write buttons. */
  readOnly?: boolean;
  kind: MasterKind;
  open: boolean;
  row: MasterRow | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const cfg = MASTERS[kind];
  const lk = useLookups();
  const [values, setValues] = useState<Values>(() => blankRecord(kind));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [code, setCode] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const outletKind = kind === 'doctors' ? 'doctor' : kind === 'chemists' ? 'chemist' : 'stockist';
  // Doctors only (add form): live duplicate check and the 409 outcome of the last save.
  const [matches, setMatches] = useState<Match[]>([]);
  const [conflict, setConflict] = useState<'hard' | 'soft' | null>(null);
  const dupCheck = kind === 'doctors' && !row && !readOnly && open;
  const dupName = String(values.name ?? '').trim();
  const dupPin = values.pincode ?? null;
  const dupReg = String(values.registrationNo ?? '').trim();

  useEffect(() => {
    setConflict(null);
    if (!dupCheck || dupName.length < 3) return setMatches([]);
    const pin = dupPin && /^[1-9][0-9]{5}$/.test(dupPin) ? dupPin : null;
    let live = true;
    const t = setTimeout(async () => {
      const res = await api.POST('/v1/doctors/duplicate-check', {
        body: { name: dupName, pincode: pin, registrationNo: dupReg || null },
      });
      if (live && res.data) setMatches(res.data.matches as Match[]);
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [dupCheck, dupName, dupPin, dupReg]);

  useEffect(() => {
    if (!open) return;
    const base = blankRecord(kind);
    if (row)
      for (const k of Object.keys(base))
        base[k] = ((row as Record<string, unknown>)[k] as string | null) ?? base[k]!;
    setValues(base);
    setCode(row && 'code' in row && typeof row.code === 'string' ? row.code : '');
    setErrors({});
  }, [open, row, kind]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  async function generate() {
    const res = await api.GET('/v1/outlet-codes/next', {
      params: { query: { kind: outletKind } },
    });
    if (res.error || !res.data) return toast.error(toApiError(res.error).message);
    setCode(res.data.code);
  }

  const body = () => {
    const out: Record<string, unknown> = { ...values };
    if (!row && code) out.code = code;
    if (row) out.location = row.location;
    return out;
  };

  async function save(e: React.FormEvent | null, allowPossibleDuplicate = false) {
    e?.preventDefault();
    const parsed = cfg.create.safeParse(body());
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const k = String(issue.path[0] ?? '');
        errs[k] ??=
          k === 'pincode'
            ? 'Use a 6-digit PIN code.'
            : issue.code === 'too_small'
              ? 'Required.'
              : issue.message;
      }
      setErrors(errs);
      return;
    }
    const payload: Record<string, unknown> = { ...(parsed.data as object) };
    if (kind === 'doctors' || kind === 'chemists') {
      if (!values.localTerritoryId) {
        setErrors({ localTerritoryId: 'Required.' });
        return;
      }
      payload.localTerritoryId = values.localTerritoryId;
    }
    setBusy(true);
    const res = row
      ? await api.PATCH(`${cfg.path}/{id}`, {
          params: { path: { id: row.id } },
          body: { ...payload, version: row.version } as never,
        })
      : await api.POST(cfg.path, {
          body: (allowPossibleDuplicate
            ? { ...payload, allowPossibleDuplicate: true }
            : payload) as never,
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
    setBusy(false);
    if (res.error) {
      const err = toApiError(res.error);
      const m = (err.details as { matches?: Match[] } | undefined)?.matches;
      if (err.code === 'DOCTOR_DUPLICATE' || err.code === 'DOCTOR_POSSIBLE_DUPLICATE') {
        if (m) setMatches(m);
        setConflict(err.code === 'DOCTOR_DUPLICATE' ? 'hard' : 'soft');
        return;
      }
      if (err.code === 'VERSION_CONFLICT')
        toast.error('Someone else changed this record. Close and reopen it to see the latest.');
      else if (err.code === 'VALIDATION')
        toast.error('The server rejected some fields. Check them and try again.');
      else toast.error(err.message);
      return;
    }
    const pending =
      (res.data as { approvalStatus?: string } | undefined)?.approvalStatus === 'pending';
    toast.success(
      row
        ? `Saved ${String(values.name)}`
        : pending
          ? `Added ${String(values.name)}. Awaiting approval.`
          : `Added ${String(values.name)}`,
    );
    onSaved();
    onOpenChange(false);
  }

  async function remove() {
    if (!row) return;
    setBusy(true);
    const res = await api.DELETE(`${cfg.path}/{id}`, { params: { path: { id: row.id } } });
    setBusy(false);
    setConfirm(false);
    if (res.error) return toast.error(toApiError(res.error).message);
    toast.success(`Removed ${row.name}`);
    onSaved();
    onOpenChange(false);
  }

  return (
    <>
      <dialog
        ref={dialogRef}
        closedby="any"
        aria-labelledby="master-record-title"
        className="master-record m-auto w-[min(56rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] flex-col gap-0 rounded-xl border bg-background p-0 text-foreground shadow-lg open:flex"
        onClose={() => onOpenChange(false)}
      >
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div>
            <h2 id="master-record-title" className="text-lg font-semibold">
              {readOnly
                ? (row?.name ?? cfg.singular)
                : row
                  ? `Edit ${cfg.singular}`
                  : `Add ${cfg.singular}`}
            </h2>
            <p className="text-sm text-muted-foreground">
              {readOnly
                ? `${cfg.singular[0]!.toUpperCase()}${cfg.singular.slice(1)} details`
                : row
                  ? row.name
                  : 'Fields marked * are required.'}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
          >
            <X />
          </button>
        </div>
        {readOnly ? (
          <ReadOnlyDetails kind={kind} values={values} code={code} rowId={row?.id} />
        ) : (
          <form
            id="record-form"
            onSubmit={save}
            noValidate
            className="flex-1 overflow-y-auto overscroll-contain p-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="f-code">ARIP code</Label>
                <div className="flex gap-2">
                  <Input id="f-code" readOnly value={code} placeholder="ARIDOC000001" />
                  {!row && (
                    <Button type="button" variant="outline" onClick={() => void generate()}>
                      Generate code
                    </Button>
                  )}
                </div>
              </div>
              {cfg.fields.map((f) => {
                const id = `f-${f.key}`;
                return (
                  <div key={f.key} className="grid gap-1.5">
                    <Label htmlFor={id}>
                      {f.label}
                      {f.required && <span className="text-danger">*</span>}
                    </Label>
                    <FieldInput
                      id={id}
                      field={f}
                      value={values[f.key] ?? null}
                      hqId={values.territoryId}
                      invalid={!!errors[f.key]}
                      onChange={(v) => {
                        setValues((s) => {
                          const next = { ...s, [f.key]: v };
                          if (f.key === 'territoryId' && s.localTerritoryId) {
                            const town = lk.territories.find((t) => t.id === s.localTerritoryId);
                            if (!town || town.parentId !== v) next.localTerritoryId = null;
                          }
                          return next;
                        });
                        if (errors[f.key]) setErrors(({ [f.key]: _, ...rest }) => rest);
                      }}
                    />
                    {errors[f.key] && <p className="text-xs text-danger">{errors[f.key]}</p>}
                  </div>
                );
              })}
            </div>
            {dupCheck && matches.length > 0 && (
              <DuplicatePanel
                matches={matches}
                conflict={conflict}
                busy={busy}
                onAddAnyway={() => void save(null, true)}
              />
            )}
            {row && kind !== 'doctors' ? (
              <div className="mt-6 border-t pt-4">
                <OutletLocksCard
                  compact
                  outletKind={kind === 'chemists' ? 'chemist' : 'stockist'}
                  outletId={row.id}
                />
              </div>
            ) : null}
          </form>
        )}
        {!readOnly && (
          <div className="flex flex-row gap-2 border-t px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {row && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-danger"
                onClick={() => setConfirm(true)}
                disabled={busy}
              >
                <Trash2 /> Remove
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className={row ? '' : 'ml-auto'}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" form="record-form" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {row ? 'Save' : 'Add'}
            </Button>
          </div>
        )}
      </dialog>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {row?.name}?</DialogTitle>
            <DialogDescription>
              It disappears from lists and reps&apos; phones. History (calls, samples) keeps the
              record.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={remove} disabled={busy}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DuplicatePanel({
  matches,
  conflict,
  busy,
  onAddAnyway,
}: {
  matches: Match[];
  conflict: 'hard' | 'soft' | null;
  busy: boolean;
  onAddAnyway: () => void;
}) {
  const hard = matches.some((m) => m.rule === 'registration_no');
  return (
    <div
      className="mt-4 grid gap-2 rounded-md border bg-muted p-3 text-sm"
      data-testid="dup-panel"
      data-conflict={conflict ?? ''}
    >
      <p className="font-medium" data-testid="dup-title">
        {conflict === 'hard'
          ? 'This registration number is already used. The doctor cannot be added again.'
          : conflict === 'soft'
            ? 'A doctor with the same name and PIN code exists. Add anyway?'
            : hard
              ? 'A doctor with this registration number already exists.'
              : 'Possible duplicates'}
      </p>
      <ul className="grid gap-1">
        {matches.map((m) => (
          <li
            key={m.id}
            className="flex flex-wrap items-center gap-2"
            data-testid="dup-match"
            data-rule={m.rule}
          >
            <span>{m.name}</span>
            <span className="text-muted-foreground">{m.territoryName}</span>
            <Badge variant="outline">{RULE_LABEL[m.rule]}</Badge>
            {m.approvalStatus !== 'approved' && (
              <Badge variant="outline">
                {APPROVAL_LABEL[m.approvalStatus] ?? m.approvalStatus}
              </Badge>
            )}
          </li>
        ))}
      </ul>
      {conflict === 'soft' && (
        <Button
          type="button"
          variant="outline"
          className="justify-self-start"
          disabled={busy}
          onClick={onAddAnyway}
          data-testid="dup-add-anyway"
        >
          Add anyway
        </Button>
      )}
    </div>
  );
}

function showDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function ReadOnlyDetails({
  kind,
  values,
  code,
  rowId,
}: {
  kind: MasterKind;
  values: Values;
  code: string;
  rowId?: string;
}) {
  const { byId } = useLookups();
  return (
    <div className="flex flex-1 flex-col overflow-y-auto" data-testid="master-details">
      <dl className="grid content-start gap-3 p-4 text-sm">
        <div className="grid gap-0.5">
          <dt className="text-xs text-muted-foreground">ARIP code</dt>
          <dd>{code || '—'}</dd>
        </div>
        {MASTERS[kind].fields.map((f) => {
          const raw = values[f.key];
          const v =
            raw && ['territory', 'hq', 'town', 'specialty', 'category'].includes(f.type)
              ? (byId.get(raw) ?? raw)
              : raw && f.type === 'date'
                ? showDay(raw)
                : raw;
          return (
            <div key={f.key} className="grid gap-0.5">
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd>{v || '—'}</dd>
            </div>
          );
        })}
      </dl>
      {rowId && kind !== 'doctors' ? (
        <div className="border-t px-4 py-4">
          <OutletLocksCard
            compact
            outletKind={kind === 'chemists' ? 'chemist' : 'stockist'}
            outletId={rowId}
          />
        </div>
      ) : null}
    </div>
  );
}

export type { Values };
