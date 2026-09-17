// Overview is a landing screen, not a report. Everything it shows also lives
// in a severity tab or the project drill-down, so keeping it to one screen
// loses nothing — which is why all but the worst few findings sit behind a
// collapsed row here.

import { Activity, AlertCircle, CheckCircle2, FolderKanban } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Columns } from "@/components/health/charts"
import type { Finding, HistoryRun, Level, LifecycleFinding, ProjectResult, Report } from "./types"
import { LEVEL_ORDER, LEVEL_TEXT } from "./levels"
import { duration, formatValue, timeAgo } from "./format"
import { CollapsedSection, FindingRow } from "./primitives"
import { TieredProjectRows } from "./projects"

/** The findings a glance should land on: worst level first, then whichever
 *  has been open longest. Acked findings never surface here. */
function rankFindings(projects: ProjectResult[], lifecycle: Map<string, LifecycleFinding>) {
  const rows: Finding[] = []
  for (const project of projects) {
    for (const finding of project.findings) {
      if (lifecycle.get(finding.key)?.state === "acked") continue
      rows.push({ ...finding, projectName: project.name })
    }
  }
  return rows.sort((a, b) => {
    const byLevel = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]
    if (byLevel !== 0) return byLevel
    return (lifecycle.get(a.key)?.firstSeen ?? "").localeCompare(lifecycle.get(b.key)?.firstSeen ?? "")
  })
}

/** The estate in one line. Replaces the proportion-bar card: at fifteen
 *  projects the bar's segments were never the thing being read, the numbers
 *  beside it were. */
export function StatStrip({ report, errorTotal }: { report: Report; errorTotal: number }) {
  const cells: { label: string; value: string; tone?: string }[] = [
    { label: "critical", value: String(report.counts.critical), tone: report.counts.critical ? LEVEL_TEXT.critical : "" },
    { label: "warning", value: String(report.counts.warn), tone: report.counts.warn ? LEVEL_TEXT.warn : "" },
    { label: "low", value: String(report.counts.low), tone: report.counts.low ? LEVEL_TEXT.low : "" },
    { label: "clean", value: String(report.counts.ok), tone: report.counts.ok ? LEVEL_TEXT.ok : "" },
    { label: "errors", value: formatValue(errorTotal, null) },
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
  history,
  resolved,
  lifecycle,
  isNew,
  onAck,
  errorTotal,
  onSelectRun,
  onOpenLevel,
}: {
  report: Report
  projects: ProjectResult[]
  history: HistoryRun[]
  resolved: LifecycleFinding[]
  lifecycle: Map<string, LifecycleFinding>
  isNew: (key: string) => boolean
  onAck: (key: string, ack: boolean) => void
  errorTotal: number
  onSelectRun?: (runId: string) => void
  onOpenLevel: (level: Exclude<Level, "ok">) => void
}) {
  const ranked = rankFindings(projects, lifecycle)
  const lead = ranked.slice(0, 5)

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
      <StatStrip report={report} errorTotal={errorTotal} />

      {lead.length === 0 ? (
        <Card className="gap-1 px-4 py-3 text-sm">
          <span className={`flex items-center gap-1.5 font-medium ${LEVEL_TEXT.ok}`}>
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Nothing open across {report.counts.total} projects
          </span>
        </Card>
      ) : (
        <Card className="gap-2 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">Needs attention</span>
            {ranked.length > lead.length && (
              <button
                type="button"
                onClick={() => onOpenLevel(ranked[0].level)}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                +{ranked.length - lead.length} more
              </button>
            )}
          </div>
          <ul className="space-y-1 text-sm">
            {lead.map((finding) => (
              <FindingRow key={finding.key} finding={finding} lifecycle={lifecycle} isNew={isNew} onAck={onAck} />
            ))}
          </ul>
        </Card>
      )}

      {resolved.length > 0 && (
        <CollapsedSection
          label={`${resolved.length} resolved in the last 7 days${avgOpen ? ` · avg open ${avgOpen}` : ""}`}
          icon={CheckCircle2}
          tone={LEVEL_TEXT.ok}
        >
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

      <CollapsedSection label="All projects" count={projects.length} icon={FolderKanban}>
        <TieredProjectRows
          projects={projects}
          lifecycle={lifecycle}
          isNew={isNew}
          onAck={onAck}
          generated={report.generated}
        />
      </CollapsedSection>

      {history.length > 1 && (
        <CollapsedSection label="Findings over time" count={history.length} icon={Activity}>
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
        </CollapsedSection>
      )}
    </div>
  )
}
