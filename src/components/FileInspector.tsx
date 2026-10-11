"use client";

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileWarning, Loader2, ShieldAlert, ShieldCheck, Info, AlertTriangle, CheckCircle2, HelpCircle, Pin, FileDown, Dna, ChevronDown, ChevronUp } from "lucide-react";
import { useInvestigation } from "@/contexts/InvestigationContext";
import { buildFileReport, openReport } from "@/lib/reportGenerator";
import {
  sha256Hex,
  detectFileType,
  computeEntropyProfile,
  extractInterestingStrings,
  extractPdfMetadataBestEffort,
  scanPdfActiveContent,
  checkExtensionMismatch,
  scanEmbeddedSignatures,
  checkTrailingDataAfterEof,
  buildVerdicts,
  computeRiskScore,
  type FileSignature,
  type Verdict,
  type Severity,
  type EntropyProfile,
} from "@/lib/fileAnalysis";
import { parsePe, analyzePeRisk, importedFunctionSet } from "@/lib/peAnalysis";
import { parseElf, analyzeElfRisk } from "@/lib/elfAnalysis";
import { analyzeVbaProject, type MacroExtractionResult } from "@/lib/macroAnalysis";
import { analyzeMalwareIndicators } from "@/lib/malwareIndicators";
import type { HashLookupResult } from "@/lib/osintTypes";
import EvidenceGraph from "@/components/fileInspector/EvidenceGraph";
import StructuralTree from "@/components/fileInspector/StructuralTree";
import AttackTechniquePanel from "@/components/fileInspector/AttackTechniquePanel";

// Dynamically loaded — DnaView pulls in Three.js for its 3D entropy
// landscape, which most File Inspector runs never open. Same lazy-on-
// first-use pattern as the heavy engines elsewhere in this app (OCR,
// tfjs face/object detection).
const DnaView = dynamic(() => import("@/components/fileInspector/DnaView"), {
  ssr: false,
  loading: () => <p className="text-xs text-slate-500 py-4">Loading DNA view…</p>,
});

type Analysis = {
  fileName: string;
  fileSize: number;
  sha256: string;
  sha1: string;
  sha512: string;
  mimeType: string;
  lastModified: string;
  primaryType: FileSignature | null;
  typeLabel: string;
  entropyProfile: EntropyProfile;
  hasMacros: boolean | null; // null = not applicable / not determined
  macroNote: string;
  macroResult: MacroExtractionResult | null;
  interestingStrings: string[];
  pdfMeta: Record<string, string> | null;
  exif: Record<string, unknown> | null;
  circl: HashLookupResult["circlHashlookup"] | null;
  verdicts: Verdict[];
  overallSeverity: Severity;
  peInfo: ReturnType<typeof parsePe>;
  elfInfo: ReturnType<typeof parseElf>;
};

async function hashHex(algo: "SHA-1" | "SHA-256" | "SHA-512", buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest(algo, buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function analyzeOoxmlMacros(buffer: ArrayBuffer): Promise<{ hasMacros: boolean; note: string; remoteTemplates: string[]; macroResult: MacroExtractionResult | null }> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    const vbaEntryName = Object.keys(zip.files).find((name) => name.toLowerCase().includes("vbaproject.bin"));
    const hasVba = !!vbaEntryName;

    let macroResult: MacroExtractionResult | null = null;
    if (vbaEntryName) {
      try {
        const vbaBytes = await zip.files[vbaEntryName].async("uint8array");
        macroResult = analyzeVbaProject(vbaBytes);
      } catch {
        macroResult = null;
      }
    }

    // Remote template injection: an OOXML document can reference an
    // external .dotm/.xltm template (or other object) via a relationship
    // file with TargetMode="External" pointing at a URL — the template
    // loads (and its macros run) from that URL when the document opens,
    // letting an attacker ship a completely macro-free-looking document
    // that only becomes malicious once opened online. Scanning every
    // .rels file for an External target is the standard static check.
    const remoteTemplates: string[] = [];
    const relsFiles = Object.keys(zip.files).filter((n) => n.toLowerCase().endsWith(".rels"));
    for (const relPath of relsFiles) {
      try {
        const content = await zip.files[relPath].async("string");
        const matches = content.matchAll(/<Relationship[^>]*TargetMode="External"[^>]*Target="([^"]+)"/gi);
        for (const m of matches) {
          if (/^https?:\/\//i.test(m[1])) remoteTemplates.push(m[1]);
        }
      } catch {
        // Unreadable individual .rels entry — skip it, doesn't block the rest of the scan.
      }
    }

    return {
      hasMacros: hasVba,
      note: hasVba
        ? macroResult?.found
          ? `Contains a vbaProject.bin stream — ${macroResult.modules.length} macro module(s) extracted and scanned (${macroResult.combinedSource.length.toLocaleString()} characters of real decompiled source recovered, not just a boolean check).`
          : "Contains a vbaProject.bin stream — this file has embedded VBA macros (source extraction didn't recover readable module text, but macros are present)."
        : "No vbaProject.bin found — no OOXML macros detected.",
      remoteTemplates: [...new Set(remoteTemplates)],
      macroResult,
    };
  } catch {
    return { hasMacros: false, note: "Could not parse as a ZIP/OOXML container.", remoteTemplates: [], macroResult: null };
  }
}

async function tryExif(file: File): Promise<Record<string, unknown> | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const exifr = (await import("exifr")).default;
    const data = await exifr.parse(file);
    return data ?? null;
  } catch {
    return null;
  }
}

const SEVERITY_STYLE: Record<Severity, { border: string; bg: string; text: string; icon: ReactElement; label: string }> = {
  danger: { border: "border-red-700/60", bg: "bg-red-950/40", text: "text-red-300", icon: <ShieldAlert className="h-4 w-4" />, label: "DANGER" },
  warning: { border: "border-amber-700/60", bg: "bg-amber-950/30", text: "text-amber-300", icon: <AlertTriangle className="h-4 w-4" />, label: "WARNING" },
  info: { border: "border-cyan-700/60", bg: "bg-cyan-950/30", text: "text-cyan-300", icon: <HelpCircle className="h-4 w-4" />, label: "INFO" },
  safe: { border: "border-emerald-700/60", bg: "bg-emerald-950/30", text: "text-emerald-300", icon: <CheckCircle2 className="h-4 w-4" />, label: "OK" },
};

function VerdictCard({ v }: { v: Verdict }) {
  const s = SEVERITY_STYLE[v.severity];
  const [showEvidence, setShowEvidence] = useState(false);
  return (
    <div className={`rounded-lg border p-3 ${s.border} ${s.bg}`}>
      <div className={`flex items-center gap-1.5 text-[10px] font-bold tracking-wide ${s.text}`}>
        {s.icon} {s.label}
      </div>
      <p className="text-sm text-slate-100 font-medium mt-1">{v.title}</p>
      <p className="text-xs text-slate-300 mt-1">{v.summary}</p>
      <p className="text-[11px] text-slate-500 mt-1.5">
        <span className="text-slate-400">Why it matters:</span> {v.explanation}
      </p>
      <p className="text-[11px] text-slate-400 mt-1">
        <span className="text-slate-500">Recommended:</span> {v.recommendation}
      </p>
      {v.evidence && v.evidence.length > 0 && (
        <div className="mt-2 pt-2 border-t border-current/10">
          <button
            onClick={() => setShowEvidence((x) => !x)}
            className="text-[10px] text-slate-500 hover:text-slate-300 underline"
          >
            {showEvidence ? "Hide" : "Show"} evidence ({v.evidence.length})
          </button>
          {showEvidence && (
            <div className="mt-1.5 space-y-1">
              {v.evidence.map((e, i) => (
                <div key={i} className="text-[10px] font-mono text-slate-400 flex flex-wrap gap-x-2">
                  <span className="text-slate-600">[{e.sourceEngine}]</span>
                  <span>{e.description}</span>
                  {e.offset !== undefined && <span className="text-slate-600">offset={e.offset}</span>}
                  <span className={e.confidence === "high" ? "text-emerald-500/80" : e.confidence === "moderate" ? "text-amber-500/80" : "text-slate-600"}>
                    confidence={e.confidence}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FileInspector() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dnaOpen, setDnaOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const bytesRef = useRef<Uint8Array | null>(null);
  const { mergeGraph, addTimelineEvent } = useInvestigation();

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  function pinToGraph() {
    if (!analysis) return;
    const id = `file:${analysis.sha256}`;
    const worst = analysis.verdicts.find((v) => v.severity === analysis.overallSeverity);
    mergeGraph(
      [
        {
          id,
          type: "file",
          label: analysis.fileName,
          detail: `${analysis.overallSeverity.toUpperCase()} · ${analysis.typeLabel}${worst ? ` · ${worst.title}` : ""}`,
          raw: { sha256: analysis.sha256, verdicts: analysis.verdicts },
        },
      ],
      []
    );
    addTimelineEvent({ tool: "file", label: "File analyzed", detail: `${analysis.fileName} (${analysis.overallSeverity})` });
  }

  function exportReport() {
    if (!analysis) return;
    const html = buildFileReport({
      fileName: analysis.fileName,
      fileSize: analysis.fileSize,
      sha256: analysis.sha256,
      sha1: analysis.sha1,
      sha512: analysis.sha512,
      mimeType: analysis.mimeType,
      typeLabel: analysis.typeLabel,
      entropy: analysis.entropyProfile.overall,
      hasMacros: analysis.hasMacros,
      macroNote: analysis.macroNote,
      verdicts: analysis.verdicts,
      overallSeverity: analysis.overallSeverity,
      circlStatus: analysis.circl?.status === "ok" || analysis.circl?.status === "not_found" || analysis.circl?.status === "error" ? analysis.circl.status : null,
      interestingStrings: analysis.interestingStrings,
      pdfMeta: analysis.pdfMeta,
      exif: analysis.exif,
    });
    openReport(html);
  }

  const processFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setDnaOpen(false);

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      bytesRef.current = bytes;
      setImageUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      });

      const sha256 = await sha256Hex(buffer);
      const sha1 = await hashHex("SHA-1", buffer);
      const sha512 = await hashHex("SHA-512", buffer);
      const primaryType = detectFileType(bytes);
      const typeLabel = primaryType?.label ?? file.type ?? "Unknown binary type";
      const entropyProfile = computeEntropyProfile(bytes);
      const interestingStrings = extractInterestingStrings(bytes);
      const extensionCheck = checkExtensionMismatch(file.name, primaryType);
      const embedded = scanEmbeddedSignatures(bytes, primaryType);
      const trailing = checkTrailingDataAfterEof(bytes, primaryType);

      let hasMacros: boolean | null = null;
      let macroNote = "Not a document container type — macro check not applicable.";
      let macroResult: MacroExtractionResult | null = null;
      const extraVerdicts: Verdict[] = [];
      if (primaryType?.label.includes("ZIP / OOXML")) {
        const result = await analyzeOoxmlMacros(buffer);
        hasMacros = result.hasMacros;
        macroNote = result.note;
        macroResult = result.macroResult;
        if (result.remoteTemplates.length > 0) {
          extraVerdicts.push({
            id: "ooxml-remote-template",
            title: "References an external template/object over the internet",
            severity: "danger",
            summary: `${result.remoteTemplates.length} external relationship${result.remoteTemplates.length === 1 ? "" : "s"}: ${result.remoteTemplates.slice(0, 3).join(", ")}${result.remoteTemplates.length > 3 ? "…" : ""}`,
            explanation: "A document that loads a remote template/object over HTTP(S) can appear completely clean (no local macros) while the remote resource — which can itself carry macros — only gets fetched and run once the document is opened, a real technique known as remote template injection.",
            recommendation: "Do not open this document with an internet connection available unless you trust and control that URL. Inspect what's actually hosted there first if possible.",
          });
        }
        if (macroResult?.found) {
          for (const f of macroResult.findings) {
            extraVerdicts.push({ id: `macro-${f.id}`, title: f.title, severity: f.severity, summary: f.summary, explanation: f.explanation, recommendation: f.recommendation });
          }
        }
      } else if (primaryType?.label.includes("Legacy OLE2")) {
        const legacyMacro = analyzeVbaProject(bytes);
        macroResult = legacyMacro.found ? legacyMacro : null;
        hasMacros = legacyMacro.found ? true : null;
        macroNote = legacyMacro.found
          ? `Legacy .doc/.xls/.ppt — ${legacyMacro.modules.length} macro module(s) extracted directly from this file's own OLE2/CFB structure and scanned (${legacyMacro.combinedSource.length.toLocaleString()} characters of real decompiled source recovered client-side, no server round-trip).`
          : "Legacy .doc/.xls/.ppt format — no VBA macro module could be located and decompressed in this file's OLE2/CFB structure. This doesn't fully rule out macros (a corrupted or unusually laid-out stream could evade this scan) — treat any legacy Office file from an untrusted source as macro-capable until proven otherwise.";
        if (legacyMacro.found) {
          for (const f of legacyMacro.findings) {
            extraVerdicts.push({ id: `macro-${f.id}`, title: f.title, severity: f.severity, summary: f.summary, explanation: f.explanation, recommendation: f.recommendation });
          }
        }
      }

      let pdfMeta: Record<string, string> | null = null;
      if (primaryType?.label === "PDF Document") {
        const text = new TextDecoder("latin1").decode(bytes.slice(0, Math.min(bytes.length, 200_000)));
        const meta = extractPdfMetadataBestEffort(text);
        pdfMeta = Object.keys(meta).length > 0 ? meta : null;

        const activeContent = scanPdfActiveContent(text);
        for (const ac of activeContent) {
          extraVerdicts.push({
            id: `pdf-active-${ac.keyword.replace(/\W/g, "")}`,
            title: `${ac.label} found`,
            severity: ac.severity,
            summary: `The keyword ${ac.keyword} appears ${ac.count} time${ac.count === 1 ? "" : "s"} in this PDF's structure.`,
            explanation: "PDF is a real programming environment, not just a static document format — it can run JavaScript, auto-execute actions on open, launch external programs, and embed other files. This is the standard set of static indicators analysts check in a suspected malicious PDF, used in real-world exploit delivery for well over a decade.",
            recommendation: ac.severity === "danger"
              ? "Do not open this PDF with a viewer that has JavaScript/actions enabled unless you trust the source. Open it in a sandboxed/restricted viewer, or inspect the raw content first."
              : "Worth a closer look at the actual embedded content before trusting this file.",
          });
        }
      }

      let peInfo: ReturnType<typeof parsePe> = null;
      if (primaryType?.dangerous && (primaryType.label.includes("PE Executable"))) {
        peInfo = parsePe(bytes);
        if (peInfo) {
          const peFindings = analyzePeRisk(peInfo);
          for (const f of peFindings) {
            extraVerdicts.push({ id: `pe-${f.id}`, title: f.title, severity: f.severity, summary: f.summary, explanation: f.explanation, recommendation: f.recommendation });
          }
        }
      }

      let elfInfo: ReturnType<typeof parseElf> = null;
      if (primaryType?.label.includes("ELF Executable")) {
        elfInfo = parseElf(bytes);
        if (elfInfo) {
          const elfFindings = analyzeElfRisk(elfInfo);
          for (const f of elfFindings) {
            extraVerdicts.push({ id: `elf-${f.id}`, title: f.title, severity: f.severity, summary: f.summary, explanation: f.explanation, recommendation: f.recommendation });
          }
        }
      }

      // Format-agnostic capability/indicator scan (capa-style API-name
      // strings, LOLBAS living-off-the-land command patterns, and
      // curated known-malware string signatures) — runs on every file
      // regardless of type, since it works on extracted strings alone.
      // For PE files, already-declared imports are passed in so this
      // never re-reports the same API the import-table analysis above
      // already found — it only flags APIs referenced as strings that
      // AREN'T in the import table (consistent with dynamic resolution),
      // which is genuinely new evidence rather than double-counting.
      const indicatorFindings = analyzeMalwareIndicators(bytes, peInfo ? importedFunctionSet(peInfo.imports) : undefined);
      for (const f of indicatorFindings) {
        extraVerdicts.push({ id: `ind-${f.id}`, title: f.title, severity: f.severity, summary: f.summary, explanation: f.explanation, recommendation: f.recommendation });
      }

      const exif = await tryExif(file);

      // Keyless known-good check against CIRCL hashlookup.
      let circl: HashLookupResult["circlHashlookup"] | null = null;
      try {
        const res = await fetch(`/api/osint/hash?target=${sha256}`);
        const json: HashLookupResult = await res.json();
        circl = json.circlHashlookup;
      } catch {
        circl = { status: "error", provider: "CIRCL hashlookup", message: "Network error." };
      }

      const verdicts = [
        ...buildVerdicts({
          primaryType,
          extensionCheck,
          embedded,
          trailing,
          entropyProfile,
          hasMacros,
          macroNote,
          suspiciousStringCount: interestingStrings.length,
          circlStatus: circl?.status === "ok" || circl?.status === "not_found" || circl?.status === "error" ? circl.status : null,
        }),
        ...extraVerdicts,
      ];

      setAnalysis({
        fileName: file.name,
        fileSize: file.size,
        sha256,
        sha1,
        sha512,
        mimeType: file.type || "unknown",
        lastModified: new Date(file.lastModified).toLocaleString(),
        primaryType,
        typeLabel,
        entropyProfile,
        hasMacros,
        macroNote,
        macroResult,
        interestingStrings,
        pdfMeta,
        exif,
        circl,
        verdicts,
        overallSeverity: computeRiskScore(verdicts).tier,
        peInfo,
        elfInfo,
      });
    } catch (err) {
      setError("Couldn't read this file in the browser. Try a smaller file.");
    } finally {
      setLoading(false);
    }
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  return (
    <div className="glass-panel p-4 space-y-4">
      <div>
        <h2 className="font-display font-semibold text-sm text-slate-100 mb-1">
          File / Malware Inspector — Static Analysis
        </h2>
        <p className="text-xs text-slate-500">
          Runs entirely in your browser against 70+ real file-type signatures, using the same
          static-analysis techniques the malware-analysis/DFIR community actually relies on: real
          VBA macro extraction (a from-scratch MS-CFB + MS-OVBA decompressor recovers the actual
          decompiled source — not just a yes/no check — the same job oletools/olevba does), PE
          import-table/section analysis, ELF segment/section analysis, a capa-style string-based
          capability scan that also catches dynamically-resolved APIs import analysis alone would
          miss, LOLBAS living-off-the-land command-pattern detection (18 patterns, from
          PowerShell one-liners to msbuild/regasm/diskshadow abuse), curated known-tool string
          signatures (Mimikatz, Cobalt Strike, Sliver, Havoc, Brute Ratel, PowerShell Empire,
          commodity RATs and infostealers, ransomware-note/webshell/reverse-shell/packer markers),
          PDF active-content scanning, remote-template-injection detection, and confidence-aware
          entropy and embedded-signature detection — a short or zero-heavy byte pattern is
          statistically near-guaranteed to "match" somewhere in any large compressed file purely by
          chance, so matches are filtered by how surprising they'd actually be for a file this size
          before ever reaching a verdict, and entropy itself is one signal among many here, not the
          headline. Nothing but the resulting hash is sent anywhere (to CIRCL's free known-good
          file database). No sandbox detonation — see the note below. Every finding below also
          feeds a real relationship graph, a structural tree of the file's actual sections/imports,
          and a MITRE ATT&CK technique panel — real technique IDs mapped from real findings (the
          same kind of mapping capa's own rules carry), not a generic score, and taggable straight
          into this app's ATT&CK Technique Matrix.
        </p>
      </div>

      <motion.label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        animate={{
          borderColor: dragOver ? "rgba(225,29,72,0.8)" : "rgba(46,35,78,1)",
          scale: dragOver ? 1.01 : 1,
        }}
        className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl py-10 cursor-pointer bg-[#0d0a18]/60"
      >
        <Upload className="h-6 w-6 text-accent" />
        <span className="text-sm text-slate-300">Drag a file here, or click to browse</span>
        <span className="text-xs text-slate-500">Analyzed locally — nothing is uploaded to a server</span>
        <input
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) processFile(file);
          }}
        />
      </motion.label>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-accent" /> Analyzing…
        </div>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}

      <AnimatePresence>
        {analysis && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3 text-sm"
          >
            <div className="flex justify-end gap-2">
              <button
                onClick={pinToGraph}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
              >
                <Pin className="h-3 w-3" /> Pin to Intelligence Graph
              </button>
              <button
                onClick={exportReport}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
              >
                <FileDown className="h-3 w-3" /> Export Report
              </button>
            </div>

            {/* Overall verdict banner — a weighted score across every
                finding below, not just whichever single one is worst.
                A lone moderately-common signal (an .exe being an .exe,
                one capability match, a small import table) shouldn't
                alone read as "unsafe" the same way several correlated
                findings together should — see computeRiskScore(). */}
            {(() => {
              const s = SEVERITY_STYLE[analysis.overallSeverity];
              const dangerCount = analysis.verdicts.filter((v) => v.severity === "danger").length;
              const warningCount = analysis.verdicts.filter((v) => v.severity === "warning").length;
              const counts = `${dangerCount} danger, ${warningCount} warning finding${warningCount === 1 ? "" : "s"}`;
              const overallText =
                analysis.overallSeverity === "danger"
                  ? `Multiple correlated high-risk signals found (${counts}) — treat this file as unsafe until proven otherwise.`
                  : analysis.overallSeverity === "warning"
                  ? `${counts} — worth reviewing individually below; on their own these aren't conclusive, especially a single capability match on an otherwise-clean file.`
                  : "No significant red flags found in the checks below.";
              return (
                <div className={`rounded-lg border-2 p-3.5 flex items-center gap-3 ${s.border} ${s.bg}`}>
                  <span className={s.text}>{s.icon}</span>
                  <div>
                    <p className={`text-sm font-bold ${s.text}`}>{s.label}</p>
                    <p className="text-xs text-slate-300">{overallText}</p>
                  </div>
                </div>
              );
            })()}

            {analysis.verdicts.length > 0 && (
              <div className="space-y-2">
                {analysis.verdicts.map((v) => (
                  <VerdictCard key={v.id} v={v} />
                ))}
              </div>
            )}

            <div className="space-y-3">
              <p className="text-[10px] text-terminal uppercase tracking-[0.2em] hud-text">Visual analysis</p>
              <EvidenceGraph
                fileName={analysis.fileName}
                overallSeverity={analysis.overallSeverity}
                verdicts={analysis.verdicts}
                interestingStrings={analysis.interestingStrings}
                peInfo={analysis.peInfo}
                elfInfo={analysis.elfInfo}
                macroResult={analysis.macroResult}
              />
              <StructuralTree fileName={analysis.fileName} peInfo={analysis.peInfo} elfInfo={analysis.elfInfo} macroResult={analysis.macroResult} />
              <AttackTechniquePanel verdicts={analysis.verdicts} />

              <button
                onClick={() => setDnaOpen((v) => !v)}
                className="w-full flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-left hover:border-accent/50 transition-colors"
              >
                <span className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <Dna className="h-3.5 w-3.5 text-accent" /> View as DNA — entropy heatmap, genome fingerprint, byte-relationship graph, 3D landscape
                </span>
                {dnaOpen ? <ChevronUp className="h-3.5 w-3.5 text-slate-500" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />}
              </button>
              {dnaOpen && bytesRef.current && (
                <DnaView
                  fileName={analysis.fileName}
                  fileSize={analysis.fileSize}
                  sha256={analysis.sha256}
                  typeLabel={analysis.typeLabel}
                  primaryType={analysis.primaryType}
                  entropyProfile={analysis.entropyProfile}
                  bytes={bytesRef.current}
                  imageUrl={imageUrl}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] text-slate-500 mb-1">File</p>
                <p className="text-slate-200 break-all">{analysis.fileName}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {(analysis.fileSize / 1024).toFixed(1)} KB · {analysis.typeLabel}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] text-slate-500 mb-1">SHA-256</p>
                <p className="text-slate-300 font-mono text-[11px] break-all">{analysis.sha256}</p>
              </div>
            </div>

            <div className="rounded-lg border border-border p-3 space-y-1.5">
              <p className="text-[11px] text-slate-500">Additional hashes & metadata</p>
              <p className="text-[11px] font-mono text-slate-400 break-all"><span className="text-slate-500">SHA-1:</span> {analysis.sha1}</p>
              <p className="text-[11px] font-mono text-slate-400 break-all"><span className="text-slate-500">SHA-512:</span> {analysis.sha512}</p>
              <p className="text-[11px] text-slate-400"><span className="text-slate-500">MIME:</span> {analysis.mimeType}</p>
              <p className="text-[11px] text-slate-400"><span className="text-slate-500">Last modified:</span> {analysis.lastModified}</p>
            </div>

            <div className="rounded-lg border border-border p-3">
              <p className="text-[11px] text-slate-500 mb-1 flex items-center gap-1">
                <Info className="h-3 w-3" /> Entropy
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                  <div
                    className={`h-full ${
                      analysis.entropyProfile.overall > 7.2 && !analysis.primaryType?.naturallyHighEntropy
                        ? "bg-severity-critical"
                        : "bg-emerald-600"
                    }`}
                    style={{ width: `${(analysis.entropyProfile.overall / 8) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-slate-300">{analysis.entropyProfile.overall.toFixed(2)} / 8</span>
              </div>
              {analysis.entropyProfile.blocks.length > 1 && (
                <>
                  <p className="text-[10px] text-slate-600 mt-2.5 mb-1">
                    Per-block entropy map ({analysis.entropyProfile.blocks.length} blocks of ~{(analysis.entropyProfile.blockSize / 1024).toFixed(analysis.entropyProfile.blockSize >= 1024 ? 1 : 0)}{analysis.entropyProfile.blockSize >= 1024 ? "KB" : "B"} — a contiguous bright run pinpoints where a packed/encrypted/hidden segment sits, not just that one exists)
                  </p>
                  <div className="flex h-3 rounded-sm overflow-hidden gap-px">
                    {analysis.entropyProfile.blocks.map((b, i) => (
                      <div
                        key={i}
                        className="flex-1"
                        style={{ background: `hsl(${Math.max(0, 130 - (b / 8) * 130)}, 70%, ${30 + (b / 8) * 30}%)` }}
                        title={`Block ${i}: ${b.toFixed(2)} bits/byte`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="rounded-lg border border-border p-3">
              <p className="text-[11px] text-slate-500 mb-1">Macro check</p>
              <div className="flex items-center gap-2">
                {analysis.hasMacros === true && <ShieldAlert className="h-4 w-4 text-red-400" />}
                {analysis.hasMacros === false && <ShieldCheck className="h-4 w-4 text-emerald-400" />}
                {analysis.hasMacros === null && <FileWarning className="h-4 w-4 text-slate-500" />}
                <p className="text-xs text-slate-300">{analysis.macroNote}</p>
              </div>
            </div>

            {analysis.macroResult?.found && (
              <div className="rounded-lg border border-border p-3 space-y-2">
                <p className="text-[11px] text-slate-500">
                  Recovered VBA source — {analysis.macroResult.modules.length} module{analysis.macroResult.modules.length === 1 ? "" : "s"} ({analysis.macroResult.modules.map((m) => m.name).join(", ")})
                </p>
                <pre className="text-[10.5px] font-mono text-emerald-300/90 bg-[#05040a] border border-border rounded-lg p-2.5 overflow-x-auto max-h-56 overflow-y-auto whitespace-pre">{analysis.macroResult.combinedSource}</pre>
                {(analysis.macroResult.iocs.urls.length > 0 || analysis.macroResult.deobfuscatedIocs.urls.length > 0) && (
                  <div>
                    <p className="text-[10px] text-slate-600 mb-1">URLs found (direct + decoded from base64)</p>
                    <div className="space-y-0.5">
                      {[...analysis.macroResult.iocs.urls, ...analysis.macroResult.deobfuscatedIocs.urls].map((u, i) => (
                        <p key={i} className="text-[10.5px] font-mono text-amber-300/90 break-all">{u}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {analysis.peInfo && (
              <div className="rounded-lg border border-border p-3 space-y-2">
                <p className="text-[11px] text-slate-500">
                  PE structure — {analysis.peInfo.machine} · {analysis.peInfo.subsystem} · {analysis.peInfo.numberOfSections} section{analysis.peInfo.numberOfSections === 1 ? "" : "s"} · {analysis.peInfo.imports.length} imported DLL{analysis.peInfo.imports.length === 1 ? "" : "s"}
                  {analysis.peInfo.tlsCallbackCount !== null && analysis.peInfo.tlsCallbackCount > 0 && <> · <span className="text-amber-400">{analysis.peInfo.tlsCallbackCount} TLS callback{analysis.peInfo.tlsCallbackCount === 1 ? "" : "s"}</span></>}
                  {" · checksum "}{analysis.peInfo.declaredChecksum === analysis.peInfo.computedChecksum ? <span className="text-emerald-400">valid</span> : analysis.peInfo.declaredChecksum === 0 ? <span className="text-slate-500">unset</span> : <span className="text-amber-400">mismatch</span>}
                  {analysis.peInfo.timestamp !== null && <> · compiled {new Date(analysis.peInfo.timestamp * 1000).toISOString().slice(0, 10)}</>}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] text-slate-600 mb-1">Sections</p>
                    <div className="max-h-32 overflow-y-auto space-y-0.5">
                      {analysis.peInfo.sections.map((s, i) => (
                        <p key={i} className="text-[10.5px] font-mono text-slate-400">
                          {s.name || "(unnamed)"} <span className="text-slate-600">{(s.rawSize / 1024).toFixed(1)}KB</span>{" "}
                          {s.executable && s.writable ? <span className="text-red-400">W+X</span> : s.executable ? <span className="text-amber-400">X</span> : s.writable ? <span className="text-slate-500">W</span> : <span className="text-slate-600">R</span>}
                        </p>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-600 mb-1">Imported DLLs</p>
                    <div className="max-h-32 overflow-y-auto space-y-0.5">
                      {analysis.peInfo.imports.slice(0, 20).map((imp, i) => (
                        <p key={i} className="text-[10.5px] font-mono text-slate-400">{imp.dll} <span className="text-slate-600">({imp.functions.length})</span></p>
                      ))}
                      {analysis.peInfo.imports.length === 0 && <p className="text-[10.5px] text-slate-600">No import table found (or fully dynamic resolution).</p>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {analysis.elfInfo && (
              <div className="rounded-lg border border-border p-3 space-y-2">
                <p className="text-[11px] text-slate-500">
                  ELF structure — {analysis.elfInfo.is64Bit ? "64-bit" : "32-bit"} · {analysis.elfInfo.machine} · {analysis.elfInfo.typeName} · {analysis.elfInfo.segments.length} segment{analysis.elfInfo.segments.length === 1 ? "" : "s"}
                  {analysis.elfInfo.sectionHeadersStripped ? <> · <span className="text-amber-400">no section headers</span></> : <> · {analysis.elfInfo.sections.length} sections</>}
                  {analysis.elfInfo.interpreter && <> · interp {analysis.elfInfo.interpreter}</>}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] text-slate-600 mb-1">Segments</p>
                    <div className="max-h-32 overflow-y-auto space-y-0.5">
                      {analysis.elfInfo.segments.map((s, i) => (
                        <p key={i} className="text-[10.5px] font-mono text-slate-400">
                          {s.typeName} <span className="text-slate-600">{(s.filesz / 1024).toFixed(1)}KB</span>{" "}
                          {s.executable && s.writable ? <span className="text-red-400">W+X</span> : s.executable ? <span className="text-amber-400">X</span> : s.writable ? <span className="text-slate-500">W</span> : <span className="text-slate-600">R</span>}
                        </p>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-600 mb-1">Sections</p>
                    <div className="max-h-32 overflow-y-auto space-y-0.5">
                      {analysis.elfInfo.sections.slice(0, 25).map((s, i) => (
                        <p key={i} className="text-[10.5px] font-mono text-slate-400">{s.name || "(unnamed)"} <span className="text-slate-600">({(s.size / 1024).toFixed(1)}KB)</span></p>
                      ))}
                      {analysis.elfInfo.sectionHeadersStripped && <p className="text-[10.5px] text-slate-600">No section header table present.</p>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {analysis.interestingStrings.length > 0 && (
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] text-slate-500 mb-2">
                  Flagged strings ({analysis.interestingStrings.length})
                </p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {analysis.interestingStrings.map((s, i) => (
                    <p key={i} className="text-[11px] font-mono text-amber-300/90 break-all">{s}</p>
                  ))}
                </div>
              </div>
            )}

            {analysis.pdfMeta && (
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] text-slate-500 mb-2">PDF metadata (best-effort)</p>
                {Object.entries(analysis.pdfMeta).map(([k, v]) => (
                  <p key={k} className="text-xs text-slate-300">
                    <span className="text-slate-500">{k}:</span> {v}
                  </p>
                ))}
              </div>
            )}

            {analysis.mimeType.startsWith("image/") && (
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] text-slate-500 mb-2">EXIF metadata</p>
                {analysis.exif && Object.keys(analysis.exif).length > 0 ? (
                  <div className="max-h-40 overflow-y-auto space-y-0.5">
                    {Object.entries(analysis.exif).slice(0, 15).map(([k, v]) => (
                      <p key={k} className="text-xs text-slate-300 break-all">
                        <span className="text-slate-500">{k}:</span> {String(v)}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    No EXIF metadata found — common for screenshots, messaging-app images, and
                    anything re-saved by a platform that strips it on upload. If this is a photo
                    straight off a phone (especially an iPhone's default{" "}
                    <span className="text-slate-400">.heic</span> format), also try the "Image
                    Forensics" tool under Digital Forensics — it surfaces the exact parse error if
                    the browser can't decode the file at all.
                  </p>
                )}
              </div>
            )}

            <div className="rounded-lg border border-border p-3">
              <p className="text-[11px] text-slate-500 mb-1">CIRCL known-good check</p>
              {analysis.circl?.status === "ok" && (
                <p className="text-xs text-emerald-300">
                  Matches a known-good file: {analysis.circl.data.fileName ?? "Unnamed"}
                </p>
              )}
              {analysis.circl?.status === "not_found" && (
                <p className="text-xs text-amber-300/90">
                  Not a recognized system/software file. This does not mean it's malicious —
                  only that it isn't in the known-good allowlist. Treat as unverified.
                </p>
              )}
              {analysis.circl?.status === "error" && (
                <p className="text-xs text-slate-500">Lookup failed: {analysis.circl.message}</p>
              )}
            </div>

            <p className="text-[11px] text-slate-500 border-t border-border pt-2">
              This is static/heuristic triage — it does not execute the file. Real behavioral
              sandboxing (Any.Run, Joe Sandbox, Hybrid Analysis) needs a keyed service; none of
              the free ones offer genuine keyless detonation.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
