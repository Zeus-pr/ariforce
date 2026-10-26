'use client';

import { PlaceholderTag } from './placeholder';

import { FileSpreadsheet, Plus } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import { cn } from '@ariforce/ui/lib/utils';
import { DataTable } from '@/components/data-table/data-table';
import type { Column } from '@/components/data-table/types';
import { MASTERS, type MasterKind, type MasterRow } from './config';
import { LookupsProvider, useLookups } from './lookups';
import { RecordSheet } from './record-sheet';
import { masterSource } from './source';
import { useRole } from '@/components/shell/role-context';
import { canWriteMasters } from '@/lib/permissions';

const dash = <span className="text-muted-foreground">—</span>;

function useColumns(kind: MasterKind): Column<MasterRow>[] {
  const { byId } = useLookups();
  return useMemo(() => {
    const name = (id: string | null | undefined) => (id ? (byId.get(id) ?? dash) : dash);
    const place: Column<MasterRow> = {
      id: 'city',
      header: 'City',
      mobile: 'secondary',
      cell: (r) => r.city ?? dash,
    };
    const territory: Column<MasterRow> = {
      id: 'territory',
      header: 'Territory',
      mobile: 'secondary',
      cell: (r) => name(r.territoryId),
    };
    const title: Column<MasterRow> = {
      id: 'name',
      header: 'Name',
      mobile: 'primary',
      className: 'font-medium',
      cell: (r) => (
        <>
          {r.name}
          {kind === 'doctors' && <PlaceholderTag name={r.name} />}
        </>
      ),
    };
    if (kind === 'doctors')
      return [
        title,
        {
          id: 'qualification',
          header: 'Qualification',
          cell: (r) => ('qualification' in r && r.qualification) || dash,
        },
        {
          id: 'specialty',
          header: 'Specialty',
          mobile: 'secondary',
          cell: (r) => name('specialtyId' in r ? r.specialtyId : null),
        },
        {
          id: 'category',
          header: 'Category',
          cell: (r) => {
            const c = 'categoryId' in r && r.categoryId ? byId.get(r.categoryId) : null;
            return c ? <Badge variant="secondary">{c}</Badge> : dash;
          },
        },
        territory,
        place,
      ];
    return [
      title,
      {
        id: 'gstin',
        header: 'GSTIN',
        className: 'font-mono text-xs',
        cell: (r) => ('gstin' in r && r.gstin) || dash,
      },
      {
        id: 'dl',
        header: 'Drug licence',
        cell: (r) => ('drugLicenseNo' in r && r.drugLicenseNo) || dash,
      },
      territory,
      place,
      { id: 'phone', header: 'Phone', mobile: 'secondary', cell: (r) => r.phone ?? dash },
      {
        id: 'updated',
        header: 'Updated',
        className: 'whitespace-nowrap tabular-nums text-muted-foreground',
        mobile: 'hidden',
        cell: (r) =>
          new Intl.DateTimeFormat('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'Asia/Kolkata',
          }).format(new Date(r.updatedAt)),
      },
    ];
  }, [kind, byId]);
}

function Inner({ kind }: { kind: MasterKind }) {
  const cfg = MASTERS[kind];
  const columns = useColumns(kind);
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<MasterRow | null>(null);
  const [reload, setReload] = useState(0);
  const lk = useLookups();
  const source = useMemo(() => masterSource(kind, lk), [kind, lk]);
  const { role } = useRole();
  const canWrite = canWriteMasters(role);
  const importLink = (
    <Button variant="outline" asChild>
      <Link href={`/masters/${kind}/import`} data-testid="master-import">
        <FileSpreadsheet /> Import
      </Link>
    </Button>
  );

  return (
    <>
      <DataTable
        label={cfg.title.toLowerCase()}
        source={source}
        columns={columns}
        rowKey={(r) => r.id}
        reloadKey={reload}
        searchPlaceholder={`Search ${cfg.title.toLowerCase()}`}
        onRowClick={(r) => {
          setRow(r);
          setOpen(true);
        }}
        empty={
          <div className="flex flex-col items-center gap-3 py-6" data-testid="master-empty">
            <p>No {cfg.title.toLowerCase()} yet.</p>
            {canWrite && (
              <Button asChild>
                <Link href={`/masters/${kind}/import`}>
                  <FileSpreadsheet /> Import {cfg.title.toLowerCase()}
                </Link>
              </Button>
            )}
          </div>
        }
        actions={
          canWrite ? (
            <>
              {importLink}
              <Button
                data-testid="master-add"
                onClick={() => {
                  setRow(null);
                  setOpen(true);
                }}
              >
                <Plus /> Add {cfg.singular}
              </Button>
            </>
          ) : undefined
        }
      />
      <RecordSheet
        kind={kind}
        open={open}
        row={row}
        onOpenChange={setOpen}
        readOnly={!canWrite}
        onSaved={() => setReload((n) => n + 1)}
      />
    </>
  );
}

export function MastersTabs({ kind }: { kind: MasterKind }) {
  return (
    <nav aria-label="Masters" className="-mx-1 flex gap-1 overflow-x-auto px-1">
      {(Object.keys(MASTERS) as MasterKind[]).map((k) => (
        <Link
          key={k}
          href={`/masters/${k}`}
          aria-current={k === kind ? 'page' : undefined}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
            k === kind && 'bg-secondary text-foreground',
          )}
        >
          {MASTERS[k].title}
        </Link>
      ))}
    </nav>
  );
}

export function MastersView({ kind }: { kind: MasterKind }) {
  return (
    <LookupsProvider>
      <Suspense>
        <Inner kind={kind} />
      </Suspense>
    </LookupsProvider>
  );
}
