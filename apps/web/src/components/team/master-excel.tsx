'use client';

import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ariforce/ui/components/dialog';
import { API_URL, api, apiReady } from '@/lib/api';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function thisMonth() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
}

type Choice = 'all' | 'hq' | 'person';

export function MasterExcelButton({
  month,
  headquarters,
  focusHeadquartersId,
  focusUserId,
}: {
  month: string;
  headquarters: { id: string; name: string }[];
  focusHeadquartersId: string | null;
  focusUserId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(month.slice(0, 4));
  const [mon, setMon] = useState(month.slice(5, 7));
  const [choice, setChoice] = useState<Choice>('all');
  const [hqId, setHqId] = useState('');
  const [personId, setPersonId] = useState('');
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = thisMonth();
  const years = Array.from({ length: 5 }, (_, i) => String(Number(now.slice(0, 4)) - i));
  const chosen = `${year}-${mon}`;
  const future = chosen > now;

  const openDialog = () => {
    setYear(month.slice(0, 4));
    setMon(month.slice(5, 7));
    setError(null);
    if (focusUserId) {
      setChoice('person');
      setPersonId(focusUserId);
      setHqId(focusHeadquartersId ?? headquarters[0]?.id ?? '');
    } else if (focusHeadquartersId) {
      setChoice('hq');
      setHqId(focusHeadquartersId);
      setPersonId('');
    } else {
      setChoice('all');
      setHqId(headquarters[0]?.id ?? '');
      setPersonId('');
    }
    setOpen(true);
    if (!people.length) {
      void apiReady().then(async () => {
        const r = await api.GET('/v1/team');
        const nodes = r.data ? [...r.data.nodes, ...r.data.unassigned] : [];
        const seen = new Set<string>();
        setPeople(
          nodes
            .filter((person) => (seen.has(person.id) ? false : seen.add(person.id)))
            .map((person) => ({ id: person.id, name: person.name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      });
    }
  };

  const download = async () => {
    setBusy(true);
    setError(null);
    await apiReady();
    const query = new URLSearchParams({ month: chosen });
    if (choice === 'hq' && hqId) query.set('headquartersId', hqId);
    if (choice === 'person' && personId) query.set('userId', personId);
    try {
      const res = await fetch(`${API_URL}/v1/reports/master-excel?${query}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'You don’t have access to this workbook.'
            : 'Could not build the workbook. Try again.',
        );
        return;
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = `master-excel-${chosen}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setOpen(false);
    } catch {
      setError('Could not build the workbook. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={openDialog}
        data-testid="master-excel"
      >
        Master Excel
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="master-excel-dialog">
          <DialogHeader>
            <DialogTitle>Master Excel</DialogTitle>
            <DialogDescription>
              All headquarters, one headquarters, or one person. A person stays on their
              headquarters sheet, with its territories.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-sm">
            Who
            <select
              className="h-9 rounded-md border bg-card px-2"
              value={choice}
              onChange={(e) => setChoice(e.target.value as Choice)}
              data-testid="master-excel-who"
            >
              <option value="all">All headquarters</option>
              <option value="hq">One headquarters</option>
              <option value="person">One person</option>
            </select>
          </label>
          {choice === 'hq' ? (
            <label className="flex flex-col gap-1 text-sm">
              Headquarters
              <select
                className="h-9 rounded-md border bg-card px-2"
                value={hqId}
                onChange={(e) => setHqId(e.target.value)}
                data-testid="master-excel-hq"
              >
                {headquarters.map((hq) => (
                  <option key={hq.id} value={hq.id}>
                    {hq.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {choice === 'person' ? (
            <label className="flex flex-col gap-1 text-sm">
              Person
              <select
                className="h-9 rounded-md border bg-card px-2"
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
                data-testid="master-excel-person"
              >
                <option value="">Choose a person</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Month
              <select
                className="h-9 rounded-md border bg-card px-2"
                value={mon}
                onChange={(e) => setMon(e.target.value)}
                data-testid="master-excel-month"
              >
                {MONTHS.map((name, i) => {
                  const value = String(i + 1).padStart(2, '0');
                  return (
                    <option key={value} value={value} disabled={`${year}-${value}` > now}>
                      {name}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="flex w-28 flex-col gap-1 text-sm">
              Year
              <select
                className="h-9 rounded-md border bg-card px-2"
                value={year}
                onChange={(e) => {
                  const next = e.target.value;
                  setYear(next);
                  if (`${next}-${mon}` > now) setMon(now.slice(5, 7));
                }}
                data-testid="master-excel-year"
              >
                {years.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="button"
            disabled={
              busy || future || (choice === 'hq' && !hqId) || (choice === 'person' && !personId)
            }
            onClick={() => void download()}
            data-testid="master-excel-download"
          >
            {busy && <LoaderCircle className="animate-spin" aria-hidden />}
            Download
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
