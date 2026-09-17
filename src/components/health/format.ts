// Value formatting, storage and URL-hash plumbing — the pure helpers the
// dashboard's components share. No JSX here, so any of it can be unit-tested
// without a renderer.

import { useCallback, useEffect, useState } from "react"
import type { Finding, LifecycleFinding } from "./types"

export function formatValue(value: number, unit: string | null) {
  if (unit === "bytes") {
    let size = value
    for (const suffix of ["B", "KB", "MB", "GB", "TB"]) {
      if (size < 1024 || suffix === "TB") {
        return suffix === "B" ? `${Math.round(size)} B` : `${size.toFixed(1)} ${suffix}`
      }
      size /= 1024
    }
  }
  return Math.round(value).toLocaleString("en-US")
}

export function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "EUR" }).format(value)
}

export function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Compact age, for the "Open" row of a finding's expanded detail panel. */
export function duration(fromIso: string, toIso?: string | null) {
  const minutes = Math.round(((toIso ? new Date(toIso).getTime() : Date.now()) - new Date(fromIso).getTime()) / 60000)
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

/** Exact local time for a title attribute — `timeAgo` rounds too hard to
 *  correlate a finding with a deploy. */
export function exactTime(iso: string) {
  return new Date(iso).toLocaleString()
}

/** Renders a findings list as Markdown, meant to be pasted straight into an
 *  agent chat for triage — project, kind, the actual message, and the
 *  lifecycle facts (first/last seen, runs, ack state) that give an agent
 *  enough to judge whether something is new or long-standing. */
export function findingsToMarkdown(
  title: string,
  findings: Finding[],
  lifecycle?: Map<string, LifecycleFinding>
): string {
  const lines = [`# ${title}`, ""]
  if (findings.length === 0) {
    lines.push("No findings.")
    return lines.join("\n")
  }
  for (const f of findings) {
    const life = lifecycle?.get(f.key)
    const bits: string[] = []
    if (life) {
      bits.push(`first seen ${exactTime(life.firstSeen)}`)
      bits.push(`last seen ${exactTime(life.lastSeen)}`)
      bits.push(`seen in ${life.runsSeen} run${life.runsSeen === 1 ? "" : "s"}`)
      if (life.state === "acked") bits.push("acked")
    }
    const meta = bits.length ? ` (${bits.join(" · ")})` : ""
    const project = f.projectName ? `**${f.projectName}** — ` : ""
    lines.push(`- ${project}\`${f.kind}\`: ${f.text}${meta}`)
  }
  return lines.join("\n")
}

/** Every localStorage access wrapped — a private window, cleared site data,
 *  or a browser that blocks storage must never break the page. */
export function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeLocalStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // best-effort — a per-viewer convenience, not a source of truth
  }
}

/** Parse `#tab=warnings&project=foo` into a plain object. */
function parseHash(hash: string): Record<string, string> {
  const out: Record<string, string> = {}
  const raw = hash.replace(/^#/, "")
  if (!raw) return out
  for (const pair of raw.split("&")) {
    const [key, value] = pair.split("=")
    if (key) out[decodeURIComponent(key)] = decodeURIComponent(value ?? "")
  }
  return out
}

function buildHash(params: Record<string, string | null | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
  return parts.length ? `#${parts.join("&")}` : ""
}

/** One filter row's worth of state, persisted in the URL hash so a
 *  filtered view is linkable. Reads the hash once on mount (SSR-safe: this
 *  only runs client-side, in an effect) and keeps it in sync via
 *  `history.replaceState` — never `pushState`, so filtering doesn't spam
 *  browser history. */
export function useHashState() {
  const [params, setParams] = useState<Record<string, string>>({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setParams(parseHash(window.location.hash))
    setReady(true)
    const onHashChange = () => setParams(parseHash(window.location.hash))
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  const update = useCallback((patch: Record<string, string | null | undefined>) => {
    setParams((prev) => {
      const merged: Record<string, string | null | undefined> = { ...prev, ...patch }
      const next: Record<string, string> = {}
      for (const [key, value] of Object.entries(merged)) {
        if (value) next[key] = value
      }
      const hash = buildHash(next)
      window.history.replaceState(null, "", hash ? hash : window.location.pathname + window.location.search)
      return next
    })
  }, [])

  return { params, ready, update }
}
