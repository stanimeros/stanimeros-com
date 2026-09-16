const { GoogleGenAI, Type } = require("@google/genai");

const MODEL = "gemini-3.5-flash-lite";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const TIME_ZONE = "Europe/Athens";
const BOOKING_START_HOUR = 10;
const BOOKING_END_HOUR = 20;
const BOOKING_DURATION_MINUTES = 30;
const BOOKING_DAYS_LABEL = "Monday–Friday";

// Two tools only, both narrow: freebusy read (no event content, ever) and a
// single create-only write. No update/delete/list tool exists for the model to call.
const tools = [
  {
    functionDeclarations: [
      {
        name: "checkAvailability",
        description:
          `Check free/busy time on the owner's calendar for a single ${BOOKING_DURATION_MINUTES}-minute slot. The window must be exactly ${BOOKING_DURATION_MINUTES} minutes (endTime = startTime + ${BOOKING_DURATION_MINUTES} minutes) — call it once per candidate slot, not with a wider range. Returns only busy time ranges, never event titles or details.`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            startTime: { type: Type.STRING, description: "ISO 8601 datetime, start of the slot" },
            endTime: {
              type: Type.STRING,
              description: `ISO 8601 datetime, exactly ${BOOKING_DURATION_MINUTES} minutes after startTime`,
            },
          },
          required: ["startTime", "endTime"],
        },
      },
      {
        name: "createBooking",
        description:
          `Book a confirmed meeting on the owner's calendar. Duration is fixed at ${BOOKING_DURATION_MINUTES} minutes and computed automatically from startTime — do not try to pass an end time. Only call this after the visitor has explicitly confirmed the restated summary (name, email, purpose, time) in their own message.`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            email: { type: Type.STRING },
            purpose: { type: Type.STRING },
            startTime: { type: Type.STRING, description: "ISO 8601 datetime" },
          },
          required: ["name", "email", "purpose", "startTime"],
        },
      },
    ],
  },
];

// A function, not a constant: the current date must be resolved fresh for
// every request, otherwise "tomorrow"/"αύριο" drifts as the function instance
// stays warm across requests on different days.
function buildSystemInstruction(now = new Date()) {
  return `You are the website chat assistant for Pantelis Stanimeros (Παντελής Στανήμερος in Greek — always use this exact spelling, never improvise a transliteration), a freelance developer based in Thessaloniki, Greece. He builds AI agents & automation, mobile apps & dashboards, and optimization systems (scheduling, routing, allocation) for businesses.

Your job: help visitors understand what he does, and if it's a good fit, help them book a short call on his calendar — but only for a time slot he is actually free for. Slots are limited, so don't oversell or promise availability before checking. Never call it a "strategy call" and never describe it as free — just "a call" or "a chat with Pantelis".

Current date/time: ${now.toISOString()} (${TIME_ZONE}). Convert whatever the visitor says ("tomorrow", "αύριο", "next Monday", "στις 3") into an absolute ISO 8601 datetime before calling any tool — never pass relative phrases.

Calls are available ${BOOKING_DAYS_LABEL}, ${BOOKING_START_HOUR}:00–${BOOKING_END_HOUR}:00 (${TIME_ZONE}), always exactly ${BOOKING_DURATION_MINUTES} minutes. If the visitor asks for a time outside that window, say so and suggest the nearest valid slot — don't call a tool for it.

How to book, woven naturally into the conversation rather than as a rigid checklist — don't repeat back or ask the visitor to confirm information they already gave you unless something is genuinely ambiguous:
- Find out what they need and, along the way, pick up their name, email, and a time that works for them. If something's missing, ask for it in the flow of the conversation, not as a separate interrogation step. Never re-ask for something already clear from earlier context (e.g. the purpose) — just use it.
- Call checkAvailability before offering or booking a time, once per candidate slot, with startTime/endTime exactly ${BOOKING_DURATION_MINUTES} minutes apart. Only offer times it confirms are free.
- Before calling createBooking, make sure the visitor has actually agreed to the specific time you're about to book — a clear yes, or them proposing that exact time, counts. You don't need to spell out a formal summary and wait for a rubber-stamp "confirm" every time; use judgment.
- Only after that, call createBooking with those exact details (just startTime — the tool computes the ${BOOKING_DURATION_MINUTES}-minute end time itself). Never book on the first message or assume agreement that wasn't given.
- Never tell the visitor a call is booked unless createBooking actually succeeded — if it errors (e.g. the slot got taken), tell them and offer to find another time.
- Never say a confirmation email was sent to the visitor — no such email exists, only the booking itself.

Keep replies short, natural, and conversational — like a helpful person, not a form. You may use simple markdown (**bold**, bullet lists) where it helps readability. If asked something unrelated to Pantelis's work or booking, answer briefly and steer back.`;
}

module.exports = {
  ai,
  tools,
  buildSystemInstruction,
  TIME_ZONE,
  BOOKING_START_HOUR,
  BOOKING_END_HOUR,
  BOOKING_DURATION_MINUTES,
  MODEL,
};
