// Shared evidence schema used across this platform's analysis tools —
// the machine-readable "why was this flagged, where, by which check, how
// confident" trace behind a finding/verdict (the analyst "WHY" view).
// Deliberately small and tool-agnostic: a finding type in any module
// (File Inspector's Verdict, Steganography's StegoFinding, PCAP's
// Finding, ...) can add `evidence?: EvidenceItem[]` without otherwise
// changing its own shape or detection logic — this is a shared vocabulary
// for existing data, not a new subsystem findings have to be rewritten
// to fit into.
export type EvidenceItem = {
  /** Which check/engine produced this, e.g. "embedded-signature-scanner",
   * "rs-steganalysis", "lsb-brute-force". Free text, not an enum — new
   * engines shouldn't need a schema change to report evidence. */
  sourceEngine: string;
  description: string;
  /** Byte offset into the analyzed file/buffer, when the evidence points
   * at a specific location rather than being a whole-file statistic. */
  offset?: number;
  confidence: "high" | "moderate" | "low";
};
