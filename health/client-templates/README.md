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

**Uncaught errors only get you so far.** `initHealthReporting`/`init` alone
only wires up what's *uncaught* -- window.onerror/unhandledrejection (web),
FlutterError/PlatformDispatcher (Flutter). An error the app catches itself
and handles -- shows the user a friendly "something went wrong" message
for, say -- never reaches either of those, so it's invisible here no matter
how often it happens. That's the case that actually answers "how would I
know my users hit this 500 times a day": call `reportError()` (web) /
`HealthReporting.report()` (Flutter) directly from that catch block. Report
the underlying technical message, not the friendly copy shown to the user
-- that's what lets two different real causes show up as two distinct
signatures on the dashboard instead of one uninformative bucket.

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

For a caught error the app handles gracefully, call `reportError` directly
from wherever it's caught -- an API client wrapper, a form submit handler,
an error boundary's `componentDidCatch`:

```ts
import { reportError } from "@/lib/reportClientError"

try {
  await save(data)
} catch (err) {
  showToast("Couldn't save -- please try again")
  reportError(err instanceof Error ? err.message : String(err))
}
```

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

For a caught error the app handles gracefully -- a try/catch around an API
call that falls back to a cached value and shows a snackbar, say -- call
`HealthReporting.report()` directly:

```dart
try {
  await save(data);
} catch (err) {
  showSnackBar('Could not save -- please try again');
  HealthReporting.report(err.toString());
}
```

Where a project's Crashlytics BigQuery export is already wired up
(`crashlyticsApps` in `config.js`), this is redundant for native
crashes/uncaught Dart errors -- Crashlytics already covers those. It's
still worth adding for apps that haven't turned that export on yet, or to
fold an app's errors into the same dashboard as everything else's before
Crashlytics is set up.
