# Brookhaven Hospital

A fog-bound 3D hospital where every room holds a security tool. Inspired by the atmosphere of Silent Hill 2. Design decisions live in [DESIGN_SPEC.md](./DESIGN_SPEC.md).

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
```

Best on a desktop browser with a real GPU and headphones.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move (relative to the camera) |
| Shift | Run |
| Click | Capture the mouse to look around (Esc releases) |
| E | Examine / use |
| M | Map. Click a place and the character walks there, including elevator rides |
| N | Nightmare mode on/off |
| Esc | Close the current panel or tool |

## What's in the prototype

- **Title**: fog screen with the hospital name, New Game / Continue.
- **Intro**: about 14 seconds walking through the fog to the front doors, with subtitles. Can be skipped.
- **1F Reception**: a wall of CRT monitors and the ThreatGlobe hologram (Overview), the cassette recorder, a memo, the red-square save point and the elevator.
- **2F Investigation Ward**: corridor, room 201 with the IP / ASN Analyzer terminal, and locked doors for rooms 202–206.
- **Character**: over-the-shoulder camera in corridors, fixed cinematic angles in rooms, chest flashlight with real shadows and a visible beam in the dust.
- **Creatures**: faceless figures that wander and recoil from the flashlight, a tall helmeted watcher in Nightmare mode, and shadows that fade in and out of the fog.
- **Otherworld**: siren, then walls rust, the floor turns to grating and lights go red. Triggered by a critical finding (there's a demo button in each tool) or kept on with Nightmare mode.
- **Sound**: everything is synthesized live (drone, wind, footsteps, radio static, heartbeat, siren, elevator), so there are no audio assets.
- **Radio**: static rises as creatures get close. The HUD meter mirrors it.
- **Save**: the red square saves your floor, position and visited rooms in the browser.

## Extending

| To add… | Edit |
| --- | --- |
| A tool | `src/game/config/rooms.config.ts` (registry of all 26 tools + Overview) |
| A room / floor | `src/game/level.ts` (walls, colliders, interactables, camera zones, walk graph) and its props in `src/game/scene/Building.tsx` |
| Music tapes | drop files in `public/audio/tapes/` and list them in `src/game/config/tapes.config.ts` |
| Real 3D models | put `.glb` files in `public/models/` (loader to be wired when models are chosen) |

### Merging the tools from the original site

Each tool opens in `ToolOverlay` (`src/game/ui/Hud.tsx`). The `ToolMount` component is the mount point: map each `toolId` to the existing React component from the original Next.js 16 / React 19 / Tailwind site and render it there. The stack is the same, so components drop in unchanged.

`window.__brookhaven` exposes the game store for debugging.
