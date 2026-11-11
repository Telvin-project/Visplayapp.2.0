# VisPlay Reader — Section F React Native / Expo source

**Status: Source preview, not a built/signed or approved mobile app.** The employer has run **zero** provider or device tests. Read `../docs/SECTION_F_NATIVE_READER.md` and `../docs/VISPLAY_COMPLETE_NOVICE_TEST_RUNBOOK.md` before trying to publish anything.

## Why this design

This is a hybrid native app, not a checkout wrapper. The commercial website `/` remains separate. The embedded WebView is constrained to the payment-free `/reader` experience. Added native value includes:

1. Native iOS/Android Explore / Saved / Settings tabs and native device navigation.
2. Real native video player with OS controls for **public 5-minute preview assets only**. The server always enforces private video and publication permissions.
3. Device-local bookmarks and native Share sheet for non-commercial reader links; bookmarks are **not** protected film downloads or proof of entitlement.
4. Offline-safe Saved view, a connection-retry screen, Android Back behavior, and bounded `visplayreader://watch/<movieId>` / `saved` / `settings` deep links.
5. In-app navigation to real account settings and deletion in the trusted reader. No native payment or wallet promotions.

The in-app browser retains its own HttpOnly session cookie and Supabase web storage. No session token or credential is copied to React Native JS, custom URI schemes, logs, preview URLs, or device bookmarks. Google login remains hidden in the reader. **A verified system-browser Google OAuth + backend session handoff must be designed, built and tested before claiming universal sign-in.**

## The first safe local exercise (engineer supervised)

Prerequisites: Node.js >=22.13 (Node 24 LTS recommended), a test-only HTTPS staging host serving the matching A–F backend, correct `/reader` route, private R2 previews prepared in staging, and an Expo test account. No customer data or real keys.

1. Extract the cumulative source ZIP. In Visual Studio Code choose **File → Open Folder** and open the folder that contains the root `package.json` and `mobile/`.
2. In **Terminal → New Terminal**, verify `node --version`. From the root run `npm ci` and `npm run test:all` for the web/backend and standalone mobile navigation policy.
3. In the VS Code explorer right-click `mobile/.env.example` → **Copy**; rename the copy to `mobile/.env`. In it replace the example with one **actual** company-approved HTTPS staging URL ending exactly `/reader`, e.g. `EXPO_PUBLIC_VISPLAY_READER_URL=https://YOUR-STAGING-HOST/reader`. **Never use production customer data**, and never put secrets in an `EXPO_PUBLIC_` value.
4. Click **Terminal → New Terminal**, then type `cd mobile` → Enter. Run `npm install`, followed by `npx expo install --fix`, `npx expo-doctor`, and `npm run typecheck`. The engineer resolves any SDK/package mismatch; do not bypass these checks.
5. Type `npx expo start` → Enter. Open with a compatible Expo Go or approved custom development build on a real test Android/iPhone. The preview icon/app name should read **VisPlay Reader**. If the app says “staging address required”, return to step 3 and rebuild/restart.
6. For an Android installable **internal preview**: `npx eas-cli@latest login`, `npx eas-cli@latest build:configure`, then `npx eas-cli@latest build --platform android --profile preview`. The engineer must confirm the provisional Android identifier in `app.json` and signing credentials before building. In the Expo build dashboard, open the finished build and follow its installation instructions on an employer-owned test Android phone.
7. For an iPhone signed install, an Apple Developer membership/team and valid iOS app identifier/signing are required. The engineer may use an approved EAS iOS build and TestFlight internal testing after configuration. This source has **not** been submitted to Apple or Google.

## Acceptable first-run behavior

- With no staging URL: a friendly configuration screen and **no outbound request**.
- Explore: payment-free `/reader` web content, native bottom tabs, safe-area support.
- Tap a film → **Play preview in native player**: full-screen native MP4 preview UI. If private preview worker/R2 is not configured, record `BLOCKED`, **not a false PASS**.
- Tap **Save to this device**: adds a public metadata bookmark to Saved. You may remove it. Neither source bytes nor purchased content are stored.
- Open Settings → Account settings / Delete account: web account profile with deletion confirmation; account with unresolved money must be refused by server.
- A website link to `/`, a checkout route, external origin, custom URI, `data:` or `javascript:` is refused by the navigation policy.
- If offline: the reader shows an error/retry; Saved bookmarks remain visible.

## Explicit launch blockers

- `npm run typecheck`, `expo-doctor`, physical Android and iOS runs, signed builds, TestFlight/Play internal tests **have not been executed here** (Expo dependencies and provider accounts unavailable in the project sandbox).
- Native Google/system-browser OAuth, authorized code exchange, state/PKCE, protected session handoff, and Google-only account recovery need dedicated engineering. Do not enable embedded Google OAuth as a shortcut.
- Account-deletion link must be tested with real staging identity and a zero-balance account, then with funds blocked. Legal privacy/support links and moderation are still Section G.
- iOS bundle identifier/Android package `com.visibyl.visplayreader` is **provisional** until the employer confirms legal ownership and app registration.
- Apple 4.2, Apple 3.1.1/3.1.3, Google Play Payments, store privacy disclosures, age ratings, accessibility, app/site moderation and digital-film licensing need a real review. Any store can reject the app. Do not add a “go to web to pay” button.
- No licensed offline full-film downloads, push notifications or full native Google sign-in have been implemented. Do not advertise them in screenshots/metadata.
- Security tests for `security/navigation.mjs` are **source-level** only. WebView platform interception must be validated on real devices (including target=_blank and redirect chains).

## Testing commands

From project root:

```text
npm run test:all
npm run test:mobile
```

From `mobile/` after installing its dependencies:

```text
npm run test:policy
npm run typecheck
npx expo-doctor
npx expo start
```

No production deploy, payment, bank transaction, or store submission is authorized by this source package.
