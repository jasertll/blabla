// The investigation tools call `/api/...` routes. On a real deployment those
// are served by this same app. A static copy (the private artifact) has no
// server, so it can point those calls at a deployed copy instead: set in
// Settings, or baked in with `window.__API_BASE`.

const KEY = "brookhaven.api";

export function getApiBase(): string {
  if (typeof window === "undefined") return "";
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
  } catch {
    /* storage unavailable */
  }
  return (window as unknown as { __API_BASE?: string }).__API_BASE ?? "";
}

export function setApiBase(url: string) {
  const clean = url.trim().replace(/\/+$/, "");
  try {
    if (clean) localStorage.setItem(KEY, clean);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

let installed = false;

export function installApiBase() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const base = getApiBase();
    if (base && typeof input === "string" && input.startsWith("/api/")) return original(base + input, init);
    return original(input, init);
  };
}

/** True when this page has no server of its own (static build). */
export const isStatic = () => typeof window !== "undefined" && !!(window as unknown as { __B64_ASSETS?: boolean }).__B64_ASSETS;
