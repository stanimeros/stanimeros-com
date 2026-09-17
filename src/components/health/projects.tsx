// The per-project drill-down: one compact row per project, expanding into the
// full card (metrics against baseline, the functions table, cost, top errors).
// Reached from "All projects" on Overview — the severity tabs deliberately
// don't group by project, which is what made two tabs look like one.

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { DivergingBar, Meter, Series } from "@/components/health/charts"
import type { Level, LifecycleFinding, ProjectResult } from "./types"
import { LEVEL_BG, LEVEL_ORDER, LEVEL_STYLE, LEVEL_TEXT } from "./levels"
import { duration, formatMoney, formatValue, timeAgo } from "./format"
import { AckedRow, CostSummary, GroupedFindings, StatusIcon } from "./primitives"

export function ProjectCard({
  project,
  lifecycle,
  isNew,
  onAck,
}: {
  project: ProjectResult
  lifecycle?: Map<string, LifecycleFinding>
  isNew?: (key: string) => boolean
  onAck?: (key: string, ack: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const metrics = Object.entries(project.metrics).filter(([key]) => !key.endsWith(".failed"))

  // 1.5 — acked findings stop counting toward the header status/count; they
  // stay fully visible, just moved into their own row below.
  const activeFindings = project.findings.filter((f) => lifecycle?.get(f.key)?.state !== "acked")
  const ackedFindings = project.findings.filter((f) => lifecycle?.get(f.key)?.state === "acked")

  return (
    <Card
      className={`gap-3 px-4 py-4 ${LEVEL_STYLE[project.status]}`}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-start justify-between gap-3 text-left">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusIcon level={project.status} />
              <span className="font-semibold">{project.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{project.project}</span>
              {/* Plan isn't a severity signal — no chroma, mockup decision 1. */}
              <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
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
                      <div className="truncate font-mono text-xs text-muted-foreground">{key}</div>
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

          {project.cost && <CostSummary cost={project.cost} />}

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

const TIER_ORDER: { level: Level; heading: string }[] = [
  { level: "critical", heading: "Errors" },
  { level: "warn", heading: "Warnings" },
  { level: "low", heading: "Hygiene" },
  { level: "ok", heading: "Clean" },
]

/** The one finding a compact row leads with: worst level first, then oldest
 *  (the one that's been open longest is the one most worth a glance). Acked
 *  findings never surface here — same rule as everywhere else on the page. */
function leadFinding(project: ProjectResult, lifecycle?: Map<string, LifecycleFinding>) {
  const active = project.findings.filter((f) => lifecycle?.get(f.key)?.state !== "acked")
  if (active.length === 0) return null
  const sorted = [...active].sort((a, b) => {
    const byLevel = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]
    if (byLevel !== 0) return byLevel
    const la = lifecycle?.get(a.key)?.firstSeen ?? ""
    const lb = lifecycle?.get(b.key)?.firstSeen ?? ""
    return la.localeCompare(lb)
  })
  return { finding: sorted[0], count: active.length }
}

/** Mockup decision 3 — one project per compact (~46px) row: name, id, the
 *  lead finding in its own words, and how long it's been open, then figures
 *  right-aligned so the eye scans one path down the page. Opening a row
 *  reveals the exact same `ProjectCard` used by the Cards view — this row
 *  is the list, `ProjectCard` is the drill-down, per the mockup's "What
 *  changes" note on row anatomy. */
export function ProjectRow({
  project,
  lifecycle,
  isNew,
  onAck,
  generated,
}: {
  project: ProjectResult
  lifecycle?: Map<string, LifecycleFinding>
  isNew?: (key: string) => boolean
  onAck?: (key: string, ack: boolean) => void
  generated?: string
}) {
  const [open, setOpen] = useState(false)
  const active = project.findings.filter((f) => lifecycle?.get(f.key)?.state !== "acked")
  const ackedCount = project.findings.length - active.length
  const lead = leadFinding(project, lifecycle)
  const leadLife = lead ? lifecycle?.get(lead.finding.key) : undefined
  const anyNew = active.some((f) => isNew?.(f.key))
  const flapCount = Math.max(0, ...active.map((f) => lifecycle?.get(f.key)?.reopenCount ?? 0), 0)
  const callsMetric = Object.entries(project.metrics).find(
    ([key]) => /call/i.test(key) && !key.endsWith(".failed")
  )

  return (
    <div className="border-t border-border first:border-t-0">
      {/* A `<div role="button">`, not a real `<button>` — the sparkline
          below has its own focusable, hoverable points (Series), and a
          native button can't contain other interactive content. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setOpen((v) => !v)
          }
        }}
        aria-expanded={open}
        className="grid w-full cursor-pointer grid-cols-[3px_minmax(0,1fr)] items-stretch text-left hover:bg-muted/40 sm:grid-cols-[3px_minmax(0,1fr)_auto]"
      >
        <span aria-hidden="true" className={`row-span-2 sm:row-span-1 ${LEVEL_BG[project.status]}`} />

        <span className="col-start-2 flex min-w-0 flex-col gap-0.5 py-2 pr-3 pl-3">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="font-semibold">{project.name}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{project.project}</span>
            {anyNew && (
              <Badge variant="destructive" className="h-4 shrink-0 px-1 text-[10px]">
                NEW
              </Badge>
            )}
            {flapCount > 0 && (
              <span className={`font-mono text-[10px] ${LEVEL_TEXT.warn}`}>flapping ×{flapCount}</span>
            )}
          </span>
          <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
            {lead ? (
              <>
                <span className={`font-mono ${LEVEL_TEXT[lead.finding.level]}`}>{lead.finding.kind}</span>
                <span className="truncate">{lead.finding.text}</span>
                {lead.count > 1 && <span>+{lead.count - 1} more</span>}
                {leadLife && (
                  <span className="font-mono text-muted-foreground">open {duration(leadLife.firstSeen)}</span>
                )}
              </>
            ) : ackedCount > 0 ? (
              <span>All findings acknowledged</span>
            ) : (
              <span>No findings{generated ? ` · last swept ${timeAgo(generated)}` : ""}</span>
            )}
            {ackedCount > 0 && <span>· {ackedCount} acked</span>}
          </span>
        </span>

        <span className="col-start-2 flex items-center gap-4 pb-2 pl-3 font-mono text-xs text-muted-foreground sm:col-start-3 sm:py-2 sm:pr-3 sm:pl-0">
          {callsMetric && (
            <span
              className="hidden w-[72px] sm:block"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
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
            </span>
          )}
          <span className="flex flex-col items-end gap-0.5">
            <span className="text-[9px] tracking-wide text-muted-foreground uppercase">errors</span>
            <span className={`text-[13px] tabular-nums ${project.errorCount ? LEVEL_TEXT.critical : "text-foreground"}`}>
              {project.errorCount === null ? "unread" : formatValue(project.errorCount, null)}
            </span>
          </span>
          <span className="flex flex-col items-end gap-0.5">
            <span className="text-[9px] tracking-wide text-muted-foreground uppercase">findings</span>
            <span className="text-[13px] text-foreground tabular-nums">{active.length}</span>
          </span>
        </span>
      </div>

      {open && (
        <div className="border-t border-border bg-muted/20 p-3">
          <ProjectCard project={project} lifecycle={lifecycle} isNew={isNew} onAck={onAck} />
        </div>
      )}
    </div>
  )
}

/** Mockup decision 4 — Errors / Warnings / Hygiene / Clean, each a heading
 *  with a count and a hairline rule, is the primary organising structure on
 *  both Overview (estate-wide) and Projects (filtered). */
export function TieredProjectRows({
  projects,
  lifecycle,
  isNew,
  onAck,
  generated,
}: {
  projects: ProjectResult[]
  lifecycle: Map<string, LifecycleFinding>
  isNew: (key: string) => boolean
  onAck: (key: string, ack: boolean) => void
  generated?: string
}) {
  const groups = TIER_ORDER.map((tier) => ({ ...tier, items: projects.filter((p) => p.status === tier.level) })).filter(
    (g) => g.items.length > 0
  )

  if (groups.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No projects match the current filter.</p>
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {groups.map((group) => (
        <div key={group.level}>
          <div
            className={`flex items-center gap-2 px-3 pt-3 pb-1.5 font-mono text-[11px] tracking-wide uppercase ${LEVEL_TEXT[group.level]}`}
          >
            <span>{group.heading}</span>
            <span className="text-muted-foreground">{group.items.length}</span>
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>
          <div>
            {group.items.map((project) => (
              <ProjectRow
                key={project.project}
                project={project}
                lifecycle={lifecycle}
                isNew={isNew}
                onAck={onAck}
                generated={generated}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
