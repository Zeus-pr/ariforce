'use client';

import { useState } from 'react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { api, apiReady, toApiError } from '@/lib/api';

/** Director and system admin. One notification for every other active person. */
export function CompanyMessageForm() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSent(null);
    await apiReady();
    const r = await api.POST('/v1/notifications/company', {
      body: { title: title.trim(), body: body.trim() },
    });
    setBusy(false);
    if (r.error) {
      setError(toApiError(r.error).message);
      return;
    }
    setSent(r.data?.recipients ?? 0);
    setTitle('');
    setBody('');
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex max-w-xl flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Title
        <Input
          value={title}
          maxLength={120}
          required
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Holiday on Friday"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Message
        <textarea
          value={body}
          maxLength={500}
          required
          rows={5}
          onChange={(e) => setBody(e.target.value)}
          placeholder="The office is closed on Friday. Field work resumes Monday."
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
        />
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {sent !== null ? (
        <p className="text-sm text-muted-foreground">
          Sent to {sent} {sent === 1 ? 'person' : 'people'}.
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={busy || !title.trim() || !body.trim()}>
          {busy ? 'Sending…' : 'Send to the company'}
        </Button>
      </div>
    </form>
  );
}
