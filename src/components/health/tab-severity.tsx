// One severity, estate-wide and flat, the project reduced to a badge. The
// Critical tab additionally carries the raw Cloud Logging figures, since
// that's the only place the findings-vs-log-lines distinction matters.

import type { ReactNode } from "react"
import { CheckCircle2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import type { Finding, Level, LifecycleFinding, ProjectResult } from "./types"
import { LEVEL_LABEL, LEVEL_STYLE, LEVEL_TEXT } from "./levels"
import { findingsToMarkdown } from "./format"
import { CollapsedSection, CopyMarkdownButton, FindingsTable, StatusIcon } from "./primitives"

/** One severity, estate-wide and flat, the project reduced to a badge on the
 *  row. Grouping by project instead is what made two tabs read as the same
 *  screen twice — the per-project drill-down lives on the Projects tab. */
export function SeverityTab({
  level,
  projects,
  lifecycle,
  onAck,
  emptyText,
  children,
}: {
  level: Exclude<Level, "ok">
  projects: ProjectResult[]
  lifecycle: Map<string, LifecycleFinding>
  onAck: (key: string, ack: boolean) => void
  emptyText: string
  children?: ReactNode
}) {
  const active: Finding[] = []
  const acked: Finding[] = []
  for (const project of projects) {
    for (const finding of project.findings) {
      if (finding.level !== level) continue
      const row = { ...finding, projectName: project.name }
      if (lifecycle.get(finding.key)?.state === "acked") acked.push(row)
      else active.push(row)
    }
  }
  // Highest repeat count first -- the thing firing 40 times an hour outranks
  // the thing that fired once, regardless of which one happened to start
  // first. Longest-open is still the tiebreaker for two findings at the same
  // count, so ties don't fall back to insertion order. Applied to Resolved
  // too, for the same reason: acking something doesn't make its repeat count
  // stop mattering to whoever expands that list.
  const byCountThenAge = (a: Finding, b: Finding) => {
    const byCount = (b.count ?? 1) - (a.count ?? 1)
    if (byCount !== 0) return byCount
    return (lifecycle.get(a.key)?.firstSeen ?? "").localeCompare(lifecycle.get(b.key)?.firstSeen ?? "")
  }
  active.sort(byCountThenAge)
  acked.sort(byCountThenAge)

  // Counts the rows in the table below it, for every level. This used to be
  // the raw Cloud Logging line count for `critical` only, which meant the
  // header and the list it labelled measured different things: 40 denied-call
  // lines grade `warn`, so the card could read "Errors (40)" above two rows —
  // or the tab could say "Nothing critical" under a badge of 40.
  const headerCount = active.length

  // The raw log-line total is a genuinely useful number, just a different one.
  // It gets its own line rather than being passed off as a finding count.
  const logLines = projects.reduce((sum, p) => sum + (p.errorCount ?? 0), 0)
  const truncated = level === "critical" && projects.some((p) => p.errorTruncated)

  return (
    <div className="space-y-3">
      {level === "critical" && logLines > 0 && (
        <p className="text-xs text-muted-foreground">
          {logLines.toLocaleString("en-US")} error log line{logLines === 1 ? "" : "s"} in the window
          {truncated ? " (hit the 1,000-entry cap — the real number is higher)" : ""}, grouped into the findings below.
        </p>
      )}

      {active.length === 0 ? (
        <Card className="gap-1 px-4 py-3 text-sm">
          <span className={`flex items-center gap-1.5 font-medium ${LEVEL_TEXT.ok}`}>
            <CheckCircle2 className="size-4" aria-hidden="true" />
            {emptyText}
          </span>
        </Card>
      ) : (
        <Card className={`gap-2 px-4 py-3 ${LEVEL_STYLE[level]}`}>
          <div className="flex items-center justify-between gap-2">
            <div className={`flex items-center gap-1.5 text-sm font-medium ${LEVEL_TEXT[level]}`}>
              <StatusIcon level={level} className="size-3.5" />
              {LEVEL_LABEL[level]} ({headerCount})
            </div>
            <CopyMarkdownButton
              getText={() => findingsToMarkdown(`${LEVEL_LABEL[level]} (${headerCount})`, active, lifecycle)}
            />
          </div>
          <FindingsTable findings={active} lifecycle={lifecycle} onAck={onAck} />
        </Card>
      )}

      {/* Resolved findings mute, they never hide — and estate-wide rather
          than buried behind one expander per project, which is where they
          used to be impossible to find. */}
      {acked.length > 0 && (
        <CollapsedSection label="Resolved" count={acked.length} icon={CheckCircle2}>
          <FindingsTable findings={acked} lifecycle={lifecycle} onAck={onAck} />
        </CollapsedSection>
      )}

      {children}
    </div>
  )
}

/** The read-failure notice: projects whose log could not be read at all, so
 *  their absence of findings means "unknown", not "clean". */
export function ErrorLogPanels({ projects }: { projects: ProjectResult[] }) {
  const unread = projects.filter((p) => p.errorCount === null)
  if (unread.length === 0) return null
  return (
    <Card className="gap-1 border-l-[3px] border-l-[var(--hc-warn)] px-4 py-3 text-sm">
      <span className={`font-medium ${LEVEL_TEXT.warn}`}>Log read failed for:</span>{" "}
      <span className="text-muted-foreground">{unread.map((p) => p.name).join(", ")}</span>
    </Card>
  )
}
