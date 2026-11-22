'use client';

import { useState } from 'react';
import { Orb } from '@yogesharc/thinking-orbs';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useAuiState,
  useLocalRuntime,
  type ChatModelAdapter,
} from '@assistant-ui/react';
import { Thread } from '@/components/assistant-ui/elements/thread.aui';
import { Button } from '@ariforce/ui/components/button';
import { Sheet, SheetContent, SheetTitle } from '@ariforce/ui/components/sheet';
import { AribotIntro } from '@/components/bot/aribot-intro';
import { API_URL } from '@/lib/api';
import { roleLevel, type Role } from '@/lib/roles';
import { useRole } from '@/components/shell/role-context';

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

const READY: { group: string; ask: string; director?: boolean }[] = [
  { group: 'Team', ask: 'Who is on my team?' },
  { group: 'Team', ask: 'Who on my line has no manager?' },
  { group: 'Field', ask: "What is my team's coverage this month?" },
  { group: 'Field', ask: 'What is frequency compliance this month?' },
  { group: 'Field', ask: 'What share of doctors were missed this month?' },
  { group: 'Field', ask: 'What is the call average this month?' },
  { group: 'Field', ask: 'What is DCR compliance this month?' },
  { group: 'Field', ask: 'What is tour plan adherence this month?' },
  { group: 'Sales', ask: 'What is POB this month?' },
  { group: 'Sales', ask: 'What is primary sales this month?' },
  { group: 'Sales', ask: 'What is secondary sales this month?' },
  { group: 'Products', ask: 'Which products were detailed this month?' },
  { group: 'Products', ask: 'Which product has the highest POB this month?' },
  { group: 'Company', ask: 'What is company coverage this month?', director: true },
  { group: 'Company', ask: 'Which area has the lowest coverage?', director: true },
  { group: 'Company', ask: 'What is company primary sales this month?', director: true },
  { group: 'Company', ask: 'What is company secondary sales this month?', director: true },
];

function chatError(status: number): string {
  if (status === 401) return 'Your session has ended. Sign in again, then ask.';
  if (status === 403) return 'ARIBOT is for managers, the Distribution Head, and System Admin.';
  if (status === 404) return 'ARIBOT is not available on the server yet.';
  if (status === 429) return 'Too many questions this hour. Try again shortly.';
  if (status === 503) return 'ARIBOT is not ready yet. The Grok key still needs to be set.';
  if (status === 0) return 'Could not reach AriForce. Check your connection and try again.';
  return 'ARIBOT could not answer that just now. Try again in a moment.';
}

function asMarkdown(reply: BotReply) {
  const tables = (reply.blocks ?? []).map((block) => {
    const head = `| ${block.columns.join(' | ')} |`;
    const rule = `| ${block.columns.map(() => '---').join(' | ')} |`;
    const rows = block.rows
      .map((row) => `| ${row.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`)
      .join('\n');
    return `**${block.title}**\n\n${head}\n${rule}\n${rows}`;
  });
  return [reply.narrative, ...tables].filter(Boolean).join('\n\n');
}

const adapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const last = [...messages].reverse().find((message) => message.role === 'user');
    const message =
      last?.content
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('')
        .trim() ?? '';
    yield {
      content: [{ type: 'reasoning', text: 'Checking your line in AriForce.' }],
    };
    let res: Response;
    try {
      res = await fetch(`${API_URL}/v1/bot/ask`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: abortSignal,
      });
    } catch (error) {
      if (abortSignal.aborted) throw error;
      throw new Error(chatError(0));
    }
    const body = (await res.json().catch(() => null)) as BotReply | null;
    if (!res.ok || !body?.narrative) throw new Error(chatError(res.status));
    yield {
      content: [
        {
          type: 'reasoning',
          text: 'Checked your line in AriForce. The figures below are only from that line.',
        },
        { type: 'text', text: asMarkdown(body) },
      ],
    };
  },
};

function AribotOrb() {
  const running = useAuiState((s) => s.thread.isRunning);
  return (
    <Orb
      state={running ? 'reasoning' : 'working'}
      variant={running ? 'twins' : 'gyro'}
      size={22}
      speed={1.15}
      label="ARIBOT"
      className="text-primary"
    />
  );
}

function Welcome() {
  const { role } = useRole();
  const companyWide = role === 'director' || role === 'system_admin' || role === 'distribution_head';
  const asks = READY.filter((item) => !item.director || companyWide);
  const groups = [...new Set(asks.map((item) => item.group))];
  return (
    <div className="mb-6 flex flex-col gap-1 px-2">
      <Orb state="reasoning" variant="twins" size={36} label="ARIBOT" className="text-primary mb-3" />
      <p className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both text-2xl font-medium tracking-tight duration-200">
        Ask about your team
      </p>
      <div className="mt-4 flex max-h-72 flex-col gap-3 overflow-y-auto">
        {groups.map((group) => (
          <div key={group}>
            <p className="text-muted-foreground px-2 pb-1 text-[11px] tracking-[0.16em] uppercase">
              {group}
            </p>
            {asks
              .filter((item) => item.group === group)
              .map((item) => (
                <ThreadPrimitive.Suggestion key={item.ask} prompt={item.ask} send asChild>
                  <button
                    type="button"
                    className="hover:bg-foreground/[0.03] w-full rounded-md px-2 py-1.5 text-left text-sm"
                  >
                    {item.ask}
                  </button>
                </ThreadPrimitive.Suggestion>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AribotButton() {
  const { role, user } = useRole();
  const runtime = useLocalRuntime(adapter);
  const [open, setOpen] = useState(false);
  if (!canUseAribots(role)) return null;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AribotIntro userId={user.id} onOpen={() => setOpen(true)} />
      <Button
        type="button"
        variant="ghost"
        className="aribot-live h-9 gap-2 rounded-full px-3"
        aria-label="ARIBOT"
        aria-expanded={open}
        data-testid="aribot-open"
        onClick={() => setOpen(true)}
      >
        <AribotOrb />
        <span className="aribot-mark text-[13px] font-semibold tracking-[0.22em]">ARIBOT</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-[min(100%,28rem)] gap-0 overflow-hidden p-0 sm:max-w-md"
        >
          <SheetTitle className="sr-only">ARIBOT</SheetTitle>
          <Thread components={{ Welcome }} />
        </SheetContent>
      </Sheet>
    </AssistantRuntimeProvider>
  );
}
