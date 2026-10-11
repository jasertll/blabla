"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Compass } from "lucide-react";
import JaserSprite from "@/components/world/JaserSprite";
import WorldTerminal from "@/components/world/WorldTerminal";
import WorldDoor from "@/components/world/WorldDoor";
import InvestigationModeShell from "@/components/world/InvestigationModeShell";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";
import { ROOMS, START_ROOM_ID } from "@/lib/world/roomRegistry";
import type { Facing, Vec2 } from "@/lib/world/types";
import type { ToolId } from "@/contexts/InvestigationContext";

// The 2D world layer, now driven by a small Room registry (lib/world/
// roomRegistry.ts) instead of one hardcoded room — see the architecture
// audit and the follow-up design pass for why: proving the room-template
// pattern generalizes to a second room (different background, different
// tool behind its terminal, a door connecting them) before it's repeated
// across the rest of the 27 tools. WorldScene itself owns the game loop,
// camera, and input; everything room-specific lives in the registry.

const PLAYER_SPEED = 260; // world units per second
const PLAYER_HALF = 24;

const KEY_DIRECTIONS: Record<string, Vec2> = {
  arrowup: { x: 0, y: -1 },
  arrowdown: { x: 0, y: 1 },
  arrowleft: { x: -1, y: 0 },
  arrowright: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export default function WorldScene() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(1000);
  const reduceMotion = useSafeReducedMotion();

  const [roomId, setRoomId] = useState(START_ROOM_ID);
  const room = ROOMS[roomId];

  const posRef = useRef<Vec2>({ x: 220, y: 300 });
  const facingRef = useRef<Facing>("right");
  const pressedRef = useRef<Set<string>>(new Set());
  const lastTickRef = useRef<number | null>(null);
  const investigatingRef = useRef(false);
  const transitioningRef = useRef(false);

  const [pos, setPos] = useState<Vec2>(posRef.current);
  const [facing, setFacing] = useState<Facing>("right");
  const [nearObjectId, setNearObjectId] = useState<string | null>(null);
  const [nearDoorId, setNearDoorId] = useState<string | null>(null);
  const [investigatingToolId, setInvestigatingToolId] = useState<ToolId | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [bob, setBob] = useState(0);
  const [lean, setLean] = useState(0);

  useEffect(() => {
    investigatingRef.current = investigatingToolId !== null;
  }, [investigatingToolId]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const goToDoor = useCallback(
    (doorId: string) => {
      const door = room.doors.find((d) => d.id === doorId);
      if (!door || transitioningRef.current) return;
      transitioningRef.current = true;
      setTransitioning(true);
      setTimeout(() => {
        posRef.current = { ...door.arrivesAt };
        facingRef.current = door.arrivesFacing;
        setPos(posRef.current);
        setFacing(facingRef.current);
        setRoomId(door.toRoomId);
        setNearDoorId(null);
        setNearObjectId(null);
        setTimeout(() => {
          transitioningRef.current = false;
          setTransitioning(false);
        }, 260);
      }, 260);
    },
    [room.doors]
  );

  const interactWithObject = useCallback(
    (objectId: string) => {
      const obj = room.objects.find((o) => o.id === objectId);
      if (!obj) return;
      setInvestigatingToolId(obj.toolId);
    },
    [room.objects]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if (key in KEY_DIRECTIONS) {
        pressedRef.current.add(key);
        e.preventDefault();
      } else if ((key === "e" || key === " ") && !investigatingRef.current) {
        if (nearObjectId) {
          e.preventDefault();
          interactWithObject(nearObjectId);
        } else if (nearDoorId) {
          e.preventDefault();
          goToDoor(nearDoorId);
        }
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      pressedRef.current.delete(e.key.toLowerCase());
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [nearObjectId, nearDoorId, interactWithObject, goToDoor]);

  useEffect(() => {
    let raf: number;

    function tick(t: number) {
      raf = requestAnimationFrame(tick);
      const last = lastTickRef.current ?? t;
      const dt = Math.min(0.05, (t - last) / 1000);
      lastTickRef.current = t;

      const paused = investigatingRef.current || transitioningRef.current;
      if (!paused) {
        let dx = 0;
        let dy = 0;
        for (const key of pressedRef.current) {
          const dir = KEY_DIRECTIONS[key];
          if (dir) {
            dx += dir.x;
            dy += dir.y;
          }
        }
        const isMoving = dx !== 0 || dy !== 0;
        if (isMoving) {
          const len = Math.hypot(dx, dy) || 1;
          posRef.current = {
            x: clamp(posRef.current.x + (dx / len) * PLAYER_SPEED * dt, PLAYER_HALF, room.width - PLAYER_HALF),
            y: clamp(posRef.current.y + (dy / len) * PLAYER_SPEED * dt, PLAYER_HALF, room.height - PLAYER_HALF),
          };
          if (dx < 0) facingRef.current = "left";
          else if (dx > 0) facingRef.current = "right";
        }

        let closestObject: string | null = null;
        let closestObjectDist = Infinity;
        for (const obj of room.objects) {
          const d = Math.hypot(posRef.current.x - obj.pos.x, posRef.current.y - obj.pos.y);
          if (d <= obj.radius && d < closestObjectDist) {
            closestObject = obj.id;
            closestObjectDist = d;
          }
        }
        let closestDoor: string | null = null;
        let closestDoorDist = Infinity;
        for (const door of room.doors) {
          const d = Math.hypot(posRef.current.x - door.pos.x, posRef.current.y - door.pos.y);
          if (d <= door.radius && d < closestDoorDist) {
            closestDoor = door.id;
            closestDoorDist = d;
          }
        }
        setNearObjectId(closestObject);
        setNearDoorId(closestObject ? null : closestDoor); // an object prompt wins if somehow overlapping a door
        setPos({ ...posRef.current });
        setFacing(facingRef.current);
      }

      if (reduceMotion) {
        setBob(0);
        setLean(0);
      } else {
        const moveNow = !paused && pressedRef.current.size > 0;
        const freq = moveNow ? 7 : 1.6;
        const amp = moveNow ? 3.2 : 1.4;
        setBob(Math.sin(t / (1000 / freq)) * amp);
        setLean(moveNow ? (facingRef.current === "left" ? -3 : 3) : 0);
      }
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion, room]);

  const cameraX = useMemo(() => {
    const maxCamera = Math.max(0, room.width - viewportWidth);
    return clamp(pos.x - viewportWidth / 2, 0, maxCamera);
  }, [pos.x, viewportWidth, room.width]);

  const setDirectionHeld = useCallback((key: string, held: boolean) => {
    if (held) pressedRef.current.add(key);
    else pressedRef.current.delete(key);
  }, []);

  const Background = room.Background;

  return (
    <div className="glass-panel p-0 overflow-hidden relative">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60">
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <Compass className="h-3.5 w-3.5 text-terminal-bright" />
          <span className="font-medium">{room.name}</span>
          <span className="text-slate-600">— Jaser&apos;s World (preview)</span>
        </div>
        <p className="hud-text text-[10px] text-slate-600 hidden md:block">WASD / ARROWS — MOVE · E — INTERACT</p>
      </div>

      <div ref={viewportRef} className="relative w-full overflow-hidden" style={{ height: room.height }}>
        <Background cameraX={cameraX} />

        <div className="absolute inset-0" style={{ transform: `translateX(${-cameraX}px)` }}>
          <div
            className="absolute left-0 right-0 bottom-0"
            style={{ height: 140, width: room.width, background: "linear-gradient(180deg, rgba(13,10,24,0) 0%, rgba(7,5,13,0.9) 100%)" }}
          />
          <div className="absolute left-0 right-0" style={{ top: room.height - 6, height: 2, width: room.width, background: "rgba(52,211,153,0.15)" }} />

          {room.objects.map((obj) => (
            <div key={obj.id} className="absolute" style={{ left: obj.pos.x - 32, top: obj.pos.y - 80 }}>
              <WorldTerminal near={nearObjectId === obj.id} label={obj.label} onInteract={() => interactWithObject(obj.id)} />
            </div>
          ))}

          {room.doors.map((door) => (
            <div key={door.id} className="absolute" style={{ left: door.pos.x - 35, top: door.pos.y - 180 }}>
              <WorldDoor near={nearDoorId === door.id} onInteract={() => goToDoor(door.id)} />
            </div>
          ))}

          <div
            className="absolute"
            style={{
              left: pos.x - 36,
              top: pos.y - 90,
              transition: "opacity 0.3s ease",
              opacity: investigatingToolId || transitioning ? 0.35 : 1,
            }}
          >
            <JaserSprite facing={facing} bob={bob} lean={lean} />
          </div>
        </div>

        <AnimatePresence>
          {transitioning && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.26 }}
              className="absolute inset-0 bg-[#05040a] pointer-events-none"
            />
          )}
        </AnimatePresence>
      </div>

      <div className="md:hidden flex items-center justify-between px-4 py-3 border-t border-border/60">
        <DPad onHold={setDirectionHeld} />
        <button
          type="button"
          disabled={!nearObjectId && !nearDoorId}
          onClick={() => (nearObjectId ? interactWithObject(nearObjectId) : nearDoorId && goToDoor(nearDoorId))}
          className="hud-text text-[11px] px-3 py-2 rounded-md border border-terminal/50 text-terminal-bright disabled:opacity-30 disabled:border-border"
        >
          {nearDoorId && !nearObjectId ? "ENTER" : "INVESTIGATE"}
        </button>
      </div>

      <AnimatePresence>
        {investigatingToolId && (
          <InvestigationModeShell
            toolId={investigatingToolId}
            label={room.objects.find((o) => o.toolId === investigatingToolId)?.label ?? ""}
            onReturn={() => setInvestigatingToolId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function DPad({ onHold }: { onHold: (key: string, held: boolean) => void }) {
  const dirs: { key: string; label: string; cls: string }[] = [
    { key: "arrowup", label: "▲", cls: "col-start-2 row-start-1" },
    { key: "arrowleft", label: "◀", cls: "col-start-1 row-start-2" },
    { key: "arrowright", label: "▶", cls: "col-start-3 row-start-2" },
    { key: "arrowdown", label: "▼", cls: "col-start-2 row-start-3" },
  ];
  return (
    <div className="grid grid-cols-3 grid-rows-3 gap-1" style={{ width: 120 }}>
      {dirs.map((d) => (
        <button
          key={d.key}
          type="button"
          aria-label={d.label}
          className={`${d.cls} h-8 w-8 rounded-md border border-border text-slate-400 active:bg-surface-high active:text-terminal-bright select-none`}
          onPointerDown={(e) => {
            e.preventDefault();
            onHold(d.key, true);
          }}
          onPointerUp={() => onHold(d.key, false)}
          onPointerLeave={() => onHold(d.key, false)}
          onPointerCancel={() => onHold(d.key, false)}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}
