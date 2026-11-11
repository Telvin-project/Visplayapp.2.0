# VisPlay Section G — Trust & Safety Release Notes

**Date:** 11 November 2026  
**Scope:** Creator and community trust, abuse reporting, account blocks, moderation, appeals, rights attestations and audience suitability.  
**Verdict:** Source delivered for isolated staging; not production approved. Employer reports no manual/provider testing.

## Implemented

- Added `server/trust-safety.ts` pure input/privacy/visibility controls and typed safety case, block, appeal, rights and rating state in `server/db.ts`.
- Added authenticated report and block endpoints, per-user visibility, private moderator queue, target-specific enforcement, documented appeals, and separately audited restoration. No moderation action writes wallets or changes canonical payment receipts.
- Added `SafetyReportDialog`, `SafetyCenterPage`, and `SafetyModerationQueue`; viewers can report movies, creators, comments and replies; block accounts; review own cases; and appeal. Admins can triage, enforce and restore with reasons.
- Creator submission now captures explicit community-rule acceptance, distribution basis, rights holder, documentary reference and age suitability. Human admin rights reviews and ratings are separate publication requirements. Unverified or adult-rated new films cannot publish.
- Public movie JSON excludes private contract references, media storage keys and rights review notes. Catalogue excludes safety-held films and blocked creators; playback denies held films while preserving financial entitlements and obligations.
- Basic comment link/phishing filter, duplicate and daily reporting/comment limits. These are safeguards, not a substitute for legal review, human moderation or scalable spam detection.
- Disabled original unmoderated creator livestream publishing/visibility pending secure live ingestion and professional safety staffing. Historical records are retained privately.
- Added `tests/safety-*.test.mjs` with unit/HTTP checks and a disposable real-HTTP report → enforcement → appeal → restoration workflow. Full `npm run test:all` regression is the local qualification gate.
- Updated `.env.example`, `docs/SECTION_G_CREATOR_TRUST_SAFETY.md`, roadmap, novice runbook and PDF generator.

## Operational and compliance blockers

1. No employer-run staging acceptance tests, real support/copyright/privacy emails, legal-approved public notices, staffed safety cases or qualified child-protection escalation.
2. Moderation is currently stored in the prior shared application state document. It requires normalized, transactionally safe PostgreSQL persistence, immutable append-only audit/evidence retention, RLS and cross-instance limits before launch (Section H).
3. Immediate illegal/CSAM response, rights enforcement SLAs, repeat offenders, appeals and non-consensual private data complaints need trained operators, not only a button.
4. Age-restricted content remains blocked until region-specific age assurance exists; live creator video remains unavailable until verified moderation-capable ingestion.
5. A consumer refund/alternate-content remedy for already purchased removed films requires an integrated provider/bank process (H). Paid balance and creator obligations must never be silently erased.
6. `F` mobile SDK builds, provider integrations A–D/H, global market I, and independent J QA are still outstanding.

**Runbook:** `docs/VISPLAY_COMPLETE_NOVICE_TEST_RUNBOOK.md`, Phase 10 / Section G and `docs/SECTION_G_CREATOR_TRUST_SAFETY.md`. Mark G01–G12 `NOT RUN` until recorded by an actual tester.
