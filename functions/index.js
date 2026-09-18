const { setGlobalOptions } = require("firebase-functions");
const { onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");

const { sendOwnerEmail, escapeHtml } = require("./lib/mailer");
const { ai, tools, buildSystemInstruction, MODEL } = require("./lib/gemini");
const { checkAvailability, createBooking } = require("./lib/calendar");
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

// System health checker (healthCheck, runHealthCheckNow, reportClientError)
// moved to health/functions -- a separate Cloud Functions codebase deployed
// independently of this one. See health/functions/index.js.

// Pure helpers, exported for unit testing only — not part of the deployed
// function surface (Firebase only deploys the `exports.<name>` onCall/onSchedule
// entries above).
exports._internal = { formatTranscript, toGeminiContents, runTool };
