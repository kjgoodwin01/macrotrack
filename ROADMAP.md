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
- [x] Food search overhaul (build 10, 2026-04-27) — multiple compounding failures fixed: (1) Cloudflare Worker fetch handler was missing `ctx` parameter so all KV cache writes were silently dropped since the runtime cancelled dangling promises on response return; fixed by adding `ctx` as third parameter and replacing fire-and-forget puts with `ctx.waitUntil()`. (2) AI orchestrator `max_tokens` was 800, truncating JSON output mid-string and causing all AI calls to return null; raised to 2000. (3) Sequential DB→AI pipeline (5–8s total) replaced with stale-while-revalidate: DB results returned immediately (~1.2s), AI enrichment runs in background after response is sent and overwrites cache on next search (~200ms). (4) Two-level KV cache: word-sorted normalized key collapses word-order variants to the same entry; flavor-stripped base key collapses "kirkland peach energy drink" / "kirkland tropical energy drink" to the same base entry. (5) Brand scoring fix: generic words (energy, drink, co, foods) excluded from brand-match signal so "Monster Energy Company" no longer beats "Kirkland Signature" on a kirkland query. (6) AI macro accuracy fix: AI orchestrator now returns a `ci` (candidate index) field referencing the original DB entry; worker uses real USDA/OFF `foodNutrients` for those results instead of AI-regenerated values. (7) Community food database: new `report_food` worker endpoint accepts verified food data on every log; writes to `ureport:` KV keys with 5-year TTL; search handler reads `ureport:` and `search:` in parallel and always surfaces community-verified entries first; AI-generated entries are not reported (only USDA/barcode data). One user's barcode scan benefits all users permanently.
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
