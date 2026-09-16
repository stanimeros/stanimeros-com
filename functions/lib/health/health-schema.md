# Firestore contract  (frozen -- backend writes it, frontend reads it)

Project: `stanimeros-dev`.  Nothing else writes these collections.

Copied from `~/Documents/ai-assistant/tools/firebase-health/infra/SCHEMA.md`.
This file is the copy both sides build against -- see `plan.md` SS4. Three
amendments were made on the way in: `projectErrors` on the report, the size
caps under "Limits", and the access model under "Rules".

## `health_reports/{runId}`

`runId` = the run's UTC start, `YYYY-MM-DDTHH-mm-ssZ`, so document id sorts
chronologically and is unique per run.

```jsonc
{
  "generated":     "2026-09-16T11:33:03Z",   // ISO-8601 UTC
  "mode":          "scheduled",              // scheduled | manual | backfill
  "baselineDays":  14,
  "logHours":      24,
  "durationMs":    24411,
  "status":        "critical",               // worst across projects: critical|warn|ok
  "counts":        { "critical": 4, "warn": 2, "ok": 9, "total": 15 },
  "costTotal":     12.47,                    // billing-account total, window below
  "costCurrency":  "EUR",
  "costWindowDays": 30,
  "newFindingKeys": ["nourea:spike:firestore.reads"],  // drove the email; [] = silent run
  "projects": [ ProjectResult, ... ],

  // Projects the sweep could not read. A project in here is rendered as
  // "not checked", never as healthy -- a permission that silently lapses
  // must not read as a green tile.
  "projectErrors": [ { "project": "nourea", "stage": "monitoring", "error": "403 ..." } ]
}
```

### `ProjectResult`

```jsonc
{
  "project":  "tattoo-healer",
  "name":     "Tattoo Healer",
  "plan":     "Blaze",                       // Blaze | Spark
  "status":   "ok",                          // critical | warn | ok
  "billingAccount": "01F891-9E8314-AAB92D",  // null when Spark

  "cost": {                                  // null when Spark or export not ready
    "currency":    "EUR",
    "last24h":     0.42,
    "last7d":      3.10,
    "last30d":     11.88,
    "prev30d":     9.02,                     // for the trend arrow
    "byService":   [ { "service": "Cloud Firestore", "cost": 7.20 }, ... ],
    "daily":       [ { "day": "2026-09-15", "cost": 0.41 }, ... ]   // ascending
  },

  "findings": [                              // ordered: critical first
    {
      "key":   "tattoo-healer:spike:firestore.reads",  // stable -- drives email diffing
      "level": "critical",                   // critical | warn
      "kind":  "spike",                      // spike|stall|failures|live-failures|quota|errors|
                                             // function errors|function silent|function spike|
                                             // missing_index|rules_denied|quota_exhausted|
                                             // billing|deploy_failure|sa-key|broad-role|api-key
      "text":  "firestore.reads 804 vs baseline 4 (201.0x)"
    }
  ],

  "metrics": {                               // key -> series, project rollup
    "firestore.reads": {
      "latest":   1689,
      "baseline": 2466,                      // median of preceding days
      "unit":     null,                      // null | "bytes"
      "history":  [2100, 2466, ...],         // ascending, oldest first
      "days":     ["2026-09-02", ...]        // same length as history
    }
  },

  "entities": [                              // per function / Cloud Run service
    {
      "name":           "getStatistics",
      "kind":           "function",          // function | run
      "calls":          100,
      "callsBaseline":  170,
      "callsHistory":   [241, 227, 100],
      "errors":         0,
      "errorsHistory":  [0, 0, 0],
      "errorRate":      0.0,                 // 0..1
      "logErrors":      0,                   // from Cloud Logging, same window
      "days":           ["2026-09-14", ...]
    }
  ],

  "errorCount":     7,                       // null when the log read failed
  "errorTruncated": false,                   // true = hit the 1000-entry cap, real count higher
  "errorKinds":     { "missing_index": 2, "other": 5 },
  "errorSources":   { "function:onStudioCreated": 2 },
  "topErrors":      [ { "source": "function:onStudioCreated", "message": "...", "count": 2 } ]
}
```

## `health_state/latest`

One document. Lets the next run diff without reading a whole report.

```jsonc
{
  "runId":         "2026-09-16T11-33-03Z",
  "generated":     "2026-09-16T11:33:03Z",
  "status":        "critical",
  "findingKeys":   ["nourea:spike:firestore.reads", ...],  // every key in that run
  "lastEmailAt":   "2026-09-16T11:33:05Z",
  "lastEmailKeys": ["nourea:spike:firestore.reads"]
}
```

## Access

`firestore.rules` stays **deny-all, with no exception**. The client never reads
these collections directly. Instead a `getHealthReport` callable enforces App
Check plus a UID allowlist server-side and reads through the Admin SDK, which
bypasses rules entirely. See `plan.md` SS3 for why.

## Limits

A Firestore document caps at **1 MiB**, and 15 projects x per-function rows x
error signatures is the realistic risk. The writer caps `entities` at 25 rows
and `topErrors` at 10 per project, keeping the highest-volume ones, and records
what it dropped so the UI can say "showing 25 of 41" rather than quietly lying.

## Retention

Reports older than 180 days are deleted by the same scheduled function.

## Notes for both sides

- Field names are **camelCase in Firestore**, even though the Python engine uses
  snake_case internally. Convert at the boundary, in one place.
- `history`/`days` arrays are always ascending and always equal length.
- A metric absent from `metrics` means that service is not in use -- render
  nothing, not a zero.
- `cost: null` is normal (Spark project, or export not yet producing data).
  The UI must not show "0.00" for it.

## Amendment: same-day failure rate + IAM/key hygiene

Two finding families layered on top of the original schema, both additive and
neither present in `metrics`/`entities` (they carry their own text):

- `live-failures` — same-day (partial, UTC-midnight-to-now) failure rate on
  `functions.calls`/`run.requests`, independent of the yesterday-only
  spike/stall/quota checks. Catches a bad deploy the same day rather than the
  next sweep; volume checks stay yesterday-only since a partial day always
  reads low on volume.
- `sa-key` / `broad-role` / `api-key` — estate hygiene, not usage: a
  downloadable (user-managed) service-account key, a service account bound to
  `roles/owner`/`roles/editor`, or an API key with no restrictions. Degrades
  to no findings (not "not checked") on a project whose IAM/API-keys read
  grant hasn't rolled out yet -- see `functions/lib/health/iam.js` and
  `scripts/health-iam.sh`.
