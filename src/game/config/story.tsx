import type { PlayFloor } from "../store";

// The story. Elena Voss, a network analyst at Brookhaven, disappeared three
// years ago. You got a letter in her handwriting: the network inside is still
// running, come and find me. Every instrument in the building is a way of
// finding out what happened to her, and in the end, what happened to you.

export interface Memo {
  found: string;
  body: React.ReactNode;
  /** Shown as a handwritten line under the typed text. */
  sign?: string;
}

export const MEMOS: Record<string, Memo> = {
  "memo-lobby": {
    found: "the letter. You've read it a hundred times",
    body: (
      <>
        <p>I know you stopped waiting for me. I don&apos;t blame you.</p>
        <p className="mt-3">
          I&apos;m in Brookhaven. They closed it, but the network inside never went down. It still listens to every phone that comes
          through the door. It listened to yours.
        </p>
        <p className="mt-3">
          Don&apos;t believe the envelope. Read where it&apos;s been. Every letter remembers the road it took, if you know how to ask it.
        </p>
        <p className="mt-3">Come and find me.</p>
      </>
    ),
    sign: "— E.",
  },
  "diary-201": {
    found: "a diary under the mattress, room 201",
    body: (
      <>
        <p>Day 1. They say I&apos;m a patient now. Yesterday I had a badge and a desk on the fourth floor.</p>
        <p className="mt-3">Day 4. The terminal in this room isn&apos;t plugged into anything. It knows my name anyway.</p>
        <p className="mt-3">Day 9. Somebody told them I&apos;d been inside LANTERN. Only one person knew. He still comes on Thursdays. He can&apos;t look at me.</p>
        <p className="mt-3">Day 12. I hid what I know in the photograph, the way he taught me. Not on the photo. In it.</p>
        <p className="mt-5 italic">Day ?. Don&apos;t look in the mirror after you read this. It isn&apos;t yours any more.</p>
      </>
    ),
  },
  "intake-elena": {
    found: "an intake card, left by the phone",
    body: (
      <>
        <p className="tracking-widest">BROOKHAVEN HOSPITAL — INTAKE</p>
        <p className="mt-3">NAME: VOSS, Elena</p>
        <p>OCCUPATION: Network analyst (staff, access revoked)</p>
        <p>ADMITTED BY: order of the Director</p>
        <p className="mt-3">COMPLAINT: Patient claims the hospital network records every patient, every visitor, every device that connects.</p>
        <p className="mt-3">VISITORS: one. Thursdays. Name: D. M——. The rest is scratched out so hard the pen went through the card.</p>
        <p className="mt-3">DISCHARGE: —</p>
      </>
    ),
    sign: "transferred to B1",
  },
  "director-lantern": {
    found: "papers on the Director's desk",
    body: (
      <>
        <p>Board of Trustees,</p>
        <p className="mt-3">
          Project LANTERN performs as promised. Every device that joins our network is fingerprinted, every account linked to a face,
          every face to a name.
        </p>
        <p className="mt-3">
          Ms. Voss found the collection servers. We were told by someone close to her, and acted. The minutes of that session are enclosed;
          our contractor kept them himself. His name is on them, though not where you would look.
        </p>
      </>
    ),
    sign: "— H. Kessler, Director",
  },
  "autopsy-report": {
    found: "an autopsy report on a clipboard, B101",
    body: (
      <>
        <p className="tracking-widest">POST-MORTEM — CASE 0201</p>
        <p className="mt-3">Female, approx. 30. Cause of death: not determined. The staff will not say how long she was in the cell.</p>
        <p className="mt-3">
          In her right hand, a phone. Battery dead, but its last network capture survived on the storage. It shows her signing in to
          something called LANTERN, the night before she was moved downstairs.
        </p>
        <p className="mt-3">The capture has been copied to this file. Whoever reads it: she typed her password in the open.</p>
      </>
    ),
  },
  "elena-tape": {
    found: "a transcript and a drive, in the reel case",
    body: (
      <>
        <p className="italic">[recording begins — heavy static]</p>
        <p className="mt-3">If you&apos;re listening, you remembered the light. Good.</p>
        <p className="mt-3">
          This drive holds the thing LANTERN puts on every phone. I wrote a rule to catch it before they caught me. Run it. Read what the
          implant was told to do, and who told it.
        </p>
        <p className="mt-3">There&apos;s a task in there with your name on it. I&apos;m sorry. I wanted you to find it yourself.</p>
        <p className="mt-3 italic">[recording ends]</p>
      </>
    ),
  },
  "elena-final": {
    found: "a note pinned under a stone, on the ledge",
    body: (
      <>
        <p>You told them. I know you were scared. I know you thought they&apos;d only take my badge.</p>
        <p className="mt-3">
          Then you stopped coming, and LANTERN missed you. So it wrote to you in my voice, from your own phone, at 4:17, and you came back.
          You always come back.
        </p>
        <p className="mt-3">I&apos;m not angry. Turn it off. The kill switch is the word you used for me.</p>
        <p className="mt-3">Then go home, and leave a light on.</p>
      </>
    ),
    sign: "— Elena",
  },
};

/** What the radio says the first time you arrive on each floor. */
export const RADIO: Partial<Record<PlayFloor, { delay: number; lines: string[] }>> = {
  "1F": { delay: 22, lines: ["…four… one… seven…", "…every device that walks through that door, we keep."] },
  "2F": { delay: 9, lines: ["Two-oh-one. You used to sit by the bed on Thursdays.", "You never looked at her. You looked at your phone."] },
  "3F": { delay: 40, lines: ["Her file is still open. Somebody keeps reading it at 4:17."] },
  "4F": { delay: 7, lines: ["LANTERN sees everything.", "It saw you come in. It has been expecting you since the last Thursday."] },
  B1: { delay: 6, lines: ["It's cold down here.", "Don't stare at the cell. She never liked being watched. That was the whole point."] },
  B2: { delay: 6, lines: ["Six letters.", "A small light. Enough to see by. Not enough to be seen."] },
  ROOF: { delay: 5, lines: ["You can see the whole town from up here.", "Every lit window is a device. Can you find yours?"] },
};

export const PHONE_CALL = [
  "…you're late. It's Thursday. You always come on Thursday.",
  "I left you something in my room. In the picture, not on it.",
  "And the letter… look at where it came from. Please. Before you look for me.",
];

export const PHONE_DEAD = "The line is dead. By the look of the cord, it has been dead for years.";
