'use client';

import { useState } from 'react';
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

  if (field.type === 'territory' && options) {
    return (
      <TerritorySearch
        id={id}
        value={value}
        options={options}
        required={field.required}
        invalid={invalid}
        ready={lk.ready}
        onChange={onChange}
      />
    );
  }

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

function TerritorySearch({
  id,
  value,
  options,
  required,
  invalid,
  ready,
  onChange,
}: {
  id: string;
  value: string | null;
  options: { value: string; label: string; group: string }[];
  required?: boolean;
  invalid?: boolean;
  ready: boolean;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = options.find((o) => o.value === value);
  const needle = q.trim().toLowerCase();
  const matched = options.filter(
    (o) => !needle || `${o.label} ${o.group}`.toLowerCase().includes(needle),
  );
  const shown = needle ? matched : matched.slice(0, 80);
  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={`${id}-list`}
        aria-invalid={invalid || undefined}
        disabled={!ready}
        placeholder={ready ? 'Search territory' : 'Loading…'}
        value={open ? q : (current?.label ?? '')}
        autoComplete="off"
        onFocus={() => {
          setOpen(true);
          setQ('');
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {!required && (
            <li>
              <button
                type="button"
                className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(null);
                  setOpen(false);
                }}
              >
                None
              </button>
            </li>
          )}
          {shown.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(o.value);
                  setQ('');
                  setOpen(false);
                }}
              >
                {o.label}
                {o.group && (
                  <span className="ml-1 text-xs text-muted-foreground capitalize">{o.group}</span>
                )}
              </button>
            </li>
          ))}
          {matched.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">No territory matches.</li>
          )}
          {!needle && matched.length > shown.length && (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              Type to search {matched.length} territories.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
