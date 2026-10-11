// Shared shapes for the 2D world. Extended from the first vertical slice
// (one hardcoded room) into a small data-driven Room registry, so adding
// room #3, #4... is "write a config + a background component," not
// duplicating WorldScene's game-loop/camera/input logic per room.
import type { ToolId } from "@/contexts/InvestigationContext";
import type { ComponentType } from "react";

export type Vec2 = { x: number; y: number };

export type Facing = "left" | "right";

export type PlayerState = {
  pos: Vec2;
  facing: Facing;
  moving: boolean;
};

// A single interactive object in a room (today: always a terminal).
// `toolId` is what it opens in Investigation Mode — always a real,
// already-wired ToolId, never a placeholder/fake destination.
export type InteractiveObject = {
  id: string;
  pos: Vec2;
  radius: number; // proximity-interact distance, in world units
  label: string; // shown in the "[E] INVESTIGATE" prompt
  toolId: ToolId;
};

// A door is also proximity-triggered (same interact model as a terminal)
// but moves the player to another room instead of opening a tool.
export type Door = {
  id: string;
  pos: Vec2;
  radius: number;
  toRoomId: string;
  // Where the player appears in the destination room — keeps the walk
  // continuous (arrive near the matching door on the other side) instead
  // of resetting to that room's own start position every time.
  arrivesAt: Vec2;
  arrivesFacing: Facing;
};

export type RoomConfig = {
  id: string;
  name: string; // shown in the room's header bar, e.g. "THE ARCHIVE"
  width: number;
  height: number;
  // Each room gets its own hand-authored background (lighting/set
  // dressing distinct per room, per the audit's §51 — a terminal hall
  // shouldn't look identical to an archive) rather than one shared
  // background component parameterized by color.
  Background: ComponentType<{ cameraX: number }>;
  objects: InteractiveObject[];
  doors: Door[];
};
