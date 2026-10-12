"use client";

import { useEffect, useRef, useState } from "react";
import { closeOverlay, rideElevator, toggleNightmare, travelTo } from "../actions";
import { ToolView } from "../tools/registry";
import { audio } from "../audio";
import { FLOORS, TOOLS, toolById } from "../config/rooms.config";
import { TAPES } from "../config/tapes.config";
import { FLOOR_LAYOUTS, layoutFor, nearestNode, type BuiltFloor } from "../level";
import { MEMOS } from "../config/story";
import { CASE } from "../evidence/case";
import { CaseFileOverlay, EvidenceBar, KeypadOverlay } from "./CaseFile";
import { getApiBase, isStatic, setApiBase } from "../apiBase";
import { runtime, useGame, type PlayFloor } from "../store";

// ------------------------------------------------------------------ HUD

export function Hud() {
  const floor = useGame((s) => s.floor);
  const prompt = useGame((s) => s.prompt);
  const nightmare = useGame((s) => s.nightmare);
  const muted = useGame((s) => s.muted);
  const overlay = useGame((s) => s.overlay);
  const tool = useGame((s) => s.activeTool);
  const busy = !!overlay || !!tool;
  const [hint, setHint] = useState(true);

  useEffect(() => {
    const t = window.setTimeout(() => setHint(false), 22000);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none">
      <Location floor={floor} />
      <div className={`pointer-events-auto absolute right-3 top-3 flex gap-2 transition-opacity ${busy ? "opacity-0" : "opacity-100"}`}>
        <HudButton label="CASE FILE" hotkey="C" onClick={() => useGame.getState().setOverlay("case")} />
        <HudButton label="MAP" hotkey="M" onClick={() => useGame.getState().setOverlay("map")} />
        <HudButton label={nightmare ? "WAKE UP" : "NIGHTMARE"} hotkey="N" danger={nightmare} onClick={toggleNightmare} />
        <HudButton label={muted ? "SOUND OFF" : "SOUND ON"} onClick={() => useGame.getState().toggleMute()} />
        <HudButton label="⚙" onClick={() => useGame.getState().setOverlay("settings")} />
      </div>
      {prompt && !busy && (
        <div className="prompt absolute bottom-[14vh] left-1/2 -translate-x-1/2 text-center font-display text-lg tracking-[0.2em] text-[#ece8dc]">
          <span className="mr-3 inline-block border border-[#ece8dc]/60 px-2 py-0.5 font-mono text-sm">E</span>
          {prompt}
        </div>
      )}
      <Message />
      <Voice />
      <Radio />
      {hint && !busy && (
        <div className="absolute bottom-4 left-4 max-w-[90vw] font-mono text-[11px] leading-relaxed tracking-wider text-white/45">
          MOUSE look · CLICK the floor to walk · WASD move · SHIFT run · E examine · C case file · M map · N nightmare · T next song · P pause music
        </div>
      )}
      <MiniPlayer />
    </div>
  );
}

function HudButton({ label, hotkey, onClick, danger }: { label: string; hotkey?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        audio.blip();
        onClick();
      }}
      className={`hud-btn border px-3 py-1.5 font-display text-[12px] tracking-[0.25em] backdrop-blur-[2px] ${
        danger ? "border-red-700/80 bg-red-950/50 text-red-200" : "border-white/25 bg-black/35 text-white/80 hover:text-white"
      }`}
    >
      {label}
      {hotkey && <span className="ml-2 text-white/35">{hotkey}</span>}
    </button>
  );
}

function Location({ floor }: { floor: PlayFloor }) {
  const title = layoutFor(floor)?.title ?? "";
  const [show, setShow] = useState(true);
  useEffect(() => {
    setShow(true);
    const t = window.setTimeout(() => setShow(false), 5000);
    return () => window.clearTimeout(t);
  }, [floor]);
  return (
    <div className={`absolute left-4 top-4 font-display transition-opacity duration-[1500ms] ${show ? "opacity-100" : "opacity-0"}`}>
      <p className="text-[11px] tracking-[0.5em] text-white/45">BROOKHAVEN HOSPITAL</p>
      <p className="mt-1 text-xl tracking-[0.15em] text-[#ece8dc]">{title}</p>
    </div>
  );
}

function Message() {
  const message = useGame((s) => s.message);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!message) return;
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 3800);
    return () => window.clearTimeout(t);
  }, [message]);
  return (
    <div
      className={`absolute bottom-[22vh] left-1/2 w-[min(90vw,720px)] -translate-x-1/2 text-center font-display text-[clamp(1rem,2vw,1.35rem)] italic text-[#ece8dc] transition-opacity duration-700 [text-shadow:0_0_12px_#000] ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      {message?.text}
    </div>
  );
}

/** Pocket radio: bars jump with the static when something is close. */
function Radio() {
  const bars = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const level = audio.getStatic();
      const el = bars.current;
      if (el) {
        Array.from(el.children).forEach((b, i) => {
          const on = level > i / 6 && Math.random() > 0.25;
          (b as HTMLElement).style.opacity = on ? "1" : "0.15";
        });
        el.parentElement!.style.opacity = level > 0.02 ? "1" : "0.35";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="absolute bottom-4 right-4 flex items-end gap-2 transition-opacity">
      <span className="font-mono text-[10px] tracking-[0.3em] text-red-300/80">RADIO</span>
      <div ref={bars} className="flex items-end gap-[3px]">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="w-[4px] bg-red-500" style={{ height: 5 + i * 3 }} />
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ overlays

function Panel({ children, wide, onClose }: { children: React.ReactNode; wide?: boolean; onClose: () => void }) {
  return (
    <div className="panel-in pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative max-h-[90vh] w-full overflow-auto border border-white/15 bg-[#0c0c0b]/90 p-6 shadow-[0_0_80px_#000] ${wide ? "max-w-4xl" : "max-w-xl"}`}
      >
        <button onClick={onClose} className="absolute right-4 top-3 font-display text-sm tracking-[0.3em] text-white/50 hover:text-white">
          CLOSE ✕
        </button>
        {children}
      </div>
    </div>
  );
}

export function Overlays() {
  const overlay = useGame((s) => s.overlay);
  if (!overlay) return null;
  switch (overlay) {
    case "map":
      return <MapOverlay />;
    case "cassette":
      return <CassetteOverlay />;
    case "memo":
      return <MemoOverlay />;
    case "elevator":
      return <ElevatorPanel />;
    case "settings":
      return <SettingsOverlay />;
    case "case":
      return <CaseFileOverlay />;
    case "keypad":
      return <KeypadOverlay />;
  }
}

function MemoOverlay() {
  const memo = MEMOS[runtime.memoId] ?? MEMOS["memo-lobby"];
  const evidence = CASE.find((e) => e.foundIn === runtime.memoId);
  return (
    <div className="panel-in pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-4" onClick={closeOverlay}>
      <div onClick={(e) => e.stopPropagation()} className="memo relative w-full max-w-md rotate-[-1.2deg] p-8 font-typewriter text-[15px] leading-7 text-[#2a241a]">
        <p className="mb-4 text-right text-xs">— {memo.found}</p>
        {memo.body}
        {memo.sign && <p className="mt-5 text-right font-hand text-2xl text-[#5a1a10]">{memo.sign}</p>}
        {evidence && (
          <div className="mt-6 border-t border-dashed border-[#2a241a]/40 pt-3 text-[13px] leading-5">
            <p className="tracking-[0.3em] text-[#7a1a10]">EVIDENCE ADDED TO THE CASE FILE</p>
            <p className="mt-1 font-bold">{evidence.file}</p>
            <p>Examine it with the {toolById(evidence.tool)?.name} ({toolById(evidence.tool)?.floor} · {toolById(evidence.tool)?.room}).</p>
          </div>
        )}
        <button onClick={closeOverlay} className="absolute -bottom-10 left-1/2 -translate-x-1/2 font-display text-sm tracking-[0.3em] text-white/60">
          CLOSE
        </button>
      </div>
    </div>
  );
}

function ElevatorPanel() {
  const floor = useGame((s) => s.floor);
  return (
    <Panel onClose={closeOverlay}>
      <p className="font-display text-xs tracking-[0.5em] text-white/40">ELEVATOR</p>
      <h2 className="mt-1 font-display text-2xl tracking-[0.15em] text-[#ece8dc]">Select a floor</h2>
      <div className="mt-6 grid gap-2">
        {FLOORS.map((f) => {
          const here = f.id === floor;
          return (
            <button
              key={f.id}
              disabled={!f.built || here}
              onClick={() => rideElevator(f.id as PlayFloor)}
              className={`flex items-center justify-between border px-4 py-3 text-left font-display tracking-[0.15em] transition ${
                here
                  ? "border-amber-600/60 bg-amber-900/20 text-amber-200"
                  : f.built
                    ? "border-white/20 text-[#ece8dc] hover:border-white/60 hover:bg-white/5"
                    : "cursor-not-allowed border-white/5 text-white/25"
              }`}
            >
              <span>
                <span className="mr-4 inline-block w-12 font-mono">{f.id}</span>
                {f.name}
              </span>
              <span className="text-xs tracking-[0.2em]">{here ? "YOU ARE HERE" : f.built ? "" : "NO POWER"}</span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

/** Where the online tools send their lookups (only needed on the static copy). */
function ApiServerField() {
  const [value, setValue] = useState(getApiBase());
  const [saved, setSaved] = useState(false);
  return (
    <div>
      <p className="mb-2 text-sm text-white/50">TOOLS SERVER</p>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          placeholder={isStatic() ? "https://your-deployment.vercel.app" : "this site (default)"}
          className="min-w-0 flex-1 border border-white/20 bg-black/40 px-3 py-2 font-mono text-sm tracking-normal text-white outline-none focus:border-white/60"
        />
        <button
          onClick={() => {
            setApiBase(value);
            setSaved(true);
          }}
          className="border border-white/25 px-4 py-2"
        >
          {saved ? "SAVED" : "SAVE"}
        </button>
      </div>
      <p className="mt-2 text-xs normal-case tracking-normal text-white/40">
        Online lookups (IP, domain, username, certificates…) need the app&apos;s server. Leave empty on the deployed site.
      </p>
    </div>
  );
}

function SettingsOverlay() {
  const quality = useGame((s) => s.quality);
  const retro = useGame((s) => s.retro);
  const muted = useGame((s) => s.muted);
  const g = useGame.getState();
  return (
    <Panel onClose={closeOverlay}>
      <p className="font-display text-xs tracking-[0.5em] text-white/40">OPTIONS</p>
      <h2 className="mt-1 font-display text-2xl tracking-[0.15em] text-[#ece8dc]">Settings</h2>
      <div className="mt-6 space-y-5 font-display tracking-[0.12em] text-[#ece8dc]">
        <div>
          <p className="mb-2 text-sm text-white/50">GRAPHICS QUALITY</p>
          <div className="flex gap-2">
            {(["low", "medium", "high"] as const).map((q) => (
              <button key={q} onClick={() => g.setQuality(q)} className={`flex-1 border px-3 py-2 uppercase ${quality === q ? "border-white/70 bg-white/10" : "border-white/15 text-white/60"}`}>
                {q}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-white/50">SOUND</p>
          <button onClick={() => g.toggleMute()} className="border border-white/25 px-4 py-2">
            {muted ? "OFF" : "ON"}
          </button>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-white/50">PS1 LOOK (low-res, dithered)</p>
          <button onClick={() => g.setRetro(!useGame.getState().retro)} className="border border-white/25 px-4 py-2">
            {retro ? "ON" : "OFF"}
          </button>
        </div>
        <ApiServerField />
        <div className="flex items-center justify-between">
          <p className="text-sm text-white/50">SAVE DATA</p>
          <button
            onClick={() => {
              try {
                localStorage.removeItem("brookhaven.save.v1");
              } catch {
                /* ignore */
              }
              g.say("Save data erased.");
            }}
            className="border border-red-800/60 px-4 py-2 text-red-300"
          >
            ERASE
          </button>
        </div>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ map

/** Pencil-drawn floor plan. Visited rooms are marked; click a room to walk there. */
function MapOverlay() {
  const current = useGame((s) => s.floor);
  const visited = useGame((s) => s.visited);
  const [floor, setFloor] = useState<PlayFloor>(current === "EXTERIOR" ? "1F" : current);
  const layout = FLOOR_LAYOUTS[floor as BuiltFloor];
  const xs = layout.rects.flatMap((r) => [r.min[0], r.max[0]]);
  const zs = layout.rects.flatMap((r) => [r.min[1], r.max[1]]);
  const pad = 2;
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minZ = Math.min(...zs) - pad;
  const maxZ = Math.max(...zs) + pad;
  const W = maxX - minX;
  const H = maxZ - minZ;

  const flags = useGame((s) => s.flags);
  const targets = layout.interactables
    .filter((i) => ["tool", "memo", "elevator", "save", "cassette", "phone"].includes(i.kind))
    .filter((i) => i.room !== "???" || visited.includes("???"))
    .map((i) => {
      const tool = i.toolId ? toolById(i.toolId) : undefined;
      const label =
        i.kind === "tool" ? (tool ? `${i.room === "lobby" ? "" : `${i.room} · `}${shortName(tool.name).split(" ").slice(0, 2).join(" ").replace(/[\s/&]+$/, "")}` : i.label)
        : i.kind === "memo" ? "NOTE"
        : i.kind === "elevator" ? "LIFT"
        : i.kind === "save" ? "SAVE"
        : i.kind === "cassette" ? "TAPES"
        : "PHONE";
      const seen = i.kind === "tool" ? visited.includes(i.room ?? "") : i.kind === "memo" ? flags.includes(`read:${i.id}`) : true;
      return { label, node: i.node ?? nearestNode(layout, i.at[0], i.at[1]), at: i.at, seen, tool: i.toolId, key: i.id };
    });

  return (
    <Panel wide onClose={closeOverlay}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-xs tracking-[0.5em] text-white/40">MAP</p>
          <h2 className="mt-1 font-display text-2xl tracking-[0.15em] text-[#ece8dc]">{layout.title}</h2>
        </div>
        <div className="mr-24 flex gap-1">
          {FLOORS.map((f) => (
            <button
              key={f.id}
              disabled={!f.built}
              onClick={() => setFloor(f.id as PlayFloor)}
              className={`border px-2.5 py-1 font-mono text-xs ${floor === f.id ? "border-white/70 text-white" : f.built ? "border-white/20 text-white/60" : "border-white/5 text-white/20"}`}
            >
              {f.id}
            </button>
          ))}
        </div>
      </div>
      <div className="map-paper mt-4 p-3">
        <svg viewBox={`${minX} ${minZ} ${W} ${H}`} className="block max-h-[62vh] w-full" style={{ aspectRatio: `${W} / ${H}` }}>
          <defs>
            <filter id="pencil">
              <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="3" />
              <feDisplacementMap in="SourceGraphic" scale="0.25" />
            </filter>
          </defs>
          <g filter="url(#pencil)" stroke="#3b342a" fill="none" strokeLinecap="round">
            {layout.rects.map((r, i) => (
              <rect key={i} x={r.min[0]} y={r.min[1]} width={r.max[0] - r.min[0]} height={r.max[1] - r.min[1]} fill="rgba(80,70,50,0.06)" stroke="none" />
            ))}
            {layout.walls.map((w, i) => (
              <line key={i} x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} strokeWidth={0.22} />
            ))}
            {layout.colliders.map((c, i) => (
              <rect key={i} x={c.min[0]} y={c.min[1]} width={c.max[0] - c.min[0]} height={c.max[1] - c.min[1]} strokeWidth={0.06} />
            ))}
          </g>
          {targets.map((t) => (
            <g
              key={t.key}
              transform={`translate(${t.at[0]} ${t.at[1]})`}
              className="cursor-pointer"
              onClick={() => {
                audio.blip();
                travelTo(floor, t.node);
              }}
            >
              <circle r={0.9} fill="transparent" />
              {t.seen && t.tool && <circle r={0.75} fill="none" stroke="#a3150e" strokeWidth={0.12} />}
              {t.label.split(" · ").map((part, k, all) => (
                <text key={k} textAnchor="middle" y={0.3 + (k - (all.length - 1) / 2) * 0.9} fontSize={k ? 0.62 : 1.05} fill={t.seen ? "#2a2318" : "#7a7060"} className="font-hand">
                  {part}
                </text>
              ))}
            </g>
          ))}
          {current === floor && (
            <g transform={`translate(${runtime.pos.x} ${runtime.pos.z}) rotate(${(-runtime.yaw * 180) / Math.PI})`}>
              <path d="M0 0.7 L-0.4 -0.4 L0 -0.15 L0.4 -0.4 Z" fill="#b3170f" />
            </g>
          )}
        </svg>
      </div>
      <p className="mt-3 font-display text-sm tracking-[0.1em] text-white/45">Click a place to walk there. Red circles mark instruments you have found.</p>
      <InstrumentList />
    </Panel>
  );
}

// ------------------------------------------------------------------ cassette

function CassetteOverlay() {
  const tapeId = useGame((s) => s.tapeId);
  const playing = useGame((s) => s.tapePlaying);
  return (
    <Panel onClose={closeOverlay}>
      <p className="font-display text-xs tracking-[0.5em] text-white/40">CASSETTE RECORDER</p>
      <h2 className="mt-1 font-display text-2xl tracking-[0.15em] text-[#ece8dc]">Choose a tape</h2>
      <div className="mt-6 grid gap-3">
        {TAPES.map((t) => {
          const active = tapeId === t.id && playing;
          return (
            <button
              key={t.id}
              onClick={() => (active ? stopTape() : playTape(t.id))}
              className={`group flex items-center gap-4 border p-3 text-left transition ${active ? "border-red-700/70 bg-red-950/30" : "border-white/15 hover:border-white/50"}`}
            >
              <Cassette color={t.color} spinning={active} />
              <div className="flex-1">
                <p className="font-typewriter text-[#ece8dc]">{t.title}</p>
                <p className="mt-1 font-mono text-[11px] tracking-wider text-white/40">{t.src ? t.src : "generated ambience"}</p>
              </div>
              <span className="font-display text-xs tracking-[0.3em] text-white/60">{active ? "■ STOP" : "▶ PLAY"}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-5 font-mono text-[11px] leading-5 text-white/40">
        Add your own tapes: put audio files in <span className="text-white/70">public/audio/tapes/</span> and list them in{" "}
        <span className="text-white/70">src/game/config/tapes.config.ts</span>.
      </p>
    </Panel>
  );
}

export function playTape(id: string) {
  const tape = TAPES.find((t) => t.id === id);
  if (!tape) return;
  useGame.getState().setTape(id, true);
  audio.playTape(tape.src, () => {
    const i = TAPES.findIndex((t) => t.id === id);
    const next = TAPES[(i + 1) % TAPES.length];
    if (next && TAPES.length > 1) playTape(next.id);
    else useGame.getState().setTape(null, false);
  });
}

/** Next tape on the shelf (T key and the player's ▸▸ button). */
export function nextTape() {
  const { tapeId } = useGame.getState();
  const i = TAPES.findIndex((t) => t.id === tapeId);
  playTape(TAPES[(i + 1) % TAPES.length].id);
}

export function stopTape() {
  audio.stopTape();
  useGame.getState().setTape(useGame.getState().tapeId, false);
}

function Cassette({ color, spinning, small }: { color: string; spinning: boolean; small?: boolean }) {
  return (
    <svg viewBox="0 0 100 64" className={small ? "h-8 w-12" : "h-12 w-[76px]"}>
      <rect x="1" y="1" width="98" height="62" rx="4" fill="#1b1b1b" stroke="#444" />
      <rect x="8" y="6" width="84" height="30" rx="2" fill={color} />
      <rect x="22" y="14" width="56" height="16" rx="8" fill="#0d0d0d" />
      {[36, 64].map((cx) => (
        <g key={cx} className={spinning ? "reel-spin" : ""} style={{ transformOrigin: `${cx}px 22px` }}>
          <circle cx={cx} cy={22} r={6} fill="#ddd" />
          {[0, 60, 120].map((a) => (
            <rect key={a} x={cx - 0.8} y={16.5} width={1.6} height={11} fill="#333" transform={`rotate(${a} ${cx} 22)`} />
          ))}
        </g>
      ))}
      <path d="M20 63 L28 46 H72 L80 63" fill="#2a2a2a" />
    </svg>
  );
}

function MiniPlayer() {
  const tapeId = useGame((s) => s.tapeId);
  const playing = useGame((s) => s.tapePlaying);
  const tape = TAPES.find((t) => t.id === tapeId);
  if (!tape || !playing) return null;
  return (
    <div className="pointer-events-auto absolute bottom-12 left-4 flex items-center gap-3 border border-white/15 bg-black/55 px-3 py-2 backdrop-blur-sm">
      <Cassette color={tape.color} spinning small />
      <div>
        <p className="font-mono text-[10px] tracking-[0.3em] text-white/40">NOW PLAYING</p>
        <p className="font-typewriter text-sm text-[#ece8dc]">{tape.title}</p>
      </div>
      <button onClick={stopTape} className="ml-2 font-display text-xs tracking-[0.2em] text-white/60 hover:text-white">
        ■
      </button>
      {TAPES.length > 1 && (
        <button onClick={nextTape} className="font-display text-xs text-white/60 hover:text-white" title="Next song (T)">
          ▸▸ <span className="font-mono text-white/35">T</span>
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ tool view

/** The examined object fills the screen and becomes the instrument: the real
 *  tool component, wearing the hospital's palette. */
export function ToolOverlay() {
  const id = useGame((s) => s.activeTool);
  const visible = useGame((s) => s.toolVisible);
  if (!id || !visible) return null;
  const tool = toolById(id);
  if (!tool) return null;
  const close = () => {
    audio.blip();
    useGame.getState().closeTool();
  };
  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center p-2 sm:p-5">
      <div className="vhs-in relative flex h-full w-full max-w-[1500px] flex-col border border-white/15 bg-[#080908]/95 shadow-[0_0_120px_#000]">
        <div className="crt-lines pointer-events-none absolute inset-0 z-10" />
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] tracking-[0.4em] text-red-400/80">
              {tool.floor} · {tool.room === "???" ? "UNKNOWN ROOM" : `ROOM ${tool.room}`} · {tool.category.toUpperCase()}
            </p>
            <h2 className="mt-1 font-display text-[clamp(1.3rem,2.6vw,2rem)] tracking-[0.08em] text-[#efebe0]">{tool.name}</h2>
            <p className="mt-0.5 font-typewriter text-sm text-white/50">{tool.object}</p>
          </div>
          <button onClick={close} className="shrink-0 font-display text-sm tracking-[0.3em] text-white/55 hover:text-white">
            BACK <span className="ml-1 font-mono text-white/30">ESC</span>
          </button>
        </header>
        <EvidenceBar toolId={tool.id} />
        <ServerNotice refId={tool.ref} />
        <div className="tool-scope relative min-h-0 flex-1 overflow-auto p-4 sm:p-5">
          <ToolView refId={tool.ref} name={tool.name} />
        </div>
      </div>
    </div>
  );
}

/** Every instrument in the building, by floor. Rooms not built yet open the
 *  instrument straight from the archive. */
function InstrumentList() {
  const visited = useGame((s) => s.visited);
  const open = (id: string) => {
    audio.blip();
    const g = useGame.getState();
    closeOverlay();
    g.openTool(id);
    g.showTool();
  };
  return (
    <div className="mt-5">
      <p className="font-display text-xs tracking-[0.5em] text-white/40">THE INSTRUMENTS</p>
      <div className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {FLOORS.map((f) => {
          const tools = TOOLS.filter((t) => t.floor === f.id && (t.room !== "???" || visited.includes("???")));
          if (!tools.length) return null;
          return (
            <div key={f.id}>
              <p className="font-mono text-[11px] tracking-[0.3em] text-red-300/70">
                {f.id} · {f.name.toUpperCase()}
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {tools.map((t) => (
                  <li key={t.id}>
                    <button onClick={() => open(t.id)} className="group flex w-full items-baseline gap-2 py-0.5 text-left">
                      <span className="w-10 shrink-0 font-mono text-[11px] text-white/35">{t.room === "???" ? "—" : t.room}</span>
                      <span className="font-display text-[15px] text-[#ece8dc]/80 group-hover:text-white">{t.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ fx layers

export function FadeLayer() {
  const fade = useGame((s) => s.fade);
  return <div className="pointer-events-none absolute inset-0 z-50 bg-black transition-opacity duration-700" style={{ opacity: fade }} />;
}

/** Red tear + glitch when the world flips into the Otherworld. */
export function TearFlash() {
  const tear = useGame((s) => s.tear);
  if (!tear) return null;
  return <div key={tear} className="tear pointer-events-none absolute inset-0 z-40" />;
}

export function OtherworldTint() {
  const ow = useGame((s) => s.owActive);
  return <div className={`pointer-events-none absolute inset-0 z-10 transition-opacity duration-[3000ms] ow-tint ${ow ? "opacity-100" : "opacity-0"}`} />;
}

/** "IP / ASN Analyzer" → "IP / ASN"; keeps map labels short. */
function shortName(n: string) {
  return n.replace(/ (Analyzer|Inspector|Toolkit|Scanner|Generator|Tester|Mapper|Tracker|Dashboard|Report|Engine|Check|Scan|Forensics|Intelligence)$/i, "").toUpperCase();
}

/** Subtitles for voices that aren't yours: the radio, the phone. */
export function Voice() {
  const voice = useGame((s) => s.voice);
  if (!voice) return null;
  return (
    <div key={voice.id} className="panel-in pointer-events-none absolute bottom-[30vh] left-1/2 w-[min(90vw,760px)] -translate-x-1/2 text-center">
      <p className="font-mono text-[10px] tracking-[0.5em] text-red-400/70">{voice.who}</p>
      <p className="mt-1 font-typewriter text-[clamp(1rem,1.9vw,1.3rem)] text-[#e8a79d] [text-shadow:0_0_14px_#000,0_0_3px_#400]">{voice.text}</p>
    </div>
  );
}

/** Tools that look things up online need the app's server. */
const ONLINE = new Set(["ip", "domain", "webapp", "camera", "certwatch", "surface", "username", "recon", "exposure", "space", "gold", "canary", "imageintel", "overview", "graph"]);

function ServerNotice({ refId }: { refId: string }) {
  const [open, setOpen] = useState(true);
  if (!open || !ONLINE.has(refId) || !isStatic() || getApiBase()) return null;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-amber-700/40 bg-amber-950/30 px-5 py-2 font-typewriter text-[13px] leading-5 text-amber-100/85">
      <p>
        This instrument looks things up on the internet through the hospital&apos;s server. This copy has no server, so online lookups will fail.
        Open the deployed site, or set its address under ⚙ Settings → Tools server.
      </p>
      <button onClick={() => setOpen(false)} className="shrink-0 text-white/50 hover:text-white">
        ✕
      </button>
    </div>
  );
}

/** After the last note: the light goes out, and the hospital lets you go. */
export function Ending() {
  const ending = useGame((s) => s.flags.includes("ending") && !s.flags.includes("ending-seen"));
  if (!ending) return null;
  return (
    <div className="ending pointer-events-auto absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#e9e6dc] px-6 text-center text-[#1b1a16]">
      <p className="font-typewriter text-sm tracking-[0.5em] text-[#7a1a10]">LANTERN · kill_switch=candle · ACCEPTED</p>
      <h2 className="mt-6 font-display text-[clamp(2rem,6vw,4.5rem)] tracking-[0.12em]">Leave a light on.</h2>
      <p className="mt-6 max-w-xl font-display text-xl italic leading-8 text-[#3a3830]">
        Every device that touched that network is free of it now. Including yours. The fog will still be there tomorrow. So will the
        instruments. The truth was always in the data. You just had to look at your own.
      </p>
      <button
        onClick={() => useGame.getState().flag("ending-seen")}
        className="mt-10 border border-[#1b1a16]/50 px-6 py-2 font-display tracking-[0.35em] hover:bg-[#1b1a16] hover:text-[#e9e6dc]"
      >
        STAY A WHILE
      </button>
    </div>
  );
}
