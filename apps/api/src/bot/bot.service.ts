import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { askerRoleLabel, botAudience, knowledgeFor } from './knowledge';
import { BotTools } from './bot.tools';
import { modelFor, runBot, toolSpecs, type AssistantMsg, type ChatMsg, type ToolSpec } from './run';

const err = (status: number, code: string, message: string) =>
  new HttpException({ code, message }, status);

function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) =>
      part && typeof part === 'object' && 'text' in part ? String(part.text ?? '') : '',
    )
    .join('');
  return text || null;
}

export async function completeGrok(
  key: string,
  model: string,
  messages: ChatMsg[],
  tools: ToolSpec[] | null,
): Promise<AssistantMsg> {
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages,
      ...(tools
        ? {
            tools: tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
          }
        : {}),
    }),
    signal: AbortSignal.timeout(model === 'grok-4.7' ? 60_000 : 30_000),
  });
  if (!res.ok) throw err(503, 'BOT_UNAVAILABLE', 'ARIBOT could not answer just now.');
  const body = (await res.json()) as {
    choices?: { message?: { content?: unknown; tool_calls?: AssistantMsg['tool_calls'] } }[];
  };
  const message = body.choices?.[0]?.message;
  if (!message) throw err(503, 'BOT_UNAVAILABLE', 'ARIBOT could not answer just now.');
  return { content: textOf(message.content), tool_calls: message.tool_calls };
}

@Injectable()
export class BotService {
  private readonly log = new Logger('Bot');

  constructor(
    private readonly tools: BotTools,
    private readonly audit: AuditService,
    private readonly tenant: TenantService,
  ) {}

  async ask(
    p: Principal,
    message: string,
    history?: { role: 'user' | 'assistant'; content: string }[],
  ) {
    const audience = botAudience(p.roles);
    if (audience === 'none')
      throw err(
        403,
        'FORBIDDEN',
        'ARIBOT is for managers, the Distribution Head, and System Admin.',
      );
    const key = process.env.XAI_API_KEY?.trim();
    if (!key) throw err(503, 'BOT_UNAVAILABLE', 'ARIBOT is not configured yet.');
    const model = modelFor(message);
    const companyWide = p.teamUserIds === null;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const result = await runBot({
      knowledge: knowledgeFor(audience),
      scopeLine: companyWide
        ? `Today is ${today} (India). A month named without a year is the latest one that is not after today. Asker: ${askerRoleLabel(p.roles)}. Scope: the whole company.`
        : `Today is ${today} (India). A month named without a year is the latest one that is not after today. Asker: ${askerRoleLabel(p.roles)}. Scope: their reporting line only.`,
      message,
      history,
      specs: toolSpecs(companyWide),
      call: (name, args) => this.tools.call(p, companyWide, name, args),
      complete: (messages, tools) => completeGrok(key, model, messages, tools),
    });
    await this.tenant.run(p, (tx) =>
      this.audit.record(tx, p, 'bot.ask', {
        after: {
          message: message.slice(0, 500),
          model,
          tools: result.toolNames,
          blocks: result.blocks.length,
          refused: result.refused,
        },
      }),
    );
    this.log.log(
      `ask model=${model} tools=${result.toolNames.join(',') || '-'} refused=${result.refused}`,
    );
    return { narrative: result.narrative, blocks: result.blocks, refused: result.refused };
  }
}
