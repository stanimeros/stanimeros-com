const { google } = require("googleapis");
const { TIME_ZONE, BOOKING_START_HOUR, BOOKING_END_HOUR, BOOKING_DURATION_MINUTES } = require("./gemini");

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";

function offsetForZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(
    date
  );
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  return tzName.replace("GMT", "") || "+00:00";
}

// The model is instructed to always include a UTC offset, but if it slips and
// sends a bare local datetime (e.g. "2026-07-30T15:00:00"), Google's calendar
// API rejects it outright — RFC3339 requires an offset, and there's no
// well-defined default. A bare datetime from the visitor's chat means
// wall-clock time in TIME_ZONE, so resolve it that way instead of failing the
// whole tool call. Greece observes DST, so the offset isn't fixed — it's
// computed per-date rather than hardcoded.
function ensureOffset(dateTimeString) {
  if (/(Z|[+-]\d{2}:\d{2})$/.test(dateTimeString)) return dateTimeString;
  const approx = new Date(`${dateTimeString}Z`);
  return `${dateTimeString}${offsetForZone(approx, TIME_ZONE)}`;
}

// Business hours, enforced server-side rather than trusted to the model —
// this is the hard guarantee, the system instruction (see lib/gemini.js,
// which owns these constants) is just what steers the model toward
// proposing valid slots in the first place.
const BOOKING_DAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

function localPartsInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { weekday: byType.weekday, hour: Number(byType.hour), minute: Number(byType.minute) };
}

// Shared by both tools: does `start` fall on a bookable day, within business
// hours, with enough room before closing for a full BOOKING_DURATION_MINUTES
// slot? Throws (never silently clamps) so the caller sees exactly what was
// wrong — callers feed the message back to the model as a tool error so it
// can propose a valid slot instead.
function assertBookableStart(start) {
  const { weekday, hour, minute } = localPartsInZone(start, TIME_ZONE);
  if (!BOOKING_DAYS.has(weekday)) {
    throw new Error(`Bookings are only available Monday–Friday (requested day was ${weekday}).`);
  }

  const startMinutes = hour * 60 + minute;
  const windowStartMinutes = BOOKING_START_HOUR * 60;
  const windowLastStartMinutes = BOOKING_END_HOUR * 60 - BOOKING_DURATION_MINUTES;
  if (startMinutes < windowStartMinutes || startMinutes > windowLastStartMinutes) {
    throw new Error(
      `Bookings are only available between ${BOOKING_START_HOUR}:00 and ${BOOKING_END_HOUR}:00 (${TIME_ZONE}); requested start was ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}.`
    );
  }
}

// checkAvailability takes an explicit window from the model, but it's only
// ever meant to probe a single candidate slot — the tool description and
// system instruction (lib/gemini.js) tell the model to pass exactly
// BOOKING_DURATION_MINUTES, and this enforces it server-side.
function assertBookableWindow(startTime, endTime) {
  const start = new Date(ensureOffset(startTime));
  const end = new Date(ensureOffset(endTime));
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

  if (durationMinutes !== BOOKING_DURATION_MINUTES) {
    throw new Error(
      `Calls are exactly ${BOOKING_DURATION_MINUTES} minutes long — the requested window was ${durationMinutes} minutes.`
    );
  }

  assertBookableStart(start);
}

function getCalendarClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    // Narrowest scopes that cover our two operations: read busy/free time and
    // create/read events. Deliberately excludes the broad `calendar` scope,
    // which would also allow creating/deleting calendars and changing sharing.
    scopes: [
      "https://www.googleapis.com/auth/calendar.freebusy",
      "https://www.googleapis.com/auth/calendar.events",
    ],
  });
  return google.calendar({ version: "v3", auth });
}

// Only ever returns busy time ranges — the freebusy API has no concept of
// event titles/descriptions/attendees, so this cannot leak calendar content.
async function checkAvailability(startTime, endTime) {
  assertBookableWindow(startTime, endTime);
  const calendar = getCalendarClient();
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: ensureOffset(startTime),
      timeMax: ensureOffset(endTime),
      items: [{ id: CALENDAR_ID }],
    },
  });
  const busy = res.data.calendars?.[CALENDAR_ID]?.busy ?? [];
  return { busy };
}

// Only ever inserts a new event — there is deliberately no update/delete/list
// exposed here, so this is the sole write path onto the calendar.
//
// Note: a bare service account (no Workspace domain-wide delegation, which only
// applies to Google Workspace accounts, not personal Gmail) cannot add attendees
// to events — Google rejects it. So the visitor's name/email/purpose go in the
// event description instead of as a calendar invite; the visitor is notified via
// our own confirmation email (see functions/index.js), not a Calendar invite.
async function createBooking({ name, email, purpose, startTime, chatSummary }) {
  const start = new Date(ensureOffset(startTime));
  assertBookableStart(start);
  const endTime = new Date(start.getTime() + BOOKING_DURATION_MINUTES * 60000).toISOString();

  const calendar = getCalendarClient();

  // Never trust the model's earlier checkAvailability call alone — it may have
  // misread the response, skipped the check, or the slot may have been taken
  // by a concurrent booking since. Re-verify free/busy right here, server-side,
  // as the last word before writing to the calendar.
  const freebusy = await calendar.freebusy.query({
    requestBody: {
      timeMin: ensureOffset(startTime),
      timeMax: ensureOffset(endTime),
      items: [{ id: CALENDAR_ID }],
    },
  });
  const busy = freebusy.data.calendars?.[CALENDAR_ID]?.busy ?? [];
  if (busy.length > 0) {
    throw new Error("That time is no longer available — please propose a different slot.");
  }

  const res = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary: `Call: ${name}`,
      description: `Visitor: ${name} <${email}>\n\n${purpose}${chatSummary ? `\n\n--- Chat transcript ---\n${chatSummary}` : ""}`,
      start: { dateTime: ensureOffset(startTime) },
      end: { dateTime: ensureOffset(endTime) },
    },
  });
  return { eventId: res.data.id, htmlLink: res.data.htmlLink };
}

module.exports = { checkAvailability, createBooking, ensureOffset, assertBookableWindow, assertBookableStart };
