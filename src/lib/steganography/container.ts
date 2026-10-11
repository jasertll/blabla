import type { StegoFinding } from "./types";
import { tryDecodeUtf8 } from "./shared";

// ---------------- This tool's own hide/embed container ----------------
//
// The scan/extract logic in the other modules of this directory is built
// to detect and recover payloads hidden by OTHER tools, using generic
// conventions (a 32-bit length prefix, or a bare recognizable file
// signature) it has to guess at. For content hidden BY THIS TOOL,
// guessing isn't necessary — every embed writes a small self-describing
// container (a private 4-byte magic marker, a kind byte, and a 4-byte
// length) so this tool can always recover exactly what it hid, byte-for-
// byte, regardless of which embedding method was used. Detection of this
// container is checked FIRST, before falling back to the generic
// heuristics that look for third-party tools' output.

const CONTAINER_MAGIC = [0x4a, 0x53, 0x54, 0x47]; // "JSTG"
const CONTAINER_HEADER_LEN = 9; // 4 magic + 1 kind + 4 length

export type HiddenPayload =
  | { kind: "text"; text: string }
  | { kind: "file"; bytes: Uint8Array; filename: string; mime: string };

export function encodeContainer(payload: HiddenPayload): Uint8Array {
  let kindByte: number;
  let body: Uint8Array;
  if (payload.kind === "text") {
    kindByte = 0;
    body = new TextEncoder().encode(payload.text);
  } else {
    kindByte = 1;
    const metaBytes = new TextEncoder().encode(`${payload.filename} ${payload.mime} `);
    body = new Uint8Array(metaBytes.length + payload.bytes.length);
    body.set(metaBytes, 0);
    body.set(payload.bytes, metaBytes.length);
  }
  const header = new Uint8Array(CONTAINER_HEADER_LEN);
  header.set(CONTAINER_MAGIC, 0);
  header[4] = kindByte;
  const len = body.length;
  header[5] = (len >>> 24) & 0xff;
  header[6] = (len >>> 16) & 0xff;
  header[7] = (len >>> 8) & 0xff;
  header[8] = len & 0xff;
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

function decodeContainerAt(bytes: Uint8Array, offset: number): { payload: HiddenPayload; totalLength: number } | null {
  if (offset + CONTAINER_HEADER_LEN > bytes.length) return null;
  for (let i = 0; i < 4; i++) if (bytes[offset + i] !== CONTAINER_MAGIC[i]) return null;
  const kindByte = bytes[offset + 4];
  const len = (bytes[offset + 5] * 0x1000000) + (bytes[offset + 6] << 16) + (bytes[offset + 7] << 8) + bytes[offset + 8];
  if (len < 0 || offset + CONTAINER_HEADER_LEN + len > bytes.length) return null;
  const body = bytes.subarray(offset + CONTAINER_HEADER_LEN, offset + CONTAINER_HEADER_LEN + len);

  if (kindByte === 0) {
    const text = tryDecodeUtf8(body);
    if (text === null) return null;
    return { payload: { kind: "text", text }, totalLength: CONTAINER_HEADER_LEN + len };
  }
  if (kindByte === 1) {
    const nul1 = body.indexOf(0);
    if (nul1 === -1) return null;
    const filename = new TextDecoder().decode(body.subarray(0, nul1));
    const rest = body.subarray(nul1 + 1);
    const nul2 = rest.indexOf(0);
    if (nul2 === -1) return null;
    const mime = new TextDecoder().decode(rest.subarray(0, nul2));
    const fileBytes = rest.subarray(nul2 + 1);
    return { payload: { kind: "file", bytes: fileBytes, filename, mime }, totalLength: CONTAINER_HEADER_LEN + len };
  }
  return null;
}

function findContainer(bytes: Uint8Array): { payload: HiddenPayload; offset: number } | null {
  for (let i = 0; i <= bytes.length - CONTAINER_HEADER_LEN; i++) {
    if (bytes[i] === CONTAINER_MAGIC[0] && bytes[i + 1] === CONTAINER_MAGIC[1] && bytes[i + 2] === CONTAINER_MAGIC[2] && bytes[i + 3] === CONTAINER_MAGIC[3]) {
      const decoded = decodeContainerAt(bytes, i);
      if (decoded) return { payload: decoded.payload, offset: i };
    }
  }
  return null;
}

function containerFinding(payload: HiddenPayload, method: string): StegoFinding {
  if (payload.kind === "text") {
    return {
      id: "own-container-text",
      severity: "danger",
      title: "Hidden text recovered (hidden via this Steganography Scanner)",
      summary: `Found this tool's own container format (${method}) and decoded the exact original text.`,
      explanation: "This file was hidden using this Steganography Scanner's own self-describing container, so this is an exact, guaranteed-correct recovery — not a statistical inference.",
      recommendation: "Review the recovered text below.",
      extracted: { kind: "text", label: "Recovered text", text: payload.text },
    };
  }
  return {
    id: "own-container-file",
    severity: "danger",
    title: `Hidden file recovered: ${payload.filename} (hidden via this Steganography Scanner)`,
    summary: `Found this tool's own container format (${method}) and recovered "${payload.filename}" (${(payload.bytes.length / 1024).toFixed(1)} KB) exactly as hidden.`,
    explanation: "This file was hidden using this Steganography Scanner's own self-describing container, so this is an exact, guaranteed-correct recovery — not a statistical inference.",
    recommendation: "Download and inspect the recovered file below.",
    extracted: { kind: "binary", label: payload.filename, bytes: payload.bytes, mime: payload.mime || "application/octet-stream" },
  };
}

/** Appends a self-describing hidden container after a cover file's own
 * data. Works for ANY file type as the cover — including video, audio,
 * PDF, or anything else — because unlike per-pixel LSB embedding it
 * doesn't depend on the cover format's internal structure at all: the
 * cover plays/opens/displays completely normally (nothing about its own
 * bytes changed), and the hidden container just rides along at the end,
 * invisible to anything that isn't specifically looking for it. */
export function embedByAppending(coverBytes: Uint8Array, payload: HiddenPayload): Uint8Array {
  const container = encodeContainer(payload);
  const out = new Uint8Array(coverBytes.length + container.length);
  out.set(coverBytes, 0);
  out.set(container, coverBytes.length);
  return out;
}

/** Scans a file's full byte buffer for this tool's own container magic
 * marker, wherever it landed (LSB embeds put it at bit-offset 0 of the
 * extracted stream; append embeds put it at the very end of the file,
 * but scanning the whole buffer is cheap and catches both without
 * needing to know which method was used). */
export function scanOwnContainer(bytes: Uint8Array, method: string): StegoFinding[] {
  const found = findContainer(bytes);
  return found ? [containerFinding(found.payload, method)] : [];
}
