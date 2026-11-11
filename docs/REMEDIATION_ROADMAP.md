# VisPlay Remaining Work and Release Gates

**Snapshot:** 11 November 2026. **Owner-run tests:** NONE. **Production:** NOT APPROVED.

This roadmap distinguishes code delivered offline from tests the employer has actually performed. A build or mocked unit test is not a substitute for staged provider integration, signed financial reconciliation, independent security review or marketplace approval.

| Section | Workstream | Source status | Outstanding gate |
| --- | --- | --- | --- |
| A | Verified identity, anti-takeover and account linking | Patch supplied | Verify real Supabase sessions, remove/resolve legacy seeded privileged identities, approve admin ownership |
| B | Private paid-film storage, preview generation and streaming | Patch supplied | Configure private R2, isolated preview processor and real protected playback on devices |
| C | Secure image/video upload, multipart session tracking | Patch supplied | Deploy SQL and worker, malware scanning, lifecycle cleanup, load/retry tests |
| D | Atomic wallets, Paystack, purchases, creator earnings and payouts | Patch supplied | Reconcile source balances/receipts and payout histories; real SQL tests, refunds/chargebacks, bank processes |
| E | Web and reader UX, payment separation, deletion copy and accessibility | **Code implemented** | Test on real phones, finish full accessibility/UI audit; native browser boundaries pending F |
| F | React Native iOS/Android application and app-store policy | **Native source prepared; not device-tested** | Expo install/typecheck, signed builds, real-device and navigation tests, system-browser Google OAuth/session handoff, app IDs, Apple/Google enrollment and approval |
| G | Creator trust and safety, content rights, legal/privacy/support | **Code implemented; locally tested, not operationally qualified** | Staff safety review team; approve legal texts and support contacts; conduct real user reports, copyright takedown and appeals; transactional social/moderation SQL still required |
| H | Service integrations, migration, operations and reliability | **Safeguards, staging operations docs, read-only audit and test-only CI implemented; 21 local tests pass** | Actual staging/prod integration NOT RUN; normalized safety SQL, refunds, bank payout completion, provider receipts, monitoring and restore NOT BUILT/QUALIFIED |
| I | Global-market product readiness | **NOT STARTED** | Country-by-country media rights, eligibility, language/accessibility, FX/currency, taxes and payment expansion |
| J | Independent qualification, employer acceptance and staged launch | **NOT STARTED** | Human end-to-end runbook, penetration testing under approved scope, concurrency, app store review, sign-offs |

## Critical work that cannot be deferred

1. **No live money** until source wallets, Paystack settlement references and historic paid creator payouts reconcile. `npm run finance:audit` correctly fails on the uploaded demonstration-like state. Never auto-import its numbers or set the production approval flag to bypass a failure.
2. **No paid film exposure** until the public video masters are removed/migrated to a private bucket, and previews are separately generated in an isolated, malware-scanned worker.
3. **No identity migration** until each legacy account that holds value or privileges is independently bound to a verified owner. Email equality is insufficient.
4. **No real creator payments** until a permitted bank/payout partner, reconciliation, payout completion, reversals, holds and disputes process exists. Section D reserves obligations; it does not transfer funds.
5. **No mobile-store promise** based solely on sending users to the web to buy a film. Use the reader-only default until a country/store-specific permitted program is approved and implemented. A WebView alone can fail Apple's minimum-app requirements.
6. **No uncontrolled livestreams:** legacy arbitrary external live video endpoints are disabled by Section G. Qualified human live moderation and a controlled ingest/relay provider must be implemented before live creators can broadcast.
7. **No community launch** until legal policies are approved, real contact addresses are staffed, and the moderation queue handles reports/appeals with documented response times and a durable SQL audit store.
8. **No worldwide claims** until content licensing, consumer laws, privacy, age rating, taxes, payment availability and currencies are checked in each intended territory.

## Recommended completion order and ownership

| Order | Owner | Work | Proof required |
| --- | --- | --- | --- |
| Now | Developer + employer | Finish E review and read the novice runbook | E UI screenshots, user-deletion video, agreed support contacts |
| Next | Mobile engineer | F source → qualified native builds | Expo typecheck, real-device builds, system-browser OAuth/session exchange, deep-link proof, blocked payment navigation, reviewer accounts |
| Next | Trust/legal owner | G staging qualification and policy | Report/block/appeal demonstrations, written licensing, real support contacts and approved policies |
| Alongside | DevOps/DBA + employer | H integration qualification | Staging dashboard screenshots, migration hashes, logs, backup restore, provider receipts; finance/safety normalized SQL and refund/payout completion |
| Then | Product/legal/finance | I region rollout | Territory matrix, currency/rights approvals, translated UX tests |
| Finally | Independent QA/security + employer | J acceptance | All checklist cases PASS, defects closed, signed launch authorization |

**Section F progress:** `mobile/` contains a hybrid React Native reader source, local bookmarks, native preview player and strict navigation/deep-link policies. Six offline native policy cases exercise boundaries; no mobile SDK build or device run has occurred. See `docs/SECTION_F_NATIVE_READER.md`. Google-only users cannot yet sign in from the reader because system-browser Google OAuth and its secure server session exchange are pending. Do not enable embedded OAuth as a shortcut.

**Section G progress:** Reports, blocks, private admin queue, appeal/reinstatement, creator rights declarations, independent rights and content/age review, basic comment anti-spam, and Safety Center UI are present. Adult-rated films cannot be newly published without approved age assurance. Arbitrary external livestream publishing is disabled. These features passed local automated checks only; see `docs/SECTION_G_CREATOR_TRUST_SAFETY.md`. They remain blocked for production by employer policy/support/legal approval, multi-instance relational persistence and staffed emergency/child-safety response.

**Section H progress:** 21 additional local tests cover config mode separation, safe liveness/readiness, rejected async route failures, stale-state write conflicts and provider/bank evidence comparison. Source-only GitHub checks and a full operational click-by-click playbook were prepared. CAS reduces silent overwrites of legacy JSON, but **does not** replace a normalized SQL store. The bank/refund integrations, incident staffing, real provider tests, verified restoration and employer sign-offs are outstanding. See `docs/SECTION_H_OPERATIONS_INTEGRATIONS.md` and `SECTION_H_RELEASE_NOTES.md`. **85/85 total local tests passed.**

The employer has explicitly stated **they have not yet run any tests**. Treat every manual test in the runbook as `NOT RUN` until the employer or an appointed tester records evidence. Code tests run by the developer must be reported separately from user acceptance and real-provider tests.

## Primary policy references

- Apple: https://developer.apple.com/app-store/review/guidelines/
- Apple reader entitlement: https://developer.apple.com/support/reader-apps/
- Google Play Payments: https://support.google.com/googleplay/android-developer/answer/9858738
- Google account deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- Google Play user-generated content: https://support.google.com/googleplay/android-developer/answer/9876937
