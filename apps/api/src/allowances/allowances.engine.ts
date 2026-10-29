import type { AllowanceDay, AllowanceDraftRequest } from '@ariforce/contracts';
import { type Tx } from '@ariforce/db';
import { sql } from 'drizzle-orm';
import { err } from '../field/checkins.service';
import { dayReportSql } from '../dcr/day-report';

type Band = 'hq' | 'ex_hq' | 'outstation';
type Rate = {
  id: string;
  band: Band;
  role_id: string | null;
  effective_from: string;
  da: number;
  per_km: number;
  fixed: number;
};
type Place = {
  id: string;
  name: string;
  band: 'ex_hq' | 'outstation';
  km: number;
};
export interface DraftLine {
  date: string;
  dcrId: string;
  category: 'allowance' | 'mileage' | 'travel';
  amount: number;
  mileageKm: number | null;
  notes: string;
  placeId: string | null;
  calc: Record<string, unknown>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const BAND_LABEL: Record<Band, string> = { hq: 'HQ', ex_hq: 'ex-HQ', outstation: 'outstation' };

/**
 * TA/DA for one claim month (#39, docs/TADA.md): per DCR day, band from the work type, rate from the
 * card (role-specific wins, latest effective_from <= date), km from the fare chart (round trip).
 */
export interface ComputeOptions {
  /** Only these dates (auto-draft on DCR submit drafts one day); default = the whole claim month. */
  dates?: string[];
}

/** Round-trip km from the DCR's frozen SFC snapshots (one per HQ of the day); null when none. */
export const sfcKm = (snaps: { bothWayKm?: unknown }[]) => {
  const ks = snaps.map((x) => Number(x.bothWayKm)).filter((n) => Number.isFinite(n) && n > 0);
  return ks.length ? r2(ks.reduce((a, b) => a + b, 0)) : null;
};

export async function computeAllowances(
  tx: Tx,
  claim: { id: string; userId: string; month: string },
  req: AllowanceDraftRequest,
  today: string,
  opts: ComputeOptions = {},
) {
  const only = opts.dates?.length ? new Set(opts.dates) : null;
  const from = claim.month;
  const to =
    new Date(Date.parse(`${from}T00:00:00Z`) + 31 * 86_400_000).toISOString().slice(0, 8) + '01';
  const roleIds = (
    await tx.execute<{ id: string }>(
      sql`select role_id as id from user_roles where user_id = ${claim.userId}`,
    )
  ).rows.map((r) => r.id);
  const [hq] = (
    await tx.execute<{ id: string }>(sql`select t.id from user_territories ut
      join territories t on t.id = ut.territory_id and t.level = 'headquarter' and t.deleted_at is null
      where ut.user_id = ${claim.userId} order by t.code limit 1`)
  ).rows;
  const dcrRows = (
    await tx.execute<{ id: string; date: string; status: string; code: string; band: string }>(
      sql`select d.id, to_char(d.date, 'YYYY-MM-DD') as date, d.status, wt.code, wt.allowance_band as band
        from dcrs d join work_types wt on wt.id = d.work_type_id
        where d.user_id = ${claim.userId} and d.deleted_at is null and ${dayReportSql('d')}
          and d.status <> 'rejected'
          and d.date >= ${from}::date and d.date < ${to}::date and d.date <= ${today}::date
        order by d.date`,
    )
  ).rows.filter((d) => !only || only.has(d.date));
  // Days whose only live reports are rejected: no TA/DA, reported as dcr_rejected (explicit, #B2).
  const rejectedRows = (
    await tx.execute<{ id: string; date: string; code: string; band: string }>(
      sql`select distinct on (d.date) d.id, to_char(d.date, 'YYYY-MM-DD') as date, wt.code, wt.allowance_band as band
        from dcrs d join work_types wt on wt.id = d.work_type_id
        where d.user_id = ${claim.userId} and d.deleted_at is null and d.status = 'rejected'
          and d.date >= ${from}::date and d.date < ${to}::date and d.date <= ${today}::date
          and not exists (select 1 from dcrs x where x.user_id = d.user_id and x.date = d.date
            and x.deleted_at is null and x.status <> 'rejected')
        order by d.date, d.rejected_at desc nulls last, d.id desc`,
    )
  ).rows.filter((d) => !only || only.has(d.date));
  const snapRows = dcrRows.length
    ? (
        await tx.execute<{ dcr_id: string; snapshot: { bothWayKm?: unknown } | null }>(
          sql`select dcr_id, snapshot from dcr_sfc_routes where deleted_at is null and snapshot is not null
            and dcr_id in (${sql.join(
              dcrRows.map((d) => sql`${d.id}::uuid`),
              sql`, `,
            )})`,
        )
      ).rows
    : [];
  const rates = (
    await tx.execute<Rate>(sql`select id, band, role_id, to_char(effective_from, 'YYYY-MM-DD') as effective_from,
        da_amount::float8 as da, ta_per_km::float8 as per_km, ta_fixed::float8 as fixed
      from allowance_rates where deleted_at is null`)
  ).rows;
  const places = hq
    ? (
        await tx.execute<Place>(sql`select id, name, band, one_way_km::float8 as km from allowance_places
          where deleted_at is null and active and hq_territory_id = ${hq.id}`)
      ).rows
    : [];
  const lines = (
    await tx.execute<{ date: string; category: string; source: string; place: string | null }>(
      sql`select to_char(date, 'YYYY-MM-DD') as date, category, source, allowance_place_id as place
        from expense_lines where claim_id = ${claim.id} and deleted_at is null`,
    )
  ).rows;

  for (const [date, placeId] of Object.entries(req.places ?? {})) {
    if (!places.some((x) => x.id === placeId))
      throw err(422, 'PLACE_NOT_USABLE', 'Place is not an active fare-chart place of your HQ', {
        date,
        placeId,
      });
  }

  const pickRate = (band: Band, date: string) => {
    const ok = rates
      .filter((r) => r.band === band && r.effective_from <= date)
      .filter((r) => r.role_id === null || roleIds.includes(r.role_id));
    const best = (xs: Rate[]) =>
      xs.sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
    return best(ok.filter((r) => r.role_id !== null)) ?? best(ok.filter((r) => r.role_id === null));
  };

  const days: AllowanceDay[] = [];
  const out: DraftLine[] = [];
  for (const d of rejectedRows) {
    if (d.band === 'none') continue;
    days.push({
      date: d.date,
      dcrId: d.id,
      workTypeCode: d.code,
      band: d.band as Band,
      rateId: null,
      placeId: null,
      placeName: null,
      km: null,
      da: 0,
      ta: 0,
      issues: ['dcr_rejected'],
    });
  }
  for (const d of dcrRows) {
    if (d.band === 'none') continue;
    const band = d.band as Band;
    const day: AllowanceDay = {
      date: d.date,
      dcrId: d.id,
      workTypeCode: d.code,
      band,
      rateId: null,
      placeId: null,
      placeName: null,
      km: null,
      da: 0,
      ta: 0,
      issues: [],
    };
    days.push(day);
    if (d.status === 'draft') {
      day.issues.push('dcr_not_submitted');
      continue;
    }
    if (
      lines.some(
        (l) =>
          l.date === d.date &&
          l.source === 'manual' &&
          (l.category === 'allowance' || l.category === 'mileage'),
      )
    ) {
      day.issues.push('manual_line_exists');
      continue;
    }
    const rate = pickRate(band, d.date);
    if (!rate) {
      day.issues.push('no_rate');
      continue;
    }
    day.rateId = rate.id;
    day.da = r2(rate.da);
    let place: Place | undefined;
    let kmSource: 'place' | 'sfc' | null = null;
    if (band !== 'hq') {
      const asked = req.places?.[d.date];
      const prev = lines.find((l) => l.date === d.date && l.source === 'auto' && l.place)?.place;
      const sameBand = places.filter((x) => x.band === band);
      // Priority: the place asked for > the DCR's frozen SFC snapshot km > previous/only place.
      const snapKm = asked
        ? null
        : sfcKm(snapRows.filter((x) => x.dcr_id === d.id).map((x) => x.snapshot ?? {}));
      place = asked
        ? places.find((x) => x.id === asked)
        : snapKm !== null
          ? undefined
          : (sameBand.find((x) => x.id === prev) ??
            (sameBand.length === 1 ? sameBand[0] : undefined));
      if (asked && place && place.band !== band)
        throw err(422, 'PLACE_NOT_USABLE', `Place band is ${place.band}, the day is ${band}`, {
          date: d.date,
          placeId: asked,
        });
      if (snapKm !== null) {
        day.km = snapKm;
        kmSource = 'sfc';
      } else if (!place) day.issues.push('place_required');
    }
    if (place) {
      day.placeId = place.id;
      day.placeName = place.name;
      day.km = r2(place.km * 2);
      kmSource = 'place';
    }
    day.ta = r2((day.km ?? 0) * rate.per_km + rate.fixed);
    const calc = {
      band,
      rateId: rate.id,
      placeId: day.placeId,
      km: day.km,
      kmSource,
      taPerKm: rate.per_km,
      taFixed: rate.fixed,
      daAmount: rate.da,
    };
    const label = BAND_LABEL[band];
    if (day.da > 0)
      out.push({
        date: d.date,
        dcrId: d.id,
        category: 'allowance',
        amount: day.da,
        mileageKm: null,
        notes: `DA (${label})`,
        placeId: day.placeId,
        calc,
      });
    if (day.ta > 0)
      out.push({
        date: d.date,
        dcrId: d.id,
        category: day.km ? 'mileage' : 'travel',
        amount: day.ta,
        mileageKm: day.km || null,
        notes: place
          ? `TA (${label}): ${place.name}, ${day.km} km`
          : kmSource === 'sfc'
            ? `TA (${label}): SFC, ${day.km} km`
            : `TA (${label})`,
        placeId: day.placeId,
        calc,
      });
  }
  const sum = (f: (d: AllowanceDay) => number) => r2(days.reduce((s, d) => s + f(d), 0));
  days.sort((a, b) => a.date.localeCompare(b.date));
  return {
    days,
    lines: out,
    totals: {
      da: sum((d) => d.da),
      ta: sum((d) => d.ta),
      km: sum((d) => d.km ?? 0),
      lines: out.length,
    },
  };
}
