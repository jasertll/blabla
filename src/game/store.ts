import { create } from "zustand";
import * as THREE from "three";
import type { FloorId } from "./config/rooms.config";

export type Phase = "title" | "intro" | "play";
export type Quality = "low" | "medium" | "high";
export type PlayFloor = "EXTERIOR" | "1F" | "2F";

/** Per-frame mutable state. Lives outside React so the render loop never re-renders components. */
export const runtime = {
  pos: new THREE.Vector3(0, 0, 6),
  yaw: Math.PI, // facing -Z
  speed: 0,
  camYaw: Math.PI,
  camPitch: -0.12,
  /** Nearest monster distance, drives radio static. */
  threat: 99,
  /** Auto-travel path: list of [floor, x, z]. Empty when the player is in control. */
  path: [] as { floor: PlayFloor; x: number; z: number; ride?: PlayFloor }[],
  keys: new Set<string>(),
  pointerLocked: false,
  /** World position + look target the camera should fly to when a tool is opened. */
  focus: null as null | { cam: THREE.Vector3; look: THREE.Vector3 },
  shake: 0,
  /** 0 = normal world, 1 = fully Otherworld. Eased every frame by <Atmosphere/>. */
  dread: 0,
  /** Seconds the player has been walking (drives footsteps and body animation). */
  walkPhase: 0,
  /** Yaw of the actual camera view; movement input is relative to it. */
  viewYaw: Math.PI,
  /** Interactable currently in reach (set by <Interaction/>). */
  near: null as null | import("./level").Interactable,
  lastMouse: 0,
};

interface SaveData {
  floor: PlayFloor;
  x: number;
  z: number;
  yaw: number;
  visited: string[];
}

interface GameState {
  phase: Phase;
  floor: PlayFloor;
  nightmare: boolean;
  /** Timestamp (ms) until which the Otherworld event lasts; 0 = inactive. */
  otherworldUntil: number;
  activeTool: string | null;
  toolVisible: boolean;
  toolOpenedAt: number;
  prompt: string | null;
  message: { text: string; id: number } | null;
  visited: string[];
  overlay: null | "map" | "cassette" | "memo" | "elevator" | "settings";
  fade: number;
  quality: Quality;
  muted: boolean;
  tapeId: string | null;
  tapePlaying: boolean;
  /** True while the world is visibly in its Otherworld form. */
  owActive: boolean;
  /** Timestamp of the last tear into the Otherworld (drives the screen flash). */
  tear: number;
  setOw: (on: boolean) => void;
  setPhase: (p: Phase) => void;
  setFloor: (f: PlayFloor) => void;
  toggleNightmare: () => void;
  triggerOtherworld: (ms: number) => void;
  openTool: (id: string) => void;
  showTool: () => void;
  closeTool: () => void;
  setPrompt: (p: string | null) => void;
  say: (text: string) => void;
  visit: (room: string) => void;
  setOverlay: (o: GameState["overlay"]) => void;
  setFade: (v: number) => void;
  setQuality: (q: Quality) => void;
  toggleMute: () => void;
  setTape: (id: string | null, playing: boolean) => void;
  save: () => void;
  load: () => boolean;
}

const SAVE_KEY = "brookhaven.save.v1";

export const hasSave = () => {
  try {
    return !!localStorage.getItem(SAVE_KEY);
  } catch {
    return false;
  }
};

export const useGame = create<GameState>((set, get) => ({
  phase: "title",
  floor: "EXTERIOR",
  nightmare: false,
  otherworldUntil: 0,
  activeTool: null,
  toolVisible: false,
  toolOpenedAt: 0,
  prompt: null,
  message: null,
  visited: [],
  overlay: null,
  fade: 0,
  quality: "high",
  muted: false,
  tapeId: null,
  tapePlaying: false,
  owActive: false,
  tear: 0,
  setOw: (on) => set(on ? { owActive: true, tear: performance.now() } : { owActive: false }),
  setPhase: (phase) => set({ phase }),
  setFloor: (floor) => set({ floor }),
  toggleNightmare: () => set((s) => ({ nightmare: !s.nightmare })),
  triggerOtherworld: (ms) => set({ otherworldUntil: performance.now() + ms }),
  openTool: (id) => set({ activeTool: id, toolVisible: false, prompt: null, toolOpenedAt: performance.now() }),
  showTool: () => set({ toolVisible: true }),
  closeTool: () => {
    runtime.focus = null;
    set({ activeTool: null, toolVisible: false });
  },
  setPrompt: (prompt) => {
    if (get().prompt !== prompt) set({ prompt });
  },
  say: (text) => set({ message: { text, id: Math.random() } }),
  visit: (room) => {
    if (!get().visited.includes(room)) set((s) => ({ visited: [...s.visited, room] }));
  },
  setOverlay: (overlay) => set({ overlay }),
  setFade: (fade) => set({ fade }),
  setQuality: (quality) => set({ quality }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  setTape: (tapeId, tapePlaying) => set({ tapeId, tapePlaying }),
  save: () => {
    const s = get();
    const data: SaveData = {
      floor: s.floor,
      x: runtime.pos.x,
      z: runtime.pos.z,
      yaw: runtime.yaw,
      visited: s.visited,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable: saving is best-effort */
    }
  },
  load: () => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw) as SaveData;
      runtime.pos.set(d.x, 0, d.z);
      runtime.yaw = d.yaw;
      runtime.camYaw = d.yaw;
      set({ floor: d.floor, visited: d.visited ?? [] });
      return true;
    } catch {
      return false;
    }
  },
}));

export const isOtherworld = () => {
  const s = useGame.getState();
  return s.nightmare || performance.now() < s.otherworldUntil;
};

export type { FloorId };
