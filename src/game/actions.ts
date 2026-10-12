import * as THREE from "three";
import { audio } from "./audio";
import { answerPhone, cellText, mirrorChange } from "./events";
import { findPath, layoutFor, nearestNode, type Interactable } from "./level";
import { runtime, useGame, type PlayFloor } from "./store";

let riding = false;

export function rideElevator(target: PlayFloor) {
  const g = useGame.getState();
  if (riding || target === g.floor) {
    g.setOverlay(null);
    return;
  }
  riding = true;
  g.setOverlay(null);
  const seconds = 3;
  audio.elevator(seconds);
  g.setFade(1);
  runtime.shake = 0.6;
  window.setTimeout(() => {
    const layout = layoutFor(target)!;
    useGame.getState().setFloor(target);
    runtime.pos.set(layout.elevatorSpawn.at[0], 0, layout.elevatorSpawn.at[1]);
    runtime.yaw = layout.elevatorSpawn.yaw;
    runtime.camYaw = layout.elevatorSpawn.yaw;
  }, 900);
  window.setTimeout(() => {
    const s = useGame.getState();
    s.setFade(0);
    riding = false;
  }, seconds * 1000);
}

export const isRiding = () => riding;

/** Walk (and ride) to a node anywhere in the hospital. */
export function travelTo(floor: PlayFloor, node: string) {
  const g = useGame.getState();
  const here = layoutFor(g.floor);
  const there = layoutFor(floor);
  if (!here || !there) return;
  const start = nearestNode(here, runtime.pos.x, runtime.pos.z);
  const steps: typeof runtime.path = [];
  if (floor === g.floor) {
    for (const n of findPath(here, start, node)) steps.push({ floor, x: here.nodes[n][0], z: here.nodes[n][1] });
  } else {
    const toLift = findPath(here, start, "elevator");
    toLift.forEach((n, i) =>
      steps.push({ floor: g.floor, x: here.nodes[n][0], z: here.nodes[n][1], ride: i === toLift.length - 1 ? floor : undefined }),
    );
    for (const n of findPath(there, "elevator", node)) steps.push({ floor, x: there.nodes[n][0], z: there.nodes[n][1] });
  }
  runtime.path = steps;
  g.setOverlay(null);
}

/** Click on the floor: walk straight there (walls still block). */
export function walkTo(x: number, z: number) {
  const g = useGame.getState();
  if (g.phase !== "play" || g.overlay || g.activeTool) return;
  runtime.path = [{ floor: g.floor, x, z }];
  runtime.marker = { x, z, t: performance.now() };
}

export function interact(i: Interactable) {
  const g = useGame.getState();
  runtime.path = [];
  switch (i.kind) {
    case "tool":
      if (!i.toolId) return;
      audio.blip();
      if (i.focus) runtime.focus = { cam: new THREE.Vector3(...i.focus.cam), look: new THREE.Vector3(...i.focus.look) };
      if (i.room) g.visit(i.room);
      g.openTool(i.toolId);
      break;
    case "cassette":
      audio.blip();
      if (i.focus) runtime.focus = { cam: new THREE.Vector3(...i.focus.cam), look: new THREE.Vector3(...i.focus.look) };
      g.setOverlay("cassette");
      break;
    case "elevator":
      audio.locked();
      g.setOverlay("elevator");
      break;
    case "locked":
      audio.locked();
      if (i.text) g.say(i.text);
      break;
    case "memo":
      audio.blip();
      runtime.memoId = i.id;
      g.flag(`read:${i.id}`);
      g.setOverlay("memo");
      break;
    case "save":
      g.save();
      audio.blip();
      g.say("Your progress has been saved.");
      break;
    case "message":
      if (i.id === "mirror-201" && g.flags.includes("read:diary-201")) mirrorChange();
      else if (i.id === "cell-b1") g.say(cellText());
      else if (i.text) g.say(i.text);
      break;
    case "phone":
      answerPhone();
      break;
  }
}

export function closeOverlay() {
  runtime.focus = null;
  useGame.getState().setOverlay(null);
}

/** The siren wails, then the world peels away for a while. */
export function otherworldEvent(seconds = 35) {
  audio.siren(9);
  window.setTimeout(() => {
    audio.stinger();
  }, 2600);
  window.setTimeout(() => useGame.getState().triggerOtherworld(seconds * 1000), 4000);
}

export function toggleNightmare() {
  const g = useGame.getState();
  if (g.nightmare) {
    g.toggleNightmare();
    return;
  }
  audio.stinger();
  window.setTimeout(() => useGame.getState().toggleNightmare(), 1300);
}
