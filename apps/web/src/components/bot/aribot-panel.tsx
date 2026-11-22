'use client';

import { useState, type FormEvent } from 'react';
import { Bot } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@ariforce/ui/components/sheet';
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
  narrative: string;
  blocks: BotTable[];
  refused: boolean;
}

interface Turn {
  role: 'user' | 'bot';
  text: string;
  blocks?: BotTable[];
}

const STARTERS = ['Who is on my team?', 'Coverage this month', 'Tour plan adherence this month'];

export function AribotButton() {
  const { role } = useRole();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  if (roleLevel(role) < 2) return null;

  const ask = async (message: string) => {
    const text = message.trim();
    if (!text || pending) return;
    setDraft('');
    setTurns((prev) => [...prev, { role: 'user', text }]);
    setPending(true);
    try {
      const res = await fetch(`${API_URL}/v1/bot/ask`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const body = (await res.json().catch(() => null)) as (BotReply & { message?: string }) | null;
      if (!res.ok || !body || typeof body.narrative !== 'string') {
        setTurns((prev) => [
          ...prev,
          { role: 'bot', text: body?.message || 'ARIBOT could not answer just now.' },
        ]);
        return;
      }
      setTurns((prev) => [...prev, { role: 'bot', text: body.narrative, blocks: body.blocks }]);
    } catch {
      setTurns((prev) => [...prev, { role: 'bot', text: 'ARIBOT could not answer just now.' }]);
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(draft);
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground"
        aria-label="ARIBOT"
        aria-expanded={open}
        data-testid="aribot-open"
        onClick={() => setOpen(true)}
      >
        <Bot className="size-4" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[min(100%,440px)] gap-0 p-0 sm:max-w-[440px]">
          <SheetHeader className="border-b px-4 py-3 pr-12">
            <SheetTitle>ARIBOT</SheetTitle>
            <SheetDescription>Your team’s figures, from AriForce.</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
              {turns.length === 0 && (
                <div className="flex flex-col gap-2">
                  {STARTERS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => void ask(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
              {turns.map((turn, i) => (
                <div key={i} className={turn.role === 'user' ? 'text-sm font-medium' : 'text-sm'}>
                  <p className="whitespace-pre-wrap">{turn.text}</p>
                  {turn.blocks?.map((block) => (
                    <div key={block.title} className="mt-2 overflow-x-auto">
                      <p className="mb-1 text-xs text-muted-foreground">{block.title}</p>
                      <table className="w-full border-collapse text-left text-xs">
                        <thead>
                          <tr>
                            {block.columns.map((column) => (
                              <th key={column} className="border-b px-2 py-1 font-medium">
                                {column}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {block.rows.map((row, r) => (
                            <tr key={r}>
                              {row.map((cell, c) => (
                                <td key={c} className="border-b px-2 py-1">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              ))}
              {pending && <p className="text-sm text-muted-foreground">Looking that up…</p>}
            </div>
            <form onSubmit={onSubmit} className="flex gap-2 border-t p-3">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask about your team"
                aria-label="Ask ARIBOT"
                maxLength={1000}
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              />
              <Button type="submit" disabled={pending || !draft.trim()}>
                Ask
              </Button>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
