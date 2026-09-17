/**
 * Health dashboard chart palette — the non-component half of ./charts.tsx,
 * split into its own module because a file that exports components must
 * export only components for Fast Refresh (see any src/components/ui/*
 * "-variants" file for the same pattern already in this codebase).
 *
 * The actual color values live in ./palette.css as CSS custom properties
 * with light and dark variants (plan.md, "Chart layer" > "The one law").
 * This file only names the roles and provides the small amount of JS logic
 * (categorical slot assignment) that can't live in CSS.
 */
import "./palette.css"

export type Level = "critical" | "warn" | "low" | "ok"

/** Status — reserved, never used for anything but severity. */
export const HEALTH_STATUS_VAR: Record<Level, string> = {
  critical: "var(--hc-critical)",
  warn: "var(--hc-warn)",
  low: "var(--hc-low)",
  ok: "var(--hc-good)",
}

export const LEVEL_LABEL: Record<Level, string> = {
  critical: "Errors",
  warn: "Warning",
  low: "Low",
  ok: "Healthy",
}


/** Categorical (C5/C6 only), fixed slot order — never cycled beyond 4. */
export const HEALTH_CATEGORICAL_VARS = [
  "var(--hc-cat-1)",
  "var(--hc-cat-2)",
  "var(--hc-cat-3)",
  "var(--hc-cat-4)",
]

export function categoricalSlotVar(slot: number): string {
  const n = HEALTH_CATEGORICAL_VARS.length
  return HEALTH_CATEGORICAL_VARS[((slot % n) + n) % n]
}

export interface StackedBarSegment {
  key: string
  label: string
  value: number
  /** Index into the 4-slot categorical palette. Must be assigned the same
   * way for the same category on every row on the page — see
   * `buildCategoricalSlotMap` / `toStackedBarSegments` below. */
  colorSlot: number
}

/**
 * Build a page-wide category -> slot(0..2) assignment from combined totals
 * (e.g. every project's cost-by-service, summed by service, for the whole
 * Cost tab). Only the top `maxNamed` categories get a named slot; slot 3 is
 * reserved for "Other" everywhere via `toStackedBarSegments`, so a service
 * keeps its color on every project's bar, and "Other" is likewise the same
 * color on every bar.
 */
export function buildCategoricalSlotMap(totalsByKey: Record<string, number>, maxNamed = 3): Map<string, number> {
  const ranked = Object.entries(totalsByKey).sort((a, b) => b[1] - a[1])
  const map = new Map<string, number>()
  ranked.slice(0, maxNamed).forEach(([key], i) => map.set(key, i))
  return map
}

/** Turn one row's raw items into `StackedBarSegment`s using a page-wide
 * slot map from `buildCategoricalSlotMap`. Anything not in the map folds
 * into "Other" (always the last slot). */
export function toStackedBarSegments(
  items: { key: string; label: string; value: number }[],
  slotMap: Map<string, number>,
  otherLabel = "Other",
): StackedBarSegment[] {
  const named: StackedBarSegment[] = []
  let otherTotal = 0
  for (const item of items) {
    const slot = slotMap.get(item.key)
    if (slot != null) named.push({ ...item, colorSlot: slot })
    else otherTotal += item.value
  }
  named.sort((a, b) => a.colorSlot - b.colorSlot)
  const result = named
  if (otherTotal > 0) {
    result.push({ key: "__other__", label: otherLabel, value: otherTotal, colorSlot: HEALTH_CATEGORICAL_VARS.length - 1 })
  }
  return result
}
