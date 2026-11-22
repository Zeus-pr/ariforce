import { KPI_KEYS } from '@ariforce/contracts';

export interface BotTable {
  type: 'table';
  title: string;
  columns: string[];
  rows: string[][];
}

export interface ToolOutcome {
  model: unknown;
  block: BotTable | null;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export interface AssistantMsg {
  content: string | null;
  tool_calls?: ToolCall[];
}

export type ChatMsg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

const ROUNDS = 3;
const NUM = /\d+(?:\.\d+)?/g;
const HEAVY = /\b(?:why|compare|compared|comparison|versus|vs\.?|difference|trend)\b/i;

/** One choice, before any model call. A lookup stays on 4.3. */
export function modelFor(message: string): 'grok-4.3' | 'grok-4.7' {
  if (HEAVY.test(message)) return 'grok-4.7';
  const months = message.match(/\b20\d{2}-\d{2}\b/g);
  if (months && new Set(months).size > 1) return 'grok-4.7';
  if (/\bthis month\b/i.test(message) && /\b(?:last|previous|prior) month\b/i.test(message))
    return 'grok-4.7';
  return 'grok-4.3';
}

const kpiEnum = [...KPI_KEYS];

const period = {
  month: { type: 'string', description: 'YYYY-MM. Omit for the current month.' },
  userId: { type: 'string', description: 'Id from list_team. Omit for the asker.' },
};

export function toolSpecs(director: boolean): ToolSpec[] {
  const rollup = director
    ? ['self', 'team', 'byUser', 'byTerritory', 'company']
    : ['self', 'team', 'byUser', 'byTerritory'];
  return [
    {
      name: 'list_team',
      description:
        'People on this asker’s reporting line, including the asker. Pass a name to narrow. Never returns anyone outside the line.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Part of a person’s name' } },
        additionalProperties: false,
      },
    },
    {
      name: 'kpi_report',
      description:
        'Coverage, call average, DCR compliance, tour-plan adherence, POB and sales for this line. Prefer rollup team or self. byUser is one row per person, so pass few kpis.',
      parameters: {
        type: 'object',
        properties: {
          rollup: { type: 'string', enum: rollup },
          month: period.month,
          userId: period.userId,
          kpis: { type: 'array', items: { type: 'string', enum: kpiEnum } },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'product_kpis',
      description: 'Detailing, samples and POB by product, for this line only.',
      parameters: {
        type: 'object',
        properties: { month: period.month, userId: period.userId },
        additionalProperties: false,
      },
    },
  ];
}

/** Drops a narrative that cites a number no tool and no knowledge text returned. */
export function guardNarrative(
  narrative: string,
  allowedText: string,
  hasBlock: boolean,
): { narrative: string; refused: boolean } {
  const allowed = new Set(allowedText.match(NUM) ?? []);
  const bad = (narrative.match(NUM) ?? []).filter((n) => !allowed.has(n));
  const email = narrative.match(/[^\s@]+@[^\s@]+\.[^\s@]+/g) ?? [];
  if (email.some((address) => !allowedText.includes(address)))
    return { narrative: 'I can’t answer that from AriForce.', refused: true };
  if (bad.length === 0) return { narrative, refused: false };
  if (hasBlock) return { narrative: 'The figures are in the table.', refused: false };
  return { narrative: 'I can’t answer that from AriForce.', refused: true };
}

function narrativeFrom(content: string | null): string {
  const raw = (content ?? '').trim();
  const fenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(fenced) as { narrative?: unknown };
    if (typeof parsed.narrative === 'string') return parsed.narrative.trim();
  } catch {
    // The model replied in prose. The number guard still applies.
  }
  return raw;
}

export async function runBot(input: {
  knowledge: string;
  scopeLine: string;
  message: string;
  specs: ToolSpec[];
  call: (name: string, args: unknown) => Promise<ToolOutcome>;
  complete: (messages: ChatMsg[], tools: ToolSpec[] | null) => Promise<AssistantMsg>;
}): Promise<{ narrative: string; blocks: BotTable[]; refused: boolean; toolNames: string[] }> {
  const messages: ChatMsg[] = [
    {
      role: 'system',
      content: `${input.knowledge}\n\n${input.scopeLine}\n\nWhen you are ready to answer, reply with only {"narrative":"..."}.`,
    },
    { role: 'user', content: input.message },
  ];
  const blocks: BotTable[] = [];
  const toolNames: string[] = [];
  const allowed: string[] = [input.knowledge];

  let reply = await input.complete(messages, input.specs);
  for (let round = 0; round < ROUNDS && reply.tool_calls?.length; round += 1) {
    messages.push({ role: 'assistant', content: reply.content, tool_calls: reply.tool_calls });
    for (const call of reply.tool_calls) {
      toolNames.push(call.function.name);
      let args: unknown;
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }
      const outcome = await input.call(call.function.name, args);
      if (outcome.block) blocks.push(outcome.block);
      const body = JSON.stringify(outcome.model).slice(0, 12_000);
      allowed.push(body);
      messages.push({ role: 'tool', tool_call_id: call.id, content: body });
    }
    reply = await input.complete(messages, input.specs);
  }

  if (reply.tool_calls?.length) {
    messages.push({ role: 'user', content: 'Reply with the JSON narrative now.' });
    reply = await input.complete(messages, null);
  }

  const guarded = guardNarrative(
    narrativeFrom(reply.content),
    allowed.join('\n'),
    blocks.length > 0,
  );
  return { ...guarded, blocks: blocks.slice(0, 6), toolNames };
}
