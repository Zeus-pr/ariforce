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
export async function computeAllowances(
  tx: Tx,
  claim: { id: string; userId: string; month: string },
  req: AllowanceDraftRequest,
  today: string,
) {
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
          and d.date >= ${from}::date and d.date < ${to}::date and d.date <= ${today}::date
        order by d.date`,
    )
  ).rows;
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
    if (band !== 'hq') {
      const asked = req.places?.[d.date];
      const prev = lines.find((l) => l.date === d.date && l.source === 'auto' && l.place)?.place;
      const sameBand = places.filter((x) => x.band === band);
      place = asked
        ? places.find((x) => x.id === asked)
        : (sameBand.find((x) => x.id === prev) ??
          (sameBand.length === 1 ? sameBand[0] : undefined));
      if (asked && place && place.band !== band)
        throw err(422, 'PLACE_NOT_USABLE', `Place band is ${place.band}, the day is ${band}`, {
          date: d.date,
          placeId: asked,
        });
      if (!place) day.issues.push('place_required');
    }
    if (place) {
      day.placeId = place.id;
      day.placeName = place.name;
      day.km = r2(place.km * 2);
    }
    day.ta = r2((day.km ?? 0) * rate.per_km + rate.fixed);
    const calc = {
      band,
      rateId: rate.id,
      placeId: day.placeId,
      km: day.km,
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
        notes: place ? `TA (${label}): ${place.name}, ${day.km} km` : `TA (${label})`,
        placeId: day.placeId,
        calc,
      });
  }
  const sum = (f: (d: AllowanceDay) => number) => r2(days.reduce((s, d) => s + f(d), 0));
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
