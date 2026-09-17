const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");

const { sendOwnerEmail, escapeHtml } = require("./lib/mailer");
const { ai, tools, buildSystemInstruction, MODEL } = require("./lib/gemini");
const { checkAvailability, createBooking } = require("./lib/calendar");
const { runHealthCheck, buildReport, REPORTS } = require("./lib/health");
const { FINDINGS, docIdFor } = require("./lib/health/lifecycle");
const { isoSecond } = require("./lib/health/config");
const {
  appendMessage,
  getHistory,
  markBooked,
  markReported,
  getSessionsToReport,
} = require("./lib/firestoreChat");

setGlobalOptions({ maxInstances: 10, region: "europe-west1" });

// How long a conversation must sit quiet before we email about it — bookings
// skip this entirely and get their own email immediately (see sendBookingEmail).
const CONVERSATION_REPORT_DELAY_MINUTES = 30;
const MAX_TOOL_ROUNDS = 3;
const MAX_MESSAGE_LENGTH = 2000;

// Form submission (contact form / package inquiries).
exports.sendEmail = onCall({ enforceAppCheck: true }, async (request) => {
  try {
    const { name, email, message, subject } = request.data;

    if (!name || !email || !message || !subject) {
      throw new Error("Missing required fields");
    }

    await sendOwnerEmail({
      subject,
      html: `
        <h2>${escapeHtml(subject)}</h2>
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
        <hr>
        <p><em>Sent from your website contact form</em></p>
      `,
    });

    logger.info("Form submission email sent", { name, email });
    return { success: true, message: "Email sent successfully" };
  } catch (error) {
    logger.error("Error sending form submission email", error);
    throw new Error("Failed to send email");
  }
});

function formatTranscript(messages) {
  return messages
    .map((m) => `${m.role === "user" ? "Visitor" : "Agent"}: ${escapeHtml(m.text)}`)
    .join("\n");
}

function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// Sent immediately when a booking is confirmed, so the owner finds out as
// soon as it happens rather than waiting for the conversation to go quiet.
async function sendBookingEmail({ name, email, purpose, startTime, htmlLink, history }) {
  const subject = `New booking: ${name}`;

  await sendOwnerEmail({
    subject,
    html: `
      <h2>${escapeHtml(subject)}</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Purpose:</strong> ${escapeHtml(purpose)}</p>
      <p><strong>When:</strong> ${escapeHtml(startTime)}</p>
      ${htmlLink ? `<p><a href="${htmlLink}">View in Google Calendar</a></p>` : ""}
      <hr>
      <pre style="white-space: pre-wrap; font-family: inherit;">${formatTranscript(history)}</pre>
    `,
  });
}

// Sent per-conversation, once it's been quiet for CONVERSATION_REPORT_DELAY_MINUTES,
// for conversations that did NOT end in a booking (booked ones already got an
// email immediately and are marked reported right away, so they don't reach here
// under normal operation).
async function sendConversationEmail({ id, history, booked, durationMs }) {
  const subject = booked
    ? `Conversation ended — booked (${formatDuration(durationMs)})`
    : `Conversation ended — no booking (${formatDuration(durationMs)})`;

  await sendOwnerEmail({
    subject,
    html: `
      <h2>${escapeHtml(subject)}</h2>
      <p><strong>Session:</strong> ${escapeHtml(id)}</p>
      <p><strong>Duration:</strong> ${escapeHtml(formatDuration(durationMs))} · <strong>Messages:</strong> ${history.length}</p>
      <hr>
      <pre style="white-space: pre-wrap; font-family: inherit;">${formatTranscript(history)}</pre>
    `,
  });
}

function toGeminiContents(messages) {
  return messages.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.text }],
  }));
}

// Errors are caught and returned as a tool result (never thrown) so a bad
// call — e.g. a malformed date the model produced — becomes something the
// model can recover from ("that time didn't work, try another") instead of
// aborting the whole turn with a generic failure.
async function runTool(call, deps = { checkAvailability, createBooking }, chatSummary) {
  try {
    if (call.name === "checkAvailability") {
      return await deps.checkAvailability(call.args.startTime, call.args.endTime);
    }
    if (call.name === "createBooking") {
      return await deps.createBooking({ ...call.args, chatSummary });
    }
    return { error: `Unknown tool: ${call.name}` };
  } catch (error) {
    logger.error(`Tool ${call.name} failed`, error);
    return { error: `Tool ${call.name} failed: ${error.message}` };
  }
}

// Chat agent. One call = one visitor message in, one agent reply out;
// full history lives in Firestore, keyed by the session id the client generated.
exports.geminiChat = onCall({ enforceAppCheck: true }, async (request) => {
  const { sessionId, message } = request.data;

  if (!sessionId || typeof sessionId !== "string") {
    throw new Error("Missing sessionId");
  }
  if (!message || typeof message !== "string" || !message.trim()) {
    throw new Error("Missing message");
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new Error("Message too long");
  }

  try {
    await appendMessage(sessionId, { role: "user", text: message });

    const history = await getHistory(sessionId);
    const contents = toGeminiContents(history);

    const systemInstruction = buildSystemInstruction();

    let response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: { systemInstruction, tools },
    });

    let bookingConfirmed = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const call = response.functionCalls?.[0];
      if (!call) break;

      const result = await runTool(call, undefined, formatTranscript(history));
      if (call.name === "createBooking" && !result.error) {
        bookingConfirmed = true;
        const { name, email, purpose, startTime } = /** @type {any} */ (call.args);
        await sendBookingEmail({ name, email, purpose, startTime, htmlLink: result.htmlLink, history });
      }

      // Push the model's actual returned content, not a hand-built
      // { functionCall } part — the real part also carries a thoughtSignature
      // (gemini-3.x requires it echoed back on the next turn) and any other
      // fields the model attached, which a reconstructed part would drop.
      contents.push(response.candidates[0].content);
      contents.push({
        role: "user",
        parts: [{ functionResponse: { name: call.name, response: result } }],
      });

      response = await ai.models.generateContent({
        model: MODEL,
        contents,
        config: { systemInstruction, tools },
      });
    }

    const reply = response.text ?? "";
    await appendMessage(sessionId, { role: "model", text: reply });

    if (bookingConfirmed) {
      // Mark reported too — the booking email already went out above, so the
      // periodic sweep shouldn't send a second email once this goes quiet.
      await markBooked(sessionId);
      await markReported(sessionId);
    }

    return { reply };
  } catch (error) {
    logger.error("Error in geminiChat", error);
    throw new Error("Failed to get a response from the chat agent");
  }
});

// Runs once a day and emails about each conversation that's been quiet for
// CONVERSATION_REPORT_DELAY_MINUTES and hasn't been reported yet — one email
// per conversation rather than a single bundled digest. Booked conversations
// are normally marked reported immediately (see geminiChat) and so don't
// reach this sweep; it still handles them here as a fallback in case that
// email failed to send.
exports.agentReport = onSchedule(
  { schedule: "0 9 * * *", timeZone: "Europe/Athens" },
  async () => {
    const staleBefore = new Date(Date.now() - CONVERSATION_REPORT_DELAY_MINUTES * 60 * 1000);
    const staleSessions = await getSessionsToReport(staleBefore);

    let reportedCount = 0;
    for (const session of staleSessions) {
      const history = await getHistory(session.id);
      if (history.length > 0) {
        const first = history[0].createdAt?.toMillis?.() ?? Date.now();
        const last = history[history.length - 1].createdAt?.toMillis?.() ?? first;
        await sendConversationEmail({
          id: session.id,
          history,
          booked: !!(/** @type {any} */ (session).booked),
          durationMs: last - first,
        });
        reportedCount += 1;
      }
      await markReported(session.id);
    }

    logger.info(`Agent report covered ${reportedCount} conversation(s)`);
  }
);

// --------------------------------------------------------------------------
// Firebase health checker — see plan.md and docs/health-schema.md
// --------------------------------------------------------------------------

// Only this UID may read health data. Kept server-side rather than in
// firestore.rules so the ruleset stays deny-all with no exception, and the
// allowlist itself is never shipped to the browser.
const HEALTH_UIDS = (process.env.HEALTH_ALLOWED_UIDS || "")
  .split(",")
  .map((uid) => uid.trim())
  .filter(Boolean);

function assertHealthAccess(request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  if (!HEALTH_UIDS.includes(uid)) throw new HttpsError("permission-denied", "Not allowed.");
  return uid;
}

// Runs as health-checker@stanimeros-dev, which holds monitoring.viewer +
// logging.viewer across the estate. Retries are off on purpose: a retried run
// would re-send the alert mail. maxInstances 1 keeps two sweeps from racing to
// write the same state document.
const HEALTH_OPTIONS = {
  serviceAccount: "health-checker@stanimeros-dev.iam.gserviceaccount.com",
  timeoutSeconds: 540,
  memory: /** @type {import("firebase-functions/v2/options").MemoryOption} */ ("512MiB"),
  maxInstances: 1,
};

// Three times through the working day (9am/3pm/9pm Athens), not once a
// day and not overnight: the baseline every metric/entity check compares
// against is a multi-day median (cfg.baselineDays, see monitoring.js
// windowFor) that only moves day to day, so a same-day rerun wouldn't
// change what a spike or stall check is scored against. But the
// rolling-24h "now" window those same checks (including the failure-rate
// check inside analyze.js analyzeMetric / analyzeEntities) are scored
// from, and the log scan's rolling logHours (48h, see config.js) window,
// both shift with every run -- so three sweeps a day catch a live
// incident well before a 24h-old one would age out unseen, without paging
// anyone with a 3am-generated alert. "Run now" on the dashboard still
// covers anything more urgent than a 6h cadence, or anything overnight.
// 9am Athens is the anchor: it gives the UTC day (ends 00:00 UTC = 03:00
// Athens) time to settle in Monitoring before the first sweep reads it.
exports.healthCheck = onSchedule(
  {
    ...HEALTH_OPTIONS,
    schedule: "0 9,15,21 * * *",
    timeZone: "Europe/Athens",
    retryCount: 0,
  },
  async () => {
    const summary = await runHealthCheck({ mode: "scheduled" });
    logger.info("Health sweep complete", summary);
  }
);

// On-demand run from the dashboard.
exports.runHealthCheckNow = onCall(
  { ...HEALTH_OPTIONS, enforceAppCheck: true },
  async (request) => {
    assertHealthAccess(request);
    return runHealthCheck({ mode: "manual" });
  }
);

// Firestore's automatic single-field index for a field isn't provisioned
// until the first document carrying that field is written, so an
// orderBy("runId", ...) query can throw FAILED_PRECONDITION ("requires an
// index") if it races the very first sweep, or if pruneOldReports ever empties
// the collection between the health-schema being deployed and the next run.
// Both are "no reports yet", not a real error.
function isIndexNotReady(err) {
  return err.code === 9 || /FAILED_PRECONDITION/.test(err.message || "");
}

// The dashboard's only data path. Reading through the Admin SDK here is what
// lets firestore.rules stay deny-all — the client never touches Firestore.
exports.getHealthReport = onCall({ enforceAppCheck: true }, async (request) => {
  assertHealthAccess(request);
  const db = admin.firestore();
  const { runId, history } = request.data || {};

  if (history) {
    let snap;
    try {
      snap = await db
        .collection(REPORTS)
        .orderBy("runId", "desc")
        .limit(Math.min(Number(history) || 30, 120))
        .get();
    } catch (err) {
      if (!isIndexNotReady(err)) throw err;
      return { runs: [] };
    }
    // Trend only — sending 30 full reports would be megabytes.
    return {
      runs: snap.docs.map((doc) => {
        const data = doc.data();
        return {
          runId: doc.id,
          generated: data.generated,
          status: data.status,
          counts: data.counts,
          costTotal: data.costTotal,
          findingCount: (data.projects || []).reduce((n, p) => n + p.findings.length, 0),
        };
      }),
    };
  }

  let doc;
  try {
    doc = runId
      ? await db.collection(REPORTS).doc(runId).get()
      : (await db.collection(REPORTS)
          .orderBy("runId", "desc")
          .limit(1)
          .get()).docs[0];
  } catch (err) {
    if (!isIndexNotReady(err)) throw err;
    doc = undefined;
  }

  if (!doc || !doc.exists) throw new HttpsError("not-found", "No report yet.");
  return doc.data();
});

// Lifecycle reads for the dashboard's "is this new / did it clear" view
// (plan.md S1). Filters stay to at most one Firestore-level `where` (on
// `state`) so this never needs a composite index: `since` is applied in
// JS after the read. health_findings is a few hundred docs total, so a
// single-field query plus an in-memory filter is cheaper than it sounds and
// keeps this callable index-free the same way getHealthReport is.
exports.getHealthFindings = onCall({ enforceAppCheck: true }, async (request) => {
  assertHealthAccess(request);
  const db = admin.firestore();
  const { state, since } = request.data || {};

  let query = /** @type {FirebaseFirestore.Query} */ (db.collection(FINDINGS));
  if (state) query = query.where("state", "==", state);

  let snap;
  try {
    snap = await query.get();
  } catch (err) {
    if (!isIndexNotReady(err)) throw err;
    return { findings: [] };
  }

  let findings = snap.docs.map((doc) => doc.data());
  if (since) findings = findings.filter((f) => f.lastSeen >= since);
  return { findings };
});

// Acknowledge (mute) a finding, or clear an existing ack. `until` is an
// optional ISO timestamp; omitted/null means "acked with no expiry" (plan.md
// S1.5 covers the auto-un-ack: an acked finding that escalates warn ->
// critical clears itself on the next sweep regardless of what's stored
// here). Pass `ack: false` to clear an ack early instead of waiting for it
// to expire.
exports.ackFinding = onCall({ enforceAppCheck: true }, async (request) => {
  const uid = assertHealthAccess(request);
  const { key, until = null, ack = true } = request.data || {};
  if (!key || typeof key !== "string") throw new HttpsError("invalid-argument", "Missing key.");

  const db = admin.firestore();
  // Same slash-encoding the sweep writes with -- the UI holds the true key.
  const ref = db.collection(FINDINGS).doc(docIdFor(key));
  const doc = await ref.get();
  if (!doc.exists) throw new HttpsError("not-found", "No such finding.");

  // Only `state` transitions this callable is allowed to make are
  // open/unknown -> acked and acked -> open. Writing `state` unconditionally
  // would let an ack toggle overwrite a `resolved` finding -- clearing an ack
  // on something that has since cleared would mark it open again, and the
  // dashboard would show a fixed problem as live. The ack fields themselves
  // still move either way; only the state is guarded.
  const current = doc.data().state;
  if (ack) {
    const state = current === "open" || current === "unknown" ? "acked" : current;
    await ref.set({ state, ackedUntil: until, ackedBy: uid }, { merge: true });
  } else {
    const state = current === "acked" ? "open" : current;
    await ref.set({ state, ackedUntil: null, ackedBy: null }, { merge: true });
  }
  return { key, acked: !!ack };
});

// Per-viewer "have I seen this" marker (plan.md S1.4). Deliberately only
// ever called explicitly by the user (Mark all as seen, or the frontend's
// own 30s-on-a-later-run heuristic) -- never wire this to page load, or a
// refresh wipes the "since you last visited" window this exists to give.
exports.markHealthSeen = onCall({ enforceAppCheck: true }, async (request) => {
  const uid = assertHealthAccess(request);
  const { runId } = request.data || {};
  if (!runId || typeof runId !== "string") throw new HttpsError("invalid-argument", "Missing runId.");

  const db = admin.firestore();
  await db.collection("health_seen").doc(uid).set({
    lastViewedRunId: runId,
    lastViewedAt: isoSecond(),
  });
  return { ok: true };
});

exports.getHealthSeen = onCall({ enforceAppCheck: true }, async (request) => {
  const uid = assertHealthAccess(request);
  const db = admin.firestore();
  const doc = await db.collection("health_seen").doc(uid).get();
  return doc.exists ? doc.data() : { lastViewedRunId: null, lastViewedAt: null };
});

// Pure helpers, exported for unit testing only — not part of the deployed
// function surface (Firebase only deploys the `exports.<name>` onCall/onSchedule
// entries above).
exports._internal = { formatTranscript, toGeminiContents, runTool, assertHealthAccess, buildReport };
