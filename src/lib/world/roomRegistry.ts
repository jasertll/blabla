import TerminalHallBackground from "@/components/world/rooms/TerminalHallBackground";
import ArchiveBackground from "@/components/world/rooms/ArchiveBackground";
import type { RoomConfig } from "@/lib/world/types";

// Two connected rooms — proves the room-template pattern generalizes
// (not just one hardcoded room) before it's repeated across the
// remaining tools. Adding room #3 is: a new Background component, a new
// entry here, and a door linking it to an existing room — no changes to
// WorldScene's game loop, camera, or input handling.
export const ROOMS: Record<string, RoomConfig> = {
  "terminal-hall": {
    id: "terminal-hall",
    name: "THE TERMINAL HALL",
    width: 2200,
    height: 560,
    Background: TerminalHallBackground,
    objects: [{ id: "terminal-ip", pos: { x: 1860, y: 300 }, radius: 110, label: "IP / ASN INTELLIGENCE TERMINAL", toolId: "ip" }],
    doors: [
      {
        id: "door-to-archive",
        pos: { x: 2170, y: 300 },
        radius: 100,
        toRoomId: "archive",
        arrivesAt: { x: 90, y: 300 },
        arrivesFacing: "right",
      },
    ],
  },
  archive: {
    id: "archive",
    name: "THE ARCHIVE",
    width: 2200,
    height: 560,
    Background: ArchiveBackground,
    objects: [{ id: "console-domain", pos: { x: 1050, y: 300 }, radius: 110, label: "DOMAIN & URL RECORDS CONSOLE", toolId: "domain" }],
    doors: [
      {
        id: "door-to-hall",
        pos: { x: 30, y: 300 },
        radius: 100,
        toRoomId: "terminal-hall",
        arrivesAt: { x: 2110, y: 300 },
        arrivesFacing: "left",
      },
    ],
  },
};

export const START_ROOM_ID = "terminal-hall";
