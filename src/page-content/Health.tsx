import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  XCircle,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { watchAuth, signInWithGoogle, signOut, getHealthReport, runHealthCheckNow } from "@/lib/firebase"

type Level = "critical" | "warn" | "ok"

interface Finding {
  key: string
  level: Exclude<Level, "ok">
  kind: string
  text: string
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
  projects: ProjectResult[]
  projectErrors: { project: string; stage: string; error: string }[]
}

const LEVEL_ORDER: Record<Level, number> = { critical: 0, warn: 1, ok: 2 }

const LEVEL_STYLE: Record<Level, string> = {
  critical: "border-red-300 bg-red-50",
  warn: "border-amber-300 bg-amber-50",
  ok: "border-border",
}

const LEVEL_TEXT: Record<Level, string> = {
  critical: "text-red-600",
  warn: "text-amber-600",
  ok: "text-emerald-600",
}

const LEVEL_ICON: Record<Level, typeof CheckCircle2> = {
  critical: XCircle,
  warn: AlertTriangle,
  ok: CheckCircle2,
}

const LEVEL_LABEL: Record<Level, string> = {
  critical: "Critical",
  warn: "Warning",
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

/** A bare inline bar chart. The shape of the trend is the point, not the pixels. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const max = Math.max(...values, 1)
  return (
    <div className="flex h-6 items-end gap-px" aria-hidden="true">
      {values.map((value, i) => (
        <div
          key={i}
          className={`w-1 rounded-sm ${i === values.length - 1 ? "bg-foreground/70" : "bg-foreground/20"}`}
          style={{ height: `${Math.max(2, (value / max) * 100)}%` }}
        />
      ))}
    </div>
  )
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

function ProjectCard({ project }: { project: ProjectResult }) {
  const [open, setOpen] = useState(false)
  const metrics = Object.entries(project.metrics).filter(([key]) => !key.endsWith(".failed"))

  return (
    <Card className={`gap-3 px-4 py-4 ${LEVEL_STYLE[project.status]}`}>
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
              {project.findings.length
                ? `${project.findings.length} finding${project.findings.length === 1 ? "" : "s"}`
                : "No findings"}
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

        {project.findings.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {project.findings.map((finding) => (
              <li key={finding.key} className="flex gap-2">
                <span className={`shrink-0 font-medium ${LEVEL_TEXT[finding.level]}`}>{finding.kind}</span>
                <span className="text-muted-foreground">{finding.text}</span>
              </li>
            ))}
          </ul>
        )}

        <CollapsibleContent className="space-y-4 overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down data-[state=open]:mt-4 data-[state=open]:border-t data-[state=open]:border-border data-[state=open]:pt-3">
          {metrics.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Last 24h vs the 14-day median — as of the last sweep, not a live counter, and calls are
                summed across every function in the project.
              </p>
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
                    <Sparkline values={metric.history} />
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
                      <td className={`py-1 text-right ${entity.errorRate >= 0.05 ? LEVEL_TEXT.warn : ""}`}>
                        {entity.calls ? `${Math.round(entity.errorRate * 100)}%` : "—"}
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

function OverviewTab({ report, projects }: { report: Report; projects: ProjectResult[] }) {
  const attention = projects.filter((p) => p.status !== "ok")

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Critical" value={String(report.counts.critical)} tone={LEVEL_TEXT.critical} icon={XCircle} />
        <Tile label="Warning" value={String(report.counts.warn)} tone={LEVEL_TEXT.warn} icon={AlertTriangle} />
        <Tile label="Clean" value={`${report.counts.ok}/${report.counts.total}`} icon={CheckCircle2} />
        <Tile
          label={`Cost · ${report.costWindowDays}d`}
          value={report.costTotal === null ? "—" : formatMoney(report.costTotal, report.costCurrency)}
          icon={CircleDollarSign}
        />
      </div>

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
          {attention.length === 0 ? "All projects are healthy" : "Needs attention"}
        </div>
        {attention.length > 0 && (
          <ul className="divide-y divide-border/60">
            {attention.map((project) => (
              <li key={project.project} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <StatusIcon level={project.status} />
                  <span className="truncate">{project.name}</span>
                </span>
                <span className={`shrink-0 text-xs ${LEVEL_TEXT[project.status]}`}>
                  {project.findings.length} finding{project.findings.length === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
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

function ProjectsTab({ projects }: { projects: ProjectResult[] }) {
  return (
    <div className="space-y-3">
      {projects.map((project) => (
        <ProjectCard key={project.project} project={project} />
      ))}
    </div>
  )
}

function ErrorsTab({ projects }: { projects: ProjectResult[] }) {
  const rows = projects.flatMap((project) =>
    project.topErrors.map((error) => ({ ...error, project: project.name, status: project.status }))
  )
  rows.sort((a, b) => b.count - a.count)

  const unread = projects.filter((p) => p.errorCount === null)
  const totalErrors = projects.reduce((sum, p) => sum + (p.errorCount ?? 0), 0)

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

      <Card className="px-4 py-3">
        <div className="mb-2 text-sm font-medium">Top errors across all projects</div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No errors in the current window.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {rows.map((error, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="shrink-0 text-muted-foreground">{error.count}×</span>
                <Badge variant="outline" className="shrink-0">
                  {error.project}
                </Badge>
                <span className="shrink-0 font-mono text-xs">{error.source}</span>
                <span className="truncate text-muted-foreground">{error.message}</span>
              </li>
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

export default function Health() {
  const [user, setUser] = useState<{ uid: string; email: string | null } | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingReport, setLoadingReport] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState("overview")

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

  const load = useCallback(async () => {
    setError(null)
    setLoadingReport(true)
    try {
      const result = await getHealthReport()
      setReport(result.data as Report)
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
    <div className="health-light min-h-svh bg-background text-foreground">
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
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  {LEVEL_LABEL[report.status]} · {timeAgo(report.generated)} · {report.mode} ·{" "}
                  {Math.round(report.durationMs / 1000)}s · {report.logHours}h error window
                  {loadingReport && (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  )}
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

            <TabsContent value="overview">
              <OverviewTab report={report} projects={projects} />
            </TabsContent>
            <TabsContent value="projects">
              <ProjectsTab projects={projects} />
            </TabsContent>
            <TabsContent value="errors">
              <ErrorsTab projects={projects} />
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
