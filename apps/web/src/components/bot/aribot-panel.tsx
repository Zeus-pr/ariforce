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
import { API_URL } from '@/lib/api';
import { roleLevel } from '@/lib/roles';
import { useRole } from '@/components/shell/role-context';

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

const STARTERS = ['Who is on my team?', 'Coverage this month', 'Tour plan adherence this month'];

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
    const res = await fetch(`${API_URL}/v1/bot/ask`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: abortSignal,
    });
    const body = (await res.json().catch(() => null)) as BotReply | null;
    if (!res.ok || !body?.narrative) {
      throw new Error(body?.message || 'ARIBOT could not answer just now.');
    }
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
  return (
    <div className="mb-6 flex flex-col gap-1 px-2">
      <Orb state="reasoning" variant="twins" size={36} label="ARIBOT" className="text-primary mb-3" />
      <p className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both text-2xl font-medium tracking-tight duration-200">
        Ask about your team
      </p>
      <div className="mt-3 flex flex-col">
        {STARTERS.map((prompt) => (
          <ThreadPrimitive.Suggestion key={prompt} prompt={prompt} send asChild>
            <button
              type="button"
              className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both hover:bg-foreground/[0.03] rounded-md px-2 py-2 text-left text-sm duration-200"
            >
              {prompt}
            </button>
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </div>
  );
}

export function AribotButton() {
  const { role } = useRole();
  const runtime = useLocalRuntime(adapter);
  const [open, setOpen] = useState(false);
  if (roleLevel(role) < 2) return null;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Button
        type="button"
        variant="ghost"
        className="h-9 gap-2 px-2"
        aria-label="ARIBOT"
        aria-expanded={open}
        data-testid="aribot-open"
        onClick={() => setOpen(true)}
      >
        <AribotOrb />
        <span className="relative text-[12px] font-semibold tracking-[0.28em]">
          <span
            aria-hidden
            className="absolute inset-0 bg-[linear-gradient(105deg,#7c6bff,#e879f9,#38bdf8)] bg-clip-text text-transparent blur-[5px]"
          >
            ARIBOT
          </span>
          <span className="relative bg-[linear-gradient(105deg,#6d5efc_0%,#d946ef_46%,#38bdf8_100%)] bg-clip-text text-transparent">
            ARIBOT
          </span>
        </span>
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
