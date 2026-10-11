import type { StegoFinding } from "./types";

// ---------------- Format metadata text fields (PNG/JPEG/MP3) ----------------
//
// A large share of "hide text in an image/audio file" tutorials don't
// touch pixel/sample bits at all — they just stuff the message into a
// standard, documented metadata field the format already supports
// (PNG text chunks, a JPEG comment marker, an MP3 ID3 comment frame).
// This is completely tool-agnostic: it's a feature of the file FORMAT,
// not of whichever app was used to edit it, so it works regardless of
// how the file was produced.

function readU32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

export function scanPngTextChunks(bytes: Uint8Array): StegoFinding[] {
  const findings: StegoFinding[] = [];
  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || !PNG_SIG.every((b, i) => bytes[i] === b)) return findings;

  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readU32BE(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    if (dataStart + length > bytes.length) break;
    const chunkData = bytes.subarray(dataStart, dataStart + length);

    if (type === "tEXt") {
      const nul = chunkData.indexOf(0);
      if (nul > 0) {
        const keyword = new TextDecoder("latin1").decode(chunkData.subarray(0, nul));
        const text = new TextDecoder("latin1").decode(chunkData.subarray(nul + 1));
        findings.push({
          id: `png-text-${offset}`,
          severity: "danger",
          title: `Hidden text found in a PNG text chunk (keyword: "${keyword}")`,
          summary: `A standard PNG tEXt metadata chunk contains ${text.length.toLocaleString()} characters of text.`,
          explanation: "PNG's tEXt chunk is a documented, standard place for arbitrary keyword/text pairs — a common, tool-agnostic way to hide a message in an image, since the chunk is silently ignored by anything that just displays the picture.",
          recommendation: "Review the recovered text below.",
          extracted: { kind: "text", label: `PNG tEXt: ${keyword}`, text },
        });
      }
    } else if (type === "iTXt") {
      const parts = chunkData;
      const nul1 = parts.indexOf(0);
      if (nul1 > 0) {
        const keyword = new TextDecoder("latin1").decode(parts.subarray(0, nul1));
        // iTXt: keyword\0 compressionFlag compressionMethod languageTag\0 translatedKeyword\0 text
        let p = nul1 + 1;
        const compressionFlag = parts[p];
        p += 2; // skip compressionFlag + compressionMethod
        const nul2 = parts.indexOf(0, p);
        if (nul2 !== -1) {
          p = nul2 + 1;
          const nul3 = parts.indexOf(0, p);
          if (nul3 !== -1) {
            p = nul3 + 1;
            if (compressionFlag === 0) {
              const text = new TextDecoder("utf-8", { fatal: false }).decode(parts.subarray(p));
              if (text.trim().length > 0) {
                findings.push({
                  id: `png-itxt-${offset}`,
                  severity: "danger",
                  title: `Hidden text found in a PNG international text chunk (keyword: "${keyword}")`,
                  summary: `An iTXt chunk contains ${text.length.toLocaleString()} characters of uncompressed text.`,
                  explanation: "iTXt is PNG's Unicode-capable text chunk — same use case as tEXt, ignored by ordinary image viewers.",
                  recommendation: "Review the recovered text below.",
                  extracted: { kind: "text", label: `PNG iTXt: ${keyword}`, text },
                });
              }
            } else {
              findings.push({
                id: `png-itxt-compressed-${offset}`,
                severity: "warning",
                title: `Compressed PNG international text chunk present (keyword: "${keyword}")`,
                summary: "This iTXt chunk's text is zlib-compressed — this scanner doesn't decompress it, but its presence is itself worth noting.",
                explanation: "A compressed text chunk is unusual for a typical photo (most cameras/editors don't add one at all) — worth investigating with a tool that can inflate zlib data.",
                recommendation: "Open with a tool like ExifTool or pngcheck to decompress and read this chunk's actual content.",
              });
            }
          }
        }
      }
    } else if (type === "zTXt") {
      const nul = chunkData.indexOf(0);
      const keyword = nul > 0 ? new TextDecoder("latin1").decode(chunkData.subarray(0, nul)) : "(unknown)";
      findings.push({
        id: `png-ztxt-${offset}`,
        severity: "warning",
        title: `Compressed PNG text chunk present (keyword: "${keyword}")`,
        summary: "This zTXt chunk's text is zlib-compressed — this scanner doesn't decompress it, but its presence is itself worth noting.",
        explanation: "A compressed text chunk is unusual for a typical photo — worth investigating with a tool that can inflate zlib data.",
        recommendation: "Open with a tool like ExifTool or pngcheck to decompress and read this chunk's actual content.",
      });
    }

    offset = dataStart + length + 4; // skip CRC
    if (type === "IEND") break;
  }
  return findings;
}

export function scanJpegComments(bytes: Uint8Array): StegoFinding[] {
  const findings: StegoFinding[] = [];
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return findings;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { offset += 2; continue; }
    if (marker === 0xda) break; // Start of Scan — comments only appear before this
    if (offset + 4 > bytes.length) break;
    const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segLen < 2 || offset + 2 + segLen > bytes.length) break;

    if (marker === 0xfe) { // COM: Comment marker
      const commentBytes = bytes.subarray(offset + 4, offset + 2 + segLen);
      const text = new TextDecoder("utf-8", { fatal: false }).decode(commentBytes);
      if (text.trim().length > 0) {
        findings.push({
          id: `jpeg-com-${offset}`,
          severity: "danger",
          title: "Hidden text found in a JPEG comment marker",
          summary: `A standard JPEG COM segment contains ${text.length.toLocaleString()} characters of text.`,
          explanation: "The JPEG COM marker is a documented, standard place for arbitrary text — most image viewers never display it, making it a simple, tool-agnostic way to hide a message.",
          recommendation: "Review the recovered text below.",
          extracted: { kind: "text", label: "JPEG comment", text },
        });
      }
    }
    offset += 2 + segLen;
  }
  return findings;
}

/** ID3v2 comment/lyrics/user-text frames — the MP3 equivalent of a PNG
 * text chunk: a documented metadata field most players never surface,
 * making it a simple way to hide a message in an audio file. */
export function scanId3Comments(bytes: Uint8Array): StegoFinding[] {
  const findings: StegoFinding[] = [];
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return findings; // "ID3"
  const majorVersion = bytes[3];
  const flags = bytes[5];
  const synchsafe = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  let offset = 10;
  if (flags & 0x40) offset += 10; // extended header present (approximation, rarely used)
  const tagEnd = Math.min(bytes.length, 10 + synchsafe);
  const frameIdIsText = (id: string) => id === "COMM" || id === "USLT" || id === "TXXX";

  while (offset + 10 <= tagEnd) {
    const frameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
    const frameSize = majorVersion >= 4
      ? ((bytes[offset + 4] & 0x7f) << 21) | ((bytes[offset + 5] & 0x7f) << 14) | ((bytes[offset + 6] & 0x7f) << 7) | (bytes[offset + 7] & 0x7f)
      : readU32BE(bytes, offset + 4);
    const frameStart = offset + 10;
    if (frameSize <= 0 || frameStart + frameSize > tagEnd) break;

    if (frameIdIsText(frameId)) {
      const frameData = bytes.subarray(frameStart, frameStart + frameSize);
      // Text frames: 1 byte encoding, then (for COMM/USLT) 3-byte language, then description\0, then text
      const encodingByte = frameData[0];
      const isUtf16 = encodingByte === 1 || encodingByte === 2;
      const bodyStart = frameId === "TXXX" ? 1 : 4;
      const body = frameData.subarray(bodyStart);
      const decoder = new TextDecoder(isUtf16 ? "utf-16" : "latin1", { fatal: false });
      const raw = decoder.decode(body);
      const text = raw.replace(/ +/g, " ").trim();
      if (text.length > 0) {
        findings.push({
          id: `id3-${frameId}-${offset}`,
          severity: "danger",
          title: `Hidden text found in an ID3 ${frameId} frame`,
          summary: `A standard MP3 metadata frame (${frameId}) contains ${text.length.toLocaleString()} characters of text.`,
          explanation: "ID3 comment/lyrics/user-text frames are documented, standard metadata fields most music players never display — a simple, tool-agnostic way to hide a message in an audio file.",
          recommendation: "Review the recovered text below.",
          extracted: { kind: "text", label: `ID3 ${frameId}`, text },
        });
      }
    }
    offset = frameStart + frameSize;
  }
  return findings;
}
