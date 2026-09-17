// Overview is a landing screen, not a report. Everything it shows also lives
// in a severity tab or the project drill-down, so keeping it to one screen
// loses nothing — which is why all but the worst few findings sit behind a
// collapsed row here.

import { AlertCircle, CheckCircle2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import type { Level, LifecycleFinding, ProjectResult, Report } from "./types"
import { LEVEL_CHIP_BG, LEVEL_STYLE, LEVEL_TEXT } from "./levels"
import { duration, formatValue, timeAgo } from "./format"
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
  // "errors" is the actual count of errors — the raw Cloud Logging error
  // count for this project, not a count of critical *findings*. Findings are
  // an analyzed subset of what's wrong; this is the real number of errors
  // that happened. Warnings/low stay finding counts (there's no raw-log
  // equivalent — those aren't "logged" the way errors are).
  const cells: { label: string; value: number; tone: string; bg: string; tab: string }[] = [
    { label: "errors", value: project.errorCount ?? 0, tone: LEVEL_TEXT.critical, bg: LEVEL_CHIP_BG.critical, tab: "errors" },
    { label: "warnings", value: counts.warn, tone: LEVEL_TEXT.warn, bg: LEVEL_CHIP_BG.warn, tab: "warnings" },
    { label: "low", value: counts.low, tone: LEVEL_TEXT.low, bg: LEVEL_CHIP_BG.low, tab: "low" },
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
              cell.value ? `${cell.bg} cursor-pointer hover:brightness-95 dark:hover:brightness-125` : "cursor-default"
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
 *  projects the bar's segments were never the thing being read, the numbers
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
  // "errors" is the actual count of errors — the raw Cloud Logging total
  // across the estate, not a count of critical findings — matching the
  // per-project cards. warnings/low stay finding counts.
  const cells: { label: string; value: string; tone?: string }[] = [
    { label: "errors", value: formatValue(errorTotal, null), tone: errorTotal ? LEVEL_TEXT.critical : "" },
    { label: "warnings", value: String(findingCounts.warn), tone: findingCounts.warn ? LEVEL_TEXT.warn : "" },
    { label: "low", value: String(findingCounts.low), tone: findingCounts.low ? LEVEL_TEXT.low : "" },
    { label: "clean", value: String(report.counts.ok), tone: report.counts.ok ? LEVEL_TEXT.ok : "" },
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

/** Overview is a landing screen, not a report: the worst few findings, then
 *  everything else behind a collapsed row. Nothing here is unique to this
 *  tab — the severity tabs hold the full lists — so keeping it to one screen
 *  costs no information. */
export function OverviewTab({
  report,
  projects,
  resolved,
  lifecycle,
  findingCounts,
  errorTotal,
  onSelectProject,
}: {
  report: Report
  projects: ProjectResult[]
  resolved: LifecycleFinding[]
  lifecycle: Map<string, LifecycleFinding>
  findingCounts: Record<Exclude<Level, "ok">, number>
  errorTotal: number
  onSelectProject: (project: ProjectResult, tab: string) => void
}) {
  // Mean time a finding stayed open, so the resolved row says something
  // ("cleared in about 4h") instead of only counting.
  const avgOpen = resolved.length
    ? duration(
        new Date(
          Date.now() -
            resolved.reduce(
              (sum, f) => sum + (new Date(f.resolvedAt!).getTime() - new Date(f.firstSeen).getTime()),
              0
            ) /
              resolved.length
        ).toISOString()
      )
    : null

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

      {resolved.length > 0 && (
        <CollapsedSection
          label={`${resolved.length} resolved in the last 7 days${avgOpen ? ` · avg open ${avgOpen}` : ""}`}
          icon={CheckCircle2}
          tone={LEVEL_TEXT.ok}
        >
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 pr-2 font-normal">Finding</th>
                  <th className="w-24 py-1 pr-2 text-right font-normal">Cleared</th>
                  <th className="w-24 py-1 text-right font-normal">Open for</th>
                </tr>
              </thead>
              <tbody>
                {resolved.map((finding) => (
                  <tr key={finding.key} className="border-t border-border/60">
                    <td className="py-1 pr-2 font-mono text-muted-foreground">{finding.key}</td>
                    <td className="py-1 pr-2 text-right whitespace-nowrap text-muted-foreground">
                      {timeAgo(finding.resolvedAt!)}
                    </td>
                    <td className="py-1 text-right whitespace-nowrap text-muted-foreground">
                      {duration(finding.firstSeen, finding.resolvedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsedSection>
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
