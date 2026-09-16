// Decides whether a run is worth an email, and writes it.
//
// The rule that makes this tool usable: mail only on finding keys that weren't
// in the previous run. Three runs a day across 15 projects would otherwise send
// the same spike 21 times a week, and the alerts would stop being read. An
// ongoing problem stays visible on the dashboard, silently.

const { sendOwnerEmail, escapeHtml } = require("../mailer");

const LEVEL_COLOR = { critical: "#b91c1c", warn: "#b45309" };

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

function subjectFor(report, keys) {
  const worst = report.projects
    .filter((p) => p.findings.some((f) => keys.includes(f.key)))
    .map((p) => p.name);
  const scope = worst.length === 1 ? worst[0] : `${worst.length} projects`;
  const level = report.status === "critical" ? "CRITICAL" : "Warning";
  return `[${level}] ${scope} — ${keys.length} new finding${keys.length === 1 ? "" : "s"}`;
}

// Only the new findings lead. The rest of each affected project's findings
// follow as context, so the mail explains the situation without becoming a
// full report — that's what the dashboard is for.
function renderEmail(report, keys, dashboardUrl) {
  const isNew = (finding) => keys.includes(finding.key);
  const affected = report.projects.filter((p) => p.findings.some(isNew));

  const parts = [
    `<h2 style="margin:0 0 4px">Firebase health — ${keys.length} new finding${keys.length === 1 ? "" : "s"}</h2>`,
    `<p style="margin:0 0 16px;color:#666;font-size:13px">`,
    `${escapeHtml(report.generated)} · ${report.counts.critical} critical, ${report.counts.warn} warning, `,
    `${report.counts.ok} clean of ${report.counts.total}</p>`,
  ];

  for (const project of affected) {
    parts.push(
      `<h3 style="margin:18px 0 6px">${escapeHtml(project.name)} `,
      `<span style="font-weight:400;color:#888">${escapeHtml(project.project)}</span></h3>`,
      `<ul style="margin:0;padding-left:18px">`
    );
    for (const finding of project.findings) {
      const color = LEVEL_COLOR[finding.level] || "#333";
      const tag = isNew(finding)
        ? `<strong style="color:${color}">NEW</strong> `
        : `<span style="color:#999">ongoing</span> `;
      parts.push(
        `<li style="margin:3px 0">${tag}<span style="color:${color}">${escapeHtml(finding.kind)}</span> — ${escapeHtml(finding.text)}</li>`
      );
    }
    parts.push("</ul>");

    if (project.errorTruncated) {
      parts.push(
        `<p style="margin:6px 0;color:#b45309;font-size:13px">Error log hit the 1000-entry cap — the real count is higher.</p>`
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
 * Sends only when there is something new. Returns the keys that were mailed,
 * which the caller records so the next run can diff against them.
 */
async function notifyIfNew(report, previousKeys, { to = null, dashboardUrl = null } = {}) {
  const keys = newKeys(report, previousKeys);
  if (!keys.length) return { sent: false, keys: [] };

  await sendOwnerEmail({
    subject: subjectFor(report, keys),
    html: renderEmail(report, keys, dashboardUrl),
    to,
  });
  return { sent: true, keys };
}

module.exports = { notifyIfNew, newKeys, renderEmail, subjectFor };
