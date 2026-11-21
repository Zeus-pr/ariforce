import * as z from 'zod';
import { Id, Month } from './common';

export const StockStatementStatus = z
  .enum(['draft', 'pending', 'approved', 'rejected'])
  .meta({ id: 'StockStatementStatus' });

const qty = z.number().int().min(0).max(1_000_000);
const money = z.number().nullable();

export const StockStatementLineInput = z
  .object({
    productId: Id,
    /** Null keeps the opening blank. Ignored when the opening was carried forward. */
    openingQty: qty.nullable(),
    purchaseQty: qty,
    freeQty: qty.default(0),
    secondaryQty: qty,
    frsQty: qty,
  })
  .meta({ id: 'StockStatementLineInput' });

export const StockStatementLine = z
  .object({
    productId: Id,
    name: z.string(),
    packSize: z.string().nullable(),
    pts: z.number().nullable(),
    openingQty: qty.nullable(),
    openingLocked: z.boolean(),
    purchaseQty: qty,
    freeQty: qty,
    secondaryQty: qty,
    frsQty: qty,
    openingValue: money,
    purchaseValue: money,
    freeValue: money,
    secondaryValue: money,
    frsValue: money,
    closingQty: z.number().int().nullable(),
    closingValue: money,
  })
  .meta({ id: 'StockStatementLine' });

export const StockStatementTotals = z
  .object({
    openingQty: z.number().int(),
    openingValue: z.number(),
    purchaseQty: z.number().int(),
    purchaseValue: z.number(),
    freeQty: z.number().int(),
    freeValue: z.number(),
    secondaryQty: z.number().int(),
    secondaryValue: z.number(),
    closingQty: z.number().int(),
    closingValue: z.number(),
    frsQty: z.number().int(),
    frsValue: z.number(),
    actualSecondary: z.number(),
  })
  .meta({ id: 'StockStatementTotals' });

export const StockStatementFile = z
  .object({
    status: z.enum(['pending', 'confirmed']).nullable(),
    contentType: z.string().nullable(),
  })
  .meta({ id: 'StockStatementFile' });

export const StockStatementHistoryItem = z
  .object({
    id: Id,
    stockistId: Id,
    stockistName: z.string(),
    month: Month,
    status: StockStatementStatus,
    actualSecondary: z.number(),
    submittedByName: z.string().nullable(),
  })
  .meta({ id: 'StockStatementHistoryItem' });

export const StockStatement = z
  .object({
    id: Id,
    stockistId: Id,
    stockistName: z.string(),
    address: z.string().nullable(),
    month: Month,
    status: StockStatementStatus,
    version: z.number().int(),
    editable: z.boolean(),
    canSubmit: z.boolean(),
    canDecide: z.boolean(),
    approvalRequestId: Id.nullable(),
    rejectionReason: z.string().nullable(),
    currentApproverName: z.string().nullable(),
    totals: StockStatementTotals,
    lines: z.array(StockStatementLine),
    aws: StockStatementFile,
    ss: StockStatementFile,
    history: z.array(StockStatementHistoryItem),
  })
  .meta({ id: 'StockStatement' });

export const StockStatementOpen = z
  .object({
    stockistId: Id,
    month: Month,
  })
  .meta({ id: 'StockStatementOpen' });

export const StockStatementSave = z
  .object({
    version: z.number().int().positive(),
    lines: z.array(StockStatementLineInput).min(1).max(2000),
  })
  .meta({ id: 'StockStatementSave' });

export const StockStatementSubmit = z
  .object({ version: z.number().int().positive() })
  .meta({ id: 'StockStatementSubmit' });

export const StockStatementListQuery = z
  .object({
    stockistId: Id.optional(),
    status: StockStatementStatus.optional(),
    /** pending statements waiting on the caller */
    waiting: z.enum(['true', 'false']).optional(),
  })
  .meta({ id: 'StockStatementListQuery' });

export const StockStatementList = z
  .object({ items: z.array(StockStatementHistoryItem) })
  .meta({ id: 'StockStatementList' });

export const StockStatementStockist = z
  .object({
    id: Id,
    name: z.string(),
    city: z.string().nullable(),
  })
  .meta({ id: 'StockStatementStockist' });

export const StockStatementStockists = z
  .object({ items: z.array(StockStatementStockist) })
  .meta({ id: 'StockStatementStockists' });

export const StockStatementFileRequest = z
  .object({
    kind: z.enum(['aws', 'ss']),
    contentType: z.enum([
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel.sheet.macroEnabled.12',
    ]),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .meta({ id: 'StockStatementFileRequest' });

export const StockStatementFileConfirm = z
  .object({ kind: z.enum(['aws', 'ss']) })
  .meta({ id: 'StockStatementFileConfirm' });

export type StockStatement = z.infer<typeof StockStatement>;
export type StockStatementSave = z.infer<typeof StockStatementSave>;
export type StockStatementLineInput = z.infer<typeof StockStatementLineInput>;
export type StockStatementFileBody = z.infer<typeof StockStatementFileRequest>;
