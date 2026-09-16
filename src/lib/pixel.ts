export interface FbqFunction {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: FbqFunction;
  loaded: boolean;
  version: string;
}

declare global {
  interface Window {
    fbq: FbqFunction;
    _fbq: FbqFunction;
  }
}

const PIXEL_ID = "718526331177155";

export function initPixel() {
  if (typeof window === "undefined" || window.fbq) return;

  const fbq = ((...args: unknown[]) => {
    if (fbq.callMethod) {
      fbq.callMethod(...args);
    } else {
      fbq.queue.push(args);
    }
  }) as FbqFunction;
  fbq.queue = [];
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.push = fbq;

  window.fbq = fbq;
  window._fbq = window._fbq || fbq;

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  const firstScript = document.getElementsByTagName("script")[0];
  firstScript.parentNode?.insertBefore(script, firstScript);

  window.fbq("init", PIXEL_ID);
  window.fbq("track", "PageView");
}
