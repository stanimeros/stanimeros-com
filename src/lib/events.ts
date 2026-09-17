const eventMap = {
  pageView: {
    fbq: "PageView",
    firebase: null, // skip sending to Firebase
  },
  beginCheckout: {
    fbq: "InitiateCheckout",
    firebase: "begin_checkout",
  },
  packageSelected: {
    fbq: "ViewContent",
    firebase: "view_item",
  },
  ctaClick: {
    fbq: "ViewContent",
    firebase: "select_content",
  },
};

// `window.fbq` is declared once, in ./pixel — a second `declare global` here
// only risks the two drifting apart.
import "./pixel";

export const trackEvent = (
  eventKey: keyof typeof eventMap,
  data?: Record<string, unknown>
) => {
  const mapping = eventMap[eventKey];

  if (typeof window !== 'undefined' && window.fbq && mapping.fbq) {
    window.fbq('track', mapping.fbq, data);
  }

  if (mapping.firebase) {
    // Loaded lazily: firebase/analytics shouldn't be part of the initial
    // hydration bundle just for an event tracker most events skip anyway.
    Promise.all([import("firebase/analytics"), import("./firebase")])
      .then(([{ logEvent }, { initAnalytics }]) => initAnalytics().then(analytics => logEvent(analytics, mapping.firebase as string, data)))
      .catch(() => {
        // analytics not initialized (no consent)
      });
  }
};