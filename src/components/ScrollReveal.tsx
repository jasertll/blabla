"use client";

import { motion } from "framer-motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";
import type { ReactNode } from "react";

// The "scroll down and discover" beat requested for the Overview page —
// each stacked section rises into focus as it actually enters the
// viewport, instead of every panel just being present from the first
// frame. `viewport={{ once: true }}` is deliberate: this is a dashboard
// people revisit constantly, not a marketing page, so panels should only
// perform their entrance once per visit and then just sit there — no
// replay-on-rescroll gimmick to get in the way of real work.
const EASE = [0.16, 1, 0.3, 1] as const;

export default function ScrollReveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduceMotion = useSafeReducedMotion();

  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 40, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-10% 0px -10% 0px" }}
      transition={{ duration: 0.6, ease: EASE, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
