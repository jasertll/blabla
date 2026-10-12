import type { PlayFloor } from "./store";
import { buildWard, ROOF, WARD_SPECS } from "./floors";

// Floor layouts. Walls are axis-aligned segments; they are both rendered and
// used as colliders. Units are metres, Y is up, the hospital entrance faces +Z.

export type V2 = [number, number];
export type V3 = [number, number, number];

export interface Wall {
  a: V2;
  b: V2;
}

export interface Box {
  min: V2;
  max: V2;
}

export type InteractKind = "tool" | "elevator" | "locked" | "memo" | "save" | "cassette" | "message" | "phone";

export interface Interactable {
  id: string;
  kind: InteractKind;
  /** Where the player must stand (x, z). */
  at: V2;
  radius: number;
  label: string;
  toolId?: string;
  room?: string;
  text?: string;
  /** Path node to walk to when travelling here. */
  node?: string;
  /** Camera flight target when examining. */
  focus?: { cam: V3; look: V3 };
}

export interface CamZone {
  min: V2;
  max: V2;
  cam: V3;
}

export interface FloorLayout {
  id: PlayFloor;
  title: string;
  height: number;
  /** Open sky: no ceiling, parapet instead of walls. */
  outdoor?: boolean;
  rects: Box[]; // floor / ceiling pieces
  walls: Wall[];
  colliders: Box[];
  interactables: Interactable[];
  camZones: CamZone[];
  nodes: Record<string, V2>;
  edges: [string, string][];
  /** Where you appear when the elevator arrives. */
  elevatorSpawn: { at: V2; yaw: number };
  /** Areas reported as rooms on the map, for "visited" tracking. */
  rooms: { id: string; label: string; min: V2; max: V2; node: string }[];
}

const LOBBY: FloorLayout = {
  id: "1F",
  title: "1F — Reception",
  height: 5,
  rects: [
    { min: [-10, -8], max: [10, 8] },
    { min: [10, -1.3], max: [12, 1.3] },
  ],
  walls: [
    { a: [-10, -8], b: [10, -8] },
    { a: [-10, 8], b: [10, 8] },
    { a: [-10, -8], b: [-10, 8] },
    { a: [10, -8], b: [10, -1.3] },
    { a: [10, 1.3], b: [10, 8] },
    { a: [10, -1.3], b: [12, -1.3] },
    { a: [10, 1.3], b: [12, 1.3] },
    { a: [12, -1.3], b: [12, 1.3] },
  ],
  colliders: [
    { min: [-4.2, -4.6], max: [4.2, -3.4] }, // reception counter
    { min: [-6.35, 2.65], max: [-5.65, 3.35] },
    { min: [5.65, 2.65], max: [6.35, 3.35] },
    { min: [-6.35, -3.35], max: [-5.65, -2.65] },
    { min: [5.65, -3.35], max: [6.35, -2.65] },
    { min: [-9.9, 0], max: [-9.1, 3] }, // bench
    { min: [9.8, -1.3], max: [10.2, 1.3] }, // elevator doors
    { min: [6.5, 5.6], max: [8.4, 6.6] }, // gurney
    { min: [2.2, 1.75], max: [4.6, 2.3] }, // waiting chairs
    { min: [2.2, 3.55], max: [4.6, 4.1] },
    { min: [-9.55, 6.55], max: [-9.05, 7.05] }, // plants
    { min: [9.05, 6.55], max: [9.55, 7.05] },
    { min: [-7.05, -3.85], max: [-6.55, -3.35] },
  ],
  interactables: [
    {
      id: "overview",
      kind: "tool",
      toolId: "overview",
      room: "lobby",
      at: [0, -2.9],
      radius: 1.6,
      label: "Examine the monitors",
      focus: { cam: [0, 2.35, -0.6], look: [0, 2.2, -5.5] },
    },
    {
      id: "cassette",
      kind: "cassette",
      at: [-3.1, -2.9],
      radius: 1.1,
      label: "Use the cassette recorder",
      focus: { cam: [-3.1, 1.75, -2.55], look: [-3.1, 1.12, -3.95] },
    },
    { id: "memo-lobby", kind: "memo", at: [-8.5, 1.5], radius: 1.2, label: "Read the letter again" },
    { id: "save-lobby", kind: "save", at: [-9, -5], radius: 1.3, label: "Touch the red square" },
    { id: "elevator-1f", kind: "elevator", at: [9.2, 0], radius: 1.4, label: "Call the elevator" },
    { id: "clock-1f", kind: "message", at: [5.2, -7.1], radius: 1.1, label: "Look at the clock", text: "It stopped at 4:17. The letter was postmarked 4:17 too." },
    { id: "notice-1f", kind: "message", at: [-9.0, -1.5], radius: 1.2, label: "Read the notice board", text: "Visiting hours are suspended until further notice. The notice is dated nine years ago." },
    { id: "chairs-1f", kind: "message", at: [3.4, 1.25], radius: 1.0, label: "Look at the chairs", text: "One of the seats is still warm. Nobody has waited here in years." },
    {
      id: "entrance",
      kind: "message",
      at: [0, 7.2],
      radius: 1.5,
      label: "Open the front doors",
      text: "The fog outside is thicker than before. There is no reason to go back.",
    },
  ],
  camZones: [{ min: [8.2, -1.6], max: [12, 1.6], cam: [5.4, 3.9, -4.6] }],
  nodes: {
    spawn: [0, 4.6],
    hub: [0, 1.2],
    overview: [0, -2.8],
    cassette: [-3.1, -2.8],
    elevator: [9.1, 0],
    memo: [-8.4, 1.5],
    save: [-8.8, -5],
  },
  edges: [
    ["spawn", "hub"],
    ["hub", "overview"],
    ["hub", "cassette"],
    ["overview", "cassette"],
    ["hub", "elevator"],
    ["hub", "memo"],
    ["memo", "save"],
  ],
  elevatorSpawn: { at: [8.6, 0], yaw: -Math.PI / 2 },
  rooms: [{ id: "lobby", label: "Lobby", min: [-10, -8], max: [10, 8], node: "overview" }],
};

const WARD: FloorLayout = {
  id: "2F",
  title: "2F — Investigation Ward",
  height: 3.6,
  rects: [
    { min: [-1.8, -24], max: [1.8, 4] },
    { min: [-9, -9], max: [-1.8, 1] },
  ],
  walls: [
    { a: [-1.8, 4], b: [1.8, 4] },
    { a: [-1.8, -24], b: [1.8, -24] },
    { a: [-1.8, 4], b: [-1.8, -3.4] },
    { a: [-1.8, -4.6], b: [-1.8, -24] },
    { a: [1.8, 4], b: [1.8, -24] },
    // room 201
    { a: [-9, -9], b: [-1.8, -9] },
    { a: [-9, 1], b: [-1.8, 1] },
    { a: [-9, -9], b: [-9, 1] },
  ],
  colliders: [
    { min: [-8.95, -5.1], max: [-7.65, -2.9] }, // desk
    { min: [-6.3, -8.95], max: [-4.1, -7.85] }, // bed
    { min: [-8.95, -8.95], max: [-8.15, -8.0] }, // cabinet
    { min: [0.9, -9.6], max: [1.75, -8.6] }, // wheelchair
    { min: [-1.65, -7.3], max: [-0.95, -6.3] }, // linen cart
    { min: [0.75, -15.25], max: [1.6, -13.15] }, // gurney
    { min: [-1.35, -17.8], max: [-0.95, -17.4] }, // drip stand
    { min: [-6.85, -8.85], max: [-6.35, -8.35] }, // bedside cabinet
    { min: [-7.9, 0.45], max: [-7.3, 1.0] }, // sink
    { min: [-6.75, -7.75], max: [-6.35, -7.35] }, // drip stand in 201
  ],
  interactables: [
    {
      id: "ip-asn",
      kind: "tool",
      toolId: "ip-asn",
      room: "201",
      at: [-7.0, -4],
      radius: 1.3,
      label: "Examine the terminal",
      focus: { cam: [-6.75, 1.62, -4], look: [-8.45, 1.28, -4] },
    },
    { id: "door-202", kind: "tool", toolId: "domain-url", room: "202", at: [1.15, -4], radius: 1.0, label: "Open room 202", focus: { cam: [0.1, 1.75, -4], look: [1.7, 1.6, -4] } },
    { id: "door-203", kind: "tool", toolId: "webapp-scan", room: "203", at: [-1.15, -12], radius: 1.0, label: "Open room 203", focus: { cam: [-0.1, 1.75, -12], look: [-1.7, 1.6, -12] } },
    { id: "door-204", kind: "tool", toolId: "cctv-iot", room: "204", at: [1.15, -12], radius: 1.0, label: "Open room 204", focus: { cam: [0.1, 1.75, -12], look: [1.7, 1.6, -12] } },
    { id: "door-205", kind: "tool", toolId: "cert-watch", room: "205", at: [-1.15, -20], radius: 1.0, label: "Open room 205", focus: { cam: [-0.1, 1.75, -20], look: [-1.7, 1.6, -20] } },
    { id: "door-206", kind: "tool", toolId: "attack-surface", room: "206", at: [1.15, -20], radius: 1.0, label: "Open room 206", focus: { cam: [0.1, 1.75, -20], look: [1.7, 1.6, -20] } },
    { id: "stairs-2f", kind: "locked", at: [0, -23.3], radius: 1.2, label: "Stairwell", text: "The stairwell door is chained shut." },
    { id: "elevator-2f", kind: "elevator", at: [0, 3.2], radius: 1.4, label: "Call the elevator" },
    { id: "wheelchair-2f", kind: "message", at: [0.5, -9.1], radius: 0.9, label: "Examine the wheelchair", text: "Someone left in a hurry. Or never left at all." },
    { id: "notice-2f", kind: "message", at: [-1.0, -8], radius: 0.9, label: "Read the notice board", text: "PATIENT 201: NO NETWORK ACCESS UNDER ANY CIRCUMSTANCES. Underlined three times." },
    { id: "mirror-201", kind: "message", at: [-7.6, 0.15], radius: 0.9, label: "Look in the mirror", text: "That's me. I'm almost sure that's me." },
    { id: "bed-201", kind: "message", at: [-4.6, -7.4], radius: 0.9, label: "Examine the bed", text: "The mattress is soaked through. The stain has the shape of someone lying down." },
    { id: "diary-201", kind: "memo", at: [-6.1, -8.0], radius: 0.9, label: "Read the diary" },
  ],
  camZones: [{ min: [-9, -9], max: [-1.8, 1], cam: [-2.4, 3.15, 0.45] }],
  nodes: {
    elevator: [0, 2.6],
    c1: [0, -4],
    d201: [-1.2, -4],
    r201: [-3.2, -4],
    desk: [-6.95, -4],
    c2: [0, -12],
    c3: [0, -20],
  },
  edges: [
    ["elevator", "c1"],
    ["c1", "d201"],
    ["d201", "r201"],
    ["r201", "desk"],
    ["c1", "c2"],
    ["c2", "c3"],
  ],
  elevatorSpawn: { at: [0, 2.2], yaw: Math.PI },
  rooms: [
    { id: "2f-corridor", label: "Corridor", min: [-1.8, -24], max: [1.8, 4], node: "c1" },
    { id: "201", label: "201", min: [-9, -9], max: [-1.8, 1], node: "desk" },
  ],
};

export type BuiltFloor = Exclude<PlayFloor, "EXTERIOR">;

export const FLOOR_LAYOUTS: Record<BuiltFloor, FloorLayout> = {
  "1F": LOBBY,
  "2F": WARD,
  "3F": buildWard(WARD_SPECS["3F"]),
  "4F": buildWard(WARD_SPECS["4F"]),
  B1: buildWard(WARD_SPECS.B1),
  B2: buildWard(WARD_SPECS.B2),
  ROOF,
};

export const layoutFor = (f: PlayFloor) => (f === "EXTERIOR" ? null : FLOOR_LAYOUTS[f]);

/** Wall segments → thin boxes for collision. */
export function wallBoxes(layout: FloorLayout): Box[] {
  const t = 0.12;
  return layout.walls.map(({ a, b }) => ({
    min: [Math.min(a[0], b[0]) - t, Math.min(a[1], b[1]) - t],
    max: [Math.max(a[0], b[0]) + t, Math.max(a[1], b[1]) + t],
  }));
}

/** Shortest node path by BFS (graphs are tiny). */
export function findPath(layout: FloorLayout, from: string, to: string): string[] {
  const adj: Record<string, string[]> = {};
  for (const [a, b] of layout.edges) {
    (adj[a] ??= []).push(b);
    (adj[b] ??= []).push(a);
  }
  const prev: Record<string, string | null> = { [from]: null };
  const q = [from];
  while (q.length) {
    const n = q.shift()!;
    if (n === to) break;
    for (const m of adj[n] ?? []) if (!(m in prev)) {
      prev[m] = n;
      q.push(m);
    }
  }
  if (!(to in prev)) return [];
  const out: string[] = [];
  for (let n: string | null = to; n; n = prev[n]) out.unshift(n);
  return out;
}

export function nearestNode(layout: FloorLayout, x: number, z: number) {
  let best = "";
  let bd = Infinity;
  for (const [k, [nx, nz]] of Object.entries(layout.nodes)) {
    const d = (nx - x) ** 2 + (nz - z) ** 2;
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}
