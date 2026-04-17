# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MacroTrack is a static PWA (Progressive Web App) for macro/calorie tracking with an AI nutrition coach. It is deployed to GitHub Pages with custom domain at `macrotrack.live`. The app is at `macrotrack.live/app.html` and the landing page is at `macrotrack.live`.

The web app has **no build step and no test suite** — source lives in plain HTML files. However, there is now a `package.json` and Capacitor for native iOS/Android builds.

## Development

Open the files directly in a browser, or serve them locally:

```bash
# Any static file server works, e.g.:
python -m http.server 8080
# or
npx serve .
```

To deploy: push to `main` — GitHub Pages serves the files directly.

**After any deploy, bump `VERSION` in `sw.js`** (e.g. `mt-v7` → `mt-v8`) to force the service worker to invalidate its cache and push the update to all open tabs.

### Native iOS build (Capacitor)

```bash
npm run build       # copies app.html → www/index.html + assets
npx cap sync        # copies www/ into ios/App/App/public/
npx cap open ios    # opens Xcode
```

Then hit Play in Xcode to build and run on device. Requires Mac + Xcode. The `www/` directory is gitignored (build artifact). Native context is detected via `window.location.protocol === 'capacitor:'`.

## File structure

| File | Purpose |
|---|---|
| `app.html` | Entire app (~8800 lines) — all CSS, HTML, and React code |
| `index.html` | Landing page (served at macrotrack.live root) — redirects to app.html when running in Capacitor |
| `admin.html` | Admin dashboard (push notification management, user stats) |
| `landing.html` | Marketing/landing page (duplicate of index.html) |
| `sw.js` | Service worker — handles caching, push notifications |
| `manifest.json` | PWA manifest |
| `capacitor.config.json` | Capacitor config — appId: live.macrotrack.app, webDir: www |
| `package.json` | npm — only used for Capacitor dependencies |

## Architecture

### Single-file React app

All React component code is embedded in a `<script>` tag inside `app.html`, wrapped in a function `_initApp()`. React 18 and ReactDOM are loaded from CDN (unpkg.com). **JSX is pre-compiled** — there is no Babel at runtime. New JSX must be compiled to `React.createElement(...)` calls before adding it to the file.

### State management

A custom `useLocal(key, defaultValue)` hook wraps React `useState` + `localStorage`. All app state is persisted to `localStorage` under `mt_*` keys. `localStorage` is always the source of truth.

Key localStorage keys: `mt_entries` (food log by date), `mt_goals` (calorie/macro targets), `mt_wlog` (weight log), `mt_tab`, `mt_name`, `mt_usda` (USDA API key), `mt_worker` (Cloudflare Worker URL), `mt_ai_usage`, `mt_push_enabled`, `mt_push_prefs`, `mt_coach_mode`.

### Cloud sync

Cloud sync (`syncToCloud` / `loadFromCloud`) fires against the Cloudflare Worker at `https://macrotrack-ai.kjgoodwin01.workers.dev`. Sync is **fire-and-forget** — localStorage is source of truth and the app functions fully offline. The worker URL is user-configurable in settings.

### External APIs

- **USDA FoodData Central** (`https://api.nal.usda.gov/fdc/v1`) — food search; requires a USDA API key stored by the user in settings
- **Cloudflare Worker** (`macrotrack-ai.kjgoodwin01.workers.dev`) — AI coach chat, meal plan generation, push notification subscriptions

### Service worker

`sw.js` uses a version string (`VERSION = "mt-vN"`) to name its cache. On activate it deletes all caches with a different name and immediately claims all clients. Strategy: **network-first for HTML**, cache-first for static assets.

### Push notifications

Web Push via VAPID. The public VAPID key is hardcoded in `index.html`. Subscription management goes through the Cloudflare Worker. The service worker handles the `push` event and `notificationclick`.

### Main React components (in app.html)

- `App` — root component, owns all top-level state, renders the tab layout
- `CalHero` — calorie ring / progress display
- `WeekSelector` — 7-day week picker
- `AddFoodModal` — food search sheet (USDA search, barcode scan, NLP, recents, smart meal bundles)
- `FoodDetail` — serving size picker shown after selecting a food
- `BarcodeScanner` — uses the native `BarcodeDetector` API
- `WeightChart` — SVG weight trend chart
- `MealPlanTab` — AI-generated weekly meal plan
- `CoachTab` — AI chat interface
- `CourseCorrection` — mid-day macro adjustment suggestions
- `GoalsModal`, `WeightModal`, `DataBackup`, `WorkerUrlInput`, `Onboarding`
