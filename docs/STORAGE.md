# File storage: Cloudflare R2 (presigned URLs)

Files (doctor photos, visit attachments, expense receipts, avatars) live in **Cloudflare R2** via its S3 API. Not D1, not the database. The API never proxies file bytes.

## Flow

1. Client: `POST /v1/files/upload-url` `{ purpose, contentType, sizeBytes, fileName? }` (jpeg/png/webp/pdf, max 10 MB).
2. API returns `{ fileKey, uploadUrl, method: "PUT", headers, expiresAt }` (10 min). The audit log records `file.upload_url`.
3. Client `PUT`s the bytes to `uploadUrl` with exactly `headers` (content type + length are signed).
4. Client saves `fileKey` on the owning record (e.g. a visit). That write goes through normal RBAC.
5. To view: `POST /v1/files/download-url` `{ fileKey }` returns a 5-minute GET URL. Keys from another company return 404.

Key layout: `<companyId>/<purpose>/<yyyy>/<mm>/<uuidv7>.<ext>`. The bucket stays **private**: no public bucket, no r2.dev URL.

## Env (git-ignored `apps/api/.env`, names in `.env.example`)

`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, optional `R2_ENDPOINT` (defaults to `https://<account>.r2.cloudflarestorage.com`). `R2_PUBLIC_URL` is unused while the bucket is private. Without these vars, the file endpoints return 503 `File storage is not configured`. Everything else still works.

## Bucket setup (Prajesh / ops)

- Create the bucket with location hint **APAC**. R2 has no India jurisdiction, so see the ADR residency caveat.
- API token: _Object Read & Write_, scoped to this bucket only.
- CORS on the bucket for browser uploads: allowed origins = web origin(s), methods `PUT, GET`, headers `content-type`, max age 3600. The mobile app is not subject to CORS.
- Lifecycle (later): abort incomplete uploads after 1 day; retention per DPDP (#36).

## Code

`apps/api/src/files/storage.service.ts` (AWS SDK v3 `@aws-sdk/client-s3` + `s3-request-presigner`, region `auto`), `files.controller.ts`; contract in `packages/contracts/src/schemas/files.ts`; tests in `apps/api/test/storage.test.ts` (signing is offline, no real bucket needed).
