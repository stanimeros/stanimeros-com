// Runs the health sweep locally against real GCP data, for tuning thresholds
// or looking at what a finding is actually seeing, without touching Firestore
// or sending mail — buildReport() (unlike runHealthCheck) does neither.
//
// Auth: uses your own `gcloud auth application-default login`, same as
// auth.js already assumes for local runs (see its top comment) — no service
// account key needed. Since that's usually a much broader identity than
// health-checker@stanimeros-dev holds in production, an IAM/API-keys finding
// that shows up here can still 403 in the real sweep until
// scripts/health-iam.sh's grant has been applied for that project.
//
// Usage:
//   node scripts/health-report.js                     summary, every project
//   node scripts/health-report.js nourea,chronal       summary, just these
//   node scripts/health-report.js --json               full report as JSON
//   node scripts/health-report.js nourea --json         one project, full JSON
//
// Not deployed — see firebase.json functions.ignore.

require("dotenv").config({ quiet: true });
const { buildReport } = require("../lib/health");
const { PROJECTS } = require("../lib/health/config");

function parseArgs(argv) {
  const json = argv.includes("--json");
  const idList = argv.find((a) => a !== "--json");
  const ids = idList ? idList.split(",").map((s) => s.trim()) : null;
  return { json, ids };
}

function printSummary(report) {
  console.log(
    `\n${report.status.toUpperCase()} — ${report.counts.critical} critical, ${report.counts.warn} warn, ` +
      `${report.counts.ok} clean of ${report.counts.total} (${report.durationMs}ms)\n`
  );

  for (const project of report.projects) {
    const tag = project.status === "ok" ? "OK   " : project.status === "warn" ? "WARN " : "CRIT ";
    console.log(`${tag} ${project.name} (${project.project})`);
    for (const finding of project.findings) {
      console.log(`       [${finding.level}] ${finding.kind}: ${finding.text}`);
    }
  }

  if (report.projectErrors.length) {
    console.log(`\nNot checked:`);
    for (const failure of report.projectErrors) {
      console.log(`  ${failure.project} (${failure.stage}) — ${failure.error}`);
    }
  }
}

async function main() {
  const { json, ids } = parseArgs(process.argv.slice(2));
  const projects = ids ? PROJECTS.filter((p) => ids.includes(p.id)) : PROJECTS;

  if (ids) {
    const missing = ids.filter((id) => !projects.some((p) => p.id === id));
    if (missing.length) {
      console.error(`Unknown project id(s): ${missing.join(", ")}`);
      console.error(`Known ids: ${PROJECTS.map((p) => p.id).join(", ")}`);
      process.exit(1);
    }
  }

  const report = await buildReport({ mode: "manual", projects });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSummary(report);
  }
}

main().catch((err) => {
  console.error("FAILED:", err.stack || err.message || err);
  process.exit(1);
});
