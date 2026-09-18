// The shapes the health callables return. Kept apart from the components so
// a change to the report contract shows up as one diff, not as edits
// scattered across every tab that happens to read the field.

export type Level = "critical" | "warn" | "low" | "ok"

/** One `health_findings/{key}` document — the durable half of a finding.
 *  Ack is the only lifecycle control point: a finding is `open` or `acked`,
 *  nothing else. There's no "resolved" -- a finding that stops appearing in
 *  reports just isn't in `project.findings` any more; this document doesn't
 *  track that transition at all. */
export interface LifecycleFinding {
  key: string
  project: string
  level: Exclude<Level, "ok">
  kind: string
  text: string
  firstSeen: string
  lastSeen: string
  state: "open" | "acked"
  runsSeen: number
  ackedUntil: string | null
}

/** One row from `getHealthReport({ history })` — trend only, not a full report. */
export interface HistoryRun {
  runId: string
  generated: string
  status: Level
  counts: Record<Level | "total", number>
  costTotal: number | null
  findingCount: number
}

export interface Finding {
  key: string
  level: Exclude<Level, "ok">
  kind: string
  text: string
  /** Set by SeverityTab, whose lists are estate-wide, so a row can name the
   *  project it belongs to. Absent wherever the project is already the
   *  surrounding context. */
  projectName?: string
  /** How many times this exact thing happened in the window -- only set for
   *  kinds where that's a real, distinct number (log-derived `errors` and
   *  the ALWAYS_REPORT kinds in logging.js), not implied by every kind. */
  count?: number
  /** The actual timestamp of the newest log line behind this finding --
   *  only set for the log-derived `errors` kind, where `analyze.js` can name
   *  one (see logging.js's readErrors). Distinct from (and more useful than)
   *  the lifecycle's lastSeen, which only has run-level (thrice-a-day)
   *  granularity and reads as "still happening right now" for something
   *  that last actually fired hours ago within the same log window. */
  lastOccurred?: string
}

export interface Metric {
  latest: number
  baseline: number
  unit: string | null
  history: number[]
  days: string[]
}

export interface Entity {
  name: string
  kind: string
  calls: number
  callsBaseline: number
  errors: number
  errorRate: number
  logErrors: number
}

export interface CostBreakdown {
  currency: string
  last24h: number
  last7d: number
  last30d: number
  prev30d: number
  byService: { service: string; cost: number }[]
  daily: { day: string; cost: number }[]
}

export interface ProjectResult {
  project: string
  name: string
  plan: string
  status: Level
  cost: CostBreakdown | null
  findings: Finding[]
  metrics: Record<string, Metric>
  entities: Entity[]
  entitiesTotal: number
  errorCount: number | null
  errorTruncated: boolean
  errorKinds?: Record<string, number>
  topErrors: { source: string; message: string; count: number }[]
}

export interface Report {
  runId: string
  generated: string
  mode: string
  logHours: number
  durationMs: number
  status: Level
  counts: Record<Level | "total", number>
  costTotal: number | null
  costCurrency: string
  costWindowDays: number
  /** Account-level charges with no project.id at all (invoice adjustments,
   *  rounding) — counted in costTotal but not in any project's own cost, so
   *  without this the total doesn't reconcile with the sum of projects. */
  otherCost?: CostBreakdown | null
  /** Newest day present in the billing export, or null when it can't be read. */
  costDataThrough?: string | null
  /** True when the export is behind — see the staleness banner in CostTab. */
  costStale?: boolean
  projects: ProjectResult[]
  projectErrors: { project: string; stage: string; error: string }[]
}
