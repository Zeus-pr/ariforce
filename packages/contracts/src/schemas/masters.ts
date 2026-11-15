import * as z from 'zod';
import { GeoPoint, Id, Syncable, Timestamp, UserRef, listQuery } from './common';

export const Specialty = Syncable.extend({
  code: z.string().max(32),
  name: z.string().max(120),
}).meta({ id: 'Specialty' });
export type Specialty = z.infer<typeof Specialty>;

export const DoctorCategory = Syncable.extend({
  code: z.string().max(32),
  name: z.string().max(120),
  visitsPerMonth: z.int().min(0).max(31),
}).meta({ id: 'DoctorCategory' });
export type DoctorCategory = z.infer<typeof DoctorCategory>;

const Address = {
  addressLine: z.string().max(300).nullable(),
  city: z.string().max(80).nullable(),
  state: z.string().max(80).nullable(),
  pincode: z
    .string()
    .regex(/^[1-9][0-9]{5}$/)
    .nullable(),
  location: GeoPoint.nullable(),
  phone: z.string().max(20).nullable(),
};

/** Calendar day stored as text (doctors.date_of_birth / anniversary). Omit or null when unknown. */
const IsoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a real date (YYYY-MM-DD).')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'Use a real date (YYYY-MM-DD).')
  .nullable()
  .default(null);

export const DoctorApprovalStatus = z.enum(['pending', 'approved', 'rejected']).meta({
  description:
    'Field-added doctors start pending until their manager decides (#26); company-wide roles add approved doctors. Read-only.',
});
const localTerritoryId = Id.nullable().default(null).meta({
  description:
    'Territory (level `territory`) under the HQ `territoryId`, or null when not linked yet. Read-only: set by POST /v1/imports/territory-links; cleared when territoryId (the HQ) changes. docs/TERRITORY-MODEL.md',
});

export const Doctor = Syncable.extend({
  territoryId: Id,
  localTerritoryId,
  name: z.string().min(1).max(160),
  qualification: z.string().max(120).nullable(),
  specialtyId: Id.nullable(),
  categoryId: Id.nullable(),
  registrationNo: z.string().max(40).nullable(),
  dateOfBirth: IsoDay.nullable(),
  anniversary: IsoDay.nullable(),
  email: z.email().max(160).nullable(),
  ...Address,
  approvalStatus: DoctorApprovalStatus,
  maxActiveLocks: z.int().min(1).max(5).default(1).meta({
    description:
      'Active GPS pins this doctor may have. Default 1. ABM and above, and system admin, set 1–5 on the lock card. A deactivated pin does not count. Read-only here.',
  }),
  rejectionReason: z.string().nullable().optional().meta({
    description:
      'Latest rejection reason while approvalStatus is rejected; only for the adder, their reporting line, the approvers and company-wide roles (else null). Read-only.',
  }),
  rejectedBy: UserRef.nullable().optional().meta({ description: 'Who rejected it. Read-only.' }),
  rejectedAt: Timestamp.nullable().optional().meta({ description: 'When. Read-only.' }),
}).meta({ id: 'Doctor' });
export type Doctor = z.infer<typeof Doctor>;

export const Chemist = Syncable.extend({
  territoryId: Id,
  localTerritoryId,
  name: z.string().min(1).max(160),
  gstin: z.string().max(15).nullable(),
  drugLicenseNo: z.string().max(60).nullable(),
  ...Address,
}).meta({ id: 'Chemist' });
export type Chemist = z.infer<typeof Chemist>;

/** Stockists have the DB column (0042) but are not linked yet (TERRITORY-MODEL.md: later). */
export const Stockist = Chemist.omit({ localTerritoryId: true }).meta({ id: 'Stockist' });
export type Stockist = z.infer<typeof Stockist>;

const writable = {
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  version: true,
} as const;
const DoctorFields = Doctor.omit({
  ...writable,
  localTerritoryId: true,
  approvalStatus: true,
  maxActiveLocks: true,
  rejectionReason: true,
  rejectedBy: true,
  rejectedAt: true,
});
export const DoctorCreate = DoctorFields.extend({
  dateOfBirth: IsoDay.nullable().default(null),
  anniversary: IsoDay.nullable().default(null),
  email: z.email().max(160).nullable().default(null),
  allowPossibleDuplicate: z.boolean().optional().meta({
    description:
      'Create even when a doctor with the same name (without "Dr.") and pincode exists (409 DOCTOR_POSSIBLE_DUPLICATE). A registration number match can never be overridden.',
  }),
}).meta({ id: 'DoctorCreate' });
export const DoctorUpdate = DoctorFields.partial()
  .extend({ version: z.int().min(1) })
  .meta({ id: 'DoctorUpdate' });
export const ChemistCreate = Chemist.omit({ ...writable, localTerritoryId: true }).meta({
  id: 'ChemistCreate',
});
export const ChemistUpdate = ChemistCreate.partial()
  .extend({ version: z.int().min(1) })
  .meta({ id: 'ChemistUpdate' });
export const StockistCreate = Stockist.omit(writable).meta({ id: 'StockistCreate' });
export const StockistUpdate = StockistCreate.partial()
  .extend({ version: z.int().min(1) })
  .meta({ id: 'StockistUpdate' });
export type DoctorCreate = z.infer<typeof DoctorCreate>;
export type DoctorUpdate = z.infer<typeof DoctorUpdate>;
export type ChemistCreate = z.infer<typeof ChemistCreate>;
export type ChemistUpdate = z.infer<typeof ChemistUpdate>;
export type StockistCreate = z.infer<typeof StockistCreate>;
export type StockistUpdate = z.infer<typeof StockistUpdate>;

const territoryFilter = Id.optional().meta({
  description: 'Only rows in this territory or any descendant (within the caller scope)',
});
const localTerritoryFilter = z
  .union([Id, z.literal('none')])
  .optional()
  .meta({
    description:
      'Only rows linked to this territory (level `territory`, exact match), or `none` for rows not linked to any territory',
  });
const batchIds = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){0,99}$/i,
    'ids: 1..100 comma-separated UUIDs',
  )
  .optional()
  .meta({
    description:
      'Batch fetch: comma-separated ids (max 100). Only rows the caller can read are returned; others are absent. Pass limit=100 to get all in one page.',
  });
/** Shared `ids=` batch param (1..100 comma-separated UUIDs). */
export const BatchIds = batchIds;
export const DoctorListQuery = listQuery(['name', 'city', 'updatedAt', 'createdAt'] as const, {
  territoryId: territoryFilter,
  localTerritoryId: localTerritoryFilter,
  specialtyId: Id.optional(),
  categoryId: Id.optional(),
  approvalStatus: DoctorApprovalStatus.optional(),
  ids: batchIds,
});
export const OutletListQuery = listQuery(['name', 'city', 'updatedAt', 'createdAt'] as const, {
  territoryId: territoryFilter,
  ids: batchIds,
});
export const ChemistListQuery = listQuery(['name', 'city', 'updatedAt', 'createdAt'] as const, {
  territoryId: territoryFilter,
  localTerritoryId: localTerritoryFilter,
  ids: batchIds,
});
export const CodeNameListQuery = listQuery(['code', 'name', 'updatedAt'] as const, {});

// ---- Doctor duplicates (#26) ----
export const DoctorDuplicateCheck = z
  .object({
    name: z.string().min(1).max(160),
    pincode: z
      .string()
      .regex(/^[1-9][0-9]{5}$/)
      .nullish(),
    registrationNo: z.string().max(40).nullish(),
  })
  .meta({ id: 'DoctorDuplicateCheck' });
export type DoctorDuplicateCheck = z.infer<typeof DoctorDuplicateCheck>;
export const DoctorDuplicate = z
  .object({
    id: Id,
    name: z.string(),
    territoryId: Id,
    territoryName: z.string(),
    rule: z.enum(['registration_no', 'name_pincode']),
    approvalStatus: DoctorApprovalStatus,
  })
  .meta({ id: 'DoctorDuplicate' });
export type DoctorDuplicate = z.infer<typeof DoctorDuplicate>;
export const DoctorDuplicateResult = z
  .object({ matches: z.array(DoctorDuplicate) })
  .meta({ id: 'DoctorDuplicateResult' });
