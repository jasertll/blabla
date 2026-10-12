import * as THREE from "three";
import { audio } from "./audio";
import { PHONE_CALL, PHONE_DEAD, RADIO } from "./config/story";
import { runtime, useGame, type PlayFloor } from "./store";

// Scripted moments. Each fires once (remembered in saved flags) unless noted.

const timers = new Set<number>();
const later = (ms: number, fn: () => void) => {
  const id = window.setTimeout(() => {
    timers.delete(id);
    fn();
  }, ms);
  timers.add(id);
};

/** Cancel everything pending (on floor change). */
export function clearEvents() {
  timers.forEach((id) => window.clearTimeout(id));
  timers.clear();
  phone.ringing = false;
  audio.phoneRing(false);
}

/** Lines spoken one after another, each with its own garbled voice. */
function speakLines(who: string, lines: string[], pitch: number, onDone?: () => void) {
  let at = 0;
  for (const line of lines) {
    const len = Math.max(1.6, line.length * 0.06);
    later(at * 1000, () => {
      audio.voice(len, pitch);
      useGame.getState().speak(who, line);
    });
    at += len + 0.9;
  }
  later(at * 1000, () => {
    useGame.getState().speak(who, null);
    onDone?.();
  });
}

// ------------------------------------------------------------------ arriving on a floor

export function arriveOn(floor: PlayFloor) {
  clearEvents();
  const g = useGame.getState();
  useGame.getState().speak("", null);
  const radio = RADIO[floor];
  if (radio && !g.flags.includes(`radio:${floor}`)) {
    later(radio.delay * 1000, () => {
      const s = useGame.getState();
      if (s.floor !== floor) return;
      s.flag(`radio:${floor}`);
      speakLines("RADIO", radio.lines, 150);
    });
  }
  if (floor === "3F" && !g.flags.includes("phone-answered")) later(3500, () => startRinging());
}

// ------------------------------------------------------------------ the phone

export const phone = { ringing: false };

function startRinging() {
  if (useGame.getState().floor !== "3F") return;
  phone.ringing = true;
  audio.phoneRing(true, 0.3);
  later(2500, () => useGame.getState().say("A phone. Ringing. In a hospital that has been closed for years."));
}

export function answerPhone() {
  const g = useGame.getState();
  if (!phone.ringing) {
    audio.click();
    g.say(PHONE_DEAD);
    return;
  }
  phone.ringing = false;
  audio.phoneRing(false);
  audio.click();
  g.flag("phone-answered");
  runtime.path = [];
  later(900, () =>
    speakLines("ELENA (phone)", PHONE_CALL, 230, () => {
      audio.click();
      useGame.getState().say("…That was her voice. I'd know it anywhere. The cord isn't even connected to the wall.");
    }),
  );
}

// ------------------------------------------------------------------ the mirror

export function mirrorChange() {
  const g = useGame.getState();
  if (g.flags.includes("mirror-changed")) {
    g.say("Just me again. The writing on the glass is still there.");
    return;
  }
  g.flag("mirror-changed");
  runtime.focus = { cam: new THREE.Vector3(-7.6, 1.6, -0.5), look: new THREE.Vector3(-7.6, 1.5, 0.9) };
  later(4200, () => (runtime.focus = null));
  audio.stinger();
  runtime.shake = 0.9;
  later(1500, () => useGame.getState().say("That wasn't my face. For a second it was hers, and she was saying my name."));
}

// ------------------------------------------------------------------ the cell

export function cellEmptied() {
  const g = useGame.getState();
  if (g.flags.includes("cell-empty")) return;
  g.flag("cell-empty");
  audio.metalScrape();
  later(1200, () => useGame.getState().say("…She was right there. I'm sure she was right there."));
}

export function cellText() {
  return useGame.getState().flags.includes("cell-empty")
    ? "The cell is empty. The door is locked from the inside. There's a hospital bracelet on the floor: VOSS, E."
    : "She won't turn around. Her shoulders are shaking, or she's laughing.";
}
