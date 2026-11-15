import * as z from 'zod';
import { DateOnly, Id, Timestamp } from './common';

export const Holiday = z
  .object({
    id: Id,
    date: DateOnly,
    name: z.string(),
    version: z.int(),
    updatedAt: Timestamp,
  })
  .meta({ id: 'Holiday' });
export type Holiday = z.infer<typeof Holiday>;

export const HolidayList = z.object({ items: z.array(Holiday) }).meta({ id: 'HolidayList' });

export const HolidayQuery = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    from: DateOnly.optional(),
    to: DateOnly.optional(),
  })
  .meta({ id: 'HolidayQuery' });
export type HolidayQueryInput = z.infer<typeof HolidayQuery>;

const HolidayName = z.string().trim().min(1).max(80);

export const HolidayCreate = z
  .object({ date: DateOnly, name: HolidayName })
  .meta({ id: 'HolidayCreate' });
export type HolidayCreate = z.infer<typeof HolidayCreate>;

export const HolidayUpdate = z
  .object({ version: z.int().min(1), name: HolidayName })
  .meta({ id: 'HolidayUpdate' });
export type HolidayUpdate = z.infer<typeof HolidayUpdate>;

export const HolidayCopy = z
  .object({
    fromYear: z.int().min(2000).max(2099),
    toYear: z.int().min(2000).max(2100),
  })
  .meta({ id: 'HolidayCopy' });
export type HolidayCopy = z.infer<typeof HolidayCopy>;

export const HolidayCopyResult = z
  .object({
    copied: z.int(),
    skipped: z.array(z.object({ date: DateOnly, reason: z.string() })),
  })
  .meta({ id: 'HolidayCopyResult' });
export type HolidayCopyResult = z.infer<typeof HolidayCopyResult>;
