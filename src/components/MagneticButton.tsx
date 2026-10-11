"use client";

import { useRef } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";
import type { ReactNode } from "react";

// Cursor-attraction hover: the button visually leans toward the pointer
// as it approaches/moves within its own bounds, then springs back to rest
// on mouseleave. Deliberately applied only to the couple of true primary
// actions (Ribbon's brand mark and its search submit) rather than every
// clickable thing on the page — on a dashboard with hundreds of buttons
// (nav items, filter chips, table rows), giving all of them a magnetic
// pull would turn a nice accent into constant visual noise. This is for
// the handful of moments that are meant to feel like "the one button that
// matters right now."
export default function MagneticButton({ children, className, strength = 0.35 }: { children: ReactNode; className?: string; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useSafeReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 200, damping: 18, mass: 0.4 });
  const springY = useSpring(y, { stiffness: 200, damping: 18, mass: 0.4 });

  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = e.clientX - (rect.left + rect.width / 2);
    const relY = e.clientY - (rect.top + rect.height / 2);
    x.set(relX * strength);
    y.set(relY * strength);
  }

  function handleLeave() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      style={{ x: springX, y: springY }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
