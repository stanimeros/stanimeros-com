// Cost. A stale export annotates the figures rather than replacing them: the
// billing export backfills forward, and blanking the tab until it catches up
// is what left this empty with data already sitting in BigQuery.

import { AlertTriangle, CircleDollarSign } from "lucide-react"
import { Card } from "@/components/ui/card"
import type { CostBreakdown, ProjectResult, Report } from "./types"
import { LEVEL_TEXT } from "./levels"
import { formatMoney } from "./format"
import { CollapsedSection, CostSummary, ProjectValueRow, Tile } from "./primitives"

export function CostTab({ report, projects }: { report: Report; projects: ProjectResult[] }) {
  const withCost = projects.filter((p): p is ProjectResult & { cost: CostBreakdown } => p.cost !== null)
  const sorted = [...withCost].sort((a, b) => b.cost.last30d - a.cost.last30d)

  // A grid of dashes would read as "no spend", so an unreadable export still
  // gets the banner instead of figures. A *lagging* one doesn't: the export
  // backfills forward, and blanking the tab until it catches up is how this
  // sat empty. Date the numbers and show them.
  const banner = report.costStale ? (
    <Card className="gap-1 border-l-[3px] border-l-[var(--hc-warn)] px-4 py-3 text-sm">
      <span className={`flex items-center gap-1.5 font-medium ${LEVEL_TEXT.warn}`}>
        <AlertTriangle className="size-4" aria-hidden="true" />
        Cost data is stale
      </span>
      <span className="text-muted-foreground">
        {report.costDataThrough
          ? `The billing export has nothing newer than ${report.costDataThrough} — every figure below stops there and is missing whatever happened since.`
          : "The billing export could not be read at all, so no cost figure here can be trusted."}
      </span>
    </Card>
  ) : null

  if (report.costDataThrough == null) {
    return (
      banner || (
        <Card className="px-4 py-4 text-sm text-muted-foreground">No cost data available.</Card>
      )
    )
  }

  return (
    <div className="space-y-4">
      {banner}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile
          label={`Total · ${report.costWindowDays}d`}
          value={report.costTotal === null ? "—" : formatMoney(report.costTotal, report.costCurrency)}
          icon={CircleDollarSign}
        />
        <Tile
          label="24h"
          // No project with cost data at all means "nothing to sum", not
          // "zero spend" — matching Total's "—" rather than a misleading
          // €0.00 for the same underlying reason.
          value={withCost.length === 0 ? "—" : formatMoney(withCost.reduce((sum, p) => sum + p.cost.last24h, 0), report.costCurrency)}
        />
        <Tile
          label="7d"
          value={withCost.length === 0 ? "—" : formatMoney(withCost.reduce((sum, p) => sum + p.cost.last7d, 0), report.costCurrency)}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      <Card className="px-4 py-3">
        <div className="mb-2 text-sm font-medium">Cost by project · 30d</div>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cost data available.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {sorted.map((project) => {
              const delta = project.cost.prev30d
                ? ((project.cost.last30d - project.cost.prev30d) / project.cost.prev30d) * 100
                : null
              return (
                <ProjectValueRow
                  key={project.project}
                  project={project}
                  right={
                    <>
                      {delta !== null && (
                        <span className={`text-xs ${delta > 5 ? LEVEL_TEXT.warn : "text-muted-foreground"}`}>
                          {delta > 0 ? "+" : ""}
                          {Math.round(delta)}%
                        </span>
                      )}
                      <span>{formatMoney(project.cost.last30d, project.cost.currency)}</span>
                    </>
                  }
                />
              )
            })}
          </ul>
        )}
      </Card>

      {/* Charges with no project.id at all -- invoice adjustments, rounding.
          These count toward Total above but never toward any project's own
          figure, so without a card for them the total silently stops
          reconciling with the per-project sum the moment one shows up. */}
      {report.otherCost && (
        <Card className="gap-1 px-4 py-3">
          <div className="mb-1 text-sm font-medium">Other charges · {report.costWindowDays}d</div>
          <p className="mb-2 text-xs text-muted-foreground">
            Not attributed to any project — invoice-level adjustments, rounding, and similar.
          </p>
          <CostSummary cost={report.otherCost} />
        </Card>
      )}

      <CollapsedSection label="Per-project breakdown" count={sorted.length}>
        <div className="space-y-3">
          {sorted.map((project) => (
            <div key={project.project}>
              <div className="mb-1 text-sm font-medium">{project.name}</div>
              <CostSummary cost={project.cost} />
            </div>
          ))}
        </div>
      </CollapsedSection>
    </div>
  )
}
