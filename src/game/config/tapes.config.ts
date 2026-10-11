// Cassette tapes for the in-world recorder.
// Drop audio files into /public/audio/tapes/ and add an entry here.
// A tape without `src` plays a generated ambient loop (useful before real files exist).

export interface Tape {
  id: string;
  title: string;
  /** e.g. "/audio/tapes/my-song.mp3" */
  src?: string;
  /** Label colour on the cassette shell. */
  color: string;
}

export const TAPES: Tape[] = [
  { id: "tape-00", title: "Tape 00 — Hospital Hum", color: "#8b2b23" },
  // { id: "tape-01", title: "Your song", src: "/audio/tapes/your-song.mp3", color: "#2f4a5a" },
];
