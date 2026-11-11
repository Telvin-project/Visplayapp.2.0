# VisPlay Section H — Operations, Deployment Safeguards and Evidence Reconciliation

**Issued:** 11 November 2026. **Source status:** Implemented and locally verified.
**Employer / provider test status:** NOT RUN. **Production approval:** NO.

## Source delivered in Section H

1. Production/staging configuration preflight. It rejects mixed Paystack test/live keys, identical public/private R2 buckets, invalid origins, known development signing secrets, mismatched Supabase URLs and accidental browser-secret injection. No secret values are printed.
2. A PostgreSQL revision-based compare-and-swap migration for the transitional JSON application state. A second writer must not silently overwrite a committed first writer; conflicting requests fail rather than claim success. SQL migration requires a DBA, a verified backup and staging qualification.
3. Safeguarded Express asynchronous error handling and separate `/_health/live` / `/_health/ready` probes. Readiness fails closed if the financial store or app state has not been qualified. Liveness alone is NOT a launch signal.
4. An **offline, read-only** evidence-comparison tool. It flags mismatches between canonical payments/payouts, independent Paystack transaction evidence, bank payout proof and refund cases. It hashes references in reports. It does **not** automatically fetch statements, move money, approve reconciliation or establish complete evidence coverage.
5. Repeatable test-only GitHub CI workflow. It installs locked dependencies, checks source tests, TypeScript and the web build. It deliberately does **not** deploy, migrate, delete, pay or touch production.
6. Updated Render build/start/health instructions and an operator-focused staging, provider, monitoring, backup/restore and incident runbook. The original Render **free** plan is retained for owner review; it is **not** approved as a production choice.

## Safe operator commands (run only in an extracted copy)

```bash
npm ci
npm run test:all
npm run ops:preflight
npm run ops:reconcile -- docs/SECTION_H_FINANCE_EVIDENCE_TEMPLATE.json
```

The sample JSON contains **fabricated matching evidence** to show command input format. A clean result on that sample is only a **tool demonstration**, NOT a finance sign-off or a verified bank receipt. Actual source finance audit currently reports a migration-blocking anomaly. Do not manually change balances or bypass `migration_approved`.

## Outstanding operational implementation / acceptance

- No employer-operated cloud account integrations, SQL migration, webhooks, bank payouts, refunds or production secrets were run or installed.
- Reconcile actual legacy wallets, paid film purchases, Paystack settlements, failed/reversed transactions and independently verified bank payouts. Source supports reservation, **not** completion of bank transfer and refund processing.
- The app-state CAS migration reduces lost updates but **does not** normalize mutable creator/safety/social records or replace a transactional SQL audit trail. This remains a release blocker for multi-instance operation.
- Staff the copyright/safety/privacy response process, verify public support email, age assurance, media rights, operational queues, alerting and tested recovery.
- Configure a reliable hosting plan, isolated malware scanner/preview workers, strict R2 private master access, backup schedules and restore drills. A free-tier service is not an uptime guarantee.
- The employer must execute the click-by-click runbook and record PASS/FAIL/BLOCKED; offline checks are separate.
- Section I regional eligibility/localization and Section J independent security, real devices, final acceptance and storefront approvals remain outstanding.

**Never put a real API secret, provider statement containing personal data, bank credentials or original `data/visplay_db.json` into a public issue, CI artifact, or source archive.**
