// Overview is a landing screen, not a report: the estate in one strip, then
// one card per project. Every finding it counts is listed in full on a
// severity tab, so nothing here needs to show findings themselves.

import { AlertCircle, CheckCircle2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import type { Level, LifecycleFinding, ProjectResult, Report } from "./types"
import { LEVEL_STYLE, LEVEL_TEXT } from "./levels"
import { formatValue } from "./format"
import { CollapsedSection, StatusIcon } from "./primitives"

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
  const counts: Record<Exclude<Level, "ok">, number> = { critical: 0, warn: 0, low: 0 }
  for (const finding of project.findings) {
    if (lifecycle.get(finding.key)?.state === "acked") continue
    counts[finding.level] += 1
  }
  // All three are finding counts, so the row reads as one series. The raw
  // Cloud Logging line count used to sit in the first cell — a different
  // measure over a different window, which made the three numbers look
  // comparable when they weren't. It lives on the Critical tab now.
  const cells: { label: string; value: number; tone: string; tab: string }[] = [
    { label: "critical", value: counts.critical, tone: LEVEL_TEXT.critical, tab: "errors" },
    { label: "warnings", value: counts.warn, tone: LEVEL_TEXT.warn, tab: "warnings" },
    { label: "low", value: counts.low, tone: LEVEL_TEXT.low, tab: "low" },
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
            <span className={`text-lg font-semibold tabular-nums ${cell.value ? cell.tone : "text-muted-foreground"}`}>
              {cell.value}
            </span>
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
  errorTotal,
}: {
  report: Report
  findingCounts: Record<Exclude<Level, "ok">, number>
  errorTotal: number
}) {
  // Findings for the three severities, then projects for "healthy" — the
  // trailing "of N projects" is what says the last number counts something
  // else. The raw log-line total is named separately ("log lines"), never
  // mixed in as if it were a finding count.
  const cells: { label: string; value: string; tone?: string }[] = [
    { label: "critical", value: String(findingCounts.critical), tone: findingCounts.critical ? LEVEL_TEXT.critical : "" },
    { label: "warnings", value: String(findingCounts.warn), tone: findingCounts.warn ? LEVEL_TEXT.warn : "" },
    { label: "low", value: String(findingCounts.low), tone: findingCounts.low ? LEVEL_TEXT.low : "" },
    { label: "log lines", value: formatValue(errorTotal, null), tone: "" },
    { label: "healthy", value: String(report.counts.ok), tone: report.counts.ok ? LEVEL_TEXT.ok : "" },
  ]
  return (
    <Card className="flex-row flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
      {cells.map((cell) => (
        <span key={cell.label} className="flex items-baseline gap-1.5">
          <span className={`text-lg font-semibold tabular-nums ${cell.tone || ""}`}>{cell.value}</span>
          <span className="text-xs text-muted-foreground">{cell.label}</span>
        </span>
      ))}
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
  errorTotal,
  onSelectProject,
}: {
  report: Report
  projects: ProjectResult[]
  lifecycle: Map<string, LifecycleFinding>
  findingCounts: Record<Exclude<Level, "ok">, number>
  errorTotal: number
  onSelectProject: (project: ProjectResult, tab: string) => void
}) {
  return (
    <div className="space-y-3">
      <StatStrip report={report} findingCounts={findingCounts} errorTotal={errorTotal} />

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
