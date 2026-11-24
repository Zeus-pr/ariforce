'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { BotAvatar } from 'bot-avatars';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useAuiState,
  useLocalRuntime,
  type ChatModelAdapter,
} from '@assistant-ui/react';
import { Thread } from '@/components/assistant-ui/elements/thread.aui';
import { Button } from '@ariforce/ui/components/button';
import { cn } from '@ariforce/ui/lib/utils';
import { DotPattern } from '@/components/ui/dot-pattern';
import { AribotIntro } from '@/components/bot/aribot-intro';
import { API_URL } from '@/lib/api';
import { roleLevel, type Role } from '@/lib/roles';
import { useRole } from '@/components/shell/role-context';

/** Sky teal — not navy. */
const BOT_COLOR = '#14b8a6';
const RAIL_WIDTH = '26rem';

function canUseAribots(role: Role) {
  return roleLevel(role) >= 2 || role === 'system_admin' || role === 'distribution_head';
}

interface BotTable {
  type: 'table';
  title: string;
  columns: string[];
  rows: string[][];
}

interface BotReply {
  narrative?: string;
  blocks?: BotTable[];
  message?: string;
}

const SUGGESTIONS = [
  'Who is on my team?',
  'How is my team doing this month?',
  'What is primary sales this month?',
  'What is secondary sales this month?',
  'What is DCR compliance this month?',
  'How do I file a DCR?',
] as const;

const COMPANY_ASK = 'What is company coverage this month?';

type AribotContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

const AribotContext = createContext<AribotContextValue | null>(null);

function chatError(status: number): string {
  if (status === 401) return 'Your session has ended. Sign in again, then ask.';
  if (status === 403) return 'ARIBOT is for managers, the Distribution Head, and System Admin.';
  if (status === 404) return 'ARIBOT is not available on the server yet.';
  if (status === 429) return 'Too many questions this hour. Try again shortly.';
  if (status === 503) return 'ARIBOT is not ready yet. The Grok key still needs to be set.';
  if (status === 0) return 'Could not reach AriForce. Check your connection and try again.';
  return 'ARIBOT could not answer that just now. Try again in a moment.';
}

function replyText(reply: BotReply) {
  const narrative = reply.narrative?.trim();
  if (narrative) return narrative;
  const tables = (reply.blocks ?? []).map((block) => {
    const head = `| ${block.columns.join(' | ')} |`;
    const rule = `| ${block.columns.map(() => '---').join(' | ')} |`;
    const rows = block.rows
      .map((row) => `| ${row.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`)
      .join('\n');
    return `**${block.title}**\n\n${head}\n${rule}\n${rows}`;
  });
  return tables.join('\n\n');
}

async function* streamText(text: string, abortSignal: AbortSignal) {
  const chunks = text.match(/\S+\s*|\s+/g) ?? [text];
  let out = '';
  for (const chunk of chunks) {
    if (abortSignal.aborted) return;
    out += chunk;
    yield { content: [{ type: 'text' as const, text: out }] };
    await new Promise((resolve) => window.setTimeout(resolve, 12));
  }
}

function turnText(content: readonly { type: string; text?: string }[]) {
  return content
    .map((part) => (part.type === 'text' ? (part.text ?? '') : ''))
    .join('')
    .trim();
}

const adapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const turns = messages.flatMap((item) => {
      if (item.role !== 'user' && item.role !== 'assistant') return [];
      const content = turnText(item.content).slice(0, 2000);
      return content ? [{ role: item.role, content }] : [];
    });
    const message = [...turns].reverse().find((turn) => turn.role === 'user')?.content ?? '';
    const history = turns.slice(0, -1).slice(-8);
    if (abortSignal.aborted) return;
    let res: Response;
    try {
      res = await fetch(`${API_URL}/v1/bot/ask`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, history }),
        signal: abortSignal,
      });
    } catch (error) {
      if (abortSignal.aborted) throw error;
      throw new Error(chatError(0), { cause: error });
    }
    const body = (await res.json().catch(() => null)) as BotReply | null;
    if (!res.ok || !body) throw new Error(chatError(res.status));
    const text = replyText(body);
    if (!text) throw new Error(chatError(res.status));
    yield* streamText(text, abortSignal);
  },
};

function AribotMark({ size = 32 }: { size?: number }) {
  const running = useAuiState((s) => s.thread.isRunning);
  return (
    <BotAvatar
      type="droid"
      state={running ? 'working' : 'default'}
      size={size}
      color={BOT_COLOR}
      interactive={false}
      aria-hidden
      className="pointer-events-none shrink-0"
    />
  );
}

function Welcome() {
  const { role } = useRole();
  const companyWide =
    role === 'director' || role === 'distribution_head' || role === 'system_admin';
  const asks = companyWide ? [...SUGGESTIONS.slice(0, 5), COMPANY_ASK] : [...SUGGESTIONS];

  return (
    <div className="relative z-10 mx-auto flex w-full max-w-lg flex-col items-center px-3 py-2 text-center">
      <div className="relative">
        <div aria-hidden className="absolute -inset-3 rounded-full bg-[#14b8a6]/15 blur-2xl" />
        <AribotMark size={44} />
      </div>
      <p className="text-muted-foreground mt-3 max-w-sm text-sm leading-relaxed">
        Ask about your team, coverage, sales, or how to use AriForce.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {asks.map((ask) => (
          <ThreadPrimitive.Suggestion key={ask} prompt={ask} send asChild>
            <button
              type="button"
              className="border-black/6 bg-white/90 text-foreground hover:border-[#14b8a6]/35 hover:bg-white rounded-full border px-4 py-2 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur-sm transition-colors"
            >
              {ask}
            </button>
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </div>
  );
}

export function AribotProvider({ children }: { children: ReactNode }) {
  const { role, user } = useRole();
  const allowed = canUseAribots(role);
  const runtime = useLocalRuntime(adapter);
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const value = useMemo(() => ({ open, setOpen, toggle }), [open, toggle]);

  if (!allowed) return children;

  return (
    <AribotContext.Provider value={value}>
      <AssistantRuntimeProvider runtime={runtime}>
        <AribotIntro userId={user.id} onOpen={() => setOpen(true)} />
        {children}
      </AssistantRuntimeProvider>
    </AribotContext.Provider>
  );
}

export function AribotButton() {
  const ctx = useContext(AribotContext);
  if (!ctx) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        'size-10 rounded-full p-0',
        ctx.open && 'bg-[#14b8a6]/12 ring-1 ring-[#14b8a6]/30',
      )}
      aria-label="Open ARIBOT"
      aria-expanded={ctx.open}
      data-testid="aribot-open"
      onClick={ctx.toggle}
    >
      <AribotMark size={28} />
    </Button>
  );
}

export function AribotRail() {
  const ctx = useContext(AribotContext);
  if (!ctx) return null;

  return (
    <aside
      data-state={ctx.open ? 'expanded' : 'collapsed'}
      aria-hidden={!ctx.open}
      className={cn(
        'relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden transition-[width] duration-200 ease-linear',
        ctx.open ? 'border-border/70 border-l' : 'border-l-0',
      )}
      style={{ width: ctx.open ? RAIL_WIDTH : 0 }}
    >
      <div
        className="aribot-chat relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f4faf9]"
        style={{ width: RAIL_WIDTH }}
      >
        <DotPattern
          width={18}
          height={18}
          cr={1.25}
          className="text-[#14b8a6]/45 [mask-image:radial-gradient(ellipse_at_top,white,transparent_90%)]"
        />
        <div className="relative z-10 flex h-12 shrink-0 items-center justify-between px-4">
          <p className="text-[15px] font-semibold tracking-[0.14em] text-[#0f766e]">ARIBOT</p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            aria-label="Close ARIBOT"
            onClick={() => ctx.setOpen(false)}
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
          <Thread components={{ Welcome }} />
        </div>
      </div>
    </aside>
  );
}
