/**
 * Reusable chart primitives for the Health dashboard (plan.md, "Chart
 * layer"). Inline SVG and flex/grid divs only — no chart library, no new
 * dependency.
 *
 * The one law every primitive here follows: color means severity and
 * nothing else. `StatusBand`, `Columns` and `ProportionBar` use the reserved
 * status colors because they *are* severity charts. `Series` (quantity) is
 * always monochrome sequential blue. `StackedBar` is the only primitive that
 * may use the categorical palette, and only for identity data (error kinds,
 * cost by service) — never for a quantity.
 *
 * The palette is defined once, in ./palette.css (imported below for its
 * side effect), as CSS custom properties with light and dark values. Every
 * component here references a role (`var(--hc-critical)`, `var(--hc-seq-4)`,
 * `var(--hc-cat-2)`, ...), never a raw hex.
 *
 * Interaction rules applied throughout (plan.md, "Interaction rules for all
 * nine"): hover enhances and never gates — every value drawn is also either
 * a direct label, a native `title`, or an `aria-label`; keyboard focus shows
 * the same thing hover shows; hit targets are padded to ~24px even when the
 * mark itself is a couple of pixels wide; no chart animates on mount; grid/
 * axis strokes are hairline and solid, the sole exception being the dashed
 * baseline rule in `Series`, where dashing means "reference value".
 */
import { useRef, useState } from "react"
import {
  HEALTH_STATUS_VAR,
  LEVEL_LABEL,
  categoricalSlotVar,
  type Level,
  type StackedBarSegment as StackedBarSegmentType,
} from "./palette"

export type { Level } from "./palette"
// Slot assignment for StackedBar's categorical colors lives in ./palette —
// import `buildCategoricalSlotMap` and `toStackedBarSegments` from there
// directly (kept out of this file so it exports components only).

/** Fill for a status-colored segment carries direct-labeled text; pick a
 * readable text color per fill rather than assuming white (plan.md notes
 * warning is sub-3:1 on white). */
const LEVEL_FILL_TEXT_CLASS: Record<Level, string> = {
  critical: "text-white",
  warn: "text-black",
  low: "text-white",
  ok: "text-white",
}

/** Shared hover/focus tooltip: a visually hidden label that appears above
 * its trigger on hover or focus-within, via CSS only (no JS positioning
 * needed for the many small marks in the div-based charts). `groupName`
 * must be a unique Tailwind arbitrary group name per chart so adjacent
 * marks don't cross-trigger each other's tooltip. */
function MarkTooltip({ groupName, text }: { groupName: string; text: string }) {
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-max max-w-[240px] -translate-x-1/2 whitespace-normal rounded-md border border-border bg-popover px-2 py-1 text-[11px] leading-snug text-popover-foreground opacity-0 shadow-md group-hover/${groupName}:opacity-100 group-focus-within/${groupName}:opacity-100`}
    >
      {text}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* C1 — StatusBand                                                     */
/* ------------------------------------------------------------------ */

export interface StatusBandRun {
  runId: string
  generated: string
  status: Level
  counts?: Partial<Record<Level | "total", number>>
}

/**
 * One cell per run, oldest left, filled with that run's status color.
 * Stays on one line at ~90 cells (flex-1 cells) and degrades to a handful
 * of wide cells at 5 — the layout is the same at both sizes, only the cell
 * width changes.
 */
export function StatusBand({
  runs,
  activeRunId,
  onSelectRun,
  className,
}: {
  runs: StatusBandRun[]
  activeRunId?: string
  onSelectRun?: (runId: string) => void
  className?: string
}) {
  if (runs.length === 0) return null
  return (
    <div
      role="group"
      aria-label="Run history status band"
      className={`flex h-7 w-full items-stretch gap-[2px] ${className ?? ""}`}
    >
      {runs.map((run) => {
        const exact = new Date(run.generated).toLocaleString()
        const countsText = run.counts
          ? ` · ${run.counts.critical ?? 0} critical, ${run.counts.warn ?? 0} warn, ${run.counts.low ?? 0} low, ${run.counts.ok ?? 0} ok`
          : ""
        const label = `${LEVEL_LABEL[run.status]} · ${exact}${countsText}`
        return (
          <span key={run.runId} className="group/hcband relative min-w-[3px] flex-1">
            <button
              type="button"
              onClick={onSelectRun ? () => onSelectRun(run.runId) : undefined}
              aria-label={label}
              title={label}
              className={`block h-full w-full rounded-[1px] ${onSelectRun ? "cursor-pointer" : "cursor-default"} ${
                run.runId === activeRunId ? "ring-2 ring-foreground/60 ring-offset-1 ring-offset-background" : ""
              }`}
              style={{ backgroundColor: HEALTH_STATUS_VAR[run.status] }}
            />
            <MarkTooltip groupName="hcband" text={label} />
          </span>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* C2 — Columns                                                        */
/* ------------------------------------------------------------------ */

export interface ColumnsRun {
  runId: string
  generated: string
  /** Projects by state for this run — NOT the same measure as
   * `findingCount` below. Plotted as the stack. */
  counts: { critical: number; warn: number; low?: number; ok?: number; total?: number }
  /** Total findings for this run. Plotted as a separate thin line, in its
   * own chart beneath the stack, sharing only the x-axis ordering — never
   * a second y-axis on the same plot. */
  findingCount?: number
}

/**
 * Stacked columns (critical above warn), one per run, plus an optional
 * paired line chart of `findingCount` sharing the x-axis below. Two
 * independent scales, two independent marks — see the field comment on
 * `ColumnsRun` for why they must never share a y-axis.
 */
export function Columns({
  runs,
  activeRunId,
  onSelectRun,
  showFindingsLine = true,
  barHeight = 72,
  lineHeight = 32,
  className,
}: {
  runs: ColumnsRun[]
  activeRunId?: string
  onSelectRun?: (runId: string) => void
  showFindingsLine?: boolean
  barHeight?: number
  lineHeight?: number
  className?: string
}) {
  if (runs.length === 0) return null
  const maxStack = Math.max(1, ...runs.map((r) => (r.counts.critical || 0) + (r.counts.warn || 0) + (r.counts.low || 0)))
  const maxFindings = Math.max(1, ...runs.map((r) => r.findingCount ?? 0))
  const n = runs.length

  return (
    <div className={`w-full ${className ?? ""}`}>
      <div
        className="flex items-stretch gap-[2px]"
        style={{ height: barHeight }}
        role="group"
        aria-label="Projects affected by status, per run"
      >
        {runs.map((run) => {
          const critical = run.counts.critical || 0
          const warn = run.counts.warn || 0
          const low = run.counts.low || 0
          const criticalPct = (critical / maxStack) * 100
          const warnPct = (warn / maxStack) * 100
          const lowPct = (low / maxStack) * 100
          const affected = critical + warn + low
          const label = `${new Date(run.generated).toLocaleString()} · ${critical} critical, ${warn} warn, ${low} low project${
            affected === 1 ? "" : "s"
          }${run.findingCount != null ? `, ${run.findingCount} findings` : ""}`
          const active = run.runId === activeRunId
          return (
            <span key={run.runId} className="group/hccol relative min-w-[3px] flex-1">
              <button
                type="button"
                onClick={onSelectRun ? () => onSelectRun(run.runId) : undefined}
                aria-label={label}
                title={label}
                className={`relative flex h-full w-full flex-col justify-end overflow-hidden rounded-[1px] ${
                  onSelectRun ? "cursor-pointer" : "cursor-default"
                }`}
                style={{ backgroundColor: "var(--hc-track)" }}
              >
                <span
                  aria-hidden="true"
                  className="block w-full"
                  style={{ height: `${criticalPct}%`, backgroundColor: "var(--hc-critical)" }}
                />
                <span
                  aria-hidden="true"
                  className="block w-full"
                  style={{ height: `${warnPct}%`, backgroundColor: "var(--hc-warn)" }}
                />
                <span
                  aria-hidden="true"
                  className="block w-full"
                  style={{ height: `${lowPct}%`, backgroundColor: "var(--hc-low)" }}
                />
              </button>
              {/* Selection is an inset outline drawn over the bar, never a
                  fill — a fill here would read as missing data (the bug this
                  overlay fixes). */}
              {active && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[1px] ring-2 ring-inset ring-foreground/70"
                />
              )}
              <MarkTooltip groupName="hccol" text={label} />
            </span>
          )
        })}
      </div>

      {showFindingsLine && (
        <div className="mt-1 w-full" style={{ height: lineHeight }}>
          <svg
            viewBox={`0 0 ${Math.max(n, 2) * 10} ${lineHeight}`}
            preserveAspectRatio="none"
            width="100%"
            height={lineHeight}
            role="img"
            aria-label="Total findings per run"
          >
            <polyline
              fill="none"
              stroke="var(--hc-seq-7)"
              strokeWidth={2.25}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              points={runs
                .map((run, i) => {
                  const w = Math.max(n, 2) * 10
                  const x = n === 1 ? w / 2 : (i / (n - 1)) * (w - 10) + 5
                  const y = lineHeight - 2 - ((run.findingCount ?? 0) / maxFindings) * (lineHeight - 4)
                  return `${x},${y}`
                })
                .join(" ")}
            />
          </svg>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* C3 — ProportionBar                                                   */
/* ------------------------------------------------------------------ */

export interface ProportionBarSegment {
  level: Level
  count: number
}

/**
 * One horizontal proportional bar, critical | warn | ok, direct-labeled
 * segments, 2px gaps between fills.
 */
export function ProportionBar({
  segments,
  height = 28,
  className,
}: {
  segments: ProportionBarSegment[]
  height?: number
  className?: string
}) {
  const order: Level[] = ["critical", "warn", "low", "ok"]
  const byLevel = new Map(segments.map((s) => [s.level, s.count]))
  const ordered = order.map((level) => ({ level, count: byLevel.get(level) ?? 0 }))
  const total = ordered.reduce((sum, s) => sum + s.count, 0)
  if (total === 0) return null

  return (
    <div
      role="img"
      aria-label={ordered.map((s) => `${LEVEL_LABEL[s.level]}: ${s.count}`).join(", ")}
      className={`flex w-full overflow-hidden rounded-md ${className ?? ""}`}
      style={{ height, gap: 2 }}
    >
      {ordered
        .filter((s) => s.count > 0)
        .map((s) => {
          const pct = (s.count / total) * 100
          const showLabel = pct >= 12
          return (
            <div
              key={s.level}
              className={`flex items-center justify-center overflow-hidden text-[11px] font-medium ${LEVEL_FILL_TEXT_CLASS[s.level]}`}
              style={{ width: `${pct}%`, backgroundColor: HEALTH_STATUS_VAR[s.level] }}
              title={`${LEVEL_LABEL[s.level]}: ${s.count}`}
            >
              {showLabel ? s.count : null}
            </div>
          )
        })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* C4 / C9 — Series                                                     */
/* ------------------------------------------------------------------ */

export interface SeriesPoint {
  day: string
  value: number
}

/**
 * Line + area chart (variant "full", C4) or a compact axis-less sparkline
 * (variant "spark", C9). Monochrome sequential fill, dashed baseline rule,
 * hover readout keyed to `point.day` (i.e. `metric.days`). Points are also
 * individually focusable so keyboard users get the same readout hover
 * gives, and the last point's value is direct-labeled so the chart isn't
 * hover-only.
 */
export function Series({
  points,
  baseline = null,
  unit = null,
  variant = "full",
  width = 240,
  height,
  valueFormatter,
  ariaLabel,
  className,
}: {
  points: SeriesPoint[]
  baseline?: number | null
  unit?: string | null
  variant?: "full" | "spark"
  width?: number
  height?: number
  valueFormatter?: (value: number, unit: string | null) => string
  ariaLabel?: string
  className?: string
}) {
  const h = height ?? (variant === "spark" ? 24 : 96)
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  if (points.length < 2) return null

  const values = points.map((p) => p.value)
  const max = Math.max(...values, baseline ?? -Infinity, 1)
  const min = Math.min(...values, baseline ?? Infinity, 0)
  const range = max - min || 1
  const pad = variant === "spark" ? 1 : 4
  const n = points.length

  const xAt = (i: number) => (n === 1 ? width / 2 : (i / (n - 1)) * (width - pad * 2) + pad)
  const yAt = (v: number) => h - pad - ((v - min) / range) * (h - pad * 2)

  const linePoints = points.map((p, i) => `${xAt(i)},${yAt(p.value)}`).join(" ")
  const areaPoints = `${xAt(0)},${h - pad} ${linePoints} ${xAt(n - 1)},${h - pad}`
  const format = valueFormatter ?? ((v: number) => Math.round(v).toLocaleString("en-US"))

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0) return
    const relX = ((event.clientX - rect.left) / rect.width) * width
    let nearest = 0
    let best = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xAt(i) - relX)
      if (d < best) {
        best = d
        nearest = i
      }
    }
    setHover(nearest)
  }

  const slotWidth = Math.max(1, width / n)

  return (
    <div className={`relative ${className ?? ""}`} style={{ width: variant === "spark" ? "100%" : width }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${h}`}
        preserveAspectRatio="none"
        width="100%"
        height={h}
        role="img"
        aria-label={ariaLabel ?? "Trend over time"}
        onPointerMove={handleMove}
        onPointerLeave={() => setHover(null)}
      >
        {baseline != null && (
          <line
            x1={0}
            x2={width}
            y1={yAt(baseline)}
            y2={yAt(baseline)}
            stroke="var(--hc-baseline)"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <polygon points={areaPoints} fill="var(--hc-seq-2)" opacity={0.35} stroke="none" />
        <polyline
          points={linePoints}
          fill="none"
          stroke="var(--hc-seq-6)"
          strokeWidth={variant === "spark" ? 1.25 : 1.5}
          vectorEffect="non-scaling-stroke"
        />
        {hover != null && (
          <line
            x1={xAt(hover)}
            x2={xAt(hover)}
            y1={pad}
            y2={h - pad}
            stroke="var(--hc-grid)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {hover != null && (
          <circle cx={xAt(hover)} cy={yAt(points[hover].value)} r={2.5} fill="var(--hc-seq-7)" />
        )}
        {variant === "full" && (
          <text
            x={xAt(n - 1)}
            y={Math.max(10, yAt(points[n - 1].value) - 6)}
            fontSize={10}
            fill="var(--hc-seq-7)"
            textAnchor="end"
          >
            {format(points[n - 1].value, unit)}
          </text>
        )}
        {points.map((p, i) => (
          <rect
            key={p.day}
            x={Math.max(0, xAt(i) - slotWidth / 2)}
            y={0}
            width={slotWidth}
            height={h}
            fill="transparent"
            tabIndex={0}
            role="button"
            aria-label={`${p.day}: ${format(p.value, unit)}`}
            onFocus={() => setHover(i)}
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {hover != null && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 right-0 rounded-md border border-border bg-popover px-1.5 py-0.5 text-[11px] whitespace-nowrap text-popover-foreground shadow-sm"
        >
          {points[hover].day} · {format(points[hover].value, unit)}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* C5 / C6 — StackedBar                                                 */
/* ------------------------------------------------------------------ */

export type { StackedBarSegment } from "./palette"

/**
 * One horizontal stacked bar. Fixed slot ordering (via `colorSlot`) keeps a
 * category's color consistent across every row. Labels only where a segment
 * is wide enough to hold text (>= ~10% of the bar); everything else stays
 * in the numeric table the caller renders beside it — required, not
 * optional, for the aqua/yellow slots per plan.md.
 *
 * `buildCategoricalSlotMap` and `toStackedBarSegments` (in ./palette) build
 * the page-wide `colorSlot` assignment this component expects.
 */
export function StackedBar({
  segments,
  valueFormatter,
  height = 28,
  className,
}: {
  segments: StackedBarSegmentType[]
  valueFormatter?: (value: number) => string
  height?: number
  className?: string
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  if (total === 0 || segments.length === 0) return null
  const format = valueFormatter ?? ((v: number) => Math.round(v).toLocaleString("en-US"))

  return (
    <div
      role="img"
      aria-label={segments.map((s) => `${s.label}: ${format(s.value)}`).join(", ")}
      className={`flex w-full overflow-hidden rounded-md ${className ?? ""}`}
      style={{ height, gap: 2 }}
    >
      {segments
        .filter((s) => s.value > 0)
        .map((s) => {
          const pct = (s.value / total) * 100
          const showLabel = pct >= 10
          return (
            <div
              key={s.key}
              className="flex items-center overflow-hidden px-1 text-[11px] font-medium text-white"
              style={{ width: `${pct}%`, backgroundColor: categoricalSlotVar(s.colorSlot) }}
              title={`${s.label}: ${format(s.value)}`}
            >
              {showLabel ? <span className="truncate">{s.label}</span> : null}
            </div>
          )
        })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* C7 — DivergingBar                                                    */
/* ------------------------------------------------------------------ */

export interface DivergingBarRow {
  key: string
  label: string
  /** Latest metric value. */
  value: number
  /** Baseline the metric is compared to. */
  baseline: number
  /** Optional severity badge rendered beside the row — carries the actual
   * verdict (a stall can be critical despite sitting on the "calm" side).
   * The bar's own color always encodes direction, never this. */
  severity?: Level
}

/**
 * Bars growing left/right from a center baseline. Implements option (a)
 * from plan.md's "known tension" note: the diverging warm/cool form always
 * encodes *direction* (above baseline = warm/right, below = cool/left), and
 * severity — which can disagree with direction, e.g. a critical stall sits
 * on the cool/left side — is carried by the optional `severity` dot beside
 * the row, never by recoloring the bar. Pass `mode="magnitude"` to switch
 * to option (b): a single-hue bar whose side still shows direction, for if
 * stalls turn out to be the common case in practice.
 */
export function DivergingBar({
  rows,
  mode = "diverging",
  rowHeight = 22,
  className,
}: {
  rows: DivergingBarRow[]
  mode?: "diverging" | "magnitude"
  rowHeight?: number
  className?: string
}) {
  if (rows.length === 0) return null

  const multiples = rows.map((r) => {
    if (r.baseline > 0) return r.value / r.baseline
    return r.value > 0 ? Infinity : 1
  })
  const finiteAbove = multiples.filter((m) => Number.isFinite(m) && m >= 1).map((m) => m - 1)
  const finiteBelow = multiples.filter((m) => Number.isFinite(m) && m < 1).map((m) => 1 - m)
  const maxAbove = Math.max(1e-6, ...finiteAbove)
  const maxBelow = Math.max(1e-6, ...finiteBelow)

  function formatMultiple(m: number) {
    if (!Number.isFinite(m)) return "off scale"
    return `${m < 10 ? m.toFixed(1) : Math.round(m)}×`
  }

  return (
    <div className={`flex w-full flex-col gap-1 ${className ?? ""}`} role="group" aria-label="Metric vs baseline">
      {rows.map((row, i) => {
        const m = multiples[i]
        const above = m >= 1
        const magnitude = Number.isFinite(m) ? Math.abs(m - 1) : above ? maxAbove : maxBelow
        const pct = Math.min(100, (magnitude / (above ? maxAbove : maxBelow)) * 100)
        const barColor = mode === "diverging" ? (above ? "var(--hc-critical)" : "var(--hc-seq-5)") : "var(--hc-seq-6)"
        const label = `${row.label}: ${formatMultiple(m)} baseline, ${above ? "above" : "below"}${
          row.severity ? ` · ${LEVEL_LABEL[row.severity]}` : ""
        }`

        return (
          <div key={row.key} className="group/hcdiv relative flex items-center gap-2" style={{ height: rowHeight }}>
            <span className="w-28 shrink-0 truncate text-xs text-muted-foreground" title={row.label}>
              {row.label}
            </span>
            {row.severity && (
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: HEALTH_STATUS_VAR[row.severity] }}
              />
            )}
            <div className="relative h-full flex-1" tabIndex={0} aria-label={label} title={label}>
              <div
                className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2"
                style={{ backgroundColor: "var(--hc-grid)" }}
                aria-hidden="true"
              />
              <div
                className="absolute inset-y-1 rounded-[1px]"
                style={
                  above
                    ? { left: "50%", width: `${pct / 2}%`, backgroundColor: barColor }
                    : { right: "50%", width: `${pct / 2}%`, backgroundColor: barColor }
                }
              />
            </div>
            <span className="w-14 shrink-0 text-right text-xs tabular-nums" aria-hidden="true">
              {formatMultiple(m)}
            </span>
            <MarkTooltip groupName="hcdiv" text={label} />
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* C8 — Meter                                                           */
/* ------------------------------------------------------------------ */

/**
 * A thin meter with a marked threshold on the track — e.g. error rate
 * against the 5% warn line. The fill turns warn-colored once `value`
 * crosses `threshold`; the threshold itself is a solid hairline tick, not
 * a dashed one (the only dashed mark on the page is `Series`'s baseline).
 */
export function Meter({
  value,
  max = 100,
  threshold,
  label,
  valueFormatter,
  height = 8,
  className,
}: {
  value: number
  max?: number
  threshold?: number
  label?: string
  valueFormatter?: (value: number) => string
  height?: number
  className?: string
}) {
  const format = valueFormatter ?? ((v: number) => `${v.toFixed(1)}%`)
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const overThreshold = threshold != null && value >= threshold
  const fillColor = overThreshold ? "var(--hc-warn)" : "var(--hc-good)"
  const thresholdPct = threshold != null ? Math.max(0, Math.min(100, (threshold / max) * 100)) : null
  const text = `${label ? `${label}: ` : ""}${format(value)}${
    threshold != null ? ` (threshold ${format(threshold)})` : ""
  }`

  return (
    <div
      className="relative w-full"
      title={text}
      aria-label={text}
      role="img"
      tabIndex={0}
    >
      <div
        className={`relative w-full overflow-hidden rounded-full ${className ?? ""}`}
        style={{ height, backgroundColor: "var(--hc-track)" }}
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: fillColor }} />
        {thresholdPct != null && (
          <div
            className="absolute inset-y-0 w-px"
            style={{ left: `${thresholdPct}%`, backgroundColor: "var(--hc-grid)" }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  )
}
