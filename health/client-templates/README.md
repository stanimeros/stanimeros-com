# Client error reporting templates

Ready-to-copy client-side error reporting for any app being wired into the
health dashboard (see `../functions/lib/health-schema.md`). Two layers of
protection are built in against a runaway page/rebuild loop turning into an
unbounded Cloud Functions/Logging bill:

1. **Client-side** (these templates): a hard per-session cap
   (`maxReportsPerSession`, default 20) and a per-signature dedupe, so one
   tab or app launch can never send more than a handful of requests no
   matter how tight the loop.
2. **Server-side** (`../functions/lib/rateLimit.js`): a per-project,
   per-minute cap on the endpoint itself -- the backstop for many
   tabs/devices at once, which layer 1 alone can't see.

Keep both when copying a template into a new project. Don't raise
`maxReportsPerSession` far above the default without a reason -- it's the
one thing standing between a bug in this app and its blast radius.

## Onboarding a new project

1. Add the project to `../functions/lib/config.js`'s `PROJECTS` list, if it
   isn't there already.
2. Mint a per-project token and add it to `HEALTH_CLIENT_TOKENS` in the
   health functions' `.env` (`id:token,id:token,...`), then redeploy
   `reportClientError`.
3. If the app serves from a new origin, add it to `ALLOWED_ORIGINS` in
   `../functions/index.js` (web apps only -- CORS is a browser-only
   concept, so Flutter/mobile callers aren't affected by this list; see
   that file's comment).
4. Copy the right template below into the app and wire it up as shown.
5. Confirm it in the health dashboard: throw a test error, wait for the
   next sweep (or run one on demand), and check it shows up under that
   project's Severity tab.

## Astro

Copy `web/reportClientError.ts` to `src/lib/reportClientError.ts`. Call it
from a plain `<script>` in the root layout, after the body (so it can't
delay anything render-blocking):

```astro
<script>
  import { initHealthReporting } from "@/lib/reportClientError"
  initHealthReporting({
    project: "your-project-id",
    token: import.meta.env.PUBLIC_HEALTH_CLIENT_TOKEN,
  })
</script>
```

(`PUBLIC_HEALTH_CLIENT_TOKEN` is not a real secret once shipped -- it only
limits which single project's findings a leaked value could spam. Set it in
the app's own `.env`/hosting env vars.)

## Vite / plain React

Copy `web/reportClientError.ts` to `src/lib/reportClientError.ts`. Call it
once, at the top of the app's entry point (`main.tsx`), before rendering:

```ts
import { initHealthReporting } from "@/lib/reportClientError"

initHealthReporting({
  project: "your-project-id",
  token: import.meta.env.VITE_HEALTH_CLIENT_TOKEN,
})
```

`initHealthReporting` is itself a no-op past the first call, so it's safe
even if the entry module happens to re-run (HMR, React StrictMode).

## Flutter

Copy `flutter/report_client_error.dart` to `lib/report_client_error.dart`
and add `http: ^1.0.0` (or whatever's current) to `pubspec.yaml`. Wire it up
in `main()`, wrapped in `runZonedGuarded` -- that's what routes an error
thrown outside Flutter's own error zone (a bare `async` gap with no
try/catch) to `PlatformDispatcher.instance.onError`:

```dart
import 'dart:async';
import 'report_client_error.dart';

void main() {
  runZonedGuarded(() {
    HealthReporting.init(
      project: 'your-project-id',
      token: const String.fromEnvironment('HEALTH_CLIENT_TOKEN'),
    );
    runApp(const MyApp());
  }, (error, stack) {
    HealthReporting.report(error.toString(), stack: stack.toString());
  });
}
```

(`--dart-define=HEALTH_CLIENT_TOKEN=...` at build time, or read it however
the app already manages build-time config.)

Where a project's Crashlytics BigQuery export is already wired up
(`crashlyticsApps` in `config.js`), this is redundant for native
crashes/uncaught Dart errors -- Crashlytics already covers those. It's
still worth adding for apps that haven't turned that export on yet, or to
fold an app's errors into the same dashboard as everything else's before
Crashlytics is set up.
