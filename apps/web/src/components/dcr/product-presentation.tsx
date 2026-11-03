'use client';

import { useState, type TouchEvent } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@ariforce/ui/components/dialog';
import type { SelectOption } from './search-select';
import { ProductImg } from '@/components/media/product-img';

export function ProductPresentation({
  products,
  open,
  onOpenChange,
}: {
  products: SelectOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const current = products[index];

  const move = (offset: number) => {
    setIndex((i) => Math.min(products.length - 1, Math.max(0, i + offset)));
  };
  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    if (touchStart === null) return;
    const delta = event.changedTouches[0]!.clientX - touchStart;
    if (Math.abs(delta) > 48) move(delta < 0 ? 1 : -1);
    setTouchStart(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setIndex(0);
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="flex h-[min(100dvh,56rem)] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-slate-950 p-0 text-white sm:h-[min(100dvh,56rem)] sm:max-w-none"
        aria-describedby={undefined}
        data-testid="dcr-product-presentation"
      >
        <header className="flex items-center justify-between gap-4 border-b border-white/15 px-4 py-3 sm:px-8">
          <DialogTitle className="text-sm font-medium text-white/75">
            Product {index + 1} of {products.length}
          </DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={() => onOpenChange(false)}
            aria-label="Close presentation"
            data-testid="dcr-presentation-close"
          >
            <X aria-hidden />
          </Button>
        </header>
        <div
          className="flex min-h-0 flex-1 items-center justify-center p-2"
          onTouchStart={(event) => setTouchStart(event.touches[0]?.clientX ?? null)}
          onTouchEnd={onTouchEnd}
        >
          {current && (
            <div className="flex h-full w-full items-center justify-center">
              {current.imageUrl && (
                <ProductImg
                  src={current.imageUrl}
                  alt={current.label}
                  width={1600}
                  height={1200}
                  sizes="100vw"
                  priority
                  className="h-full max-h-[calc(100dvh-8rem)] w-full object-contain"
                  data-testid="dcr-presentation-image"
                />
              )}
              {!current.imageUrl && (
                <div className="flex max-w-4xl flex-col items-center gap-6 text-center">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/50">
                    {current.hint || 'Product detailing'}
                  </p>
                  <h2 className="text-balance text-4xl font-semibold leading-tight sm:text-6xl">
                    {current.label}
                  </h2>
                </div>
              )}
            </div>
          )}
        </div>
        <footer className="flex items-center justify-center gap-5 border-t border-white/15 px-4 py-4">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={() => move(-1)}
            disabled={index === 0}
            aria-label="Previous product"
            data-testid="dcr-presentation-previous"
          >
            <ChevronLeft aria-hidden />
          </Button>
          <div className="flex max-w-[60vw] flex-wrap items-center justify-center gap-2">
            {products.map((product, i) => (
              <button
                key={product.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show product ${i + 1}: ${product.label}`}
                aria-current={i === index ? 'step' : undefined}
                className={`size-2 rounded-full transition-[width,background-color] ${i === index ? 'w-6 bg-white' : 'bg-white/35 hover:bg-white/60'}`}
              />
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={() => move(1)}
            disabled={index === products.length - 1}
            aria-label="Next product"
            data-testid="dcr-presentation-next"
          >
            <ChevronRight aria-hidden />
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
