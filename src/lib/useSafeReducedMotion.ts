"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * A hydration-safe replacement for framer-motion's own `useReducedMotion`.
 *
 * The framer-motion hook reads `window.matchMedia` synchronously on the
 * very first client render — but the server has no `window` at all, so
 * it necessarily renders as if reduced-motion were off. On any real
 * device with the OS-level "Reduce Motion" preference on, that means the
 * very first client render already disagrees with what the server sent,
 * which is a guaranteed hydration mismatch for every component that
 * renders different markup (not just different animation props) based
 * on this value — several components here do (KineticTitle falls back
 * to fully static markup, ToolVideoMoments used to bail out of rendering
 * entirely, etc.). React's response to a hydration mismatch is to throw
 * away the server-rendered page and redo the whole tree client-side,
 * which is slow, causes a visible flash, and can leave mount-order-
 * dependent effects (audio engines, video lifecycles, timers) in a
 * broken state — plausibly explaining instability well beyond just
 * "the videos don't play" for anyone with this preference on.
 *
 * This returns `false` (matching what the server always assumes) until
 * the component has actually mounted on the client, then switches to
 * the real value — same end result, just deferred one tick past
 * hydration so the first paint always matches the server's.
 */
export function useSafeReducedMotion(): boolean {
  const real = useReducedMotion();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted ? !!real : false;
}
