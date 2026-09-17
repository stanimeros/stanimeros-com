// The per-project drill-down: one card per project (metrics against baseline,
// the functions table, cost), expanded on click. Rendered by the Projects tab
// — the severity tabs deliberately don't group by project, which is what made
// two tabs look like one.

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { Series } from "@/components/health/charts"
import type { ProjectResult } from "./types"
import { LEVEL_STYLE } from "./levels"
import { formatMoney, formatValue } from "./format"
import { CostSummary, ExpandArrow, StatusIcon } from "./primitives"

// Findings/errors are deliberately not shown here — they live on the
// severity tabs and Overview. This card is metrics only: calls, reads,
// storage etc. per function, against baseline.
export function ProjectCard({ project }: { project: ProjectResult }) {
  const [open, setOpen] = useState(false)
  const metrics = Object.entries(project.metrics).filter(([key]) => !key.endsWith(".failed"))

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
              {/* Plan isn't a severity signal — no chroma. */}
              <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {project.plan}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-right">
            <div>
              {project.cost ? (
                <div className="text-sm">{formatMoney(project.cost.last30d, project.cost.currency)}</div>
              ) : null}
              <div className="text-xs text-muted-foreground">{open ? "hide" : "details"}</div>
            </div>
            <ExpandArrow open={open} className="size-3.5" />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-4 overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down data-[state=open]:mt-4 data-[state=open]:border-t data-[state=open]:border-border data-[state=open]:pt-3">
          {metrics.length > 0 && (
            <div className="space-y-1.5">
              {/* This window is genuinely 24h regardless of logHours — see
                  rollingWindow() in monitoring.js. Don't "fix" it to match
                  the error-log window; they're unrelated numbers. */}
              <p className="text-xs text-muted-foreground">Last 24h vs the 14-day median</p>
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
                    {/* Baseline marked, dates readable on hover/focus. */}
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
                    <th className="py-1 text-right font-normal">Baseline</th>
                  </tr>
                </thead>
                <tbody>
                  {project.entities.map((entity) => (
                    <tr key={`${entity.kind}:${entity.name}`} className="border-t border-border/60">
                      <td className="py-1 pr-2 font-mono text-xs">{entity.name}</td>
                      <td className="py-1 pr-2 text-right">{formatValue(entity.calls, null)}</td>
                      <td className="py-1 text-right text-muted-foreground">
                        {formatValue(entity.callsBaseline, null)}
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
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
