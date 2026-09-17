// One severity, estate-wide and flat, the project reduced to a badge. The
// Errors tab additionally carries the raw Cloud Logging panels, since that's
// the only place the findings-vs-log-lines distinction matters.

import { useState } from "react"
import type { ReactNode } from "react"
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FolderKanban, Gauge } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StackedBar } from "@/components/health/charts"
import { buildCategoricalSlotMap, toStackedBarSegments } from "@/components/health/palette"
import type { Finding, Level, LifecycleFinding, ProjectResult } from "./types"
import { LEVEL_LABEL, LEVEL_STYLE, LEVEL_TEXT } from "./levels"
import { formatValue } from "./format"
import { CollapsedSection, FindingRow, ProjectValueRow, StatusIcon } from "./primitives"

/** 4.1 — one function's repeated messages collapse into one expandable row
 *  with a total, instead of drowning the list in ten near-identical lines. */
export function ErrorSignatureRow({
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
  // Longest-open first: the one that's been broken for six days outranks the
  // one that appeared this sweep.
  active.sort((a, b) =>
    (lifecycle.get(a.key)?.firstSeen ?? "").localeCompare(lifecycle.get(b.key)?.firstSeen ?? "")
  )

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
          <div className={`flex items-center gap-1.5 text-sm font-medium ${LEVEL_TEXT[level]}`}>
            <StatusIcon level={level} className="size-3.5" />
            {LEVEL_LABEL[level]} ({active.length})
          </div>
          <ul className="space-y-1 text-sm">
            {active.map((finding) => (
              <FindingRow key={finding.key} finding={finding} lifecycle={lifecycle} isNew={isNew} onAck={onAck} />
            ))}
          </ul>
        </Card>
      )}

      {/* Suppressed findings mute, they never hide — and estate-wide rather
          than buried behind one expander per project, which is where they
          used to be impossible to find. */}
      {acked.length > 0 && (
        <CollapsedSection label="Suppressed" count={acked.length}>
          <ul className="space-y-1 text-sm">
            {acked.map((finding) => (
              <FindingRow key={finding.key} finding={finding} lifecycle={lifecycle} onAck={onAck} />
            ))}
          </ul>
        </CollapsedSection>
      )}

      {children}
    </div>
  )
}

/** The raw Cloud Logging side of "errors", as opposed to the findings the
 *  analyzer raised from them. Lives under the Errors tab because that's the
 *  only place the distinction matters. */
export function ErrorLogPanels({ projects }: { projects: ProjectResult[] }) {
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
    <>
      {unread.length > 0 && (
        <Card className="gap-1 border-l-[3px] border-l-[var(--hc-warn)] px-4 py-3 text-sm">
          <span className={`font-medium ${LEVEL_TEXT.warn}`}>Log read failed for:</span>{" "}
          <span className="text-muted-foreground">{unread.map((p) => p.name).join(", ")}</span>
        </Card>
      )}

      {signatureRows.length > 0 && (
        <CollapsedSection label="Top error messages" count={signatureRows.length} icon={AlertTriangle}>
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
        </CollapsedSection>
      )}

      {/* C6 — a wall of missing_index is a ten-minute fix; a wall of `other`
          is an investigation. Slots are assigned from the estate-wide totals
          so a kind keeps its color on every row. */}
      {kindRows.length > 0 && (
        <CollapsedSection label="Error kinds by project" count={kindRows.length} icon={Gauge}>
          <ul className="space-y-2">
            {kindRows.map(({ project, segments }) => (
              <li key={project.project}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate">{project.name}</span>
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {segments.map((s) => `${s.label} ${s.value}`).join(" · ")}
                  </span>
                </div>
                <StackedBar segments={segments} height={14} />
              </li>
            ))}
          </ul>
        </CollapsedSection>
      )}

      <CollapsedSection label="Error count by project" count={projects.length} icon={FolderKanban}>
        <ul className="divide-y divide-border/60">
          {[...projects]
            .sort((a, b) => (b.errorCount ?? 0) - (a.errorCount ?? 0))
            .map((project) => (
              <ProjectValueRow
                key={project.project}
                project={project}
                right={
                  <span className="text-muted-foreground">
                    {project.errorCount === null
                      ? "unread"
                      : `${formatValue(project.errorCount, null)}${project.errorTruncated ? "+" : ""}`}
                  </span>
                }
              />
            ))}
        </ul>
      </CollapsedSection>
    </>
  )
}
