'use client';

import dynamic from 'next/dynamic';
import { CalendarPlus, Lock, MapPin, RotateCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Dcr } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { Skeleton } from '@ariforce/ui/components/skeleton';
import { cn } from '@ariforce/ui/lib/utils';
import { api, apiReady } from '@/lib/api';
import {
  BAND_LABEL,
  KIND_LABEL,
  MODE_LABEL,
  type CallDraft,
  type CallKind,
  type Candidate,
  type MeetingForm,
  type OfficeForm,
  type SfcHq,
} from '@/lib/dcr/model';
import { ChoiceSelect } from './choice-select';
import { PobEditor, type Opt } from './pob-rcpa';
import { SearchSelect, type SelectOption } from './search-select';
import { failureMessage, thrownMessage } from '@/lib/dcr/errors';
import { bandOf, sfcCategoryOf } from '@/lib/dcr/bands';

const ProductPresentation = dynamic(
  () => import('./product-presentation').then((m) => m.ProductPresentation),
  { ssr: false },
);

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});
const km = (n: number) =>
  `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(n)} km`;
const money = (n: number | null, actualFare = false) =>
  actualFare ? 'Actual fare' : n == null ? 'Not set in SFC' : inr.format(n);

export function FieldError({ messages, id }: { messages: string[]; id?: string }) {
  if (!messages.length) return null;
  return (
    <ul id={id} className="flex flex-col gap-0.5 text-sm text-destructive" role="alert">
      {messages.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  );
}

/** Read-only SFC plan and TA/DA, one block per HQ of the day. Never shows rates of an older selection. */
export function SfcPanel({
  state,
  hqs,
  choice,
  onChoose,
  onRetry,
  onChangeTerritory,
  missingHqNames,
  snapshots,
  readOnly,
}: {
  state: 'idle' | 'loading' | 'ok' | 'no_match' | 'error';
  hqs: SfcHq[];
  choice: Record<string, string>;
  onChoose: (hqId: string, routeId: string) => void;
  onRetry: () => void;
  onChangeTerritory: () => void;
  missingHqNames: string[];
  snapshots?: Dcr['sfcRoutes'];
  readOnly: boolean;
}) {
  if (snapshots?.length && readOnly) {
    return (
      <div className="flex flex-col gap-3" data-testid="dcr-sfc">
        {snapshots.map((s) =>
          s.snapshot ? (
            <RouteFacts
              key={s.hqTerritoryId}
              title={`${s.snapshot.fromPlace} to ${s.snapshot.toPlace}`}
              c={{ ...s.snapshot, id: s.sfcRouteId, version: s.snapshot.routeVersion }}
              note={`Frozen at submit · TA rate ${inr.format(s.snapshot.ratePerKm)}/km`}
            />
          ) : null,
        )}
      </div>
    );
  }
  if (state === 'loading')
    return (
      <div
        className="flex flex-col gap-2 rounded-xl border p-4"
        aria-busy="true"
        data-testid="dcr-sfc-loading"
      >
        <p className="text-sm text-muted-foreground">Finding your SFC record…</p>
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  if (state === 'error')
    return (
      <div
        className="flex flex-col gap-3 rounded-xl border border-destructive/40 bg-danger-soft p-4 sm:flex-row sm:items-center sm:justify-between"
        role="alert"
        data-testid="dcr-sfc-error"
      >
        <p className="text-sm">
          SFC could not be loaded, so no TA/DA is shown. Your entries are safe.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          data-testid="dcr-sfc-retry"
        >
          <RotateCw aria-hidden /> Retry
        </Button>
      </div>
    );
  if (state === 'no_match')
    return (
      <div
        className="flex flex-col gap-3 rounded-xl border border-warning/50 bg-warning-soft p-4"
        role="alert"
        data-testid="dcr-sfc-nomatch"
      >
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-warning-text">No matching SFC record</p>
          <p className="text-sm">
            Your SFC has no route for{' '}
            {missingHqNames.length ? missingHqNames.join(' and ') : 'this territory'} in this band.
            Pick another territory or band, or ask your manager to add the route on the SFC screen.
            No TA/DA is applied.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={onChangeTerritory}
          data-testid="dcr-sfc-change"
        >
          <MapPin aria-hidden /> Change territory
        </Button>
      </div>
    );
  if (state !== 'ok') return null;
  return (
    <div className="flex flex-col gap-3" data-testid="dcr-sfc">
      {hqs.map((h) => {
        const picked = choice[h.hqTerritoryId];
        const chosen =
          (picked && h.candidates.some((x) => x.id === picked) ? picked : h.autoSelectedId) ?? '';
        const c = h.candidates.find((x) => x.id === chosen);
        return (
          <div key={h.hqTerritoryId} className="flex flex-col gap-2">
            {h.candidates.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <Label id={`route-${h.hqTerritoryId}`}>
                  {h.hqName}: which route did you travel?
                </Label>
                <ChoiceSelect
                  aria-labelledby={`route-${h.hqTerritoryId}`}
                  value={chosen}
                  onValueChange={(id) => onChoose(h.hqTerritoryId, id)}
                  choices={h.candidates.map((r) => ({
                    value: r.id,
                    label: `${r.fromPlace} to ${r.toPlace}`,
                    hint: r.source === 'hq' ? `${km(r.oneWayKm)} · From HQ` : km(r.oneWayKm),
                  }))}
                  placeholder="Choose your route"
                  disabled={readOnly}
                  className="sm:max-w-md"
                  testId="dcr-sfc-route"
                />
              </div>
            )}
            {c ? (
              <RouteFacts
                title={`${h.hqName} · ${c.fromPlace} to ${c.toPlace}`}
                c={c}
                note="From your SFC. Read-only; changes are made on the SFC screen."
              />
            ) : (
              <p className="text-sm text-muted-foreground">Pick a route to see its TA/DA.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** "Ex-HQ (EX)"; a legacy or unknown band/category is shown as not set, never echoed raw. */
function bandText(c: { band: unknown; category: unknown }) {
  const band = bandOf(c.band);
  const cat = sfcCategoryOf(c.category);
  if (!band) return 'Not set';
  return cat ? `${BAND_LABEL[band]} (${cat.toUpperCase()})` : BAND_LABEL[band];
}

function RouteFacts({ title, c, note }: { title: string; c: Candidate; note: string }) {
  const facts: [string, string][] = [
    ['Band', bandText(c)],
    ['Travel', c.travelMode ? (MODE_LABEL[c.travelMode] ?? c.travelMode) : 'Not set'],
    ['Distance', `${km(c.oneWayKm)} one way · ${km(c.bothWayKm)} both`],
    ['TA (both ways)', money(c.bothWayAmount, c.actualFare)],
    ['DA', money(c.da)],
  ];
  return (
    <section
      className="rounded-xl border bg-muted/40 p-4"
      aria-label="SFC details and TA/DA"
      data-testid="dcr-sfc-card"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-balance">{title}</h3>
          {c.source === 'hq' && (
            <p className="text-xs text-muted-foreground" data-testid="dcr-sfc-from-hq">
              From HQ: this is your headquarter&rsquo;s shared route, not one set up for you.
            </p>
          )}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3" aria-hidden /> Read-only
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {facts.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd
              className="text-sm font-medium tabular-nums"
              data-testid={`dcr-sfc-${k.split(' ')[0]!.toLowerCase()}`}
            >
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">{note}</p>
    </section>
  );
}

type OutletRow = {
  id: string;
  name: string;
  city?: string | null;
  territoryId?: string | null;
  localTerritoryId?: string | null;
  approvalStatus?: string;
};
/** Where a call's customers come from: an HQ, narrowed to the picked territories under it (empty = the whole HQ). */
export type CustomerScope = { hqId: string; localIds: string[] };
type Query = {
  limit: number;
  sort: 'name';
  territoryId: string;
  localTerritoryId?: string;
  q?: string;
};
/**
 * Customers of the day's territories from the right master (doctors, chemists or stockists), server search.
 * Doctors and chemists are narrowed by localTerritoryId to the picked territories unless `wide`;
 * stockists are not linked to territories, so they always list the whole HQ.
 */
function useCustomers(
  kind: CallKind,
  scope: CustomerScope[],
  names: Map<string, string>,
  wide: boolean,
) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<SelectOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const narrow = kind !== 'stockist' && !wide;
  const key = scope.map((x) => `${x.hqId}:${narrow ? x.localIds.join('+') : ''}`).join(',');
  useEffect(() => {
    let live = true;
    setOpts(null);
    setError(null);
    void (async () => {
      await apiReady();
      const queries: Query[] = key
        .split(',')
        .filter(Boolean)
        .flatMap((part) => {
          const [territoryId, locals = ''] = part.split(':') as [string, string?];
          const base: Query = { limit: 100, sort: 'name', territoryId, ...(q ? { q } : {}) };
          const ids = locals.split('+').filter(Boolean);
          return ids.length
            ? ids.map((localTerritoryId) => ({ ...base, localTerritoryId }))
            : [base];
        });
      const rs = await Promise.all(
        queries.map((query) =>
          kind === 'doctor'
            ? api.GET('/v1/doctors', { params: { query } })
            : kind === 'chemist'
              ? api.GET('/v1/chemists', { params: { query } })
              : api.GET('/v1/stockists', {
                  params: {
                    query: {
                      limit: query.limit,
                      sort: query.sort,
                      territoryId: query.territoryId,
                      q: query.q,
                    },
                  },
                }),
        ),
      );
      if (!live) return;
      const bad = rs.find((r) => !r.data);
      if (bad) return setError(failureMessage(bad, 'Could not load the list.'));
      const seen = new Set<string>();
      const out: SelectOption[] = [];
      for (const r of rs)
        for (const x of (r.data?.items ?? []) as OutletRow[]) {
          if (seen.has(x.id)) continue;
          seen.add(x.id);
          if (kind === 'doctor' && x.approvalStatus === 'rejected') continue;
          const where = x.localTerritoryId ? names.get(x.localTerritoryId) : null;
          const hq = x.territoryId ? names.get(x.territoryId) : null;
          out.push({
            id: x.id,
            label: x.name,
            hint: [x.city, where, hq].filter(Boolean).join(' · ') || null,
            badge: kind === 'doctor' && x.approvalStatus === 'pending' ? 'Awaiting approval' : null,
            meta: x.territoryId ?? undefined,
          });
        }
      setOpts(out);
    })().catch((e: unknown) => live && setError(thrownMessage(e)));
    return () => {
      live = false;
    };
  }, [kind, key, q, tick, names]);
  return { opts, error, setQ, retry: () => setTick((t) => t + 1) };
}

export function CallCard({
  call,
  index,
  scope,
  names,
  products,
  productsError = null,
  onProductsRetry,
  readOnly,
  errors,
  onChange,
  onRemove,
}: {
  call: CallDraft;
  index: number;
  scope: CustomerScope[];
  /** Names of the day's HQs and territories by id. */
  names: Map<string, string>;
  products: SelectOption[];
  productsError?: string | null;
  onProductsRetry?: () => void;
  readOnly: boolean;
  errors: string[];
  onChange: (patch: Partial<CallDraft>) => void;
  onRemove: () => void;
}) {
  const [wide, setWide] = useState(false);
  const { opts, error, setQ, retry } = useCustomers(call.kind, scope, names, wide);
  // Doctors and chemists can be narrowed to the picked territories; stockists always list the whole HQ.
  const narrowable = call.kind !== 'stockist' && scope.some((x) => x.localIds.length > 0);
  const scopeLabel = scope
    .flatMap((x) =>
      x.localIds.length ? x.localIds.map((id) => names.get(id) ?? 'a territory') : [],
    )
    .join(', ');
  const hqLabel = scope.map((x) => names.get(x.hqId) ?? 'your HQ').join(', ');
  const onQuery = useCallback((q: string) => setQ(q), [setQ]);
  const noun = KIND_LABEL[call.kind];
  const labels = new Map(call.outletId ? [[call.outletId, call.outletName]] : []);
  const productOpts: Opt[] = products.map((p) => ({ id: p.id, name: p.label }));
  const [presentationOpen, setPresentationOpen] = useState(false);
  const detailedProducts = call.productIds
    .map((id) => products.find((p) => p.id === id))
    .filter((product): product is SelectOption => !!product);
  // Chemist POB may name a supplying stockist — load stockists for the day's HQs.
  const stockistsQ = useCustomers('stockist', scope, names, true);
  const stockistList: Opt[] = (stockistsQ.opts ?? []).map((o) => ({ id: o.id, name: o.label }));
  return (
    <li
      className={cn(
        'af-enter flex flex-col gap-4 rounded-xl border bg-card p-4',
        errors.length && 'border-destructive/60',
      )}
      data-testid="dcr-call"
      data-kind={call.kind}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">
          {noun} call{' '}
          <span className="font-normal text-muted-foreground tabular-nums">#{index + 1}</span>
        </h3>
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label={`Remove ${noun.toLowerCase()} call ${index + 1}`}
            data-testid="dcr-call-remove"
          >
            <Trash2 aria-hidden /> Remove
          </Button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium" id={`cust-${call.clientId}`}>
            {noun}
          </span>
          <SearchSelect
            label={`${noun}s`}
            options={opts ?? []}
            loading={opts === null && !error}
            error={error}
            onRetry={retry}
            onQuery={onQuery}
            value={call.outletId ? [call.outletId] : []}
            labels={labels}
            onChange={(ids) => {
              const o = opts?.find((x) => x.id === ids[0]);
              onChange({ outletId: ids[0] ?? '', outletName: o?.label ?? '', hqId: o?.meta ?? '' });
            }}
            placeholder={`Choose a ${noun.toLowerCase()}`}
            emptyText={
              narrowable && !wide
                ? `No ${noun.toLowerCase()}s linked to ${scopeLabel}. Try all of ${hqLabel}.`
                : `No ${noun.toLowerCase()}s found in the territories of the day.`
            }
            disabled={readOnly}
            invalid={errors.some((e) => e.includes('choose'))}
            testId="dcr-call-customer"
          />
          {narrowable && !readOnly && (
            <p className="text-xs text-muted-foreground" data-testid="dcr-call-scope">
              {wide
                ? `Showing all ${noun.toLowerCase()}s in ${hqLabel}. `
                : `Showing ${noun.toLowerCase()}s linked to ${scopeLabel}. `}
              <button
                type="button"
                className="font-medium text-foreground underline underline-offset-2"
                onClick={() => setWide((w) => !w)}
                data-testid="dcr-call-scope-toggle"
              >
                {wide ? `Only ${scopeLabel}` : `Show all of ${hqLabel}`}
              </button>
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`time-${call.clientId}`}>Visit time</Label>
          <Input
            id={`time-${call.clientId}`}
            type="time"
            value={call.time}
            disabled={readOnly}
            onChange={(e) => onChange({ time: e.target.value })}
            aria-invalid={errors.some((e) => e.includes('time')) || undefined}
            className="min-h-11 md:text-base"
            data-testid="dcr-call-time"
          />
        </div>
      </div>
      {call.kind === 'doctor' && (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">
              Products detailed{' '}
              <span className="font-normal text-muted-foreground">(optional, in order)</span>
            </span>
            <SearchSelect
              label="Products"
              options={products}
              error={productsError}
              onRetry={onProductsRetry}
              emptyText="No active products yet. Ask your administrator."
              labels={new Map(call.productIds.map((id) => [id, 'Saved product']))}
              value={call.productIds}
              onChange={(ids) => onChange({ productIds: ids, presentationOpenedAt: null })}
              multiple
              placeholder="Choose products"
              disabled={readOnly}
              testId="dcr-call-products"
            />
          </div>
          {detailedProducts.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2"
              data-testid="dcr-presentation-controls"
            >
              <span
                className={`rounded-md px-2 py-1 text-xs font-medium ${call.presentationOpenedAt ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning-text'}`}
                data-testid="dcr-presentation-status"
              >
                {call.presentationOpenedAt ? 'Presentation opened' : 'Presentation not opened'}
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPresentationOpen(true);
                  if (!readOnly) onChange({ presentationOpenedAt: new Date().toISOString() });
                }}
                data-testid="dcr-presentation-start"
              >
                Start presentation
              </Button>
              <ProductPresentation
                products={detailedProducts}
                open={presentationOpen}
                onOpenChange={setPresentationOpen}
              />
            </div>
          )}
        </>
      )}
      {(call.kind === 'chemist' || call.kind === 'stockist') && !readOnly && (
        <PobEditor
          rows={call.pob ?? []}
          onChange={(pob) => onChange({ pob })}
          products={productOpts}
          stockists={stockistList}
          showStockist={call.kind === 'chemist'}
        />
      )}
      {(call.kind === 'chemist' || call.kind === 'stockist') &&
        readOnly &&
        (call.pob?.length ?? 0) > 0 && (
          <p className="text-sm text-muted-foreground" data-testid="dcr-call-pob-ro">
            Order booked: {call.pob.length} line{call.pob.length === 1 ? '' : 's'}
          </p>
        )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`rem-${call.clientId}`}>
          Remarks <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={`rem-${call.clientId}`}
          value={call.remarks}
          maxLength={1000}
          disabled={readOnly}
          onChange={(e) => onChange({ remarks: e.target.value })}
          className="md:text-base"
          data-testid="dcr-call-remarks"
        />
      </div>
      <FieldError messages={errors} />
    </li>
  );
}

function Field({
  label,
  optional,
  children,
  htmlFor,
  errors = [],
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
  htmlFor?: string;
  errors?: string[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>
        {label} {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {children}
      <FieldError messages={errors} />
    </div>
  );
}

const MEETING_TYPES = [
  'Cycle meeting',
  'Area review',
  'Regional review',
  'Conference or CME',
  'Team meeting',
];
const TRAINING_TYPES = [
  'Product training',
  'Induction',
  'Field skills workshop',
  'Compliance training',
  'Refresher training',
];
const ADMIN_TASKS = [
  'Expense filing',
  'Stock reconciliation',
  'Reports and MIS',
  'Office visit',
  'Bank or courier work',
];
const OTHER = '__other';

/** A type from a short preset list, or "Other" with the name typed in. Stored as the text itself. */
function TypeSelect({
  id,
  label,
  presets,
  value,
  onChange,
  placeholder,
  otherPlaceholder,
  maxLength = 120,
  disabled,
  errors = [],
  testId,
}: {
  id: string;
  label: string;
  presets: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  otherPlaceholder: string;
  maxLength?: number;
  disabled: boolean;
  errors?: string[];
  testId: string;
}) {
  const [otherPicked, setOtherPicked] = useState(false);
  const other = otherPicked || (!!value && !presets.includes(value));
  return (
    <div className="flex flex-col gap-1.5">
      <Label id={`${id}-label`}>{label}</Label>
      <ChoiceSelect
        id={id}
        aria-labelledby={`${id}-label`}
        value={other ? OTHER : value}
        onValueChange={(v) => {
          setOtherPicked(v === OTHER);
          onChange(v === OTHER ? '' : v);
        }}
        choices={[
          ...presets.map((p) => ({ value: p, label: p })),
          { value: OTHER, label: 'Other', hint: 'Type it in' },
        ]}
        placeholder={placeholder}
        disabled={disabled}
        invalid={errors.length > 0 && !other}
        className="sm:max-w-sm"
        testId={testId}
      />
      {other && (
        <Input
          autoFocus={otherPicked}
          aria-label={`${label} (other)`}
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={otherPlaceholder}
          aria-invalid={errors.length > 0 || undefined}
          className="af-fade md:text-base"
          data-testid={`${testId}-other`}
        />
      )}
      <FieldError messages={errors} />
    </div>
  );
}

/** Meeting and Training: type/name, in person or online, where, when, how long, who, remarks. */
export function MeetingFields({
  kind,
  value,
  onChange,
  readOnly,
  errors,
}: {
  kind: 'meeting' | 'training';
  value: MeetingForm;
  onChange: (v: MeetingForm) => void;
  readOnly: boolean;
  errors: Record<string, string[]>;
}) {
  const set = (p: Partial<MeetingForm>) => onChange({ ...value, ...p });
  const what = kind === 'meeting' ? 'Meeting' : 'Training';
  return (
    <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2" data-testid={`dcr-${kind}`}>
      <div className="sm:col-span-2">
        <TypeSelect
          id="m-title"
          label={`${what} type`}
          presets={kind === 'meeting' ? MEETING_TYPES : TRAINING_TYPES}
          value={value.title}
          onChange={(title) => set({ title })}
          placeholder={`Choose the ${what.toLowerCase()} type`}
          otherPlaceholder={
            kind === 'meeting' ? 'e.g. Distributor meet' : 'e.g. New product launch training'
          }
          disabled={readOnly}
          errors={errors.title}
          testId={`dcr-${kind}-type`}
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label id="m-mode-label">Mode</Label>
        <ChoiceSelect
          aria-labelledby="m-mode-label"
          value={value.mode}
          onValueChange={(mode) => set({ mode: mode as MeetingForm['mode'] })}
          choices={[
            { value: 'in_person', label: 'In person' },
            { value: 'online', label: 'Online' },
          ]}
          placeholder="Choose the mode"
          disabled={readOnly}
          className="sm:max-w-sm"
          testId="dcr-mode"
        />
      </div>
      <div className="sm:col-span-2">
        <Field
          label={value.mode === 'online' ? 'Link or platform' : 'Location'}
          optional={value.mode === 'online'}
          htmlFor="m-loc"
          errors={errors.location}
        >
          <Input
            id="m-loc"
            value={value.location}
            maxLength={200}
            onChange={(e) => set({ location: e.target.value })}
            className="md:text-base"
          />
        </Field>
      </div>
      <Field label="Start time" htmlFor="m-start" errors={errors.startTime}>
        <Input
          id="m-start"
          type="time"
          value={value.startTime}
          onChange={(e) => set({ startTime: e.target.value })}
          className="min-h-11 md:text-base"
        />
      </Field>
      <Field label="Duration (minutes)" htmlFor="m-dur" errors={errors.durationMin}>
        <Input
          id="m-dur"
          inputMode="numeric"
          value={value.durationMin}
          onChange={(e) => set({ durationMin: e.target.value.replace(/\D/g, '').slice(0, 3) })}
          placeholder="60"
          className="md:text-base"
        />
      </Field>
      {kind === 'training' && (
        <div className="sm:col-span-2">
          <Field label="Trainer" optional htmlFor="m-trainer">
            <Input
              id="m-trainer"
              value={value.trainer}
              maxLength={120}
              onChange={(e) => set({ trainer: e.target.value })}
              className="md:text-base"
            />
          </Field>
        </div>
      )}
      {kind === 'meeting' && (
        <div className="sm:col-span-2">
          <Field label="Attendees" optional htmlFor="m-att">
            <Input
              id="m-att"
              value={value.attendees}
              maxLength={500}
              onChange={(e) => set({ attendees: e.target.value })}
              className="md:text-base"
            />
          </Field>
        </div>
      )}
      <div className="sm:col-span-2">
        <Field label="Remarks" optional htmlFor="m-rem">
          <Input
            id="m-rem"
            value={value.remarks}
            maxLength={1000}
            onChange={(e) => set({ remarks: e.target.value })}
            className="md:text-base"
          />
        </Field>
      </div>
    </fieldset>
  );
}

export function OfficeFields({
  value,
  onChange,
  readOnly,
  errors,
}: {
  value: OfficeForm;
  onChange: (v: OfficeForm) => void;
  readOnly: boolean;
  errors: Record<string, string[]>;
}) {
  const set = (p: Partial<OfficeForm>) => onChange({ ...value, ...p });
  return (
    <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2" data-testid="dcr-office">
      <div className="sm:col-span-2">
        <TypeSelect
          id="o-type"
          label="Task type"
          presets={ADMIN_TASKS}
          value={value.taskType}
          onChange={(taskType) => set({ taskType })}
          placeholder="Choose the task type"
          otherPlaceholder="e.g. Sample stock count"
          maxLength={60}
          disabled={readOnly}
          errors={errors.taskType}
          testId="dcr-office-type"
        />
      </div>
      <div className="sm:col-span-2">
        <Field label="What you did" htmlFor="o-desc" errors={errors.description}>
          <textarea
            id="o-desc"
            value={value.description}
            maxLength={1000}
            rows={3}
            onChange={(e) => set({ description: e.target.value })}
            className="w-full rounded-md border bg-card px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
          />
        </Field>
      </div>
      <Field label="Start time" optional htmlFor="o-start">
        <Input
          id="o-start"
          type="time"
          value={value.startTime}
          onChange={(e) => set({ startTime: e.target.value })}
          className="min-h-11 md:text-base"
        />
      </Field>
      <Field label="Duration (minutes)" htmlFor="o-dur" errors={errors.durationMin}>
        <Input
          id="o-dur"
          inputMode="numeric"
          value={value.durationMin}
          onChange={(e) => set({ durationMin: e.target.value.replace(/\D/g, '').slice(0, 3) })}
          placeholder="120"
          className="md:text-base"
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Remarks" optional htmlFor="o-rem">
          <Input
            id="o-rem"
            value={value.remarks}
            maxLength={1000}
            onChange={(e) => set({ remarks: e.target.value })}
            className="md:text-base"
          />
        </Field>
      </div>
    </fieldset>
  );
}

type LeaveReq = {
  id: string;
  typeCode: string;
  typeName: string;
  fromDate: string;
  toDate: string;
  half: 'am' | 'pm' | null;
  days: number;
  reason: string | null;
  status: string;
};
type LeaveType = { code: string; name: string; active?: boolean };
const HALF_LABEL = { am: 'First half', pm: 'Second half' } as const;

/** Leave: the leave request that covers the date (pending or approved), or apply for one here. */
export function LeaveFields({
  date,
  value,
  onChange,
  readOnly,
  errors,
}: {
  date: string;
  value: string;
  onChange: (id: string) => void;
  readOnly: boolean;
  errors: string[];
}) {
  const [reqs, setReqs] = useState<LeaveReq[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [applying, setApplying] = useState(false);
  const [form, setForm] = useState({ typeCode: '', half: '' as '' | 'am' | 'pm', reason: '' });
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setReqs(null);
    setLoadError(null);
    void (async () => {
      await apiReady();
      const [r, t] = await Promise.all([
        api.GET('/v1/leave/requests', { params: { query: { mine: 'true' } } }),
        api.GET('/v1/leave/types', {}),
      ]);
      if (!live) return;
      if (!r.data) return setLoadError(failureMessage(r, 'Could not load your leave.'));
      const items = (r.data as { items: LeaveReq[] }).items.filter(
        (l) => ['pending', 'approved'].includes(l.status) && l.fromDate <= date && l.toDate >= date,
      );
      setReqs(items);
      setTypes(
        ((t.data as { items?: LeaveType[] } | undefined)?.items ?? []).filter(
          (x) => x.active !== false,
        ),
      );
      if (!value && items.length === 1 && !readOnly) onChange(items[0]!.id);
    })().catch((e: unknown) => live && setLoadError(thrownMessage(e)));
    return () => {
      live = false;
    };
    // Reload on date or retry only; value/readOnly/onChange are read once per load.
  }, [date, tick]);

  async function apply() {
    setBusy(true);
    setApplyError(null);
    let r;
    try {
      r = await api.POST('/v1/leave/requests', {
        body: {
          typeCode: form.typeCode,
          fromDate: date,
          toDate: date,
          half: form.half || null,
          reason: form.reason.trim() || null,
        },
      });
    } catch (e) {
      setBusy(false);
      return setApplyError(thrownMessage(e));
    }
    setBusy(false);
    if (r.error || !r.data) return setApplyError(failureMessage(r, 'Could not apply for leave.'));
    const created = r.data as unknown as LeaveReq;
    setReqs((x) => [...(x ?? []), created]);
    onChange(created.id);
    setApplying(false);
  }

  if (loadError)
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-danger-soft p-4 text-sm"
        role="alert"
      >
        {loadError}
        <Button type="button" size="sm" variant="outline" onClick={() => setTick((t) => t + 1)}>
          <RotateCw aria-hidden /> Retry
        </Button>
      </div>
    );
  if (!reqs) return <Skeleton className="h-20 w-full" />;
  return (
    <div className="flex flex-col gap-4" data-testid="dcr-leave">
      {reqs.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Label id="l-req-label">Leave covering this date</Label>
          <ChoiceSelect
            aria-labelledby="l-req-label"
            value={value}
            onValueChange={onChange}
            choices={reqs.map((l) => ({
              value: l.id,
              label: `${l.typeName} · ${l.half ? HALF_LABEL[l.half] : l.fromDate === l.toDate ? 'Full day' : `${l.fromDate} to ${l.toDate} (${l.days} days)`}`,
              hint: `${l.status === 'approved' ? 'Approved' : 'Awaiting approval'}${l.reason ? ` · ${l.reason}` : ''}`,
            }))}
            placeholder="Choose the leave for this day"
            disabled={readOnly}
            invalid={errors.length > 0}
            className="sm:max-w-md"
            testId="dcr-leave-request"
          />
        </div>
      ) : (
        !applying && (
          <p className="text-sm text-muted-foreground">No leave request covers this date yet.</p>
        )
      )}
      <FieldError messages={errors} />
      {!readOnly && !applying && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setApplying(true)}
            data-testid="dcr-leave-apply"
          >
            <CalendarPlus aria-hidden /> Apply for leave on this date
          </Button>
          <Button type="button" variant="link" size="sm" asChild>
            <Link href="/leave">Longer leave on the Leave page</Link>
          </Button>
        </div>
      )}
      {applying && (
        <div
          className="af-enter grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2"
          data-testid="dcr-leave-form"
        >
          <div className="flex flex-col gap-1.5">
            <Label id="l-type-label">Leave type</Label>
            {types.length ? (
              <ChoiceSelect
                aria-labelledby="l-type-label"
                value={form.typeCode}
                onValueChange={(typeCode) => setForm((f) => ({ ...f, typeCode }))}
                choices={types.map((t) => ({ value: t.code, label: t.name, hint: t.code }))}
                placeholder="Choose a leave type"
                testId="dcr-leave-type"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No leave types are set up. Ask your administrator.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label id="l-half-label">Duration</Label>
            <ChoiceSelect
              aria-labelledby="l-half-label"
              value={form.half || 'full'}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, half: v === 'full' ? '' : (v as 'am' | 'pm') }))
              }
              choices={[
                { value: 'full', label: 'Full day' },
                { value: 'am', label: 'First half' },
                { value: 'pm', label: 'Second half' },
              ]}
              placeholder="Choose the duration"
              testId="dcr-leave-half"
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="l-reason">
              Reason <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="l-reason"
              value={form.reason}
              maxLength={1000}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              className="md:text-base"
            />
          </div>
          {applyError && (
            <p className="text-sm text-destructive sm:col-span-2" role="alert">
              {applyError}
            </p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button
              type="button"
              disabled={busy || !form.typeCode}
              onClick={() => void apply()}
              data-testid="dcr-leave-submit"
            >
              {busy ? 'Applying…' : 'Apply for leave'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setApplying(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
