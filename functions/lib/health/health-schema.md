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
  "status":        "critical",               // worst across projects: critical|warn|low|ok
  "counts":        { "critical": 4, "warn": 2, "low": 1, "ok": 8, "total": 15 },
  "costTotal":     12.47,                    // billing-account total, window below
  "costCurrency":  "EUR",
  "costWindowDays": 30,
  "costDataThrough": "2026-08-04",           // newest day present in the billing export; null if unreadable
  "costStale":     true,                     // true when costDataThrough is null or >3 days behind now -- see A1 below
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
  "status":   "ok",                          // critical | warn | low | ok -- worst finding on this
                                             // project; "ok" means zero findings, not just none
                                             // above `low`
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
      "level": "critical",                   // critical | warn | low -- see "Severity tiers" below
      "kind":  "spike",                      // spike|stall|failures|quota|errors|
                                             // function errors|function silent|function spike|
                                             // run errors|run silent|run spike|
                                             // missing_index|rules_denied|quota_exhausted|
                                             // billing|deploy_failure|sa-key|broad-role|api-key
      "text":  "firestore.reads 804 vs baseline 4 (201.0x)",
      "deployedAt": "2026-09-15T10:02:00Z"    // present ONLY on function/run-shaped kinds
                                              // (function|run errors/silent/spike) whose entity
                                              // has a known deploy time -- absent, not null, on
                                              // every other kind and on an unmatched entity. See
                                              // "Amendment: deploy correlation" below.
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
      "days":           ["2026-09-14", ...],
      "deployedAt":     "2026-09-15T10:02:00Z"  // ISO-8601 UTC, or null -- see
                                                 // "Amendment: deploy correlation" below
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

## `health_findings/{key}`

One document per finding key (plan.md S1.2) -- durable across runs, unlike the
per-run snapshot in `health_reports`. `{key}` is the same stable finding key
used for email diffing (`notify.js`), so it's both the document id and the
`key` field. Upserted by the sweep after every run (`runHealthCheck`), scheduled
*and* manual -- see the comment in `functions/lib/health/index.js` for why
manual runs update this store but deliberately don't touch `health_state/latest`.

```jsonc
{
  "key":       "tattoo-healer:spike:firestore.reads",
  "project":   "tattoo-healer",
  "level":     "critical",                   // critical | warn | low -- newest occurrence
  "kind":      "spike",
  "text":      "firestore.reads 804 vs baseline 4 (201.0x)",  // newest occurrence
  "firstSeen": "2026-09-10T03:00:00Z",       // ISO-8601 UTC
  "lastSeen":  "2026-09-16T11:33:03Z",
  "state":     "open",                       // open | resolved | unknown | acked
  "resolvedAt": null,                        // set the first run the key is absent from a project that WAS checked
  "runsSeen":  14,
  "reopenCount": 2,                          // resolved -> open again within 48h = flapping
  "ackedUntil": null,                        // ISO-8601 UTC, or null = acked with no expiry (when state is "acked")
  "ackedBy":   null,                         // uid that called ackFinding, or null

  // Deploy correlation (see "Amendment: deploy correlation" below). Always
  // present, but only ever populated for a function/run-shaped kind -- an
  // estate-hygiene or cost/quota finding has no deploy to point at, so these
  // stay at their empty defaults (null / [] / 0) for the life of the doc.
  "deployedAt":   "2026-09-16T09:00:00Z",    // latest deploy time seen for this finding's
                                              // entity, or null if none is known yet
  "deploys":      ["2026-09-15T00:00:00Z"],  // bounded trail of deploys observed WHILE this
                                              // finding stayed open, oldest first, capped at 10
  "deploysSinceFirstSeen": 2,                // count of entries ever pushed onto `deploys` --
                                              // "still failing, N deploys later"
  "resolvedAfterDeploy": null                // set only at the moment a finding resolves: the
                                              // nearest deploy that fell between `lastSeen` and
                                              // `resolvedAt`, or null if none did. A correlation
                                              // to show alongside the resolution, never the
                                              // reason for it -- see the amendment.
}
```

State transitions (plan.md S1.2/S1.3/S1.5):

- Present in this run -> `open` (or stays `acked` if the ack hasn't expired
  and the finding hasn't escalated warn -> critical, which un-acks it).
- Absent this run, project checked cleanly -> `resolved`, `resolvedAt` set.
- Absent this run, project in `projectErrors` (or dropped out of `PROJECTS`
  entirely) -> `unknown`, **never** `resolved` -- this is the load-bearing
  rule (plan.md S1.3/B2): less visibility must never read as good news.
- `resolved` reappearing within 48h -> back to `open`, `reopenCount` += 1,
  `firstSeen` unchanged (flapping). Reappearing later than 48h -> treated as
  a fresh occurrence of the same key: `firstSeen` reset, `reopenCount` reset.

Retention: `resolved` docs are deleted `LIMITS.lifecycleRetentionDays` (90)
days past `resolvedAt`, in the same scheduled pass as `pruneOldReports`.
`open`/`unknown`/`acked` are kept forever.

## `health_seen/{uid}`

One document per allowed uid. The "since you last visited" marker (plan.md
S1.4) -- written only by the explicit `markHealthSeen` callable, never as a
page-load side effect.

```jsonc
{
  "lastViewedRunId": "2026-09-16T11-33-03Z",
  "lastViewedAt":    "2026-09-16T12:01:00Z"
}
```

## Access

`firestore.rules` stays **deny-all, with no exception**. The client never reads
these collections directly. Instead a `getHealthReport` callable enforces App
Check plus a UID allowlist server-side and reads through the Admin SDK, which
bypasses rules entirely. See `plan.md` SS3 for why. `getHealthFindings`,
`ackFinding`, `markHealthSeen` and `getHealthSeen` are the equivalent callables
for `health_findings` and `health_seen` -- same App Check + `assertHealthAccess`
gate, no direct client reads of either collection either.

## Limits

A Firestore document caps at **1 MiB**, and 15 projects x per-function rows x
error signatures is the realistic risk. The writer caps `entities` at 25 rows
and `topErrors` at 10 per project, keeping the highest-volume ones, and records
what it dropped so the UI can say "showing 25 of 41" rather than quietly lying.

## Retention

Reports older than 180 days are deleted by the same scheduled function.
`health_findings` has its own rule -- see that section above.

## Notes for both sides

- Field names are **camelCase in Firestore**, even though the Python engine uses
  snake_case internally. Convert at the boundary, in one place.
- `history`/`days` arrays are always ascending and always equal length.
- A metric absent from `metrics` means that service is not in use -- render
  nothing, not a zero.
- `cost: null` is normal (Spark project, or export not yet producing data).
  The UI must not show "0.00" for it. But `cost: null` alone can't tell that
  apart from "the export stopped and nobody noticed" -- check the report-level
  `costStale`/`costDataThrough` for that (see A1 in `plan.md`): when
  `costStale` is true, every `cost: null` on the report should render as
  "no data" in amber, not as "clean, no spend".

## Amendment: rolling-24h checks + IAM/key hygiene

`spike`/`stall`/`quota`/`failures` compare two windows, not a UTC calendar
day: a rolling last-24-hours ("now" back 24h, `monitoring.js` `rollingWindow`)
against a history baseline built from `baselineDays` complete *prior* UTC days
(`windowFor`, no longer including "yesterday" as a reserved latest slot).
Both windows are always a full 24h, so there's one check per concern, not a
day-boundary version plus a same-day one — a rolling window can't read
artificially low from being "partial" the way a UTC-calendar-day bucket can
before it's over, so a real spike or outage is visible as soon as it's real.
`metrics[key].latest` is this rolling total; `baseline`/`history`/`days`
describe the historical window only.

`functions.calls` uses a raised failure-rate bar (`FAILURE_THRESHOLDS` in
`config.js`) since that metric's execution-count status is coarse (`ok`/
`error` only, no 4xx/5xx split like `run.requests` has) and can't separate an
expected auth rejection from a real crash.

`sa-key` / `broad-role` / `api-key` — estate hygiene, not usage: a
downloadable (user-managed) service-account key, a service account bound to
`roles/owner`/`roles/editor`, or an API key with no restrictions. Degrades to
no findings (not "not checked") on a project whose IAM/API-keys read grant
hasn't rolled out yet -- see `functions/lib/health/iam.js` and
`scripts/health-iam.sh`.

## Amendment: three severity tiers (`low`)

Two tiers (`critical`/`warn`) collapsed two very different things into amber:
"this service is spiking" and "this API key has no restrictions". A third
tier, `low`, separates them out. Ordering, worst first:
`critical < warn < low < ok` (`LEVEL_ORDER` in `functions/lib/health/config.js`
-- `worstLevel()` and every findings sort walk this array rather than
hard-coding a comparison).

- **`critical`** — a real failure. `errors` (any ERROR-severity log entry,
  `cfg.criticalErrors`), `quota_exhausted`, `billing`, `deploy_failure`,
  `function errors` / `run errors`, and a `sa-key` older than
  `cfg.saKeyCriticalDays`.
- **`warn`** — something is off, but nothing is currently failing. `spike`,
  `stall`, `failures`, `function silent` / `run silent`,
  `function spike` / `run spike`, `missing_index`, `rules_denied`.
- **`low`** — estate hygiene: true, but not an incident, and often not
  fixable today. `api_key_warning` / `api-key`, `service_account_warning`,
  `broad-role` on GCP's own default agent (`iam.js`'s `isDefaultAgent`), and
  a `sa-key` younger than `cfg.saKeyCriticalDays`.

The kind -> level mapping lives in one place, `LEVEL_BY_KIND` in
`functions/lib/health/config.js`, for every kind whose severity doesn't
depend on the number behind it -- adding a new flat-severity kind is a
one-line addition there. `failures`/`quota`/`errors` (graduated by
share/count, up to critical) and `sa-key`/`broad-role` (graduated by key age /
default-agent-ness) stay computed in `analyze.js`, next to the threshold or
flag they key off of. `spike` is graduated too (on ratio, against
`cfg.spikeRatio`) but only within `warn` -- usage running hot is never on its
own evidence of a real failure, so it can't escalate to critical no matter
the ratio.

A project's `status` is the worst level among its own findings
(`worstLevel()`) -- a project whose worst finding is `low` gets status
`"low"`, not `"warn"` and not `"ok"`. `"ok"` means **zero findings**, findings
of any tier included. The report's own top-level `status` is the worst across
every project the same way. `counts` gains a `low` key:
`{ critical, warn, low, ok, total }`.

**Email:** a `low` finding must never be *why* an email is sent. A run whose
only new findings are `low` is a silent run -- `notify.js`'s
`hasAlertableFinding()` gates sending on at least one new finding above
`low`. A `low` finding can still ride along as context inside an email
triggered by something else in the same run: `renderEmail` lists every
finding of an affected project, tagged NEW or ongoing, not just the ones that
qualified the project for inclusion. `LEVEL_COLOR` in `notify.js` has a `low`
entry (muted, not amber) so it reads distinctly from `warn` in the mail body.

## Amendment: deploy correlation

Every function in this estate is 2nd Gen, and a 2nd Gen Cloud Function *is* a
Cloud Run service -- so `functions/lib/health/deploys.js` reads Cloud Run's
own service list once per project (`roles/run.viewer`,
`scripts/health-iam.sh`) and treats each service's `updateTime` as "when did
this last deploy". Same degradation discipline as `iam.js`: a project whose
grant hasn't landed, or whose Cloud Run API is off, loses deploy annotations
and keeps every other finding -- this collector must never throw into the
sweep. Matching a Cloud Run service to the Cloud Functions/Cloud Run entity
it belongs to is case-insensitive (Cloud Run service names are always
lowercase; a function's own name, e.g. `analyzeEntities`, is camelCase) --
the same fold `analyze.js`'s `dropRunShadows` already applies to pair a
gen-2 function with its Cloud Run shadow.

**The one rule that matters more than any field below: a deploy never
resolves a finding.** Resolution is, and stays, exactly what it always was --
the check stopped firing this run (`planLifecycleUpdate`, unchanged). If a
redeploy could mark a finding resolved on its own, a redeploy that *didn't*
fix the bug would silently clear a real, still-true finding -- strictly worse
than not correlating deploys at all, since a false "resolved" reads exactly
like good news. Every field this amendment adds is annotation layered
alongside a `state` decision that has no idea deploys exist.

- `metrics`/`findings` are unaffected except: a finding for a
  function/run-shaped kind (`function`/`run` `errors`/`silent`/`spike`) may
  carry a `deployedAt` (see the `ProjectResult.findings` shape above) when
  its entity has a known deploy time. Absent, not null, when there is none
  -- cost, quota, and the `sa-key`/`broad-role`/`api-key` hygiene findings
  never get this field at all, since none of them point at a function or
  service.
- `entities[].deployedAt` is the same value the paired finding (if any)
  carries, always present (null when unknown) since it's shown regardless of
  whether anything is currently wrong.
- `health_findings/{key}` gains `deployedAt` (the latest deploy time known
  for this finding's entity), a capped `deploys` trail (10 entries, oldest
  dropped), and `deploysSinceFirstSeen` -- the count of times that trail
  actually grew. This is the payoff: **"still failing, N deploys later"** is
  the case where a plausible fix shipped and the finding kept firing anyway
  -- exactly the moment someone would otherwise assume the fix worked and
  move on. The first sighting of a deploy time establishes a baseline, not a
  "redeploy since" -- there's no earlier deploy to compare it to yet, so
  counting it would overstate how many fixes have actually been tried.
  Deploy history resets on a genuinely fresh occurrence of a key (past the
  48h reopen window) since that's an unrelated incident, but carries through
  a within-window flap (same incident, briefly not observed) and through
  `acked`/`unknown` transitions.
- `resolvedAfterDeploy` is written only at the moment a finding transitions
  to `resolved`: the nearest deploy that fell strictly after the finding's
  `lastSeen` and no later than `resolvedAt`, or null if none did. It is
  presented as **correlation, never causation** -- the finding could have
  cleared for an unrelated reason at the same moment -- and any user-facing
  text built from it should say "correlates with" / "since the last deploy",
  never "fixed by".
