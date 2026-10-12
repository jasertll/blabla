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
    found: "on the bench. The same letter that is folded in your jacket",
    body: (
      <>
        <p>I know you stopped waiting for me. I don&apos;t blame you.</p>
        <p className="mt-3">
          I&apos;m in Brookhaven. They closed it, but the network inside never went down. Every night the terminals wake up and start
          looking for people. Addresses. Names. Faces. They found me first.
        </p>
        <p className="mt-3">
          Each room keeps one of the instruments. Use them the way I taught you. Everything that happened here left a trace, and traces
          don&apos;t lie, even when people do.
        </p>
        <p className="mt-3">If the radio starts to hiss, turn your light toward it.</p>
      </>
    ),
    sign: "— E.",
  },
  "diary-201": {
    found: "pages torn from a diary, room 201",
    body: (
      <>
        <p>Day 3. The nurse says the terminal in my room isn&apos;t plugged into anything. Then how does it know my name?</p>
        <p className="mt-3">Day 9. Tonight it printed every address on my street. Only the houses with their lights on.</p>
        <p className="mt-3">Day 14. Elena from the network office came. She said the terminal isn&apos;t the problem. She said someone upstairs is watching through it.</p>
        <p className="mt-3">Day 15. She didn&apos;t come back.</p>
        <p className="mt-5 italic">Day ?. There&apos;s a mirror over the sink. Don&apos;t look at it after reading this.</p>
      </>
    ),
  },
  "intake-elena": {
    found: "an intake card, left on the nurse station",
    body: (
      <>
        <p className="tracking-widest">BROOKHAVEN HOSPITAL — INTAKE</p>
        <p className="mt-3">NAME: VOSS, Elena</p>
        <p>OCCUPATION: Network analyst (staff)</p>
        <p>ADMITTED: by order of the Director</p>
        <p className="mt-3">PRESENTING COMPLAINT: Patient claims the hospital network is recording every patient, every visitor, every device that connects.</p>
        <p className="mt-3">VISITORS: one. Every Thursday. Name field scratched out so hard the pen went through the card.</p>
        <p className="mt-3">DISCHARGE: —</p>
      </>
    ),
    sign: "transferred to B1",
  },
  "director-lantern": {
    found: "a letter on the Director's desk, never sent",
    body: (
      <>
        <p>Board of Trustees,</p>
        <p className="mt-3">
          Project LANTERN performs as promised. Every device that joins the hospital network is fingerprinted, every account is linked to a
          face, and every face is linked to a name. We know our patients better than their families do.
        </p>
        <p className="mt-3">
          Ms. Voss in Network found the collection servers. She has been reassigned to the patient wards for her own wellbeing, and her
          access revoked.
        </p>
        <p className="mt-3">
          One complication: someone keeps visiting her. They connect their phone to the guest network every Thursday. LANTERN has them now
          too.
        </p>
      </>
    ),
    sign: "— Director",
  },
  "autopsy-report": {
    found: "an autopsy report on a clipboard, B101",
    body: (
      <>
        <p className="tracking-widest">POST-MORTEM — CASE 0417</p>
        <p className="mt-3">Unidentified female, approx. 30. Cause of death: not determined.</p>
        <p className="mt-3">
          Identification by dental records failed. Identification was made instead from the device found in her hand: a phone, battery
          dead, still connected to the hospital guest network.
        </p>
        <p className="mt-3">The phone is not hers. It is registered to her only visitor.</p>
        <p className="mt-5 italic">Note: the email header on the letter in the phone&apos;s outbox should be examined. Sent 4:17 a.m.</p>
      </>
    ),
  },
  "elena-tape": {
    found: "a transcript taped to a reel, the Archive",
    body: (
      <>
        <p className="italic">[recording begins — heavy static]</p>
        <p className="mt-3">If you&apos;re listening, you came. I knew you would. You always came on Thursdays.</p>
        <p className="mt-3">
          But listen to me. I didn&apos;t write that letter. I couldn&apos;t have. By the time it was sent I&apos;d been down here for a long
          time.
        </p>
        <p className="mt-3">Check who sent it. Check the headers. Check the metadata on the photographs. The network remembers everything, even the things you&apos;ve decided to forget.</p>
        <p className="mt-3 italic">[a long silence] …I&apos;m on the roof. I&apos;m always on the roof.</p>
        <p className="mt-3 italic">[recording ends]</p>
      </>
    ),
  },
  "elena-final": {
    found: "a note pinned under a stone, on the ledge",
    body: (
      <>
        <p>You kept looking for me in other people&apos;s data.</p>
        <p className="mt-3">The letter was sent from your phone, at 4:17, the night you stopped visiting. The account that logs in every night with my name is yours. It always was.</p>
        <p className="mt-3">I&apos;m not angry. I just want you to stop looking for me, and look at your own data.</p>
        <p className="mt-3">Go home. Leave the light on.</p>
      </>
    ),
    sign: "— Elena",
  },
};

/** What the radio says the first time you arrive on each floor. */
export const RADIO: Partial<Record<PlayFloor, { delay: number; lines: string[] }>> = {
  "1F": { delay: 22, lines: ["…is anyone receiving… Brookhaven…", "…the network is still running…"] },
  "2F": { delay: 9, lines: ["Room two-oh-one.", "You remember the room. You used to sit by the bed."] },
  "4F": { delay: 7, lines: ["LANTERN sees everything.", "LANTERN saw you come in. It's been expecting you since Thursday."] },
  B1: { delay: 6, lines: ["It's cold down here.", "Don't look at the cell for too long. She doesn't like being looked at."] },
  B2: { delay: 6, lines: ["Play the tape.", "Please. Play the tape."] },
  ROOF: { delay: 5, lines: ["You can see the whole town from up here.", "Can you see yourself?"] },
};

export const PHONE_CALL = [
  "…you're late. It's Thursday. You always come on Thursday.",
  "They moved me downstairs. Below the morgue the lights still work.",
  "Don't trust the logs. They were written after I was gone.",
];

export const PHONE_DEAD = "The line is dead. By the look of the cord, it has been dead for years.";
