"use client";

import { useEffect, useRef } from "react";
import { useInvestigation } from "@/contexts/InvestigationContext";
import { otherworldEvent } from "../actions";
import { toolById, toolByRef } from "../config/rooms.config";
import { useGame } from "../store";

/** Keeps the hospital and the tools' shared context in step:
 *  - entering a room makes its tool the active one;
 *  - a tool handing off to another moves you to that instrument;
 *  - a tool raising a high-risk alert tears the world into the Otherworld. */
export function ToolBridge() {
  const inv = useInvestigation();
  const activeTool = useGame((s) => s.activeTool);
  const lastRef = useRef(inv.activeTool);
  const alertsSeen = useRef(new Set<string>());

  // room → context
  useEffect(() => {
    const t = activeTool ? toolById(activeTool) : null;
    if (t && inv.activeTool !== t.ref) {
      lastRef.current = t.ref;
      inv.setActiveTool(t.ref);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  // context → room (handoffs between tools)
  useEffect(() => {
    if (inv.activeTool === lastRef.current) return;
    lastRef.current = inv.activeTool;
    const g = useGame.getState();
    const target = toolByRef(inv.activeTool);
    if (!target || !g.activeTool || target.id === g.activeTool) return;
    g.say(`The file is carried to ${target.room === "???" ? "somewhere else" : `room ${target.room}`}.`);
    g.openTool(target.id);
    g.showTool();
  }, [inv.activeTool]);

  // high-risk findings → the siren
  useEffect(() => {
    for (const [tool, on] of Object.entries(inv.toolAlerts)) {
      if (on && !alertsSeen.current.has(tool)) {
        alertsSeen.current.add(tool);
        otherworldEvent(30);
      }
      if (!on) alertsSeen.current.delete(tool);
    }
  }, [inv.toolAlerts]);

  return null;
}
