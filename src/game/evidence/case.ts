import { useGame } from "../store";
import type { GraphEdgeData, GraphNodeData } from "@/lib/intelligenceGraph";
import { implantBinary, LANTERN_RULE, letterEml, minutesPdf, PASSWORD, phoneCapture, VISITOR, VISITOR_PHONE, wardPhoto } from "./make";

// The case: five pieces of evidence, each found somewhere in the building,
// each opened with one of the real instruments, each answering one question.
// Answer them all and the note on the roof can be read.

export interface Evidence {
  id: string;
  file: string;
  /** Reading this memo puts the evidence in your pocket. */
  foundIn: string;
  foundWhere: string;
  /** rooms.config tool id that can read it. */
  tool: string;
  also?: string[];
  make: () => Promise<File>;
  /** Buttons (by visible text) to press inside the instrument before / after loading. */
  before?: string;
  after?: string;
  /** Extra text the instrument needs (a YARA rule). */
  companion?: { label: string; text: string };
  question: string;
  options?: string[];
  answer: number | string;
  /** Said when you get it right: what the trace showed. */
  reveal: string;
  /** The radio's reply. */
  radio: string;
  next: string;
  graph: { nodes: GraphNodeData[]; edges: GraphEdgeData[] };
}

const file = (parts: BlobPart[], name: string, type: string) => new File(parts, name, { type });
const rel = (source: string, target: string): GraphEdgeData => ({ id: `${source}->${target}`, source, target, relationship: "RELATED_TO" });

export const CASE: Evidence[] = [
  {
    id: "letter",
    file: "letter_from_elena.eml",
    foundIn: "memo-lobby",
    foundWhere: "1F · the letter",
    tool: "email-header",
    make: async () => file([letterEml()], "letter_from_elena.eml", "message/rfc822"),
    question: "Read the Received headers from the bottom up. Where was the letter really sent from?",
    options: ["Elena's home, through her own mail provider", "A spam relay overseas", "Inside Brookhaven: room 201, on the guest Wi-Fi", "It was never sent; it was hand-delivered"],
    answer: 2,
    reveal: "First hop: 10.4.17.201, room 201's guest network. 04:17. SPF failed. The device that sent it is called Morrow-iPhone. That's my phone.",
    radio: "…you finally read the headers. Now go and sit where you used to sit. Two-oh-one.",
    next: "Go to room 201 (2F) and read what she left.",
    graph: {
      nodes: [
        { id: "e.voss@ashfield-mail.net", type: "email", label: "e.voss@ashfield-mail.net", detail: "Forged sender: SPF fail" },
        { id: "10.4.17.201", type: "ip", label: "10.4.17.201", detail: "Room 201, guest Wi-Fi" },
        { id: VISITOR_PHONE, type: "username", label: VISITOR_PHONE, detail: "The device that sent the letter" },
      ],
      edges: [rel(VISITOR_PHONE, "10.4.17.201"), rel("10.4.17.201", "e.voss@ashfield-mail.net")],
    },
  },
  {
    id: "photo",
    file: "room201_0417.png",
    foundIn: "diary-201",
    foundWhere: "2F · tucked in the diary",
    tool: "stego",
    make: async () => file([await wardPhoto()], "room201_0417.png", "image/png"),
    question: "There's something in the pixels. Where does the hidden message send you?",
    options: ["To her phone, in the morgue (B1)", "To the roof", "To the Director's office", "Nowhere: the image is clean"],
    answer: 0,
    reveal: "A message in the least significant bits: “The capture is still on my phone. They put my phone in the morgue with me. B1.”",
    radio: "Cold hands hold on to things. Look at what's in hers.",
    next: "Go down to the morgue (B1) and find her.",
    graph: { nodes: [{ id: "room201_0417.png", type: "file", label: "room201_0417.png", detail: "LSB message from Elena" }], edges: [rel("room201_0417.png", "e.voss@ashfield-mail.net")] },
  },
  {
    id: "capture",
    file: "elena_phone.pcap",
    foundIn: "autopsy-report",
    foundWhere: "B1 · the phone in her hand",
    tool: "pcap",
    make: async () => file([phoneCapture() as BlobPart], "elena_phone.pcap", "application/vnd.tcpdump.pcap"),
    question: "She logged into LANTERN from her phone, over plain HTTP. What was her password?",
    answer: PASSWORD,
    reveal: "user=e.voss, pass=candle, in the clear. Then long DNS names leaking out, label by label: “visitor-0417 … morrow-iphone … every thursday.”",
    radio: "Candle. A small light. She always said one was enough.",
    next: "The Archive in B2 is locked behind a keypad.",
    graph: {
      nodes: [
        { id: "lantern.brookhaven.local", type: "domain", label: "lantern.brookhaven.local", detail: "LANTERN console" },
        { id: "10.4.17.5", type: "ip", label: "10.4.17.5", detail: "LANTERN server" },
        { id: "e.voss", type: "username", label: "e.voss", detail: "password: candle (cleartext)" },
      ],
      edges: [rel("lantern.brookhaven.local", "10.4.17.5"), rel("e.voss", "lantern.brookhaven.local"), rel(VISITOR_PHONE, "lantern.brookhaven.local")],
    },
  },
  {
    id: "implant",
    file: "lantern_implant.bin",
    foundIn: "elena-tape",
    foundWhere: "B2 · inside the reel case",
    tool: "yara",
    also: ["malware"],
    make: async () => file([implantBinary() as BlobPart], "lantern_implant.bin", "application/octet-stream"),
    companion: { label: "LANTERN_Implant.yar", text: LANTERN_RULE },
    question: "Match the implant, then read its strings. Who operates LANTERN?",
    options: ["Elena Voss", "Director Kessler", "D. Morrow", "Nobody: it runs itself"],
    answer: 1,
    reveal: "operator=DIRECTOR_KESSLER. And one task, still pending: compose_mail(from=e.voss, to=self, at=04:17). It wrote the letter from my phone.",
    radio: "The Director kept the minutes of everything. Fourth floor. Read the properties, not the page.",
    next: "Find the minutes in the Director's office (4F).",
    graph: {
      nodes: [
        { id: "lantern_implant.bin", type: "file", label: "lantern_implant.bin", detail: "YARA: LANTERN_Implant" },
        { id: "DIRECTOR_KESSLER", type: "username", label: "DIRECTOR_KESSLER", detail: "LANTERN operator" },
      ],
      edges: [rel("lantern_implant.bin", "lantern.brookhaven.local"), rel("DIRECTOR_KESSLER", "lantern_implant.bin")],
    },
  },
  {
    id: "minutes",
    file: "lantern_minutes.pdf",
    foundIn: "director-lantern",
    foundWhere: "4F · the Director's desk",
    tool: "pdf",
    before: "فحص جنائي",
    after: "تنفيذ:",
    make: async () => file([await minutesPdf()], "lantern_minutes.pdf", "application/pdf"),
    question: "The page won't say who took the minutes. The document's properties will. Who reported Elena?",
    options: ["Director Kessler", "A nurse on ward 2", `${VISITOR}: me`, "Elena reported herself"],
    answer: 2,
    reveal: `Author: ${VISITOR}. I took the minutes. I told them she'd been in the console. I'm the reason she was in room 201.`,
    radio: "Now you know why you knew where the elevator was. Come up. I'm on the roof.",
    next: "Go to the roof.",
    graph: { nodes: [{ id: VISITOR, type: "username", label: VISITOR, detail: "Reported Elena. Took the minutes." }], edges: [rel(VISITOR, VISITOR_PHONE), rel(VISITOR, "DIRECTOR_KESSLER"), rel(VISITOR, "e.voss")] },
  },
];

export const evidenceFor = (toolId: string) => CASE.filter((e) => e.tool === toolId || e.also?.includes(toolId));
export const caseSolved = (flags: string[]) => CASE.every((e) => flags.includes(`solved:${e.id}`));

export function checkAnswer(e: Evidence, given: number | string) {
  if (typeof e.answer === "number") return given === e.answer;
  return String(given).trim().toLowerCase() === e.answer.toLowerCase();
}

/** Reading a memo can put a piece of evidence in your pocket. */
export function grantEvidence(memoId: string) {
  const e = CASE.find((x) => x.foundIn === memoId);
  const g = useGame.getState();
  if (!e || g.flags.includes(`has:${e.id}`)) return null;
  g.flag(`has:${e.id}`);
  return e;
}
