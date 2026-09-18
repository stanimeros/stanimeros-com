// Decides whether a run is worth an email, and writes it.
//
// The rule that makes this tool usable: mail only on finding keys that weren't
// in the previous run. Three runs a day across 15 projects would otherwise send
// the same spike 21 times a week, and the alerts would stop being read. An
// ongoing problem stays visible on the dashboard, silently.

const { sendOwnerEmail, escapeHtml } = require("./mailer");
const { formatAthens } = require("./config");

const LEVEL_COLOR = { critical: "#b91c1c", warn: "#b45309", low: "#6b7280" };

function newKeys(report, previousKeys) {
  const seen = new Set(previousKeys || []);
  const keys = [];
  for (const project of report.projects) {
    for (const finding of project.findings) {
      if (!seen.has(finding.key)) keys.push(finding.key);
    }
  }
  return keys;
}

// The level a finding key carries in this report, or null if the key isn't
// present (shouldn't happen for a key `newKeys` just derived from this same
// report, but a missing lookup should mean "not exempt" rather than throw).
function levelOf(report, key) {
  for (const project of report.projects) {
    const finding = project.findings.find((f) => f.key === key);
    if (finding) return finding.level;
  }
  return null;
}

// True when at least one of the new keys is worth waking someone up over.
// `low` findings are estate hygiene (an unrestricted API key, GCP's default
// agent still holding roles/editor, ...) -- true, but not an incident, and
// often not fixable today. A run whose *only* new findings are `low` must
// stay silent: three runs a day would otherwise mail the same "unrestricted
// key" notice on the same cadence as a real outage, and the alert would stop
// being read. They still ride along as context inside an email triggered by
// something else -- renderEmail lists every finding of an affected project,
// not just the ones that qualified it -- so nothing about them is hidden,
// only the trigger is gated.
function hasAlertableFinding(report, keys) {
  return keys.some((key) => levelOf(report, key) !== "low");
}

function subjectFor(report, keys) {
  const worst = report.projects
    .filter((p) => p.findings.some((f) => keys.includes(f.key)))
    .map((p) => p.name);
  const scope = worst.length === 1 ? worst[0] : `${worst.length} projects`;
  // The worst of the NEW findings, not of the whole estate. Keying off
  // report.status mailed "[CRITICAL]" for a single new warn whenever some
  // unrelated project happened to already be critical.
  const level = keys.some((key) => levelOf(report, key) === "critical") ? "CRITICAL" : "Warning";
  return `[${level}] ${scope} — ${keys.length} new finding${keys.length === 1 ? "" : "s"}`;
}

// Only the new findings lead. The rest of each affected project's findings
// follow as context, so the mail explains the situation without becoming a
// full report — that's what the dashboard is for. `ackedKeys` (this run's
// already-resolved findings, from updateLifecycle) are left out of that
// context entirely: a finding someone already marked resolved isn't context
// for a new one, it's noise repeated in every email until it eventually
// clears on its own.
function renderEmail(report, keys, dashboardUrl, ackedKeys = []) {
  const isNew = (finding) => keys.includes(finding.key);
  const acked = new Set(ackedKeys);
  const affected = report.projects.filter((p) => p.findings.some(isNew));

  const parts = [
    `<h2 style="margin:0 0 4px">System health — ${keys.length} new finding${keys.length === 1 ? "" : "s"}</h2>`,
    `<p style="margin:0 0 16px;color:#666;font-size:13px">`,
    // Explicitly "projects": these are project counts sitting directly under
    // a finding count, which read as more findings.
    `${escapeHtml(formatAthens(report.generated))} · ${report.counts.total} projects — ${report.counts.critical} critical, `,
    `${report.counts.warn} warnings, ${report.counts.low} low, ${report.counts.ok} healthy</p>`,
  ];

  for (const project of affected) {
    parts.push(
      `<h3 style="margin:18px 0 6px">${escapeHtml(project.name)} `,
      `<span style="font-weight:400;color:#888">${escapeHtml(project.project)}</span></h3>`,
      `<ul style="margin:0;padding-left:18px">`
    );
    for (const finding of project.findings.filter((f) => !acked.has(f.key) && f.level !== "low")) {
      const color = LEVEL_COLOR[finding.level] || "#333";
      const tag = isNew(finding) ? "" : `<span style="color:#999">ongoing</span> `;
      parts.push(
        `<li style="margin:3px 0">${tag}<span style="color:${color}">${escapeHtml(finding.kind)}</span> — ${escapeHtml(finding.text)}</li>`
      );
    }
    parts.push("</ul>");

    if (project.errorTruncated) {
      parts.push(
        `<p style="margin:6px 0;color:#b45309;font-size:13px">Error log hit the 1,000-entry cap — the real count is higher.</p>`
      );
    }
  }

  if (report.projectErrors && report.projectErrors.length) {
    parts.push(
      `<h3 style="margin:18px 0 6px;color:#b45309">Not checked</h3>`,
      `<ul style="margin:0;padding-left:18px">`
    );
    for (const failure of report.projectErrors) {
      parts.push(
        `<li style="margin:3px 0">${escapeHtml(failure.project)} (${escapeHtml(failure.stage)}) — ${escapeHtml(failure.error)}</li>`
      );
    }
    parts.push("</ul>");
  }

  if (dashboardUrl) {
    parts.push(
      `<p style="margin:20px 0 0"><a href="${escapeHtml(dashboardUrl)}">Open the dashboard</a></p>`
    );
  }
  return parts.join("");
}

/**
 * Sends only when this is an alerting run (not a manual "Run now" -- see
 * runHealthCheck) and there's something new *and* alertable in it. Returns
 * the keys that are new in this run either way (even when nothing was
 * mailed, or `alerting` is false) -- runHealthCheck arms the next run's diff
 * off this regardless of mode, per the header comment on `low`.
 */
async function notifyIfNew(report, previousKeys, { to = null, dashboardUrl = null, ackedKeys = [], alerting = true } = {}) {
  const keys = newKeys(report, previousKeys);
  if (!alerting || !keys.length || !hasAlertableFinding(report, keys)) return { sent: false, keys };

  await sendOwnerEmail({
    subject: subjectFor(report, keys),
    html: renderEmail(report, keys, dashboardUrl, ackedKeys),
    to,
  });
  return { sent: true, keys };
}

module.exports = { notifyIfNew, newKeys, hasAlertableFinding, renderEmail, subjectFor };
