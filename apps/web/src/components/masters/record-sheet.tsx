'use client';

import { Loader2, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { Label } from '@ariforce/ui/components/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@ariforce/ui/components/sheet';
import { toast } from '@ariforce/ui/components/sonner';
import { api, toApiError } from '@/lib/api';
import { blankRecord, MASTERS, type MasterKind, type MasterRow } from './config';
import { FieldInput } from './field-input';

type Values = Record<string, string | null>;

/** Create / edit / delete one master record. Validation is the contract's zod schema. */
export function RecordSheet({
  kind,
  open,
  row,
  onOpenChange,
  onSaved,
}: {
  kind: MasterKind;
  open: boolean;
  row: MasterRow | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const cfg = MASTERS[kind];
  const [values, setValues] = useState<Values>(() => blankRecord(kind));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!open) return;
    const base = blankRecord(kind);
    if (row)
      for (const k of Object.keys(base))
        base[k] = ((row as Record<string, unknown>)[k] as string | null) ?? base[k]!;
    setValues(base);
    setErrors({});
  }, [open, row, kind]);

  const body = () => {
    const out: Record<string, unknown> = { ...values };
    if (row) out.location = row.location;
    return out;
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
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
    setBusy(true);
    const res = row
      ? await api.PATCH(`${cfg.path}/{id}`, {
          params: { path: { id: row.id } },
          body: { ...(parsed.data as object), version: row.version } as never,
        })
      : await api.POST(cfg.path, {
          body: parsed.data as never,
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
    setBusy(false);
    if (res.error) {
      const err = toApiError(res.error);
      if (err.code === 'VERSION_CONFLICT')
        toast.error('Someone else changed this record. Close and reopen it to see the latest.');
      else if (err.code === 'VALIDATION')
        toast.error('The server rejected some fields. Check them and try again.');
      else toast.error(err.message);
      return;
    }
    toast.success(row ? `Saved ${String(values.name)}` : `Added ${String(values.name)}`);
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
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>{row ? `Edit ${cfg.singular}` : `Add ${cfg.singular}`}</SheetTitle>
            <SheetDescription>{row ? row.name : `Fields marked * are required.`}</SheetDescription>
          </SheetHeader>
          <form
            id="record-form"
            onSubmit={save}
            noValidate
            className="flex-1 overflow-y-auto overscroll-contain p-4"
          >
            <div className="grid gap-4">
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
                      invalid={!!errors[f.key]}
                      onChange={(v) => {
                        setValues((s) => ({ ...s, [f.key]: v }));
                        if (errors[f.key]) setErrors(({ [f.key]: _, ...rest }) => rest);
                      }}
                    />
                    {errors[f.key] && <p className="text-xs text-danger">{errors[f.key]}</p>}
                  </div>
                );
              })}
            </div>
          </form>
          <SheetFooter className="flex-row border-t pb-[max(1rem,env(safe-area-inset-bottom))]">
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
          </SheetFooter>
        </SheetContent>
      </Sheet>
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

export type { Values };
