# Client error reporting rollout

Which of the estate's apps are wired up to `reportClientError`, surveyed
from `/Users/stanimeros/Developer` against `../functions/lib/config.js`'s
`PROJECTS` list. Web apps (Vite/Astro + React) below; Flutter apps further
down. All the web apps already have a project id and a per-project token
minted in `HEALTH_CLIENT_TOKENS` — nothing to provision there, just the
per-repo wiring plus one shared CORS change.

**Blocking prerequisite for all 10**: none of these origins are in
`../functions/index.js`'s `ALLOWED_ORIGINS` yet (it currently only lists
`stanimeros.com` domains). Every custom domain below was verified live
(DNS + HTTP 200, content checked where the result was ambiguous) before
being added here.

| # | App (path under `~/Developer`) | Framework | Firebase project id | Origin(s) to allow | Status |
|---|---|---|---|---|---|
| 1 | `stanimeros.com/health` | Vite + React | `stanimeros-dev` | `stanimeros-health.web.app` | Not wired |
| 2 | `athens-mytransfer` | Astro + React | `athens-mytransfer` | `athens-mytransfer.com`, `athens-mytransfer.web.app` | Not wired |
| 3 | `niki-margariti-labs` | Vite + React | `niki-margariti-agent` | `ai.nikimargariti.gr`, `niki-margariti-agent.web.app` | Not wired |
| 4 | `nourea/dashboard` | Vite + React | `nourea` | `nourea-dashboard.web.app` (no custom domain found) | Not wired |
| 5 | `process` | Vite + React | `process-a7a0f` | `process-a7a0f.web.app` (no custom domain yet) | Not wired |
| 6 | `trans-hellas-reisen` | Vite + React | `parcels-ecdc6` | `thr.topaketo.de`, `parcels-ecdc6.web.app` | Not wired |
| 7 | `veridictum` | Vite + React | `veridictum` | `veridictum.ai`, `veridictum.web.app` | Not wired |
| 8 | `tattoo-healer-dashboard` | Vite + React | `tattoo-healer` | `admin.tattoo-healer.com`, `tattoo-healer.web.app` | Not wired |
| 9 | `hedeos/hedeos.gr` | Vite + React | `hedeos-f6e6c` | `hedeos.gr`, `hedeos-f6e6c.web.app` | Not wired |
| 10 | `ski-greece/website` | Astro + React | `poudra-c2e70` | `ski-greece.gr`, `poudra-c2e70.web.app` | Not wired |

## Flutter apps (separate rollout, `flutter/report_client_error.dart`)

No CORS entry needed for any of these — `ALLOWED_ORIGINS` is a browser-only
mechanism (the browser itself enforces it; a native app has no browser to
enforce it, so it's simply not in play). The per-project **token** is still
required for every one of them, though — it's not related to CORS at all.
`reportClientError` has no Firebase Auth and no App Check (a third-party
app's own bundle can't mint either), so the token is the *only* thing
proving "this really is project X's app" — without it, anyone who found the
endpoint URL could inject fake findings under any project id. CORS and the
token are two independent layers; native apps skip the first, not the
second.

| # | App (path) | Firebase project id | In `config.js` `PROJECTS`? |
|---|---|---|---|
| 1 | `atpro-partner` | `mp-transfer` | ✅ |
| 2 | `chronal` | `chronal` | ✅ |
| 3 | `hedeos` | `hedeos-f6e6c` | ✅ (dual — also row 9 above) |
| 4 | `nourea` | `nourea` | ✅ (dual — also row 4 above) |
| 5 | `party` | `party-game-stanimeros` | ✅ |
| 6 | `ski-greece` | `poudra-c2e70` | ✅ (dual — also row 10 above) |
| 7 | `statwise` | `applytics-app` | ✅ |
| 8 | `tattoo-healer` | `tattoo-healer` | ✅ (dual — also row 8 above) |
| 9 | `fire-message` | — | ⏸ **Later** — not a Firebase project (no `firebase.json`/`google-services.json`, uses RevenueCat instead). Decide then: (a) stand up a real Firebase project + Crashlytics (real lift — `flutterfire configure`, `firebase_crashlytics`, BigQuery export, `crashlyticsApps` entry), or (b) skip Crashlytics and just add a lightweight `config.js`/token entry to use the Dart client-error template on its own. |

`near-flutter` is out of scope — not part of this rollout.

## Per-app checklist

For each row above, once its pace is decided:

- [ ] Confirm the real production origin(s) (custom domain + default
      Hosting URL) where TBD.
- [ ] Add them to `ALLOWED_ORIGINS` in `../functions/index.js`.
- [ ] Copy `web/reportClientError.ts` into the app's `src/lib/`.
- [ ] Call `initHealthReporting({ project, token })` per `README.md`'s
      Astro/Vite section, using that app's own env-var convention for the
      token (`VITE_HEALTH_CLIENT_TOKEN`, `PUBLIC_HEALTH_CLIENT_TOKEN`, etc.).
- [ ] Set the real token value in that app's own env config (from
      `HEALTH_CLIENT_TOKENS` in `../functions/.env` — already minted).
- [ ] Build, deploy, throw a test error, confirm it shows up on the
      dashboard after the next sweep (or "Run now").

Once `ALLOWED_ORIGINS` is updated for a batch of apps, the health functions
codebase needs a redeploy (`firebase deploy --only functions:health` or
just `functions`) for the CORS change to take effect — one shared deploy
covers every app added in that pass, no need to redeploy per-app.
