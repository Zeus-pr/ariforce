'use client';

import Image from 'next/image';

/**
 * Product pictures are presigned R2 GETs. Those go through next/image (resized, WebP/AVIF, sized
 * by `sizes`); anything else (a local preview blob/data URL, or an unknown host) stays a plain <img>.
 */
const OPTIMIZABLE = /^https:\/\/[^/]+\.r2\.cloudflarestorage\.com\//;

export function ProductImg({
  src,
  alt,
  width,
  height,
  sizes,
  className,
  priority,
  ...rest
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes: string;
  className?: string;
  priority?: boolean;
  'data-testid'?: string;
}) {
  if (!OPTIMIZABLE.test(src))
    return (
      <img
        src={src}
        alt={alt}
        className={className}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        {...rest}
      />
    );
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      className={className}
      priority={priority}
      {...rest}
    />
  );
}
