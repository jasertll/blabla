import { useEffect, useState } from "react";

// Shared "expand this panel to fill the whole viewport" toggle, used by
// ThreatGlobe and SatelliteTracker so their 3D scenes are easier to watch
// closely. Escape exits it; toggling also nudges any embedded canvas/WebGL
// renderer that only recomputes its size on the window "resize" event,
// since a CSS-only size change (fixed inset-0) doesn't fire one on its own.
export function useMaximizePanel() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMaximized(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    return () => clearTimeout(t);
  }, [maximized]);

  return { maximized, toggleMaximized: () => setMaximized((v) => !v) };
}
