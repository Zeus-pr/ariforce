/**
 * DCR redesign (docs/DCR-REDESIGN-DESIGN.md, AriForce-data/DCR-REDESIGN-SPEC.md): pure helpers for the
 * /dcr page. "Work On" groups the API's work types: Field (one work type per band), Meeting, Training,
 * Admin work and Leave (by detailsKind), plus any other work type as-is (e.g. Holiday).
 */
import type { Dcr, DcrBand, DcrDetails, DcrDraftPut, DcrSfcMatch } from '@ariforce/contracts';
import { bandOf, categoryFitsBand, sfcCategoryOf } from './bands';
import type { ApiError } from '@/lib/api';
import { dcrDateNotTodayMessage } from './date-rule';

export type WorkTypeOption = {
  id: string;
  code: string;
  name: string;
  kind: 'field' | 'non_field' | 'leave' | 'holiday';
  band: DcrBand | null;
  usesSfc: boolean;
  detailsKind: 'meeting' | 'training' | 'office' | 'leave' | null;
};
export type HqOption = {
  id: string;
  code: string;
  name: string;
  territories: { id: string; code: string; name: string }[];
};
export type Person = {
  id: string;
  name: string;
  employeeCode: string | null;
  designation: string | null;
};
export type SfcHq = DcrSfcMatch['hqs'][number];
export type Candidate = SfcHq['candidates'][number];
export type CallKind = 'doctor' | 'chemist' | 'stockist';

export const BANDS: { band: DcrBand; short: string; label: string; hint: string }[] = [
  { band: 'hq', short: 'HQ', label: 'Headquarter', hint: 'Within your HQ town' },
  { band: 'ex_hq', short: 'EX', label: 'Ex-HQ', hint: 'Outside HQ, back the same day' },
  { band: 'outstation', short: 'OS', label: 'Out-station', hint: 'Overnight stay away from HQ' },
];
export const BAND_LABEL: Record<DcrBand, string> = {
  hq: 'HQ',
  ex_hq: 'Ex-HQ',
  outstation: 'Out-station',
};
export const KIND_LABEL: Record<CallKind, string> = {
  doctor: 'Doctor',
  chemist: 'Chemist',
  stockist: 'Stockist',
};
export const MODE_LABEL: Record<string, string> = {
  bike: 'Bike',
  bus: 'Bus',
  train: 'Train',
  bus_train: 'Bus / train',
  car: 'Car',
  other: 'Other',
};

/** One "Work On" choice. Field covers every work type with a band; the band picks the exact one. */
export type WorkOn = {
  key: string;
  label: string;
  branch: 'field' | 'meeting' | 'training' | 'office' | 'leave' | 'other';
  workTypes: WorkTypeOption[];
};

/**
 * Work types with their band normalised (any case; 'ex'/'os' accepted). A field work type whose band
 * is set but unrecognised (legacy "EX / OS", "MEETING") is dropped rather than shown as a band.
 */
export function normaliseWorkTypes(wts: WorkTypeOption[]): WorkTypeOption[] {
  return wts.flatMap((w) => {
    const band = bandOf(w.band);
    if (w.kind === 'field' && w.band != null && !band) return [];
    return [{ ...w, band }];
  });
}

/**
 * SFC candidates kept only when their category is exactly the band's (case-insensitive); legacy,
 * combined or unknown categories are dropped. The auto pick is kept only if it survived.
 */
export function cleanSfcHqs(hqs: SfcHq[], band: DcrBand | null): SfcHq[] {
  return hqs.map((h) => {
    const candidates = band
      ? h.candidates
          .filter((c) => categoryFitsBand(c.category, band))
          .map((c) => ({ ...c, category: sfcCategoryOf(c.category)!, band }))
      : [];
    const autoSelectedId = candidates.some((c) => c.id === h.autoSelectedId)
      ? h.autoSelectedId
      : candidates.length === 1
        ? candidates[0]!.id
        : null;
    return { ...h, candidates, autoSelectedId };
  });
}

export function workOnChoices(wts: WorkTypeOption[]): WorkOn[] {
  const out: WorkOn[] = [];
  const field = wts.filter((w) => w.kind === 'field' && w.band);
  if (field.length)
    out.push({ key: 'field', label: 'Field work', branch: 'field', workTypes: field });
  const label = {
    meeting: 'Meeting',
    training: 'Training',
    office: 'Admin work',
    leave: 'Leave',
  } as const;
  for (const k of ['meeting', 'training', 'office', 'leave'] as const) {
    const ws = wts.filter((w) => w.detailsKind === k);
    // Several admin-type work types (e.g. Office, Admin) stay separate choices under their own names.
    if (ws.length === 1) out.push({ key: ws[0]!.id, label: label[k], branch: k, workTypes: ws });
    else ws.forEach((w) => out.push({ key: w.id, label: w.name, branch: k, workTypes: [w] }));
  }
  wts
    .filter((w) => !(w.kind === 'field' && w.band) && !w.detailsKind)
    .forEach((w) => out.push({ key: w.id, label: w.name, branch: 'other', workTypes: [w] }));
  return out;
}
export const workOnFor = (choices: WorkOn[], workTypeId: string) =>
  choices.find((c) => c.workTypes.some((w) => w.id === workTypeId));

/** Territory row of the picker: an HQ itself or a level 'territory' row under it. */
export type TerritoryRow = {
  id: string;
  name: string;
  code: string;
  level: 'headquarter' | 'territory';
  hqId: string;
  hqName: string;
};
export function territoryRows(hqs: HqOption[]): TerritoryRow[] {
  return hqs.flatMap((h) => [
    {
      id: h.id,
      name: h.name,
      code: h.code,
      level: 'headquarter' as const,
      hqId: h.id,
      hqName: h.name,
    },
    ...h.territories.map((t) => ({
      id: t.id,
      name: t.name,
      code: t.code,
      level: 'territory' as const,
      hqId: h.id,
      hqName: h.name,
    })),
  ]);
}
/** Distinct HQs of the picked territories, first-seen order (what SFC matching and customer lists use). */
export const hqIdsOf = (rows: TerritoryRow[], ids: string[]) => [
  ...new Set(ids.map((id) => rows.find((r) => r.id === id)?.hqId).filter(Boolean) as string[]),
];

export type PobLineDraft = { productId: string; quantity: string; stockistId: string };

export type CallDraft = {
  clientId: string;
  kind: CallKind;
  outletId: string;
  outletName: string;
  /** HQ the customer is filed under; a territory change clears customers outside the new HQs. */
  hqId: string;
  time: string;
  productIds: string[];
  presentationOpenedAt: string | null;
  /** Order booked — chemist / stockist calls only (empty on doctors). */
  pob: PobLineDraft[];
  remarks: string;
};
export type MeetingForm = {
  title: string;
  mode: 'in_person' | 'online';
  location: string;
  startTime: string;
  durationMin: string;
  attendees: string;
  remarks: string;
  trainer: string;
};
export type OfficeForm = {
  taskType: string;
  description: string;
  startTime: string;
  durationMin: string;
  remarks: string;
};
export const emptyMeeting = (): MeetingForm => ({
  title: '',
  mode: 'in_person',
  location: '',
  startTime: '',
  durationMin: '',
  attendees: '',
  remarks: '',
  trainer: '',
});
export const emptyOffice = (): OfficeForm => ({
  taskType: '',
  description: '',
  startTime: '',
  durationMin: '',
  remarks: '',
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ist = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
export const timeOfIso = (iso: string) => ist.format(new Date(iso));
export const isoOf = (date: string, hhmm: string) =>
  new Date(`${date}T${hhmm}:00+05:30`).toISOString();

export type FlowState = {
  date: string;
  workOn: WorkOn | undefined;
  workTypeId: string;
  territoryIds: string[];
  workWith: string[];
  workWithDone: boolean;
  sfc: { state: 'idle' | 'loading' | 'ok' | 'no_match' | 'error'; hqs: SfcHq[] };
  routeChoice: Record<string, string>;
  calls: CallDraft[];
  meeting: MeetingForm;
  office: OfficeForm;
  leaveRequestId: string;
  /** Why the day differs from the approved tour plan; asked for when submit says DEVIATION_REASON_REQUIRED. */
  deviationReason: string;
};

const minutes = (v: string) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 720 ? n : null;
};

export function detailsOf(s: FlowState): DcrDetails | null {
  const b = s.workOn?.branch;
  const t = (v: string) => v.trim() || null;
  if (b === 'meeting' || b === 'training') {
    const m = s.meeting;
    if (!m.title.trim() || !HHMM.test(m.startTime) || !minutes(m.durationMin)) return null;
    const base = {
      title: m.title.trim(),
      mode: m.mode,
      location: t(m.location),
      startTime: m.startTime,
      durationMin: minutes(m.durationMin)!,
      attendees: t(m.attendees),
      remarks: t(m.remarks),
    };
    return b === 'meeting'
      ? { kind: 'meeting', ...base }
      : { kind: 'training', ...base, trainer: t(m.trainer) };
  }
  if (b === 'office') {
    const o = s.office;
    if (!o.taskType.trim() || !o.description.trim() || !minutes(o.durationMin)) return null;
    return {
      kind: 'office',
      taskType: o.taskType.trim(),
      description: o.description.trim(),
      startTime: HHMM.test(o.startTime) ? o.startTime : null,
      durationMin: minutes(o.durationMin)!,
      remarks: t(o.remarks),
    };
  }
  if (b === 'leave')
    return s.leaveRequestId ? { kind: 'leave', leaveRequestId: s.leaveRequestId } : null;
  return null;
}

/** Problems that block Submit, keyed by the field they belong to. Field values are only checked on a Field day. */
export function problems(s: FlowState): { key: string; text: string }[] {
  const p: { key: string; text: string }[] = [];
  const add = (key: string, text: string) => p.push({ key, text });
  const b = s.workOn?.branch;
  if (!s.workOn) add('workOn', 'Choose what you worked on.');
  if (b === 'field') {
    if (!s.workTypeId) add('band', 'Choose the band: HQ, EX or OS.');
    else if (!s.territoryIds.length) add('territory', 'Choose the territory you worked.');
    else if (!s.workWithDone) add('workWith', 'Choose who you worked with, or Worked alone.');
    else if (s.sfc.state === 'loading') add('sfc', 'Waiting for your SFC record.');
    else if (s.sfc.state === 'no_match')
      add('sfc', 'No matching SFC record. Change the territory or band.');
    else if (s.sfc.state === 'error')
      add('sfc', 'SFC could not be loaded. Retry before submitting.');
    else if (s.sfc.state === 'ok') {
      for (const h of s.sfc.hqs)
        if (!(s.routeChoice[h.hqTerritoryId] ?? h.autoSelectedId))
          add('sfc', `Pick the SFC route for ${h.hqName}.`);
      if (!s.calls.length) add('calls', 'Add at least one Doctor, Chemist or Stockist call.');
      s.calls.forEach((c, i) => {
        if (!c.outletId)
          add(
            `call-${c.clientId}`,
            `Call ${i + 1}: choose the ${KIND_LABEL[c.kind].toLowerCase()}.`,
          );
        if (!HHMM.test(c.time)) add(`call-${c.clientId}`, `Call ${i + 1}: enter the visit time.`);
        if (c.kind === 'doctor' && c.productIds.length && !c.presentationOpenedAt)
          add(
            `call-${c.clientId}`,
            `Call ${i + 1}: open the product presentation before submitting.`,
          );
      });
    }
  }
  if (b === 'meeting' || b === 'training') {
    const m = s.meeting;
    const what = b === 'meeting' ? 'meeting' : 'training';
    if (!m.title.trim()) add('title', `Choose the ${what} type, or pick Other and type it in.`);
    if (m.mode === 'in_person' && !m.location.trim()) add('location', 'Enter where it was held.');
    if (!HHMM.test(m.startTime)) add('startTime', 'Enter the start time.');
    if (!minutes(m.durationMin)) add('durationMin', 'Enter the duration in minutes (1 to 720).');
  }
  if (b === 'office') {
    const o = s.office;
    if (!o.taskType.trim()) add('taskType', 'Choose the task type, or pick Other and type it in.');
    if (!o.description.trim()) add('description', 'Describe the task.');
    if (!minutes(o.durationMin)) add('durationMin', 'Enter the duration in minutes (1 to 720).');
  }
  if (b === 'leave' && !s.leaveRequestId)
    add('leave', 'Choose or apply for the leave that covers this date.');
  return p;
}

/** PUT /v1/dcrs/draft body. Non-field days never carry territories, Work With, SFC or calls. */
/**
 * PUT /v1/dcrs/draft body. Pass the saved draft (id + version) to update it; pass nothing to create a
 * new draft: id and version are both left out then (version alone would update the day's latest draft).
 */
export function draftBody(
  s: FlowState,
  saved?: { id: string; version: number } | null,
): DcrDraftPut {
  const field = s.workOn?.branch === 'field';
  const routes =
    field && s.sfc.state === 'ok'
      ? s.sfc.hqs
          .map((h) => {
            // A remembered choice counts only if it is still one of the (cleaned) candidates.
            const picked = s.routeChoice[h.hqTerritoryId];
            const ok = picked && h.candidates.some((c) => c.id === picked) ? picked : null;
            return { hqTerritoryId: h.hqTerritoryId, sfcRouteId: ok ?? h.autoSelectedId ?? '' };
          })
          .filter((r) => r.sfcRouteId)
      : [];
  const details = field ? null : detailsOf(s);
  return {
    date: s.date,
    workTypeId: s.workTypeId,
    territoryIds: field ? s.territoryIds : [],
    workWithUserIds: field ? s.workWith : [],
    ...(field ? { sfcRoutes: routes } : {}),
    // A partial non-field form is kept on the page, not sent: the API only takes complete details.
    details,
    deviationReason: s.deviationReason.trim() || null,
    calls: field
      ? s.calls
          .filter((c) => c.outletId && HHMM.test(c.time))
          .map((c) => ({
            clientId: c.clientId,
            outletKind: c.kind,
            outletId: c.outletId,
            checkInId: null,
            jointWorkUserIds: s.workWith,
            productsDetailed: c.productIds.map((productId, i) => ({ productId, order: i + 1 })),
            samples: [],
            pob:
              c.kind === 'doctor'
                ? []
                : c.pob
                    .filter((r) => r.productId && Number(r.quantity) > 0)
                    .map((r) => ({
                      productId: r.productId,
                      quantity: Number(r.quantity),
                      stockistId: r.stockistId || null,
                    })),
            rcpa: [],
            remarks: c.remarks.trim() || null,
            ...(c.kind === 'doctor' ? { presentationOpenedAt: c.presentationOpenedAt } : {}),
            calledAt: isoOf(s.date, c.time),
          }))
      : [],
    ...(saved ? { id: saved.id, version: saved.version } : {}),
  };
}

/** Placeholder until the customer's name is looked up (dcr-flow). */
export const SAVED_CUSTOMER = 'Saved customer';
export function callsFromDcr(d: Dcr, names: Map<string, string>): CallDraft[] {
  return d.calls.map((c) => ({
    clientId: c.id,
    kind: c.outletKind,
    outletId: c.outletId,
    outletName: names.get(c.outletId) ?? SAVED_CUSTOMER,
    hqId: '',
    time: timeOfIso(c.calledAt),
    productIds: c.productsDetailed.sort((a, b) => a.order - b.order).map((p) => p.productId),
    presentationOpenedAt:
      (c as typeof c & { presentationOpenedAt?: string | null }).presentationOpenedAt ?? null,
    pob: (c.pob ?? []).map((l) => ({
      productId: l.productId,
      quantity: String(l.quantity),
      stockistId: l.stockistId ?? '',
    })),
    remarks: c.remarks ?? '',
  }));
}

/** Plain words for the redesign's error codes. */
export function dcrErrorMessage(e: ApiError): string {
  switch (e.code) {
    case 'SFC_NO_MATCH':
      return 'No matching SFC record for this band and territory. Change the territory or band, or ask your manager to add the route to your SFC.';
    case 'SFC_ROUTE_REQUIRED':
      return 'More than one SFC route fits. Pick the route you travelled.';
    case 'SFC_MISMATCH':
      return 'Your SFC changed since it was loaded. Pick the route again.';
    case 'SFC_UNAVAILABLE':
      return 'SFC could not be loaded just now. Retry in a moment.';
    case 'LEAVE_NOT_FOUND':
      return 'No pending or approved leave of yours covers this date. Apply for leave first.';
    case 'ALREADY_SUBMITTED':
      return 'This report was already submitted and is read-only.';
    case 'VERSION_CONFLICT':
      return 'This report changed in another tab. Reload the page and try again.';
    case 'DAY_LOCKED':
      return 'This day is locked. Ask your manager to reopen it.';
    case 'DCR_DATE_NOT_TODAY':
      return dcrDateNotTodayMessage(e.details);
    case 'DAY_ALREADY_SUBMITTED':
      return 'You already submitted a report for this day. This draft can’t be saved or submitted; you can delete it.';
    case 'NOT_FOUND':
      return 'This draft no longer exists. It may have been deleted on another device.';
    case 'DEVIATION_REASON_REQUIRED':
      return 'Say why the day differs from your approved tour plan.';
    default:
      return e.message || 'Could not save. Try again.';
  }
}
