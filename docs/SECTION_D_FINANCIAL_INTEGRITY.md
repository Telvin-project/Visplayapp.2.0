# Section D — Wallet, Paystack and Financial Transaction Integrity

**Project:** VisPlay | **Date:** 7 November 2026 | **Status:** Implementation delivered; **NOT approved for live financial traffic**.

## 1. Threats addressed in the original ZIP

The original application stored users' wallet balances, Paystack deposits, purchases, creator allocations and payout requests in `visplay_app_state.data`, a shared JSON object. `saveDatabase` re-upserted the whole JSON document. That is not a cross-instance transaction or durable payment ledger. A Paystack verification retry, webhook race, or two parallel movie purchases could produce duplicate credits, lost spends, double earnings or overwritten balances. Historical seeded records were also mixed with real-looking financial rows. Reading the purchased flag from that JSON object made private streaming depend on an unsafe accounting record.

## 2. Delivered backend architecture

The new `migrations/20261107_visplay_financial_core.sql` creates the following PostgreSQL records:

| Canonical table | Function | Invariant |
| --- | --- | --- |
| `visplay_finance_wallets` | Account balances | One wallet per account, balance never below zero |
| `visplay_finance_wallet_entries` | Append-style credit/debit trail | One wallet delta per unique financial reference |
| `visplay_finance_transactions` | Payment intents and settlement states | Unique provider reference, NGN integer amount, state constraints |
| `visplay_finance_purchases` | Streaming entitlements | Unique `(user_id, item_type, item_id)` |
| `visplay_finance_creator_ledger` | Per-purchase 85/15 allocation | One creator allocation per purchase; shares always sum to gross |
| `visplay_finance_payouts` | Creator payout reservation | At most one pending payout per creator; requesting admin recorded |
| `visplay_finance_refund_cases` | Second charge for already-owned content | The second payment is tracked for a refund and cannot create another creator allocation |
| `visplay_finance_control` | Launch gate | Schema installed alone is not enough; migration approval is initially false |

**Atomic server-only RPCs:**

- `visplay_finance_create_intent`: persists the order **before** sending a customer to Paystack and enforces a cross-instance checkout-rate limit.
- `visplay_finance_settle_paystack`: locks the payment reference, validates provider-confirmed reference, NGN currency, kobo amount, user and purpose, then credits wallet **or** creates one purchase and one creator allocation. Retry-safe.
- `visplay_finance_buy_wallet`: locks the wallet, checks entitlement, verifies sufficient balance, debits once and records the purchase, wallet entry and creator allocation in one database transaction.
- `visplay_finance_reserve_payout`: reserves eligible accrued allocations under a creator-specific lock and refuses a second pending payout. **Does not send bank funds.**
- `visplay_finance_anonymize_user`: preserves accounting evidence under a pseudonym only after the wallet is zero, including any creator/payee records.
- `visplay_finance_admin_metrics`: returns financial totals from the canonical tables.

These routines are `SECURITY DEFINER` with an empty search path and explicit `PUBLIC/anon/authenticated` EXECUTE revocation. Client-side Supabase keys cannot call them. Money is represented in whole NGN integers, sent to Paystack as **kobo** (`NGN × 100`). If partial-naira pricing or international currencies become required, introduce dedicated per-currency minor-unit ledger accounts and currency-specific validation; never mix them in a single NGN wallet.

## 3. Revised payment lifecycle

1. Authenticated buyer requests a wallet deposit or published individual movie checkout.
2. Backend fixes the price (movie ₦100, bundle ₦700; deposits ₦100–₦1,000,000), creates a unique pending payment intent, and attaches authenticated user/item metadata.
3. Backend calls Paystack; browser opens only an HTTPS `paystack.com` checkout URL. No Paystack secret reaches the browser.
4. Callback may invoke `/api/wallet/deposit/verify` or `/api/purchases/movie/verify`. **Neither callback parameters nor claims from the browser authorize a credit.** Backend verifies with Paystack's transaction verification API and matches the pre-existing intent.
5. Independently, `POST /api/paystack/webhook` validates the `x-paystack-signature` **HMAC-SHA512 over the original raw JSON body**, then independently verifies Paystack's transaction status before settling via the same atomic DB function. It only returns HTTP 200 after successful durable settlement. Failed DB/provider operations return 503 for retry.
6. Repeated verification/webhooks of one settled reference return an idempotent result; they cannot credit again. A second successful payment for already-owned content creates an open refund case, not a second unlock or creator allocation.
7. Full private video playback, the viewer library and the purchase labels now query **only canonical finance entitlements**. Old JSON purchase arrays are retained solely as historical import evidence, not authorization.

Paystack's official references: [Verify Payments](https://paystack.com/docs/payments/verify-payments/), [Webhooks](https://paystack.com/docs/payments/webhooks/), [Transaction API](https://paystack.com/docs/api/transaction/). Supabase: [Database functions](https://supabase.com/docs/guides/database/functions/). PostgreSQL: [Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html).

## 4. Production migration — mandatory and currently blocked

**Never run this migration against live traffic without a maintenance window and backups.** Changing source code does not automatically transfer existing value from `visplay_app_state.data` into the canonical SQL tables. The previous arrays remain unchanged for forensic reconciliation.

1. Freeze purchases, deposits, and creator payout processing; notify customers of the short maintenance window. Export an immutable copy of the Supabase JSON state, Supabase Auth bindings, Paystack transaction/settlement exports and independently confirmed bank payout receipts. Record SHA-256 digests and test a restoration.
2. Run `npm run finance:audit -- --input /approved/path/snapshot.json`. This tool is read-only and exits with code 2 if it finds blocking anomalies. In the supplied source state, the audit already found *demo payment references, mismatched wallet balances, unverified value-bearing identities and a paid payout unsupported by linked earnings*. These are real migration blockers, **not records to silently delete**.
3. Compare each Paystack successful reference to original purpose, user and amount. Distinguish wallet deposits from direct movie purchases. Resolve refunds, unrecorded bank transfers, chargebacks and duplicate references. Independently establish every user's ending wallet balance, purchase entitlement, creator payable and already-paid payout. Link valuable legacy identities using the Section A dual-review process. Exclude fake seed records only with documented evidence and sign-off.
4. Apply `migrations/20261107_visplay_financial_core.sql` **in staging first**. Keep the `visplay_finance_control` row set to `migration_approved=false` during import. Import **only reconciled** wallets, payment histories, purchases, creator allocations and payout histories in a DBA-reviewed single PostgreSQL transaction. Preserve stable references, user IDs and entitlement IDs; resolve every duplicate and missing foreign relationship. Do **not** seed demo funds. Inspect resulting table counts, splits and balances independently.
5. Conduct the staging acceptance matrix below with test Paystack keys and R2 test media. Take a pre-production snapshot. Two authorized personnel sign the reconciled ledger manifest and attach a case/approval reference.
6. Only **after** accepted imports and tests, the DBA may activate the financial core in a guarded transaction:

   ```sql
   begin;
   update public.visplay_finance_control
      set migration_approved = true,
          approved_at = now(),
          approval_reference = 'REPLACE_WITH_SIGNED_RECONCILIATION_CASE'
    where id = 'main' and migration_approved = false;
   commit;
   ```

   This command is an **operator runbook**, not automatically executed by this patch. The financial RPCs reject writes and the production server rejects startup until the control is approved.

7. Deploy code with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_CALLBACK_URL` and `TRUSTED_WEB_ORIGINS`. Use separate staging/live secrets, private secret manager, HTTPS and production-origin configuration. Configure Paystack's production webhook to `https://YOUR-API-HOST/api/paystack/webhook`, IP/WAF abuse controls and alerting on repeated 503/unknown references/refund cases. Roll out with gradual traffic; keep the old JSON snapshot read-only for rollback/reconciliation (never resume old money writes).

**No import or activation was performed in this offline remediation. No live Paystack, R2, Supabase or bank records were altered.**

## 5. Staging acceptance matrix

| Scenario | Required result |
| --- | --- |
| Two concurrent wallet purchases when balance funds only one | One successful debit, one insufficient-funds result; wallet balance nonnegative |
| Same confirmed Paystack deposit callback + webhook replayed 100 times | Exactly one successful transaction and one wallet entry/credit |
| Forged webhook, changed raw bytes, wrong HMAC, wrong Paystack API response | No credit or unlock |
| Correct HMAC but mismatch reference, amount, NGN currency, user or purpose | No credit; alert and investigate |
| Browser never returns after paying | Valid Paystack webhook settles once; new login shows the new balance/unlock |
| Two simultaneous direct movie charges | One entitlement/creator allocation; surplus charge opens refund case |
| Wallet purchase races paid direct movie settlement | At most one entitlement/creator allocation; any second charge reversed or reviewed; no lost wallet debit |
| Bundle is unfinished or unpublished | No ₦700 debit; all ten episodes must be published before checkout |
| Two admins attempt the same creator payout reservation concurrently | One pending payout, affected creator ledger entries reserved exactly once; no bank transfer initiated |
| A creator deletes a movie bought by a viewer | Request rejected until rights/refund disposition is approved |
| Customer requests account deletion with positive wallet balance | Deletion blocked pending settlement; once zero, finance trail pseudonymized |
| Financial DB migration incomplete, unavailable, or approval missing | Production startup or payment requests fail closed; never fall back to JSON or mock balances |
| New valid user with no wallet row | Balance is zero; no money is granted by registration |
| Provider refunds/chargebacks, disputed bank payouts | Must be independently reconciled and traceable in supporting provider/bank records |

Automated local checks: `npm run lint`, `npm run test:identity`, `npm run test:media`, `npm run test:uploads`, `npm run test:finance`, `npm run build`. A real isolated PostgreSQL/Paystack sandbox is still needed to **execute** the concurrency and provider tests; static SQL checks and mocked calls do not prove database transactions under real load.

## 6. Remaining production gates / employer decisions

- **Highest priority:** reconcile all legacy wallet balances/Paystack references, identity ownership, entitlements and paid creator payouts. Do not approve the SQL control row while the audit is failing.
- Add and independently test the **refund/chargeback, Paystack settlement reconciliation and payout-completion** operational workflow, with bank/Paystack receipts and dual approval. Section D records refund *cases* and *pending payout reservations*, but does not automatically issue refunds or send creator payments. Never mark payouts paid without verified transfer evidence. Production real-money use must wait for an agreed and tested operational path for these events.
- Implement daily transaction/reference/amount matching to the Paystack settlement export and bank statements, investigate unknown references, unprocessed webhooks, provider refunds, payment disputes and creator payable gaps; retain an immutable, access-controlled reconciliation record.
- Validate legal/tax/payment-processing scope of holding prepaid customer balances and paying creators, and the country/currency eligibility of the connected payment partner before any global expansion.
- Run controlled load tests and verify database backups, PITR, service monitoring, alerts, WAF rate limits, incident response and restore procedures.
- Mobile distribution needs **separate** Apple/Google review. Redirecting from a React Native web wrapper to the browser for digital-content payments is not automatically accepted by either store and does not inherit a guaranteed exception from this web payment code.

## 7. Rollback and data preservation

If a staging/live deploy fails, disable financial initialization at the API gateway, preserve all new canonical finance tables and receipt references, investigate against Paystack receipts, and restore the previous application build **without** re-enabling the unsafe JSON wallet/purchase writes. Do not overwrite current balances from older backups. Any correction must be a documented compensating financial event reviewed by two people.
