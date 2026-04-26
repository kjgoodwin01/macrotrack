# MacroTrack — App Store & Revenue Roadmap

Goal: downloadable app store app generating subscription revenue, beating MFP and MacroFactor.

---

## Phase 1 — Foundation

- [x] Supabase Auth — email magic link sign-in/sign-up
- [x] Auth gate in onboarding — required before any data entry, no anonymous mode
- [x] AccountCard in settings — shows signed-in email, sign-out
- [x] auth_migrate worker route — moves anonymous Supabase rows to real auth UID on first sign-in
- [ ] Apple Sign-In + Google Sign-In — required by App Store guidelines for apps with any login. Google currently opens Safari (needs @capacitor/browser + deep link handling). Apple sign-in doesn't work yet (needs native plugin).
- [ ] Stripe subscriptions (web) — paywall on AI coach + meal plans. Framework complete in test mode. Blocked on bank account for Stripe payout setup.
- [ ] Apple In-App Purchase + Google Play Billing — required for monetizing iOS/Android users

---

## Phase 2 — Competitive Parity

- [x] Adaptive TDEE algorithm — EMA trend weight + reverse-engineered TDEE from real calorie/weight data; falls back to 7-day heuristic while data accumulates; trend line on chart
- [ ] Apple Health / Google Fit sync — required for serious fitness app users
- [ ] Recipe builder — log multi-ingredient meals
- [x] Capacitor wrapper — wraps existing web code as a native iOS + Android app for app store submission. App runs on device. Email auth working. Nav safe area correct. Install banner hidden in native. OAuth (Google/Apple) still needs fixing before submission.
- [ ] Vite + React build migration — replace single 7k-line HTML file with proper build system before it becomes unmanageable

---

## Phase 3 — Differentiation

- [x] Native iOS push notifications — APNs via @capacitor/push-notifications. WKWebView has no PushManager so web push was silently failing ("Push not supported"). Fixed by routing Capacitor context through APNs; worker generates APNs JWT (ES256) and sends via api.push.apple.com. Scheduled crons (daily reminder 12 PM EDT, protein gap 5 PM EDT, weekly report Sunday 9 AM EDT) fire from Cloudflare Worker. Four bugs fixed 2026-04-25 before notifications actually delivered: (1) scheduled handler was using anon-key sb() to query Supabase — protected tables returned nothing, so notifications were silently skipped; fixed by setting SUPABASE_SERVICE_ROLE_KEY as a Cloudflare secret so sbAdmin bypasses RLS. (2) notify_reminder defaulted to false so noon reminders never fired. (3) push_subscriptions upsert was missing ?on_conflict=device_id, causing duplicate key errors on re-subscribe and silently failing. (4) weekly report cron was set to 14 UTC (10 AM EDT) instead of 13 UTC (9 AM EDT). All fixed in builds 6–8 + worker redeploy. Additional fixes 2026-04-26: (5) APNS_PRIVATE_KEY was the ASC API key, not a dedicated APNs Auth Key — all pushes were returning InvalidProviderToken (403) and silently failing without deleting the subscription. Fixed by creating a new APNs Auth Key (X8RVJTKXKV, Production & Sandbox) and updating Cloudflare secrets. (6) Development/Xcode builds use sandbox APNs tokens which are rejected by the production endpoint (api.push.apple.com) with BadDeviceToken (400). Fixed by adding automatic sandbox endpoint fallback in sendApnsPush — tries production first, retries api.sandbox.push.apple.com on BadDeviceToken. TestFlight/App Store builds hit production directly; dev builds fall back to sandbox transparently. (7) Subscription deletion was too aggressive — any 400 from APNs deleted the subscription row, including JWT errors and payload errors. Fixed to only delete on 410 (Unregistered) or 400 with explicit BadDeviceToken in response body. (8) Added admin_test_apns worker endpoint for on-demand push testing by device_id without waiting for a cron. (9) TestFlight users saw "Push not supported" because build 6 predated the native push code in app.html — fixed in build 9.
- [ ] Proactive AI coach insights — push-based coaching, not just chat-based
- [ ] Predictive logging — "you usually have a protein shake here"
- [ ] Photo meal logging with macro estimation
- [ ] Progress photos + body measurements
- [ ] Restaurant database
- [ ] App Store Optimization (ASO) — screenshots, descriptions, keywords

---

## Competitive Position

| Feature | MFP | MacroFactor | MacroTrack |
|---|---|---|---|
| AI Coach | No | No | **Yes** |
| NLP food entry | No | No | **Yes** |
| AI food search | No | No | **Yes** |
| Adaptive TDEE | No | **Yes** | Planned |
| Apple Health sync | Yes | Yes | Planned |
| Recipe builder | Yes | No | Planned |
| Subscriptions | Yes | Yes | Planned |
| App Store (iOS) | Yes | Yes | Planned |

**Differentiator:** AI-first tracker. Every roadmap decision reinforces this identity.
