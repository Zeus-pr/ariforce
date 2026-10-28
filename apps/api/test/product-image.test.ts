import { describe, expect, it } from 'vitest';
import { AdminProduct, Product, ProductCreate, UploadUrlRequest } from '@ariforce/contracts';
import { checkProductImageHead, isProductImageKey, sniffImage } from '../src/files/product-image';
import { StorageService } from '../src/files/storage.service';

const C = '01930000-0000-7000-8000-000000000001';
const OTHER = '01930000-0000-7000-8000-00000000000b';
const KEY = `${C}/product_image/2026/10/0192f000-0000-7000-8000-000000000abc.png`;
const MB = 1024 * 1024;
// Presigning is local (no network): fake credentials are enough.
const svc = new StorageService({
  R2_ACCOUNT_ID: 'testaccount',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'test-secret-not-real',
  R2_BUCKET: 'ariforce-test',
});

describe('product image', () => {
  it('upload-url purpose product_image: jpeg/png/webp only, at most 5 MB', () => {
    const ok = (contentType: string, sizeBytes: number) =>
      UploadUrlRequest.safeParse({ purpose: 'product_image', contentType, sizeBytes }).success;
    expect(ok('image/jpeg', 5 * MB)).toBe(true);
    expect(ok('image/webp', 1000)).toBe(true);
    expect(ok('image/png', 5 * MB + 1)).toBe(false);
    expect(ok('application/pdf', 1000)).toBe(false);
    expect(ok('text/csv', 1000)).toBe(false);
    // Other purposes keep the 10 MB limit.
    expect(
      UploadUrlRequest.safeParse({
        purpose: 'doctor_photo',
        contentType: 'image/png',
        sizeBytes: 8 * MB,
      }).success,
    ).toBe(true);
  });

  it('key must be this company product_image key minted by upload-url', () => {
    expect(isProductImageKey(C, KEY)).toBe(true);
    expect(isProductImageKey(OTHER, KEY)).toBe(false);
    expect(isProductImageKey(C, KEY.replace('product_image', 'doctor_photo'))).toBe(false);
    expect(isProductImageKey(C, `${C}/product_image/../x.png`)).toBe(false);
    expect(isProductImageKey(C, KEY.replace('.png', '.pdf'))).toBe(false);
  });

  it('HEAD check: missing, too large, wrong type, ok', () => {
    expect(checkProductImageHead(KEY, null)).toMatchObject({ reason: 'UPLOAD_MISSING' });
    expect(
      checkProductImageHead(KEY, { sizeBytes: 5 * MB + 1, contentType: 'image/png' }),
    ).toMatchObject({ reason: 'UPLOAD_TOO_LARGE' });
    expect(checkProductImageHead(KEY, { sizeBytes: 10, contentType: 'image/jpeg' })).toMatchObject({
      reason: 'UPLOAD_TYPE_INVALID', // key says .png
    });
    expect(checkProductImageHead(KEY, { sizeBytes: 10, contentType: 'text/html' })).toMatchObject({
      reason: 'UPLOAD_TYPE_INVALID',
    });
    expect(
      checkProductImageHead(KEY, { sizeBytes: 5 * MB, contentType: 'image/png; x=1' }),
    ).toEqual({
      contentType: 'image/png',
    });
  });

  it('magic bytes', () => {
    const b = (...x: number[]) => new Uint8Array(x);
    const s = (t: string) => [...t].map((c) => c.charCodeAt(0));
    expect(sniffImage('image/jpeg', b(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(sniffImage('image/png', b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true);
    expect(sniffImage('image/webp', b(...s('RIFF'), 1, 2, 3, 4, ...s('WEBP')))).toBe(true);
    expect(sniffImage('image/png', b(...s('%PDF-1.7')))).toBe(false);
  });

  it('imageUrl: same URL within a 30-min window, valid >= 30 min; null if foreign or no storage', async () => {
    const t0 = new Date('2026-10-28T10:00:05Z');
    const a = await svc.imageUrl(C, KEY, t0);
    const b = await svc.imageUrl(C, KEY, new Date('2026-10-28T10:29:59Z'));
    const c = await svc.imageUrl(C, KEY, new Date('2026-10-28T10:30:00Z'));
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    const u = new URL(a!);
    expect(u.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(u.searchParams.get('X-Amz-Date')).toBe('20261028T100000Z');
    expect(await svc.imageUrl(OTHER, KEY, t0)).toBeNull();
    expect(await new StorageService({}).imageUrl(C, KEY, t0)).toBeNull();
  });

  it('Product/AdminProduct expose imageFileKey + imageUrl (default null); create cannot set them', () => {
    expect(Object.keys(ProductCreate.shape)).not.toContain('imageFileKey');
    expect(Object.keys(ProductCreate.shape)).not.toContain('imageUrl');
    expect(Object.keys(Product.shape)).toEqual(
      expect.arrayContaining(['imageFileKey', 'imageUrl']),
    );
    expect(Object.keys(AdminProduct.shape)).toEqual(
      expect.arrayContaining(['imageFileKey', 'imageUrl']),
    );
  });
});
