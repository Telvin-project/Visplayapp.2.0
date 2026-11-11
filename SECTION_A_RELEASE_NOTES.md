# VisPlay — Security Remediation Release A

**Prepared for employer engineering review** — 6 November 2026

This package contains the isolated VisPlay source with the **first fix section (identity and sign-in security)** implemented. It is **not a production release**.

## What was changed

- Removed unverified local account creation and password-based login routes (both now return 410).
- Redirected email registration/login through Supabase Auth with email-confirmation requirements.
- Prevented account/creator/admin/wallet takeover through email-only matching: verified accounts use immutable Supabase Auth IDs.
- Required existing accounts to undergo an approved ownership-verification and account-binding migration.
- Invalidated legacy JWTs lacking a bound provider ID, and removed session JWT exposure from sync JSON.
- Removed automatic admin elevation from hard-coded email addresses and disabled default demo passwords in new seeds.
- Bound Auth account deletion to verified provider ID instead of searching Supabase identities by email.
- Restricted browser-supplied Supabase project overrides to local development.
- Repaired TypeScript contract mismatches and fixed duplicate creator publication notifications.
- Corrected the Vite/esbuild version mismatch and Vite config path warning.

## Checks run

| Check | Result |
| --- | --- |
| `npm run test:identity` (unit + live HTTP protection) | **PASS: 9/9** |
| `npm run lint` (`tsc --noEmit`) | **PASS** |
| `npm run build` | **PASS** (bundle size warning remains) |
| `npm audit --omit=dev --audit-level=high` | **PASS: 0 reported production dependency advisories** |

These local checks do **not** verify the real Supabase email sender, OAuth redirect, existing-user migration, fraud/abuse controls, production scaling, payments or app-store acceptance.

## Files intentionally NOT included in the employer package

- The original uploaded `data/visplay_db.json` snapshot, which may contain personal, financial or authentication records.
- Git history, tooling cache, internal `.aistudio` artifacts, production/user media uploads, local `.env` secrets, `node_modules`, and built outputs.
- The original `bun.lock` is excluded because it does not reflect the corrected npm dependency graph. `package-lock.json` is the reproducible lockfile for this package.

## Installation for a development reviewer

1. Use Node.js 24 or an engine version supported by Vite 8.
2. Run `npm ci` (using the included `package-lock.json`).
3. Run `npm run test:identity`, `npm run lint`, and `npm run build`.
4. Copy `.env.example` to a local ignored `.env` and configure **test-only** keys as described; never copy production secrets into the browser.
5. **Never** deploy this source over existing accounts until the steps in `docs/SECTION_A_IDENTITY_SECURITY.md` are completed and signed off.

## What comes next

- **Section B:** server-enforced streaming entitlements and private video delivery.
- **Section C:** R2 upload/deletion ownership and upload security.
- **Section D:** financial ledger integrity, Paystack webhooks, refunds and reconciliation.
- **Section E:** comprehensive account deletion, personal-data rights, wallet balances and legal retention.
- **Section F:** global UX, privacy, accessibility, security hardening and moderation.
- **Section G:** true React Native app, compliant platform-specific purchase flows, store submissions.
- **Section H:** staging/penetration/load tests, compliance and final production acceptance.
