"use client";

import { useState } from "react";
import { useInvestigation } from "@/contexts/InvestigationContext";
import { closeOverlay, travelTo } from "../actions";
import { audio } from "../audio";
import { toolById } from "../config/rooms.config";
import { CASE, caseSolved, checkAnswer, evidenceFor, grantEvidence, type Evidence } from "../evidence/case";
import { PASSWORD } from "../evidence/make";
import { FLOOR_LAYOUTS, type BuiltFloor } from "../level";
import { runtime, useGame } from "../store";

// The case file: what you know, what you're holding, and where to take it.

const where = (toolId: string) => {
  const t = toolById(toolId);
  return t ? `${t.name} — ${t.floor} · ${t.room === "???" ? "?" : t.room}, the ${t.object.toLowerCase()}` : toolId;
};

function goToTool(toolId: string) {
  const t = toolById(toolId);
  if (!t) return;
  const layout = FLOOR_LAYOUTS[t.floor as BuiltFloor];
  const it = layout?.interactables.find((i) => i.kind === "tool" && i.toolId === toolId);
  audio.blip();
  if (it?.node) travelTo(t.floor as BuiltFloor, it.node);
  else closeOverlay();
}

export function CaseFileOverlay() {
  const flags = useGame((s) => s.flags);
  const has = (e: Evidence) => flags.includes(`has:${e.id}`);
  const solved = (e: Evidence) => flags.includes(`solved:${e.id}`);
  const current = CASE.find((e) => !solved(e));
  const lastSolved = [...CASE].reverse().find(solved);
  return (
    <div className="panel-in pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-4" onClick={closeOverlay}>
      <div onClick={(e) => e.stopPropagation()} className="case-file relative max-h-[90vh] w-full max-w-3xl overflow-auto p-7 text-[#2a241a]">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <p className="font-typewriter text-xs tracking-[0.4em] text-[#7a1a10]">CASE FILE · MISSING PERSON</p>
            <h2 className="mt-1 font-display text-3xl tracking-[0.06em]">VOSS, Elena</h2>
            <p className="font-typewriter text-sm text-[#4a4030]">Network analyst, Brookhaven Hospital. Not seen for three years.</p>
          </div>
          <button onClick={closeOverlay} className="font-display text-sm tracking-[0.3em] text-[#4a4030] hover:text-black">
            CLOSE ✕
          </button>
        </div>

        <div className="mt-5 border-l-4 border-[#7a1a10] bg-[#7a1a10]/5 px-4 py-3 font-hand text-2xl leading-7 text-[#3a1a10]">
          {caseSolved(flags)
            ? "I know everything now. The last note is on the roof."
            : lastSolved
              ? lastSolved.next
              : "Her letter. Somebody should look at where it really came from."}
        </div>

        <ol className="mt-6 space-y-4 font-typewriter text-[14px] leading-6">
          {CASE.map((e, i) => {
            const state = solved(e) ? "solved" : has(e) ? "held" : "unknown";
            return (
              <li key={e.id} className={`border-b border-[#2a241a]/15 pb-3 ${state === "unknown" ? "opacity-45" : ""}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-bold">
                    {String(i + 1).padStart(2, "0")} · {state === "unknown" ? "— not yet found —" : e.file}
                  </p>
                  <span className={`text-xs tracking-[0.25em] ${state === "solved" ? "text-[#1e5a2a]" : state === "held" ? "text-[#7a1a10]" : ""}`}>
                    {state === "solved" ? "UNDERSTOOD" : state === "held" ? "TO EXAMINE" : ""}
                  </span>
                </div>
                {state !== "unknown" && (
                  <>
                    <p className="text-[#5a5040]">Found: {e.foundWhere}</p>
                    {state === "solved" ? (
                      <p className="mt-1 italic">{e.reveal}</p>
                    ) : (
                      <div className="mt-1 flex flex-wrap items-center gap-3">
                        <span>Examine with: {where(e.tool)}</span>
                        <button onClick={() => goToTool(e.tool)} className="border border-[#2a241a]/50 px-2 py-0.5 text-xs tracking-[0.2em] hover:bg-[#2a241a] hover:text-[#e8e0cc]">
                          GO THERE
                        </button>
                      </div>
                    )}
                  </>
                )}
                {state === "unknown" && e === current && i > 0 && <p className="text-[#5a5040]">Somewhere in the building.</p>}
              </li>
            );
          })}
        </ol>
        <p className="mt-5 font-typewriter text-xs text-[#5a5040]">C opens this file. In a room, the evidence you carry appears above the instrument.</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the keypad

export function KeypadOverlay() {
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState(false);
  const submit = () => {
    if (code.trim().toLowerCase() === PASSWORD) {
      audio.creak();
      const g = useGame.getState();
      g.flag("archive-open");
      runtime.memoId = "elena-tape";
      g.flag("read:elena-tape");
      grantEvidence("elena-tape");
      g.setOverlay("memo");
    } else {
      audio.locked();
      setWrong(true);
    }
  };
  return (
    <div className="panel-in pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-4" onClick={closeOverlay}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm border border-white/15 bg-[#0d0e0c] p-6 text-center shadow-[0_0_80px_#000]">
        <p className="font-display text-xs tracking-[0.5em] text-white/40">THE REEL CASE</p>
        <p className="mt-3 font-typewriter text-sm leading-6 text-white/70">A steel case with a six-letter keypad. Scratched into the lid: “a small light is enough.”</p>
        <input
          autoFocus
          value={code}
          maxLength={6}
          onChange={(e) => {
            setCode(e.target.value.replace(/[^a-z]/gi, "").toUpperCase());
            setWrong(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") submit();
            if (e.key === "Escape") closeOverlay();
          }}
          className="mt-5 w-full border border-white/25 bg-black px-4 py-3 text-center font-mono text-2xl tracking-[0.6em] text-[#9fd8a0] outline-none"
        />
        {wrong && <p className="mt-2 font-typewriter text-sm text-red-400">The lock doesn&apos;t move.</p>}
        <button onClick={submit} className="mt-4 border border-white/30 px-6 py-2 font-display tracking-[0.3em] text-white/80 hover:bg-white/5">
          OPEN
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ in the instrument

/** Shown above an instrument: the evidence you carry that it can read, a way
 *  to load it, and the question it should answer. */
export function EvidenceBar({ toolId }: { toolId: string }) {
  const flags = useGame((s) => s.flags);
  const items = evidenceFor(toolId).filter((e) => flags.includes(`has:${e.id}`));
  if (!items.length) return null;
  return (
    <div className="space-y-2 border-b border-red-900/40 bg-[#1a0b09]/80 px-5 py-3">
      {items.map((e) => (
        <EvidenceRow key={e.id} e={e} solved={flags.includes(`solved:${e.id}`)} />
      ))}
    </div>
  );
}

function EvidenceRow({ e, solved }: { e: Evidence; solved: boolean }) {
  const inv = useInvestigation();
  const [status, setStatus] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [wrong, setWrong] = useState(false);

  const load = async () => {
    audio.blip();
    const f = await e.make();
    const scope = document.querySelector(".tool-scope");
    const press = (label?: string) => {
      if (!label || !scope) return;
      const btn = Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.includes(label));
      btn?.click();
    };
    press(e.before);
    if (e.before) await new Promise((r) => window.setTimeout(r, 450));
    if (e.companion) {
      const area = scope?.querySelector("textarea");
      if (area) setNativeValue(area, e.companion.text);
    }
    const input = scope?.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (input) {
      const dt = new DataTransfer();
      dt.items.add(f);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      setStatus(`${e.file} loaded into the instrument.`);
      if (e.after) window.setTimeout(() => press(e.after), 600);
    } else {
      setStatus("This instrument takes no files here.");
    }
  };
  const save = async () => {
    const f = await e.make();
    const url = URL.createObjectURL(f);
    const a = document.createElement("a");
    a.href = url;
    a.download = e.file;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  const answer = (given: number | string) => {
    if (checkAnswer(e, given)) {
      const g = useGame.getState();
      g.flag(`solved:${e.id}`);
      inv.mergeGraph(e.graph.nodes, e.graph.edges);
      audio.stinger();
      runtime.shake = 0.5;
      g.say(e.reveal);
      window.setTimeout(() => {
        audio.voice(3, 160);
        useGame.getState().speak("RADIO", e.radio);
        window.setTimeout(() => useGame.getState().speak("", null), 5200);
      }, 6000);
    } else {
      audio.locked();
      setWrong(true);
    }
  };

  return (
    <div className="flex flex-col gap-2 font-typewriter text-sm text-[#e8d6c8] lg:flex-row lg:items-start lg:gap-5">
      <div className="shrink-0 lg:w-72">
        <p className="text-[11px] tracking-[0.35em] text-red-400/80">EVIDENCE</p>
        <p className="font-bold">{e.file}</p>
        <div className="mt-1 flex gap-2">
          <button onClick={load} className="border border-red-300/40 px-2 py-0.5 text-xs tracking-[0.15em] hover:bg-red-900/40">
            LOAD INTO INSTRUMENT
          </button>
          <button onClick={save} className="border border-white/20 px-2 py-0.5 text-xs tracking-[0.15em] text-white/60 hover:text-white">
            SAVE COPY
          </button>
        </div>
        {status && <p className="mt-1 text-xs text-white/45">{status}</p>}
        {e.companion && <p className="mt-1 text-xs text-white/45">The rule from the tape ({e.companion.label}) is loaded with it.</p>}
      </div>
      <div className="min-w-0 flex-1">
        {solved ? (
          <p className="italic text-[#c9e6c4]">{e.reveal}</p>
        ) : (
          <>
            <p>{e.question}</p>
            {e.options ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {e.options.map((o, i) => (
                  <button
                    key={o}
                    onClick={() => answer(i)}
                    className="border border-white/20 px-2.5 py-1 text-left text-xs text-white/80 hover:border-white/60 hover:text-white"
                  >
                    {o}
                  </button>
                ))}
              </div>
            ) : (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  answer(text);
                }}
              >
                <input
                  value={text}
                  onChange={(ev) => {
                    setText(ev.target.value);
                    setWrong(false);
                  }}
                  onKeyDown={(ev) => ev.stopPropagation()}
                  className="w-48 border border-white/25 bg-black/60 px-2 py-1 font-mono text-white outline-none"
                />
                <button className="border border-white/25 px-3 text-xs tracking-[0.2em]">ANSWER</button>
              </form>
            )}
            {wrong && <p className="mt-1 text-xs text-red-400">That isn&apos;t what the trace says. Look again.</p>}
          </>
        )}
      </div>
    </div>
  );
}

function setNativeValue(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
