# MacroTrack — App Store Connect Metadata

Copy-paste ready. All fields fit within Apple's character limits.

---

## App Information

| Field | Value |
|---|---|
| **App Name** | MacroTrack: AI Nutrition Coach |
| **Bundle ID** | live.macrotrack.app |
| **Primary Category** | Health & Fitness |
| **Secondary Category** | Food & Drink |
| **Content Rights** | No third-party content |
| **Age Rating** | 4+ (complete questionnaire — no objectionable content) |
| **Copyright** | 2026 Kyle Goodwin |
| **Privacy Policy URL** | https://macrotrack.live/privacy.html |
| **Support URL** | https://macrotrack.live |
| **Marketing URL** | https://macrotrack.live |

---

## Version Information (1.0)

### Subtitle (30 chars max)
```
AI Macro & Calorie Tracker
```
*(26 chars)*

### Description (4000 chars max)

```
MacroTrack is the only nutrition tracker with an AI coach that actually reads your data — your real weight trend, food logs, and adherence history — and tells you exactly what to adjust and why.

SMART AI NUTRITION COACH
Chat with your AI coach anytime. Ask why the scale isn't moving, what to eat before your workout, or how to hit your protein on a busy day. The coach sees your actual numbers, not generic advice.

LOG FOOD IN SECONDS
• Search millions of foods from the USDA FoodData Central database
• Scan barcodes to log packaged foods instantly
• Describe a meal in plain English — "chicken rice and broccoli" — and AI fills in the macros
• AI photo logging: photograph your meal and let AI estimate the nutrition
• Save custom foods and meals for one-tap re-logging

ADAPTIVE TDEE THAT LEARNS YOU
MacroTrack uses your real calorie intake and weight trend to reverse-engineer your true maintenance calories — not a formula based on height and weight. As you log more data, your calorie targets automatically refine.

WEEKLY AI MEAL PLANS
Get a full week of meals generated to your exact macro targets, food preferences, and schedule. One tap to log any meal from your plan.

COMPLETE MACRO TRACKING
Track calories, protein, carbs, and fat with a clean, fast interface built for daily use. See your calorie ring, macro breakdown, and weekly trend at a glance.

WEIGHT TREND CHART
Log your weight and see a smoothed trend line that filters out daily noise. Track your true rate of loss or gain over time.

WORKS OFFLINE
Your food log and settings live on your device. MacroTrack works without a connection — log food on a plane, at the gym, anywhere.

PRIVATE BY DEFAULT
Your data stays on your device. Cloud sync is optional. We never sell your data or use it for advertising.

---

Whether you're cutting, bulking, or maintaining — MacroTrack gives you the AI coach, the data, and the clarity to actually reach your goal.
```
*(~1,650 chars — well within 4,000 limit)*

### Keywords (100 chars max)
```
macro tracker,calorie counter,AI nutrition,food diary,TDEE,protein tracker,meal planner,diet log
```
*(98 chars)*

### What's New (Version 1.0)
```
Welcome to MacroTrack! Log food, track macros, and chat with your AI nutrition coach — all in one app.
```

---

## Pricing & Availability

| Field | Value |
|---|---|
| **Price** | Free (set IAP pricing separately when subscriptions are live) |
| **Availability** | All territories (or start with US only) |
| **Distribution** | App Store |

---

## App Review Information

### Sign-in Required: Yes

**Demo Account Credentials** (create this test account before submitting):
- Email: `review@macrotrack.live`
- Password: *(set a password and fill in here before submission)*

**Notes for App Review:**
```
MacroTrack requires an account to use. Please sign in with the demo credentials above.

The app includes:
• Food logging via search, barcode scan, or natural language description
• AI nutrition coach (requires the Cloudflare Worker backend — active and accessible)
• Weight trend tracking
• AI-generated weekly meal plans

The USDA food database API key is pre-configured in the demo account. 
The AI coach connects to our Cloudflare Worker at macrotrack-ai.kjgoodwin01.workers.dev.

Sign in with Apple and Sign in with Google are both available on the login screen as alternatives to email sign-in.
```

---

## Age Rating Questionnaire (App Store Connect)

Answer these when completing the age rating questionnaire:

| Question | Answer |
|---|---|
| Cartoon or fantasy violence | None |
| Realistic violence | None |
| Sexual content or nudity | None |
| Profanity or crude humor | None |
| Mature/suggestive themes | None |
| Horror/fear themes | None |
| Medical/treatment info | Infrequent/mild (nutrition info) |
| Alcohol, tobacco, drugs | None |
| Gambling | None |
| Unrestricted web access | No |
| User-generated content | No |

**Expected rating: 4+**

---

## Screenshots Needed

Capture these screens on a 6.5" device (iPhone 14 Plus or 15 Plus) and 5.5" device (iPhone 8 Plus):

1. **Food log / calorie ring** — main screen showing today's progress ring and macro bars
2. **Add food modal** — search tab with a food selected and macros shown
3. **AI Coach chat** — a realistic coaching conversation (pre-populate with good example)
4. **Meal plan tab** — weekly AI-generated meal plan
5. **Weight chart** — weight log with trend line visible
6. (Optional) **Onboarding** — goal-setting screen

### Screenshot tips
- Use realistic food/weight data — no placeholder "Test User" names
- Dark theme looks sharp; make sure status bar shows clean time (9:41 AM)
- Can use Simulator for screenshots if no physical device handy
