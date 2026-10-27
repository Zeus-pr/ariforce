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

export const DoctorApprovalStatus = z.enum(['pending', 'approved', 'rejected']).meta({
  description:
    'Field-added doctors start pending until their manager decides (#26); company-wide roles add approved doctors. Read-only.',
});
export const Doctor = Syncable.extend({
  territoryId: Id,
  name: z.string().min(1).max(160),
  qualification: z.string().max(120).nullable(),
  specialtyId: Id.nullable(),
  categoryId: Id.nullable(),
  registrationNo: z.string().max(40).nullable(),
  ...Address,
  approvalStatus: DoctorApprovalStatus,
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
  name: z.string().min(1).max(160),
  gstin: z.string().max(15).nullable(),
  drugLicenseNo: z.string().max(60).nullable(),
  ...Address,
}).meta({ id: 'Chemist' });
export type Chemist = z.infer<typeof Chemist>;

export const Stockist = Chemist.extend({}).meta({ id: 'Stockist' });
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
  approvalStatus: true,
  rejectionReason: true,
  rejectedBy: true,
  rejectedAt: true,
});
export const DoctorCreate = DoctorFields.extend({
  allowPossibleDuplicate: z.boolean().optional().meta({
    description:
      'Create even when a doctor with the same name (without "Dr.") and pincode exists (409 DOCTOR_POSSIBLE_DUPLICATE). A registration number match can never be overridden.',
  }),
}).meta({ id: 'DoctorCreate' });
export const DoctorUpdate = DoctorFields.partial()
  .extend({ version: z.int().min(1) })
  .meta({ id: 'DoctorUpdate' });
export const ChemistCreate = Chemist.omit(writable).meta({ id: 'ChemistCreate' });
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
export const DoctorListQuery = listQuery(['name', 'city', 'updatedAt', 'createdAt'] as const, {
  territoryId: territoryFilter,
  specialtyId: Id.optional(),
  categoryId: Id.optional(),
  approvalStatus: DoctorApprovalStatus.optional(),
  ids: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){0,99}$/i,
      'ids: 1..100 comma-separated UUIDs',
    )
    .optional()
    .meta({
      description:
        'Batch fetch: comma-separated doctor ids (max 100). Only doctors you can read are returned; others are silently absent. Pass limit=100 to get all in one page.',
    }),
});
export const OutletListQuery = listQuery(['name', 'city', 'updatedAt', 'createdAt'] as const, {
  territoryId: territoryFilter,
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
