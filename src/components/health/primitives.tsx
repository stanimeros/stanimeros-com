// The small shared pieces every tab is built from: a status icon, a stat
// tile, a collapsed section, and the finding row itself. Nothing here knows
// about a tab or a project list — if a component needs to, it belongs in
// projects.tsx or one of the tab files instead.

import { useState } from "react"
import type { ReactNode } from "react"
import { ChevronDown, ChevronRight, Gauge } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { CostBreakdown, Finding, Level, LifecycleFinding, ProjectResult } from "./types"
import { LEVEL_ICON, LEVEL_LABEL, LEVEL_TEXT } from "./levels"
import { duration, exactTime, formatMoney } from "./format"

export function StatusIcon({ level, className = "" }: { level: Level; className?: string }) {
  const Icon = LEVEL_ICON[level]
  return <Icon className={`size-4 shrink-0 ${LEVEL_TEXT[level]} ${className}`} aria-hidden="true" />
}

export function Tile({
  label,
  value,
  tone,
  hint,
  icon: Icon,
  className,
}: {
  label: string
  value: string
  tone?: string
  hint?: string
  icon?: typeof Gauge
  className?: string
}) {
  return (
    <Card className={`gap-1 px-4 py-3 ${className || ""}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="size-3.5" aria-hidden="true" />}
        {label}
      </div>
      <div className={`text-2xl font-semibold ${tone || ""}`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </Card>
  )
}

/** A section that starts closed: one muted summary line, expanded on click.
 *  The dashboard is read by one person at a glance, so anything that isn't a
 *  live problem lives behind one of these rather than being cut — the page
 *  stays short without losing anything. */
export function CollapsedSection({
  label,
  count,
  tone,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  label: string
  count?: number
  tone?: string
  icon?: typeof Gauge
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Card className="gap-0 px-4 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left text-sm"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        {Icon && <Icon className={`size-3.5 shrink-0 ${tone || "text-muted-foreground"}`} aria-hidden="true" />}
        <span className={tone || ""}>{label}</span>
        {count !== undefined && <span className="font-mono text-xs text-muted-foreground">{count}</span>}
      </button>
      {open && <div className="mt-2.5">{children}</div>}
    </Card>
  )
}

/** Cost for one project: the three windows on one line, then its top
 *  services. Shared by the project drill-down and the Cost tab, which
 *  rendered byte-identical copies of this before. */
export function CostSummary({ cost, limit = 5 }: { cost: CostBreakdown; limit?: number }) {
  return (
    <div className="text-sm">
      <div className="mb-1 text-xs text-muted-foreground">
        24h {formatMoney(cost.last24h, cost.currency)} · 7d {formatMoney(cost.last7d, cost.currency)} · 30d{" "}
        {formatMoney(cost.last30d, cost.currency)}
        {cost.prev30d ? ` (prev ${formatMoney(cost.prev30d, cost.currency)})` : ""}
      </div>
      <ul className="space-y-0.5">
        {cost.byService.slice(0, limit).map((row) => (
          <li key={row.service} className="flex justify-between gap-3">
            <span className="truncate text-muted-foreground">{row.service}</span>
            <span>{formatMoney(row.cost, cost.currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** "status icon · project name ………… figure" — the row shape both the cost
 *  and error breakdowns use; only the right-hand figure differs. */
export function ProjectValueRow({ project, right }: { project: ProjectResult; right: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <StatusIcon level={project.status} />
        <span className="truncate">{project.name}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">{right}</span>
    </li>
  )
}

/** One finding row — shared between the tier groups below and the
 *  Acknowledged row, so acking never changes the row's own shape. */
export function FindingRow({
  finding,
  lifecycle,
  isNew,
  onAck,
}: {
  finding: Finding
  lifecycle?: Map<string, LifecycleFinding>
  isNew?: (key: string) => boolean
  onAck?: (key: string, ack: boolean) => void
}) {
  const life = lifecycle?.get(finding.key)
  return (
    <li className="flex flex-wrap items-baseline gap-2">
      {finding.projectName && (
        <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
          {finding.projectName}
        </Badge>
      )}
      <span className={`shrink-0 font-mono font-medium ${LEVEL_TEXT[finding.level]}`}>{finding.kind}</span>
      <span className="text-muted-foreground">{finding.text}</span>
      {isNew?.(finding.key) && (
        <Badge variant="destructive" className="h-4 shrink-0 px-1 text-[10px]">
          NEW
        </Badge>
      )}
      {life && (
        <span
          className="shrink-0 text-xs text-muted-foreground"
          title={`First seen ${exactTime(life.firstSeen)} · seen in ${life.runsSeen} runs`}
        >
          open {duration(life.firstSeen)}
        </span>
      )}
      {/* A finding that keeps clearing and coming back is a different
          problem from one that simply stays broken. */}
      {life && life.reopenCount > 0 && (
        <span className={`shrink-0 font-mono text-xs ${LEVEL_TEXT.warn}`} title="Cleared and came back">
          flapping ×{life.reopenCount}
        </span>
      )}
      {onAck && (
        <button
          type="button"
          onClick={() => onAck(finding.key, life?.state !== "acked")}
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {life?.state === "acked" ? "un-ack" : "ack"}
        </button>
      )}
    </li>
  )
}

/** Groups a project's (or the whole estate's) findings under the three
 *  tier headings the owner asked for — "errors, warnings, small/low-severity
 *  warnings" — instead of one undifferentiated list. Acked findings never
 *  appear here; they collapse into their own muted row, passed separately. */
export function GroupedFindings({
  findings,
  lifecycle,
  isNew,
  onAck,
}: {
  findings: Finding[]
  lifecycle?: Map<string, LifecycleFinding>
  isNew?: (key: string) => boolean
  onAck?: (key: string, ack: boolean) => void
}) {
  const tiers: Exclude<Level, "ok">[] = ["critical", "warn", "low"]
  const groups = tiers
    .map((level) => ({ level, items: findings.filter((f) => f.level === level) }))
    .filter((g) => g.items.length > 0)

  if (groups.length === 0) return null

  return (
    <div className="mt-3 space-y-3">
      {groups.map((group) => (
        <div key={group.level}>
          <div className={`mb-1 flex items-center gap-1.5 text-xs font-medium ${LEVEL_TEXT[group.level]}`}>
            <StatusIcon level={group.level} className="size-3.5" />
            {LEVEL_LABEL[group.level]} ({group.items.length})
          </div>
          <ul className="space-y-1 text-sm">
            {group.items.map((finding) => (
              <FindingRow key={finding.key} finding={finding} lifecycle={lifecycle} isNew={isNew} onAck={onAck} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** 1.5 — acked findings mute, they don't hide. Collapsed by default behind a
 *  single muted row; expanding reveals the same `FindingRow`s as everywhere
 *  else, ack button included, so un-acking is one click from here too. */
export function AckedRow({
  findings,
  lifecycle,
  onAck,
}: {
  findings: Finding[]
  lifecycle?: Map<string, LifecycleFinding>
  onAck?: (key: string, ack: boolean) => void
}) {
  if (findings.length === 0) return null
  return (
    <div className="mt-3">
      <CollapsedSection label="Acknowledged" count={findings.length}>
        <ul className="space-y-1 pl-5 text-sm text-foreground">
          {findings.map((finding) => (
            <FindingRow key={finding.key} finding={finding} lifecycle={lifecycle} onAck={onAck} />
          ))}
        </ul>
      </CollapsedSection>
    </div>
  )
}
