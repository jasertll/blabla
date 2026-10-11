"use client";

import { motion } from "framer-motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";
import type { ReactNode } from "react";

// Shared enter/exit treatment for every tool panel (app/page.tsx) —
// replaces what used to be ~15 duplicated <motion.div> blocks, each doing
// nothing but a flat opacity fade. That flat fade, combined with the
// parent AnimatePresence running in `mode="wait"`, was the confirmed
// root cause of tool switches reading as "dead"/"not smooth": `wait` makes
// the incoming panel wait for the outgoing one to fully finish exiting
// before it's even allowed to start, which on an opacity-only fade shows
// up as a blank content area for a beat. The parent now runs
// AnimatePresence in its default (simultaneous) mode, so the incoming
// panel starts animating in immediately.
//
// The enter/exit deltas are deliberately asymmetric so the switch reads
// as a camera push through the old panel into the new one, not a
// crossfade: the incoming panel starts noticeably smaller/further back
// and pulls into focus (a "dolly in"), while the outgoing panel keeps
// travelling forward past the viewer — it grows past 100% and blurs out,
// rather than just shrinking back down the way it came in. That forward-
// only motion on both ends is what sells "moving through a scene" instead
// of "two static states fading into each other."
//
// First pass here (0.94 scale / 10px blur / 0.46s) read as basically
// invisible in real use — good in an isolated screenshot, not enough
// against a busy, animated background. This pass is deliberately much
// more assertive: bigger scale swing, a slight rotation on top of the
// push (a true camera can't dolly perfectly straight, and that tiny
// tilt is what makes it read as camera movement instead of a resize),
// and a longer hold so the eye actually registers it mid-flight.
const EASE = [0.16, 1, 0.3, 1] as const; // expo-out: fast start, soft landing — "snapping into focus"

export default function ToolTransition({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const reduceMotion = useSafeReducedMotion();

  if (reduceMotion) {
    // No blur/scale/drift at all — just present, per prefers-reduced-motion,
    // matching every other motion-bearing effect already in this codebase.
    return (
      <motion.div key={id} initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 1 }} className={className}>
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      key={id}
      initial={{ opacity: 0, y: 60, scale: 0.82, rotate: -1.4, filter: "blur(18px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, rotate: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -32, scale: 1.12, rotate: 1.2, filter: "blur(14px)" }}
      transition={{ duration: 0.62, ease: EASE }}
      style={{ transformOrigin: "center top" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
