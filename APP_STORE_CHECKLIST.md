# MacroTrack — App Store Submission Checklist

Goal: pass Apple review on the first submission. Items are ordered by priority / dependency.
Check off each item as it is completed. Items marked 🔴 are hard blockers (will cause rejection).
Items marked 🟡 are likely issues. Items marked 🟢 are informational / need user input.

---

## 1. Xcode / Build Configuration

- [x] App bundle ID set (`live.macrotrack.app`)
- [x] Development team set (`957PC9B27P`)
- [x] Deployment target set (iOS 15.0)
- [x] `App.entitlements` file exists (was missing — created)
- [x] `com.apple.developer.applesignin` entitlement added to `App.entitlements`
- [ ] 🔴 App version set correctly (`MARKETING_VERSION` = 1.0.0, `CURRENT_PROJECT_VERSION` = 1 — confirm in Xcode before archive)
- [ ] 🟡 App builds with no warnings or errors in Release configuration
- [ ] 🟡 Archive created successfully (Product → Archive in Xcode)
- [ ] 🟡 No simulator-only code paths in Release build

---

## 2. App Icon & Assets

- [x] 1024×1024 app icon (`icon-1024.png`) exists
- [x] AppIcon.appiconset generated with all required sizes
- [x] App icon has NO alpha/transparency channel (stripped with PIL — verified `hasAlpha: no`)
- [ ] 🟡 App icon looks correct at small sizes (20×20, 29×29, 40×40) — check in Simulator
- [ ] 🟡 Launch screen / splash configured and displays correctly (not blank white flash)

---

## 3. Privacy & Permissions (Info.plist)

Apple rejects apps that use APIs without a usage description string, or that request permissions not used.

- [x] `NSCameraUsageDescription` — added to Info.plist
- [ ] 🟡 `NSPhotoLibraryUsageDescription` — only needed if photo meal logging accesses photo library (check if tab "📷 AI" reads from library vs camera)
- [ ] 🟡 `NSUserTrackingUsageDescription` — only if using advertising/tracking (likely not needed)
- [ ] 🟡 ATS (App Transport Security) — all network calls must be HTTPS. Verify no `http://` endpoints are called at runtime.

---

## 4. Authentication — Sign in with Apple (Guideline 4.8)

🔴 **Hard blocker.** Apple requires Sign in with Apple whenever any third-party login is offered. MacroTrack offers Google Sign-In, so Apple Sign-In is mandatory.

- [ ] 🔴 `com.apple.developer.applesignin` capability added in Xcode (Signing & Capabilities tab → + Capability → Sign in with Apple — must match entitlements)
- [x] `App.entitlements` has `com.apple.developer.applesignin = Default`
- [x] `@capacitor-community/apple-sign-in@7.1.0` installed and registered in Package.swift
- [ ] 🔴 Apple Sign-In button visible on the login/onboarding screen
- [ ] 🟡 After Apple Sign-In, user lands in the app correctly (Supabase `signInWithIdToken` working)
- [ ] 🟡 Sign-out clears Apple Sign-In session (not just Supabase session)

---

## 5. Authentication — Google Sign-In

- [x] Google Sign-In now uses `@capacitor/browser` (SFSafariViewController) with `skipBrowserRedirect: true` — no longer opens external Safari
- [x] `appUrlOpen` listener added to App component — handles PKCE callback via `sb.auth.exchangeCodeForSession`
- [x] `CFBundleURLTypes` URL scheme `live.macrotrack.app://` registered in `Info.plist`
- [ ] 🟡 Google OAuth redirect URI `live.macrotrack.app://auth/callback` configured in Supabase dashboard (Authentication → URL Configuration → Redirect URLs)

---

## 6. In-App Purchases / Monetization (Guideline 3.1.1)

🔴 **Hard blocker if subscriptions are live.** Apple requires that digital content/services sold to iOS users use Apple IAP — you cannot collect payment via Stripe or web checkout inside the app.

- [ ] 🔴 If AI coach / meal plans are paywalled: implement StoreKit 2 / RevenueCat for iOS subscriptions (Stripe web checkout cannot be presented inside the iOS app)
- [ ] 🟡 If subscriptions are NOT active at submission time: remove or hide any paywall UI — do not show a broken or incomplete payment flow
- [ ] 🟡 Subscription terms and price must be clearly displayed before purchase (Apple guideline)
- [ ] 🟡 Restore Purchases button required if any IAP exists

---

## 7. Privacy Policy & Legal (App Store Connect)

- [x] Privacy Policy — `privacy.html` created and deployed to `https://macrotrack.live/privacy.html`; linked in footer of index.html and landing.html
- [x] Support URL — `https://macrotrack.live`
- [x] Marketing URL — `https://macrotrack.live`
- [ ] 🟡 Terms of Service / EULA — recommended but not blocking for v1.0

---

## 8. App Store Connect Metadata

All fields must be complete before submitting for review.

- [ ] 🟢 App name: "MacroTrack: AI Nutrition Coach" — enter in App Store Connect (see APP_STORE_METADATA.md)
- [ ] 🟢 Subtitle: "AI Macro & Calorie Tracker" — ready in APP_STORE_METADATA.md
- [ ] 🟢 Description — drafted in APP_STORE_METADATA.md, ready to paste
- [ ] 🟢 Keywords — drafted in APP_STORE_METADATA.md, ready to paste
- [ ] 🟢 Category: Health & Fitness (primary), Food & Drink (secondary)
- [ ] 🟢 Age Rating: 4+ — questionnaire answers in APP_STORE_METADATA.md
- [ ] 🟢 Copyright: "2026 Kyle Goodwin" — enter in App Store Connect

---

## 9. Screenshots (Required)

Apple requires screenshots for every device class you support. Minimum: 6.5" iPhone (iPhone 14 Plus / 15 Plus) and 5.5" iPhone (iPhone 8 Plus). iPad screenshots required only if iPad is supported.

- [ ] 🔴 6.5" iPhone screenshots (1284×2778 or 1242×2688) — at least 1, up to 10
- [ ] 🔴 5.5" iPhone screenshots (1242×2208) — at least 1
- [ ] 🟡 Screenshots show core features: food log, AI coach, calorie ring, meal plan
- [ ] 🟡 No placeholder/test data visible in screenshots
- [ ] 🟡 Optional: App Preview video (15–30 sec) — strong conversion booster

---

## 10. App Content & Behavior

- [ ] 🔴 App does not crash on launch (test on a real device in Release mode)
- [ ] 🔴 App does not require an external browser to function (all auth flows must be in-app)
- [ ] 🟡 Onboarding / first-launch experience is complete and polished (no blank screens)
- [ ] 🟡 All tabs and features are functional — no placeholder "coming soon" UI
- [ ] 🟡 Error states are handled gracefully (no raw error objects shown to user)
- [ ] 🟡 App works on slow / no network (offline-first per architecture — good)
- [ ] 🟡 No references to Android, Google Play, or other platforms inside the app UI

---

## 11. App Review Notes (Required for Login-Gated Apps)

Apple reviewers need credentials or instructions to access the app. Since MacroTrack requires sign-in:

- [x] "Try Demo" button added to the login screen — reviewers tap it to skip auth and see a fully pre-populated app (3 days of food logs, weight entries, goals). No credentials needed.
- [ ] 🟢 Update App Review Notes in ASC to say: "Tap 'Try Demo' on the sign-in screen to access the app without an account."

---

## 12. Export Compliance

- [x] `ITSAppUsesNonExemptEncryption = false` added to `Info.plist` — standard HTTPS only, qualifies for exemption

---

## 13. TestFlight (Recommended Before Submission)

- [ ] 🟡 Upload a build to TestFlight and test on real device(s) before submitting to App Review
- [ ] 🟡 Install via TestFlight and walk through: sign-up → log food → AI coach → barcode scan
- [ ] 🟡 Check for any Capacitor console errors or native crashes in Xcode organizer

---

## Progress Tracker

| Section | Status |
|---|---|
| 1. Build Config | 🔄 In Progress — needs Xcode capability + version confirm |
| 2. App Icon & Assets | ✅ Done |
| 3. Privacy / Info.plist | ✅ Done |
| 4. Sign in with Apple | 🔄 Needs Xcode capability added + real device test |
| 5. Google Sign-In | ✅ Code done — needs Supabase redirect URL configured |
| 6. IAP / Monetization | ⏸ Deferred (no active paywall at submission) |
| 7. Privacy Policy | ✅ Done — macrotrack.live/privacy.html |
| 8. App Store Connect | 🔄 Metadata drafted — needs entry in ASC + screenshots |
| 9. Screenshots | 🔴 Needs user action |
| 10. App Content | 🔄 In Progress |
| 11. Review Notes | 🔴 Needs user action |
| 12. Export Compliance | ✅ Done |
| 13. TestFlight | ❌ Not done |
