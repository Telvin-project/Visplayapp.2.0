# VisPlay Section E - Reader Experience and Account Controls

**Date:** 11 November 2026. **Release status:** Source implementation only; NOT a store-approved native app.

## 1. Decision and why

VisPlay is a digital-film service. A button that says "Go to the website to pay", opens a browser, and completes a Paystack checkout for a film watched in the app is still an external-purchase call to action. Apple and Google do not permit that flow worldwide by default. Approval depends on specific store rules, region and enrollment. Apple's guideline 4.2 also warns that simply wrapping a website may not be enough.

The safest unapproved default is a **reader-only app**: sign in, browse, watch a preview, watch a film already owned through the web, see a personal library, and delete an account. The website remains an independent commercial destination with Paystack and wallets.

## 2. Web versus mobile presentation

| Feature | Web `/` | Reader `/reader` |
| --- | --- | --- |
| Browse films, search and previews | Yes | Yes |
| View already-purchased films | Yes | Yes |
| Email sign-in and registration | Yes | Yes, requires verified mail and compatible redirect |
| Google OAuth login | Yes (provider configured) | Hidden until native system-browser integration in F |
| Buy a film, unlock bundles, deposit wallet coins | Yes, server-verified | No payment buttons, price CTAs or funding modal |
| Creator upload/earnings and admin money screens | Yes, subject to role | Hidden in reader |
| View account settings and delete eligible account | Yes | Yes |
| Link from app to Paystack/website checkout | Web checkout only | **No** pending approved regional program |

The route is selected by the path itself. React Native must initially load `https://YOUR-STAGING-WEB-DOMAIN/reader`, stay on that route and block navigations away from the reader context. This source change does **not** yet implement a React Native WebView, native player, deep links, OS credential storage, system-browser authentication, or store SDKs. `/reader` is **not a backend security token**. Never rely on it for media authorization or account access.

## 3. UX corrections completed

- Price/unlock/payment prompts hidden in the reader; already acquired access remains available.
- Payment links and wallet top-up entries removed from the reader navigation and viewer dashboard.
- Creator and admin controls removed from the reader navigation; creator directory stays for discovery.
- Account Settings opens the actual profile tab, including deletion, instead of defaulting to the library tab.
- Delete Account text accurately says positive wallets and unsettled creators must be resolved first. The user must type `DELETE` before the confirmation prompt. The server already returns an explicit conflict rather than forfeiting funds.
- Public account deletion instructions updated and linked from the web footer.
- Added skip-to-content, keyboard-accessible movie poster/title controls, visible focus, reduced-motion styling, device safe-area padding and pinch-zoom support.
- Email verification redirect preserves `/reader` when registration started there.

## 4. Acceptance tests to perform by humans

1. In a fresh browser tab visit `https://YOUR-STAGING-WEB-DOMAIN/`. Confirm film/bundle web purchase buttons and wallet funding exist (test keys only).
2. In another tab visit `https://YOUR-STAGING-WEB-DOMAIN/reader`. Confirm film, bundle, navbar, profile and preview-end screens contain **no** Paystack link, "go to web to pay" promotion, wallet funding, or direct purchase button.
3. Play an anonymous preview to its end. The reader displays a neutral preview-complete message without pricing; the website displays its ordinary unlock choice.
4. Sign in as an account already owning a test film. In both routes, its full film must play; signing in as a different account must NOT unlock it.
5. In `/reader`, use My Library, Account Settings, and Delete Account. Check the `DELETE` field; verify cancellation does not delete. Check account deletion with zero balance and with a positive test balance. No forfeiture.
6. Use iPhone, Android, small-screen portrait, landscape, keyboard and screen reader. Verify tap targets, scrolling, focus and captions/audio controls. These remain manual `NOT RUN` until recorded.
7. Verify the future native shell cannot leave `/reader` to `/` through navigation, login callback, logout, back gesture or external URL. F must add native interception and secure OAuth.

## 5. Store and regulatory blockers that remain

- Apple 3.1.1/3.1.3 and Google Payments policy: digital film purchases; regional and program-specific exceptions are **not** generally granted.
- Apple 4.2: minimum native functionality and polished app behavior. A site mirror is not guaranteed review acceptance.
- Apple and Google: in-app account deletion; Google also requires a functional public web deletion route and correct Data safety declaration.
- Apple 1.2 / Google UGC policy: reporting, blocking, objectionable-content screening and moderation of user films/comments; Section G must build them.
- Native app must have real application identifiers, privacy disclosure, rights/license evidence, store screenshots, accurate age rating, reviewer account, and tested mobile network resilience.
- Paystack and NGN availability do not establish worldwide payment capability. Any global billing expansion needs country/currency legal and provider review in I.

## 6. Official documentation

- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/support/reader-apps/
- https://developer.apple.com/support/offering-account-deletion-in-your-app/
- https://support.google.com/googleplay/android-developer/answer/9858738
- https://support.google.com/googleplay/android-developer/answer/13327111

**Never claim immediate Apple or Google approval based on these source edits.** Keep the reader default payment-free until Section F and an actual store review allow any different purchase path.
