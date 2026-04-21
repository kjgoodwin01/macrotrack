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
- [x] App version set correctly (`MARKETING_VERSION` = 1.0.0, `CURRENT_PROJECT_VERSION` = 4)
- [x] App builds with no warnings or errors in Release configuration
- [x] Archive created successfully (Product → Archive in Xcode)

---

## 2. App Icon & Assets

- [x] 1024×1024 app icon (`icon-1024.png`) exists
- [x] AppIcon.appiconset generated with all required sizes (including iPad 152×152 and 167×167)
- [x] App icon has NO alpha/transparency channel (stripped with PIL — verified `hasAlpha: no`)

---

## 3. Privacy & Permissions (Info.plist)

- [x] `NSCameraUsageDescription` — added to Info.plist
- [x] `ITSAppUsesNonExemptEncryption = false` added to Info.plist
- [x] `CFBundleURLTypes` URL scheme `live.macrotrack.app://` added to Info.plist

---

## 4. Authentication — Sign in with Apple (Guideline 4.8)

- [x] `App.entitlements` has `com.apple.developer.applesignin = Default`
- [x] Native Apple Sign-In implemented via `WKScriptMessageHandlerWithReply` in `CustomBridgeViewController.swift` — bypasses Capacitor plugin system entirely
- [x] `ASAuthorizationController` presents native Apple sheet, returns identity token to JS
- [x] JS calls `await window.webkit.messageHandlers.signInWithApple.postMessage({nonce})` and exchanges token with Supabase via `signInWithIdToken`
- [x] Sign in with Apple button visible in AuthModal
- [x] **Tested and working on device** ✅

---

## 5. Authentication — Google Sign-In

- [x] Google Sign-In uses `@capacitor/browser` (SFSafariViewController) — no external Safari
- [x] `appUrlOpen` listener handles PKCE callback (`exchangeCodeForSession`)
- [x] `live.macrotrack.app://auth/callback` added to Supabase redirect URLs
- [x] Supabase client uses `flowType: "pkce"`
- [x] Modal closes automatically after successful sign-in
- [x] **Tested and working on device** ✅

---

## 6. In-App Purchases / Monetization

- [x] RevenueCat configured with 4 products (Pro Monthly, Pro Annual, Max Monthly, Max Annual)
- [x] Duplicate "MacroTrack Pro" entitlement in RevenueCat cleaned up
- [x] Products show READY_TO_SUBMIT status — will activate upon App Store approval (expected)
- [ ] 🟡 Sandbox purchase test (deferred — not a blocker for TestFlight/submission)

---

## 7. Privacy Policy & Legal

- [x] Privacy Policy at `https://macrotrack.live/privacy.html` — live and linked in footer
- [x] Support URL: `https://macrotrack.live`

---

## 8. App Store Connect Metadata

- [x] App listing created in ASC
- [x] Name, subtitle, description, keywords, category, age rating, copyright entered
- [x] Privacy Policy URL: `https://macrotrack.live/privacy.html`
- [x] App Review Notes: "Tap 'Try Demo' on the sign-in screen to access the app without an account."

---

## 9. Screenshots

**Status: ✅ ALL SCREENSHOTS CAPTURED AND UPLOADED**

- [x] `00_onboarding.png` — login/onboarding screen
- [x] `01_food_log.png` — food log with demo data
- [x] `03_weight_chart.png` — weight/physique chart
- [x] `04_coach.png` — AI coach tab
- [x] `05_meal_plan.png` — meal plan tab
- [x] 6 screenshots uploaded to App Store Connect ✅

**Fixes applied during screenshot session:**
- React/ReactDOM/Supabase now bundled locally in `vendor/` (no CDN dependency)
- `lsLoad()` validates array type to prevent `wlog.slice` crash on corrupted localStorage
- `_seedDemoData()` sets `mt_sub = {status:"max"}` so demo users bypass the paywall
- Cloud sync and subscription re-check both skip update when `userName === "Demo"`

---

## 10. App Content Fixes

- [x] **Safe area / Dynamic Island fix** — `setTheme()` was wiping `html.native` CSS class on every React mount. Fixed. Logo correctly positioned below Dynamic Island.
- [x] **Demo mode persistence** — `authChosen` checks `localStorage.getItem("mt_onboarded")` so demo mode persists across app relaunches
- [x] "Try Demo" button added to login screen for Apple reviewer access
- [x] `_seedDemoData()` pre-populates 3 days of food logs, weight entries, goals
- [x] **Startup speed** — native splash overlay added (`CustomBridgeViewController`) eliminates white flash on launch; WebView made transparent with dark background; splash fades out on JS `appReady` signal

---

## 11. Build & Upload

- [x] SW bumped to `mt-v117`
- [x] `npm run build` + `npx cap sync ios` run before each archive
- [x] Build 4 archived and uploaded to App Store Connect ✅
- [x] External TestFlight group created — **Waiting for Review** (1-2 days, normal)
- [x] Wesley Shaw added as external tester ✅

---

## Progress Tracker

| Section | Status |
|---|---|
| 1. Build Config | ✅ Done |
| 2. App Icon & Assets | ✅ Done |
| 3. Privacy / Info.plist | ✅ Done |
| 4. Sign in with Apple | ✅ Working on device |
| 5. Google Sign-In | ✅ Working on device |
| 6. IAP / Monetization | ✅ Configured — sandbox test deferred |
| 7. Privacy Policy | ✅ Done |
| 8. App Store Connect | ✅ Done |
| 9. Screenshots | ✅ Done — all 6 uploaded |
| 10. App Content Fixes | ✅ Done |
| 11. Build & Upload | ✅ Build 4 uploaded, TestFlight pending review |
