// Cost. A stale export annotates the figures rather than replacing them: the
// billing export backfills forward, and blanking the tab until it catches up
// is what left this empty with data already sitting in BigQuery.

import { useState } from "react"
import { AlertTriangle, CircleDollarSign } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { CostBreakdown, ProjectResult, Report } from "./types"
import { LEVEL_TEXT } from "./levels"
import { formatMoney } from "./format"
import { CostSummary, ExpandArrow, StatusIcon, Tile } from "./primitives"

/** One project's 30d total (and trend), tap to expand into its own
 *  CostSummary breakdown -- the row and the breakdown used to be two
 *  separate lists (this one, plus a "Per-project breakdown" section below
 *  repeating every project a second time). Same collapse-in-place pattern
 *  as ProjectCard in projects.tsx. */
function CostProjectRow({ project }: { project: ProjectResult & { cost: CostBreakdown } }) {
  const [open, setOpen] = useState(false)
  const delta = project.cost.prev30d ? ((project.cost.last30d - project.cost.prev30d) / project.cost.prev30d) * 100 : null

  return (
    <li className="py-1.5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <ExpandArrow open={open} className="size-3.5" />
            <StatusIcon level={project.status} />
            <span className="truncate">{project.name}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {delta !== null && (
              <span className={`text-xs ${delta > 5 ? LEVEL_TEXT.warn : "text-muted-foreground"}`}>
                {delta > 0 ? "+" : ""}
                {Math.round(delta)}%
              </span>
            )}
            <span>{formatMoney(project.cost.last30d, project.cost.currency)}</span>
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down data-[state=open]:mt-2">
          <div className="pl-5.5">
            <CostSummary cost={project.cost} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

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
          ? `Figures stop at ${report.costDataThrough}; anything since is missing.`
          : "The billing export could not be read, so no figure here can be trusted."}
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
          // "Today", not "24h": billing.js sums whole UTC-day buckets newer
          // than now-24h, which only ever selects today's — at midday that is
          // 12 hours of spend, not 24.
          label="Today"
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

      <Card className="px-4 py-2.5">
        <div className="mb-1 text-sm font-medium">Cost by project · {report.costWindowDays}d</div>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cost data available.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {sorted.map((project) => (
              <CostProjectRow key={project.project} project={project} />
            ))}
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
    </div>
  )
}
