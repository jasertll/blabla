// Real PE (Windows .exe/.dll) structural analysis: import table, section
// table, and Authenticode-presence — parsed directly from the file
// bytes per Microsoft's public PE/COFF specification. This is what lets
// static analysis reason about what a Windows executable would actually
// DO (its declared API surface, whether it's packed/self-modifying)
// without executing it — a real, well-documented technique, distinct
// from (and complementary to) file-type signature matching and entropy.
//
// This is not a disassembler and doesn't resolve indirect/dynamic API
// resolution (GetProcAddress-loaded functions are invisible to a static
// import-table read, which real malware uses specifically to evade this
// kind of check) — that limitation is surfaced in the findings, not
// hidden.

export type PeSection = {
  name: string;
  virtualSize: number;
  virtualAddress: number;
  rawSize: number;
  pointerToRawData: number;
  executable: boolean;
  writable: boolean;
  readable: boolean;
};

export type PeImport = { dll: string; functions: string[] };

export type PeInfo = {
  is64Bit: boolean;
  machine: string;
  subsystem: string;
  numberOfSections: number;
  sections: PeSection[];
  imports: PeImport[];
  hasCertificateTable: boolean;
  entryPointRva: number;
  timestamp: number | null;
  imageBase: number;
  tlsCallbackCount: number | null;
  declaredChecksum: number;
  computedChecksum: number;
};

const MACHINE_NAMES: Record<number, string> = {
  0x014c: "x86 (32-bit)",
  0x8664: "x64 (64-bit)",
  0x01c4: "ARM (32-bit)",
  0xaa64: "ARM64",
  0x0200: "IA64",
};

const SUBSYSTEM_NAMES: Record<number, string> = {
  1: "Native (driver)",
  2: "Windows GUI",
  3: "Windows Console",
  9: "Windows CE GUI",
};

function readCString(bytes: Uint8Array, offset: number, maxLen = 256): string {
  let end = offset;
  while (end < bytes.length && end < offset + maxLen && bytes[end] !== 0) end++;
  return new TextDecoder("latin1").decode(bytes.subarray(offset, end));
}

/** Windows' own PE checksum algorithm (as used by imagehlp.dll's
 * CheckSumMappedFile, which Authenticode signing and some loaders
 * validate against) — a 16-bit-word running sum with 32-bit carry
 * folding, the checksum field itself skipped, plus the file length
 * added at the end. Ported from the community-standard `pefile` Python
 * library's generate_checksum() (github.com/erocarrera/pefile) rather
 * than re-derived, and cross-checked against it on a synthetic buffer
 * before being wired in. Implemented with division/modulo rather than
 * JS's 32-bit bitwise operators specifically because the running sum
 * can exceed 2^31, where `&`/`>>` silently misbehave in JavaScript. */
function computePeChecksum(bytes: Uint8Array, checksumFieldOffset: number): number {
  let checksum = 0;
  const remainder = bytes.length % 4;
  const dataLenDwords = Math.ceil(bytes.length / 4);
  const skipDwordIndex = Math.floor(checksumFieldOffset / 4);

  for (let i = 0; i < dataLenDwords; i++) {
    if (i === skipDwordIndex) continue;
    const o = i * 4;
    const b0 = bytes[o] ?? 0, b1 = bytes[o + 1] ?? 0, b2 = bytes[o + 2] ?? 0, b3 = bytes[o + 3] ?? 0;
    const dword = b0 + b1 * 0x100 + b2 * 0x10000 + b3 * 0x1000000;
    checksum += dword;
    if (checksum >= 4294967296) checksum = (checksum % 4294967296) + Math.floor(checksum / 4294967296);
  }
  checksum = (checksum % 0x10000) + Math.floor(checksum / 0x10000);
  checksum = checksum + Math.floor(checksum / 0x10000);
  checksum = checksum % 0x10000;
  return checksum + bytes.length;
}

/** Parses PE headers, the section table, and the import table. Returns
 * null (never throws) for anything that isn't a well-formed PE it can
 * safely walk — malformed/adversarial input is exactly what this has to
 * be robust against, since it's analyzing untrusted files. */
export function parsePe(bytes: Uint8Array): PeInfo | null {
  try {
    if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return null; // "MZ"
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const peOffset = view.getUint32(0x3c, true);
    if (peOffset + 24 > bytes.length) return null;
    if (view.getUint32(peOffset, true) !== 0x00004550) return null; // "PE\0\0"

    const machine = view.getUint16(peOffset + 4, true);
    const numberOfSections = view.getUint16(peOffset + 6, true);
    const timestamp = view.getUint32(peOffset + 8, true);
    const sizeOfOptionalHeader = view.getUint16(peOffset + 20, true);
    const optHeaderOffset = peOffset + 24;
    if (optHeaderOffset + 2 > bytes.length) return null;

    const magic = view.getUint16(optHeaderOffset, true);
    const is64Bit = magic === 0x20b;
    if (magic !== 0x10b && magic !== 0x20b) return null;

    const subsystemOffset = optHeaderOffset + (is64Bit ? 68 : 68);
    const subsystem = subsystemOffset + 2 <= bytes.length ? view.getUint16(subsystemOffset, true) : 0;
    const entryPointRva = view.getUint32(optHeaderOffset + 16, true);

    const imageBaseOffset = optHeaderOffset + (is64Bit ? 24 : 28);
    const imageBase = is64Bit
      ? Number(view.getBigUint64(imageBaseOffset, true))
      : view.getUint32(imageBaseOffset, true);

    const checksumOffset = optHeaderOffset + 64;
    const declaredChecksum = checksumOffset + 4 <= bytes.length ? view.getUint32(checksumOffset, true) : 0;

    const numberOfRvaAndSizesOffset = optHeaderOffset + (is64Bit ? 108 : 92);
    const dataDirOffset = optHeaderOffset + (is64Bit ? 112 : 96);
    if (numberOfRvaAndSizesOffset + 4 > bytes.length) return null;
    const numberOfRvaAndSizes = view.getUint32(numberOfRvaAndSizesOffset, true);

    function dataDir(index: number): { rva: number; size: number } | null {
      if (index >= numberOfRvaAndSizes) return null;
      const off = dataDirOffset + index * 8;
      if (off + 8 > bytes.length) return null;
      return { rva: view.getUint32(off, true), size: view.getUint32(off + 4, true) };
    }

    const sectionTableOffset = optHeaderOffset + sizeOfOptionalHeader;
    const sections: PeSection[] = [];
    for (let i = 0; i < numberOfSections; i++) {
      const off = sectionTableOffset + i * 40;
      if (off + 40 > bytes.length) break;
      const rawName = new TextDecoder("latin1").decode(bytes.subarray(off, off + 8));
      const name = rawName.replace(/\0+$/, "");
      const virtualSize = view.getUint32(off + 8, true);
      const virtualAddress = view.getUint32(off + 12, true);
      const rawSize = view.getUint32(off + 16, true);
      const pointerToRawData = view.getUint32(off + 20, true);
      const characteristics = view.getUint32(off + 36, true);
      sections.push({
        name,
        virtualSize,
        virtualAddress,
        rawSize,
        pointerToRawData,
        executable: (characteristics & 0x20000000) !== 0,
        writable: (characteristics & 0x80000000) !== 0,
        readable: (characteristics & 0x40000000) !== 0,
      });
    }

    function rvaToOffset(rva: number): number | null {
      for (const s of sections) {
        if (rva >= s.virtualAddress && rva < s.virtualAddress + Math.max(s.virtualSize, s.rawSize)) {
          return rva - s.virtualAddress + s.pointerToRawData;
        }
      }
      return null;
    }

    // Import Directory Table (data directory index 1).
    const imports: PeImport[] = [];
    const importDir = dataDir(1);
    if (importDir && importDir.rva > 0) {
      let descOffset = rvaToOffset(importDir.rva);
      let guard = 0;
      while (descOffset !== null && descOffset + 20 <= bytes.length && guard < 200) {
        guard++;
        const originalFirstThunk = view.getUint32(descOffset, true);
        const nameRva = view.getUint32(descOffset + 12, true);
        const firstThunk = view.getUint32(descOffset + 16, true);
        if (originalFirstThunk === 0 && nameRva === 0 && firstThunk === 0) break;

        const nameOffset = nameRva ? rvaToOffset(nameRva) : null;
        const dllName = nameOffset !== null ? readCString(bytes, nameOffset) : "(unknown)";

        const functions: string[] = [];
        const thunkRva = originalFirstThunk || firstThunk;
        let thunkOffset = thunkRva ? rvaToOffset(thunkRva) : null;
        const entrySize = is64Bit ? 8 : 4;
        let thunkGuard = 0;
        while (thunkOffset !== null && thunkOffset + entrySize <= bytes.length && thunkGuard < 500) {
          thunkGuard++;
          const entry = is64Bit ? view.getBigUint64(thunkOffset, true) : BigInt(view.getUint32(thunkOffset, true));
          if (entry === 0n) break;
          const ordinalFlag = is64Bit ? 0x8000000000000000n : 0x80000000n;
          if ((entry & ordinalFlag) === 0n) {
            const hintNameRva = Number(entry & 0x7fffffffn);
            const hintNameOffset = rvaToOffset(hintNameRva);
            if (hintNameOffset !== null) functions.push(readCString(bytes, hintNameOffset + 2));
          }
          thunkOffset += entrySize;
        }

        imports.push({ dll: dllName, functions });
        descOffset += 20;
      }
    }

    const certDir = dataDir(4);
    const hasCertificateTable = !!certDir && certDir.size > 0;

    // TLS callbacks (data directory index 9): a NULL-terminated array of
    // function pointers that run BEFORE the declared entry point, when
    // the process/thread starts — a well-documented anti-debugging/
    // early-execution technique, since most disassemblers and casual
    // analysis jump straight to AddressOfEntryPoint and miss this.
    let tlsCallbackCount: number | null = null;
    const tlsDir = dataDir(9);
    if (tlsDir && tlsDir.rva > 0) {
      const tlsOffset = rvaToOffset(tlsDir.rva);
      if (tlsOffset !== null) {
        const callbacksFieldOffset = tlsOffset + (is64Bit ? 16 : 12);
        const callbacksVa = is64Bit
          ? (callbacksFieldOffset + 8 <= bytes.length ? Number(view.getBigUint64(callbacksFieldOffset, true)) : 0)
          : (callbacksFieldOffset + 4 <= bytes.length ? view.getUint32(callbacksFieldOffset, true) : 0);
        if (callbacksVa > 0) {
          const callbacksRva = callbacksVa - imageBase;
          let arrayOffset = rvaToOffset(callbacksRva);
          let count = 0;
          let guard = 0;
          const ptrSize = is64Bit ? 8 : 4;
          while (arrayOffset !== null && arrayOffset + ptrSize <= bytes.length && guard < 200) {
            const ptr = is64Bit ? view.getBigUint64(arrayOffset, true) : BigInt(view.getUint32(arrayOffset, true));
            if (ptr === 0n) break;
            count++;
            arrayOffset += ptrSize;
            guard++;
          }
          tlsCallbackCount = count;
        } else {
          tlsCallbackCount = 0;
        }
      }
    }

    const computedChecksum = computePeChecksum(bytes, checksumOffset);

    return {
      is64Bit,
      machine: MACHINE_NAMES[machine] ?? `Unknown (0x${machine.toString(16)})`,
      subsystem: SUBSYSTEM_NAMES[subsystem] ?? `Unknown (${subsystem})`,
      numberOfSections,
      sections,
      imports,
      hasCertificateTable,
      entryPointRva,
      timestamp: timestamp > 0 ? timestamp : null,
      imageBase,
      tlsCallbackCount,
      declaredChecksum,
      computedChecksum,
    };
  } catch {
    return null;
  }
}

export type PeRiskFinding = {
  id: string;
  severity: "danger" | "warning" | "info" | "safe";
  title: string;
  summary: string;
  explanation: string;
  recommendation: string;
};

// Real, well-documented API groupings used to reason about likely
// capability from the DECLARED import table alone. Each combination
// reflects a genuine, widely-documented technique — this is not a
// malware-family signature match, it's "this binary imports the
// specific functions needed to do X", which is a real static signal.
const API_GROUPS: { id: string; label: string; apis: string[] }[] = [
  { id: "alloc", label: "memory allocation", apis: ["VirtualAlloc", "VirtualAllocEx", "NtAllocateVirtualMemory", "HeapAlloc"] },
  { id: "writemem", label: "remote memory write", apis: ["WriteProcessMemory", "NtWriteVirtualMemory"] },
  { id: "remotethread", label: "remote thread creation", apis: ["CreateRemoteThread", "CreateRemoteThreadEx", "NtCreateThreadEx", "RtlCreateUserThread"] },
  { id: "processopen", label: "opening another process", apis: ["OpenProcess", "NtOpenProcess"] },
  { id: "crypto", label: "encryption APIs", apis: ["CryptEncrypt", "CryptAcquireContext", "BCryptEncrypt", "CryptGenKey", "BCryptGenRandom"] },
  { id: "fileenum", label: "mass file enumeration", apis: ["FindFirstFile", "FindFirstFileW", "FindNextFile", "FindNextFileW"] },
  { id: "keylog", label: "keyboard/input hooking", apis: ["SetWindowsHookEx", "GetAsyncKeyState", "GetKeyState", "RegisterRawInputDevices"] },
  { id: "antidebug", label: "anti-debugging checks", apis: ["IsDebuggerPresent", "CheckRemoteDebuggerPresent", "NtQueryInformationProcess", "OutputDebugString"] },
  { id: "network", label: "network/download capability", apis: ["InternetOpen", "InternetOpenUrl", "WinHttpOpen", "URLDownloadToFile", "socket", "connect", "send", "recv"] },
  { id: "persistence", label: "registry persistence", apis: ["RegSetValueEx", "RegSetValueExW", "RegCreateKeyEx", "RegCreateKeyExW"] },
  { id: "shellexec", label: "spawning other processes", apis: ["ShellExecute", "ShellExecuteEx", "WinExec", "CreateProcess", "CreateProcessW", "CreateProcessA"] },
  { id: "servicecontrol", label: "Windows service control", apis: ["OpenSCManager", "CreateService", "StartService"] },
  { id: "tokenpriv", label: "token/privilege manipulation", apis: ["AdjustTokenPrivileges", "OpenProcessToken", "LookupPrivilegeValue"] },
  { id: "shadowcopy", label: "shadow copy / backup deletion (ransomware pattern)", apis: ["DeviceIoControl"] },
];

export function importedFunctionSet(imports: PeImport[]): Set<string> {
  const set = new Set<string>();
  for (const imp of imports) {
    for (const fn of imp.functions) set.add(fn.replace(/[AW]$/, "").toLowerCase());
  }
  return set;
}

/** Synthesizes the parsed import table + section table into concrete,
 * explainable findings — the same "here's the evidence, here's what it
 * means, here's what to do" format as the rest of this app's file
 * analysis, applied to real PE structure instead of just entropy/magic
 * bytes. */
export function analyzePeRisk(info: PeInfo): PeRiskFinding[] {
  const findings: PeRiskFinding[] = [];
  const fnSet = importedFunctionSet(info.imports);
  const present = new Map<string, boolean>();
  for (const group of API_GROUPS) {
    const hit = group.apis.some((api) => fnSet.has(api.replace(/[AW]$/, "").toLowerCase()));
    present.set(group.id, hit);
  }

  // Process injection combo: alloc + remote write + remote thread is
  // the textbook classic-injection pattern (used by both legitimate
  // debuggers/security tools AND a large share of real malware).
  if (present.get("alloc") && present.get("writemem") && present.get("remotethread")) {
    findings.push({
      id: "pe-injection-combo",
      severity: "danger",
      title: "Imports the classic process-injection API combination",
      summary: "This binary imports functions to allocate memory in another process, write to it, and start a thread there — the standard process-injection pattern.",
      explanation: "VirtualAlloc(Ex)/WriteProcessMemory/CreateRemoteThread together let one process run arbitrary code inside another — used by malware to hide inside a legitimate process, and also (less commonly) by debuggers and legitimate security/automation tools. Declaring these imports doesn't prove malicious use, but this exact combination together is a well-known, high-signal pattern.",
      recommendation: "Treat this as a strong lead, not a verdict. Cross-check against the file's digital signature (below) and its CIRCL known-good status before concluding anything.",
    });
  } else if (present.get("writemem") && present.get("processopen")) {
    findings.push({
      id: "pe-cross-process-write",
      severity: "warning",
      title: "Imports cross-process memory-write capability",
      summary: "This binary can open another process and write to its memory.",
      explanation: "OpenProcess + WriteProcessMemory is a necessary (if not sufficient) building block for process injection/tampering — legitimate uses exist (debuggers, some anti-cheat/security tools) but it's worth noting.",
      recommendation: "Consider alongside the other findings here before drawing a conclusion.",
    });
  }

  if (present.get("crypto") && present.get("fileenum")) {
    findings.push({
      id: "pe-ransomware-pattern",
      severity: "danger",
      title: "Imports both encryption and mass file-enumeration APIs",
      summary: "This binary can both walk through many files and encrypt data — the two capabilities ransomware needs together.",
      explanation: "Neither capability alone is unusual (plenty of legitimate backup/sync/security software uses both), but the SPECIFIC combination of bulk file enumeration plus encryption primitives in the same binary is the standard static fingerprint analysts look for when triaging suspected ransomware.",
      recommendation: "High-priority for deeper review. If this wasn't expected to be encryption/backup software, treat it as actively suspicious.",
    });
  }

  if (present.get("keylog")) {
    findings.push({
      id: "pe-keylogging",
      severity: "warning",
      title: "Imports keyboard-hooking / input-capture APIs",
      summary: "This binary can install a global keyboard hook or poll key states.",
      explanation: "SetWindowsHookEx and GetAsyncKeyState are legitimately used by some accessibility tools, hotkey managers, and games — but are also the standard building blocks of keylogging malware.",
      recommendation: "Check whether this program has a legitimate documented reason to monitor keyboard input.",
    });
  }

  if (present.get("antidebug")) {
    findings.push({
      id: "pe-antidebug",
      severity: "warning",
      title: "Imports anti-debugging / analysis-evasion APIs",
      summary: "This binary checks whether it's being debugged or analyzed.",
      explanation: "IsDebuggerPresent and similar checks are sometimes used by legitimate commercial software for license protection, but are also standard in malware to detect and evade sandboxed analysis.",
      recommendation: "A binary actively checking for analysis tools is worth extra scrutiny, especially combined with any other finding here.",
    });
  }

  if (present.get("network") && present.get("shellexec")) {
    findings.push({
      id: "pe-download-execute",
      severity: "danger",
      title: "Imports both network/download and process-execution APIs",
      summary: "This binary can reach the network to fetch something AND launch other processes.",
      explanation: "The download-and-execute pattern (fetch a payload, then run it) is one of the most common real-world droppers/loaders behaviors — legitimate installers/updaters do this too, so context matters, but the combination is a genuine, specific signal.",
      recommendation: "If this isn't a known installer/updater, treat this combination as a real red flag.",
    });
  }

  if (present.get("persistence") && present.get("shellexec")) {
    findings.push({
      id: "pe-persistence",
      severity: "warning",
      title: "Imports registry-write and process-launch APIs together",
      summary: "This binary can write registry values and launch processes — the building blocks of Run-key style persistence.",
      explanation: "Writing to the registry combined with the ability to launch programs is consistent with installing a persistence mechanism (e.g. a Run key that re-launches the program at every login) — also common in entirely legitimate installers.",
      recommendation: "Expected for an installer; worth scrutiny for anything that isn't one.",
    });
  }

  // Section anomalies: a section marked both writable AND executable
  // (or that has grown from its declared virtual size) is the classic
  // fingerprint of a packer that decompresses/decrypts code into
  // memory at runtime — legitimate compilers essentially never produce
  // W+X sections.
  const wxSections = info.sections.filter((s) => s.executable && s.writable);
  if (wxSections.length > 0) {
    findings.push({
      id: "pe-wx-section",
      severity: "warning",
      title: `${wxSections.length} section${wxSections.length === 1 ? "" : "s"} marked both writable AND executable`,
      summary: `Section${wxSections.length === 1 ? "" : "s"}: ${wxSections.map((s) => s.name || "(unnamed)").join(", ")}.`,
      explanation: "Normal compiler output separates code (execute-only) from data (write-only) — a section that's both writable and executable means the program can modify its own code at runtime, which is exactly how most packers/crypters unpack the real payload into memory to evade static signature scanning on disk.",
      recommendation: "Consistent with packing. Combined with high overall entropy (see the entropy findings above) this is a meaningfully stronger signal than either alone.",
    });
  }

  const suspiciousSectionNames = info.sections.filter((s) => s.name && !/^\.(text|data|rdata|rsrc|reloc|bss|idata|edata|pdata|tls|debug)$/i.test(s.name) && s.name !== "");
  if (suspiciousSectionNames.length > 0 && info.sections.length <= 6) {
    findings.push({
      id: "pe-unusual-sections",
      severity: "info",
      title: "Non-standard section name(s) present",
      summary: `Section name${suspiciousSectionNames.length === 1 ? "" : "s"}: ${suspiciousSectionNames.map((s) => s.name).join(", ")}.`,
      explanation: "Standard compilers use a well-known set of section names (.text, .data, .rdata, .rsrc, .reloc…) — non-standard names are common in packed/obfuscated binaries (some packers even use recognizable names like UPX0/UPX1), though plenty of legitimate compilers/languages also use their own conventions.",
      recommendation: "Not conclusive alone — a mild supporting signal alongside the others here.",
    });
  }

  // TLS callbacks: real code that runs before the declared entry point.
  if (info.tlsCallbackCount !== null && info.tlsCallbackCount > 0) {
    findings.push({
      id: "pe-tls-callbacks",
      severity: "warning",
      title: `${info.tlsCallbackCount} TLS callback${info.tlsCallbackCount === 1 ? "" : "s"} present — code runs before the declared entry point`,
      summary: "This binary registers Thread Local Storage callback function(s) in its TLS directory.",
      explanation: "TLS callbacks execute automatically when a process/thread starts, BEFORE control ever reaches AddressOfEntryPoint — a well-documented technique for running code that a casual analysis (which typically jumps straight to the declared entry point) would miss entirely, and a classic anti-debugging trick since some debuggers historically didn't break on TLS callbacks by default.",
      recommendation: "If disassembling this binary, check the TLS callback(s) specifically, not just the main entry point — legitimate uses exist (some runtime/language initialization), but it's an unusual thing for ordinary application code to need.",
    });
  }

  // PE checksum: legitimate compilers/linkers set this correctly for
  // drivers and anything Authenticode-signed; a mismatch (especially a
  // declared value of 0 on a file that otherwise looks like a normal
  // user-mode EXE/DLL) is common in hand-built or malware-authoring-tool
  // output that never recomputed it after modification.
  if (info.declaredChecksum !== 0 && info.declaredChecksum !== info.computedChecksum) {
    findings.push({
      id: "pe-checksum-mismatch",
      severity: "warning",
      title: "Declared PE checksum does not match the computed checksum",
      summary: `Header declares checksum 0x${info.declaredChecksum.toString(16)}, but the actual computed checksum is 0x${info.computedChecksum.toString(16)}.`,
      explanation: "Windows' own PE checksum algorithm (the same one imagehlp.dll's CheckSumMappedFile computes, and Authenticode signature validation checks) should match the file's real content. A mismatch means the file was modified after the checksum was last set — normal for a hand-edited or maliciously-patched binary, though some legitimate build tools also skip setting it correctly for non-driver, non-signed executables (where Windows doesn't enforce it at load time).",
      recommendation: "Weigh this alongside the digital-signature finding below — a mismatch on a file that also claims to be signed is a stronger signal than on an unsigned one.",
    });
  }

  // Compile timestamp anomalies — a real, well-documented static red
  // flag from the malware-analysis community (see Practical Malware
  // Analysis and PEStudio's own timestamp checks): either zeroed/absurd
  // values (deliberately scrubbed) or dates in the future (a build
  // machine with a wrong clock, or the timestamp field reused/copied
  // from elsewhere without updating it).
  if (info.timestamp !== null) {
    const compileDate = new Date(info.timestamp * 1000);
    const now = new Date();
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (compileDate.getTime() > now.getTime() + oneDayMs) {
      findings.push({
        id: "pe-timestamp-future",
        severity: "warning",
        title: "Compile timestamp is in the future",
        summary: `Declared compile time: ${compileDate.toISOString()} (after today).`,
        explanation: "A PE's compile timestamp should never be later than when you're looking at the file. A future date usually means the timestamp was deliberately falsified or copied from an unrelated file, rather than a genuine build artifact — legitimate software is essentially never built in the future.",
        recommendation: "Treat the declared build date as unreliable. Worth extra scrutiny alongside the other findings here.",
      });
    } else if (compileDate.getUTCFullYear() < 1993) {
      findings.push({
        id: "pe-timestamp-implausible",
        severity: "info",
        title: "Compile timestamp predates the PE format itself",
        summary: `Declared compile time: ${compileDate.toISOString()}.`,
        explanation: "The PE format wasn't in real-world use before Windows NT (1993) — a timestamp before that is not a genuine build date, meaning this field was deliberately zeroed/randomized/reused rather than left as a normal compiler output.",
        recommendation: "Not conclusive alone (some build tools intentionally zero this for reproducible builds) but worth noting alongside other findings.",
      });
    }
  }

  // Minimal import table: a packed or shellcode-loader binary commonly
  // imports almost nothing at the PE level (often just enough to call
  // LoadLibrary/GetProcAddress and resolve everything else itself at
  // runtime) — the same "few or no interesting imports" flag PEStudio
  // and similar tools surface.
  const totalImportedFunctions = info.imports.reduce((n, imp) => n + imp.functions.length, 0);
  if (info.imports.length > 0 && info.imports.length <= 2 && totalImportedFunctions <= 4) {
    findings.push({
      id: "pe-minimal-imports",
      severity: "warning",
      title: "Unusually small import table",
      summary: `Only ${info.imports.length} imported DLL${info.imports.length === 1 ? "" : "s"} with ${totalImportedFunctions} total function${totalImportedFunctions === 1 ? "" : "s"}.`,
      explanation: "A normal, non-trivial Windows program typically imports dozens of functions across several DLLs. A near-empty import table — often just enough to call LoadLibrary/GetProcAddress — is the standard fingerprint of a packed executable or a loader/shellcode stub that resolves its real API surface dynamically at runtime specifically to defeat static import-table analysis (the same gap the string-based capability scan below is designed to help close).",
      recommendation: "Consistent with packing. Cross-check the string-based capability findings elsewhere in this report — those catch API names referenced as plain text even when the import table itself looks empty.",
    });
  }

  // Authenticode presence.
  if (!info.hasCertificateTable) {
    findings.push({
      id: "pe-unsigned",
      severity: "info",
      title: "No Authenticode digital signature present",
      summary: "This executable does not carry a code-signing certificate.",
      explanation: "Unsigned executables are extremely common and this alone means nothing — most legitimate open-source and small-vendor software is unsigned too. But a signed executable from a well-known publisher is a real positive signal, so its absence is worth noting as one factor among many, especially for something claiming to be from a major vendor.",
      recommendation: "If this file claims to be from a specific company/product, the lack of a matching signature is worth double-checking.",
    });
  } else {
    findings.push({
      id: "pe-signed",
      severity: "safe",
      title: "Carries an Authenticode certificate table",
      summary: "This executable includes a digital signature structure.",
      explanation: "A present certificate table means the binary WAS signed by someone — this static check confirms presence only, not that the signature is valid/unexpired/from a trusted root, or that it actually matches the file content (full cryptographic verification needs a dedicated tool, e.g. Windows' own signtool/PowerShell Get-AuthenticodeSignature).",
      recommendation: "Verify the actual signer identity and validity with signtool/Get-AuthenticodeSignature before trusting this as a strong signal on its own.",
    });
  }

  if (findings.every((f) => f.severity === "safe" || f.severity === "info")) {
    findings.push({
      id: "pe-clean",
      severity: "safe",
      title: "No high-risk API combinations found in the import table",
      summary: `Scanned ${info.imports.length} imported DLL${info.imports.length === 1 ? "" : "s"} against known-suspicious capability combinations.`,
      explanation: "This only covers statically-declared imports — a binary that resolves functions dynamically via GetProcAddress (a common evasion technique) won't show its real capability here at all.",
      recommendation: "A clean import-table scan is reassuring but not conclusive by itself, especially for a packed binary (see the entropy/section findings above).",
    });
  }

  return findings;
}
