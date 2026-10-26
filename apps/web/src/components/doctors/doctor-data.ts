import type { CheckIn, Dcr } from '@ariforce/contracts';
import { addDays } from '@/lib/period';
import { MOCK_PRODUCT_SEED } from '@/mocks/product-seed';

export type Visit = {
  id: string;
  date: string; // YYYY-MM-DD
  products: { productId: string; feedback: 'positive' | 'neutral' | 'negative' | null }[];
  samples: { productId: string; quantity: number }[];
  pobValue: number | null;
  inFence: boolean | null;
  remarks: string | null;
  sample?: boolean;
};

/** Samples per doctor per month before a call is flagged. No contract yet (CONTRACT-GAPS #18); to confirm with Arighna. */
export const SAMPLE_CAP_PER_MONTH = 10;
export const HISTORY_DAYS = 90;

/** Visits to one doctor from DCR calls, with the GPS check-in matched by id (or same day) when there is one. */
export function visitsFrom(doctorId: string, dcrs: Dcr[], checkIns: CheckIn[]): Visit[] {
  const ci = checkIns.filter((c) => c.outletKind === 'doctor' && c.outletId === doctorId);
  const out: Visit[] = [];
  for (const d of dcrs)
    for (const c of d.calls)
      if (c.outletKind === 'doctor' && c.outletId === doctorId) {
        const geo =
          ci.find((x) => x.id === c.checkInId) ??
          ci.find((x) => x.capturedAt.slice(0, 10) === d.date);
        out.push({
          id: c.id,
          date: d.date,
          products: [...c.productsDetailed]
            .sort((a, b) => a.order - b.order)
            .map((p) => ({ productId: p.productId, feedback: p.feedback ?? null })),
          samples: c.samples,
          pobValue: c.pob.length ? c.pob.reduce((s, l) => s + (l.value ?? 0), 0) : null,
          inFence: geo ? geo.inFence : null,
          remarks: c.remarks,
        });
      }
  // Check-ins with no DCR call yet still count as visits.
  for (const c of ci)
    if (!out.some((v) => v.date === c.capturedAt.slice(0, 10)))
      out.push({
        id: c.id,
        date: c.capturedAt.slice(0, 10),
        products: [],
        samples: [],
        pobValue: null,
        inFence: c.inFence,
        remarks: null,
      });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Labelled sample history for a doctor with no recorded calls, so the page can be reviewed. Deterministic per doctor. */
export function sampleVisits(doctorId: string, today: string, perMonth: number): Visit[] {
  let seed = [...doctorId].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % 1000) / 1000;
  const pick = () => MOCK_PRODUCT_SEED[Math.floor(rnd() * MOCK_PRODUCT_SEED.length)]!.id;
  const gap = Math.max(5, Math.round(30 / Math.max(1, perMonth)));
  const out: Visit[] = [];
  for (
    let back = 2 + Math.floor(rnd() * 4), i = 0;
    back < HISTORY_DAYS;
    back += gap + Math.floor(rnd() * 5) - 2, i++
  ) {
    const products = [pick(), pick(), pick()].filter((p, j, a) => a.indexOf(p) === j);
    const fb = ['positive', 'neutral', 'positive', 'negative'] as const;
    out.push({
      id: `sample-${i}`,
      date: addDays(today, -back),
      products: products.map((productId, j) => ({ productId, feedback: fb[(i + j) % 4]! })),
      samples: products
        .slice(0, 2)
        .map((productId) => ({ productId, quantity: 2 + Math.floor(rnd() * 4) })),
      pobValue: rnd() > 0.6 ? Math.round(rnd() * 40) * 100 : null,
      inFence: rnd() > 0.15,
      remarks: null,
      sample: true,
    });
  }
  return out;
}

export function productTally(visits: Visit[]) {
  const m = new Map<
    string,
    {
      times: number;
      last: string;
      feedback: Visit['products'][number]['feedback'];
      samples: number;
    }
  >();
  for (const v of [...visits].reverse()) {
    for (const p of v.products) {
      const e = m.get(p.productId) ?? { times: 0, last: v.date, feedback: null, samples: 0 };
      m.set(p.productId, {
        ...e,
        times: e.times + 1,
        last: v.date,
        feedback: p.feedback ?? e.feedback,
      });
    }
    for (const s of v.samples) {
      const e = m.get(s.productId) ?? { times: 0, last: v.date, feedback: null, samples: 0 };
      m.set(s.productId, { ...e, samples: e.samples + s.quantity });
    }
  }
  return [...m.entries()]
    .map(([productId, e]) => ({ productId, ...e }))
    .sort((a, b) => b.times - a.times || b.samples - a.samples);
}
