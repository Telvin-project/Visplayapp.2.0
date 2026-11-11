# Section F — React Native Reader, Source Architecture and Device Handover

**Date:** 11 November 2026. **Implementation:** Native source and standalone security-policy tests prepared. **Human/real-device acceptance:** NOT RUN. **Release:** BLOCKED.

## 1. Delivered source

`mobile/` is a separate Expo/React Native application for iOS/Android with a clear, independent native navigation layer, real `expo-video` preview player, SecureStore-backed local metadata bookmarks (maximum six), native share sheet, resilient loading/retry screen, and built-in account-management entry. Its initial page is the existing `/reader?embed=1` presentation, *never* the payment website root.

The companion website changes expose two native-reader-only film actions: `Play preview in native player` and `Save to this device`. Only the film's public `movieId` and title cross the bridge; the app constructs a fixed `?mode=preview` URL on the configured HTTPS origin. The browser player is paused before opening native video. The server verifies the movie is published and has a prepared private preview. There is no `mode=full` in the native player.

The native Saved tab stores small non-sensitive film identifiers/titles—not a JWT, credit, wallet, purchase, user profile, video blob, signed URL, or media ownership. SecureStore storage is explicitly bounded. Native sharing produces `/reader?watch=<safeMovieId>`, a non-commercial viewing link.

## 2. Security boundaries

| Boundary | Section F behavior | Verification gate |
| --- | --- | --- |
| Mobile start URL | `EXPO_PUBLIC_VISPLAY_READER_URL` must be a single HTTPS `/reader` URL, no userinfo/query/fragment; no production fallback | Device + config-policy tests |
| WebView navigation | Same exact origin/path only; known verification query keys only; block payment root/checkout, external URL, `file:`, `javascript:`, `data:`, `intent:` | Android/iOS manual redirect and popup tests |
| Web-to-native bridge | Strict JSON schema: `OPEN_PREVIEW` / `SAVE_FILM`, validated movie ID/title only | Source policy tests + device tests |
| Media authorization | Native opens only public 300-second preview route, server must fail closed otherwise | Live staging R2/private bucket & HTTP tests |
| Sign-in | Email/password/verification in trusted WebView; existing HttpOnly server cookie retained in WebView, never forwarded to native | Real Supabase/email test; Google-only accounts BLOCKED |
| Saved data | Up to six public bookmarks in bounded device SecureStore; no sensitive data or offline copies of film | App reinstall/restart/failure tests |
| Native deep links | Only `visplayreader://watch/<safe-id>`, `...://saved`, `...://settings`; no token/query fragment | Real device links and parsing tests |
| Checkout | No film purchase, top-up, Paystack link or redirection in reader app | Store policy and real device review |
| Deletion | Native Settings opens existing browser Account Settings and Delete Account | Zero-balance, positive-balance staging tests |

The route and bridge are **presentation constraints, not security authority**. Every API authorization remains on the server. Any external-link/redirect chain missed by platform handlers is a release blocker; a passing Node unit test alone cannot rule it out.

## 3. Google sign-in remains unresolved

Existing web Google OAuth is not suitable for embedded WebViews under Google's security requirements. Section F keeps that button hidden, does not request tokens in `postMessage`, and does not transfer the WebView cookie to React Native. Production-grade mobile Google sign-in needs a system browser / approved SDK, secure state + PKCE and verified redirect handling, plus a server-side session exchange that does not expose credentials in a custom scheme or query string. Add it under its own threat model, migration, integration tests, and device review. Do **not** claim that Google-only users can sign in until this is implemented.

## 4. Developer install/build details

Follow `mobile/README.md` and Phase 10F in the full novice runbook. Source tests run without Expo dependencies using `node --test mobile/tests/*.test.mjs`. Genuine mobile typecheck requires `npm install` inside `mobile`, `npx expo install --fix`, then `npm run typecheck` and `npx expo-doctor`. The original ZIP's A–F web root uses a distinct Node/npm lockfile. Neither package should overwrite the other's installed dependencies.

Real staging must have: an HTTPS `/reader` served by the same tested API origin; Supabase configured for verified email sign-in; private R2 bucket and attached previews; no demo finance import; separate staging-only accounts; server-side security headers/CORS validated. Public live movie master URLs must be revoked before releasing any app.

## 5. Real-device acceptance matrix for Section F

| Case | Employer / tester action | Expected outcome | Current status |
| --- | --- | --- | --- |
| F-01 | Engineer builds signed test APK, TestFlight iOS build; owner installs both | Installs, launches, no crash, approved company signing IDs | NOT RUN |
| F-02 | Open Explore, film, native preview | Real native playback, user controls, video is at most five minutes | NOT RUN |
| F-03 | Save 2 films, use Saved, Share, Remove, restart app | Public bookmarks persist, no downloads/money stored | NOT RUN |
| F-04 | Tap Explore/Saved/Settings, Android Back, swipe-to-back | Correct internal navigation, no bounce to payment root | NOT RUN |
| F-05 | Turn off Wi-Fi/mobile data, retry, restart and restore | Friendly error, Saved remains available, recovery without sign-in loss where session valid | NOT RUN |
| F-06 | Sign in with verified email, visit already-owned film, sign out; try different user | Ownership correct; no privilege leak; no store link | NOT RUN |
| F-07 | Settings → Account Settings → Delete; test cancel, zero balance, positive balance | Proper confirmation; no loss of money, correct session revocation | NOT RUN |
| F-08 | Intentionally tap external link, `target=_blank`, checkout URL, deep link bad ID | Cannot escape reader; blocked notice; no code/token disclosure | NOT RUN |
| F-09 | Send `visplayreader://watch/SAFE_MOVIE_ID`, Saved, Settings | Opens only valid local navigation; forged queries rejected | NOT RUN |
| F-10 | Test Google-only account and Google OAuth integration after it is built | System browser with safe callback and verified server session | BLOCKED — NOT BUILT |
| F-11 | VoiceOver/TalkBack, large type, screen rotation, reduced motion, small screens | Navigable tabs/video/settings; no hidden or clipped controls | NOT RUN |
| F-12 | Apple/Google store policy/metadata/legal assessment | Correct entitlements, declarations, reviewer account and approval | BLOCKED — not submitted |

## 6. Release decision

**Section F is source-prepared, not device-qualified or store-approved.** Sections G (trust/privacy/rights), H (live integration and operations), I (territory eligibility), and J (independent QA and staged release) still need implementation. Sections A–E also have outstanding manual/provider gates, especially D's blocked source finance reconciliation. No live payments or production release should begin from this build.
