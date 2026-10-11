// Cassette tapes for the in-world recorder.
// Drop audio files into /public/audio/tapes/ and add an entry here.
// Paths are relative so the same build works under any base URL.
// A tape without `src` plays a generated ambient loop.

export interface Tape {
  id: string;
  title: string;
  src?: string;
  /** Label colour on the cassette shell. */
  color: string;
}

export const TAPES: Tape[] = [
  { id: "lilium", title: "Lilium (Saint Version)", src: "audio/tapes/lilium.mp3", color: "#7a1f1a" },
  { id: "dont-look-behind", title: "Don't Look Behind", src: "audio/tapes/dont-look-behind.mp3", color: "#2c3e48" },
];

/** Plays on its own the first time you step into the hospital. */
export const ENTRY_TAPE = "lilium";
