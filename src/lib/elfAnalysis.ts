// Real ELF (Linux/Unix executable/shared-object) structural analysis —
// the Linux/Unix counterpart to lib/peAnalysis.ts's PE parsing, closing
// a real gap: this app's static analysis previously reasoned about
// Windows executables only. Parsed directly from the file bytes per
// the public ELF specification (a long-stable, unambiguous format —
// unlike MS-OVBA/PE-checksum, there's no obscure algorithm here to get
// subtly wrong, just header/table layout).
//
// Grounded in real, documented Linux-malware static-analysis technique
// (see Intezer's "ELF Malware Analysis 101" and similar DFIR writeups):
// a segment table with only PT_LOAD (missing PT_INTERP/PT_DYNAMIC that
// a normal dynamically-linked binary has) is a documented packing
// anomaly; UPX-style section names, stripped section headers, and
// writable+executable segments are the ELF equivalents of the PE
// packer fingerprints already checked elsewhere in this app.

export type ElfSegment = {
  typeName: string;
  offset: number;
  vaddr: number;
  filesz: number;
  memsz: number;
  readable: boolean;
  writable: boolean;
  executable: boolean;
};

export type ElfSection = {
  name: string;
  type: number;
  writable: boolean;
  executable: boolean;
  size: number;
};

export type ElfInfo = {
  is64Bit: boolean;
  machine: string;
  typeName: string;
  entryPoint: number;
  segments: ElfSegment[];
  sections: ElfSection[];
  sectionHeadersStripped: boolean;
  interpreter: string | null;
  hasDynamicSegment: boolean;
  dynamicSymbolCount: number | null;
};

const MACHINE_NAMES: Record<number, string> = {
  0x03: "x86 (32-bit)",
  0x3e: "x86-64",
  0x28: "ARM (32-bit)",
  0xb7: "ARM64 (AArch64)",
  0x08: "MIPS",
  0x14: "PowerPC",
  0x2b: "SPARC",
  0xf3: "RISC-V",
};

const TYPE_NAMES: Record<number, string> = {
  0: "ET_NONE (unknown)",
  1: "ET_REL (relocatable/object)",
  2: "ET_EXEC (executable)",
  3: "ET_DYN (shared object / PIE executable)",
  4: "ET_CORE (core dump)",
};

const PT_TYPE_NAMES: Record<number, string> = {
  0: "PT_NULL",
  1: "PT_LOAD",
  2: "PT_DYNAMIC",
  3: "PT_INTERP",
  4: "PT_NOTE",
  5: "PT_SHLIB",
  6: "PT_PHDR",
  7: "PT_TLS",
  0x6474e550: "PT_GNU_EH_FRAME",
  0x6474e551: "PT_GNU_STACK",
  0x6474e552: "PT_GNU_RELRO",
};

function readCString(bytes: Uint8Array, offset: number, maxLen = 512): string {
  let end = offset;
  while (end < bytes.length && end < offset + maxLen && bytes[end] !== 0) end++;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(offset, end));
}

/** Parses the ELF header, program header table, and section header
 * table. Returns null (never throws) for anything that isn't a
 * well-formed ELF it can safely walk. */
export function parseElf(bytes: Uint8Array): ElfInfo | null {
  try {
    if (bytes.length < 20 || bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) return null;
    const is64Bit = bytes[4] === 2;
    const isLittleEndian = bytes[5] === 1;
    if (!isLittleEndian) return null; // big-endian ELF is rare in the wild; not handled here
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const LE = true;

    const headerSize = is64Bit ? 64 : 52;
    if (bytes.length < headerSize) return null;

    const eType = view.getUint16(16, LE);
    const eMachine = view.getUint16(18, LE);
    const entryPoint = is64Bit ? Number(view.getBigUint64(24, LE)) : view.getUint32(24, LE);
    const ePhoff = is64Bit ? Number(view.getBigUint64(32, LE)) : view.getUint32(28, LE);
    const eShoff = is64Bit ? Number(view.getBigUint64(40, LE)) : view.getUint32(32, LE);
    const ePhentsize = is64Bit ? view.getUint16(54, LE) : view.getUint16(42, LE);
    const ePhnum = is64Bit ? view.getUint16(56, LE) : view.getUint16(44, LE);
    const eShentsize = is64Bit ? view.getUint16(58, LE) : view.getUint16(44 + 2, LE);
    const eShnum = is64Bit ? view.getUint16(60, LE) : view.getUint16(48, LE);
    const eShstrndx = is64Bit ? view.getUint16(62, LE) : view.getUint16(50, LE);

    // Program headers (segments).
    const segments: ElfSegment[] = [];
    let interpreter: string | null = null;
    let hasDynamicSegment = false;
    for (let i = 0; i < ePhnum && i < 200; i++) {
      const off = ePhoff + i * ePhentsize;
      if (off + (is64Bit ? 56 : 32) > bytes.length) break;
      let pType: number, pFlags: number, pOffset: number, pVaddr: number, pFilesz: number, pMemsz: number;
      if (is64Bit) {
        pType = view.getUint32(off, LE);
        pFlags = view.getUint32(off + 4, LE);
        pOffset = Number(view.getBigUint64(off + 8, LE));
        pVaddr = Number(view.getBigUint64(off + 16, LE));
        pFilesz = Number(view.getBigUint64(off + 32, LE));
        pMemsz = Number(view.getBigUint64(off + 40, LE));
      } else {
        pType = view.getUint32(off, LE);
        pOffset = view.getUint32(off + 4, LE);
        pVaddr = view.getUint32(off + 8, LE);
        pFilesz = view.getUint32(off + 16, LE);
        pMemsz = view.getUint32(off + 20, LE);
        pFlags = view.getUint32(off + 24, LE);
      }
      segments.push({
        typeName: PT_TYPE_NAMES[pType] ?? `Unknown (0x${pType.toString(16)})`,
        offset: pOffset, vaddr: pVaddr, filesz: pFilesz, memsz: pMemsz,
        readable: (pFlags & 0x4) !== 0, writable: (pFlags & 0x2) !== 0, executable: (pFlags & 0x1) !== 0,
      });
      if (pType === 2) hasDynamicSegment = true;
      if (pType === 3 && pOffset + pFilesz <= bytes.length && pFilesz > 0) {
        interpreter = readCString(bytes, pOffset, pFilesz);
      }
    }

    // Section headers (optional — some stripped/packed binaries omit these entirely).
    const sections: ElfSection[] = [];
    const sectionHeadersStripped = eShnum === 0 || eShoff === 0;
    if (!sectionHeadersStripped) {
      const rawSections: { nameOff: number; type: number; flags: number; size: number }[] = [];
      for (let i = 0; i < eShnum && i < 500; i++) {
        const off = eShoff + i * eShentsize;
        if (off + (is64Bit ? 64 : 40) > bytes.length) break;
        let nameOff: number, type: number, flags: number, size: number;
        if (is64Bit) {
          nameOff = view.getUint32(off, LE);
          type = view.getUint32(off + 4, LE);
          flags = Number(view.getBigUint64(off + 8, LE));
          size = Number(view.getBigUint64(off + 32, LE));
        } else {
          nameOff = view.getUint32(off, LE);
          type = view.getUint32(off + 4, LE);
          flags = view.getUint32(off + 8, LE);
          size = view.getUint32(off + 20, LE);
        }
        rawSections.push({ nameOff, type, flags, size });
      }
      // Resolve section names via the shstrtab section, if it's a valid index.
      let shstrtabOffset: number | null = null;
      if (eShstrndx < rawSections.length) {
        const shOff = eShoff + eShstrndx * eShentsize;
        shstrtabOffset = is64Bit
          ? (shOff + 32 <= bytes.length ? Number(view.getBigUint64(shOff + 24, LE)) : null)
          : (shOff + 20 <= bytes.length ? view.getUint32(shOff + 16, LE) : null);
      }
      for (const s of rawSections) {
        const name = shstrtabOffset !== null ? readCString(bytes, shstrtabOffset + s.nameOff, 64) : "";
        sections.push({ name, type: s.type, writable: (s.flags & 0x1) !== 0, executable: (s.flags & 0x4) !== 0, size: s.size });
      }
    }

    // Dynamic symbol count, best-effort: count non-empty dynsym entries
    // via the .dynsym section if present (each entry is 24 bytes on
    // 64-bit ELF, 16 bytes on 32-bit).
    let dynamicSymbolCount: number | null = null;
    const dynsym = sections.find((s) => s.name === ".dynsym");
    if (dynsym) {
      const entrySize = is64Bit ? 24 : 16;
      dynamicSymbolCount = entrySize > 0 ? Math.max(0, Math.floor(dynsym.size / entrySize) - 1) : null; // -1 for the null first entry
    }

    return {
      is64Bit,
      machine: MACHINE_NAMES[eMachine] ?? `Unknown (0x${eMachine.toString(16)})`,
      typeName: TYPE_NAMES[eType] ?? `Unknown (${eType})`,
      entryPoint,
      segments,
      sections,
      sectionHeadersStripped,
      interpreter,
      hasDynamicSegment,
      dynamicSymbolCount,
    };
  } catch {
    return null;
  }
}

export type ElfRiskFinding = {
  id: string;
  severity: "danger" | "warning" | "info" | "safe";
  title: string;
  summary: string;
  explanation: string;
  recommendation: string;
};

const KNOWN_INTERPRETER_PREFIXES = ["/lib/ld-linux", "/lib64/ld-linux", "/usr/lib/ld-linux", "/lib/ld-musl", "/usr/lib64/ld-linux", "/system/bin/linker"];
const PACKER_SECTION_NAMES = /^(upx|\.upx|themida)/i;

export function analyzeElfRisk(info: ElfInfo): ElfRiskFinding[] {
  const findings: ElfRiskFinding[] = [];

  // W+X segments — same red flag as PE's W+X sections.
  const wxSegments = info.segments.filter((s) => s.writable && s.executable && s.typeName === "PT_LOAD");
  if (wxSegments.length > 0) {
    findings.push({
      id: "elf-wx-segment",
      severity: "warning",
      title: `${wxSegments.length} loadable segment${wxSegments.length === 1 ? "" : "s"} marked both writable AND executable`,
      summary: `Segment(s) at file offset ${wxSegments.map((s) => `0x${s.offset.toString(16)}`).join(", ")}.`,
      explanation: "Normal compiler/linker output keeps code (execute-only) and data (write-only) in separate segments — a writable+executable segment means the program can modify its own code at runtime, the same self-unpacking pattern PE packers use, ported to ELF.",
      recommendation: "Consistent with packing (UPX and similar Linux packers produce exactly this). Combined with high entropy, this is a meaningfully stronger signal.",
    });
  }

  // Packer-style section names.
  const packerSections = info.sections.filter((s) => PACKER_SECTION_NAMES.test(s.name));
  if (packerSections.length > 0) {
    findings.push({
      id: "elf-packer-sections",
      severity: "danger",
      title: "Packer-style section names present",
      summary: `Section(s): ${packerSections.map((s) => s.name).join(", ")}.`,
      explanation: "UPX and similar ELF packers produce distinctively-named sections (UPX0/UPX1/UPX!) as part of their standard output — this is a direct, well-documented fingerprint, not a heuristic guess.",
      recommendation: "This binary's real code is very likely compressed/encrypted and only unpacked at runtime — static analysis of the file as-is will miss its actual behavior. Consider unpacking with `upx -d` (if it's standard UPX) before further analysis.",
    });
  }

  // Missing PT_INTERP + PT_DYNAMIC on an otherwise-loadable binary — the
  // documented "only PT_LOAD (and maybe PT_GNU_STACK)" packing anomaly.
  const hasLoad = info.segments.some((s) => s.typeName === "PT_LOAD");
  const hasInterp = info.segments.some((s) => s.typeName === "PT_INTERP");
  const nonTrivialSegmentTypes = new Set(info.segments.map((s) => s.typeName));
  nonTrivialSegmentTypes.delete("PT_LOAD");
  nonTrivialSegmentTypes.delete("PT_GNU_STACK");
  if (hasLoad && !hasInterp && !info.hasDynamicSegment && nonTrivialSegmentTypes.size === 0 && info.typeName.includes("EXEC")) {
    findings.push({
      id: "elf-minimal-segments",
      severity: "warning",
      title: "Segment table has only PT_LOAD (no interpreter, no dynamic linking)",
      summary: "This executable's program headers contain essentially nothing but loadable segments.",
      explanation: "A normal dynamically-linked Linux binary has a PT_INTERP segment (naming the dynamic linker) and a PT_DYNAMIC segment (its imported-library table) — their absence on an EXEC-type binary is a documented anomaly seen in UPX-packed and custom-packed ELF malware, since the packer stub is statically self-contained and only unpacks the real (often dynamically-linked) payload into memory at runtime.",
      recommendation: "Cross-check against the section-based findings here and the file's entropy — this combination is a real, specific packing signal, not definitive proof on its own.",
    });
  }

  if (info.interpreter && !KNOWN_INTERPRETER_PREFIXES.some((p) => info.interpreter!.startsWith(p))) {
    findings.push({
      id: "elf-unusual-interpreter",
      severity: "info",
      title: "Non-standard dynamic linker path",
      summary: `PT_INTERP names: "${info.interpreter}"`,
      explanation: "The interpreter path should normally be a standard system dynamic-linker location (glibc's ld-linux*.so, musl's ld-musl*.so, or Android's linker). A non-standard path can be entirely legitimate (a bundled/portable app, a container with a custom rootfs) but is also seen when a binary carries its own trojanized loader.",
      recommendation: "Verify this path exists and is the genuine system linker on the target the file claims to run on.",
    });
  }

  if (info.sectionHeadersStripped) {
    findings.push({
      id: "elf-no-section-headers",
      severity: "info",
      title: "Section headers are absent",
      summary: "This ELF has no section header table at all (only program headers, which is all the OS loader actually needs to run it).",
      explanation: "Section headers exist for tools (debuggers, disassemblers) — the OS loader itself only reads program headers. Deliberately stripping section headers entirely (not just symbol tables) is more aggressive than typical `strip` output and is sometimes done specifically to slow down static analysis tools that expect them.",
      recommendation: "Not conclusive alone — plenty of minimal/embedded binaries are built this way — but combine with the other findings here.",
    });
  }

  if (info.hasDynamicSegment && info.dynamicSymbolCount !== null && info.dynamicSymbolCount <= 2) {
    findings.push({
      id: "elf-minimal-dynsym",
      severity: "info",
      title: "Very few dynamic symbols for a dynamically-linked binary",
      summary: `Only ${info.dynamicSymbolCount} dynamic symbol(s) found.`,
      explanation: "A dynamically-linked binary that imports almost nothing (often just enough to call dlopen/dlsym itself) is the ELF analogue of a PE with a near-empty import table — consistent with a binary that resolves its real API surface at runtime specifically to avoid declaring it statically.",
      recommendation: "Cross-check the string-based capability findings elsewhere in this report for API/function names referenced as plain text.",
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: "elf-clean",
      severity: "safe",
      title: "No high-risk ELF structural anomalies found",
      summary: `Scanned ${info.segments.length} segment(s) and ${info.sections.length} section(s) against known packing/anti-analysis patterns.`,
      explanation: "This only covers structural anomalies (packing fingerprints, segment/section irregularities) — it says nothing about the actual code's behavior.",
      recommendation: "A clean structural scan is reassuring but not conclusive by itself — check the string-based capability findings elsewhere in this report too.",
    });
  }

  return findings;
}
