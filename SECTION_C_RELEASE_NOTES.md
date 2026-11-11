# VisPlay — Cumulative Security Fixes: Sections A, B and C

**Employer engineering review copy — 7 November 2026. Not deployed.**

Included remediation work:

- **Section A:** verified Supabase Auth IDs, blocked legacy password/demo login, protected admin and creator identities, checked account deletion ownership.
- **Section B:** paid server-side streaming entitlement checks, private movie storage, independent 299.9-second preview worker, private legacy migration and admin attachment tools.
- **Section C:** private upload quarantine, durable production upload sessions and per-owner quotas, signed length/MIME constraints, exact multipart validation, R2 conditional promotion, sanitized public JPEGs, anti-replay creator attachments, antivirus-gated preview worker, safe abandoned-upload cleanup, no local `/uploads` leaks or automatic on-GET migration.

## Installation and verification

1. `npm ci` (Node 24 recommended).
2. `npm run test:identity`
3. `npm run test:media`
4. `npm run test:uploads`
5. `npm run lint`
6. `npm run build`

New environment, database and storage prerequisites are described in `docs/SECTION_C_UPLOAD_SECURITY.md`. Apply `migrations/20261107_visplay_upload_sessions.sql` **only** after a database backup, permission review and staging rehearsal.

## Important deployment blockers

- The ZIP contains **source code only**, no credentials, database snapshot, user-generated videos or real production bucket changes.
- Real Cloudflare R2 CORS/multipart/presigned uploads, actual antivirus integration, isolated FFmpeg processing and PostgreSQL migration have **not** been executed here.
- The original JSON-row persistence model still needs financial atomicity and reconciliation remediation in **Section D**; video deletion/retention and global privacy readiness remain later sections.
- Existing movie records with public URLs need coordinated migration before legacy URLs are removed. Source-only fixes do **not** invalidate CDN caches or recalled downloads.
- App Store/Play Store payment rules, mobile-native UI and account deletion review are separate release gates; **no immediate store acceptance is guaranteed**.

This engineering package is **for controlled staging verification and employer review, not immediate production deployment**.
