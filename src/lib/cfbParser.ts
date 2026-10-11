// [MS-CFB] Compound File Binary reader — the container format behind
// vbaProject.bin (inside modern .docm/.xlsm/.pptm) and legacy
// .doc/.xls/.ppt themselves. Implements just enough of the spec to
// enumerate every stream and read its bytes: the header, FAT sector
// chains, the directory (as a red-black tree per 2.6.4, walked the
// standard way), and the mini-FAT/mini-stream path for small streams.
// This is the same format olefile/oletools parse — reproduced here so
// macro extraction works entirely client-side.

const HEADER_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const NOSTREAM = 0xffffffff;

export type CfbEntry = { path: string[]; name: string; isStream: boolean; data: Uint8Array };

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

export function parseCfb(bytes: Uint8Array): CfbEntry[] | null {
  try {
    if (bytes.length < 512) return null;
    for (let i = 0; i < 8; i++) if (bytes[i] !== HEADER_SIGNATURE[i]) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const sectorShift = view.getUint16(30, true);
    const miniSectorShift = view.getUint16(32, true);
    const numFatSectors = readU32(view, 44);
    const firstDirSector = readU32(view, 48);
    const miniStreamCutoff = readU32(view, 56);
    const firstMiniFatSector = readU32(view, 60);
    const numMiniFatSectors = readU32(view, 64);
    let firstDifatSector = readU32(view, 68);
    const numDifatSectors = readU32(view, 72);

    const sectorSize = 1 << sectorShift;
    const miniSectorSize = 1 << miniSectorShift;
    const sectorOffset = (sectorId: number) => (sectorId + 1) * sectorSize;

    // Build the FAT sector-id list: 109 entries in the header, plus any
    // chained DIFAT sectors for very large files (rare for Office docs).
    const fatSectorIds: number[] = [];
    for (let i = 0; i < 109; i++) {
      const id = readU32(view, 76 + i * 4);
      if (id !== FREESECT) fatSectorIds.push(id);
    }
    let difatSector = firstDifatSector;
    let difatGuard = 0;
    while (difatSector !== ENDOFCHAIN && difatSector !== FREESECT && difatGuard < numDifatSectors + 2 && difatGuard < 10000) {
      const off = sectorOffset(difatSector);
      if (off + sectorSize > bytes.length) break;
      const entriesPerSector = sectorSize / 4 - 1;
      for (let i = 0; i < entriesPerSector; i++) {
        const id = readU32(view, off + i * 4);
        if (id !== FREESECT) fatSectorIds.push(id);
      }
      difatSector = readU32(view, off + entriesPerSector * 4);
      difatGuard++;
    }

    // FAT: concatenated array of next-sector pointers, index = sector id.
    const fatEntriesPerSector = sectorSize / 4;
    const fat = new Uint32Array(fatSectorIds.length * fatEntriesPerSector);
    for (let s = 0; s < fatSectorIds.length && s < numFatSectors + 4; s++) {
      const off = sectorOffset(fatSectorIds[s]);
      if (off + sectorSize > bytes.length) break;
      for (let i = 0; i < fatEntriesPerSector; i++) fat[s * fatEntriesPerSector + i] = readU32(view, off + i * 4);
    }

    function readChain(startSector: number, knownSize?: number): Uint8Array {
      const chunks: Uint8Array[] = [];
      let sector = startSector;
      let guard = 0;
      let total = 0;
      while (sector !== ENDOFCHAIN && sector !== FREESECT && sector < fat.length && guard < 200000) {
        const off = sectorOffset(sector);
        if (off + sectorSize > bytes.length) break;
        chunks.push(bytes.subarray(off, off + sectorSize));
        total += sectorSize;
        if (knownSize !== undefined && total >= knownSize) break;
        sector = fat[sector];
        guard++;
      }
      const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
      let p = 0;
      for (const c of chunks) { out.set(c, p); p += c.length; }
      return knownSize !== undefined ? out.subarray(0, Math.min(knownSize, out.length)) : out;
    }

    // Directory entries (128 bytes each), read via the regular FAT chain.
    const dirBytes = readChain(firstDirSector);
    const dirView = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
    const entryCount = Math.floor(dirBytes.length / 128);
    type RawEntry = {
      name: string; objectType: number; left: number; right: number; child: number;
      startSector: number; streamSize: number;
    };
    const raw: RawEntry[] = [];
    for (let i = 0; i < entryCount; i++) {
      const base = i * 128;
      const nameLenBytes = dirView.getUint16(base + 64, true);
      const nameChars = Math.max(0, Math.floor(nameLenBytes / 2) - 1);
      let name = "";
      for (let c = 0; c < nameChars; c++) name += String.fromCharCode(dirView.getUint16(base + c * 2, true));
      const objectType = dirBytes[base + 66];
      const left = readU32(dirView, base + 68);
      const right = readU32(dirView, base + 72);
      const child = readU32(dirView, base + 76);
      const startSector = readU32(dirView, base + 116);
      const sizeLow = readU32(dirView, base + 120);
      const sizeHigh = readU32(dirView, base + 124);
      const streamSize = sizeHigh > 0 ? Number.MAX_SAFE_INTEGER : sizeLow;
      raw.push({ name, objectType, left, right, child, startSector, streamSize });
    }
    if (raw.length === 0 || raw[0].objectType !== 5) return null; // must start with root storage

    // Mini-stream: the root entry's own stream (read via regular FAT),
    // sliced by miniSectorSize; small streams live inside this via miniFAT.
    const miniStreamData = raw[0].streamSize > 0 ? readChain(raw[0].startSector, raw[0].streamSize) : new Uint8Array(0);
    const miniFatBytes = numMiniFatSectors > 0 ? readChain(firstMiniFatSector) : new Uint8Array(0);
    const miniFatView = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
    const miniFat = new Uint32Array(Math.floor(miniFatBytes.length / 4));
    for (let i = 0; i < miniFat.length; i++) miniFat[i] = readU32(miniFatView, i * 4);

    function readMiniChain(startSector: number, size: number): Uint8Array {
      const out = new Uint8Array(size);
      let sector = startSector;
      let pos = 0;
      let guard = 0;
      while (sector !== ENDOFCHAIN && sector !== FREESECT && pos < size && guard < 200000) {
        const off = sector * miniSectorSize;
        if (off + miniSectorSize > miniStreamData.length) break;
        const take = Math.min(miniSectorSize, size - pos);
        out.set(miniStreamData.subarray(off, off + take), pos);
        pos += take;
        sector = sector < miniFat.length ? miniFat[sector] : ENDOFCHAIN;
        guard++;
      }
      return out;
    }

    function readEntryData(e: RawEntry): Uint8Array {
      if (e.streamSize === 0) return new Uint8Array(0);
      if (e.streamSize < miniStreamCutoff) return readMiniChain(e.startSector, e.streamSize);
      return readChain(e.startSector, e.streamSize);
    }

    // Standard red-black-tree walk (2.6.4): left subtree, self, descend
    // into storages via child, right subtree — collecting full paths.
    const results: CfbEntry[] = [];
    let visitGuard = 0;
    function walk(entryId: number, parentPath: string[]) {
      if (entryId === NOSTREAM || entryId >= raw.length || visitGuard > 200000) return;
      visitGuard++;
      const e = raw[entryId];
      walk(e.left, parentPath);
      const path = [...parentPath, e.name];
      if (e.objectType === 2) {
        results.push({ path, name: e.name, isStream: true, data: readEntryData(e) });
      } else if (e.objectType === 1) {
        walk(e.child, path);
      }
      walk(e.right, parentPath);
    }
    walk(raw[0].child, []);

    return results;
  } catch {
    return null;
  }
}
