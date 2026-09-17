/**
 * The dashboard's two charts: `StatusBand` (severity over runs) and `Series`
 * (one metric over time). Inline SVG and flex/grid divs only — no chart
 * library, no new dependency.
 *
 * The one law every primitive here follows: color means severity and
 * nothing else. `StatusBand` uses the reserved status colors because it *is*
 * a severity chart. `Series` (quantity) is always monochrome sequential grey.
 *
 * The palette is defined once, in ./palette.css (imported by ./levels for its
 * side effect), as CSS custom properties with light and dark values. Every
 * component here references a role (`var(--hc-critical)`, `var(--hc-seq-6)`,
 * ...), never a raw hex.
 *
 * Interaction rules applied throughout: hover enhances and never gates —
 * every value drawn is also either a direct label, a native `title`, or an
 * `aria-label`; keyboard focus shows
 * the same thing hover shows; hit targets are padded to ~24px even when the
 * mark itself is a couple of pixels wide; no chart animates on mount; grid/
 * axis strokes are hairline and solid, the sole exception being the dashed
 * baseline rule in `Series`, where dashing means "reference value".
 */
import { useEffect, useRef, useState } from "react"
import { exactTime } from "./format"
import { HEALTH_STATUS_VAR, LEVEL_LABEL } from "./levels"
import type { Level } from "./types"

/** Shared hover/focus tooltip: a visually hidden label that appears above
 * its trigger on hover or focus-within, via CSS only (no JS positioning
 * needed for the many small marks in the div-based charts). `groupName`
 * must be a unique Tailwind arbitrary group name per chart so adjacent
 * marks don't cross-trigger each other's tooltip.
 *
 * `hidden` (not just `opacity-0`) when idle: an absolutely positioned,
 * `w-max max-w-[240px]` box centered under a 4px-wide bar routinely lands
 * partly off-screen near either edge of the band. `opacity-0` still lays
 * that out and left `document.documentElement.scrollWidth` wider than the
 * viewport on every load — 90 of these, mostly invisible, were the entire
 * source of the phantom horizontal scroll/black-strip-at-the-edge on
 * mobile. `display:none` removes a hidden one from layout entirely, so
 * only the one actually being hovered or focused can ever push past the
 * edge, and only while it's shown. */
function MarkTooltip({ groupName, text }: { groupName: string; text: string }) {
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-max max-w-[240px] -translate-x-1/2 whitespace-normal rounded-md border border-border bg-popover px-2 py-1 text-[11px] leading-snug text-popover-foreground shadow-md group-hover/${groupName}:block group-focus-within/${groupName}:block`}
    >
      {text}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* StatusBand — severity across runs                                   */
/* ------------------------------------------------------------------ */

export interface StatusBandRun {
  runId: string
  generated: string
  status: Level
  counts?: Partial<Record<Level | "total", number>>
}

/** A run's cell as a gradient of its own severity mix — critical, then warn,
 *  then low, then ok, each sized to its share of the run's projects — rather
 *  than one flat color for whichever was worst. A run that's "critical" on
 *  one project out of fifteen should not paint the same as one that's
 *  critical everywhere. Falls back to the flat status color when a run
 *  carries no counts (older history rows) or nothing to divide. */
function bandBackground(run: StatusBandRun): string {
  const counts = run.counts
  if (!counts) return HEALTH_STATUS_VAR[run.status]
  const segments = (["critical", "warn", "low", "ok"] as const)
    .map((level) => ({ level, value: counts[level] ?? 0 }))
    .filter((s) => s.value > 0)
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  if (total === 0) return HEALTH_STATUS_VAR[run.status]
  if (segments.length === 1) return HEALTH_STATUS_VAR[segments[0].level]

  // Top to bottom, worst first — a vertical stack reads as a tiny bar chart
  // rather than a smear.
  let pos = 0
  const stops: string[] = []
  for (const seg of segments) {
    const color = HEALTH_STATUS_VAR[seg.level]
    const pct = (seg.value / total) * 100
    stops.push(`${color} ${pos}%`, `${color} ${pos + pct}%`)
    pos += pct
  }
  return `linear-gradient(to bottom, ${stops.join(", ")})`
}

/**
 * One cell per run, oldest left, colored as a vertical gradient of that
 * run's own severity mix (see `bandBackground`). Cells stretch (`flex-1`)
 * to fill the row whatever the run count is — height, not a width cap, is
 * what keeps each one reading as a thin column rather than a tile. Padded
 * on the left with neutral, non-interactive placeholders up to the current
 * bar cap (see `useBarCap`), so the band doesn't visibly widen bar-by-bar
 * over a project's first few runs — only real history ever shrinks it
 * below that floor.
 */
// How many bars actually fit a row before they get too thin to read as
// individual cells, at a few width bands. Picked by eye, not measured off
// the container -- the row is edge-to-edge in its card either way, and a
// fixed table beats a ResizeObserver for something this low-stakes.
const BAR_CAPS: { minWidth: number; cap: number }[] = [
  { minWidth: 1024, cap: 90 },
  { minWidth: 640, cap: 60 },
  { minWidth: 400, cap: 40 },
  { minWidth: 0, cap: 26 },
]

function capForWidth(width: number): number {
  return BAR_CAPS.find((b) => width >= b.minWidth)?.cap ?? 26
}

/** Caps the bar count to whatever the viewport can actually hold, so the
 *  band never needs a scrollbar or a page-widening min-width -- it just
 *  shows a shorter slice of history on a narrow screen. Starts from the
 *  narrowest cap (correct on first paint for the common mobile case) and
 *  widens once mounted, since only the client knows the real width. */
function useBarCap(): number {
  const [cap, setCap] = useState(26)
  useEffect(() => {
    const update = () => setCap(capForWidth(window.innerWidth))
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])
  return cap
}

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
  const cap = useBarCap()
  if (runs.length === 0) return null
  // Newest runs matter more than old ones, so a narrow screen drops the
  // oldest bars first rather than shrinking every bar to fit them all.
  const visible = runs.length > cap ? runs.slice(runs.length - cap) : runs
  const placeholders = Math.max(0, cap - visible.length)
  return (
    <div
      role="group"
      aria-label="Run history status band"
      className={`flex h-14 w-full items-stretch gap-[3px] ${className ?? ""}`}
    >
      {Array.from({ length: placeholders }, (_, i) => (
        <span
          key={`empty-${i}`}
          aria-hidden="true"
          className="min-w-px flex-1 rounded-[1px]"
          style={{ background: "var(--hc-track)" }}
        />
      ))}
      {visible.map((run) => {
        const exact = exactTime(run.generated)
        const countsText = run.counts
          // The page's words, not the internal level names (warn/ok).
          ? ` · ${run.counts.critical ?? 0} critical, ${run.counts.warn ?? 0} warnings, ${run.counts.low ?? 0} low, ${run.counts.ok ?? 0} healthy`
          : ""
        const label = `${LEVEL_LABEL[run.status]} · ${exact}${countsText}`
        return (
          <span key={run.runId} className="group/hcband relative min-w-px flex-1">
            <button
              type="button"
              onClick={onSelectRun ? () => onSelectRun(run.runId) : undefined}
              aria-label={label}
              title={label}
              className={`block h-full w-full rounded-[1px] ${onSelectRun ? "cursor-pointer" : "cursor-default"} ${
                run.runId === activeRunId ? "ring-2 ring-foreground/60 ring-offset-1 ring-offset-background" : ""
              }`}
              style={{ background: bandBackground(run) }}
            />
            <MarkTooltip groupName="hcband" text={label} />
          </span>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Series — one metric over time                                        */
/* ------------------------------------------------------------------ */

export interface SeriesPoint {
  day: string
  value: number
}

/**
 * Line + area chart (variant "full") or a compact axis-less sparkline
 * (variant "spark"). Monochrome sequential fill, dashed baseline rule,
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
            // A transparent hit target with the browser default outline
            // suppressed leaves a keyboard user tabbing blind: the readout
            // changes but nothing shows which point it belongs to.
            className="outline-none focus-visible:stroke-[var(--hc-focus,currentColor)] focus-visible:[stroke-width:1.5px]"
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
