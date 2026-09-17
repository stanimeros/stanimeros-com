// Everything that turns a severity into something on screen: its colour, its
// icon, its name, and which tab it belongs to. One table per concern, all in
// one file, because a level that looks critical in one place and low in
// another is the bug this module exists to prevent.

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react"
import type { Level } from "./types"

export const LEVEL_ORDER: Record<Level, number> = { critical: 0, warn: 1, low: 2, ok: 3 }

// Mockup decision 2 — severity is a 3px stripe on the row/card edge, never a
// Colors are the exact hex from the mockup's `:root` block (palette.css).
export const LEVEL_STYLE: Record<Level, string> = {
  critical: "border-l-[3px] border-l-[var(--hc-critical)]",
  warn: "border-l-[3px] border-l-[var(--hc-warn)]",
  low: "border-l-[3px] border-l-[var(--hc-low)]",
  ok: "border-l-[3px] border-l-transparent",
}

// Overview's project cards: a soft tint of the whole card instead of the
// stripe used elsewhere, so the grid reads as color blocks at a glance.
export const LEVEL_TINT: Record<Level, string> = {
  critical: "border-[var(--hc-critical)]/30 bg-[var(--hc-critical)]/10",
  warn: "border-[var(--hc-warn)]/30 bg-[var(--hc-warn)]/10",
  low: "border-[var(--hc-low)]/30 bg-[var(--hc-low)]/10",
  ok: "border-border bg-card",
}

// Overview's per-number chips: a stronger tint than LEVEL_TINT, background
// only (no border), used behind a count when it's non-zero.
export const LEVEL_CHIP_BG: Record<Exclude<Level, "ok">, string> = {
  critical: "bg-[var(--hc-critical)]/15",
  warn: "bg-[var(--hc-warn)]/15",
  low: "bg-[var(--hc-low)]/15",
}

// The fill for a row's own stripe `<span>` (a background, not a border).
export const LEVEL_BG: Record<Level, string> = {
  critical: "bg-[var(--hc-critical)]",
  warn: "bg-[var(--hc-warn)]",
  low: "bg-[var(--hc-low)]",
  ok: "bg-[var(--hc-good)]",
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

// "critical" (the Level value) is always labeled "Errors" — the category
// name used everywhere on screen. Kept distinct from the raw Cloud Logging
// line count (labeled "log lines"), which is a different, unrelated number
// that happens to also be about errors.
export const LEVEL_LABEL: Record<Level, string> = {
  critical: "Errors",
  warn: "Warning",
  low: "Low",
  ok: "Healthy",
}

// The three severity tabs, in the order they're read. `kind` examples are the
// findings the analyzer actually raises at that level, named here because
// "warn" on its own doesn't say what it will contain.
export const SEVERITY_TABS: {
  value: string
  level: Exclude<Level, "ok">
  label: string
  icon: typeof CheckCircle2
  emptyText: string
}[] = [
  { value: "errors", level: "critical", label: "Errors", icon: XCircle, emptyText: "No errors" },
  { value: "warnings", level: "warn", label: "Warnings", icon: AlertTriangle, emptyText: "No warnings" },
  { value: "low", level: "low", label: "Low", icon: Info, emptyText: "Nothing low-severity" },
]

export const TAB_VALUES = ["overview", ...SEVERITY_TABS.map((t) => t.value), "projects", "cost"]

export const TAB_FOR_LEVEL: Record<Exclude<Level, "ok">, string> = {
  critical: "errors",
  warn: "warnings",
  low: "low",
}
