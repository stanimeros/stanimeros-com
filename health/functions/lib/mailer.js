// Sends the site owner's transactional email via UniOne
// (https://unione.io) instead of Gmail SMTP with an app password -- Gmail
// increasingly throttles/flags automated sending from a personal account,
// UniOne is a real transactional-email provider with its own domain auth
// (SPF/DKIM) for hello@stanimeros.com.
//
// Same sendOwnerEmail({ subject, html, to }) contract as the Gmail version
// it replaces, so notify.js needed zero changes.
//
// Requires UNIONE_API_KEY in .env.

const UNIONE_BASE = "https://api.unione.io/en/transactional/api/v1";
const FROM_EMAIL = "hello@stanimeros.com";
const FROM_NAME = "stanimeros.com";
// Where mail actually lands when a caller doesn't pass its own `to` --
// separate from FROM_EMAIL on purpose: that one has to be the verified
// sending domain, this one is just wherever the owner actually reads mail.
const OWNER_EMAIL = "pantelisstanimeros@gmail.com";

// Escapes visitor-supplied text before it's interpolated into an email's HTML —
// without this, a visitor could submit a contact form or chat message containing
// live HTML/links that render in the owner's inbox.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Single place that actually sends mail to the site owner — used by both the
// contact form and the chat summary emails so there's one delivery path to reason about.
// `to` defaults to OWNER_EMAIL; the health checker passes HEALTH_EMAIL_TO
// explicitly (see health/functions/.env) rather than relying on that default.
//
// Throws on failure rather than swallowing -- same contract the Gmail
// version had (an unawaited transporter.sendMail rejection propagated to
// the caller), so a send failure still surfaces as a real error to
// whichever caller's own try/catch (or lack of one) already expects it.
async function sendOwnerEmail({ subject, html, to = null }) {
  const apiKey = process.env.UNIONE_API_KEY;
  if (!apiKey) {
    throw new Error("sendOwnerEmail: UNIONE_API_KEY is not configured");
  }

  const res = await fetch(`${UNIONE_BASE}/email/send.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({
      message: {
        recipients: [{ email: to || OWNER_EMAIL }],
        subject,
        from_email: FROM_EMAIL,
        from_name: FROM_NAME,
        body: { html, plaintext: html.replace(/<[^>]+>/g, "") },
      },
    }),
  });

  const data = /** @type {{status?: string, code?: string, message?: string}} */ (
    await res.json().catch(() => ({}))
  );
  if (data.status !== "success") {
    throw new Error(`UniOne send failed: ${data.code || res.status} ${data.message || res.statusText}`);
  }
}

module.exports = { sendOwnerEmail, escapeHtml };
