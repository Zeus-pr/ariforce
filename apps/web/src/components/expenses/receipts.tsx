'use client';

import { useRef, useState } from 'react';
import { Camera, Download, FileText, LoaderCircle, Paperclip, Trash2, Upload } from 'lucide-react';
import type { ExpenseClaim } from '@ariforce/contracts';
import { cn } from '@ariforce/ui/lib/utils';
import { Button } from '@ariforce/ui/components/button';
import { toast } from '@ariforce/ui/components/sonner';
import { api, MOCKING, toApiError } from '@/lib/api';
import { ACCEPT, checkFile, MAX_FILES, MAX_MB, messageFor } from '@/lib/expenses/model';
import { openReceipt, uploadReceipt } from '@/lib/expenses/upload';

type Line = ExpenseClaim['lines'][number];
type Pending = { key: string; name: string; progress: number; error: string | null };

const KIND: Record<string, string> = {
  'image/jpeg': 'Photo',
  'image/png': 'Image',
  'image/heic': 'Photo',
  'image/heif': 'Photo',
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.ms-excel': 'Excel',
  'text/csv': 'CSV',
};
const size = (b: number) =>
  b >= 1024 * 1024
    ? `${(b / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(b / 1024))} KB`;

/** Receipts of one line: list, download, remove, and add by drag/drop, camera or file picker. */
export function Receipts({
  claimId,
  line,
  editable,
  onChange,
}: {
  claimId: string;
  line: Line;
  editable: boolean;
  onChange: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [drag, setDrag] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const confirmed = line.attachments.filter((a) => a.status === 'confirmed');
  const used = line.attachments.length + pending.filter((p) => !p.error).length;

  async function add(files: FileList | File[] | null) {
    if (!files?.length) return;
    let count = used;
    const jobs: { file: File; key: string }[] = [];
    const next: Pending[] = [];
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      const problem = checkFile(file, count);
      next.push({ key, name: file.name, progress: 0, error: problem });
      if (!problem) {
        jobs.push({ file, key });
        count++;
      }
    }
    setPending((p) => [...p, ...next]);
    await Promise.all(
      jobs.map(async ({ file, key }) => {
        try {
          await uploadReceipt(
            claimId,
            line.id,
            file,
            (progress) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress } : x))),
            { viaFetch: MOCKING },
          );
          setPending((p) => p.filter((x) => x.key !== key));
        } catch (e) {
          setPending((p) =>
            p.map((x) => (x.key === key ? { ...x, error: (e as Error).message } : x)),
          );
        }
      }),
    );
    onChange();
  }

  async function remove(id: string) {
    setBusyId(id);
    const r = await api.DELETE('/v1/expense-attachments/{id}', { params: { path: { id } } });
    setBusyId(null);
    if (r.error) return toast.error(messageFor(toApiError(r)));
    toast.success('Receipt removed');
    onChange();
  }

  async function download(id: string) {
    try {
      await openReceipt(id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="exp-receipts">
      {line.attachments.length > 0 && (
        <ul className="flex flex-col gap-1">
          {line.attachments.map((a, i) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-sm"
              data-testid="exp-receipt"
              data-status={a.status}
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">
                  Receipt {i + 1} · {KIND[a.contentType] ?? 'File'} · {size(a.sizeBytes)}
                </span>
                {a.status === 'pending' && (
                  <span className="text-xs text-amber-800">not finished</span>
                )}
              </span>
              <span className="flex shrink-0 items-center">
                {a.status === 'confirmed' && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={`Open receipt ${i + 1}`}
                    onClick={() => download(a.id)}
                    data-testid="exp-receipt-download"
                  >
                    <Download aria-hidden />
                  </Button>
                )}
                {editable && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={`Remove receipt ${i + 1}`}
                    disabled={busyId === a.id}
                    onClick={() => remove(a.id)}
                    data-testid="exp-receipt-remove"
                  >
                    {busyId === a.id ? (
                      <LoaderCircle className="animate-spin" aria-hidden />
                    ) : (
                      <Trash2 aria-hidden />
                    )}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {pending.map((p) => (
        <div
          key={p.key}
          className={cn(
            'rounded-md border px-2 py-1.5 text-sm',
            p.error && 'border-red-200 bg-red-50 text-red-900',
          )}
          data-testid={p.error ? 'exp-upload-error' : 'exp-upload-progress'}
          role={p.error ? 'alert' : 'status'}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">{p.error ?? p.name}</span>
            {p.error ? (
              <button
                type="button"
                className="text-xs underline"
                onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}
              >
                Dismiss
              </button>
            ) : (
              <span className="text-xs tabular-nums text-muted-foreground">
                {Math.round(p.progress * 100)}%
              </span>
            )}
          </div>
          {!p.error && (
            <div className="mt-1 h-1 overflow-hidden rounded bg-muted" aria-hidden>
              <div
                className="h-full origin-left bg-foreground transition-transform motion-reduce:transition-none"
                style={{ transform: `scaleX(${p.progress})` }}
              />
            </div>
          )}
        </div>
      ))}

      {editable && used < MAX_FILES && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void add(e.dataTransfer.files);
          }}
          className={cn(
            'flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2 text-sm text-muted-foreground transition-colors',
            drag && 'border-foreground bg-muted/50',
          )}
          data-testid="exp-dropzone"
        >
          <Paperclip className="hidden size-4 sm:block" aria-hidden />
          <span className="hidden sm:inline">Drop receipts here or</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            data-testid="exp-pick-file"
          >
            <Upload aria-hidden /> Choose files
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => camRef.current?.click()}
            className="sm:hidden"
            data-testid="exp-camera"
          >
            <Camera aria-hidden /> Take photo
          </Button>
          <span className="text-xs">
            Up to {MAX_FILES}, {MAX_MB} MB each
          </span>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose receipt files"
            data-testid="exp-file-input"
            onChange={(e) => {
              void add(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={camRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-label="Take a photo of a receipt"
            onChange={(e) => {
              void add(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      )}
      {line.category === 'hotel' && confirmed.length === 0 && (
        <p className="text-xs text-amber-800" data-testid="exp-hotel-needs-receipt">
          Hotel lines need a receipt before you submit.
        </p>
      )}
    </div>
  );
}
