# VisPlay — Section F Native Reader Source Delivery

**Delivered:** 11 November 2026. **State:** React Native / Expo source implementation and standalone policy tests; native compilation, live providers, physical phones and App Store / Play Store review **NOT RUN**.

## Delivered

- Separate `mobile/` iOS/Android Expo source with real native three-tab navigation (Explore, Saved, Settings), OS share sheet and native five-minute preview player.
- Exact trusted HTTPS `/reader` origin allowlist, navigation interception, popup/download block hints, strict bridge schema, bounded public device bookmarks and safe navigation-only deep links.
- Web `/reader?embed=1` switches to native bottom tabs and displays native Preview / Save actions in a film view without exposing checkout.
- Email/password and verified accounts remain in the trusted WebView session; no session tokens forwarded to native or stored as bookmarks.
- Native Settings routes to account management / deletion; connectivity error and retry guidance.
- Added six Node-native security policy tests to root `npm run test:all`, Section F technical guide, and updated beginner runbook and remaining-sections roadmap.

## Not yet implemented or verified

1. Google OAuth in system browser + safe session handoff for Google-only accounts; do not enable embedded Google OAuth.
2. Native dependencies installed, Expo doctor, native TypeScript check, Android/iOS builds, camera/video device capabilities and OS accessibility tests.
3. Real preview storage/provider integration; isolated staging deployment; acceptance of account deletion and previously purchased library across browser sessions.
4. App Store / Google Play account setup, verified ownership of provisional app IDs, production signing, privacy policy, ratings, consumer rights, payments-policy eligibility and approval.
5. Release security review, external link interception on real devices, Section G/H/I/J capabilities and **A–E manual tests**. Finance reconciliation still blocks real-money activation.

**No employer systems, bank providers, cloud settings or app stores were changed.** See `docs/SECTION_F_NATIVE_READER.md`, `mobile/README.md`, `docs/VISPLAY_COMPLETE_NOVICE_TEST_RUNBOOK.md`.
