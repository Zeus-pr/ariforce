import type { CheckIn, Dcr } from '@ariforce/contracts';

export type Visit = {
  id: string;
  date: string; // YYYY-MM-DD
  products: { productId: string; feedback: 'positive' | 'neutral' | 'negative' | null }[];
  samples: { productId: string; quantity: number }[];
  pobValue: number | null;
  inFence: boolean | null;
  remarks: string | null;
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
