// Windows PE (Portable Executable) header parsing — pure byte-level
// parsing of the documented COFF/PE32(+) format, no execution, no network.
// Reference: Microsoft PE/COFF specification.
import { shannonEntropy } from "@/lib/fileAnalysis";

const MACHINE_TYPES: Record<number, string> = {
  0x014c: "x86 (I386)",
  0x0200: "IA64",
  0x8664: "x64 (AMD64)",
  0x01c0: "ARM",
  0x01c4: "ARM Thumb-2 (ARMNT)",
  0xaa64: "ARM64",
};

const SUBSYSTEMS: Record<number, string> = {
  1: "Native",
  2: "Windows GUI",
  3: "Windows Console (CUI)",
  5: "OS/2 CUI",
  7: "POSIX CUI",
  9: "Windows CE GUI",
  10: "EFI Application",
  11: "EFI Boot Service Driver",
  12: "EFI Runtime Driver",
  13: "EFI ROM",
  14: "Xbox",
  16: "Windows Boot Application",
};

const CHARACTERISTIC_FLAGS: [number, string][] = [
  [0x0002, "Executable image"],
  [0x0020, "Large address aware"],
  [0x0100, "32-bit machine"],
  [0x2000, "DLL"],
  [0x4000, "System file (driver)"],
];

const SECTION_EXEC = 0x20000000;
const SECTION_WRITE = 0x80000000;
const SECTION_READ = 0x40000000;

export type PeSection = {
  name: string;
  virtualSize: number;
  rawSize: number;
  executable: boolean;
  writable: boolean;
  readable: boolean;
  entropy: number;
};

export type PeMetadata = {
  machine: string;
  is64Bit: boolean;
  timestamp: string | null;
  timestampSuspicious: boolean; // future date or pre-1990 — common tampering/build-artifact signal
  subsystem: string;
  characteristics: string[];
  numberOfSections: number;
  sections: PeSection[];
  overallEntropy: number;
};

export function parsePeMetadata(bytes: Uint8Array): PeMetadata | null {
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return null; // "MZ"

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const peOffset = view.getUint32(0x3c, true);
  if (peOffset + 24 > bytes.length) return null;
  if (view.getUint32(peOffset, true) !== 0x00004550) return null; // "PE\0\0"

  const coffOffset = peOffset + 4;
  const machineRaw = view.getUint16(coffOffset, true);
  const numberOfSections = view.getUint16(coffOffset + 2, true);
  const timeDateStamp = view.getUint32(coffOffset + 4, true);
  const sizeOfOptionalHeader = view.getUint16(coffOffset + 16, true);
  const characteristicsRaw = view.getUint16(coffOffset + 18, true);

  const optOffset = coffOffset + 20;
  const magic = sizeOfOptionalHeader >= 2 ? view.getUint16(optOffset, true) : 0;
  const is64Bit = magic === 0x20b;
  const subsystemRaw = sizeOfOptionalHeader >= 70 ? view.getUint16(optOffset + 68, true) : 0;

  const year = 1970 + timeDateStamp / (365.25 * 24 * 3600);
  const timestamp = timeDateStamp > 0 ? new Date(timeDateStamp * 1000).toISOString() : null;
  const timestampSuspicious = timeDateStamp > 0 && (year < 1993 || new Date(timeDateStamp * 1000) > new Date());

  const sectionTableOffset = optOffset + sizeOfOptionalHeader;
  const sections: PeSection[] = [];
  for (let i = 0; i < numberOfSections; i++) {
    const base = sectionTableOffset + i * 40;
    if (base + 40 > bytes.length) break;
    const nameBytes = bytes.slice(base, base + 8);
    const name = Array.from(nameBytes)
      .filter((b) => b !== 0)
      .map((b) => String.fromCharCode(b))
      .join("");
    const virtualSize = view.getUint32(base + 8, true);
    const rawSize = view.getUint32(base + 16, true);
    const pointerToRawData = view.getUint32(base + 20, true);
    const characteristics = view.getUint32(base + 36, true);

    let entropy = 0;
    if (pointerToRawData > 0 && rawSize > 0 && pointerToRawData + rawSize <= bytes.length) {
      entropy = shannonEntropy(bytes.slice(pointerToRawData, pointerToRawData + Math.min(rawSize, 1_000_000)));
    }

    sections.push({
      name: name || `(section ${i})`,
      virtualSize,
      rawSize,
      executable: (characteristics & SECTION_EXEC) !== 0,
      writable: (characteristics & SECTION_WRITE) !== 0,
      readable: (characteristics & SECTION_READ) !== 0,
      entropy,
    });
  }

  return {
    machine: MACHINE_TYPES[machineRaw] ?? `Unknown (0x${machineRaw.toString(16)})`,
    is64Bit,
    timestamp,
    timestampSuspicious,
    subsystem: SUBSYSTEMS[subsystemRaw] ?? `Unknown (${subsystemRaw})`,
    characteristics: CHARACTERISTIC_FLAGS.filter(([bit]) => (characteristicsRaw & bit) !== 0).map(([, label]) => label),
    numberOfSections,
    sections,
    overallEntropy: shannonEntropy(bytes.slice(0, Math.min(bytes.length, 2_000_000))),
  };
}
