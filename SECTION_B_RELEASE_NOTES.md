# VisPlay — Security Remediation Release B

**Prepared for employer engineering review:** 7 November 2026

This cumulative source package contains **Section A (authentication security)** and **Section B (private streaming and preview generation)**. It does **not** include actual user database snapshots, production credentials, or user-uploaded video assets. It has **not** been deployed.

**Note:** The later cumulative **A+B+C package** supersedes these Section B upload endpoint instructions with a private quarantine and verified-session workflow. See `SECTION_C_RELEASE_NOTES.md` and `docs/SECTION_C_UPLOAD_SECURITY.md` for the current integration and deployment rules.

## Main changes in Section B

1. Movie responses now use a controlled same-origin playback address; the master URL and internal preview keys are not returned in catalogue, featured, bundle, related, creator, admin, or user-library movie data.
2. `/api/media/stream/:id?mode=preview|full` is now an HTTP range-aware video proxy, not a JSON endpoint exposing the original file. Purchases, bundle ownership, creator rights, movie publication, and admin status are checked on the server.
3. Unpaid users can receive only a separate short preview object. A JavaScript five-minute playback timer is no longer the security boundary.
4. Video uploads now target a separate private R2 bucket. Posters remain in a public bucket. The uploader returns an opaque `private://...` reference for the master, not a direct Internet URL.
5. The preview-generation worker validates H.264/AAC media, creates a 299.9-second MP4 preview, validates output length and size, and uploads it into private R2 with movie metadata.
6. The public-to-private migration utility copies legacy R2 MP4s to private storage without deleting the source or mutating the database. Admin attachment endpoints validate the private master/preview and preserve an audit event.
7. The Super Admin console now includes secure-media management controls and disables movie publication until both private objects are linked. The backend independently checks both objects at publication time.
8. Legacy local `/uploads/videos` and `/videos` paths are denied by Express. The Vite production build fails if legacy public video files are detected in those web-public locations.
9. Relevant movie/creator deletion flows also attempt to remove the private master and preview keys. Full account deletion recovery/retention workflow remains in Section E.

## Verified locally

| Check | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run build` | PASS — existing large frontend bundle warning remains |
| `npm run test:identity` | PASS: 9 tests |
| `npm run test:media` | PASS: 10 tests |
| Preview FFmpeg filter/encoder syntax smoke test | PASS |

## Required remaining acceptance work

- Provision both R2 buckets and verify the private bucket has **no** public access path.
- Configure signed direct uploads and R2 CORS with a test creator.
- Execute private object copy/preview generation/attachment in staging with real MP4s.
- Test browser byte-range seeking, purchased-bundle playback, failures/retry behavior, and performance over 3G/4G and mobile Safari/Chrome.
- Migrate/retire every legacy public master URL and verify no CDN mirror continues to serve it.
- Run account-migration acceptance from Section A and financial integrity/reconciliation gates from Section D.
- Authorize deployment only after staged restore, load, security, and business checks pass.

For complete procedures and acceptance criteria, read `docs/SECTION_B_PRIVATE_STREAMING.md` and `docs/SECTION_A_IDENTITY_SECURITY.md`.

## Reviewer setup

1. Install dependencies with Node 24 and `npm ci`.
2. Run both test suites, lint and build.
3. Fill environment settings in `.env.example` using **test-only** credentials via a secret manager. Never copy raw production passwords or Supabase service-role keys into Vite frontend variables.
4. Keep user data and assets in their existing storage services; the ZIP intentionally excludes the original local database snapshot and uploads.

**Release status: engineering implementation complete for review; infrastructure and staging verification still pending. Not safe to deploy to production yet.**
