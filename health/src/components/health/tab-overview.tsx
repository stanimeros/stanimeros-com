// Overview is a landing screen, not a report: the estate in one strip, then
// one card per project. Every finding it counts is listed in full on a
// severity tab, so nothing here needs to show findings themselves.

import { AlertCircle, CheckCircle2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import type { Level, LifecycleFinding, ProjectResult, Report } from "./types"
import { LEVEL_STYLE, LEVEL_TEXT, splitFindingCounts } from "./levels"
import { formatValue } from "./format"
import { CollapsedSection, StatusIcon } from "./primitives"

/** A severity count plus, when any are acked, a muted "(N)" alongside it --
 *  the one convention every count on this page uses now, so "0" never reads
 *  as "nothing happened here" when four things happened and got resolved. */
function CountWithResolved({ value, resolved, tone }: { value: number; resolved: number; tone: string }) {
  return (
    <span className={`text-lg font-semibold tabular-nums ${value ? tone : "text-muted-foreground"}`}>
      {value}
      {resolved > 0 && <span className="ml-1 text-xs font-normal text-muted-foreground">({resolved})</span>}
    </span>
  )
}

/** One project, reduced to its severity counts — the grid Overview is built
 *  from. The name opens the Projects drill-down for this project; each
 *  non-zero count opens the matching severity tab, filtered to it. */
function ProjectOverviewCard({
  project,
  lifecycle,
  onSelect,
}: {
  project: ProjectResult
  lifecycle: Map<string, LifecycleFinding>
  onSelect: (project: ProjectResult, tab: string) => void
}) {
  const { open: counts, acked: resolved } = splitFindingCounts(project.findings, lifecycle)
  // All three are finding counts, so the row reads as one series. The raw
  // Cloud Logging line count used to sit in the first cell — a different
  // measure over a different window, which made the three numbers look
  // comparable when they weren't. It lives on the Critical tab now.
  const cells: { label: string; value: number; resolved: number; tone: string; tab: string }[] = [
    { label: "critical", value: counts.critical, resolved: resolved.critical, tone: LEVEL_TEXT.critical, tab: "errors" },
    { label: "warnings", value: counts.warn, resolved: resolved.warn, tone: LEVEL_TEXT.warn, tab: "warnings" },
    { label: "low", value: counts.low, resolved: resolved.low, tone: LEVEL_TEXT.low, tab: "low" },
  ]
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm ${LEVEL_STYLE[project.status]}`}
    >
      <button
        type="button"
        onClick={() => onSelect(project, "projects")}
        className="flex min-w-0 cursor-pointer items-center gap-1.5 text-left hover:underline"
      >
        <StatusIcon level={project.status} className="size-3.5" />
        <span className="truncate font-semibold">{project.name}</span>
      </button>
      <div className="grid grid-cols-3 gap-2">
        {cells.map((cell) => (
          <button
            type="button"
            key={cell.label}
            disabled={!cell.value}
            onClick={() => onSelect(project, cell.tab)}
            className={`flex flex-col items-center gap-0.5 rounded-lg py-1.5 ${
              cell.value ? "cursor-pointer hover:bg-muted/50" : "cursor-default"
            }`}
          >
            <CountWithResolved value={cell.value} resolved={cell.resolved} tone={cell.tone} />
            <span className="text-[10px] text-muted-foreground">{cell.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** The estate in one line. Replaces the proportion-bar card: at fifteen
 *  projects the bar's segments were never the thing being read — the numbers
 *  beside it were. */
export function StatStrip({
  report,
  findingCounts,
  ackedCounts,
  errorTotal,
  healthyCount,
}: {
  report: Report
  findingCounts: Record<Exclude<Level, "ok">, number>
  /** Same split as `findingCounts`, inverted — acked findings per level, so
   *  the strip can say "0 (4)" instead of a bare "0" that looks identical to
   *  a project with nothing to resolve. */
  ackedCounts: Record<Exclude<Level, "ok">, number>
  errorTotal: number
  /** Projects with no un-acked findings — not `report.counts.ok`, which is
   *  computed by the sweep with no awareness of acks and so never rises
   *  just because everything on a project got marked resolved. */
  healthyCount: number
}) {
  // Findings for the three severities, then projects for "healthy" — the
  // trailing "of N projects" is what says the last number counts something
  // else. The raw log-line total is named separately ("log lines"), never
  // mixed in as if it were a finding count.
  const cells: { label: string; value: number; resolved: number; tone: string }[] = [
    { label: "critical", value: findingCounts.critical, resolved: ackedCounts.critical, tone: LEVEL_TEXT.critical },
    { label: "warnings", value: findingCounts.warn, resolved: ackedCounts.warn, tone: LEVEL_TEXT.warn },
    { label: "low", value: findingCounts.low, resolved: ackedCounts.low, tone: LEVEL_TEXT.low },
  ]
  return (
    <Card className="flex-row flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
      {cells.map((cell) => (
        <span key={cell.label} className="flex items-baseline gap-1.5">
          <CountWithResolved value={cell.value} resolved={cell.resolved} tone={cell.tone} />
          <span className="text-xs text-muted-foreground">{cell.label}</span>
        </span>
      ))}
      <span className="flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tabular-nums">{formatValue(errorTotal, null)}</span>
        <span className="text-xs text-muted-foreground">log lines</span>
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className={`text-lg font-semibold tabular-nums ${healthyCount ? LEVEL_TEXT.ok : ""}`}>{healthyCount}</span>
        <span className="text-xs text-muted-foreground">healthy</span>
      </span>
      <span className="ml-auto text-xs text-muted-foreground">of {report.counts.total} projects</span>
    </Card>
  )
}

/** The estate strip, one card per project, and anything the sweep could not
 *  check. Nothing here is unique to this tab — the severity tabs hold the
 *  full lists — so keeping it to one screen costs no information. */
export function OverviewTab({
  report,
  projects,
  lifecycle,
  findingCounts,
  ackedCounts,
  errorTotal,
  onSelectProject,
}: {
  report: Report
  projects: ProjectResult[]
  lifecycle: Map<string, LifecycleFinding>
  findingCounts: Record<Exclude<Level, "ok">, number>
  ackedCounts: Record<Exclude<Level, "ok">, number>
  errorTotal: number
  onSelectProject: (project: ProjectResult, tab: string) => void
}) {
  const healthyCount = projects.filter((p) => p.status === "ok").length
  return (
    <div className="space-y-3">
      <StatStrip
        report={report}
        findingCounts={findingCounts}
        ackedCounts={ackedCounts}
        errorTotal={errorTotal}
        healthyCount={healthyCount}
      />

      {projects.length === 0 ? (
        <Card className="gap-1 px-4 py-3 text-sm">
          <span className={`flex items-center gap-1.5 font-medium ${LEVEL_TEXT.ok}`}>
            <CheckCircle2 className="size-4" aria-hidden="true" />
            No projects
          </span>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectOverviewCard key={project.project} project={project} lifecycle={lifecycle} onSelect={onSelectProject} />
          ))}
        </div>
      )}

      {report.projectErrors.length > 0 && (
        <CollapsedSection
          label={`${report.projectErrors.length} project${report.projectErrors.length === 1 ? "" : "s"} not checked`}
          icon={AlertCircle}
          tone={LEVEL_TEXT.warn}
        >
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {report.projectErrors.map((failure) => (
              <li key={failure.project}>
                <span className="font-mono">{failure.project}</span> ({failure.stage}) — {failure.error}
              </li>
            ))}
          </ul>
        </CollapsedSection>
      )}

    </div>
  )
}
