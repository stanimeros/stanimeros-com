import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  FolderKanban,
  Gauge,
  Info,
  LayoutDashboard,
  LayoutGrid,
  ListFilter,
  Loader2,
  LogIn,
  LogOut,
  Moon,
  RefreshCw,
  Sun,
  Table as TableIcon,
  XCircle,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import {
  watchAuth,
  signInWithGoogle,
  signOut,
  getHealthReport,
  runHealthCheckNow,
  getHealthFindings,
  ackFinding,
  markHealthSeen,
  getHealthSeen,
} from "@/lib/firebase"
import { StatusBand, Columns, ProportionBar, Series, StackedBar, DivergingBar, Meter } from "@/components/health/charts"
import { buildCategoricalSlotMap, toStackedBarSegments } from "@/components/health/palette"

type Level = "critical" | "warn" | "low" | "ok"

/** One `health_findings/{key}` document — the durable half of a finding. */
interface LifecycleFinding {
  key: string
  project: string
  level: Exclude<Level, "ok">
  kind: string
  text: string
  firstSeen: string
  lastSeen: string
  state: "open" | "resolved" | "unknown" | "acked"
  resolvedAt: string | null
  runsSeen: number
  reopenCount: number
  ackedUntil: string | null
}

/** One row from `getHealthReport({ history })` — trend only, not a full report. */
interface HistoryRun {
  runId: string
  generated: string
  status: Level
  counts: Record<Level | "total", number>
  costTotal: number | null
  findingCount: number
}

interface Finding {
  key: string
  level: Exclude<Level, "ok">
  kind: string
  text: string
  /** Set only when a finding is rendered outside its own project's card
   *  (e.g. the estate-wide tier groups on Overview) so the row can name
   *  which project it belongs to. */
  projectName?: string
}

interface Metric {
  latest: number
  baseline: number
  unit: string | null
  history: number[]
  days: string[]
}

interface Entity {
  name: string
  kind: string
  calls: number
  callsBaseline: number
  errors: number
  errorRate: number
  logErrors: number
}

interface CostBreakdown {
  currency: string
  last24h: number
  last7d: number
  last30d: number
  prev30d: number
  byService: { service: string; cost: number }[]
  daily: { day: string; cost: number }[]
}

interface ProjectResult {
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

interface Report {
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
  /** Newest day present in the billing export, or null when it can't be read. */
  costDataThrough?: string | null
  /** True when the export is behind — see the staleness banner in CostTab. */
  costStale?: boolean
  newFindingKeys?: string[]
  projects: ProjectResult[]
  projectErrors: { project: string; stage: string; error: string }[]
}

const LEVEL_ORDER: Record<Level, number> = { critical: 0, warn: 1, low: 2, ok: 3 }

// 5.1 — a left border-accent on an otherwise neutral card body. Saturated
// fill is reserved for the single worst item on the page (see `highlight`
// below), never spread across every card of a given level.
const LEVEL_STYLE: Record<Level, string> = {
  critical: "border-l-4 border-l-red-500",
  warn: "border-l-4 border-l-amber-500",
  low: "border-l-4 border-l-slate-400",
  ok: "border-l-4 border-l-transparent",
}

// The single saturated treatment, reserved for the one worst card on the
// page — everything else uses the neutral `LEVEL_STYLE` above.
const LEVEL_HIGHLIGHT_STYLE: Record<Level, string> = {
  critical: "border-red-300 bg-red-50 dark:bg-red-950/30",
  warn: "border-amber-300 bg-amber-50 dark:bg-amber-950/30",
  low: "border-slate-300 bg-slate-50 dark:bg-slate-900/30",
  ok: "border-border",
}

const LEVEL_TEXT: Record<Level, string> = {
  critical: "text-red-600",
  warn: "text-amber-600",
  low: "text-slate-500",
  ok: "text-emerald-600",
}

// `low` gets a quieter mark than a warning triangle — hygiene, not an
// incident — so it doesn't compete visually with a real failure.
const LEVEL_ICON: Record<Level, typeof CheckCircle2> = {
  critical: XCircle,
  warn: AlertTriangle,
  low: Info,
  ok: CheckCircle2,
}

const LEVEL_LABEL: Record<Level, string> = {
  critical: "Critical",
  warn: "Warning",
  low: "Low",
  ok: "Healthy",
}

function formatValue(value: number, unit: string | null) {
  if (unit === "bytes") {
    let size = value
    for (const suffix of ["B", "KB", "MB", "GB", "TB"]) {
      if (size < 1024 || suffix === "TB") {
        return suffix === "B" ? `${Math.round(size)} B` : `${size.toFixed(1)} ${suffix}`
      }
      size /= 1024
    }
  }
  return Math.round(value).toLocaleString("en-US")
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "EUR" }).format(value)
}

function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Compact age, for "open 6d" / "open 4h" beside a finding. */
function duration(fromIso: string, toIso?: string | null) {
  const minutes = Math.round(((toIso ? new Date(toIso).getTime() : Date.now()) - new Date(fromIso).getTime()) / 60000)
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

/** Exact local time for a title attribute — `timeAgo` rounds too hard to
 *  correlate a finding with a deploy (plan.md §2.2). */
function exactTime(iso: string) {
  return new Date(iso).toLocaleString()
}

/** Every localStorage access wrapped — a private window, cleared site data,
 *  or a browser that blocks storage must never break the page. */
function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocalStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // best-effort — a per-viewer convenience, not a source of truth
  }
}

/** Parse `#tab=projects&project=foo&level=critical` into a plain object. */
function parseHash(hash: string): Record<string, string> {
  const out: Record<string, string> = {}
  const raw = hash.replace(/^#/, "")
  if (!raw) return out
  for (const pair of raw.split("&")) {
    const [key, value] = pair.split("=")
    if (key) out[decodeURIComponent(key)] = decodeURIComponent(value ?? "")
  }
  return out
}

function buildHash(params: Record<string, string | null | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
  return parts.length ? `#${parts.join("&")}` : ""
}

/** 4.4 — one filter row's worth of state, persisted in the URL hash so a
 *  filtered view is linkable. Reads the hash once on mount (SSR-safe: this
 *  only runs client-side, in an effect) and keeps it in sync via
 *  `history.replaceState` — never `pushState`, so filtering doesn't spam
 *  browser history. */
function useHashState() {
  const [params, setParams] = useState<Record<string, string>>({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setParams(parseHash(window.location.hash))
    setReady(true)
    const onHashChange = () => setParams(parseHash(window.location.hash))
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  const update = useCallback((patch: Record<string, string | null | undefined>) => {
    setParams((prev) => {
      const merged: Record<string, string | null | undefined> = { ...prev, ...patch }
      const next: Record<string, string> = {}
      for (const [key, value] of Object.entries(merged)) {
        if (value) next[key] = value
      }
      const hash = buildHash(next)
      window.history.replaceState(null, "", hash ? hash : window.location.pathname + window.location.search)
      return next
    })
  }, [])

  return { params, ready, update }
}

function StatusIcon({ level, className = "" }: { level: Level; className?: string }) {
  const Icon = LEVEL_ICON[level]
  return <Icon className={`size-4 shrink-0 ${LEVEL_TEXT[level]} ${className}`} aria-hidden="true" />
}

function Tile({
  label,
  value,
  tone,
  hint,
  icon: Icon,
  className,
}: {
  label: string
  value: string
  tone?: string
  hint?: string
  icon?: typeof Gauge
  className?: string
}) {
  return (
    <Card className={`gap-1 px-4 py-3 ${className || ""}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="size-3.5" aria-hidden="true" />}
        {label}
      </div>
      <div className={`text-2xl font-semibold ${tone || ""}`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </Card>
  )
}

/** One finding row — shared between the tier groups below and the
 *  Acknowledged row, so acking never changes the row's own shape. */
function FindingRow({
  finding,
  lifecycle,
  isNew,
  onAck,
}: {
  finding: Finding
  lifecycle?: Map<string, LifecycleFinding>
  isNew?: (key: string) => boolean
  onAck?: (key: string, ack: boolean) => void
}) {
  const life = lifecycle?.get(finding.key)
  return (
    <li className="flex flex-wrap items-baseline gap-2">
      {finding.projectName && (
        <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
          {finding.projectName}
        </Badge>
      )}
      <span className={`shrink-0 font-medium ${LEVEL_TEXT[finding.level]}`}>{finding.kind}</span>
      <span className="text-muted-foreground">{finding.text}</span>
      {isNew?.(finding.key) && (
        <Badge variant="destructive" className="h-4 shrink-0 px-1 text-[10px]">
          NEW
        </Badge>
      )}
      {life && (
        <span
          className="shrink-0 text-xs text-muted-foreground"
          title={`First seen ${exactTime(life.firstSeen)} · seen in ${life.runsSeen} runs`}
        >
          open {duration(life.firstSeen)}
        </span>
      )}
      {/* A finding that keeps clearing and coming back is a different
          problem from one that simply stays broken. */}
      {life && life.reopenCount > 0 && (
        <span className="shrink-0 text-xs text-amber-600" title="Cleared and came back">
          flapping ×{life.reopenCount}
        </span>
      )}
      {onAck && (
        <button
          type="button"
          onClick={() => onAck(finding.key, life?.state !== "acked")}
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {life?.state === "acked" ? "un-ack" : "ack"}
        </button>
      )}
    </li>
  )
}

/** Groups a project's (or the whole estate's) findings under the three
 *  tier headings the owner asked for — "errors, warnings, small/low-severity
 *  warnings" — instead of one undifferentiated list. Acked findings never
 *  appear here; they collapse into their own muted row, passed separately. */
function GroupedFindings({
  findings,
  lifecycle,
  isNew,
  onAck,
}: {
  findings: Finding[]
  lifecycle?: Map<string, LifecycleFinding>
  isNew?: (key: string) => boolean
  onAck?: (key: string, ack: boolean) => void
}) {
  const tiers: Exclude<Level, "ok">[] = ["critical", "warn", "low"]
  const groups = tiers
    .map((level) => ({ level, items: findings.filter((f) => f.level === level) }))
    .filter((g) => g.items.length > 0)

  if (groups.length === 0) return null

  return (
    <div className="mt-3 space-y-3">
      {groups.map((group) => (
        <div key={group.level}>
          <div className={`mb-1 flex items-center gap-1.5 text-xs font-medium ${LEVEL_TEXT[group.level]}`}>
            <StatusIcon level={group.level} className="size-3.5" />
            {LEVEL_LABEL[group.level]} ({group.items.length})
          </div>
          <ul className="space-y-1 text-sm">
            {group.items.map((finding) => (
              <FindingRow key={finding.key} finding={finding} lifecycle={lifecycle} isNew={isNew} onAck={onAck} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** 1.5 — acked findings mute, they don't hide. Collapsed by default behind a
 *  single muted row; expanding reveals the same `FindingRow`s as everywhere
 *  else, ack button included, so un-acking is one click from here too. */
function AckedRow({
  findings,
  lifecycle,
  onAck,
}: {
  findings: Finding[]
  lifecycle?: Map<string, LifecycleFinding>
  onAck?: (key: string, ack: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  if (findings.length === 0) return null
  return (
    <div className="mt-3 rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left"
      >
        {open ? <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" /> : <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />}
        Acknowledged ({findings.length})
      </button>
      {open && (
        <ul className="mt-2 space-y-1 pl-5 text-sm text-foreground">
          {findings.map((finding) => (
            <FindingRow key={finding.key} finding={finding} lifecycle={lifecycle} onAck={onAck} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ProjectCard({
  project,
  lifecycle,
  isNew,
  onAck,
  highlight,
}: {
  project: ProjectResult
  lifecycle?: Map<string, LifecycleFinding>
  isNew?: (key: string) => boolean
  onAck?: (key: string, ack: boolean) => void
  highlight?: boolean
}) {
  const [open, setOpen] = useState(false)
  const metrics = Object.entries(project.metrics).filter(([key]) => !key.endsWith(".failed"))

  // 1.5 — acked findings stop counting toward the header status/count; they
  // stay fully visible, just moved into their own row below.
  const activeFindings = project.findings.filter((f) => lifecycle?.get(f.key)?.state !== "acked")
  const ackedFindings = project.findings.filter((f) => lifecycle?.get(f.key)?.state === "acked")

  return (
    <Card
      className={`gap-3 px-4 py-4 ${highlight ? LEVEL_HIGHLIGHT_STYLE[project.status] : LEVEL_STYLE[project.status]}`}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-start justify-between gap-3 text-left">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusIcon level={project.status} />
              <span className="font-semibold">{project.name}</span>
              <span className="text-xs text-muted-foreground">{project.project}</span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                  project.plan === "Blaze"
                    ? "border-amber-300 bg-amber-50 text-amber-700"
                    : "border-border text-muted-foreground"
                }`}
              >
                {project.plan}
              </span>
            </div>
            <div className={`mt-1 text-sm ${LEVEL_TEXT[project.status]}`}>
              {activeFindings.length
                ? `${activeFindings.length} finding${activeFindings.length === 1 ? "" : "s"}`
                : "No findings"}
              {ackedFindings.length > 0 ? ` · ${ackedFindings.length} acked` : ""}
              {project.errorCount !== null && project.errorCount > 0
                ? ` · ${project.errorCount}${project.errorTruncated ? "+" : ""} errors`
                : ""}
              {/* null means the log read failed — never render that as zero. */}
              {project.errorCount === null ? " · errors unread" : ""}
            </div>
          </div>
          <div className="shrink-0 text-right">
            {project.cost ? (
              <div className="text-sm">{formatMoney(project.cost.last30d, project.cost.currency)}</div>
            ) : null}
            <div className="text-xs text-muted-foreground">{open ? "hide" : "details"}</div>
          </div>
        </CollapsibleTrigger>

        <GroupedFindings findings={activeFindings} lifecycle={lifecycle} isNew={isNew} onAck={onAck} />
        <AckedRow findings={ackedFindings} lifecycle={lifecycle} onAck={onAck} />

        <CollapsibleContent className="space-y-4 overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down data-[state=open]:mt-4 data-[state=open]:border-t data-[state=open]:border-border data-[state=open]:pt-3">
          {metrics.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Last 24h vs the 14-day median — as of the last sweep, not a live counter, and calls are
                summed across every function in the project.
              </p>
              {/* C7 — every metric against its own baseline on one shared
                  scale, so the one that is off is visible without reading
                  any numbers. The per-metric detail follows below it. */}
              <DivergingBar
                rows={metrics.map(([key, metric]) => ({
                  key,
                  label: key,
                  value: metric.latest,
                  baseline: metric.baseline,
                  severity: project.findings.some((f) => f.text.startsWith(key)) ? project.status : undefined,
                }))}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                {metrics.map(([key, metric]) => (
                  <div key={key} className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-2 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-xs text-muted-foreground">{key}</div>
                      <div className="text-sm">
                        {formatValue(metric.latest, metric.unit)}
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          vs {formatValue(metric.baseline, metric.unit)}
                        </span>
                      </div>
                    </div>
                    {/* C9 — the same series the old sparkline drew, but with
                        the baseline marked and the dates readable. */}
                    <Series
                      variant="spark"
                      points={metric.history.map((value, i) => ({ day: metric.days[i] ?? String(i), value }))}
                      baseline={metric.baseline}
                      unit={metric.unit}
                      valueFormatter={formatValue}
                      ariaLabel={`${key} over time`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {project.entities.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1 pr-2 font-normal">Function</th>
                    <th className="py-1 pr-2 text-right font-normal">Calls</th>
                    <th className="py-1 pr-2 text-right font-normal">Baseline</th>
                    <th className="py-1 pr-2 text-right font-normal">Errors</th>
                    <th className="py-1 pr-2 text-right font-normal" title="From Cloud Logging — disagreeing with Errors is itself a signal">
                      Log
                    </th>
                    <th className="py-1 text-right font-normal">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {project.entities.map((entity) => (
                    <tr key={`${entity.kind}:${entity.name}`} className="border-t border-border/60">
                      <td className="py-1 pr-2 font-mono text-xs">{entity.name}</td>
                      <td className="py-1 pr-2 text-right">{formatValue(entity.calls, null)}</td>
                      <td className="py-1 pr-2 text-right text-muted-foreground">
                        {formatValue(entity.callsBaseline, null)}
                      </td>
                      <td className="py-1 pr-2 text-right">{formatValue(entity.errors, null)}</td>
                      <td className="py-1 pr-2 text-right text-muted-foreground">
                        {formatValue(entity.logErrors, null)}
                      </td>
                      {/* C8 — the 5% warn line is drawn on the track, so it
                          doesn't have to be remembered. */}
                      <td className="w-28 py-1">
                        {entity.calls ? (
                          <Meter value={entity.errorRate * 100} max={100} threshold={5} />
                        ) : (
                          <span className="block text-right text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {project.entitiesTotal > project.entities.length && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Showing {project.entities.length} of {project.entitiesTotal}.
                </p>
              )}
            </div>
          )}

          {project.cost && (
            <div className="text-sm">
              <div className="mb-1 text-xs text-muted-foreground">
                Cost · 24h {formatMoney(project.cost.last24h, project.cost.currency)} · 7d{" "}
                {formatMoney(project.cost.last7d, project.cost.currency)} · 30d{" "}
                {formatMoney(project.cost.last30d, project.cost.currency)}
                {project.cost.prev30d ? ` (prev ${formatMoney(project.cost.prev30d, project.cost.currency)})` : ""}
              </div>
              <ul className="space-y-0.5">
                {project.cost.byService.slice(0, 5).map((row) => (
                  <li key={row.service} className="flex justify-between gap-3">
                    <span className="truncate text-muted-foreground">{row.service}</span>
                    <span>{formatMoney(row.cost, project.cost!.currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {project.topErrors.length > 0 && (
            <ul className="space-y-1 text-xs">
              {project.topErrors.map((error, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 text-muted-foreground">{error.count}×</span>
                  <span className="shrink-0 font-mono">{error.source}</span>
                  <span className="truncate text-muted-foreground">{error.message}</span>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

function OverviewTab({
  report,
  projects,
  history,
  resolved,
  lifecycle,
  isNew,
  onAck,
  onSelectRun,
}: {
  report: Report
  projects: ProjectResult[]
  history: HistoryRun[]
  resolved: LifecycleFinding[]
  lifecycle: Map<string, LifecycleFinding>
  isNew: (key: string) => boolean
  onAck: (key: string, ack: boolean) => void
  onSelectRun?: (runId: string) => void
}) {
  // The organising principle the owner asked for: findings grouped by tier,
  // estate-wide, rather than one undifferentiated per-project list.
  const allFindings: Finding[] = projects.flatMap((p) =>
    p.findings.map((f) => ({ ...f, projectName: p.name }))
  )
  const activeFindings = allFindings.filter((f) => lifecycle.get(f.key)?.state !== "acked")
  const ackedFindings = allFindings.filter((f) => lifecycle.get(f.key)?.state === "acked")

  return (
    <div className="space-y-4">
      {/* C3 — the same numbers the tiles used to spend a quarter of the
          viewport on, as one bar whose proportions read at a glance. */}
      <Card className="gap-3 px-4 py-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 space-y-1">
          <ProportionBar
            segments={[
              { level: "critical", count: report.counts.critical },
              { level: "warn", count: report.counts.warn },
              { level: "low", count: report.counts.low },
              { level: "ok", count: report.counts.ok },
            ]}
          />
          {/* The bar's own labels are bare counts; name what they count. */}
          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span>{report.counts.critical} critical</span>
            <span>{report.counts.warn} warning</span>
            <span>{report.counts.low} low</span>
            <span>{report.counts.ok} clean</span>
            <span>of {report.counts.total} projects</span>
          </div>
        </div>
        <div className="shrink-0 text-sm text-muted-foreground sm:w-44 sm:text-right">
          <span className="flex items-center gap-1.5 sm:justify-end">
            <CircleDollarSign className="size-3.5" aria-hidden="true" />
            Cost · {report.costWindowDays}d
          </span>
          <span className="text-foreground">
            {report.costTotal === null ? "—" : formatMoney(report.costTotal, report.costCurrency)}
          </span>
          {/* A bare "—" reads as "zero spend". Say which kind of nothing. */}
          {report.costStale && <span className="block text-xs text-amber-600">export stale</span>}
        </div>
      </Card>

      {/* C2 — the chart that shows a problem *ending*. Sparse until the
          scheduled runs accumulate; it is deliberately shipped early so the
          history it needs starts being recorded now. */}
      {history.length > 1 && (
        <Card className="gap-2 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">Findings over time</span>
            <span className="text-xs text-muted-foreground">{history.length} runs · projects affected, then total findings</span>
          </div>
          <Columns
            runs={history.map((run) => ({
              runId: run.runId,
              generated: run.generated,
              counts: run.counts,
              findingCount: run.findingCount,
            }))}
            activeRunId={report.runId}
            onSelectRun={onSelectRun}
          />
        </Card>
      )}

      {resolved.length > 0 && (
        <Card className="gap-2 border-emerald-300 bg-emerald-50 px-4 py-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Resolved in the last 7 days
          </div>
          <ul className="space-y-0.5 text-xs">
            {resolved.map((finding) => (
              <li key={finding.key} className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-muted-foreground line-through">{finding.key}</span>
                <span className="text-muted-foreground">
                  cleared {timeAgo(finding.resolvedAt!)} after {duration(finding.firstSeen, finding.resolvedAt)} open
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {report.projectErrors.length > 0 && (
        <Card className="gap-2 border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-amber-600">
            <AlertCircle className="size-4" aria-hidden="true" />
            Not checked
          </div>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {report.projectErrors.map((failure) => (
              <li key={failure.project}>
                <span className="font-mono">{failure.project}</span> ({failure.stage}) — {failure.error}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="gap-2 px-4 py-3">
        <div className="text-sm font-medium">
          {activeFindings.length === 0 ? "All projects are healthy" : "Findings, by severity"}
        </div>
        <GroupedFindings findings={activeFindings} lifecycle={lifecycle} isNew={isNew} onAck={onAck} />
        <AckedRow findings={ackedFindings} lifecycle={lifecycle} onAck={onAck} />
      </Card>

      <Card className="gap-2 px-4 py-3">
        <div className="text-sm font-medium">All projects</div>
        <ul className="divide-y divide-border/60">
          {projects.map((project) => (
            <li key={project.project} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <StatusIcon level={project.status} />
                <span className="truncate">{project.name}</span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{project.project}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {project.cost ? formatMoney(project.cost.last30d, project.cost.currency) : "—"}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

/** 5.3 — one row per project: status, findings by tier, calls sparkline,
 *  errors, cost. The existing card is the drill-down, expanded inline. */
function ProjectsTable({
  projects,
  lifecycle,
  isNew,
  onAck,
  highlightKey,
}: {
  projects: ProjectResult[]
  lifecycle: Map<string, LifecycleFinding>
  isNew: (key: string) => boolean
  onAck: (key: string, ack: boolean) => void
  highlightKey?: string
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr className="text-left">
            <th className="py-2 pr-2 pl-3 font-normal">Project</th>
            <th className="py-2 pr-2 font-normal">Findings</th>
            <th className="py-2 pr-2 font-normal">Calls</th>
            <th className="py-2 pr-2 font-normal">Errors</th>
            <th className="py-2 pr-3 text-right font-normal">Cost · 30d</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => {
            const active = project.findings.filter((f) => lifecycle.get(f.key)?.state !== "acked")
            const tierCounts = { critical: 0, warn: 0, low: 0 }
            for (const f of active) tierCounts[f.level]++
            const isOpen = expanded === project.project
            const callsMetric = Object.entries(project.metrics).find(
              ([key]) => /call/i.test(key) && !key.endsWith(".failed")
            )
            return (
              <Fragment key={project.project}>
                <tr
                  className={`cursor-pointer border-t border-border/60 hover:bg-muted/30 ${
                    project.project === highlightKey ? "bg-red-50 dark:bg-red-950/20" : ""
                  }`}
                  onClick={() => setExpanded(isOpen ? null : project.project)}
                >
                  <td className="py-2 pr-2 pl-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <StatusIcon level={project.status} />
                      <span className="truncate font-medium">{project.name}</span>
                    </span>
                  </td>
                  <td className="py-2 pr-2">
                    <span className="flex flex-wrap gap-x-2 text-xs">
                      {tierCounts.critical > 0 && (
                        <span className={LEVEL_TEXT.critical}>{tierCounts.critical} critical</span>
                      )}
                      {tierCounts.warn > 0 && <span className={LEVEL_TEXT.warn}>{tierCounts.warn} warn</span>}
                      {tierCounts.low > 0 && <span className={LEVEL_TEXT.low}>{tierCounts.low} low</span>}
                      {active.length === 0 && <span className="text-muted-foreground">none</span>}
                    </span>
                  </td>
                  <td className="w-24 py-2 pr-2">
                    {callsMetric ? (
                      <Series
                        variant="spark"
                        points={callsMetric[1].history.map((value, i) => ({
                          day: callsMetric[1].days[i] ?? String(i),
                          value,
                        }))}
                        baseline={callsMetric[1].baseline}
                        unit={callsMetric[1].unit}
                        valueFormatter={formatValue}
                        ariaLabel={`${project.name} calls over time`}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-xs text-muted-foreground">
                    {project.errorCount === null
                      ? "unread"
                      : `${formatValue(project.errorCount, null)}${project.errorTruncated ? "+" : ""}`}
                  </td>
                  <td className="py-2 pr-3 pl-2 text-right text-xs">
                    {project.cost ? formatMoney(project.cost.last30d, project.cost.currency) : "—"}
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={5} className="bg-muted/10 p-3">
                      <ProjectCard
                        project={project}
                        lifecycle={lifecycle}
                        isNew={isNew}
                        onAck={onAck}
                        highlight={project.project === highlightKey}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ProjectsTab({
  projects,
  lifecycle,
  isNew,
  onAck,
  viewMode,
  highlightKey,
}: {
  projects: ProjectResult[]
  lifecycle: Map<string, LifecycleFinding>
  isNew: (key: string) => boolean
  onAck: (key: string, ack: boolean) => void
  viewMode: "cards" | "table"
  highlightKey?: string
}) {
  if (projects.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No projects match the current filter.</p>
  }

  if (viewMode === "table") {
    return (
      <ProjectsTable
        projects={projects}
        lifecycle={lifecycle}
        isNew={isNew}
        onAck={onAck}
        highlightKey={highlightKey}
      />
    )
  }

  return (
    <div className="space-y-3">
      {projects.map((project) => (
        <ProjectCard
          key={project.project}
          project={project}
          lifecycle={lifecycle}
          isNew={isNew}
          onAck={onAck}
          highlight={project.project === highlightKey}
        />
      ))}
    </div>
  )
}

/** 4.1 — one function's repeated messages collapse into one expandable row
 *  with a total, instead of drowning the list in ten near-identical lines. */
function ErrorSignatureRow({
  projectName,
  status,
  source,
  total,
  messages,
}: {
  projectName: string
  status: Level
  source: string
  total: number
  messages: { message: string; count: number }[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className="shrink-0 text-muted-foreground">{total}×</span>
        <Badge variant="outline" className="shrink-0">
          {projectName}
        </Badge>
        <span className="shrink-0 font-mono text-xs">{source}</span>
        {messages.length > 1 && (
          <span className="truncate text-xs text-muted-foreground">({messages.length} distinct messages)</span>
        )}
        {messages.length === 1 && <span className="truncate text-muted-foreground">{messages[0].message}</span>}
      </button>
      {open && messages.length > 1 && (
        <ul className="mt-1 space-y-1 pl-9 text-xs">
          {messages.map((m, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground">{m.count}×</span>
              <span className="truncate text-muted-foreground">{m.message}</span>
            </li>
          ))}
        </ul>
      )}
      <span className="sr-only">{LEVEL_LABEL[status]}</span>
    </li>
  )
}

function ErrorsTab({ projects }: { projects: ProjectResult[] }) {
  const signatureMap = new Map<
    string,
    { projectName: string; status: Level; source: string; total: number; messages: { message: string; count: number }[] }
  >()
  for (const project of projects) {
    for (const error of project.topErrors) {
      const key = `${project.project}::${error.source}`
      let entry = signatureMap.get(key)
      if (!entry) {
        entry = { projectName: project.name, status: project.status, source: error.source, total: 0, messages: [] }
        signatureMap.set(key, entry)
      }
      entry.total += error.count
      entry.messages.push({ message: error.message, count: error.count })
    }
  }
  const signatureRows = [...signatureMap.values()].sort((a, b) => b.total - a.total)

  const unread = projects.filter((p) => p.errorCount === null)
  const totalErrors = projects.reduce((sum, p) => sum + (p.errorCount ?? 0), 0)

  // One slot map for the whole tab, built from estate-wide totals — a kind
  // must not change color from one project's row to the next.
  const kindTotals: Record<string, number> = {}
  for (const project of projects) {
    for (const [kind, count] of Object.entries(project.errorKinds || {})) {
      kindTotals[kind] = (kindTotals[kind] || 0) + count
    }
  }
  const slotMap = buildCategoricalSlotMap(kindTotals)
  const kindRows = projects
    .filter((p) => Object.keys(p.errorKinds || {}).length > 0)
    .map((project) => ({
      project,
      segments: toStackedBarSegments(
        Object.entries(project.errorKinds || {}).map(([kind, count]) => ({ key: kind, label: kind, value: count })),
        slotMap
      ),
    }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="Total errors" value={formatValue(totalErrors, null)} icon={AlertCircle} />
        <Tile
          label="Projects with errors"
          value={String(projects.filter((p) => (p.errorCount ?? 0) > 0).length)}
          icon={FolderKanban}
        />
        <Tile
          label="Unread logs"
          value={String(unread.length)}
          tone={unread.length ? LEVEL_TEXT.warn : ""}
          icon={AlertTriangle}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      {unread.length > 0 && (
        <Card className="gap-1 border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <span className="font-medium text-amber-600">Log read failed for:</span>{" "}
          <span className="text-muted-foreground">{unread.map((p) => p.name).join(", ")}</span>
        </Card>
      )}

      {/* C6 — a wall of missing_index is a ten-minute fix; a wall of `other`
          is an investigation. Slots are assigned from the estate-wide totals
          so a kind keeps its color on every row. */}
      {kindRows.length > 0 && (
        <Card className="gap-2 px-4 py-3">
          <div className="text-sm font-medium">Error kinds by project</div>
          <ul className="space-y-2">
            {kindRows.map(({ project, segments }) => (
              <li key={project.project}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate">{project.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {segments.map((s) => `${s.label} ${s.value}`).join(" · ")}
                  </span>
                </div>
                <StackedBar segments={segments} height={14} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="px-4 py-3">
        <div className="mb-2 text-sm font-medium">Top errors across all projects</div>
        {signatureRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No errors in the current window.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {signatureRows.map((row) => (
              <ErrorSignatureRow
                key={`${row.projectName}::${row.source}`}
                projectName={row.projectName}
                status={row.status}
                source={row.source}
                total={row.total}
                messages={row.messages}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card className="px-4 py-3">
        <div className="mb-2 text-sm font-medium">Errors by project</div>
        <ul className="divide-y divide-border/60">
          {[...projects]
            .sort((a, b) => (b.errorCount ?? 0) - (a.errorCount ?? 0))
            .map((project) => (
              <li key={project.project} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <StatusIcon level={project.status} />
                  <span className="truncate">{project.name}</span>
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {project.errorCount === null
                    ? "unread"
                    : `${formatValue(project.errorCount, null)}${project.errorTruncated ? "+" : ""}`}
                </span>
              </li>
            ))}
        </ul>
      </Card>
    </div>
  )
}

function CostTab({ report, projects }: { report: Report; projects: ProjectResult[] }) {
  const withCost = projects.filter((p): p is ProjectResult & { cost: CostBreakdown } => p.cost !== null)
  const sorted = [...withCost].sort((a, b) => b.cost.last30d - a.cost.last30d)

  return (
    <div className="space-y-4">
      {/* A1 — `cost: null` alone can't distinguish "Spark project, nothing to
          bill" from "the billing export stopped weeks ago", and every figure
          on this tab is wrong in the second case. Say which it is. */}
      {report.costStale && (
        <Card className="gap-1 border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <span className="flex items-center gap-1.5 font-medium text-amber-700">
            <AlertTriangle className="size-4" aria-hidden="true" />
            Cost data is stale
          </span>
          <span className="text-muted-foreground">
            {report.costDataThrough
              ? `The billing export has nothing newer than ${report.costDataThrough}. Every figure below is missing whatever happened since.`
              : "The billing export could not be read at all, so no cost figure below can be trusted."}
          </span>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile
          label={`Total · ${report.costWindowDays}d`}
          value={report.costTotal === null ? "—" : formatMoney(report.costTotal, report.costCurrency)}
          icon={CircleDollarSign}
        />
        <Tile
          label="24h"
          value={formatMoney(
            withCost.reduce((sum, p) => sum + p.cost.last24h, 0),
            report.costCurrency
          )}
        />
        <Tile
          label="7d"
          value={formatMoney(
            withCost.reduce((sum, p) => sum + p.cost.last7d, 0),
            report.costCurrency
          )}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      <Card className="px-4 py-3">
        <div className="mb-2 text-sm font-medium">Cost by project · 30d</div>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cost data available.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {sorted.map((project) => {
              const delta = project.cost.prev30d
                ? ((project.cost.last30d - project.cost.prev30d) / project.cost.prev30d) * 100
                : null
              return (
                <li key={project.project} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <StatusIcon level={project.status} />
                    <span className="truncate">{project.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {delta !== null && (
                      <span className={`text-xs ${delta > 5 ? LEVEL_TEXT.warn : "text-muted-foreground"}`}>
                        {delta > 0 ? "+" : ""}
                        {Math.round(delta)}%
                      </span>
                    )}
                    <span>{formatMoney(project.cost.last30d, project.cost.currency)}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {sorted.map((project) => (
        <Card key={project.project} className="px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-sm font-medium">
            <span>{project.name}</span>
            <span className="text-xs text-muted-foreground">
              24h {formatMoney(project.cost.last24h, project.cost.currency)} · 7d{" "}
              {formatMoney(project.cost.last7d, project.cost.currency)}
            </span>
          </div>
          <ul className="space-y-0.5 text-sm">
            {project.cost.byService.slice(0, 5).map((row) => (
              <li key={row.service} className="flex justify-between gap-3">
                <span className="truncate text-muted-foreground">{row.service}</span>
                <span>{formatMoney(row.cost, project.cost.currency)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}

/** 4.4 — one filter row above everything it scopes: project + level,
 *  never per-chart or inside a chart card. Also carries the Projects tab's
 *  cards/table density toggle, since that too is a single, shared control. */
function FilterBar({
  projects,
  projectFilter,
  levelFilter,
  onProjectFilterChange,
  onLevelFilterChange,
  viewMode,
  onViewModeChange,
  showViewToggle,
}: {
  projects: ProjectResult[]
  projectFilter: string
  levelFilter: string
  onProjectFilterChange: (value: string) => void
  onLevelFilterChange: (value: string) => void
  viewMode: "cards" | "table"
  onViewModeChange: (value: "cards" | "table") => void
  showViewToggle: boolean
}) {
  const levels: Level[] = ["critical", "warn", "low", "ok"]
  return (
    <Card className="flex-row flex-wrap items-center gap-2 px-4 py-2.5">
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <ListFilter className="size-3.5" aria-hidden="true" />
        Filter
      </span>
      <select
        value={projectFilter}
        onChange={(e) => onProjectFilterChange(e.target.value)}
        aria-label="Filter by project"
        className="min-w-0 rounded-md border border-border bg-background px-2 py-1 text-xs"
      >
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.project} value={p.project}>
            {p.name}
          </option>
        ))}
      </select>
      <select
        value={levelFilter}
        onChange={(e) => onLevelFilterChange(e.target.value)}
        aria-label="Filter by level"
        className="min-w-0 rounded-md border border-border bg-background px-2 py-1 text-xs"
      >
        <option value="">All levels</option>
        {levels.map((level) => (
          <option key={level} value={level}>
            {LEVEL_LABEL[level]}
          </option>
        ))}
      </select>
      {(projectFilter || levelFilter) && (
        <button
          type="button"
          onClick={() => {
            onProjectFilterChange("")
            onLevelFilterChange("")
          }}
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Clear
        </button>
      )}
      {showViewToggle && (
        <div className="ml-auto flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5">
          <button
            type="button"
            onClick={() => onViewModeChange("cards")}
            aria-pressed={viewMode === "cards"}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
              viewMode === "cards" ? "bg-muted font-medium" : "text-muted-foreground"
            }`}
          >
            <LayoutGrid className="size-3.5" aria-hidden="true" />
            Cards
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange("table")}
            aria-pressed={viewMode === "table"}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
              viewMode === "table" ? "bg-muted font-medium" : "text-muted-foreground"
            }`}
          >
            <TableIcon className="size-3.5" aria-hidden="true" />
            Table
          </button>
        </div>
      )}
    </Card>
  )
}

export default function Health() {
  const [user, setUser] = useState<{ uid: string; email: string | null } | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingReport, setLoadingReport] = useState(false)
  const [busy, setBusy] = useState(false)
  const [findings, setFindings] = useState<LifecycleFinding[]>([])
  const [history, setHistory] = useState<HistoryRun[]>([])
  const [seen, setSeen] = useState<{ lastViewedRunId: string | null; lastViewedAt: string | null } | null>(null)
  const [viewingRunId, setViewingRunId] = useState<string | null>(null)

  // 4.4 — one filter row's state, linkable via the URL hash.
  const hashState = useHashState()
  const [tab, setTabState] = useState("overview")
  const [projectFilter, setProjectFilterState] = useState("")
  const [levelFilter, setLevelFilterState] = useState("")
  const hashInitialized = useRef(false)

  useEffect(() => {
    if (!hashState.ready || hashInitialized.current) return
    hashInitialized.current = true
    if (hashState.params.tab) setTabState(hashState.params.tab)
    if (hashState.params.project) setProjectFilterState(hashState.params.project)
    if (hashState.params.level) setLevelFilterState(hashState.params.level)
  }, [hashState.ready, hashState.params])

  const setTab = useCallback(
    (next: string) => {
      setTabState(next)
      hashState.update({ tab: next === "overview" ? null : next })
    },
    [hashState]
  )
  const setProjectFilter = useCallback(
    (next: string) => {
      setProjectFilterState(next)
      hashState.update({ project: next || null })
    },
    [hashState]
  )
  const setLevelFilter = useCallback(
    (next: string) => {
      setLevelFilterState(next)
      hashState.update({ level: next || null })
    },
    [hashState]
  )

  // 5.3 — table vs card density for the Projects tab, remembered per viewer.
  const [viewMode, setViewModeState] = useState<"cards" | "table">("cards")
  // 5.4 — light/dark is a toggle, default light, remembered per viewer.
  const [theme, setThemeState] = useState<"light" | "dark">("light")

  useEffect(() => {
    const storedView = readLocalStorage("health.viewMode")
    if (storedView === "table" || storedView === "cards") setViewModeState(storedView)
    const storedTheme = readLocalStorage("health.theme")
    if (storedTheme === "dark" || storedTheme === "light") setThemeState(storedTheme)
  }, [])

  const setViewMode = useCallback((next: "cards" | "table") => {
    setViewModeState(next)
    writeLocalStorage("health.viewMode", next)
  }, [])
  const setTheme = useCallback((next: "light" | "dark") => {
    setThemeState(next)
    writeLocalStorage("health.theme", next)
  }, [])

  // The chart palette (palette.css) keys off `data-theme` on the document
  // root — apply the page's own choice there for as long as it's mounted,
  // regardless of the rest of the (dark) site or the system preference.
  useEffect(() => {
    const root = document.documentElement
    const previous = root.getAttribute("data-theme")
    root.setAttribute("data-theme", theme)
    return () => {
      if (previous) root.setAttribute("data-theme", previous)
      else root.removeAttribute("data-theme")
    }
  }, [theme])

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    watchAuth((next) => {
      setUser(next ? { uid: next.uid, email: next.email } : null)
      setAuthReady(true)
    }).then((fn) => {
      unsubscribe = fn
    })
    return () => unsubscribe?.()
  }, [])

  const load = useCallback(async (runId?: string) => {
    setError(null)
    setLoadingReport(true)
    try {
      // The lifecycle, history and seen-marker reads are all additive: if any
      // of them fails the report still renders, just without its time
      // dimension. They must never be able to take the page down.
      const [result, findingsResult, historyResult, seenResult] = await Promise.all([
        getHealthReport(runId ? { runId } : {}),
        getHealthFindings().catch(() => null),
        getHealthReport({ history: 60 }).catch(() => null),
        getHealthSeen().catch(() => null),
      ])
      setReport(result.data as Report)
      setViewingRunId(runId ?? null)
      if (findingsResult) setFindings(((findingsResult.data as { findings: LifecycleFinding[] }).findings) || [])
      if (historyResult) setHistory(((historyResult.data as { runs: HistoryRun[] }).runs) || [])
      if (seenResult) setSeen(seenResult.data as { lastViewedRunId: string | null; lastViewedAt: string | null })
    } catch (err) {
      const code = (err as { code?: string }).code || ""
      // A signed-in account that isn't on the allowlist gets a clean refusal,
      // not a broken page.
      if (code.includes("permission-denied")) setError("This account isn't allowed to view health data.")
      else if (code.includes("not-found")) setError("No report has been generated yet.")
      else setError((err as Error).message || "Could not load the report.")
    } finally {
      setLoadingReport(false)
    }
  }, [])

  useEffect(() => {
    if (user) load()
  }, [user, load])

  const runNow = async () => {
    setBusy(true)
    setError(null)
    try {
      await runHealthCheckNow()
      await load()
    } catch (err) {
      setError((err as Error).message || "The run failed.")
    } finally {
      setBusy(false)
    }
  }

  const projects = useMemo(() => {
    if (!report) return []
    return [...report.projects].sort(
      (a, b) => LEVEL_ORDER[a.status] - LEVEL_ORDER[b.status] || a.name.localeCompare(b.name)
    )
  }, [report])

  const errorTotal = useMemo(
    () => projects.reduce((sum, p) => sum + (p.errorCount ?? 0), 0),
    [projects]
  )

  // 5.1 — the one card that gets a saturated fill: the single worst project
  // in the estate. `projects` is already sorted worst-first.
  const highlightKey = useMemo(() => projects.find((p) => p.status !== "ok")?.project, [projects])

  // 4.4 — the filter row scopes only the Projects and Errors tabs.
  const filteredProjects = useMemo(
    () =>
      projects.filter(
        (p) => (!projectFilter || p.project === projectFilter) && (!levelFilter || p.status === levelFilter)
      ),
    [projects, projectFilter, levelFilter]
  )

  const lifecycle = useMemo(() => new Map(findings.map((f) => [f.key, f])), [findings])

  // The callable returns runs newest-first (orderBy runId desc), but every
  // time-series mark on this page reads left-to-right as oldest-to-newest.
  // Reverse once, here, rather than in each chart.
  const chronological = useMemo(() => [...history].reverse(), [history])

  /** Findings that cleared recently — the answer to "did my fix land", and
   *  the one thing a run snapshot can never show. */
  const resolved = useMemo(() => {
    const cutoff = Date.now() - 7 * 86400000
    return findings
      .filter((f) => f.state === "resolved" && f.resolvedAt && new Date(f.resolvedAt).getTime() > cutoff)
      .sort((a, b) => (b.resolvedAt || "").localeCompare(a.resolvedAt || ""))
  }, [findings])

  /** New *since you last looked*, not since the previous run — being away for
   *  a day must not roll the window past (plan.md §1.4). Falls back to the
   *  run's own diff when there is no marker yet. */
  const isNew = useCallback(
    (key: string) => {
      const life = lifecycle.get(key)
      if (seen?.lastViewedAt && life) return life.firstSeen > seen.lastViewedAt
      return (report?.newFindingKeys || []).includes(key)
    },
    [lifecycle, seen, report]
  )

  const sinceLast = useMemo(() => {
    if (!seen?.lastViewedAt) return null
    const newCount = findings.filter((f) => f.firstSeen > seen.lastViewedAt!).length
    const clearedCount = findings.filter(
      (f) => f.state === "resolved" && f.resolvedAt && f.resolvedAt > seen.lastViewedAt!
    ).length
    const stillOpen = findings.filter((f) => f.state === "open" || f.state === "acked").length
    return { newCount, clearedCount, stillOpen, at: seen.lastViewedAt }
  }, [findings, seen])

  const onAck = useCallback(
    async (key: string, ack: boolean) => {
      // Optimistic: the sweep is the source of truth, but waiting three hours
      // to see an ack take effect would make the control feel broken.
      setFindings((prev) =>
        prev.map((f) => (f.key === key ? { ...f, state: ack ? "acked" : "open", ackedUntil: null } : f))
      )
      try {
        await ackFinding({ key, ack })
      } catch (err) {
        setError((err as Error).message || "Could not update that acknowledgement.")
        await load(viewingRunId ?? undefined)
      }
    },
    [load, viewingRunId]
  )

  const markSeen = useCallback(async () => {
    if (!report) return
    try {
      await markHealthSeen({ runId: report.runId })
      setSeen({ lastViewedRunId: report.runId, lastViewedAt: new Date().toISOString() })
    } catch (err) {
      setError((err as Error).message || "Could not save that.")
    }
  }, [report])

  if (!authReady) {
    return (
      <div className="health-light flex min-h-svh items-center justify-center bg-background text-foreground">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="health-light flex min-h-svh flex-col items-center justify-center gap-4 bg-background px-4 text-foreground">
        <div className="flex items-center gap-2 text-xl font-semibold">
          <Activity className="size-5" aria-hidden="true" />
          System health
        </div>
        <p className="text-sm text-muted-foreground">Internal dashboard. Sign in to continue.</p>
        <Button onClick={() => signInWithGoogle().catch((e) => setError(e.message))}>
          <LogIn aria-hidden="true" />
          Sign in with Google
        </Button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    )
  }

  return (
    <div className={`min-h-svh bg-background text-foreground ${theme === "light" ? "health-light" : ""}`}>
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Activity className="size-4.5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold">System health</h1>
                {report && <StatusIcon level={report.status} />}
              </div>
              {report && (
                <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                  <span title={exactTime(report.generated)}>
                    {LEVEL_LABEL[report.status]} · {timeAgo(report.generated)}
                  </span>
                  · {report.mode} · {Math.round(report.durationMs / 1000)}s · {report.logHours}h error window
                  {/* Three runs a day; past ~9h the page is showing a sweep
                      that should already have been replaced. Say so rather
                      than look current. */}
                  {Date.now() - new Date(report.generated).getTime() > 9 * 3600000 && (
                    <span className="text-amber-600">· stale</span>
                  )}
                  {loadingReport && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={runNow}
              disabled={busy || loadingReport}
              title="Full sweep. Sends no email and doesn't change what the next scheduled run will alert on."
            >
              <RefreshCw className={busy ? "animate-spin" : ""} aria-hidden="true" />
              {busy ? "Running…" : "Run now"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
              aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            >
              {theme === "light" ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => signOut()}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut aria-hidden="true" />
            </Button>
          </div>
        </header>

        {error && (
          <Card className="flex-row items-center gap-2 border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600">
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            {error}
          </Card>
        )}

        {loadingReport && !report && !error && (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <p className="text-sm">Loading report…</p>
          </div>
        )}

        {/* C1 — the run history as a band. Click a cell to open that run. */}
        {chronological.length > 1 && (
          <div className="space-y-1">
            <StatusBand
              runs={chronological.map((run) => ({
                runId: run.runId,
                generated: run.generated,
                status: run.status,
                counts: run.counts,
              }))}
              activeRunId={report?.runId}
              onSelectRun={(runId) => load(runId)}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{timeAgo(chronological[0].generated)}</span>
              {viewingRunId ? (
                <button type="button" onClick={() => load()} className="underline underline-offset-2">
                  Viewing a past run — back to latest
                </button>
              ) : (
                <span>now</span>
              )}
            </div>
          </div>
        )}

        {sinceLast && (sinceLast.newCount > 0 || sinceLast.clearedCount > 0) && (
          <Card className="flex-row flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
            <span>
              <span className="text-muted-foreground">Since your last visit ({timeAgo(sinceLast.at)}):</span>{" "}
              <span className={sinceLast.newCount ? LEVEL_TEXT.critical : ""}>{sinceLast.newCount} new</span> ·{" "}
              <span className={sinceLast.clearedCount ? "text-emerald-600" : ""}>
                {sinceLast.clearedCount} resolved
              </span>{" "}
              · {sinceLast.stillOpen} still open
            </span>
            <Button variant="ghost" size="sm" onClick={markSeen}>
              Mark all as seen
            </Button>
          </Card>
        )}

        {report && (
          <Tabs value={tab} onValueChange={setTab} className="space-y-4">
            <TabsList className="grid w-full grid-cols-4 bg-muted sm:flex">
              <TabsTrigger value="overview" className="sm:flex-1">
                <LayoutDashboard className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Overview</span>
              </TabsTrigger>
              <TabsTrigger value="projects" className="sm:flex-1">
                <FolderKanban className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Projects</span>
                {report.counts.critical + report.counts.warn > 0 && (
                  <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                    {report.counts.critical + report.counts.warn}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="errors" className="sm:flex-1">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Errors</span>
                {errorTotal > 0 && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    {formatValue(errorTotal, null)}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="cost" className="sm:flex-1">
                <CircleDollarSign className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Cost</span>
              </TabsTrigger>
            </TabsList>

            {/* 4.4 — one filter row above everything it scopes: Projects and
                Errors only, never per-chart or duplicated per tab. */}
            {(tab === "projects" || tab === "errors") && (
              <FilterBar
                projects={projects}
                projectFilter={projectFilter}
                levelFilter={levelFilter}
                onProjectFilterChange={setProjectFilter}
                onLevelFilterChange={setLevelFilter}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                showViewToggle={tab === "projects"}
              />
            )}

            <TabsContent value="overview">
              <OverviewTab
                report={report}
                projects={projects}
                history={chronological}
                resolved={resolved}
                lifecycle={lifecycle}
                isNew={isNew}
                onAck={onAck}
                onSelectRun={(runId) => load(runId)}
              />
            </TabsContent>
            <TabsContent value="projects">
              <ProjectsTab
                projects={filteredProjects}
                lifecycle={lifecycle}
                isNew={isNew}
                onAck={onAck}
                viewMode={viewMode}
                highlightKey={highlightKey}
              />
            </TabsContent>
            <TabsContent value="errors">
              <ErrorsTab projects={filteredProjects} />
            </TabsContent>
            <TabsContent value="cost">
              <CostTab report={report} projects={projects} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}
