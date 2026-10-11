// Real VBA macro extraction and analysis — the same job oletools/olevba
// (the community-standard tool for malicious-Office-document triage)
// does: parse the CFB container, decompress each module's MS-OVBA
// source stream, and scan the actual recovered source code for the
// keyword patterns real malware uses. Works for both modern documents
// (vbaProject.bin extracted from the .docm/.xlsm/.pptm zip) and legacy
// .doc/.xls/.ppt (which ARE a top-level CFB file), via the same code
// path, since both are scanned stream-by-stream without assuming a
// fixed storage layout.
//
// One honest limitation: a module stream is [performance cache p-code]
// followed by [compressed source code] at an offset normally read from
// the project's "dir" stream (a compressed record stream of its own).
// Rather than fully implementing dir-stream record parsing, this scans
// each stream for the MS-OVBA signature byte + a valid chunk header and
// attempts decompression there — accepted only if it decodes to a high-
// printable-ratio result, which in practice reliably finds the real
// source (a coincidental match inside binary p-code that ALSO happens
// to decompress into mostly-printable text is vanishingly unlikely).

import { parseCfb } from "./cfbParser";
import { decompressVbaStream } from "./vbaDecompress";
import { extractIocs, findBase64Candidates, type IocSet } from "./stringExtraction";

export type MacroFinding = {
  id: string;
  severity: "danger" | "warning" | "info";
  title: string;
  summary: string;
  explanation: string;
  recommendation: string;
};

export type MacroExtractionResult = {
  found: boolean;
  modules: { name: string; sourceLength: number }[];
  combinedSource: string;
  findings: MacroFinding[];
  iocs: IocSet;
  deobfuscatedIocs: IocSet;
};

// Runs when the document opens/closes/changes — the actual trigger that
// turns "has a macro" into "runs code the instant this file is opened."
// [MS-OVBA] / oletools' AUTOEXEC_KEYWORDS, trimmed to the entries that
// matter for real-world Word/Excel/Publisher documents.
const AUTOEXEC_KEYWORDS: [string, string[]][] = [
  ["Runs automatically when the document/workbook is opened", ["AutoExec", "AutoOpen", "DocumentOpen", "Document_Open", "Auto_Open", "Workbook_Open", "Workbook_Activate"]],
  ["Runs automatically when the document/workbook is closed", ["AutoExit", "AutoClose", "Document_Close", "DocumentBeforeClose", "Auto_Close", "Workbook_Close", "Workbook_BeforeClose"]],
  ["Runs automatically when a new document is created", ["AutoNew", "Document_New", "NewDocument"]],
  ["May run when an Excel worksheet recalculates (used to auto-trigger without a classic AutoOpen)", ["Worksheet_Calculate"]],
];

// The actual capability behind each keyword — oletools' SUSPICIOUS_KEYWORDS
// table, trimmed to the categories that matter most for triage, with the
// same "why this matters" reasoning.
const SUSPICIOUS_KEYWORDS: { label: string; severity: "danger" | "warning" | "info"; keywords: string[] }[] = [
  { label: "May inject code into another process — classic process-injection API combination", severity: "danger",
    keywords: ["CreateThread", "CreateUserThread", "VirtualAlloc", "VirtualAllocEx", "RtlMoveMemory", "WriteProcessMemory", "SetContextThread", "QueueApcThread", "WriteVirtualMemory", "VirtualProtect"] },
  { label: "May run an executable file or a system command", severity: "danger",
    keywords: ["Shell", "WScript.Shell", "Shell.Application", "ShellExecute", "ShellExecuteA", "InvokeVerb", "InvokeVerbEx"] },
  { label: "May run PowerShell commands (often with an encoded/hidden payload)", severity: "danger",
    keywords: ["PowerShell", "noexit", "ExecutionPolicy", "noprofile", "EncodedCommand", "Invoke-Expression", "Start-Process", "New-Object", "AuthorizationManager"] },
  { label: "May download files from the internet", severity: "danger",
    keywords: ["URLDownloadToFileA", "Msxml2.XMLHTTP", "Microsoft.XMLHTTP", "MSXML2.ServerXMLHTTP", "Net.WebClient", "DownloadFile", "DownloadString"] },
  { label: "May create an OLE/COM object (a common way to bypass macro-security prompts)", severity: "warning",
    keywords: ["CreateObject", "GetObject"] },
  { label: "May read or write registry keys (persistence or config tampering)", severity: "warning",
    keywords: ["RegOpenKeyEx", "RegOpenKeyExA", "RegCloseKey", "RegQueryValueEx", "RegQueryValueExA", "RegRead", "RegWrite", "RegDelete"] },
  { label: "May read system environment variables (recon before the real payload runs)", severity: "info",
    keywords: ["Environ", "Win32_Environment", "ExpandEnvironmentStrings"] },
  { label: "May attempt to obfuscate strings or code (Chr()/StrReverse/Xor encoding, or self-modifying the VBA project)", severity: "warning",
    keywords: ["StrReverse", "ChrW", "ChrB", "CallByName", "VBProject", "VBComponents", "CodeModule", "AddFromString"] },
  { label: "May detect a sandbox/analysis environment and change behavior to evade it", severity: "warning",
    keywords: ["VIRTUAL", "VMWARE", "VBOX", "SbieDll.dll", "SandboxieControlWndClass", "GetVolumeInformation", "GetVolumeInformationA"] },
  { label: "May attempt to disable macro security warnings / Protected View", severity: "danger",
    keywords: ["AccessVBOM", "VBAWarnings", "ProtectedView", "DisableAttachementsInPV", "DisableInternetFilesInPV", "DisableUnsafeLocationsInPV", "blockcontentexecutionfrominternet"] },
  { label: "May delete, move, or copy files on disk", severity: "warning",
    keywords: ["Kill", "FileCopy", "CopyFile", "MoveFile", "MoveFolder"] },
  { label: "May create a text/binary file and write to it", severity: "info",
    keywords: ["CreateTextFile", "ADODB.Stream", "WriteText", "SaveToFile"] },
];

function printableRatio(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let printable = 0;
  for (const b of bytes) if ((b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d) printable++;
  return printable / bytes.length;
}

function bytesToLatin1(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/** Scans a single CFB stream for a recoverable MS-OVBA compressed
 * source-code region — see the module-level comment for why this is a
 * scan rather than an exact offset lookup. */
function findVbaSourceInStream(data: Uint8Array): string | null {
  for (let i = 0; i < data.length - 2; i++) {
    if (data[i] !== 0x01) continue;
    const header = data[i + 1] | (data[i + 2] << 8);
    if (((header >>> 12) & 0x07) !== 0b011) continue;
    try {
      const decompressed = decompressVbaStream(data.subarray(i));
      if (decompressed.length < 20) continue;
      if (printableRatio(decompressed) < 0.85) continue;
      return bytesToLatin1(decompressed);
    } catch {
      // not a real MS-OVBA stream at this offset — keep scanning
    }
  }
  return null;
}

/** Given the raw bytes of a CFB container (either a vbaProject.bin
 * extracted from a modern OOXML zip, or a legacy .doc/.xls/.ppt file's
 * own bytes), extracts every recoverable macro module's real source
 * code and runs the suspicious-keyword + IOC scan against it. */
export function analyzeVbaProject(cfbBytes: Uint8Array): MacroExtractionResult {
  const empty: MacroExtractionResult = {
    found: false, modules: [], combinedSource: "", findings: [],
    iocs: { urls: [], ips: [], domains: [], emails: [] },
    deobfuscatedIocs: { urls: [], ips: [], domains: [], emails: [] },
  };

  const entries = parseCfb(cfbBytes);
  if (!entries) return empty;

  const modules: { name: string; sourceLength: number }[] = [];
  const sources: string[] = [];
  for (const e of entries) {
    if (!e.isStream || e.data.length < 20) continue;
    const source = findVbaSourceInStream(e.data);
    if (source) {
      modules.push({ name: e.path.join("/"), sourceLength: source.length });
      sources.push(source);
    }
  }

  if (modules.length === 0) return empty;

  const combinedSource = sources.join("\n\n' ---- next module ----\n\n");
  const findings: MacroFinding[] = [];

  for (const [label, keywords] of AUTOEXEC_KEYWORDS) {
    const hit = keywords.find((k) => combinedSource.includes(k));
    if (hit) {
      findings.push({
        id: `autoexec-${hit}`,
        severity: "danger",
        title: `Auto-executing macro procedure found: ${hit}`,
        summary: label,
        explanation: "This procedure name is one of the handful VBA/Office recognize as auto-run triggers — code inside it executes the instant the document is opened, closed, or changed, with no user action beyond opening the file (and clicking \"Enable Content\" if macros were disabled).",
        recommendation: "Read what this procedure actually does below — an auto-run trigger combined with any of the capability findings below (especially Shell/PowerShell/download/process-injection) is the standard shape of a malicious-macro dropper.",
      });
    }
  }

  for (const group of SUSPICIOUS_KEYWORDS) {
    const hits = group.keywords.filter((k) => combinedSource.includes(k));
    if (hits.length > 0) {
      findings.push({
        id: `susp-${hits[0]}`,
        severity: group.severity,
        title: group.label,
        summary: `Matched keyword(s): ${hits.join(", ")}`,
        explanation: "This is a real capability signal from the actual decompressed VBA source, not a guess from the file's metadata — the same category of keyword-matching oletools/olevba use for macro triage.",
        recommendation: "Individually, most of these keywords have legitimate uses (this is exactly why this reports capability, not a verdict) — what matters is the COMBINATION: an auto-run trigger + Shell/PowerShell/download + obfuscation together is a strong malicious pattern, while a single File I/O keyword in an otherwise unremarkable macro often isn't.",
      });
    }
  }

  const iocs = extractIocs(combinedSource);
  const base64Hits = findBase64Candidates(combinedSource);
  const deobfuscatedText = base64Hits.map((h) => h.decodedText).filter((t): t is string => !!t).join("\n");
  const deobfuscatedIocs = extractIocs(deobfuscatedText);

  if (base64Hits.some((h) => h.decodedText)) {
    findings.push({
      id: "macro-base64",
      severity: "warning",
      title: "Base64-encoded text found inside the macro source",
      summary: `${base64Hits.filter((h) => h.decodedText).length} base64 block(s) decoded to readable text.`,
      explanation: "Encoding strings (URLs, commands, or a second-stage payload) as base64 inside otherwise-plain VBA source is a standard obfuscation step specifically to defeat simple keyword/string scanning — oletools calls this out explicitly and auto-decodes it for the same reason.",
      recommendation: "Review the decoded content in the IOCs/strings below — treat any URL or command revealed this way as the real payload the obfuscation was hiding.",
    });
  }

  if (iocs.urls.length > 0 || deobfuscatedIocs.urls.length > 0) {
    findings.push({
      id: "macro-urls",
      severity: "danger",
      title: "URL(s) found in the macro source",
      summary: `${[...iocs.urls, ...deobfuscatedIocs.urls].length} URL(s) referenced directly or via decoded base64.`,
      explanation: "A URL hardcoded into macro source is very commonly the download location for the actual malicious payload (the macro itself is often just a small downloader/dropper).",
      recommendation: "Check every URL found here through the Domain & URL Scan and URL Analyzer tools before doing anything else with this document.",
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: "macro-clean",
      severity: "info",
      title: "Macro source recovered, no suspicious keywords matched",
      summary: `${modules.length} module(s), ${combinedSource.length.toLocaleString()} characters of source recovered and scanned.`,
      explanation: "This scan covers the well-documented keyword categories real Office malware uses (auto-exec triggers, process injection, PowerShell, downloads, registry, obfuscation, sandbox evasion) — a clean result here means none of those matched, not that the macro is provably safe.",
      recommendation: "Read the recovered source directly below if you want to verify by eye.",
    });
  }

  return { found: true, modules, combinedSource, findings, iocs, deobfuscatedIocs };
}
