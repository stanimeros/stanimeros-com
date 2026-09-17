// The small shared pieces every tab is built from: status icon, expand arrow,
// stat tile, collapsed section, copy button, cost summary, and the findings
// table. Nothing here knows about a tab or a project list — if a component
// needs to, it belongs in projects.tsx or one of the tab files instead.

import { Fragment, useState } from "react"
import type { ReactNode } from "react"
import { Check, ChevronRight, Copy, Gauge } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { CostBreakdown, Finding, Level, LifecycleFinding, ProjectResult } from "./types"
import { LEVEL_CHIP_BG, LEVEL_ICON, LEVEL_TEXT } from "./levels"
import { duration, exactTime, findingsToMarkdown, formatMoney } from "./format"

export function StatusIcon({ level, className = "" }: { level: Level; className?: string }) {
  const Icon = LEVEL_ICON[level]
  return <Icon className={`size-4 shrink-0 ${LEVEL_TEXT[level]} ${className}`} aria-hidden="true" />
}

/** The one arrow every expandable on this page uses — a single chevron that
 *  rotates open rather than swapping icons, so the state change reads as
 *  motion instead of a jump cut. */
export function ExpandArrow({ open, className = "" }: { open: boolean; className?: string }) {
  return (
    <ChevronRight
      className={`shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-90" : ""} ${className}`}
      aria-hidden="true"
    />
  )
}

/** How loud the repeat-count badge should be: a lone occurrence is routine
 *  (muted), 2–10 is worth a glance (warn/orange), and double digits is
 *  probably the thing to look at first (critical/red) — independent of the
 *  finding's own level, since a `low` finding that fired 40 times is a
 *  different story than one that fired once. */
function countTone(count: number): string {
  if (count > 10) return `${LEVEL_CHIP_BG.critical} ${LEVEL_TEXT.critical}`
  if (count > 1) return `${LEVEL_CHIP_BG.warn} ${LEVEL_TEXT.warn}`
  return "bg-muted text-foreground"
}

/** Dumps a findings list as Markdown to the clipboard, phrased for pasting
 *  straight into an agent chat — the dashboard shows the estate at a glance,
 *  but debugging an error still means handing its actual text to something
 *  that can read code. */
export function CopyMarkdownButton({
  getText,
  label = "Copy as Markdown",
}: {
  getText: () => string
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(getText())
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          // Clipboard access blocked (permissions, insecure context) -- the
          // button just stays a no-op rather than throwing.
        }
      }}
      className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
    >
      {copied ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
      {copied ? "Copied" : label}
    </button>
  )
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
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-left text-sm">
          <ExpandArrow open={open} className="size-3.5" />
          {Icon && <Icon className={`size-3.5 shrink-0 ${tone || "text-muted-foreground"}`} aria-hidden="true" />}
          <span className={tone || ""}>{label}</span>
          {count !== undefined && <span className="font-mono text-xs text-muted-foreground">{count}</span>}
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down data-[state=open]:mt-2.5">
          {children}
        </CollapsibleContent>
      </Collapsible>
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
        Today {formatMoney(cost.last24h, cost.currency)} · 7d {formatMoney(cost.last7d, cost.currency)} · 30d{" "}
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

/** One severity, as a table: project, kind, message and count, with the
 *  lifecycle details behind the row. Used by the severity tabs, where a flat
 *  estate-wide list of findings is scanned column by column, not read as
 *  prose. A row expands in place (accordion-style, one at a time) to show the
 *  exact timestamps and ack control a table cell has no room for. */
export function FindingsTable({
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
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  if (findings.length === 0) return null
  // Project, Kind, Count, Message -- Details (age/flapping) and Ack both
  // live only in the expanded panel now, so neither takes a header column.
  const columnCount = 4
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-sm">
        {/* Fixed layout so the columns hold a sane shape instead of
            stretching to whatever's longest in them — Message is the only
            one that should ever eat space, everything else is a fixed
            width sized to its own content. */}
        <colgroup>
          <col className="w-24 sm:w-32" />
          <col className="w-28 sm:w-36" />
          <col />
          <col className="w-12" />
        </colgroup>
        <thead className="text-xs text-muted-foreground">
          <tr className="text-left">
            <th className="py-1 pr-2 font-normal">Project</th>
            <th className="py-1 pr-2 font-normal">Kind</th>
            <th className="py-1 pr-2 font-normal">Message</th>
            <th className="py-1 pr-2 font-normal">Count</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((finding) => {
            const life = lifecycle?.get(finding.key)
            const expanded = expandedKey === finding.key
            const new_ = isNew?.(finding.key)
            return (
              <Fragment key={finding.key}>
                <tr
                  className="cursor-pointer border-t border-border/60 align-top hover:bg-muted/40"
                  role="button"
                  aria-expanded={expanded}
                  tabIndex={0}
                  onClick={() => setExpandedKey(expanded ? null : finding.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      setExpandedKey(expanded ? null : finding.key)
                    }
                  }}
                >
                  <td className="py-1.5 pr-2">
                    <span className="flex items-center gap-1">
                      <ExpandArrow open={expanded} className="size-3" />
                      {finding.projectName && (
                        <Badge variant="outline" className="h-4 truncate px-1 text-[10px]">
                          {finding.projectName}
                        </Badge>
                      )}
                    </span>
                  </td>
                  {/* NEW rides right after the kind it's describing, not
                      stranded in a details column a long message could push
                      out of view. */}
                  <td className="py-1.5 pr-2">
                    <span className="flex min-w-0 items-center gap-1">
                      <span className={`truncate font-mono font-medium ${LEVEL_TEXT[finding.level]}`}>
                        {finding.kind}
                      </span>
                      {new_ && (
                        <Badge variant="destructive" className="h-4 shrink-0 px-1 text-[10px]">
                          NEW
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="truncate py-1.5 pr-2 text-muted-foreground">{finding.text}</td>
                  {/* Its own column, not a suffix baked into `text` -- that
                      used to get clipped along with the rest of a long
                      message the moment the row truncated. Always shown, not
                      just when > 1 -- a kind with no natural repeat count
                      (spike, sa-key, broad-role...) still happened once, so
                      it defaults to 1 rather than leaving the column blank
                      and looking like the row is missing data. Last column,
                      not front-loaded -- Message is the thing actually being
                      scanned row to row. */}
                  <td className="py-1.5 pr-2">
                    <span
                      className={`rounded px-1 font-mono text-[10px] ${countTone(finding.count ?? 1)}`}
                      title={`Happened ${finding.count ?? 1} time${(finding.count ?? 1) === 1 ? "" : "s"}`}
                    >
                      ×{finding.count ?? 1}
                    </span>
                  </td>
                </tr>
                {/* Always mounted (not `expanded && <tr>`), collapsed to zero
                    height via grid-rows -- that's what actually makes the
                    reveal animate instead of popping in, same trick as
                    ProjectCard's drill-down in projects.tsx. */}
                <tr>
                  <td colSpan={columnCount} className="p-0">
                    <div
                      className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out ${
                        expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                      }`}
                    >
                      <div className="min-h-0">
                        <div className="space-y-2 border-t border-border/60 bg-muted/20 px-2 py-2">
                          <div>
                            <div className="text-[10px] tracking-wide text-muted-foreground uppercase">
                              Full message
                            </div>
                            <p className="text-xs break-words whitespace-pre-wrap">{finding.text}</p>
                          </div>
                          {life ? (
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                              <dt className="text-muted-foreground">State</dt>
                              <dd>{life.state}</dd>
                              <dt className="text-muted-foreground">Open</dt>
                              <dd>{duration(life.firstSeen)}</dd>
                              <dt className="text-muted-foreground">First seen</dt>
                              <dd>{exactTime(life.firstSeen)}</dd>
                              <dt className="text-muted-foreground">Last seen</dt>
                              <dd>{exactTime(life.lastSeen)}</dd>
                              <dt className="text-muted-foreground">Seen in</dt>
                              <dd>{life.runsSeen} runs</dd>
                              {life.ackedUntil && (
                                <>
                                  <dt className="text-muted-foreground">Acked until</dt>
                                  <dd>{exactTime(life.ackedUntil)}</dd>
                                </>
                              )}
                            </dl>
                          ) : (
                            <span className="text-xs text-muted-foreground">No lifecycle history for this finding.</span>
                          )}
                          <div className="flex items-center gap-3">
                            <CopyMarkdownButton
                              label="Copy this row"
                              getText={() => findingsToMarkdown(finding.kind, [finding], lifecycle)}
                            />
                            {onAck && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onAck(finding.key, life?.state !== "acked")
                                }}
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                              >
                                {life?.state === "acked" ? (
                                  <>
                                    <Check className="size-3" aria-hidden="true" />
                                    Acknowledged
                                  </>
                                ) : (
                                  "Acknowledge"
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
