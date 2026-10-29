import * as z from 'zod';
import { DateOnly, Id, Timestamp } from './common';
import { DcrBand, DcrDetails, DcrSfcRouteChoice, DcrSfcSource } from './dcr-parts';
import { Dcr, DcrCallInput } from './field';
import { Product } from './products';
import { SfcCategory, SfcTravelMode } from './sfc';

export * from './dcr-parts';

/** DCR redesign endpoints under /v1/dcrs (docs/DCR-REDESIGN-DESIGN.md). */

export const DcrOptionsQuery = z.object({ date: DateOnly }).meta({ id: 'DcrOptionsQuery' });
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
    products: z.array(DcrProductOption).default([]).meta({
      description: 'Active products for the call pickers, by name (imageUrl presigned, >= 30 min)',
    }),
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

export const DcrWorkWithQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
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
    calls: z.array(DcrCallInput).max(60).default([]),
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
