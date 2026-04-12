# MacroTrack — App Store & Revenue Roadmap

Goal: downloadable app store app generating subscription revenue, beating MFP and MacroFactor.

---

## Phase 1 — Foundation

- [x] Supabase Auth — email magic link sign-in/sign-up
- [x] Auth gate in onboarding — required before any data entry, no anonymous mode
- [x] AccountCard in settings — shows signed-in email, sign-out
- [x] auth_migrate worker route — moves anonymous Supabase rows to real auth UID on first sign-in
- [ ] Apple Sign-In + Google Sign-In — required by App Store guidelines for apps with any login
- [ ] Stripe subscriptions (web) — paywall on AI coach + meal plans
- [ ] Apple In-App Purchase + Google Play Billing — required for monetizing iOS/Android users

---

## Phase 2 — Competitive Parity

- [ ] Adaptive TDEE algorithm — MacroFactor's core differentiator; uses logged weight trend to reverse-engineer actual calorie burn and auto-adjust targets
- [ ] Apple Health / Google Fit sync — required for serious fitness app users
- [ ] Recipe builder — log multi-ingredient meals
- [ ] Capacitor wrapper — wraps existing web code as a native iOS + Android app for app store submission
- [ ] Vite + React build migration — replace single 7k-line HTML file with proper build system before it becomes unmanageable

---

## Phase 3 — Differentiation

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
