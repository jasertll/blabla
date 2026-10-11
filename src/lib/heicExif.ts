// exifr's built-in HEIC/HEIF reader has a real bug: when it locates the
// "Exif" item's byte range inside the ISOBMFF `iloc` box, it reads the
// per-extent `offset` field but never adds the item's `base_offset` field
// on top of it. Per the HEIF spec, the item's actual file position is
// `base_offset + extent_offset` — and most real encoders (libheif, which
// underpins iPhone and most Android HEIC writers) place Exif item bytes at
// a nonzero base_offset. exifr then reads the wrong region of the file
// (typically the ftyp/meta boxes themselves) and throws "Malformed EXIF
// data" — verified by hand-parsing the container against a byte-correct
// synthetic HEIC file: exifr fails on it, but handing exifr the correctly
// located raw TIFF bytes directly parses cleanly.
//
// This walks the same box structure exifr does, but correctly, and hands
// back just the raw TIFF-with-header bytes so exifr's normal (working)
// TIFF/EXIF reader can take it from there.

function readAscii(bytes: Uint8Array, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[offset + i]);
  return s;
}

type Box = { offset: number; length: number; kind: string; start: number };

function parseBoxHead(view: DataView, bytes: Uint8Array, offset: number): Box {
  let length = view.getUint32(offset);
  const kind = readAscii(bytes, offset + 4, 4);
  let start = offset + 8;
  if (length === 1) {
    // 64-bit extended size
    const hi = view.getUint32(offset + 8);
    const lo = view.getUint32(offset + 12);
    length = hi * 2 ** 32 + lo;
    start += 8;
  }
  return { offset, length, kind, start };
}

function readUintBytes(view: DataView, offset: number, n: number): number {
  if (n === 0) return 0;
  if (n === 1) return view.getUint8(offset);
  if (n === 2) return view.getUint16(offset);
  if (n === 4) return view.getUint32(offset);
  throw new Error(`unsupported field width ${n}`);
}

export function extractHeicExifTiff(buf: ArrayBuffer): ArrayBuffer | null {
  try {
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);

    // Find the top-level "meta" box.
    let off = 0;
    let meta: Box | null = null;
    while (off + 8 <= buf.byteLength) {
      const box = parseBoxHead(view, bytes, off);
      if (box.length < 8) break;
      if (box.kind === "meta") {
        meta = box;
        break;
      }
      off += box.length;
    }
    if (!meta) return null;

    // meta is a FullBox: 4 bytes of version/flags before its children.
    let p = meta.start + 4;
    const metaEnd = meta.offset + meta.length;
    let iinf: Box | null = null;
    let iloc: Box | null = null;
    while (p + 8 <= metaEnd) {
      const box = parseBoxHead(view, bytes, p);
      if (box.length < 8) break;
      if (box.kind === "iinf") iinf = box;
      if (box.kind === "iloc") iloc = box;
      p += box.length;
    }
    if (!iinf || !iloc) return null;

    // --- iinf: find the item_ID whose item_type is "Exif" ---
    const iinfVersion = view.getUint8(iinf.start);
    let ip = iinf.start + 4;
    const entryCount = view.getUint16(ip);
    ip += 2;
    let exifItemId: number | null = null;
    for (let i = 0; i < entryCount && ip + 8 <= iinf.offset + iinf.length; i++) {
      const infe = parseBoxHead(view, bytes, ip);
      if (infe.length < 8) break;
      const infeVersion = view.getUint8(infe.start);
      const infeBody = infe.start + 4;
      if (infeVersion >= 2) {
        const idSize = infeVersion === 3 ? 4 : 2;
        const itemId = readUintBytes(view, infeBody, idSize);
        const itemType = readAscii(bytes, infeBody + idSize + 2, 4);
        if (itemType === "Exif") {
          exifItemId = itemId;
          break;
        }
      }
      ip += infe.length;
    }
    if (exifItemId === null) return null;

    // --- iloc: find that item's absolute byte range ---
    const ilocVersion = view.getUint8(iloc.start);
    let lp = iloc.start + 4;
    const sizesByte1 = view.getUint8(lp); lp += 1;
    const offsetSize = sizesByte1 >> 4;
    const lengthSize = sizesByte1 & 0x0f;
    const sizesByte2 = view.getUint8(lp); lp += 1;
    const baseOffsetSize = sizesByte2 >> 4;
    const indexSize = sizesByte2 & 0x0f;
    const itemIdSize = ilocVersion === 2 ? 4 : 2;
    const constructionMethodSize = ilocVersion === 1 || ilocVersion === 2 ? 2 : 0;
    const itemCountSize = ilocVersion === 2 ? 4 : 2;
    const itemCount = readUintBytes(view, lp, itemCountSize);
    lp += itemCountSize;

    let fileOffset: number | null = null;
    let extentLength = 0;
    for (let i = 0; i < itemCount; i++) {
      const itemId = readUintBytes(view, lp, itemIdSize);
      lp += itemIdSize;
      lp += constructionMethodSize;
      lp += 2; // data_reference_index
      const baseOffset = readUintBytes(view, lp, baseOffsetSize);
      lp += baseOffsetSize;
      const extentCount = view.getUint16(lp);
      lp += 2;
      for (let e = 0; e < extentCount; e++) {
        lp += indexSize;
        const extOffset = readUintBytes(view, lp, offsetSize);
        lp += offsetSize;
        const extLength = readUintBytes(view, lp, lengthSize);
        lp += lengthSize;
        if (itemId === exifItemId && fileOffset === null) {
          fileOffset = baseOffset + extOffset;
          extentLength = extLength;
        }
      }
    }
    if (fileOffset === null || extentLength < 10) return null;

    // Per the HEIF spec (ISO/IEC 23008-12 Annex A), the Exif item's bytes
    // are: [4-byte exif_tiff_header_offset][that many bytes, usually
    // "Exif\0\0"][TIFF header onward]. Skip past that to hand exifr a
    // clean TIFF buffer starting at "II*\0" / "MM\0*".
    const tiffHeaderOffset = view.getUint32(fileOffset);
    const tiffStart = fileOffset + 4 + tiffHeaderOffset;
    const tiffEnd = fileOffset + extentLength;
    if (tiffStart < 0 || tiffStart >= tiffEnd || tiffEnd > buf.byteLength) return null;

    return buf.slice(tiffStart, tiffEnd);
  } catch {
    return null;
  }
}
