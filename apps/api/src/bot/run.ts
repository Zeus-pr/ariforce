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

/** One path for this question, so the model does not choose a different one. */
export function answerShape(message: string): string {
  const s = message.toLowerCase();
  if (/^how do i\b/.test(s.trim()))
    return 'Answer from the how-to text only. Do not call a tool and do not state a figure.';
  if (/\b(sales|primary|secondary)\b/.test(s))
    return 'Sales question. Call kpi_report with rollup team unless a person or place is named. A place name is the place argument. Do not call list_team.';
  if (/\b(doing|performance|so far|quarter|year|coverage|adherence|pob)\b/.test(s))
    return 'Performance question. Call kpi_report with rollup team. Pass month as this month, this quarter, or this year. Do not call list_team.';
  if (/\b(product|detailed|detailing|samples)\b/.test(s))
    return 'Product question. Call product_kpis only.';
  if (/\b(who|people|manager)\b/.test(s) || /\b(team list|on my team|my team)\b/.test(s))
    return 'People question. Call list_team only.';
  return 'Call kpi_report with rollup team for the measure asked. Do not answer from memory.';
}

const kpiEnum = [...KPI_KEYS];

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** YYYY-MM from a month name or "last month". A month after today is last year. */
export function monthArg(value: unknown, today: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim().toLowerCase();
  if (!s) return undefined;
  const exact = s.match(/^(\d{4})-(\d{2})$/);
  if (exact) return `${exact[1]}-${exact[2]}`;
  const year = Number(today.slice(0, 4));
  const thisMonth = Number(today.slice(5, 7));
  if (s === 'this month' || s === 'current month')
    return `${year}-${String(thisMonth).padStart(2, '0')}`;
  if (s === 'last month' || s === 'previous month' || s === 'prior month') {
    const m = thisMonth === 1 ? 12 : thisMonth - 1;
    const y = thisMonth === 1 ? year - 1 : year;
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  const named = s.match(/^([a-z]+)\s*(\d{4})?$/);
  if (!named) return undefined;
  const idx = MONTHS.findIndex((name) => name.startsWith(named[1]!));
  if (idx < 0 || named[1]!.length < 3) return undefined;
  const month = idx + 1;
  const y = named[2] ? Number(named[2]) : month > thisMonth ? year - 1 : year;
  return `${y}-${String(month).padStart(2, '0')}`;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function monthEnd(year: number, month: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(last)}`;
}

/** A month, a calendar quarter, or the financial year (April–March), to date when it includes today. */
export function periodArg(
  value: unknown,
  today: string,
): { month?: string; from?: string; to?: string } {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const year = Number(today.slice(0, 4));
  const thisMonth = Number(today.slice(5, 7));
  if (
    !s ||
    s === 'this month' ||
    s === 'current month' ||
    s === 'so far' ||
    s === 'so far this month'
  )
    return { month: today.slice(0, 7) };
  if (s === 'this quarter' || s === 'quarter' || s === 'so far this quarter') {
    const startM = Math.floor((thisMonth - 1) / 3) * 3 + 1;
    return { from: `${year}-${pad(startM)}-01`, to: today };
  }
  if (s === 'last quarter' || s === 'previous quarter') {
    const startM = Math.floor((thisMonth - 1) / 3) * 3 + 1;
    const endM = startM === 1 ? 12 : startM - 1;
    const endY = startM === 1 ? year - 1 : year;
    const qStart = endM <= 2 ? endM + 10 : endM - 2;
    const qYear = endM <= 2 ? endY - 1 : endY;
    return { from: `${qYear}-${pad(qStart)}-01`, to: monthEnd(endY, endM) };
  }
  if (s === 'this year' || s === 'financial year' || s === 'fy' || s === 'so far this year') {
    const startYear = thisMonth >= 4 ? year : year - 1;
    return { from: `${startYear}-04-01`, to: today };
  }
  const month = monthArg(value, today);
  return month ? { month } : {};
}

const period = {
  month: {
    type: 'string',
    description:
      'this month, this quarter, last quarter, this year (April–March), a month name, or YYYY-MM. Omit for the current month.',
  },
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
        'People on this asker’s reporting line, including the asker. Pass a name to narrow. A headquarters such as Suri is a place, not a person: use kpi_report with place. Never returns anyone outside the line.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Part of a person’s name' } },
        additionalProperties: false,
      },
    },
    {
      name: 'kpi_report',
      description:
        'Coverage, call average, DCR compliance, tour-plan adherence, POB and sales for this line. Prefer rollup team or self. byUser is one row per person, so pass few kpis. For a headquarters or other place, pass place and month. Sales of a place use primary_sales_value and secondary_sales_value.',
      parameters: {
        type: 'object',
        properties: {
          rollup: { type: 'string', enum: rollup },
          month: period.month,
          userId: period.userId,
          place: {
            type: 'string',
            description: 'Headquarters or territory name, such as Suri. Not a person’s name.',
          },
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

export function clipNarrative(narrative: string, sentences: number): string {
  const parts = narrative.split(/(?<=[.!?])\s+(?=[A-Z])/);
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, sentences)
    .join(' ');
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
      content: `${input.knowledge}\n\n${input.scopeLine}\n\n${answerShape(input.message)}\n\nReply with only {"narrative":"..."}. At most two sentences. Use only names and numbers a tool returned. Do not explain, recommend, or add a cause.`,
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
  return {
    ...guarded,
    narrative: guarded.refused
      ? guarded.narrative
      : clipNarrative(guarded.narrative, toolNames.length ? 2 : 4),
    blocks: blocks.slice(0, 6),
    toolNames,
  };
}
