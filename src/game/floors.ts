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

/** Small things left behind, one per room: each is a story in a sentence. */
export const ROOM_STORIES: Record<string, { label: string; text: string }> = {
  "301": { label: "Look at the drawing", text: "A child's drawing taped to a cabinet: a man holding a glowing phone. Every Thursday on the calendar beside it is circled in red." },
  "302": { label: "Read the sticky note", text: "\"Visitor badge #0417 — never signs out. Ask security.\" Someone has written underneath: \"Security IS the network.\"" },
  "303": { label: "Check the wristband", text: "A hospital wristband, cut off with scissors. VOSS, E. — Room 201. The plastic is still warm." },
  "401": { label: "Look at the photograph", text: "A staff photo. Elena is in the second row. The man beside her has been scratched out, but his coat hasn't." },
  "402": { label: "Read the ticker strip", text: "The tape repeats one line between the prices: SUBJECT 0417 ONLINE. SUBJECT 0417 ONLINE." },
  "403": { label: "Read the chart margin", text: "In the margin, in pencil: \"Initial access: a visitor's phone on the guest Wi-Fi. Persistence: grief.\"" },
  DIR: { label: "Open the drawer", text: "A drawer full of confiscated phones, each tagged with a name and a date. One tag is blank. It's waiting for yours." },
  B101: { label: "Read the toe tag", text: "CASE 0201. Personal effects: one phone (not hers), one hospital bracelet, one sheet of paper folded into a small boat." },
  B102: { label: "Read the jar label", text: "SPECIMEN: \"Trust\". The jar is empty. The label is in Elena's handwriting." },
  B103: { label: "Look at the drying prints", text: "Every print is the same photograph of room 201. In each one the visitor's chair is a little closer to the bed." },
  B104: { label: "Read the clipboard", text: "\"Chain of custody broken at 04:17. Evidence altered by: [blank]. Witness: LANTERN.\"" },
  B105: { label: "Listen to the monitor", text: "The heart monitor still beeps. There is no one attached to it. The rhythm matches your own." },
  B106: { label: "Look at the slide", text: "Under the microscope, a slide labelled \"SAMPLE: the letter\". Magnified, the ink is made of tiny words: from your phone, from your phone." },
  ARC: { label: "Read the spine", text: "A binder spine: \"VISITOR LOGS 2021 — DO NOT DELETE (H.K.)\". Every page inside has been torn out except Thursdays." },
  B201: { label: "Look at the birdcage", text: "A dead canary and a note: \"When it stops singing, someone has opened the file.\" It stopped singing." },
  B202: { label: "Read the proof sheet", text: "Printing plates for a letter. \"I know you stopped waiting for me.\" Dozens of copies. All signed — E." },
  B203: { label: "Check the stamp", text: "The notary stamp reads AUTHENTIC. It has been pressed onto a blank page a hundred times." },
  B204: { label: "Look at the enlargement", text: "An enlargement of a reflection in a window: a man in a coat, holding a phone up, filming room 201." },
};

export type ClutterKind = "gurney" | "wheelchair" | "iv" | "cart" | "chairs" | "papers" | "bench";
export interface Clutter {
  kind: ClutterKind;
  at: V2;
  rotY: number;
}

/** Things abandoned along a corridor, kept clear of doors and the walking line. */
export function corridorClutter(spec: WardSpec): Clutter[] {
  const { rooms, zEnd } = roomGeometry(spec);
  const doors = rooms.map((r) => ({ side: r.spec.side, z: r.zDoor }));
  const kinds: ClutterKind[] = ["gurney", "wheelchair", "iv", "cart", "papers", "chairs", "bench", "papers"];
  let seed = spec.id.charCodeAt(0) * 31 + spec.id.charCodeAt(1);
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const out: Clutter[] = [];
  let k = 0;
  for (let z = -2.5; z > zEnd + 2.5; z -= 3.2 + rnd() * 1.6) {
    const side = (k % 2 ? 1 : -1) as 1 | -1;
    k++;
    if (doors.some((d) => d.side === side && Math.abs(d.z - z) < 1.4)) continue;
    if (spec.endZ !== undefined && z < spec.endZ + 1) continue;
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    out.push({ kind, at: [side * (kind === "papers" ? 0.6 : 1.25), z], rotY: kind === "gurney" || kind === "bench" ? Math.PI / 2 : rnd() * 6 });
  }
  return out;
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
  for (const c of corridorClutter(spec)) {
    if (c.kind === "papers") continue;
    const half = c.kind === "gurney" || c.kind === "bench" ? [0.4, 1.0] : [0.35, 0.35];
    colliders.push({ min: [c.at[0] - half[0], c.at[1] - half[1]], max: [c.at[0] + half[0], c.at[1] + half[1]] });
  }
  const interactables: Interactable[] = [
    { id: `elevator-${spec.id}`, kind: "elevator", at: [0, 3.2], radius: 1.4, label: "Call the elevator", node: "elevator" },
    ...(spec.extras?.interactables ?? []),
  ];
  const camZones: CamZone[] = [];
  const nodes: Record<string, V2> = { elevator: [0, 2.6] };
  const edges: [string, string][] = [];
  // a health drink left on the floor near the elevator, and one at the dead end
  interactables.push(
    { id: `drink-${spec.id}-a`, kind: "item", at: [-1.1, -0.2], radius: 0.9, label: "Take the health drink" },
    { id: `drink-${spec.id}-b`, kind: "item", at: [1.1, (spec.endZ ?? zEnd + 1.2) + 0.3], radius: 0.9, label: "Take the health drink" },
  );
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
    const story = ROOM_STORIES[id];
    if (story)
      interactables.push({
        id: `story-${id}`,
        kind: "message",
        node: `r${id}`,
        at: [s * (HALF + 3.4), r.zTop - 1.0],
        radius: 0.9,
        label: story.label,
        text: story.text,
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
