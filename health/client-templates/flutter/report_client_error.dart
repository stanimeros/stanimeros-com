// Reports uncaught Flutter errors to the health dashboard's ingestion
// endpoint (reportClientError in health/functions/index.js -> Cloud
// Logging -> lib/clientErrors.js's collector -> findings on the Severity
// tabs). See ../web/reportClientError.ts for the web equivalent -- same
// contract, same protections, ported to Dart.
//
// Copy this file into the app (e.g. lib/report_client_error.dart) and call
// HealthReporting.init(project: ..., token: ...) as the first line of
// main(), wrapped in runZonedGuarded -- see this directory's README.md for
// the exact shape.
//
// Fire-and-forget by design, same as the web template: a failed report
// must never throw, retry, or crash the app a second time trying to report
// the first crash.
//
// Two independent layers guard against a rebuild loop (the Flutter
// analogue of a useEffect loop -- a widget stuck calling setState from
// build/didUpdateWidget) turning into runaway cost:
//   1. Here: a per-launch session cap and a per-signature dedupe -- one app
//      run can never send more than maxReportsPerSession requests, ever.
//   2. health/functions/lib/rateLimit.js: a per-project, per-minute cap on
//      the endpoint itself -- the backstop for many devices at once, which
//      layer 1 alone can't see.
// Neither substitutes for the other -- keep both when copying this out.
//
// Where Crashlytics is wired up (config.js's crashlyticsApps), it already
// covers native crashes and uncaught Dart errors on its own -- this exists
// for apps that haven't turned that BigQuery export on yet, or to fold an
// app's errors into the same dashboard as everything else's.

import 'dart:async';
import 'dart:convert';
import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

class HealthReporting {
  HealthReporting._();

  static const _defaultEndpoint = 'https://europe-west1-stanimeros-dev.cloudfunctions.net/reportClientError';
  static const _defaultMaxReportsPerSession = 20;

  static bool _initialized = false;
  static String? _project;
  static String? _token;
  static String _endpoint = _defaultEndpoint;
  static int _maxReportsPerSession = _defaultMaxReportsPerSession;
  static final Set<String> _seen = {};
  static int _sent = 0;

  /// Call once, before runApp -- see this directory's README for where.
  /// Safe to call more than once (e.g. a hot restart) -- every call after
  /// the first is a no-op.
  static void init({
    required String project,
    required String? token,
    String endpoint = _defaultEndpoint,
    int maxReportsPerSession = _defaultMaxReportsPerSession,
  }) {
    if (_initialized) return;
    _initialized = true;
    // No token configured for this build (e.g. a fork or local dev) --
    // reporting silently no-ops rather than sending bad auth.
    if (token == null || token.isEmpty) return;

    _project = project;
    _token = token;
    _endpoint = endpoint;
    _maxReportsPerSession = maxReportsPerSession;

    final previousOnError = FlutterError.onError;
    FlutterError.onError = (FlutterErrorDetails details) {
      previousOnError?.call(details);
      report(details.exceptionAsString(), stack: details.stack?.toString());
    };

    // Catches what FlutterError.onError doesn't: errors thrown outside the
    // framework's own error zone (a bare async gap with no try/catch). The
    // runZonedGuarded call around runApp (see README.md) is what actually
    // routes those here -- PlatformDispatcher.instance.onError alone only
    // catches errors PlatformDispatcher itself originates.
    PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
      report(error.toString(), stack: stack.toString());
      return true; // handled -- don't crash release builds a second time over this
    };
  }

  /// Report an error directly (e.g. from a try/catch the app chose not to
  /// let propagate, but still wants on the dashboard).
  static void report(String? message, {String? stack, String level = 'error'}) {
    if (_project == null || _token == null) return;
    if (message == null || message.isEmpty || _sent >= _maxReportsPerSession) return;
    final key = '$level:$message';
    if (_seen.contains(key)) return;
    _seen.add(key);
    _sent += 1;

    // Never awaited by a caller, failures swallowed -- there is nowhere
    // left to report a failure to report an error to.
    unawaited(_send(message, stack, level));
  }

  static Future<void> _send(String message, String? stack, String level) async {
    try {
      await http
          .post(
            Uri.parse(_endpoint),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'project': _project,
              'token': _token,
              'message': message,
              'stack': stack,
              'level': level,
            }),
          )
          .timeout(const Duration(seconds: 5));
    } catch (_) {
      // Swallowed on purpose -- see class doc.
    }
  }
}
