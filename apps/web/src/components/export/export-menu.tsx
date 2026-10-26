'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@ariforce/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ariforce/ui/components/dropdown-menu';
import { toast } from '@ariforce/ui/components/sonner';
import { exportPdf, exportXlsx, type ExportSpec } from './export';

export function ExportMenu({ spec, disabled }: { spec: () => ExportSpec; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const run = async (kind: 'xlsx' | 'pdf') => {
    setBusy(true);
    try {
      await (kind === 'xlsx' ? exportXlsx : exportPdf)(spec());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || busy} data-testid="export">
          <Download />
          {busy ? 'Exporting…' : 'Export'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => run('xlsx')} data-testid="export-xlsx">
          Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run('pdf')} data-testid="export-pdf">
          PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
