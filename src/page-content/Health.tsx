import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  AlertCircle,
  CircleDollarSign,
  LayoutDashboard,
  ListFilter,
  Loader2,
  LogIn,
  LogOut,
  Moon,
  RefreshCw,
  Sun,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
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
import { StatusBand } from "@/components/health/charts"
import type { HistoryRun, Level, LifecycleFinding, ProjectResult, Report } from "@/components/health/types"
import {
  LEVEL_ORDER,
  LEVEL_TEXT,
  LEVEL_LABEL,
  SEVERITY_TABS,
  TAB_FOR_LEVEL,
  TAB_VALUES,
} from "@/components/health/levels"
import {
  exactTime,
  readLocalStorage,
  timeAgo,
  useHashState,
  writeLocalStorage,
} from "@/components/health/format"
import { StatusIcon } from "@/components/health/primitives"
import { OverviewTab } from "@/components/health/tab-overview"
import { SeverityTab, ErrorLogPanels } from "@/components/health/tab-severity"
import { CostTab } from "@/components/health/tab-cost"

/** One filter row above everything it scopes. Project only — the severity
 *  tabs are the level filter now, and a second control that could contradict
 *  the open tab was exactly the kind of thing making this page hard to read. */
function FilterBar({
  projects,
  projectFilter,
  onProjectFilterChange,
}: {
  projects: ProjectResult[]
  projectFilter: string
  onProjectFilterChange: (value: string) => void
}) {
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
      {projectFilter && (
        <button
          type="button"
          onClick={() => onProjectFilterChange("")}
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Clear
        </button>
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
  const hashInitialized = useRef(false)

  useEffect(() => {
    if (!hashState.ready || hashInitialized.current) return
    hashInitialized.current = true
    // A stale link (#tab=projects, from before the severity tabs) must not
    // select a tab that no longer exists and render nothing.
    if (hashState.params.tab && TAB_VALUES.includes(hashState.params.tab)) setTabState(hashState.params.tab)
    if (hashState.params.project) setProjectFilterState(hashState.params.project)
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

  // 5.4 — light/dark is a toggle, default light, remembered per viewer.
  const [theme, setThemeState] = useState<"light" | "dark">("light")

  useEffect(() => {
    const storedTheme = readLocalStorage("health.theme")
    if (storedTheme === "dark" || storedTheme === "light") setThemeState(storedTheme)
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

  // The filter row scopes the severity tabs; the tab itself is the level.
  const filteredProjects = useMemo(
    () => projects.filter((p) => !projectFilter || p.project === projectFilter),
    [projects, projectFilter]
  )


  const lifecycle = useMemo(() => new Map(findings.map((f) => [f.key, f])), [findings])
  /** Findings per level across the estate — the tab badges. Counts findings,
   *  not projects, and skips acked ones so a badge never contradicts the
   *  list it labels. */
  const findingCounts = useMemo(() => {
    const counts: Record<Exclude<Level, "ok">, number> = { critical: 0, warn: 0, low: 0 }
    for (const project of projects) {
      for (const finding of project.findings) {
        if (lifecycle.get(finding.key)?.state === "acked") continue
        counts[finding.level] += 1
      }
    }
    return counts
  }, [projects, lifecycle])

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
        {error && <p className={`text-sm ${LEVEL_TEXT.critical}`}>{error}</p>}
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
                    <span className={LEVEL_TEXT.warn}>· stale</span>
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
          <Card className={`flex-row items-center gap-2 border-l-[3px] border-l-[var(--hc-critical)] px-4 py-3 text-sm ${LEVEL_TEXT.critical}`}>
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
          <Card className="flex-row flex-wrap items-center justify-between gap-2 bg-muted/40 px-4 py-2.5 text-sm">
            <span>
              <span className="text-muted-foreground">Since your last visit ({timeAgo(sinceLast.at)}):</span>{" "}
              <span className={`font-mono font-medium ${sinceLast.newCount ? LEVEL_TEXT.critical : ""}`}>
                {sinceLast.newCount} new
              </span>{" "}
              ·{" "}
              <span className={`font-mono font-medium ${sinceLast.clearedCount ? LEVEL_TEXT.ok : ""}`}>
                {sinceLast.clearedCount} resolved
              </span>{" "}
              · <span className="font-mono font-medium">{sinceLast.stillOpen}</span> still open
            </span>
            <Button variant="ghost" size="sm" onClick={markSeen}>
              Mark all as seen
            </Button>
          </Card>
        )}

        {report && (
          <Tabs value={tab} onValueChange={setTab} className="space-y-4">
            {/* One tab per severity, which is how the dashboard is actually
                read ("what's broken, what's odd, what's noise") — the old
                Projects/Errors split was the same findings cut two ways. */}
            <TabsList className="grid w-full grid-cols-5 bg-muted sm:flex">
              <TabsTrigger value="overview" className="sm:flex-1">
                <LayoutDashboard className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Overview</span>
              </TabsTrigger>
              {SEVERITY_TABS.map(({ value, level, label, icon: Icon }) => (
                <TabsTrigger key={value} value={value} className="sm:flex-1">
                  <Icon className={`size-4 ${LEVEL_TEXT[level]}`} aria-hidden="true" />
                  <span className="hidden sm:inline">{label}</span>
                  {findingCounts[level] > 0 && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      {findingCounts[level]}
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
              <TabsTrigger value="cost" className="sm:flex-1">
                <CircleDollarSign className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Cost</span>
              </TabsTrigger>
            </TabsList>

            {/* One filter row above everything it scopes — the severity tabs
                only, since the tab itself is now the level filter. */}
            {tab !== "overview" && tab !== "cost" && (
              <FilterBar
                projects={projects}
                projectFilter={projectFilter}
                onProjectFilterChange={setProjectFilter}
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
                errorTotal={errorTotal}
                onSelectRun={(runId) => load(runId)}
                onOpenLevel={(level) => setTab(TAB_FOR_LEVEL[level])}
              />
            </TabsContent>

            {SEVERITY_TABS.map(({ value, level, emptyText }) => (
              <TabsContent key={value} value={value}>
                <SeverityTab
                  level={level}
                  projects={filteredProjects}
                  lifecycle={lifecycle}
                  isNew={isNew}
                  onAck={onAck}
                  emptyText={emptyText}
                >
                  {level === "critical" && <ErrorLogPanels projects={filteredProjects} />}
                </SeverityTab>
              </TabsContent>
            ))}

            <TabsContent value="cost">
              <CostTab report={report} projects={projects} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}

