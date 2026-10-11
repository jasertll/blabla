// Shared types for the whole steganography module (see index.ts for why
// it's split into a directory) — two things worth being upfront about,
// matching the rest of this app's "show your work, never overclaim"
// standard:
//
// 1. Steganography has no universal signature. There is no way to
//    guarantee detecting every possible embedding scheme — this covers
//    the handful of real, well-documented techniques that account for
//    the overwhelming majority of what actually gets used: LSB
//    (least-significant-bit) embedding in images and raw PCM audio,
//    zero-width Unicode text steganography, and appended/concatenated
//    file-in-file hiding (which lib/fileAnalysis.ts already detects —
//    this module adds the ability to actually EXTRACT that data, not
//    just flag that it's there).
// 2. Every "likely hidden content found" result here is a heuristic
//    conclusion from statistical evidence or a successful decode
//    attempt, not a certainty. Findings say exactly what evidence
//    produced them so an analyst can judge it themselves.

import type { EvidenceItem } from "../evidenceModel";
export type { EvidenceItem };

export type Severity = "danger" | "warning" | "info" | "safe";

export type ExtractedPayload = {
  kind: "text" | "binary";
  label: string;
  text?: string;
  bytes?: Uint8Array;
  mime?: string;
};

export type StegoFinding = {
  id: string;
  severity: Severity;
  title: string;
  summary: string;
  explanation: string;
  recommendation: string;
  extracted?: ExtractedPayload;
  /** Real evidence this finding traces back to — see lib/evidenceModel.ts.
   * Optional so every existing finding-builder keeps compiling unchanged;
   * populated where the underlying check already computes offset/
   * confidence data worth surfacing (RS-analysis channel rates, LSB
   * brute-force convention + offset, etc.). */
  evidence?: EvidenceItem[];
};
