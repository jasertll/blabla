import type { Box, CamZone, FloorLayout, Interactable, V2, Wall } from "./level";
import type { PlayFloor } from "./store";

// Ward floors built from a list of rooms: a corridor running north from the
// elevator with rooms off both sides. Each room holds one instrument (the
// object the tool lives in) and gets its own cinematic camera.

export type ObjectKind =
  | "cabinets"
  | "evidence"
  | "chart-bed"
  | "corkboard"
  | "ticker"
  | "anatomy"
  | "desk"
  | "autopsy"
  | "jars"
  | "darkroom"
  | "tray"
  | "ecg"
  | "microscope"
  | "shelves"
  | "birdcage"
  | "press"
  | "stamp"
  | "enlarger";

export interface RoomSpec {
  room: string;
  side: -1 | 1;
  object: ObjectKind;
  /** Prompt shown at the instrument. */
  label: string;
  toolId?: string;
  /** A memo lying in this room. */
  memo?: { id: string; label: string };
  /** Words painted on this room's back wall. */
  writing?: string;
}

export interface WardSpec {
  id: PlayFloor;
  title: string;
  height: number;
  rooms: RoomSpec[];
  /** Extra corridor length past the last door (cells, dead ends). */
  tail: number;
  sign: string;
  /** Where the corridor's last walkable point is, if not the dead end. */
  endZ?: number;
  extras?: Partial<Pick<FloorLayout, "colliders" | "interactables">>;
}

export const HALF = 1.8; // corridor half-width
export const DEPTH = 6; // room depth from the corridor wall
export const ROOM_LEN = 6; // room length along the corridor
const DOOR = 0.62; // half door gap

export interface RoomGeom {
  spec: RoomSpec;
  zTop: number;
  zBot: number;
  zDoor: number;
  xIn: number; // corridor wall
  xOut: number; // back wall
}

export function roomGeometry(spec: WardSpec): { rooms: RoomGeom[]; zEnd: number } {
  const count: Record<number, number> = { [-1]: 0, [1]: 0 };
  const rooms = spec.rooms.map((r) => {
    const k = count[r.side]++;
    const zTop = -1 - k * ROOM_LEN;
    return { spec: r, zTop, zBot: zTop - ROOM_LEN, zDoor: zTop - ROOM_LEN / 2, xIn: r.side * HALF, xOut: r.side * (HALF + DEPTH) };
  });
  const deepest = Math.min(...rooms.map((r) => r.zBot));
  return { rooms, zEnd: deepest - spec.tail };
}

export function buildWard(spec: WardSpec): FloorLayout {
  const { rooms, zEnd } = roomGeometry(spec);
  const walls: Wall[] = [
    { a: [-HALF, 4], b: [HALF, 4] },
    { a: [-HALF, zEnd], b: [HALF, zEnd] },
  ];
  // corridor side walls with door gaps
  for (const side of [-1, 1] as const) {
    const gaps = rooms
      .filter((r) => r.spec.side === side)
      .map((r) => r.zDoor)
      .sort((a, b) => b - a);
    let z = 4;
    for (const g of gaps) {
      walls.push({ a: [side * HALF, z], b: [side * HALF, g + DOOR] });
      z = g - DOOR;
    }
    walls.push({ a: [side * HALF, z], b: [side * HALF, zEnd] });
  }
  const rects: Box[] = [{ min: [-HALF, zEnd], max: [HALF, 4] }];
  const colliders: Box[] = [...(spec.extras?.colliders ?? [])];
  const interactables: Interactable[] = [
    { id: `elevator-${spec.id}`, kind: "elevator", at: [0, 3.2], radius: 1.4, label: "Call the elevator", node: "elevator" },
    ...(spec.extras?.interactables ?? []),
  ];
  const camZones: CamZone[] = [];
  const nodes: Record<string, V2> = { elevator: [0, 2.6] };
  const edges: [string, string][] = [];
  const layoutRooms: FloorLayout["rooms"] = [{ id: `${spec.id}-corridor`, label: "Corridor", min: [-HALF, zEnd], max: [HALF, 4], node: "elevator" }];

  const seenTop = new Set<string>();
  for (const r of rooms) {
    const s = r.spec.side;
    const xMin = Math.min(r.xIn, r.xOut);
    const xMax = Math.max(r.xIn, r.xOut);
    rects.push({ min: [xMin, r.zBot], max: [xMax, r.zTop] });
    walls.push({ a: [r.xOut, r.zTop], b: [r.xOut, r.zBot] });
    const topKey = `${s}:${r.zTop}`;
    if (!seenTop.has(topKey)) walls.push({ a: [r.xIn, r.zTop], b: [r.xOut, r.zTop] });
    walls.push({ a: [r.xIn, r.zBot], b: [r.xOut, r.zBot] });
    seenTop.add(`${s}:${r.zBot}`);

    // the instrument stands against the back wall
    const wall = s * (HALF + DEPTH);
    colliders.push({ min: [Math.min(wall, wall - s * 1.8), r.zDoor - 1.15], max: [Math.max(wall, wall - s * 1.8), r.zDoor + 1.15] });
    const id = r.spec.room;
    const c = `c${r.zDoor}`;
    nodes[c] = [0, r.zDoor];
    nodes[`d${id}`] = [s * (HALF - 0.6), r.zDoor];
    nodes[`r${id}`] = [s * (HALF + 1.6), r.zDoor];
    nodes[`t${id}`] = [s * (HALF + DEPTH - 2.3), r.zDoor];
    edges.push([c, `d${id}`], [`d${id}`, `r${id}`], [`r${id}`, `t${id}`]);
    if (r.spec.toolId)
      interactables.push({
        id: `tool-${id}`,
        kind: "tool",
        toolId: r.spec.toolId,
        room: id,
        node: `t${id}`,
        at: [s * (HALF + DEPTH - 2.3), r.zDoor],
        radius: 1.3,
        label: r.spec.label,
        focus: { cam: [s * (HALF + DEPTH - 3.0), 1.75, r.zDoor + 0.15], look: [s * (HALF + DEPTH - 0.6), 1.15, r.zDoor] },
      });
    if (r.spec.memo)
      interactables.push({
        id: r.spec.memo.id,
        kind: "memo",
        node: `r${id}`,
        at: [s * (HALF + 2.2), r.zDoor - 2.0],
        radius: 1.0,
        label: r.spec.memo.label,
      });
    camZones.push({ min: [xMin, r.zBot], max: [xMax, r.zTop], cam: [s * (HALF + 0.55), spec.height - 0.35, r.zTop - 0.45] });
    layoutRooms.push({ id, label: id, min: [xMin, r.zBot], max: [xMax, r.zTop], node: `t${id}` });
  }
  // corridor chain, south to north
  const chain = ["elevator", ...[...new Set(rooms.map((r) => r.zDoor))].sort((a, b) => b - a).map((z) => `c${z}`)];
  nodes.end = [0, spec.endZ ?? zEnd + 1.2];
  chain.push("end");
  for (let i = 1; i < chain.length; i++) edges.push([chain[i - 1], chain[i]]);

  return {
    id: spec.id,
    title: spec.title,
    height: spec.height,
    rects,
    walls,
    colliders,
    interactables,
    camZones,
    nodes,
    edges,
    elevatorSpawn: { at: [0, 2.2], yaw: Math.PI },
    rooms: layoutRooms,
  };
}

// ------------------------------------------------------------------ the floors

export const WARD_SPECS: Record<"3F" | "4F" | "B1" | "B2", WardSpec> = {
  "3F": {
    id: "3F",
    title: "3F — Patient Records",
    height: 3.6,
    sign: "PATIENT RECORDS  ·  301 – 303",
    tail: 3,
    rooms: [
      { room: "301", side: -1, object: "cabinets", label: "Search the filing cabinets", toolId: "username" },
      { room: "302", side: 1, object: "evidence", label: "Study the evidence board", toolId: "recon", writing: "SHE WAS HERE" },
      { room: "303", side: -1, object: "chart-bed", label: "Read the patient chart", toolId: "exposure" },
    ],
    extras: {
      colliders: [{ min: [1.0, -0.2], max: [1.75, 1.6] }], // nurse station desk
      interactables: [
        { id: "phone-3f", kind: "phone", at: [0.5, 0.7], radius: 1.0, label: "Pick up the phone", node: "elevator" },
        { id: "intake-elena", kind: "memo", at: [0.5, 1.5], radius: 0.8, label: "Read the intake card", node: "elevator" },
      ],
    },
  },
  "4F": {
    id: "4F",
    title: "4F — Director's Wing",
    height: 3.9,
    sign: "ADMINISTRATION  ·  DIRECTOR",
    tail: 2,
    rooms: [
      { room: "401", side: -1, object: "corkboard", label: "Follow the red string", toolId: "intel-graph" },
      { room: "402", side: 1, object: "ticker", label: "Read the ticker tape", toolId: "xau-usd" },
      { room: "403", side: -1, object: "anatomy", label: "Examine the anatomy chart", toolId: "mitre" },
      { room: "DIR", side: 1, object: "desk", label: "The director's desk", memo: { id: "director-lantern", label: "Read the papers on the desk" }, writing: "LANTERN SEES" },
    ],
  },
  B1: {
    id: "B1",
    title: "B1 — Morgue",
    height: 3.2,
    sign: "MORGUE  ·  AUTHORISED STAFF ONLY",
    tail: 5,
    rooms: [
      { room: "B101", side: -1, object: "autopsy", label: "Lift the sheet", toolId: "email-header", memo: { id: "autopsy-report", label: "Read the autopsy report" } },
      { room: "B102", side: 1, object: "jars", label: "Look into the specimen jars", toolId: "malware" },
      { room: "B103", side: -1, object: "darkroom", label: "Develop the photographs", toolId: "stego" },
      { room: "B104", side: 1, object: "tray", label: "Take the instruments", toolId: "dfir" },
      { room: "B105", side: -1, object: "ecg", label: "Watch the heart monitor", toolId: "pcap", writing: "IT STILL BEATS" },
      { room: "B106", side: 1, object: "microscope", label: "Look through the microscope", toolId: "yara" },
    ],
    extras: {
      // the holding cell: bars across the end of the corridor
      colliders: [],
    },
  },
  B2: {
    id: "B2",
    title: "B2 — Laboratory & Archive",
    height: 3.4,
    sign: "ARCHIVE  ·  LABORATORIES",
    tail: 2,
    rooms: [
      { room: "ARC", side: -1, object: "shelves", label: "Search the shelves", toolId: "library", memo: { id: "elena-tape", label: "Open the locked reel case" } },
      { room: "B201", side: 1, object: "birdcage", label: "Open the birdcage", toolId: "canary" },
      { room: "B202", side: -1, object: "press", label: "Work the printing press", toolId: "pdf" },
      { room: "B203", side: 1, object: "stamp", label: "Use the notary stamp", toolId: "c2pa" },
      { room: "B204", side: -1, object: "enlarger", label: "Use the photo enlarger", toolId: "image-intel", writing: "LOOK CLOSER" },
    ],
  },
};

// B1's cell sits at the dead end: bars across the corridor, the figure behind.
const b1 = roomGeometry(WARD_SPECS.B1);
export const B1_BARS_Z = b1.zEnd + 2.6;
WARD_SPECS.B1.extras!.colliders!.push({ min: [-HALF, B1_BARS_Z - 0.08], max: [HALF, B1_BARS_Z + 0.08] });
WARD_SPECS.B1.endZ = B1_BARS_Z + 1.0;
WARD_SPECS.B1.extras!.interactables = [{ id: "cell-b1", kind: "message", at: [0, B1_BARS_Z + 0.9], radius: 1.1, label: "Look into the cell", node: "end" }];

// ------------------------------------------------------------------ the roof

export const ROOF: FloorLayout = {
  id: "ROOF",
  title: "Roof — Observatory",
  height: 1.15,
  outdoor: true,
  rects: [{ min: [-12, -14], max: [12, 6] }],
  walls: [
    { a: [-12, -14], b: [12, -14] },
    { a: [-12, 6], b: [12, 6] },
    { a: [-12, -14], b: [-12, 6] },
    { a: [12, -14], b: [12, 6] },
  ],
  colliders: [
    { min: [-2.2, 2.2], max: [2.2, 6] }, // elevator housing
    { min: [-1.0, -9.6], max: [1.0, -7.6] }, // telescope
    { min: [-10.6, -12.6], max: [-6.4, -8.4] }, // water tower
    { min: [5, -3], max: [9, -1] }, // ventilation units
  ],
  interactables: [
    { id: "elevator-ROOF", kind: "elevator", at: [0, 1.4], radius: 1.4, label: "Call the elevator", node: "elevator" },
    {
      id: "tool-telescope",
      kind: "tool",
      toolId: "satellite",
      room: "Observatory",
      node: "scope",
      at: [0, -6.6],
      radius: 1.4,
      label: "Look through the telescope",
      focus: { cam: [0.5, 1.9, -6.2], look: [0, 1.6, -9] },
    },
    { id: "elena-final", kind: "memo", at: [6, -12.6], radius: 1.1, label: "Read the note on the ledge", node: "ledge" },
    {
      id: "tool-arcade",
      kind: "tool",
      toolId: "jasers-world",
      room: "???",
      node: "arcade",
      at: [-8.5, -13.1],
      radius: 1.0,
      label: "???",
      focus: { cam: [-8.5, 1.6, -12.6], look: [-8.5, 1.3, -13.7] },
    },
  ],
  camZones: [],
  nodes: { elevator: [0, 1.6], mid: [0, -3], scope: [0, -6.6], ledge: [6, -12.4], arcade: [-8.5, -13.0], west: [-5.5, -12.0] },
  edges: [
    ["elevator", "mid"],
    ["mid", "scope"],
    ["mid", "ledge"],
    ["mid", "west"],
    ["west", "arcade"],
  ],
  elevatorSpawn: { at: [0, 1.6], yaw: Math.PI },
  rooms: [{ id: "roof", label: "Roof", min: [-12, -14], max: [12, 6], node: "scope" }],
};
