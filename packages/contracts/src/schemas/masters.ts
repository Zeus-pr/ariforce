import * as z from 'zod';
import { Id, Syncable } from './common';

const GeoPoint = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
  .meta({ id: 'GeoPoint' });

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

export const Doctor = Syncable.extend({
  territoryId: Id,
  name: z.string().min(1).max(160),
  qualification: z.string().max(120).nullable(),
  specialtyId: Id.nullable(),
  categoryId: Id.nullable(),
  registrationNo: z.string().max(40).nullable(),
  ...Address,
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
export const DoctorCreate = Doctor.omit(writable).meta({ id: 'DoctorCreate' });
export const DoctorUpdate = DoctorCreate.partial()
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
