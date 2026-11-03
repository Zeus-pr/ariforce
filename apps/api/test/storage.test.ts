import { describe, expect, it } from 'vitest';
import { StorageService } from '../src/files/storage.service';

const C = '01930000-0000-7000-8000-000000000001';
// Presigning is local (no network): fake credentials are enough.
const svc = new StorageService({
  R2_ACCOUNT_ID: 'testaccount',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'test-secret-not-real',
  R2_BUCKET: 'ariforce-test',
});

describe('R2 storage (presigned URLs)', () => {
  it('upload URL: tenant-prefixed key, signed PUT with content-type, 10 min expiry', async () => {
    const now = new Date('2026-10-27T00:00:00Z');
    const r = await svc.uploadUrl(
      C,
      { purpose: 'doctor_photo', contentType: 'image/jpeg', sizeBytes: 1234 },
      now,
    );
    expect(r.fileKey).toMatch(new RegExp(`^${C}/doctor_photo/2026/10/[0-9a-f-]{36}\\.jpg$`));
    const u = new URL(r.uploadUrl);
    expect(u.host).toBe('ariforce-test.testaccount.r2.cloudflarestorage.com');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');
    expect(r.method).toBe('PUT');
    expect(r.expiresAt).toBe('2026-10-27T00:10:00.000Z');
  });

  it('download URL only for keys of the caller company', async () => {
    const ok = await svc.downloadUrl(C, `${C}/avatar/2026/10/x.png`);
    expect(new URL(ok.downloadUrl).searchParams.get('X-Amz-Expires')).toBe('300');
    await expect(
      svc.downloadUrl(C, '01930000-0000-7000-8000-00000000000b/avatar/2026/10/x.png'),
    ).rejects.toThrow(/not found/i);
    await expect(svc.downloadUrl(C, `${C}/../other/x.png`)).rejects.toThrow(/not found/i);
  });

  it('503 when R2 env is not configured', async () => {
    await expect(
      new StorageService({}).uploadUrl(C, {
        purpose: 'avatar',
        contentType: 'image/png',
        sizeBytes: 1,
      }),
    ).rejects.toThrow(/not configured/);
  });

  it('image URL cache never serves another company a cached URL', async () => {
    const now = new Date('2026-10-27T00:00:00Z');
    const key = `${C}/product_image/2026/10/01930000-0000-7000-8000-0000000000aa.jpg`;
    expect(await svc.imageUrl(C, key, now)).toMatch(/^https:/);
    const other = '01930000-0000-7000-8000-000000000002';
    expect(await svc.imageUrl(other, key, now)).toBeNull();
  });
});
