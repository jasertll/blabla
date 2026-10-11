"use client";

import { useRef } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";
import type { ReactNode } from "react";

// A CSS-only 3D tilt wrapper — the panel leans away from the cursor with
// real perspective as the pointer moves across it, and springs back flat
// on mouseleave. Deliberately implemented as a plain transform on an
// outer wrapper div rather than touching anything inside the 3D scenes
// it wraps (ThreatGlobe, SatelliteTracker): those are large, already-tuned
// Three.js components, and the one hard rule for this whole design pass
// is that the tools keep working. Wrapping them in a tilt container adds
// the "spatial, alive" read the brief asks for with zero risk to the
// WebGL rendering underneath — the canvas itself is untouched.
export default function Tilt3D({ children, className, maxDeg = 6 }: { children: ReactNode; className?: string; maxDeg?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useSafeReducedMotion();
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const springRx = useSpring(rx, { stiffness: 150, damping: 20, mass: 0.5 });
  const springRy = useSpring(ry, { stiffness: 150, damping: 20, mass: 0.5 });

  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    ry.set(px * maxDeg * 2);
    rx.set(-py * maxDeg * 2);
  }

  function handleLeave() {
    rx.set(0);
    ry.set(0);
  }

  return (
    <div style={{ perspective: 1400 }} className={className}>
      <motion.div
        ref={ref}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        style={{ rotateX: springRx, rotateY: springRy, transformStyle: "preserve-3d" }}
        className="h-full w-full"
      >
        {children}
      </motion.div>
    </div>
  );
}
