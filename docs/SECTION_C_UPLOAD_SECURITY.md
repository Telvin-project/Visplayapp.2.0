# VisPlay — Section C: Secure Uploads, Private Quarantine and Media Validation

**Prepared:** 7 November 2026 · **Status:** Source implementation prepared for engineering review. **Not deployed or production-certified.**

Section C builds on Sections A and B. This is a security-sensitive change to creator upload APIs and requires the associated frontend, PostgreSQL migration, R2 configuration and operator workflow to deploy together. **Never deploy only the new frontend or only the backend.**

## Previous exposure and potential consequences

1. **Untracked presigned URLs:** any approved creator could repeatedly mint signed PUT requests without a persistent quota, causing object-storage cost abuse and stale uploads.
2. **Unverified size/content:** object MIME and upload size were mostly declarations supplied by the browser; uploading a renamed non-MP4, oversized object or disguised SVG was not adequately prevented.
3. **Multipart tampering:** any owner-prefixed key and arbitrary storage UploadId could be submitted, with up to 10,000 client-selected parts, duplicate/incorrect part lists and no independently verified total size.
4. **Public uninspected images:** creator-supplied images could be uploaded directly to a publicly readable bucket before scanning/normalization. Consequences include malicious content distribution, privacy metadata leaks, and unsafe client asset rendering.
5. **Legacy filesystem routes:** the app previously exposed and auto-migrated `/uploads/` files on GET requests. That behaviour could distribute unapproved local files and permit unauthorized persistence changes during viewing.
6. **Email-based channel fallback:** channel-image changes included an email-match fallback which could bypass the immutable user ID protections of Section A.

## New upload architecture

| Stage | Video (max 500 MB) | Image (max 10 MB) |
| --- | --- | --- |
| 1. Request | Verified approved creator reserves a `visplay_upload_sessions` row through a DB quota RPC | Same; image purpose is `poster`, `avatar`, or `banner` |
| 2. Stage | Signed PUT (up to 16 MB) or 8 MB multipart chunks, stored **only** under private `staging/<owner>/<session>/master.mp4` | Signed PUT into the same private bucket under `staging/<owner>/<session>/source` |
| 3. Check | Verify owner, expiration, session state, content length, MIME and MP4 container header; server checks all multipart part sizes and observed R2 ETags | Verify owner, session and size; decode permitted JPEG/PNG/WebP through Sharp with 25-million-pixel guard and reject animated/other formats |
| 4. Promote | Conditionally copy checked object using source ETag into `videos/<owner>/<session>.mp4` **in private R2** | Strip EXIF/metadata, resize to max 2200px, flatten and re-encode JPEG; only the sanitized JPEG is published to `posters/<owner>/<session>.jpg` in public R2 |
| 5. Attach | Movie submission accepts only an unused verified upload-session ID and verifies the final private object exists | Creator profile or poster submission accepts only matching purpose and an unused verified image-session ID |
| 6. Publish | Still requires Section B private-preview worker and Super Admin approval | Public JPEG may be read after sanitization, never raw uploaded bytes |

The client **cannot choose a final object key** or link a storage URL directly. The verified user ID comes from the server's signed-in account. Upload-session state is reserved and moved using PostgreSQL compare-and-swap checks; consumers claim an asset before attaching it. An uploaded file alone does **not** give a user access to any movie or admin capability.

## Database migration — mandatory before enabling uploads

1. Back up the Supabase project. Confirm Sections A/B and production Supabase Auth ownership migration are complete.
2. Apply `migrations/20261107_visplay_upload_sessions.sql` to the correct project using authorized migration credentials.
3. Verify that `public.visplay_upload_sessions` is service-role only and RLS is enabled; `anon` and `authenticated` may not select, insert or update it. Confirm only the service role may call `public.visplay_create_media_upload(...)`.
4. Test under two API instances that concurrent reservations for one user cannot exceed **three active sessions**, **30 total sessions per trailing 24 hours**, and **1 GiB of reserved bytes per trailing 24 hours**. Both a request-count and byte quota are necessary; otherwise tiny files can exhaust the upload table. These are intentionally conservative defaults, not a permanent monetization-plan decision.
5. The application fails closed if its upload-session SQL migration is missing. Do not disable this behaviour to unstick a rollout.

The global financial/account JSON-row database is still being redesigned in **Section D**. This section's separate upload-session table does **not** make financial purchases, channel metadata and object-storage writes atomic. A failed DB save may need reconciliation even when the upload itself succeeded.

## R2 deployment settings

- Set `R2_PRIVATE_VIDEO_BUCKET` to a bucket different from `R2_BUCKET_NAME`. The private bucket contains **both raw incoming images and video** while quarantined, as well as private final videos/previews; no custom public domain or `r2.dev` route is permitted.
- Keep the public bucket for **sanitized** JPEGs, logo assets and approved static images only.
- Minimize server/worker token permissions. Only your backend and worker get private R2 credentials, never React, service workers or React Native bundles.
- Use narrowly scoped R2 CORS rules on the **private** bucket: allow only VisPlay's production web origin(s), `PUT` and `HEAD`, headers required for signed uploads including `Content-Type` and `Content-Length`, and expose `ETag` for multipart completion. Verify preflight and actual uploads in Chrome/Safari on real R2. Public R2 CORS is not needed for direct creator uploads.
- Configure R2 object lifecycle deletion for **`staging/` only**, after two days; configure automatic abort of unfinished multipart uploads after no more than one day. **Never** apply this lifecycle to `videos/` or `previews/` because those contain monetized assets.
- A direct PUT URL expires after **180 seconds**. A tracked session expires after **six hours**. Parts have individually short signed URLs that must be freshly requested on retry. These are bearer URLs; keep them out of logs, analytics and error reporting.
- Signed direct PUTs include `content-type` and `content-length` in SigV4 signed headers. Multipart parts also bind `content-length`; the server still independently verifies lengths after upload. Test these signatures against the actual R2 account, browser and CORS setup before release.

Cloudflare primary references: [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/), [R2 multipart upload](https://developers.cloudflare.com/r2/objects/upload-objects/), [R2 object lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/), [R2 conditional copy](https://developers.cloudflare.com/r2/api/s3/api/).

## Antivirus, content scanning and preview-processing

- The worker's `scripts/generate-preview.ts` now calls `scripts/media-malware-scan.ts` **before FFprobe/FFmpeg**. With `NODE_ENV=production`, the worker refuses to process any video if `MEDIA_MALWARE_SCANNER` is not configured. The vetted initial command is ClamAV's `clamscan`, installed and maintained on the worker host. It sets scan size limits above the 500 MB app limit and enables `--alert-exceeds-max=yes` so ClamAV cannot silently label a skipped oversized file clean. Other scanner binaries require a separately reviewed adapter. [ClamAV scanner limits](https://docs.clamav.net/manual/Usage/Scanning.html).
- Update virus signatures daily, log results without sensitive URLs, and alert on scanner errors and infected files. A successful file-header check is not a malware scan or a full codec validation.
- FFprobe and FFmpeg are limited to file protocols and have processing timeouts. Run the worker in an isolated, resource-capped container with restricted egress and bounded temp disk; it must not share privileges with the payment backend.
- Do not publish a new video until a successful independent preview is generated, its full content is reviewed, rights are confirmed and the admin approves it. This is enforced by Section B's publication checks.
- Image processing uses Sharp with pixel and output limits, still-image format allowlisting and re-encoding. This is safer than publishing raw uploads, but it is not a substitute for dependency patching and a penetration test.

## Daily operations and abandoned-upload cleanup

1. Run `npm run media:cleanup` on an authorized operator host to inspect **expired, unconsumed** upload sessions (dry-run by default). Review its sample and confirm all referenced assets are preserved. This must be done during a controlled maintenance window using a consistent database snapshot.
2. When approved, run `MEDIA_CLEANUP_APPROVED=yes npm run media:cleanup -- --apply`. It uses only owner/session-derived keys, aborts old multipart uploads and removes abandoned private staging and unreferenced final assets. It does not delete consumed assets.
3. A referenced-but-unconsumed session is preserved and flagged for manual reconciliation. A record that changes state concurrently is skipped. An interrupted cleanup is repeatable; monitor results.
4. R2 lifecycle rules independently delete stale `staging/` objects and abort abandoned multipart uploads even if the operator job does not run. Store cleanup logs securely; do not print signed URLs.
5. Monitor creator quota denials, R2 4xx/5xx, bytes uploaded, number of unfinished multipart uploads, rejected MIME/types, virus detections, and image conversion failures. Alert if private keys appear in client analytics or logs.

## API integration contract (v1)

| Action | Request | Response |
| --- | --- | --- |
| Start single | `POST /api/movies/upload-url` with `folder`, `usage`, `filename`, `contentType`, **integer** `size` | `{sessionId,uploadUrl,multipart:false,expiresAt}` |
| Start large MP4 | `POST /api/movies/multipart/init` with same fields | `{sessionId,multipart:true,partCount,partBytes,expiresAt}` |
| Sign next chunk | `POST /api/movies/multipart/part-url` with `sessionId`, `partNumber` | `{uploadUrl,partBytes}` |
| Complete large MP4 | `POST /api/movies/multipart/complete` with `sessionId` and an array of `{PartNumber,ETag}` | `{sessionId,assetRef}` after R2 ListParts, copy and verification |
| Complete single | `POST /api/movies/uploads/complete` with `sessionId` | `{sessionId,assetRef}` after byte and type validation |
| Abort | `POST /api/movies/multipart/abort` with `sessionId` | `{ok:true}` |
| Submit film | `POST /api/movies/upload` (metadata form) with `video_upload_id`, optional `poster_upload_id` | Pending movie, or 4xx/5xx; direct `video_url`/`poster_url` is rejected/ignored |
| Update channel image | `PATCH /api/creators/my-channel/media` with `{kind:"avatar"|"banner",image_upload_id}` | Channel profile if the correct verified upload is unconsumed |

The new frontend performs all completion and attachment steps. **Old frontend versions are intentionally incompatible**; deploy together. There is no API that will accept arbitrary external full-video URLs in place of a verified session.

## Automated local checks

- `npm run test:identity` — Section A authentication anti-takeover tests.
- `npm run test:media` — Section B public catalogue and private stream access tests.
- `npm run test:uploads` — Section C sessions, request parsing, signed headers, image sanitization, decompression bombs, private video promotion, multipart integrity and unauthenticated upload requests.
- `npm run lint` and `npm run build` — TypeScript and Vite. Vite now refuses to include any files/symlinks from `public/uploads` or `public/videos` in a production web build.

The tests mock R2 or sign URLs locally; **they do not establish real Cloudflare R2 or PostgreSQL readiness**.

## Required staging acceptance (all unchecked until employer executes)

- [ ] SQL schema applied; RLS/permissions checked with `anon`, `authenticated`, and service roles.
- [ ] Two creator logins, two API pods and concurrent upload quota/owner isolation tested.
- [ ] Private staging and final video bucket has no public `r2.dev`, domain or cache bypass path; direct anonymous GET is forbidden.
- [ ] Direct 1 MB JPEG and 15 MB MP4 signed PUTs succeed with real browser CORS; altered signed Content-Type/Length fails or is independently rejected.
- [ ] 100–500 MB multipart upload from real Nigerian 3G/4G network succeeds; disconnect/retry/abort behaves safely; duplicated, wrong-size and out-of-range parts are rejected.
- [ ] SVG, HTML, ZIP-as-MP4, wrong extension/MIME, animated images, decompression bombs, corrupt and oversized objects are rejected without public exposure.
- [ ] Original EXIF/GPS metadata is not present in any public sanitized poster/avatar/banner.
- [ ] Malware scanner with fresh signatures rejects EICAR test fixture in controlled staging, fails closed when absent, and accepts clean video (without exposing the test fixture publicly).
- [ ] Real FFprobe/FFmpeg worker in a sandbox validates several H.264/AAC movies; generating/attaching a preview permits admin publication only after review.
- [ ] Automatic staging lifecycle and multipart abort rules configured and verified; cleanup dry-run, reconciliation, approval and rollback rehearsal completed.
- [ ] Legacy `/uploads` posters/videos migrated and all public full-video URLs revoked; unsupported external sample URLs handled manually.
- [ ] No direct storage URL, signing material or private key is logged or exposed through client/admin/analytics JSON.
- [ ] Financial writes, pending entitlements and deletion flow pass the later Section D/E gates; independent SAST/DAST and penetration test complete.

**Release decision:** Section C source changes are complete for review. **Do not release to real customers** until the SQL migration, real-bucket tests, malware-scanner configuration and all acceptance gates are complete. This package remains subject to Sections D onward for financial/global-market readiness.
