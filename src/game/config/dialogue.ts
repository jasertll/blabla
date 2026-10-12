// People in the building. Each script is a small graph: lines are spoken in
// order, then either the conversation ends or you choose what to say.

export interface Line {
  who: "npc" | "you";
  text: string;
}

export interface DNode {
  lines: Line[];
  choices?: { label: string; next: string }[];
  next?: string;
  /** Flag set when this node is reached. */
  set?: string;
}

export interface Script {
  name: string;
  /** Pitch of the garbled voice under the subtitles. */
  pitch: number;
  start: (flags: string[]) => string;
  nodes: Record<string, DNode>;
}

export const DIALOGUE: Record<string, Script> = {
  walter: {
    name: "WALTER",
    pitch: 120,
    start: (f) => (f.includes("solved:capture") && !f.includes("walter:capture") ? "capture" : f.includes("met:walter") ? "again" : "meet"),
    nodes: {
      meet: {
        lines: [
          { who: "npc", text: "Don't. Don't come any closer with that thing in your pocket." },
          { who: "you", text: "What thing?" },
          { who: "npc", text: "Your phone. Is it on? It listens here. Everything that touches the Wi-Fi in this building, it remembers." },
        ],
        choices: [
          { label: "Who are you?", next: "who" },
          { label: "I'm looking for a woman. Elena Voss.", next: "elena" },
          { label: "Phones don't listen.", next: "skeptic" },
        ],
      },
      who: {
        lines: [
          { who: "npc", text: "Walter. I kept the boilers running here, before. Now I keep the lights from going out. Somebody has to." },
          { who: "npc", text: "The ones out there don't like light. Remember that." },
        ],
        choices: [
          { label: "Have you seen Elena Voss?", next: "elena" },
          { label: "I have to go.", next: "close" },
        ],
      },
      elena: {
        lines: [
          { who: "npc", text: "Voss. Network girl, fourth floor. She told me the same thing I'm telling you: keep it off. Then one day they made her a patient." },
          { who: "npc", text: "Room two-oh-one. You'd know that, though. Wouldn't you." },
          { who: "you", text: "Why would I know that?" },
          { who: "npc", text: "Because you came every Thursday. Same coat. Same face. You never looked at me once." },
        ],
        next: "close",
      },
      skeptic: {
        lines: [
          { who: "npc", text: "Ha. Then why's yours been warm since you walked in?" },
          { who: "npc", text: "That letter you're holding. Ask it where it came from. Not who signed it. Where it came from." },
        ],
        next: "close",
      },
      close: {
        lines: [
          { who: "npc", text: "Elevator works, mostly. If you hear the siren, don't run toward the light. Get away from it." },
          { who: "npc", text: "And if something comes at you, hit it until it stops moving. They don't stop on their own." },
        ],
        set: "met:walter",
      },
      again: {
        lines: [{ who: "npc", text: "Still carrying it? That phone's like a lantern. Whatever's out there can see it from a mile off." }],
      },
      capture: {
        lines: [
          { who: "npc", text: "You went down to the morgue. I can smell it on you. Did her phone talk?" },
        ],
        choices: [
          { label: "Her password was \"candle\".", next: "candle" },
          { label: "Someone was leaking the visitor log.", next: "leak" },
        ],
      },
      candle: {
        lines: [
          { who: "npc", text: "Candle. She used to say one small light is enough to see by, and too small to be seen." },
          { who: "npc", text: "There's a case in the archive, B2. She never let me touch it." },
        ],
        set: "walter:capture",
      },
      leak: {
        lines: [
          { who: "npc", text: "Somebody. Sure. Somebody with a phone, every Thursday." },
          { who: "npc", text: "She hid something in the archive, B2. Use the word she lived by." },
        ],
        set: "walter:capture",
      },
    },
  },

  elena: {
    name: "ELENA",
    pitch: 230,
    start: () => "e1",
    nodes: {
      e1: {
        lines: [
          { who: "npc", text: "You still stop at the door. Even now." },
          { who: "you", text: "Elena? Elena, I've been looking for you for three years." },
          { who: "npc", text: "No. You've been looking for a way not to find me." },
        ],
        choices: [
          { label: "What happened to you?", next: "happened" },
          { label: "Who did this to you?", next: "who" },
          { label: "Come with me. We're leaving.", next: "leave" },
        ],
      },
      happened: {
        lines: [
          { who: "npc", text: "I looked inside LANTERN. Somebody told the Director. I woke up in this bed." },
          { who: "npc", text: "Then I woke up downstairs, and I didn't wake up again." },
        ],
        next: "end",
      },
      who: {
        lines: [{ who: "npc", text: "You already have everything you need to answer that. It's in the data. It always was." }],
        next: "end",
      },
      leave: {
        lines: [{ who: "npc", text: "Leave? You never could. You keep coming back on Thursdays." }],
        next: "end",
      },
      end: {
        lines: [{ who: "npc", text: "The photograph. Don't look at it. Look in it." }],
        set: "met:elena",
      },
    },
  },

  director: {
    name: "DIRECTOR KESSLER (intercom)",
    pitch: 95,
    start: (f) => (f.includes("met:director") ? "again" : "d1"),
    nodes: {
      d1: {
        lines: [
          { who: "npc", text: "Mr. Morrow. You're late. The session started without you, as they always do." },
          { who: "you", text: "Who is this?" },
          { who: "npc", text: "You took the minutes yourself. Surely you remember the chair you sat in." },
        ],
        choices: [
          { label: "Where is Elena?", next: "where" },
          { label: "I've never worked here.", next: "never" },
        ],
      },
      where: {
        lines: [
          { who: "npc", text: "Exactly where you put her. LANTERN keeps very good records, Mr. Morrow. It kept yours." },
        ],
        next: "bye",
      },
      never: {
        lines: [
          { who: "npc", text: "Then why does the building know your phone by name?" },
        ],
        next: "bye",
      },
      bye: {
        lines: [{ who: "npc", text: "The minutes are on my desk. Read the properties. People always forget the properties." }],
        set: "met:director",
      },
      again: {
        lines: [{ who: "npc", text: "[static] …the properties, Mr. Morrow…" }],
      },
    },
  },
};
