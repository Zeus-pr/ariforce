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
const HEAVY =
  /\b(?:why|compare|compared|comparison|versus|vs\.?|difference|trend|doing|performance|so far|behind|ahead)\b/i;

/** One choice, before any model call. A lookup stays on 4.3. */
export function modelFor(message: string): 'grok-4.3' | 'grok-4.7' {
  if (HEAVY.test(message)) return 'grok-4.7';
  const months = message.match(/\b20\d{2}-\d{2}\b/g);
  if (months && new Set(months).size > 1) return 'grok-4.7';
  if (/\bthis month\b/i.test(message) && /\b(?:last|previous|prior) month\b/i.test(message))
    return 'grok-4.7';
  return 'grok-4.3';
}

/** Which figures to fetch. The model still reads the result and writes the answer. */
export function answerShape(message: string): string {
  const s = message.toLowerCase();
  if (/^how do i\b/.test(s.trim()))
    return 'How-to question. Answer from the how-to text only. Do not call a tool and do not state a figure.';
  if (/\b(missed doctor|coverage|call average|dcr compliance|adherence)\b/.test(s))
    return 'Field-measure question. Fetch kpi_report with the measure named, for the team or the place, and the period. Then read the table.';
  if (
    /\b(stock statement|aws)\b/.test(s) ||
    (/\bstockist\b/.test(s) && /\b(sales|secondary|statement)\b/.test(s))
  )
    return 'Stock-statement question. Fetch read_records with kind stock_statements. Report only the rows returned.';
  if (/\b(sales|primary|secondary)\b/.test(s))
    return 'Sales question. Fetch kpi_report with primary_sales_value and secondary_sales_value for the team, the named person, or the place. A headquarters name goes in place. Then read actual against target, and say what is behind.';
  if (/\b(doing|performance|so far)\b/.test(s))
    return 'Performance question. Fetch kpi_report for that team and period, with coverage_pct, call_average, dcr_compliance_pct, tp_adherence_pct, primary_sales_value and secondary_sales_value. Then say what is on target and what is behind. Use list_team only if the question asks who.';
  if (/\bholiday/.test(s))
    return 'Holiday question. Fetch read_records with kind holidays for that period.';
  if (/\b(exception|compliance gap)\b/.test(s))
    return 'Exception question. Fetch read_records with kind exceptions. Say which are open.';
  if (/\b(sfc|fare chart|fare)\b/.test(s))
    return 'Fare-chart question. Fetch read_records with kind sfc. Report only the rows returned.';
  if (/\bapproval/.test(s))
    return 'Approval question. Fetch read_records with kind approvals. Say what is waiting and what is already decided.';
  if (/\b(doctor|chemist|stockist)\b/.test(s))
    return 'Outlet question. Fetch read_records with kind doctors, chemists, or stockists and the name. Report only the rows returned.';
  if (/\b(dcr|daily call|tour plan)\b/.test(s))
    return 'Field-work question. If a person is named, fetch list_team for their id, then read_records with kind dcrs or tour_plans, that userId, and the month. Summarise what was filed.';
  if (/\b(leave|expense)\b/.test(s))
    return 'Account question. Fetch read_records with kind leave, leave_balances, or expenses. Report only rows returned for this account.';
  if (/\b(product|detailed|detailing|samples)\b/.test(s))
    return 'Product question. Fetch product_kpis, then say which products were detailed and where the POB sits.';
  if (/\b(who|people|manager)\b/.test(s) || /\b(team list|on my team|my team)\b/.test(s))
    return 'People question. Fetch list_team. If they also asked how those people are doing, fetch kpi_report for them too.';
  return 'Fetch the tool that holds the figures this question needs, then read what came back. Do not state a figure from memory.';
}

/** Sales live on the headquarters. The same name at territory level is not a second place. */
export function choosePlace<T extends { name: string; level: string }>(
  rows: T[],
  needle: string,
): T | null {
  const name = needle.trim().toLowerCase();
  const exact = rows.filter((row) => row.name.trim().toLowerCase() === name);
  const pool = exact.length ? exact : rows;
  const headquarters = pool.filter((row) => row.level === 'headquarter');
  if (headquarters.length === 1) return headquarters[0] ?? null;
  if (pool.length === 1) return pool[0] ?? null;
  return null;
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
        'The figures for this line. Pass the kpis the question needs: coverage_pct, call_average, dcr_compliance_pct, tp_adherence_pct, pob_value, primary_sales_value, secondary_sales_value. rollup team is the line, byUser is one row per person, place is a headquarters. A general “how are we doing” passes the field measures and both sales figures.',
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
      name: 'read_records',
      description:
        'Anything else this account can already open: doctors, chemists, stockists, dcrs, tour_plans, leave, leave_balances, expenses, approvals, stock_statements, exceptions. Scoped to this person. A 403 means it is not on their account.',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: [
              'doctors',
              'chemists',
              'stockists',
              'dcrs',
              'tour_plans',
              'leave',
              'leave_balances',
              'expenses',
              'approvals',
              'stock_statements',
              'exceptions',
              'holidays',
              'sfc',
            ],
          },
          name: { type: 'string', description: 'Part of a doctor, chemist, or stockist name' },
          userId: period.userId,
          month: period.month,
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
  if (hasBlock) {
    const kept = narrative
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .filter((sentence) => !(sentence.match(NUM) ?? []).some((n) => !allowed.has(n)));
    const text = kept.join(' ').trim();
    if (text) return { narrative: text, refused: false };
    return { narrative: 'The figures are in the table.', refused: false };
  }
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
      content: `${input.knowledge}\n\n${input.scopeLine}\n\n${answerShape(input.message)}\n\nReply with only {"narrative":"..."}. Read the tool result in plain language: what the period shows, what is ahead of target, and what is behind or missing. Use only names and numbers the tools returned. Do not invent a cause.`,
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
      : clipNarrative(guarded.narrative, toolNames.length ? 8 : 6),
    blocks: blocks.slice(0, 6),
    toolNames,
  };
}
