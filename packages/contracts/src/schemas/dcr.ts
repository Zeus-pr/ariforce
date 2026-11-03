import * as z from 'zod';
import { DateOnly, Id, Timestamp } from './common';
import { DcrBand, DcrDetails, DcrExpenses, DcrSfcRouteChoice, DcrSfcSource } from './dcr-parts';
import { Dcr, DcrCallInput } from './field';
import { TourPlanItem } from './tp-items';
import { Product } from './products';
import { SfcCategory, SfcTravelMode } from './sfc';
import { BatchIds } from './masters';

export * from './dcr-parts';

/** DCR redesign endpoints under /v1/dcrs (docs/DCR-REDESIGN-DESIGN.md). */

export const DcrOptionsQuery = z
  .object({
    date: DateOnly,
    includeProducts: z.enum(['true', 'false']).optional().meta({
      description:
        'Default `true` (unchanged). Pass `false` to skip the deprecated products/detailProducts (returned as []); load them from GET /v1/dcrs/products instead',
    }),
  })
  .meta({ id: 'DcrOptionsQuery' });
export const DcrWorkTypeOption = z
  .object({
    id: Id,
    code: z.string(),
    name: z.string(),
    kind: z.enum(['field', 'non_field', 'leave', 'holiday']),
    band: DcrBand.nullable().meta({ description: 'Field work types only' }),
    usesSfc: z.boolean().meta({ description: 'true for field work types; Meeting never' }),
    detailsKind: z
      .enum(['meeting', 'training', 'office', 'leave'])
      .nullable()
      .meta({ description: 'Required details.kind on submit; null = no details' }),
  })
  .meta({ id: 'DcrWorkTypeOption' });
/** Product for the DCR pickers (detailing, samples, POB). POB is priced at pts. */
export const DcrProductOption = Product.pick({
  id: true,
  divisionId: true,
  code: true,
  name: true,
  displayName: true,
  brand: true,
  composition: true,
  packSize: true,
  form: true,
  mrp: true,
  pts: true,
  isSample: true,
  imageFileKey: true,
  imageUrl: true,
}).meta({ id: 'DcrProductOption' });
export type DcrProductOption = z.infer<typeof DcrProductOption>;

/** An approved tour plan item as a DCR draft card (one card per item, one DCR per day). */
export const DcrTourPlanDraft = TourPlanItem.extend({
  pendingDates: z.array(DateOnly).meta({
    description:
      'Unfiled days from today (IST) on; the card is listed only while this is non-empty',
  }),
  draftDates: z.array(DateOnly).meta({ description: 'pendingDates that already have a DCR draft' }),
  fileableDates: z.array(DateOnly).meta({
    description:
      'Days that can be submitted now (today only). Future pendingDates accept drafts (with tourPlanItemId) but not submit',
  }),
}).meta({ id: 'DcrTourPlanDraft' });
export type DcrTourPlanDraft = z.infer<typeof DcrTourPlanDraft>;

/** Doctor detailing picker entry: one per displayName (all strengths of a product together). */
export const DcrDetailProduct = z
  .object({
    displayName: z.string().meta({ example: 'ARIPIX' }),
    productId: Id.meta({
      description:
        'SKU to store in productsDetailed for this entry: the first SKU (A-Z by name) that has a picture, else the first SKU',
    }),
    productIds: z
      .array(Id)
      .min(1)
      .meta({ description: 'All active SKUs (strengths) of this displayName, A-Z by name' }),
    composition: z.string().nullable().meta({ description: "productId's composition" }),
    imageFileKey: z.string().nullable(),
    imageUrl: z.url().nullable().meta({ description: "productId's picture (presigned), or null" }),
  })
  .meta({ id: 'DcrDetailProduct' });
export type DcrDetailProduct = z.infer<typeof DcrDetailProduct>;

/** Groups product options (already A-Z) into doctor-detailing entries, keeping the input order. */
export function groupDetailProducts(items: DcrProductOption[]): DcrDetailProduct[] {
  const groups = new Map<string, DcrProductOption[]>();
  for (const p of items) groups.set(p.displayName, [...(groups.get(p.displayName) ?? []), p]);
  return [...groups].map(([displayName, skus]) => {
    const primary = skus.find((s) => s.imageFileKey) ?? skus[0]!;
    return {
      displayName,
      productId: primary.id,
      productIds: skus.map((s) => s.id),
      composition: primary.composition,
      imageFileKey: primary.imageFileKey,
      imageUrl: primary.imageUrl,
    };
  });
}

/** GET /v1/dcrs/products: the DCR product pickers on their own (cacheable, ETag). */
export const DcrProductsQuery = z
  .object({
    ids: BatchIds.meta({
      description:
        'Batch fetch: comma-separated product ids (max 100). Only active products are returned; others are absent. detailProducts groups only the returned SKUs',
    }),
  })
  .meta({ id: 'DcrProductsQuery' });
export const DcrProducts = z
  .object({
    products: z.array(DcrProductOption).meta({
      description:
        'Active products for the call pickers, A-Z by name (imageUrl presigned, >= 30 min)',
    }),
    detailProducts: z.array(DcrDetailProduct).meta({
      description:
        'Doctor detailing picker: products[] grouped by displayName (strength stripped), A-Z; store productId in productsDetailed',
    }),
    etag: z.string().meta({
      description:
        'Same value as the ETag header. Send it back as If-None-Match to get 304 while products and image URLs are unchanged',
    }),
  })
  .meta({ id: 'DcrProducts' });
export type DcrProducts = z.infer<typeof DcrProducts>;
export const DcrProductsHeaders = z.object({
  'if-none-match': z
    .string()
    .max(512)
    .optional()
    .meta({ description: 'ETag from an earlier response; 304 (empty body) when unchanged' }),
});

export const DcrOptions = z
  .object({
    date: DateOnly,
    workTypes: z.array(DcrWorkTypeOption),
    dcr: Dcr.nullable().meta({
      description:
        'Your report for the date: the submitted one, else the latest draft (kept for older clients)',
    }),
    submitted: Dcr.nullable()
      .default(null)
      .meta({ description: 'Your submitted report for the date (at most one per day), if any' }),
    drafts: z
      .array(Dcr)
      .default([])
      .meta({ description: 'Your drafts for the date, newest first (several allowed per day)' }),
    rejected: z.array(Dcr).default([]).meta({
      description:
        'Your manager-rejected reports for the date, newest first (history; rejectionReason set)',
    }),
    unlockRequest: z
      .object({
        id: Id,
        status: z.enum(['pending', 'approved', 'rejected', 'cancelled']),
        requestedAt: Timestamp,
      })
      .nullable()
      .default(null)
      .meta({
        description:
          "Your latest dcr_unlock (correction) request for this date, or null; drives the 'Unlock requested' state",
      }),
    tourPlanDrafts: z.array(DcrTourPlanDraft).default([]).meta({
      description:
        'Approved tour plan cards (independent of the query date), by from. Shown until no pending day is today or later (i.e. hidden once the last pending day locks at 00:00 IST)',
    }),
    detailProducts: z.array(DcrDetailProduct).default([]).meta({
      deprecated: true,
      description:
        'Deprecated: use GET /v1/dcrs/products. [] when includeProducts=false. Doctor detailing picker: products[] grouped by displayName (strength stripped), A-Z; store productId in productsDetailed',
    }),
    products: z.array(DcrProductOption).default([]).meta({
      deprecated: true,
      description:
        'Deprecated: use GET /v1/dcrs/products. [] when includeProducts=false. Active products for the call pickers, by name (imageUrl presigned, >= 30 min)',
    }),
    autoExpenseOnDcrSubmit: z.boolean().default(false).meta({
      description:
        'Company setting: the server drafts TA/DA expense lines on DCR submit (submit response expenseDraft). Clients switch off client-side drafting when true; absent (older API) = false',
    }),
    /** Day lock clock. Always present, even with no DCR. */
    lockAt: Timestamp.optional(),
    /** End of an approved unlock window; null when locked or never unlocked. */
    unlockedUntil: Timestamp.nullable().optional(),
    /** True when past lockAt and not inside an unlock window. */
    locked: z.boolean().optional(),
  })
  .meta({ id: 'DcrOptions' });
export type DcrOptions = z.infer<typeof DcrOptions>;

export const DcrTerritoryOption = z
  .object({ id: Id, code: z.string(), name: z.string() })
  .meta({ id: 'DcrTerritoryOption' });
export const DcrHqOption = z
  .object({
    id: Id,
    code: z.string(),
    name: z.string(),
    territories: z
      .array(DcrTerritoryOption)
      .meta({ description: "Level 'territory' under this HQ" }),
  })
  .meta({ id: 'DcrHqOption' });
export const DcrHqOptionList = z
  .object({ items: z.array(DcrHqOption) })
  .meta({ id: 'DcrHqOptionList' });

const IdList = z
  .string()
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  )
  .pipe(z.array(Id).min(1).max(20))
  .meta({ description: 'Comma-separated territory ids (HQ and/or territory level)' });
const WorkWithIds = IdList.meta({
  description: 'Comma-separated user ids to resolve saved Work With selections',
});

export const DcrWorkWithQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    ids: WorkWithIds.optional(),
  })
  .meta({ id: 'DcrWorkWithQuery' });
export const DcrWorkWithUser = z
  .object({
    id: Id,
    name: z.string(),
    employeeCode: z.string().nullable(),
    designation: z.string().nullable(),
  })
  .meta({ id: 'DcrWorkWithUser' });
export const DcrWorkWithList = z
  .object({ items: z.array(DcrWorkWithUser) })
  .meta({ id: 'DcrWorkWithList' });

export const DcrSfcMatchQuery = z
  .object({ date: DateOnly, workTypeId: Id, territoryIds: IdList })
  .meta({ id: 'DcrSfcMatchQuery' });
export const DcrSfcCandidate = z
  .object({
    id: Id,
    fromPlace: z.string(),
    toPlace: z.string(),
    oneWayKm: z.number(),
    bothWayKm: z.number(),
    oneWayAmount: z.number().nullable(),
    bothWayAmount: z.number().nullable(),
    actualFare: z.boolean(),
    travelMode: SfcTravelMode.nullable(),
    category: SfcCategory,
    band: DcrBand,
    da: z.number().nullable(),
    version: z.int(),
    source: DcrSfcSource.optional().meta({
      description: "own = the filer's route; hq = HQ fallback (filer has no live route on that HQ)",
    }),
  })
  .meta({ id: 'DcrSfcCandidate' });
export const DcrSfcHqMatch = z
  .object({
    hqTerritoryId: Id,
    hqName: z.string(),
    candidates: z.array(DcrSfcCandidate),
    autoSelectedId: Id.nullable().meta({ description: 'Set when exactly one candidate matches' }),
  })
  .meta({ id: 'DcrSfcHqMatch' });
export const DcrSfcMatch = z.object({ band: DcrBand, hqs: z.array(DcrSfcHqMatch) }).meta({
  id: 'DcrSfcMatch',
  description:
    "Candidates per HQ of the day (HQ + band): the filer's own routes on an HQ where they have any, else that HQ's routes from any owner (source 'hq', de-duplicated). 404 SFC_NO_MATCH lists the same per-HQ result in details when any HQ has none.",
});
export type DcrSfcMatch = z.infer<typeof DcrSfcMatch>;

export const DcrDraftPut = z
  .object({
    id: Id.optional().meta({
      description:
        'Draft to update (yours, still a draft, same date). Omit to create a new draft; omitting id but sending version updates the latest draft of the date (older clients)',
    }),
    date: DateOnly,
    workTypeId: Id,
    band: DcrBand.optional().meta({ description: 'Optional; must equal the work type band' }),
    territoryIds: z.array(Id).max(20).default([]),
    workWithUserIds: z.array(Id).max(20).default([]),
    sfcRoutes: z
      .array(DcrSfcRouteChoice)
      .max(20)
      .optional()
      .meta({ description: 'One per HQ of the day (field only). Omit to keep the saved choices' }),
    details: DcrDetails.nullable().optional(),
    deviationReason: z.string().max(500).nullable().optional(),
    tourPlanItemId: Id.nullable().optional().meta({
      description:
        'The approved TourPlanItem this day is filed from. The date must lie in its from..to and it must be yours and approved, else 422 VALIDATION (details.reason TOUR_PLAN_ITEM_MISMATCH). With it, a future date in the range may be drafted (submit still opens on the day). Omitted: the server links the approved item covering the date, if any. No deviation reason is ever required',
    }),
    calls: z.array(DcrCallInput).max(60).default([]),
    expenses: DcrExpenses.optional().meta({
      description:
        'Day expenses (any work type), replaces the saved list. Omit to keep it. Categories travel/hotel/food/other (else 422 DCR_EXPENSE_CATEGORY_INVALID); item ids unique (422 VALIDATION)',
    }),
    version: z.int().min(1).optional().meta({ description: 'Row version from the last read' }),
  })
  .meta({ id: 'DcrDraftPut' });
export type DcrDraftPut = z.infer<typeof DcrDraftPut>;

export const DcrSubmit = z.object({ version: z.int().min(1) }).meta({ id: 'DcrSubmit' });
export const DcrSubmitHeaders = z.object({
  'idempotency-key': z
    .string()
    .min(1)
    .max(128)
    .meta({ description: 'Required. Same key after success returns the submitted DCR (200)' }),
});
