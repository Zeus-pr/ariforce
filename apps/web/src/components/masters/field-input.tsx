'use client';

import { Input } from '@ariforce/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import type { FieldDef } from './config';
import { useLookups } from './lookups';

const NONE = '__none';

export function FieldInput({
  field,
  value,
  onChange,
  invalid,
  id,
}: {
  field: FieldDef;
  value: string | null;
  onChange: (v: string | null) => void;
  invalid?: boolean;
  id: string;
}) {
  const lk = useLookups();
  const options =
    field.type === 'territory'
      ? lk.territories.map((t) => ({ value: t.id, label: `${t.name} (${t.code})`, group: t.level }))
      : field.type === 'specialty'
        ? lk.specialties.map((s) => ({ value: s.id, label: s.name, group: '' }))
        : field.type === 'category'
          ? lk.categories.map((c) => ({
              value: c.id,
              label: `${c.name} · ${c.visitsPerMonth}/month`,
              group: '',
            }))
          : null;

  if (options) {
    return (
      <Select
        value={value ?? (field.required ? '' : NONE)}
        onValueChange={(v) => onChange(v === NONE ? null : v)}
        disabled={!lk.ready}
      >
        <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined}>
          <SelectValue
            placeholder={lk.ready ? `Choose ${field.label.toLowerCase()}` : 'Loading…'}
          />
        </SelectTrigger>
        <SelectContent>
          {!field.required && <SelectItem value={NONE}>None</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
              {o.group && (
                <span className="ml-1 text-xs text-muted-foreground capitalize">{o.group}</span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' && !field.required ? null : e.target.value)}
      aria-invalid={invalid || undefined}
      placeholder={field.placeholder}
      type={
        field.type === 'tel'
          ? 'tel'
          : field.type === 'email'
            ? 'email'
            : field.type === 'date'
              ? 'date'
              : 'text'
      }
      inputMode={
        field.type === 'pincode'
          ? 'numeric'
          : field.type === 'tel'
            ? 'tel'
            : field.type === 'email'
              ? 'email'
              : undefined
      }
      autoComplete="off"
      maxLength={field.type === 'pincode' ? 6 : undefined}
    />
  );
}
