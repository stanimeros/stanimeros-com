// One severity, estate-wide and flat, the project reduced to a badge. The
// Errors tab additionally carries the raw Cloud Logging panels, since that's
// the only place the findings-vs-log-lines distinction matters.

import type { ReactNode } from "react"
import { CheckCircle2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import type { Finding, Level, LifecycleFinding, ProjectResult } from "./types"
import { LEVEL_LABEL, LEVEL_STYLE, LEVEL_TEXT } from "./levels"
import { findingsToMarkdown } from "./format"
import { CollapsedSection, CopyMarkdownButton, FindingsTable, StatusIcon } from "./primitives"

/** One severity, estate-wide and flat, the project reduced to a badge on the
 *  row. Grouping by project instead is what made the old Projects and Errors
 *  tabs read as the same screen twice — the per-project drill-down still
 *  exists, under "All projects" on Overview. */
export function SeverityTab({
  level,
  projects,
  lifecycle,
  isNew,
  onAck,
  emptyText,
  children,
}: {
  level: Exclude<Level, "ok">
  projects: ProjectResult[]
  lifecycle: Map<string, LifecycleFinding>
  isNew: (key: string) => boolean
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
  // count, so ties don't fall back to insertion order.
  active.sort((a, b) => {
    const byCount = (b.count ?? 1) - (a.count ?? 1)
    if (byCount !== 0) return byCount
    return (lifecycle.get(a.key)?.firstSeen ?? "").localeCompare(lifecycle.get(b.key)?.firstSeen ?? "")
  })

  // Errors is the actual (raw) Cloud Logging error count for the projects in
  // view, not a count of critical findings — same definition as the nav
  // badge and Overview, scoped to whatever the project filter selects.
  const headerCount =
    level === "critical" ? projects.reduce((sum, p) => sum + (p.errorCount ?? 0), 0) : active.length

  return (
    <div className="space-y-3">
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
          <FindingsTable findings={active} lifecycle={lifecycle} isNew={isNew} onAck={onAck} />
        </Card>
      )}

      {/* Suppressed findings mute, they never hide — and estate-wide rather
          than buried behind one expander per project, which is where they
          used to be impossible to find. */}
      {acked.length > 0 && (
        <CollapsedSection label="Suppressed" count={acked.length}>
          <FindingsTable findings={acked} lifecycle={lifecycle} onAck={onAck} />
        </CollapsedSection>
      )}

      {children}
    </div>
  )
}

/** The raw Cloud Logging side of "errors" — just the read-failure notice.
 *  Lives under the Errors tab because that's the only place it matters; the
 *  messages themselves are the findings table above. */
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
