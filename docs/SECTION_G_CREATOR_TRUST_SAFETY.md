# Section G — Creator Trust, User Safety and Rights

**Status (11 November 2026): Section G source implemented and tested locally; employer/provider/manual tests NOT RUN. Not production approved.**

## What has been added

1. **Report** actions on films, creator profiles, top-level comments and replies. Signed-in users select a reason, write a 10–1200-character explanation and receive a reference beginning `saf_`. An authenticated reporter sees only their own reports. Report reasons: spam, harassment, hate, sexual content, violence, copyright, privacy and other.
2. **Block** actions on creator channels and comment authors. A block hides relevant creators and comments in the blocker’s public discovery, removes a social follow, and can be reversed in **Safety Center → Blocked accounts**. It never removes wallet funds, paid purchases, private media or creator payout records. Blocks hide interactions in both directions where applicable.
3. **Human moderation queue:** **Super Admin Portal → Safety Reports & Appeals** lists reports and appeal requests; reviewers record a detailed reason and may investigate, dismiss or take one of the allowed target-specific actions. Enforcement can hide a comment, hold film playback/discovery, restrict a creator’s uploads or restrict a reported user's social actions. Every moderator action is logged and the parties are notified.
4. **Human appeal and separate restoration:** affected parties may appeal a reviewed report. A different authorized admin reviews the appeal; accepting an appeal does **not** silently lift enforcement. A second explicit, audited restoration action checks for conflicting active cases. A copyright-related film hold requires fresh independent rights review after the complaint.
5. **Creator rights declarations:** new film submissions require creator safety-rule acceptance, the named rights holder, basis for distribution (original/licensed/authorized), and optionally a nonsecret contract reference. The backend records the declaration separately from the moderator’s review.
6. **Independent publication checks:** the admin records an actual rights-document review and an audience classification before publishing. Every film also needs the separately verified private master and five-minute preview from Sections B–C. Adult-classified movies are **not publishable** until verified age assurance and territory rules are implemented.
7. **Comment submission controls:** users must explicitly accept the community rules before posting. Server rejects links/obvious credential requests, unusually rapid identical messages, more than 30 comments per day, and unsafe content lengths/control characters. Report creation is deduplicated and limited to 10 per user per day.
8. **Safeguard for legacy livestreams:** the earlier creator livestream API accepted unreviewed external video URLs. New scheduling is now disabled, public stream listings return empty, and historical records are retained privately. It must not be re-enabled until a moderated streaming ingestion provider, emergency intervention and rights checks exist.
9. **Public contact configuration:** `/api/safety/config` exposes only valid public contact emails. The employer must provide `VISPLAY_SUPPORT_EMAIL`, `VISPLAY_COPYRIGHT_EMAIL`, and `VISPLAY_PRIVACY_EMAIL` in the backend secret/environment configuration; do not invent them.

## API summary (roles are server-enforced)

| Route | Role | Purpose |
| --- | --- | --- |
| `GET /api/safety/config` | Public | Show approved support/copyright/privacy email addresses if configured |
| `POST /api/safety/reports` | Verified user | File private report, receive reference |
| `GET /api/safety/my-reports` | Verified user | Get own reports without moderator-only details |
| `GET /api/safety/blocks` | Verified user | List own blocked users |
| `POST /api/safety/blocks/:userId` | Verified user | Block a valid other user; idempotent |
| `DELETE /api/safety/blocks/:userId` | Verified user | Unblock |
| `POST /api/safety/appeals` | Report party | Appeal a reviewed report |
| `GET /api/safety/my-appeals` | Verified user | Get own appeal statuses |
| `GET /api/admin/safety/reports` | Verified admin | View all moderation cases and appeals |
| `POST /api/admin/safety/reports/:id/review` | Verified admin | Investigate, dismiss or enforce with reason |
| `POST /api/admin/safety/appeals/:id/review` | Verified admin | Uphold/reject appeal with reason |
| `POST /api/admin/safety/appeals/:id/restore` | Verified admin | Explicit and audited restoration after an upheld appeal |
| `POST /api/admin/movies/:id/rights-review` | Verified admin | Record independent rights-document review |
| `POST /api/admin/movies/:id/content-rating` | Verified admin | Record human content/age classification |

**Privacy:** The normal `/api/movies`, `/api/movies/:id` and admin-list client movie serializer removes the media master key, private preview key, creator rights attestation and human rights-review notes before returning movie JSON. Reporter identities, private descriptions and appeals are available only in moderator endpoints, not public discovery.

## Employer: exact click test G01–G12 (all NOT RUN)

Use **staging**, two separately verified test users (`VIEWER_A`, `VIEWER_B`), one separately approved creator (`CREATOR_A`), and one independently bound moderator (`ADMIN_A`). Never use a stranger's account or real unlicensed film. Capture only redacted screenshots and case references.

| ID | Who | Exact action | Expected result |
| --- | --- | --- | --- |
| G01 | OWNER | On staging, sign in as `VIEWER_A` → open published test film → click **Report** | A report dialog opens; no secret data is displayed |
| G02 | OWNER | Select **Copyright or distribution rights** → explain in 10+ characters → **Submit report** | Confirmation and `saf_` reference; Safety Center lists own case |
| G03 | OWNER | While logged in as `VIEWER_A`, repeat the identical report | Server refuses duplicate within 24 hours |
| G04 | OWNER | Open creator channel → click **Block creator** → confirm | Creator hides from viewer A's discovery; B still sees creator |
| G05 | OWNER | From profile menu → **Safety Center & Reports** → **Blocked accounts** → **Unblock** | Creator may appear again; no purchases or funds changed |
| G06 | OWNER | Post a clean comment after checking community-rule acceptance → use `VIEWER_B` to report that comment | Post exists; B receives private report reference |
| G07 | ADMIN | Sign in as `ADMIN_A` → **Super Admin Portal → Safety Reports & Appeals** → open a reported comment | Reason, target, timestamp and report text appear only to admin |
| G08 | ADMIN | On disposable reported comment, choose **Hide reported comment**, add 12+ characters of evidence notes, click **Take selected action** | Comment disappears publicly; case says actioned; audit records action |
| G09 | OWNER | Affected account → open its **Notifications** for the case ID (affected owners do not see a different reporter's private case); enter that `saf_` ID in **Safety Center → Appeal a moderation decision** → write 15+ characters → submit | Appeal reference `apl_`; no automatic restore |
| G10 | ADMIN | Moderator queue → Appeals → add notes → **Uphold appeal**; then separate **Restore after separate review** with fresh explanation | Content restored only after second action; duplicate restore refused; audit log contains restoration |
| G11 | CREATOR + ADMIN | Creator Studio → Upload Film → select rating, legal basis, holder, accept BOTH checks, upload clean licensed test MP4 → Admin records verified rights, human age rating and attaches secure preview → Approve | Publish remains disabled until every gate is met; ADULT rating remains blocked |
| G12 | OWNER | On unsigned browser, open safety contact center and test mailto links with employer-provided contact emails; try legacy **Creator Live** | Support/copyright/privacy contacts are real; unmonitored live upload remains disabled |

### Safe negative checks (ENGINEER, staging only)

- Anonymous requests to `/api/safety/reports`, `/api/safety/blocks`, `/api/safety/appeals` return HTTP 401; anonymous admin requests return HTTP 403.
- A report cannot target nonexistent content or the reporter’s own content; object ownership is resolved from server records.
- A user cannot access another user's report, blocks or appeals simply by changing an ID.
- Moderator cannot action a mismatched target (e.g. use **hold film** on a comment); moderation is logged, never used as a payment rewrite.
- A film on safety hold is absent from public catalogue and streaming; purchase records remain intact for future refund/remediation review.
- An appeal **upheld** but not separately **restored** must leave content hidden.
- Duplicate comment, link-bearing phishing comment, missing terms acceptance, and oversized report are rejected.
- Admin publishing is blocked without private master/preview, independent rights review, content classification, or while an unresolved copyright report exists.
- No public JSON response may contain rights contract references, signed URLs, service secrets or report text.

## Critical outstanding launch gates

**Legal/operations (employer, not inferred):** Approve and publish Terms of Service, Privacy Notice, Community/Creator Rules, Copyright/Takedown Policy, Repeat-Infringer Policy, Child Safety/Escalation Procedure, Appeals Rules, Consumer Refund and Removal Remedies, Support/Account Deletion process, and data-retention schedule; verify real support contacts and staffed review SLAs. Obtain signed distribution rights per territory. A third-party copyright notice channel must accept properly scoped notices, have evidence handling and response tracking. A lawfully appointed privacy owner must approve erasure and retention. Local legal counsel should check Nigerian obligations and intended foreign markets.

**Engineering (Section H):** Moderation cases/blocks currently persist in VisPlay's shared JSON/Supabase state document, which is inadequate for independently auditable multi-instance production transactions. Migrate them to normalized PostgreSQL tables with per-row ownership/RLS, row locking, unique duplicate constraints, admin permission checks, append-only immutable decision events, evidence retention controls, file-secure storage, and case prioritization. Add distributed WAF/rate limits, spam-model review, child-safety escalation, actor-suspension policy, redacted observability, WORM export and separate daily backups with recovery test.

**Product (Sections H/I):** Professional live moderation/streaming ingestion, age-assurance for adult content, age verification and ratings by marketplace/territory, accessibility and qualified multilingual support, licensed music/IP proof review, abuse-policy appeal timeframes and repeat offender policy are not yet integrated. Customers with a paid entitlement to a held film must have an approved refund/alternative-remedy process before production.

**No live qualifications:** These controls passed only developer-run local checks. No actual employer-run staging, cloud provider, legal, support, mobile device or app-store approval has been reported. `npm run test:all` must pass on the exact handover source, followed by G01–G12 manual evidence and independent review.
