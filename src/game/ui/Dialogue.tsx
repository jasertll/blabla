"use client";

import { useEffect, useState } from "react";
import { audio } from "../audio";
import { DIALOGUE } from "../config/dialogue";
import { runtime, useGame } from "../store";
import { dialogueClock } from "../scene/People";

/** A conversation: letterbox bars, the line being spoken, then your choices. */
export function DialogueOverlay() {
  const d = useGame((s) => s.dialogue);
  const [shown, setShown] = useState(0);
  const script = d ? DIALOGUE[d.id] : null;
  const node = script && d ? script.nodes[d.node] : null;
  const line = node && d ? node.lines[d.line] : null;
  const atChoices = !!node && !!d && d.line >= node.lines.length;

  // reveal the line a few letters at a time
  useEffect(() => {
    setShown(0);
    if (!line) return;
    const id = window.setInterval(() => setShown((n) => (n >= line.text.length ? n : n + 2)), 22);
    return () => window.clearInterval(id);
  }, [line]);

  useEffect(() => {
    if (node?.set && d?.line === 0) useGame.getState().flag(node.set);
  }, [node, d?.line]);

  const end = () => {
    const g = useGame.getState();
    runtime.focus = null;
    dialogueClock.endedAt = performance.now();
    g.setDialogue(null);
    g.setOverlay(null);
  };

  const goto = (next: string) => {
    const g = useGame.getState();
    if (!d || !script) return;
    g.setDialogue({ id: d.id, node: next, line: 0 });
    const first = script.nodes[next]?.lines[0];
    if (first?.who === "npc") audio.voice(Math.max(1.4, first.text.length * 0.05), script.pitch);
  };

  const advance = () => {
    if (!d || !node || !script || !line) return;
    if (shown < line.text.length) {
      setShown(line.text.length);
      return;
    }
    const nextLine = d.line + 1;
    if (nextLine < node.lines.length) {
      useGame.getState().setDialogue({ ...d, line: nextLine });
      const l = node.lines[nextLine];
      if (l.who === "npc") audio.voice(Math.max(1.4, l.text.length * 0.05), script.pitch);
      return;
    }
    if (node.choices) useGame.getState().setDialogue({ ...d, line: nextLine });
    else if (node.next) goto(node.next);
    else end();
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!node) return;
      if (atChoices && node.choices) {
        const n = Number(e.key);
        if (n >= 1 && n <= node.choices.length) goto(node.choices[n - 1].next);
        return;
      }
      if (["KeyE", "Space", "Enter"].includes(e.code)) {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (!d || !script || !node) return null;
  const speaker = line?.who === "you" ? "YOU" : script.name;
  return (
    <div className="pointer-events-auto absolute inset-0 z-30 select-none" onClick={() => !atChoices && advance()}>
      <div className="bars-in absolute inset-x-0 top-0 h-[11vh] bg-black" />
      <div className="bars-in absolute inset-x-0 bottom-0 h-[11vh] bg-black" />
      <div className="absolute inset-x-0 bottom-[13vh] flex justify-center px-4">
        <div className="w-[min(92vw,820px)] text-center">
          {!atChoices && line && (
            <>
              <p className={`font-mono text-[11px] tracking-[0.45em] ${line.who === "you" ? "text-white/45" : "text-red-300/80"}`}>{speaker}</p>
              <p className="mt-2 font-display text-[clamp(1.15rem,2.2vw,1.6rem)] leading-snug text-[#efebe0] [text-shadow:0_0_14px_#000,0_0_3px_#000]">
                {line.text.slice(0, shown)}
              </p>
              <p className="mt-3 font-mono text-[10px] tracking-[0.3em] text-white/30">E / CLICK ▸</p>
            </>
          )}
          {atChoices && node.choices && (
            <div className="flex flex-col items-center gap-2">
              {node.choices.map((c, i) => (
                <button
                  key={c.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    audio.blip();
                    goto(c.next);
                  }}
                  className="w-full max-w-xl border border-white/20 bg-black/60 px-4 py-2 text-left font-display text-lg tracking-[0.04em] text-[#ece8dc] hover:border-white/60 hover:bg-white/5"
                >
                  <span className="mr-3 font-mono text-sm text-white/40">{i + 1}</span>
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
