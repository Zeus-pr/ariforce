'use client';

import {
  CircleAlert,
  ImagePlus,
  LoaderCircle,
  Package,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@ariforce/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ariforce/ui/components/dialog';
import { toast } from '@ariforce/ui/components/sonner';
import { cn } from '@ariforce/ui/lib/utils';
import {
  PRODUCT_IMAGE_ACCEPT,
  PRODUCT_IMAGE_MAX_MB,
  checkProductImage,
  productImageUrl,
  removeProductImage,
  uploadProductImage,
  type ProductImageResult,
} from '@/lib/products/product-image';
import { ProductImg } from '@/components/media/product-img';

type ImageProduct = { id: string; name: string; code: string };
const size = (b: number) =>
  b >= 1024 * 1024
    ? `${(b / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(b / 1024))} KB`;

/**
 * Product picture in the Product prices table: a small thumbnail, or a placeholder when there is
 * none. Editors click it to open the upload box (`onOpen`); everyone else just sees the picture.
 */
export function ProductImageCell({
  product,
  canEdit,
  onOpen,
}: {
  product: ImageProduct;
  canEdit: boolean;
  onOpen: () => void;
}) {
  const url = productImageUrl(product);
  const face = url ? (
    <ProductImg
      src={url}
      alt=""
      width={40}
      height={40}
      sizes="40px"
      className="size-full object-cover"
    />
  ) : canEdit ? (
    <ImagePlus className="size-4 text-muted-foreground" aria-hidden />
  ) : (
    <Package className="size-4 text-muted-foreground/70" aria-hidden />
  );
  const box =
    'flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40';
  if (!canEdit)
    return (
      <span className={box} data-testid="pp-image" data-has-image={url ? '' : undefined}>
        {face}
      </span>
    );
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={url ? `Change image for ${product.name}` : `Add image for ${product.name}`}
      title={url ? 'Change image' : 'Add image'}
      data-testid="pp-image"
      data-has-image={url ? '' : undefined}
      className={cn(
        box,
        'cursor-pointer outline-none transition-[transform,border-color,background-color] duration-150 ease-out hover:border-foreground/30 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96] motion-reduce:transition-none',
        !url && 'border-dashed',
      )}
    >
      {face}
    </button>
  );
}

/**
 * The upload box: drop, paste or choose a file, preview it, then save; or replace / remove the
 * current one. One per page: keep `product` set while it closes so the content does not flash.
 */
export function ProductImageDialog({
  product,
  open,
  onOpenChange,
  onSaved,
}: {
  product: ImageProduct | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (productId: string, r: ProductImageResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const current = productImageUrl(product);
  const name = product?.name ?? 'this product';
  const uploading = progress !== null;
  const busy = uploading || removing;
  const shown = preview ?? current;

  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // Reset when the box closes (and stop an upload in flight).
  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    setFile(null);
    setProgress(null);
    setError(null);
    setDrag(false);
  }, [open]);

  function pick(files: FileList | File[] | null | undefined) {
    const f = files?.[0];
    if (!f || busy) return;
    const problem = checkProductImage(f);
    setError(problem);
    setFile(problem ? null : f);
  }

  async function save() {
    if (!file || !product) return;
    setError(null);
    setProgress(0);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await uploadProductImage(product.id, file, setProgress, { signal: ac.signal });
      onSaved(product.id, r);
      toast.success(`${current ? 'Image replaced' : 'Image added'} for ${name}`);
      onOpenChange(false);
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message);
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setProgress(null);
    }
  }

  async function remove() {
    if (!product) return;
    setError(null);
    setRemoving(true);
    try {
      const r = await removeProductImage(product.id);
      onSaved(product.id, r);
      toast.success(`Image removed for ${name}`);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRemoving(false);
    }
  }

  const choose = () => !busy && inputRef.current?.click();

  return (
    <Dialog open={open} onOpenChange={(o) => (!o && removing ? undefined : onOpenChange(o))}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="pp-image-dialog"
        onPaste={(e) => {
          const f = Array.from(e.clipboardData.files).find((x) => x.type.startsWith('image/'));
          if (f) pick([f]);
        }}
      >
        <DialogHeader>
          <DialogTitle>Product image</DialogTitle>
          <DialogDescription>
            {name}
            {product ? ` · ${product.code}` : ''}. Reps see this picture when they pick medicines in
            the DCR.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={choose}
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              pick(e.dataTransfer.files);
            }}
            disabled={busy}
            aria-label={shown ? 'Choose a different image' : 'Choose an image to upload'}
            aria-describedby="pp-image-hint"
            data-testid="pp-image-dropzone"
            data-dragging={drag ? '' : undefined}
            className={cn(
              'group relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg border bg-muted/30 outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-progress motion-reduce:transition-none',
              shown ? 'border-solid' : 'border-dashed hover:border-foreground/30 hover:bg-muted/50',
              drag && 'border-primary bg-primary/5',
              error && !shown && 'border-destructive/50',
            )}
          >
            {shown ? (
              <>
                <ProductImg
                  src={shown}
                  width={480}
                  height={360}
                  sizes="(min-width: 640px) 480px, 100vw"
                  alt={
                    preview
                      ? `Preview of ${file?.name ?? 'the new image'}`
                      : `Current image of ${name}`
                  }
                  className={cn(
                    'size-full object-contain transition-opacity duration-200',
                    uploading && 'opacity-60',
                  )}
                  data-testid="pp-image-preview"
                />
                {!busy && (
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-linear-to-t from-black/55 to-transparent px-3 pt-6 pb-2 text-xs font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                    <RefreshCw className="size-3.5" aria-hidden /> Drop or click to choose another
                  </span>
                )}
              </>
            ) : (
              <span className="flex flex-col items-center gap-2 px-6 text-center">
                <span className="flex size-10 items-center justify-center rounded-full border bg-background shadow-xs">
                  <Upload className="size-4 text-muted-foreground" aria-hidden />
                </span>
                <span className="text-sm font-medium">
                  {drag ? 'Drop to use this image' : 'Drop an image here, or click to choose'}
                </span>
                <span className="text-xs text-muted-foreground">You can also paste an image</span>
              </span>
            )}
          </button>

          <div
            className="flex min-h-5 items-center justify-between gap-3 text-xs text-muted-foreground"
            id="pp-image-hint"
          >
            {file ? (
              <span className="min-w-0 truncate" data-testid="pp-image-file">
                <span className="text-foreground">{file.name}</span> · {size(file.size)} · not saved
                yet
              </span>
            ) : (
              <span>JPEG, PNG or WebP, up to {PRODUCT_IMAGE_MAX_MB} MB</span>
            )}
            {uploading && (
              <span className="shrink-0 tabular-nums">{Math.round(progress * 100)}%</span>
            )}
          </div>

          {uploading && (
            <div
              className="h-1 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              data-testid="pp-image-progress"
            >
              <div
                className="h-full origin-left bg-primary transition-transform duration-200 ease-out motion-reduce:transition-none"
                style={{ transform: `scaleX(${Math.max(progress, 0.04)})` }}
              />
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="flex items-start gap-1.5 text-sm text-destructive"
              data-testid="pp-image-error"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <input
            ref={inputRef}
            type="file"
            accept={PRODUCT_IMAGE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            data-testid="pp-image-input"
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {file ? (
            <>
              <Button
                variant="ghost"
                disabled={uploading}
                onClick={() => {
                  setFile(null);
                  setError(null);
                }}
                data-testid="pp-image-discard"
              >
                Discard
              </Button>
              <Button disabled={uploading} onClick={() => void save()} data-testid="pp-image-save">
                {uploading ? (
                  <>
                    <LoaderCircle className="animate-spin" aria-hidden /> Uploading…
                  </>
                ) : current ? (
                  'Save new image'
                ) : (
                  'Save image'
                )}
              </Button>
            </>
          ) : current ? (
            <>
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={removing}
                onClick={() => void remove()}
                data-testid="pp-image-remove"
              >
                {removing ? (
                  <LoaderCircle className="animate-spin" aria-hidden />
                ) : (
                  <Trash2 aria-hidden />
                )}{' '}
                {removing ? 'Removing…' : 'Remove'}
              </Button>
              <Button
                variant="outline"
                disabled={removing}
                onClick={choose}
                data-testid="pp-image-replace"
              >
                <RefreshCw aria-hidden /> Replace
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="outline" onClick={choose} data-testid="pp-image-choose">
                <ImagePlus aria-hidden /> Choose image
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
