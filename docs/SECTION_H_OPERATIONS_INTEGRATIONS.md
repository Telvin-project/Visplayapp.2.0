# Section H — VisPlay Staging Operations and Provider Integration Playbook

**Edition:** 11 November 2026. **Intended readers:** employer with no technical experience, authorized deployment engineer, DBA, finance approver, safety lead. **Actual hands-on status:** ALL `NOT RUN`. **No real funds, customer data or production changes are authorized by this document.**

Use the companion `docs/VISPLAY_COMPLETE_NOVICE_TEST_RUNBOOK.md` for the full A–J project. This page covers Section H evidence and the exact division between safe owner clicks and privileged work. Dashboard names may change. If you do not see the named control, **STOP**, photograph only the nonsecret page header, and ask the engineer; do not guess or select an unrelated button.

## 1. Before opening a dashboard

**OWNER — fill out the following in a private project notebook, without passwords or API keys.**

| Field | Blank for employer | Safety rule |
| --- | --- | --- |
| Company owner / emergency phone | __________________ | Human must answer test alert |
| Lead engineer / DBA / finance approver | __________________ | Separate finance approval from engineering |
| Staging frontend HTTPS URL | __________________ | Must contain the staging web domain |
| Staging API HTTPS URL | __________________ | Must be the API host, not a random demo |
| Staging Supabase project NAME | __________________ | Never reuse production |
| Staging R2 public/private bucket NAMES | __________________ / __________________ | Must be two different buckets |
| Staging Paystack merchant NAME | __________________ | Must show **Test Mode** |
| Test-mailbox support/copyright/privacy contacts | __________________ | Must be monitored |
| Written change ticket and approved test window | __________________ | Engineer controls privileged steps |

**Red lines:** A successful Node test is not a connected server. A green liveness page is not financial readiness. A matching fake JSON template is not reconciliation. No one may turn financial migration approval on just to make the server boot. Keep production and staging separate. Save evidence outside public Git and redact names, emails, wallet IDs, API keys, cookies and account numbers.

## 2. Source-only exercises a novice can watch now (no cloud change)

1. **H-S01 / OWNER:** In Windows **File Explorer**, find the delivered `VisPlay_Security_Remediation_Sections_A_to_H_...zip`. Right-click → **Extract All**. Open the extracted folder in **VS Code → File → Open Folder**. Verify `package.json`, `migrations`, `server`, `docs`, `.github/workflows` appear on the left. If not, `BLOCKED`.
2. **H-S02 / ENGINEER:** In **VS Code → Terminal → New Terminal**, run `npm ci`. When it finishes, run `npm run test:all`. Save a screenshot showing **85/85** passing tests across eight groups and web build. No deployed service is contacted. If failures occur, mark `FAIL` and do not continue to financial setup.
3. **H-S03 / OWNER:** Ask the engineer to run `npm run ops:preflight`. If done without staging credentials it should say **local** and warn that a local check does not qualify providers. This is the correct result. Never enter or paste a secret in the chat to make this command pass.
4. **H-S04 / OWNER:** Ask the engineer to run `npm run ops:reconcile -- docs/SECTION_H_FINANCE_EVIDENCE_TEMPLATE.json`. The sample result should have no detected discrepancies **because the sample is fabricated to match itself**. This result must be labeled `DEMO ONLY`; write `NOT RUN` for actual Paystack/bank reconciliation.
5. **H-S05 / DBA + FINANCE:** For real evidence, use separately approved exported canonical ledger, Paystack transactions/settlements and bank receipts in a controlled computer. Map the original provider units correctly (`NGN` vs `kobo`). Use the CLI **offline** on a protected file. A mismatch is `BLOCKED`. Even zero detected mismatches does **not** confirm completeness, payout execution, reconciliation approval or lawful funds provenance. An independent finance signer must compare source counts/periods, refunds, chargebacks, pending liabilities and statement completeness.

## 3. Create an isolated Supabase staging project

**H-01 / OWNER + ENGINEER; do not run SQL as a novice.**

1. Open [Supabase Dashboard](https://supabase.com/dashboard). Log into the company organization. In the left/top project selector, click **New Project**. Choose an employer-controlled organization. Enter a name such as `VisPlay-STAGING` and select an approved region. Give the engineer the **project name only**.
2. Ask the DBA to back up any existing candidate staging data before altering schema. The DBA must verify the restore process using a disposable **different** staging target; the presence of a Backup button is not restore proof.
3. In the left menu choose **SQL Editor → New query**. The DBA, with change ticket approval, opens and peer-reviews each local file, in order: `20261107_visplay_upload_sessions.sql`, `20261107_visplay_financial_core.sql`, `20261111_visplay_app_state_revision.sql`. The last adds revision/CAS to `visplay_app_state`; it does not normalize safety data or import customer money.
4. **DBA:** Execute only after confirming project header `VisPlay-STAGING`, snapshot, correct roles and migration dependencies. Verify app-state `revision` exists and the `visplay_commit_app_state` RPC cannot be called by anon/authenticated roles. Keep finance `migration_approved=false` until approved source migration and independent reconciliation. Run attempted-conflict tests in **disposable** staging.
5. Return to **Project Settings / Connect / API Keys**. The engineer copies public URL/public key into frontend secrets/settings and private service-role key into the **server-only** secret manager, without screenshots or chat messages. Staging API and web **must share the same Supabase project URL**. A project mismatch is `FAIL`.
6. **OWNER:** Ask the engineer for two authorized staging users. Test email verification, sign-in, role isolation and deletion from Phase 3/7. Do not test with an existing real user. Record H-01 as `PASS` only after test screenshot, RLS verification, isolated restore evidence and engineer sign-off exist.

**Do not automatically copy the original local JSON snapshot into Supabase.** Its financial values and inherited identity ownership contain audit blockers. A normalized safety/creator/social state migration and transactionally durable log remain outstanding engineering work.

## 4. Cloudflare R2: isolate assets, private masters and preview worker

**H-02 / OWNER watches; ENGINEER operates.**

1. Open [Cloudflare Dashboard](https://dash.cloudflare.com/) → company account → **R2 Object Storage → Overview**. Click **Create bucket** twice: one named `visplay-staging-assets`, another `visplay-staging-private` or approved equivalent. If both names or access policies match, `FAIL`.
2. Select the **private** bucket → **Settings**. Disable **Public Development URL (`r2.dev`)** and ensure there is no custom public domain. Only the public-artwork bucket may have a reviewed public URL.
3. Engineer creates separate **bucket-scoped server/worker tokens** through R2 API token controls. In the secret manager set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PRIVATE_VIDEO_BUCKET`, and `R2_PUBLIC_BASE_URL`. Secret values never go into a `VITE_` browser variable or test report.
4. On the private bucket's **CORS Policy** area, allow the exact approved staging frontend origin and only the signed-upload methods/headers needed. Do not enable wildcard origins or public film reads. Engineer runs real browser preflight and multipart tests, including interrupted upload and abort.
5. Open **Lifecycle rules** for the private bucket. Add time-limited cleanup **only under the abandoned `staging/` prefix** and abort incomplete multipart sessions. Never delete `videos/` (approved film masters) or `previews/` using the abandoned-upload rule. Have a second engineer review the prefix and timing before saving.
6. Engineer deploys a limited, isolated preview worker with FFmpeg/FFprobe, updated malware scanner and protected temporary disk. Run the approved preview generator on a company-owned small sample; compare duration, media type and both private keys. Verify a signed-out browser cannot fetch the master directly. Do not transfer a customer movie during this demonstration.
7. **OWNER:** In **Super Admin Portal → Movie Moderation**, confirm independent rights and age review plus private master and preview references are required before publication. Do not click Publish when any check is missing.

**H-02 outcome:** `PASS` requires private direct-URL denial, an isolated clean-preview workflow, scanner-fail-closed case, actual signed upload, lifecycle evidence and real engineer test results. R2 bucket creation alone is only a partial setup.

## 5. Paystack test configuration and finance STOP gate

**H-03 / OWNER, ENGINEER, separate FINANCE APPROVER.**

1. Open [Paystack Dashboard](https://dashboard.paystack.com/), select the correct company account and enable/look for **Test Mode**. If it says Live, **STOP**. Do not select live credentials for this phase.
2. Open **Settings → API Keys & Webhooks**. Have the engineer place the **test secret key** into the API staging secret manager `PAYSTACK_SECRET_KEY` (starts `sk_test_`). The owner must not copy it into shared notes or send it to another person in a message.
3. Engineer sets the staging webhook endpoint exactly to `https://STAGING-API/api/paystack/webhook` (replace placeholder with the actual company-owned API hostname). The web frontend's rewrite must preserve raw request bytes and signatures if used; safest is a direct API endpoint. Enter the approved HTTPS web callback in `PAYSTACK_CALLBACK_URL`.
4. Engineer checks `TRUSTED_WEB_ORIGINS` lists only approved HTTPS staging frontend origins; sets `VISPLAY_DEPLOYMENT_STAGE=staging` and `NODE_ENV=production` on the staging API. `SUPABASE_URL` and `VITE_SUPABASE_URL` must refer to the same project; the latter is public but must still be configured on the API **for its preflight check**.
5. Run `npm run ops:preflight` in an engineer-controlled shell where the staging runtime variables are supplied securely. Expect **no BLOCKER**; WARNINGS require manual follow-up. Do not store the command transcript if it may contain private environment variables.
6. Check **Supabase staging SQL financial control** with finance approver. If `migration_approved` is false or canonical finance evidence is inconsistent, the API correctly refuses readiness/monetized operations. Record **BLOCKED**, do **not** flip the flag, create money-bearing fake users or move funds.
7. Only after isolated staging finance records have independent sign-off, use Paystack's documented sandbox card on the independent **web** checkout. Engineer tests both callback and signed raw webhook and checks one-and-only-one entitlement; no Android/iOS in-app checkout. Test a failed/cancelled transaction on a disposable film.
8. Refunds, Paystack settlement exports, reversals, chargebacks and actual bank transfers remain separate qualified workflows. The code currently records refund needs and payout reservations; it does **not** complete a bank transfer or a verified refund. Keep the **production payment/payout flag OFF** until those are built, reviewed and proven against provider/bank receipts.

**H-03 outcome:** Staging webhook + matching canonical evidence, replay protection and reconciliation are required. A Paystack browser redirect alone is NOT a finance PASS.

## 6. Deploy API and web to staging; prove correct routing

**H-04 / ENGINEER, owner watches company dashboard.**

1. In [GitHub](https://github.com/) create/select a **private company repo** and protected source branch. Never upload `.env`, `data/`, film originals or real financial statements. On a pull request, open the **Checks** tab and verify the test-only workflow **VisPlay source checks (no deployment)** runs TypeScript + 85 tests + web build. It does not deploy anything.
2. Open [Render Dashboard](https://dashboard.render.com/) → **New → Web Service**. Select the private company repo/branch and name service clearly `visplay-api-staging`. Confirm **Build Command** `npm ci && npm run build` and **Start Command** `npm run start`; confirm `/_health/live` is the configured health-check path. Choose a paid, reliable plan only after explicit employer budget approval; the repository's historical `render.yaml` has `plan: free` and is not a production recommendation.
3. Click service → **Environment** and have engineer add separate staging secrets; do not expose values on screen during a demo. Include `NODE_ENV=production`, `VISPLAY_DEPLOYMENT_STAGE=staging`, matched Supabase URLs/role key, `JWT_SECRET`, R2 keys/bucket names, `TRUSTED_WEB_ORIGINS`, Paystack **test** key/callback and verified support contacts. Render env edits can trigger deployment; do them only under approved change window.
4. Deploy and open **Events / Logs**. If preflight refuses an invalid key, Supabase migration is missing, or finance is unapproved, record `BLOCKED` and fix the underlying issue through the authorized process. No restart-loop workaround. Open in a browser `https://STAGING-API/_health/live` — expect `{"status":"alive"}` if process is running. Open `https://STAGING-API/_health/ready` — expect `{"status":"ready"}` only after database and **financial approval** really pass; otherwise `503` and `{"status":"not_ready"}` are the intended safe outcome.
5. Open [Vercel Dashboard](https://vercel.com/dashboard) → **Add New → Project**, import the approved repo/branch. Under project **Settings → Environment Variables**, enter only public `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for staging; never server-role or Paystack secret keys.
6. **Critical:** Engineer opens source `vercel.json` in VS Code before deployment. Its rewrite destination may reference the original Render hostname. In the deployment branch, change `/api` to the **approved staging API hostname** and review/remove obsolete public `/uploads` proxy. Verify `TRUSTED_WEB_ORIGINS` uses the exact staging frontend origin. Do not deploy a frontend against the wrong host.
7. After deployment, click the **Visit** button for the staging frontend. In a normal browser open `https://STAGING-WEB/`; then type `https://STAGING-WEB/reader`. Test login, public preview, expired authorization, a signed-out user and safe 503 messages. In Chrome, press **F12 → Network → Fetch/XHR**, refresh, click an API request and check only the *request host* matches the approved staging API. If you see production hostname or a key, `FAIL`.

**H-04 outcome:** Owner records two functioning HTTPS hosts, correct API origin, version/branch, liveness/readiness, CI result, and an engineer-approved migration hash. “Visit works” by itself is not launch approval.

## 7. Uptime, security alerts, recovery and safe rollback

**H-05 / ENGINEER + INCIDENT OWNER.**

1. In Render **Metrics / Logs** and Supabase database logs, ask engineer to configure alerts for API 5xx, sustained health failures, missing Paystack webhook settlement, Supabase errors, long preview worker queues, repeated private media denial patterns and elevated report backlog. Never send full tokens, sensitive email, payment references or personal data to logs.
2. Owner gives an on-call test mobile number/address to the monitoring engineer through approved internal channels. Engineer triggers a **harmless staging test alert**. The owner confirms **Received at [time]**, **Acknowledged at [time]**; write the alert ID without private data. If no named person answers, `BLOCKED`.
3. In Supabase **Database → Backups** (exact labels vary by plan), engineer documents schedule, encryption, recovery retention, who can access exports, and whether PITR is available on the selected plan. Object backups and signed media retention must be documented separately. A backup checkbox does not prove recoverability.
4. DBA performs a **restore drill into a new disposable staging project**, never over a real customer's database. Verify representative verified test identity, rights/moderation record, exact account/ledger counts and no accidentally approved money. Record timestamps, recovery time, data age and a sanitized screenshot. After evidence is preserved, cleanup of the disposable environment requires a separately approved change ticket.
5. Engineer deliberately tests a **small safe staging failure** (e.g., disable a disposable worker job), watches monitoring fire, restores approved service config and checks test user access without corrupted money/state. Do not use a production payment as a failure fixture.
6. Write an incident playbook: severity owner, emergency service disable steps, evidence preservation, bank/PSP support calls, privacy regulator/legal decisions, trusted public communication, who can approve rollback and when to re-enable purchases or uploads.
7. Roll back **code version or configuration only** using provider-approved rollback; do not restore stale financial ledger rows, reseed demo balances, delete audit events or turn the privacy/safety gate off to make an old code version pass.

**H-05 outcome:** `PASS` requires copies of actual alert drill, verified restore result, documented RPO/RTO, rollback decisions and an incident contact roster. Written intentions alone are `NOT RUN`.

## 8. Daily operator checklist after a qualified pilot (never before)

**OWNER:** Open approved status dashboard; check API/readiness, worker queue, unresolved abuse reports, provider settlement exceptions and daily backup freshness. Ask finance to sign each daily reconciliation summary. Never post raw transactions in a public group chat.

**FINANCE:** Match *completeness of periods/counts* across payment initiations, Paystack settlement batches, bank accounts, canonical wallet and creator liabilities, reversals, refunds/chargebacks and pending payouts. Unknown references, missing receipts or aged suspense accounts mean **STOP / BLOCKED**, not “zero discrepancies.”

**SAFETY:** Respond to urgent child safety, threats and credible copyright claims under a staffed policy. Adult release and unmoderated live content remain prohibited until separately built and approved.

**ENGINEER:** Monitor R2 multipart expiration, preview worker resources, API 409 write conflicts, webhook retries, SQL locks, backups, health probes, exposed external URLs and dependency changes. Review all elevated alerts, escalate rather than re-running destructive jobs.

## 9. H evidence record / sign-off

| ID | Owner | Evidence to save (sanitized) | Manual status |
| --- | --- | --- | --- |
| H-S01 | OWNER | Extracted source folder and docs visible | NOT RUN |
| H-S02 | ENGINEER | 85 local tests/build, source revision | NOT RUN |
| H-S03 | OWNER/ENGINEER | Local preflight warning, no secrets | NOT RUN |
| H-S04 | OWNER/ENGINEER | Explicit DEMO example tool output | NOT RUN |
| H-S05 | FINANCE | Independently sourced complete finance records & sign-offs | BLOCKED |
| H-01 | DBA | Separate Supabase + migrations/RLS + restored data | NOT RUN |
| H-02 | ENGINEER | Distinct R2 buckets; private media denial, scan/preview and cleanup | NOT RUN |
| H-03 | FINANCE | Test Paystack webhook/replay/refund/payout completion proofs | BLOCKED |
| H-04 | ENGINEER | Matched staging API/web, correct routes, CI, health checks | NOT RUN |
| H-05 | OPS | Real alert, safe restore, tested rollback and on-call | NOT RUN |
| H-06 | DBA | Normalized moderation/social/creator SQL audit and multi-instance tests | NOT BUILT |
| H-07 | ENGINEER/FINANCE | Production-grade refunds, payout disbursement and reversal workflow | NOT BUILT |

**Release condition:** No automatic certification. Independent finance, security, DBA, legal/safety and product owner must approve written evidence. Finish global-market Section I and independent acceptance Section J. No live merchant payouts or public streaming launch based on Section H source alone.
