# VisPlay — Employer Handover (Sections A through H)

**Handover date:** 11 November 2026. **Status:** Source implementation for review and staged integration — **NOT production-ready**, NOT a certified mobile application.

## Start here

1. Read `docs/VISPLAY_COMPLETE_NOVICE_TEST_RUNBOOK.md` or the separately supplied PDF version. It tells a beginner which website to open, which buttons to click, what the expected outcome is, how to capture results, and when an experienced engineer/DBA must take over.
2. Read `docs/REMEDIATION_ROADMAP.md` to see Sections A–H, the remaining Sections I–J, plus untested integration gates. For hosting/provider click-by-click steps open `docs/SECTION_H_OPERATIONS_INTEGRATIONS.md`.
3. Ask the developer to install Node.js 24 on an isolated staging computer, extract this package, then run:

   ```text
   npm ci
   npm run test:all
   ```

4. This ZIP **deliberately omits** the original user/payment JSON snapshot, files under `data/`, all secrets, build outputs and developer cache. Do not copy a customer or original demo snapshot into a public Git repository.
5. The supplied `.env.example` is guidance only. Real private values belong in the hosting provider's secret manager. Do not rename it to a production `.env` without engineering review.

## What is ready for engineering inspection?

| Section | Code and automated source checks | Human/provider verification |
| --- | --- | --- |
| A - Login and account security | Prepared | NOT RUN |
| B - Private videos and true previews | Prepared | NOT RUN |
| C - Controlled uploads and media quarantine | Prepared | NOT RUN |
| D - Safe wallet and Paystack transaction architecture | Prepared | **BLOCKED:** legacy ledger audit fails; real bank payout/refund workflows pending |
| E - Mobile reader web UX, payment removal, deletion, accessibility fixes | Prepared | NOT RUN on phones or real providers |
| F - React Native Android/iOS reader source, native preview/bookmarks/navigation | Prepared | **NOT BUILT / NOT RUN on devices:** Expo dependencies/build, Google system-browser OAuth and signed store review pending |
| G - Creator reporting, account blocks, safety moderation/appeals, rights declarations and content ratings | Prepared | **NOT RUN by employer**; staffed review, policy/legal approvals, public support contacts and durable SQL storage pending |
| H - Deployment guardrails, concurrent app-state revision control, health checks, finance evidence comparator, source-only CI and operational runbook | Prepared and locally tested | **NOT RUN by employer/provider**; real staging, production-grade finance, SQL normalization, worker/monitoring/restore and bank integrations still outstanding |

The developer's local run on this source passed **85/85 automated cases** (identity 9, media 10, uploads 15, finance 8, reader 4, mobile-policy 6, safety 12, operations 21), web TypeScript validation and web build on 11 November 2026. **The native Expo app itself has not been installed, typechecked with Expo dependencies, compiled or run on a phone.** The original source finance audit produced blocking discrepancies. These are not guarantees of security or production readiness.

## What still needs implementation?

- **F completion gates:** real Android/iOS builds and device tests, system-browser Google sign-in with safe session handoff, provider previews, accessibility, verified signing identifiers and store-policy approval. A native reader *source* now exists in `mobile/`; Google-only account login is not yet supported there.
- **G completion gates:** the source is now present but employer-operated tests, official rights evidence, signed legal policies, a real support/copyright/privacy contact, professional child safety escalation, age assurance for adult content, and a multi-instance-safe case/audit database are still required. See `docs/SECTION_G_CREATOR_TRUST_SAFETY.md`.
- **H operational gates:** the source now checks staging/prod configurations, prevents silent lost JSON-state writes, exposes safe readiness/liveness probes and compares separately obtained financial evidence. **No real Supabase/R2/Paystack/preview worker integration or backup restore has been run.** Build normalized social/safety/creator SQL, a working refunds/chargeback/bank-payout completion process, monitoring and reviewed recovery before launch. See `docs/SECTION_H_OPERATIONS_INTEGRATIONS.md`.
- **I:** licensing, localization, currencies, tax and payment eligibility for selected countries.
- **J:** independent end-to-end, security, device/load, employer acceptance and actual Apple/Google review.

Sections A–H all require owner-operated acceptance and resolution of their explicit gates before launch. No part of this handover authorizes live financial actions or a public app-store release.

## Important mobile store decision

The site has an independent payment-capable web path `/` and a payment-free reader path `/reader`. The `mobile/` React Native source displays only that reader route and adds real native preview, local bookmarks, navigation and share features. It is **not signed, device-tested or certified**. A button inside a digital-film app saying “go to our website to pay” may still violate Apple or Google payment policies depending on territory and entitlement/program approval. Store reviewers can reject an insufficient native experience. Keep the default app reader-only until a real policy/security review is complete.

## Package contents

- `src/`, `server.ts`, `server/`, `public/`: web and API source.
- `migrations/`: upload-session, financial-core and revision-controlled app-state SQL; DBA approval and verified staging restore required.
- `scripts/`: read-only finance audit, deployment preflight/evidence comparison, media preview/migration/cleanup tools; destructive maintenance requires separate approval.
- `tests/`: identity, media, upload, finance, reader, safety and Section H operational tests.
- `.github/workflows/visplay-source-checks.yml`: source-only CI, never automatic deployment or bank action.
- `mobile/`: Expo/React Native iOS/Android source, native security-policy tests, staging template, and detailed build instructions. **Separate mobile `npm install` required** for compilation.
- `SECTION_A_RELEASE_NOTES.md` through `SECTION_H_RELEASE_NOTES.md` and `docs/`: changes, release gates, official references, employer's full novice guide and Section H operations instructions.
- `.env.example`: nonsecret names/settings to fill for *staging only*.

**Treat every manual checklist item as NOT RUN until the employer or appointed tester actually executes and records it.**
