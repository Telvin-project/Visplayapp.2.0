# VisPlay — Section A: Identity and Account Access Security

**Status:** implementation prepared in an isolated source copy; identity unit tests passing. **Not deployed or approved for production.**

## Delivered in Section A

| Security defect | Remediation | Result |
| --- | --- | --- |
| Anyone could create a local account using another person's email and immediately receive an authenticated cookie | Disable `/api/auth/register` (HTTP 410); register through Supabase Auth with email confirmation | The app does not issue a VisPlay account/session before confirmed sign-in |
| Seeded passwords and legacy password endpoint could grant access to demo creator/admin accounts | Disable `/api/auth/login` (HTTP 410); email login through Supabase `signInWithPassword`; remove demo password hashes from new seed | Unverified legacy credentials cannot issue fresh sessions |
| A Google login using the same email could inherit a pre-claimed account, wallet, creator role, or admin role | Bind accounts to a verified `supabase_auth_id` and reject an email-only match (HTTP 409) | Existing accounts require deliberate migration; new accounts start as viewer |
| Admin status was automatically granted to hard-coded email addresses | Remove automatic admin promotion from sign-in | Administrator provisioning must be approved out of band |
| Previously minted legacy JWTs still authenticated users | Require the signed JWT `authId` to match the stored Supabase Auth ID | Old cookies and tokens are refused by the revised middleware |
| An application JWT was returned in JSON as well as set in a cookie | Stop returning token in synchronization JSON | VisPlay session token is only written to an HttpOnly cookie |
| Deletion searched for Supabase accounts by email address | Bind deletion to the user's verified Supabase Auth ID | Avoids deleting an unrelated Auth identity if email ownership changes |
| Production browser could replace the Supabase endpoint/key from local storage | Restrict custom Supabase credentials to development mode | Provider configuration is controlled by deployment settings |

### Intended flow

1. **Email registration:** request Supabase email sign-up, send confirmation link, show “check your email,” and create **no** VisPlay session yet.
2. **Email sign-in:** Supabase validates password and confirms the email. Its access token is sent to `/api/auth/supabase-sync`, which verifies the token server-side.
3. **Google sign-in:** Supabase handles Google OAuth, then the same verified token synchronization occurs.
4. **Account matching:** use Supabase Auth user ID. New verified identities get `viewer`. If the email already belongs to an unbound legacy account, **deny automatic linking** and show a support/migration message.
5. **Web session:** backend signs an application JWT tied to both internal user ID and Supabase Auth ID and sends it as a `Secure` (production), `HttpOnly`, `SameSite=Lax` cookie.

## Required operator steps BEFORE applying the revised code to any environment with real users

1. **Inventory and back up every environment.** Export authenticated user records, role assignments, creator profiles, wallets, purchases, ledger events, payment records, Supabase Auth users, and the current JSON database snapshot. Validate that backups restore successfully in staging. Do not run a destructive seed or reset.
2. **Configure one Supabase Auth project per environment.** Add frontend `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The frontend and backend must point to the same project. Never publish the service-role key.
3. **Enable `Confirm email` in Supabase Authentication.** Configure a production email sender/SMTP, verified sending domain, valid Site URL, and approved web redirect URLs; verify delivery, expiry, and resend/rate-limit behavior. Test recovery and Google OAuth. If confirmation is disabled, the new registration flow fails closed but a production deployment is still misconfigured.
4. **Migrate existing users without email-only auto-merging.** For every legacy account, establish ownership through a documented identity check and reviewed proof (for example, a verified email account plus historical payment evidence for wallets). Find its provider-generated immutable Supabase Auth user ID; write that ID to the *same existing VisPlay user record* as `supabase_auth_id`. Require two authorized reviewers for any admin, creator, positive-balance, or paid-entitlement account; preserve user ID, balance, role, purchases, payout history, and ownership relations. Record the operator, date, evidence reference, and before/after hashes in a private migration log. Do not blindly link from email alone.
5. **Admin and creator access:** remove or isolate seeded demonstration accounts from production. Admin roles must be provisioned by an approved internal process with MFA; creator roles require prior identity/rights review. Do not let new verified registrations choose their own roles. Keep at least two controlled administrator accounts before allowing admin account deletion.
6. **Invalidate existing tokens:** the new `authId` JWT check rejects old tokens, but also rotate `JWT_SECRET` during controlled release and have all users sign in again. Inform users about the migration/sign-in requirement before launch.
7. **Stage and rehearse:** run the migration against a restored copy of production data; compare exact account counts, purchase entitlements, wallet totals, admin/creator grants, and owner-mapped media before/after. Include rollback and incident-response steps approved by the employer.
8. **Only then deploy:** turn on logs/alerts for 409 migration conflicts and 401 sync failures, with no auth tokens, passwords, or identifying payloads in logs. Roll out gradually and monitor user support tickets.

**Important compatibility notice:** Without steps 1–7, existing password-only users will be locked out (by design) and should not be asked to create a second account. This change must not be deployed over live accounts without a controlled migration.

## Section A acceptance tests

### Automated in this package

Run `npm run test:identity` (Node.js 24). The eight tests cover new account decisions, refusal to inherit legacy admin/creator roles, refusal to attach a different provider ID, safe handling of email changes, and duplicate identity fail-closed behavior.

### Requires staging infrastructure — not yet certified

- [ ] `/api/auth/register` and `/api/auth/login` return HTTP 410 regardless of supplied account/password.
- [ ] A new unverified email cannot use protected API endpoints or obtain a VisPlay cookie.
- [ ] Verified email signup → email link → sign-in → server token verification creates exactly one viewer account.
- [ ] Google OAuth on an existing email+provider ID resumes exactly that account.
- [ ] Email address already belonging to a *different or unbound* account returns HTTP 409; its wallet, videos, and privileges do not transfer.
- [ ] Old JWTs without `authId`, expired JWTs, and tampered JWTs are refused by protected routes.
- [ ] Browser sessions survive expected refreshes and expire correctly; sign-out clears cookie and Supabase session.
- [ ] User deletion targets only the logged-in account's immutable provider ID.
- [ ] MFA is enforced for staff/admin users; credential stuffing protection, IP/email throttling, CAPTCHA/bot controls, session renewal and reset flows are verified.
- [ ] The production frontend cannot override the Supabase project from local storage.
- [ ] Mobile and desktop browser checks: Chrome, Safari, Firefox, iOS and Android web views; keyboard, autofocus, accessibility and email-link return handling.
- [ ] No auth tokens or private profile fields leak into public responses or logs.

## Still open after Section A — production blockers

1. **Premium media entitlement protection:** private video delivery and server-enforced playback authorization.
2. **R2 asset ownership and upload safety:** scoped deletion, content validation, object storage privileges and bounded streaming uploads.
3. **Financial integrity:** replace single-JSON-row accounting with transactional tables, idempotent Paystack webhook/verification, reconciliation, refunds and ledger controls.
4. **Account deletion:** reauthentication/step-up before destructive requests, queued deletion workflow, payouts/balances, data retention, user communication and recovery from partial failures.
5. **Platform/API security:** CSRF, rate limiting, server-side role checks throughout, audit logs, secret handling, vulnerability management, session lifecycle, moderation and privacy.
6. **Design and accessibility:** usability, responsive states, WCAG checks, international phone/localization, error/offline/loading states, accessibility and user support.
7. **iOS/Android release:** genuine React Native app experience and the *store-specific* payment rules; linking outward to Paystack for digital content is **not** universally permitted, even when payment occurs in the browser. A consumption-only app is the safer initial default pending current policy review.
8. **Verification:** real provider/payment/staging integrations, security regression suite, dependency and supply-chain audit, load test, app-store compliance review and employer acceptance.

**Release gate:** Section A code is a remediation milestone, not a declaration that VisPlay is production-ready. Never deploy these changes without migration, environment setup and the staging tests above.
