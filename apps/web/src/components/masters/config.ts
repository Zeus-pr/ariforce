import {
  ChemistCreate,
  DoctorCreate,
  StockistCreate,
  type Chemist,
  type Doctor,
  type Stockist,
} from '@ariforce/contracts';
import type * as z from 'zod';

export type MasterKind = 'doctors' | 'chemists' | 'stockists';
export type MasterRow = Doctor | Chemist | Stockist;

export type FieldDef = {
  key: string;
  label: string;
  type: 'text' | 'territory' | 'specialty' | 'category' | 'tel' | 'pincode';
  required?: boolean;
  /** Header names accepted when importing a sheet (lower-cased, punctuation ignored). */
  aliases: string[];
  placeholder?: string;
};

const address: FieldDef[] = [
  {
    key: 'phone',
    label: 'Phone',
    type: 'tel',
    aliases: ['phone', 'mobile', 'contact', 'phoneno', 'mobileno'],
  },
  {
    key: 'addressLine',
    label: 'Address',
    type: 'text',
    aliases: ['address', 'addressline', 'address1'],
  },
  { key: 'city', label: 'City', type: 'text', aliases: ['city', 'town'] },
  { key: 'state', label: 'State', type: 'text', aliases: ['state'] },
  {
    key: 'pincode',
    label: 'PIN code',
    type: 'pincode',
    aliases: ['pincode', 'pin', 'postalcode', 'zip'],
  },
];

const trade: FieldDef[] = [
  {
    key: 'name',
    label: 'Name',
    type: 'text',
    required: true,
    aliases: ['name', 'firmname', 'shopname'],
  },
  {
    key: 'territoryId',
    label: 'Territory',
    type: 'territory',
    required: true,
    aliases: ['territory', 'territorycode', 'area', 'hq', 'headquarter'],
  },
  {
    key: 'gstin',
    label: 'GSTIN',
    type: 'text',
    aliases: ['gstin', 'gst', 'gstno'],
    placeholder: '19ABCDE1234F1Z5',
  },
  {
    key: 'drugLicenseNo',
    label: 'Drug licence no.',
    type: 'text',
    aliases: ['druglicenseno', 'druglicence', 'dlno', 'dl', 'druglicenceno'],
  },
  ...address,
];

export const MASTERS: Record<
  MasterKind,
  {
    title: string;
    singular: string;
    path: `/v1/${MasterKind}`;
    fields: FieldDef[];
    create: z.ZodType;
  }
> = {
  doctors: {
    title: 'Doctors',
    singular: 'doctor',
    path: '/v1/doctors',
    create: DoctorCreate,
    fields: [
      {
        key: 'name',
        label: 'Name',
        type: 'text',
        required: true,
        aliases: ['name', 'doctorname', 'drname'],
      },
      {
        key: 'territoryId',
        label: 'Territory',
        type: 'territory',
        required: true,
        aliases: ['territory', 'territorycode', 'area', 'hq', 'headquarter'],
      },
      {
        key: 'qualification',
        label: 'Qualification',
        type: 'text',
        aliases: ['qualification', 'degree'],
        placeholder: 'MBBS, MD',
      },
      {
        key: 'specialtyId',
        label: 'Specialty',
        type: 'specialty',
        aliases: ['specialty', 'speciality', 'specialization'],
      },
      {
        key: 'categoryId',
        label: 'Category',
        type: 'category',
        aliases: ['category', 'class', 'grade'],
      },
      {
        key: 'registrationNo',
        label: 'Registration no.',
        type: 'text',
        aliases: ['registrationno', 'regno', 'nmcno', 'mciregno', 'registration'],
      },
      ...address,
    ],
  },
  chemists: {
    title: 'Chemists',
    singular: 'chemist',
    path: '/v1/chemists',
    create: ChemistCreate,
    fields: trade,
  },
  stockists: {
    title: 'Stockists',
    singular: 'stockist',
    path: '/v1/stockists',
    create: StockistCreate,
    fields: trade,
  },
};

export const isMasterKind = (k: string): k is MasterKind => k in MASTERS;

/** Empty create body: every nullable field present as null, as the contract requires. */
export function blankRecord(kind: MasterKind): Record<string, string | null> {
  const out: Record<string, string | null> = { location: null };
  for (const f of MASTERS[kind].fields) out[f.key] = f.required ? '' : null;
  return out;
}

export const normHeader = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
