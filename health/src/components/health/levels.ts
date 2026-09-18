// Everything that turns a severity into something on screen: its colour, its
// icon, its name, and which tab it belongs to. One table per concern, all in
// one file, because a level that looks critical in one place and low in
// another is the bug this module exists to prevent.

// The colour values themselves live in ./palette.css as custom properties
// with light and dark variants; imported here for its side effect so anything
// that reads a level also gets the variables it resolves against.
import "./palette.css"
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react"
import type { Finding, Level, LifecycleFinding } from "./types"

export const LEVEL_ORDER: Record<Level, number> = { critical: 0, warn: 1, low: 2, ok: 3 }

/** The severity a project should actually be shown at: worst level among its
 *  findings that aren't acked ("resolved", in the UI's words). `project.status`
 *  itself comes straight off the backend sweep and knows nothing about the
 *  lifecycle collection, so anything that colors a border or picks an icon
 *  must go through this instead, or acking every finding on a project still
 *  leaves it looking critical until the next scheduled run. */
export function effectiveLevel(findings: Finding[], lifecycle: Map<string, LifecycleFinding>): Level {
  let worst: Level = "ok"
  for (const finding of findings) {
    if (lifecycle.get(finding.key)?.state === "acked") continue
    if (LEVEL_ORDER[finding.level] < LEVEL_ORDER[worst]) worst = finding.level
  }
  return worst
}

/** The one place "how many are open vs. resolved, per level" gets counted --
 *  the Overview strip (estate-wide) and each project card (one project's
 *  findings) both call this instead of re-walking their own findings list,
 *  so "0 (4)" means the same thing, computed the same way, everywhere it
 *  appears. `open` is what `effectiveLevel`/the severity tab badges already
 *  show; `acked` is its exact complement. */
export function splitFindingCounts(
  findings: Finding[],
  lifecycle: Map<string, LifecycleFinding>
): { open: Record<Exclude<Level, "ok">, number>; acked: Record<Exclude<Level, "ok">, number> } {
  const open: Record<Exclude<Level, "ok">, number> = { critical: 0, warn: 0, low: 0 }
  const acked: Record<Exclude<Level, "ok">, number> = { critical: 0, warn: 0, low: 0 }
  for (const finding of findings) {
    if (lifecycle.get(finding.key)?.state === "acked") acked[finding.level] += 1
    else open[finding.level] += 1
  }
  return { open, acked }
}

/** The raw `var()` reference, for the charts — they set `style`/`background`
 *  rather than a Tailwind class, so they can't use LEVEL_TEXT. */
export const HEALTH_STATUS_VAR: Record<Level, string> = {
  critical: "var(--hc-critical)",
  warn: "var(--hc-warn)",
  low: "var(--hc-low)",
  ok: "var(--hc-good)",
}

// Severity is a 3px stripe on the row/card edge, never a filled background —
// a whole card in red reads as "this is broken" even when the finding is one
// low-severity note.
export const LEVEL_STYLE: Record<Level, string> = {
  critical: "border-l-[3px] border-l-[var(--hc-critical)]",
  warn: "border-l-[3px] border-l-[var(--hc-warn)]",
  low: "border-l-[3px] border-l-[var(--hc-low)]",
  ok: "border-l-[3px] border-l-transparent",
}

// A soft tint behind a number, background only (no border). Used by the
// repeat-count badge in primitives.tsx, where the tone tracks how often a
// finding fired rather than its own level.
export const LEVEL_CHIP_BG: Record<Exclude<Level, "ok">, string> = {
  critical: "bg-[var(--hc-critical)]/15",
  warn: "bg-[var(--hc-warn)]/15",
  low: "bg-[var(--hc-low)]/15",
}

export const LEVEL_TEXT: Record<Level, string> = {
  critical: "text-[var(--hc-critical)]",
  warn: "text-[var(--hc-warn)]",
  low: "text-[var(--hc-low)]",
  ok: "text-[var(--hc-good)]",
}

// `low` gets a quieter mark than a warning triangle — hygiene, not an
// incident — so it doesn't compete visually with a real failure.
export const LEVEL_ICON: Record<Level, typeof CheckCircle2> = {
  critical: XCircle,
  warn: AlertTriangle,
  low: Info,
  ok: CheckCircle2,
}

// The name of each level, used everywhere on screen — tab, card header, band
// tooltip, email. Plural, because every one of them labels a count.
//
// "critical" is deliberately NOT called "Errors": the dashboard also shows a
// raw Cloud Logging line count, and calling both "errors" left two unrelated
// numbers wearing one word in adjacent controls. Findings are "critical";
// only log lines are "errors".
export const LEVEL_LABEL: Record<Level, string> = {
  critical: "Critical",
  warn: "Warnings",
  low: "Low",
  ok: "Healthy",
}

// The three severity tabs, in the order they're read.
export const SEVERITY_TABS: {
  value: string
  level: Exclude<Level, "ok">
  label: string
  icon: typeof CheckCircle2
  emptyText: string
}[] = [
  // `value` is the URL-hash token; it stays "errors" so existing #tab=errors
  // links keep working even though the tab is now labelled Critical.
  { value: "errors", level: "critical", label: "Critical", icon: XCircle, emptyText: "Nothing critical" },
  { value: "warnings", level: "warn", label: "Warnings", icon: AlertTriangle, emptyText: "No warnings" },
  { value: "low", level: "low", label: "Low", icon: Info, emptyText: "Nothing low" },
]

export const TAB_VALUES = ["overview", ...SEVERITY_TABS.map((t) => t.value), "projects", "cost"]
