# VisPlay — Section B: Private Movies and Real Five-Minute Previews

**Implementation prepared:** 7 November 2026. **Not deployed or production-certified.** Employer has approved private video storage and a preview-generation workflow.

> **Section C update (7 November):** The upload-related API steps below described Section B's intermediate design. The cumulative A+B+C package now requires a verified upload-session ID, uploads **all raw media** to private `staging/`, and only promotes verified MP4s or sanitized JPEGs. The complete current frontend/backend contract and operational instructions are in [Section C](SECTION_C_UPLOAD_SECURITY.md). Section C also disables automatic media migration during catalogue GET requests.

## Why this section is mandatory

Previously, public movie APIs and the streaming API returned `video_url` pointing to full playable MP4s. A JavaScript-only five-minute limit did not stop someone from copying the URL or requesting later bytes directly. The old R2 public bucket (or legacy local `/uploads/videos/` path) could bypass payment entirely.

## New architecture and boundaries

| Asset or operation | Where it lives | Who can access it | How |
| --- | --- | --- | --- |
| Full movie MP4 | Dedicated **private** R2 video bucket | Verified purchasers (movie or bundle), approved owner, administrator | Same-origin `/api/media/stream/:id?mode=full`; purchase checked on every request |
| First 299.9 seconds | Separately transcoded MP4 in the **same private** video bucket | Everyone if the movie is published | Same-origin `/api/media/stream/:id?mode=preview`; returns only the short preview object |
| Poster/thumbnail/avatar | Separate public R2 bucket | Public | Public asset URL |
| Creator master upload | Private R2 via time-limited signed PUT or multipart upload | Approved creator, scoped to their own upload prefix | Server signs an upload for `videos/<user-id>/<random-uuid>.mp4` |
| R2 credentials | Secrets on backend and worker | Operator services only | Never sent to browsers or React Native |
| Catalogue movie DTO | VisPlay REST API | Public metadata | Full storage URL is replaced by same-origin stream route; preview key is omitted |

The stream gateway supports HTTP byte ranges for seeking and sets `Cache-Control: private, no-store`. It returns **403** for unpaid full playback, **423** when a legacy video or preview is not yet safely available, and **404** for unpublished movies requested by strangers. No raw private object key or signed R2 GET URL is sent to the browser.

**Important infrastructure reality:** Merely using a private URL *inside the app* is not secure if the storage bucket still has an enabled public custom domain or `r2.dev` URL. Cloudflare explicitly documents that these are independent access paths. Disable *all* public access to the private video bucket and test from an unsigned/incognito client. [Cloudflare public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) · [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/).

## Production environment prerequisites

1. Create a public R2 asset bucket and a separate private R2 premium-video bucket; keep `R2_PRIVATE_VIDEO_BUCKET` different from `R2_BUCKET_NAME`.
2. On the private bucket, disable public development URL (`r2.dev`), remove/disable public custom domains and any other unauthenticated access paths. Test a random private key from another network and expect 403/404.
3. Restrict R2 API tokens to the required buckets/actions; isolate service credentials in server and worker secret managers. Rotate any credentials previously exposed to the browser or source code.
4. Configure `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PRIVATE_VIDEO_BUCKET`, `R2_BUCKET_NAME`, and `R2_PUBLIC_BASE_URL` on server/worker. Do not add `VITE_` to private credentials.
5. Configure R2 CORS for direct creator uploads: intended site origin(s), PUT/HEAD, required upload headers, and ETag exposure for multipart. Never use broad wildcard production origins for authenticated media APIs. [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/).
6. Provision a dedicated preview-worker instance with FFmpeg/FFprobe, adequate CPU, bounded temporary disk space (at least source size plus output and headroom), job timeouts, retries and cleanup. The CLI provided here performs **one movie at a time**; for global traffic, use an authenticated queue and idempotent job registry before automatic operation.
7. Retain a clean backup of Supabase application state and all public R2 objects. Coordinate the rollout with Section D's transactional persistence remediation so object attachment is never lost to concurrent writes.

## New film submission: operator and creator flow

1. Creator signs in with their verified account and is approved.
2. Creator uploads `video/mp4` through `/api/movies/upload-url` or the multipart endpoints; these now send **video** objects to the private bucket. `publicUrl` for a video is now an internal `private://videos/<creator-id>/<uuid>.mp4` reference, **not** an Internet URL. Posters still use the public asset bucket.
3. Creator submits `/api/movies/upload` with this private reference. The server verifies owner prefix, object existence, MP4 MIME and maximum length, then creates a **pending** movie. Large video files may not be sent as a normal multipart form through the app server.
4. An operator runs `npm run media:preview -- <movie-id>` in a worker environment. The job downloads the master to temporary disk; validates H.264/AAC, generates an independent H.264/AAC MP4 lasting at most 300 seconds; verifies its duration/size and uploads it under `previews/<movie-id>/<uuid>.mp4` with ownership metadata.
5. The worker prints a `preview_private_key`. An authorized administrator reviews the video and enters that reference in the Super Admin **Secure media** control (or calls `POST /api/admin/movies/:id/attach-preview` with `{ "preview_private_key": "previews/<movie-id>/<uuid>.mp4" }`).
6. `POST /api/admin/movies/:id/review` with `action: "publish"` now refuses to publish unless both master and preview exist in private storage and the preview's object metadata matches the movie. Review rights/content licensing separately.
7. Test anonymous preview, a real successful purchase, full playback, seeking/range requests, cancellation, device switching and revocation scenarios in **staging**.

## Moving existing public videos without losing customer entitlements

**Do not erase the old bucket or alter a creator's account ID, purchase, wallet, or ledger entries.** Do this per movie during a scheduled migration window:

1. Export/verify backups, establish a migration inventory with movie ID, creator owner, old public object key, status and current purchases. Freeze conflicting media edits.
2. Run `npm run media:migrate -- <movie-id>` from a trusted operator workstation with server-only R2 credentials. It copies an existing MP4 from the configured public R2 bucket to a new private key using R2's S3 `CopyObject`. It does **not** delete the source or modify the database. External demo URLs and legacy local files require separate manual ingestion.
3. Verify the private object's length, MIME, playback and owner relationship. Have a second operator approve the migration for monetized media.
4. Enter the private reference in the Super Admin **Secure media** control (or call `POST /api/admin/movies/:id/attach-private-master` with `{ "private_video_url": "private://videos/<owner-id>/<uuid>.mp4" }`). The server re-checks the object and resets any old preview.
5. Generate/attach the new private preview using the steps above. Check that purchases still grant full access, and strangers cannot access the master.
6. **Only after validation**, remove the legacy source video from public storage and purge relevant public CDN caches. Review any alternate public domains, stale links, direct uploads and external mirror URLs. Previously downloaded copies cannot be recalled.
7. Record source/destination keys, checksums where feasible, approval, time, removal confirmation, playback tests and rollback evidence in a private migration log. Monitor storage usage and streaming errors.

## Security and functional regression gates

- [x] No public catalogue, bundle, featured, related, creator or user-library movie DTO returns a storage master URL (automated HTTP test).
- [x] Unknown/unpaid viewers cannot request full movie playback (authorization unit and live API tests).
- [x] Paid movie and purchased-bundle entitlements are evaluated separately per user (unit tests).
- [x] Unpublished movies are not playable by strangers; forged browser flags do not affect server authorization (unit tests).
- [x] Legacy public-only movies fail closed rather than leaking the old full URL (unit and live API tests).
- [x] Video upload code separates private masters from public posters; publication requires both assets (source validation).
- [x] Super Admin UI shows linked private-master/preview status and allows authorized attachment with server-side validation.
- [ ] Real R2 signed PUT/multipart upload tested against both buckets with proper CORS/ownership.
- [ ] Real `GetObject` / `HeadObject` video streaming tested for full and preview, Range 206, invalid Range 416, HEAD, disconnection and expired users.
- [ ] FFmpeg worker completes 5-minute previews for representative H.264/AAC MP4s and rejects malformed/unplayable content.
- [ ] Existing paid movie migrated and its original public URL disabled and tested from an unauthenticated browser.
- [ ] Creator ownership, support/admin permissions, video moderation, rights licensing and object lifecycle reviewed.
- [ ] CDN response headers, bandwidth limits, playback latency, S3 request costs, streaming concurrency and anti-scraping abuse controls measured.
- [ ] Mobile Safari, Android Chrome, slow Nigerian mobile networks and low-memory devices pass seeking/rebuffering tests.
- [ ] Transactional state and deletion cleanup migration are verified in Section D/E, including retries and partial failures.

## Limits and open engineering work

- **No DRM**: A browser-accessible stream is not a guarantee against screen recording or an authorized user's copying. For premium licensed catalogues, evaluate HLS/DASH with platform DRM (Widevine/FairPlay) and rights/geo restrictions as a later media-platform upgrade.
- **Global scale:** the Express gateway relays byte ranges, so backend bandwidth and concurrency need load tests and possibly a Cloudflare Worker/edge authorization service. Never restore a public bucket to reduce costs.
- **Upload abuse:** while new uploads are owner-scoped and size-checked at submission, presigned PUT and multipart creation still need quota enforcement, upload-session tables, content validation, malware checks, multipart lifecycle cleanup and rate limits in **Section C**.
- **Financial model:** existing JSON-row database writes need transactions/outbox and reconciliation; purchase entitlement source must be hardened as **Section D** before release.
- **Preview generation:** the included CLI does not auto-update movie state; a production queue and operator approval are required. This avoids an uncontrolled background process and keeps file-copy and financial migration reversible.

**Release decision:** Section B code can be reviewed and tested in staging. It is **not production-ready** until the checklist's live R2, worker, and legacy-public-URL gates pass.
