import * as z from 'zod';

export const BotAskRequest = z
  .object({
    message: z.string().trim().min(1).max(1000),
  })
  .meta({ id: 'BotAskRequest' });

export const BotTableBlock = z
  .object({
    type: z.literal('table'),
    title: z.string(),
    columns: z.array(z.string()).max(8),
    rows: z.array(z.array(z.string()).max(8)).max(40),
  })
  .meta({ id: 'BotTableBlock' });

export const BotAskResponse = z
  .object({
    narrative: z.string(),
    blocks: z.array(BotTableBlock).max(6),
    refused: z.boolean(),
  })
  .meta({ id: 'BotAskResponse' });

export type BotAskResponse = z.infer<typeof BotAskResponse>;
