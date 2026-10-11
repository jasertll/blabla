"use client";

import { useCallback, useRef, useState, type ReactElement } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, Loader2, ShieldAlert, ShieldCheck, Info, AlertTriangle, CheckCircle2, HelpCircle, Pin, FileDown,
  ScanFace, Boxes, Fingerprint, Search, FileText, Scale, Globe2, ExternalLink, History as HistoryIcon,
} from "lucide-react";
import { useInvestigation } from "@/contexts/InvestigationContext";
import { buildImageIntelReport, openReport } from "@/lib/reportGenerator";
import { runImageInvestigation, type PipelineProgress } from "@/lib/imageIntel/pipeline";
import { decodeImageFile, computePerceptualHashes } from "@/lib/imageIntel/imageDecode";
import { hammingDistanceHex, classifyDistance } from "@/lib/imageIntel/perceptualHash";
import { matchLocalFeatures } from "@/lib/imageIntel/localFeatureMatch";
import { scoreCandidateMatch } from "@/lib/imageIntel/evidenceScoring";
import { computeAllHashes } from "@/lib/imageIntel/hashes";
import { REVERSE_SEARCH_ENGINES, buildReverseImageSearchUrl, buildTextSearchUrl } from "@/lib/imageIntel/searchLinks";
import { findSimilarInHistory, saveToHistory, type HistoryMatch } from "@/lib/imageIntel/localHistory";
import type { AnalysisMode, ImageInvestigation, LocalFeatureMatchResult } from "@/lib/imageIntel/types";
import type { ConfidenceAssessment } from "@/lib/imageIntel/types";

type TabId = "overview" | "metadata" | "forensics" | "ocr" | "faces" | "objects" | "compare" | "providers" | "history" | "evidence";

const TABS: { id: TabId; label: string; icon: ReactElement }[] = [
  { id: "overview", label: "Overview", icon: <Info className="h-3.5 w-3.5" /> },
  { id: "metadata", label: "Metadata", icon: <FileText className="h-3.5 w-3.5" /> },
  { id: "forensics", label: "Forensics", icon: <Scale className="h-3.5 w-3.5" /> },
  { id: "ocr", label: "OCR", icon: <Search className="h-3.5 w-3.5" /> },
  { id: "faces", label: "Faces", icon: <ScanFace className="h-3.5 w-3.5" /> },
  { id: "objects", label: "Objects", icon: <Boxes className="h-3.5 w-3.5" /> },
  { id: "compare", label: "Candidate Comparison", icon: <Fingerprint className="h-3.5 w-3.5" /> },
  { id: "providers", label: "External Providers", icon: <Globe2 className="h-3.5 w-3.5" /> },
  { id: "history", label: "Seen Before", icon: <HistoryIcon className="h-3.5 w-3.5" /> },
  { id: "evidence", label: "Evidence", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
];

/** Stages a blob publicly (1-hour TTL) and reveals reverse-image-search
 * launcher links (Yandex first — see searchLinks.ts) once ready. Real
 * anchor clicks after staging completes, not a popup opened from inside
 * an async callback, so browsers never block it. */
function ReverseSearchPanel({ getBlob, label }: { getBlob: () => Promise<Blob>; label: string }) {
  const [staging, setStaging] = useState(false);
  const [stagedUrl, setStagedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function stage() {
    setStaging(true);
    setError(null);
    try {
      const blob = await getBlob();
      const form = new FormData();
      form.append("image", blob, "image");
      const res = await fetch("/api/imageintel/stage", { method: "POST", body: form });
      const json = await res.json();
      if (json.status !== "ok") throw new Error(json.message ?? json.error ?? "Staging failed.");
      setStagedUrl(json.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Staging failed.");
    } finally {
      setStaging(false);
    }
  }

  if (stagedUrl) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {REVERSE_SEARCH_ENGINES.map((e) => (
          <a
            key={e.id}
            href={buildReverseImageSearchUrl(e.id, stagedUrl)}
            target="_blank"
            rel="noopener noreferrer"
            title={e.note}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-cyan-700/50 text-cyan-300 hover:bg-cyan-950/30"
          >
            {e.label} <ExternalLink className="h-3 w-3" />
          </a>
        ))}
        <span className="text-[10px] text-slate-600">link expires in 1 hour</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <button onClick={stage} disabled={staging} className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 disabled:opacity-50">
        {staging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />} {staging ? "Preparing…" : `Search ${label} on reverse-image engines`}
      </button>
      {error && <p className="text-[11px] text-red-300">{error}</p>}
    </div>
  );
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <p className="text-[11px] text-slate-500">{title}</p>
      {children}
    </div>
  );
}

function ConfidenceBadge({ level }: { level: ConfidenceAssessment["level"] }) {
  const style: Record<ConfidenceAssessment["level"], { bg: string; text: string; border: string }> = {
    VERIFIED: { bg: "bg-emerald-950/40", text: "text-emerald-300", border: "border-emerald-700/60" },
    HIGH_CONFIDENCE: { bg: "bg-emerald-950/30", text: "text-emerald-300", border: "border-emerald-700/50" },
    PROBABLE: { bg: "bg-cyan-950/30", text: "text-cyan-300", border: "border-cyan-700/50" },
    POSSIBLE: { bg: "bg-amber-950/30", text: "text-amber-300", border: "border-amber-700/50" },
    UNCONFIRMED: { bg: "bg-slate-800/40", text: "text-slate-400", border: "border-slate-600/50" },
    NOT_MATCHED: { bg: "bg-slate-800/40", text: "text-slate-500", border: "border-slate-700/50" },
  };
  const s = style[level];
  return <span className={`text-[10px] font-bold tracking-wide px-2 py-1 rounded-md border ${s.bg} ${s.text} ${s.border}`}>{level.replace("_", " ")}</span>;
}

export default function ImageIntelWorkspace() {
  const [mode, setMode] = useState<AnalysisMode>("balanced");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [investigation, setInvestigation] = useState<ImageInvestigation | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [dragOver, setDragOver] = useState(false);

  // Candidate comparison state
  const candidateInputRef = useRef<HTMLInputElement>(null);
  const [candidateFile, setCandidateFile] = useState<File | null>(null);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);

  // Provider search state (per-provider loading/error, results live on investigation)
  const [providerLoading, setProviderLoading] = useState<{ tineye: boolean; reddit: boolean; x: boolean; openverse: boolean; wikimedia: boolean }>({
    tineye: false,
    reddit: false,
    x: false,
    openverse: false,
    wikimedia: false,
  });

  // Local-only "seen before in this tool?" history (IndexedDB — never leaves the device)
  const [historyMatches, setHistoryMatches] = useState<HistoryMatch[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const { mergeGraph, addTimelineEvent, setToolAlert } = useInvestigation();

  const processFile = useCallback(
    async (f: File) => {
      setLoading(true);
      setError(null);
      setInvestigation(null);
      setCandidateFile(null);
      setHistoryMatches([]);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(f));
      setFile(f);

      const result = await runImageInvestigation(f, mode, (p) => setProgress(p));
      setLoading(false);
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      setInvestigation(result.investigation);
      const hasSignificantForensics = result.investigation.forensicFindings.some((ff) => ff.severity === "significant");
      setToolAlert("imageintel", hasSignificantForensics || result.investigation.image.extensionMismatch);
      addTimelineEvent({ tool: "imageintel", label: "Image investigated", detail: `${f.name} (${mode} mode)` });
      checkAndSaveHistory(f, result.investigation);
    },
    [mode, previewUrl, addTimelineEvent, setToolAlert]
  );

  async function checkAndSaveHistory(f: File, inv: ImageInvestigation) {
    setHistoryLoading(true);
    try {
      const decoded = await decodeImageFile(f);
      if (!decoded.ok) return;
      const canvas = decoded.image.canvas;

      const thumbCanvas = document.createElement("canvas");
      const maxDim = 256;
      const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
      thumbCanvas.width = Math.max(1, Math.round(canvas.width * scale));
      thumbCanvas.height = Math.max(1, Math.round(canvas.height * scale));
      thumbCanvas.getContext("2d")!.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
      const thumbnailDataUrl = thumbCanvas.toDataURL("image/jpeg", 0.7);

      const matches = await findSimilarInHistory(inv.image.sha256, inv.fingerprints, canvas);
      setHistoryMatches(matches);

      await saveToHistory({
        id: inv.image.sha256,
        fileName: inv.image.fileName,
        width: inv.image.width,
        height: inv.image.height,
        hashes: inv.fingerprints,
        thumbnailDataUrl,
        investigatedAt: inv.createdAt,
      });
    } catch {
      // Local history is a best-effort, privacy-local convenience — never
      // block or error out the main investigation because of it.
    } finally {
      setHistoryLoading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) processFile(f);
  }

  async function runCandidateComparison(cFile: File) {
    if (!investigation || !file) return;
    setCandidateLoading(true);
    setCandidateError(null);
    setCandidateFile(cFile);

    try {
      const [origBuffer, candBuffer] = await Promise.all([file.arrayBuffer(), cFile.arrayBuffer()]);
      const [origHashes, candHashes] = await Promise.all([computeAllHashes(origBuffer), computeAllHashes(candBuffer)]);
      const exactHashMatch = origHashes.sha256 === candHashes.sha256;

      const [origDecoded, candDecoded] = await Promise.all([decodeImageFile(file), decodeImageFile(cFile)]);
      if (!origDecoded.ok || !candDecoded.ok) {
        setCandidateError(!origDecoded.ok ? origDecoded.reason : (candDecoded as { ok: false; reason: string }).reason);
        setCandidateLoading(false);
        return;
      }

      const origFp = computePerceptualHashes(origDecoded.image);
      const candFp = computePerceptualHashes(candDecoded.image);
      const pHashDistance = hammingDistanceHex(origFp.pHash, candFp.pHash);
      const dHashDistance = hammingDistanceHex(origFp.dHash, candFp.dHash);
      const aHashDistance = hammingDistanceHex(origFp.aHash, candFp.aHash);
      const verdict = classifyDistance(Math.min(pHashDistance, dHashDistance));

      let localFeatureMatch: LocalFeatureMatchResult | null = null;
      try {
        localFeatureMatch = await matchLocalFeatures(origDecoded.image.canvas, candDecoded.image.canvas);
      } catch (err) {
        localFeatureMatch = { status: "error", message: err instanceof Error ? err.message : "Local feature matching failed.", keypointsA: 0, keypointsB: 0, goodMatches: 0, goodMatchRatio: 0, inlierCount: 0, inlierRatio: 0, geometricallyConsistent: false, matchPreviewDataUrl: null };
      }

      let ocrOverlapRatio: number | null = null;
      if (investigation.ocr) {
        // Cheap second OCR pass on the candidate, just for term overlap —
        // not a full re-run of the whole pipeline.
        try {
          const { runOcr } = await import("@/lib/imageIntel/ocrEngine");
          const candOcr = await runOcr(candDecoded.image.canvas);
          const origTerms = new Set([...investigation.ocr.usernames, ...investigation.ocr.urls, ...investigation.ocr.domains, ...investigation.ocr.hashtags]);
          const candTerms = new Set([...candOcr.extraction.usernames, ...candOcr.extraction.urls, ...candOcr.extraction.domains, ...candOcr.extraction.hashtags]);
          if (origTerms.size > 0) {
            const shared = [...origTerms].filter((t) => candTerms.has(t)).length;
            ocrOverlapRatio = shared / origTerms.size;
          }
        } catch {
          ocrOverlapRatio = null;
        }
      }

      const confidence = scoreCandidateMatch({
        exactHashMatch,
        fingerprintComparison: { aHashDistance, dHashDistance, pHashDistance, verdict },
        localFeatureMatch,
        ocrOverlapRatio,
      });

      setInvestigation({ ...investigation, candidateComparison: localFeatureMatch, confidence });
      addTimelineEvent({ tool: "imageintel", label: "Candidate comparison", detail: `${cFile.name} — ${confidence.level}` });
    } catch (err) {
      setCandidateError(err instanceof Error ? err.message : "Comparison failed.");
    } finally {
      setCandidateLoading(false);
    }
  }

  async function runReverseImageSearch() {
    if (!investigation || !file) return;
    setProviderLoading((s) => ({ ...s, tineye: true }));
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/imageintel/reverse-search", { method: "POST", body: form });
      const json = await res.json();
      setInvestigation((prev) => (prev ? { ...prev, reverseImageMatches: json, localOnly: false } : prev));
    } catch {
      setInvestigation((prev) => (prev ? { ...prev, reverseImageMatches: { status: "error", provider: "TinEye", message: "Network error." } } : prev));
    } finally {
      setProviderLoading((s) => ({ ...s, tineye: false }));
    }
  }

  const PROVIDER_FIELD: Record<"reddit" | "x" | "openverse" | "wikimedia", keyof ImageInvestigation> = {
    reddit: "redditResults",
    x: "xResults",
    openverse: "openverseResults",
    wikimedia: "wikimediaResults",
  };

  async function runTextProviderSearch(provider: "reddit" | "x" | "openverse" | "wikimedia", query: string) {
    if (!investigation || !query) return;
    const field = PROVIDER_FIELD[provider];
    setProviderLoading((s) => ({ ...s, [provider]: true }));
    try {
      const res = await fetch(`/api/imageintel/${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const json = await res.json();
      setInvestigation((prev) => (prev ? { ...prev, [field]: json, localOnly: false } : prev));
    } catch {
      setInvestigation((prev) => (prev ? { ...prev, [field]: { status: "error", provider, message: "Network error." } } : prev));
    } finally {
      setProviderLoading((s) => ({ ...s, [provider]: false }));
    }
  }

  function pinToGraph() {
    if (!investigation) return;
    const id = `imageintel:${investigation.image.sha256}`;
    mergeGraph(
      [
        {
          id,
          type: "file",
          label: investigation.image.fileName,
          detail: `${investigation.forensicFindings.length} forensic finding(s) · ${investigation.faces.length} face(s) · ${investigation.objects.length} object(s)`,
          raw: { sha256: investigation.image.sha256, pHash: investigation.fingerprints.pHash },
        },
      ],
      []
    );
  }

  function exportReport() {
    if (!investigation) return;
    openReport(buildImageIntelReport(investigation));
  }

  return (
    <div className="glass-panel p-4 space-y-4">
      <div>
        <h2 className="font-display font-semibold text-sm text-slate-100 mb-1">Image Threat Intelligence / Reverse Engineering</h2>
        <p className="text-xs text-slate-500">
          A real investigation pipeline, not a demo: cryptographic hashes, real EXIF/XMP/IPTC metadata, a real
          JPEG quantization-table parser, this platform&apos;s existing Error-Level-Analysis engine, real OCR
          (tesseract.js) with entity extraction, real face detection (BlazeFace) and object detection (COCO-SSD,
          both running client-side via TensorFlow.js — never sent anywhere), real ORB+RANSAC local-feature
          matching (OpenCV.js/WASM) for comparing a candidate image you provide, and an honest provider layer for
          TinEye/Reddit/X search — each one clearly marked <span className="text-slate-300">NOT CONFIGURED</span>{" "}
          until real API credentials are set, never a fabricated result. Analysis runs entirely in your browser;
          nothing leaves it unless you explicitly run a provider search below.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(["fast", "balanced", "deep"] as AnalysisMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`text-[11px] px-3 py-1.5 rounded-md border transition-colors ${
              mode === m ? "border-accent/60 bg-accent/15 text-slate-100" : "border-border text-slate-400 hover:text-slate-200"
            }`}
          >
            {m === "fast" ? "FAST — hashes, metadata, OCR" : m === "balanced" ? "BALANCED — + fingerprints, faces, objects" : "DEEP — + forensics detail"}
          </button>
        ))}
      </div>

      <motion.label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        animate={{ borderColor: dragOver ? "rgba(225,29,72,0.8)" : "rgba(46,35,78,1)", scale: dragOver ? 1.01 : 1 }}
        className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl py-10 cursor-pointer bg-[#0d0a18]/60"
      >
        <Upload className="h-6 w-6 text-accent" />
        <span className="text-sm text-slate-300">Drag an image here, or click to browse</span>
        <span className="text-xs text-slate-500">JPEG · PNG · WEBP · GIF · BMP · TIFF — analyzed locally</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/tiff"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) processFile(f);
          }}
        />
      </motion.label>

      {loading && progress && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-accent" /> {progress.stage}…
          </div>
          <div className="h-1.5 bg-border rounded-full overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.min(100, progress.pct)}%` }} />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}

      <AnimatePresence>
        {investigation && !loading && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 text-sm">
            <div className="flex justify-end gap-2">
              <button onClick={pinToGraph} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors">
                <Pin className="h-3 w-3" /> Pin to Intelligence Graph
              </button>
              <button onClick={exportReport} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors">
                <FileDown className="h-3 w-3" /> Export Report
              </button>
            </div>

            <div className="flex gap-3">
              {previewUrl && (
                <img src={previewUrl} alt="" className="w-28 h-28 object-cover rounded-lg border border-border shrink-0" />
              )}
              <div className="flex-1 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border p-2.5">
                  <p className="text-[10px] text-slate-500">File</p>
                  <p className="text-xs text-slate-200 break-all">{investigation.image.fileName}</p>
                  <p className="text-[10px] text-slate-500 mt-1">{investigation.image.width}×{investigation.image.height} · {(investigation.image.fileSizeBytes / 1024).toFixed(1)} KB · {investigation.image.detectedFormat}</p>
                </div>
                <div className="rounded-lg border border-border p-2.5">
                  <p className="text-[10px] text-slate-500">SHA-256</p>
                  <p className="text-[10.5px] font-mono text-slate-300 break-all">{investigation.image.sha256}</p>
                </div>
              </div>
            </div>

            {investigation.image.extensionMismatch && (
              <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-300 shrink-0" />
                <p className="text-xs text-amber-200">File extension doesn&apos;t match this image&apos;s real detected format ({investigation.image.detectedFormat}).</p>
              </div>
            )}

            <div className="flex gap-1 overflow-x-auto pb-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border whitespace-nowrap transition-colors ${
                    activeTab === t.id ? "border-accent/60 bg-accent/15 text-slate-100" : "border-border text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {activeTab === "overview" && (
              <div className="space-y-2">
                <SectionCard title="Reverse image search (whole image)">
                  <p className="text-[11px] text-slate-500 mb-1.5">
                    Stages the image at a short-lived (1-hour) public URL so these search engines can fetch it, then
                    opens their real image-search results — Yandex first, OSINT-documented as the strongest engine
                    for faces and locations.
                  </p>
                  {file && <ReverseSearchPanel getBlob={() => Promise.resolve(file)} label="whole image" />}
                </SectionCard>
                <SectionCard title="Perceptual fingerprints">
                  <p className="text-[11px] font-mono text-slate-300">aHash: {investigation.fingerprints.aHash}</p>
                  <p className="text-[11px] font-mono text-slate-300">dHash: {investigation.fingerprints.dHash}</p>
                  <p className="text-[11px] font-mono text-slate-300">pHash: {investigation.fingerprints.pHash}</p>
                </SectionCard>
                <SectionCard title="Additional hashes">
                  <p className="text-[11px] font-mono text-slate-400 break-all">SHA-1: {investigation.image.sha1}</p>
                  <p className="text-[11px] font-mono text-slate-400 break-all">MD5: {investigation.image.md5}</p>
                </SectionCard>
                {investigation.warnings.length > 0 && (
                  <SectionCard title="Warnings">
                    {investigation.warnings.map((w, i) => (
                      <p key={i} className="text-xs text-amber-300/90">{w}</p>
                    ))}
                  </SectionCard>
                )}
              </div>
            )}

            {activeTab === "metadata" && (
              <div className="space-y-2">
                <SectionCard title={`Metadata status: ${investigation.metadata.status.toUpperCase()}`}>
                  {investigation.metadata.inconsistencyNotes.map((n, i) => (
                    <p key={i} className="text-xs text-amber-300/90">{n}</p>
                  ))}
                  {investigation.metadata.status === "absent" && <p className="text-xs text-slate-500">No EXIF/XMP/IPTC metadata found — common for screenshots or platform-recompressed images.</p>}
                </SectionCard>
                {investigation.metadata.gps && (
                  <SectionCard title="Location Evidence — EXIF GPS (embedded, not inferred)">
                    <p className="text-xs text-emerald-300">{investigation.metadata.gps.latitude}, {investigation.metadata.gps.longitude}</p>
                  </SectionCard>
                )}
                {investigation.metadata.fields.length > 0 && (
                  <SectionCard title={`Raw fields (${investigation.metadata.fields.length})`}>
                    <div className="max-h-64 overflow-y-auto space-y-0.5">
                      {investigation.metadata.fields.map((f, i) => (
                        <p key={i} className="text-[11px] text-slate-300 break-all"><span className="text-slate-500">{f.key}:</span> {f.value}</p>
                      ))}
                    </div>
                  </SectionCard>
                )}
              </div>
            )}

            {activeTab === "forensics" && (
              <div className="space-y-2">
                {investigation.forensicFindings.length === 0 && (
                  <p className="text-xs text-slate-500">No forensic findings — this is informational, not a guarantee of authenticity.</p>
                )}
                {investigation.forensicFindings.map((f) => (
                  <div key={f.id} className={`rounded-lg border p-3 ${f.severity === "significant" ? "border-amber-700/60 bg-amber-950/20" : "border-border"}`}>
                    <p className="text-sm text-slate-100 font-medium">{f.title}</p>
                    <p className="text-[11px] text-slate-400 mt-1">{f.explanation}</p>
                    <p className="text-[10px] text-slate-600 mt-1">confidence: {f.confidence}</p>
                  </div>
                ))}
                {investigation.ela && (
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-sm text-slate-100 font-medium">{investigation.ela.headline}</p>
                    <p className="text-[11px] text-slate-400 mt-1">{investigation.ela.explanation}</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === "ocr" && (
              <div className="space-y-2">
                {!investigation.ocr && <p className="text-xs text-slate-500">OCR did not run or found nothing.</p>}
                {investigation.ocr && (
                  <>
                    <SectionCard title={`Extracted text (mean confidence ${investigation.ocr.meanConfidence.toFixed(0)}%)`}>
                      <pre className="text-[10.5px] font-mono text-slate-300 whitespace-pre-wrap max-h-40 overflow-y-auto">{investigation.ocr.rawText || "(no text detected)"}</pre>
                    </SectionCard>
                    {investigation.searchQueries.length > 0 && (
                      <SectionCard title="Generated search-query candidates — click to open a real search">
                        <div className="space-y-1.5 max-h-56 overflow-y-auto">
                          {investigation.searchQueries.map((q, i) => (
                            <div key={i} className="text-[11px] border-b border-border/50 pb-1.5">
                              <div className="flex flex-wrap gap-x-2">
                                <span className="text-slate-300 font-mono">{q.query}</span>
                                <span className="text-slate-600">[{q.type}]</span>
                                <span className="text-slate-500">{q.reason}</span>
                              </div>
                              <div className="flex gap-1.5 mt-1">
                                <a href={buildTextSearchUrl("google", q.query)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded border border-border text-slate-400 hover:border-accent/50 hover:text-slate-200">
                                  Google <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                                <a href={buildTextSearchUrl("duckduckgo", q.query)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded border border-border text-slate-400 hover:border-accent/50 hover:text-slate-200">
                                  DuckDuckGo <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      </SectionCard>
                    )}
                  </>
                )}
              </div>
            )}

            {activeTab === "faces" && (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-500 border-b border-border pb-2">
                  Face detection only — quality/structure signals, never identity. No recognition or real-world
                  identity inference is performed.
                </p>
                {(() => {
                  const failure = investigation.warnings.find((w) => w.startsWith("Face detection failed"));
                  if (failure) {
                    return (
                      <p className="text-xs text-amber-300/90 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Face detection could not run: {failure.replace("Face detection failed: ", "")} — this is NOT a confirmed "no faces" result.
                      </p>
                    );
                  }
                  if (investigation.faces.length === 0) {
                    return <p className="text-xs text-slate-500">No faces detected (model ran successfully).</p>;
                  }
                  return null;
                })()}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {investigation.faces.map((f) => (
                    <div key={f.id} className="rounded-lg border border-border p-2 space-y-1">
                      <img src={f.cropDataUrl} alt="" className="w-full aspect-square object-cover rounded" />
                      <p className="text-[10px] text-slate-400">Quality: {f.qualityScore}/100</p>
                      <p className="text-[10px] text-slate-500">{f.resolutionPx.toLocaleString()}px · {f.estimatedYaw}</p>
                      <ReverseSearchPanel getBlob={() => dataUrlToBlob(f.cropDataUrl)} label="this crop" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "objects" && (
              <div className="space-y-2">
                {(() => {
                  const failure = investigation.warnings.find((w) => w.startsWith("Object detection failed"));
                  if (failure) {
                    return (
                      <p className="text-xs text-amber-300/90 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Object detection could not run: {failure.replace("Object detection failed: ", "")} — this is NOT a confirmed "no objects" result.
                      </p>
                    );
                  }
                  if (investigation.objects.length === 0) {
                    return <p className="text-xs text-slate-500">No objects detected (COCO-SSD, 80-class vocabulary — model ran successfully).</p>;
                  }
                  return null;
                })()}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {investigation.objects.map((o) => (
                    <div key={o.id} className="rounded-lg border border-border p-2 space-y-1">
                      <img src={o.cropDataUrl} alt="" className="w-full aspect-square object-cover rounded" />
                      <p className="text-[10px] text-slate-300">{o.className}</p>
                      <p className="text-[10px] text-slate-500">{(o.confidence * 100).toFixed(0)}%</p>
                      <ReverseSearchPanel getBlob={() => dataUrlToBlob(o.cropDataUrl)} label="this crop" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "compare" && (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-500">
                  Upload a second, candidate image to compare against the investigated one — real ORB keypoint
                  matching + RANSAC homography verification (OpenCV.js/WASM), perceptual-hash distance, and OCR
                  term overlap, combined into a transparent, evidence-backed confidence score.
                </p>
                <motion.label className="flex flex-col items-center justify-center gap-1.5 border-2 border-dashed rounded-xl py-6 cursor-pointer bg-[#0d0a18]/60">
                  <Upload className="h-5 w-5 text-accent" />
                  <span className="text-xs text-slate-300">{candidateFile ? candidateFile.name : "Drop candidate image or click to browse"}</span>
                  <input
                    ref={candidateInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/tiff"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) runCandidateComparison(f);
                    }}
                  />
                </motion.label>

                {candidateLoading && (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" /> Comparing…
                  </div>
                )}
                {candidateError && <p className="text-xs text-red-300">{candidateError}</p>}

                {investigation.candidateComparison && (
                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <ConfidenceBadge level={investigation.confidence.level} />
                      <span className="text-[11px] text-slate-500">score {investigation.confidence.score}/100</span>
                    </div>
                    <pre className="text-[11px] text-slate-300 whitespace-pre-wrap">{investigation.confidence.explanation}</pre>
                    {investigation.candidateComparison.status === "ok" && (
                      <p className="text-[11px] text-slate-500">
                        Keypoints: {investigation.candidateComparison.keypointsA} / {investigation.candidateComparison.keypointsB} ·
                        Good matches: {investigation.candidateComparison.goodMatches} ·
                        Geometric inliers: {investigation.candidateComparison.inlierCount} ({(investigation.candidateComparison.inlierRatio * 100).toFixed(0)}%)
                      </p>
                    )}
                    {investigation.candidateComparison.matchPreviewDataUrl && (
                      <img src={investigation.candidateComparison.matchPreviewDataUrl} alt="Keypoint match preview" className="w-full rounded border border-border" />
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === "providers" && (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-500 border-b border-border pb-2">
                  Nothing is sent externally until you explicitly run a search below. Each provider honestly
                  reports its real state — never a fabricated result.
                </p>

                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-300 font-medium">TinEye (reverse image search)</p>
                    <button onClick={runReverseImageSearch} disabled={providerLoading.tineye} className="text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 disabled:opacity-50">
                      {providerLoading.tineye ? "Searching…" : "Run search"}
                    </button>
                  </div>
                  <ProviderStateView state={investigation.reverseImageMatches} />
                </div>

                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-300 font-medium">Reddit</p>
                    <button
                      onClick={() => runTextProviderSearch("reddit", investigation.searchQueries[0]?.query ?? investigation.ocr?.normalizedText.slice(0, 100) ?? "")}
                      disabled={providerLoading.reddit || (!investigation.searchQueries.length && !investigation.ocr?.normalizedText)}
                      className="text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 disabled:opacity-50"
                    >
                      {providerLoading.reddit ? "Searching…" : "Run search"}
                    </button>
                  </div>
                  <ProviderStateView state={investigation.redditResults} />
                </div>

                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-300 font-medium">X</p>
                    <button
                      onClick={() => runTextProviderSearch("x", investigation.searchQueries[0]?.query ?? investigation.ocr?.normalizedText.slice(0, 100) ?? "")}
                      disabled={providerLoading.x || (!investigation.searchQueries.length && !investigation.ocr?.normalizedText)}
                      className="text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 disabled:opacity-50"
                    >
                      {providerLoading.x ? "Searching…" : "Run search"}
                    </button>
                  </div>
                  <ProviderStateView state={investigation.xResults} />
                </div>

                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-300 font-medium">Openverse (real, free, keyless — CC-licensed image index)</p>
                    <button
                      onClick={() => runTextProviderSearch("openverse", investigation.searchQueries[0]?.query ?? investigation.ocr?.normalizedText.slice(0, 100) ?? "")}
                      disabled={providerLoading.openverse || (!investigation.searchQueries.length && !investigation.ocr?.normalizedText)}
                      className="text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 disabled:opacity-50"
                    >
                      {providerLoading.openverse ? "Searching…" : "Run search"}
                    </button>
                  </div>
                  {investigation.openverseResults ? <ProviderStateView state={investigation.openverseResults} /> : <p className="text-[11px] text-slate-500">Not searched yet.</p>}
                </div>

                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-300 font-medium">Wikimedia Commons (real, free, keyless)</p>
                    <button
                      onClick={() => runTextProviderSearch("wikimedia", investigation.searchQueries[0]?.query ?? investigation.ocr?.normalizedText.slice(0, 100) ?? "")}
                      disabled={providerLoading.wikimedia || (!investigation.searchQueries.length && !investigation.ocr?.normalizedText)}
                      className="text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 disabled:opacity-50"
                    >
                      {providerLoading.wikimedia ? "Searching…" : "Run search"}
                    </button>
                  </div>
                  {investigation.wikimediaResults ? <ProviderStateView state={investigation.wikimediaResults} /> : <p className="text-[11px] text-slate-500">Not searched yet.</p>}
                </div>
              </div>
            )}

            {activeTab === "history" && (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-500 border-b border-border pb-2">
                  Compares this image against every image this tool has investigated on THIS device only (IndexedDB
                  — never sent to any server). Pre-filtered by perceptual-hash distance, then verified with the same
                  real ORB+RANSAC geometric check used in Candidate Comparison — a match here carries the same
                  evidentiary weight, not a cheap hash guess.
                </p>
                {historyLoading && (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" /> Checking local history…
                  </div>
                )}
                {!historyLoading && historyMatches.length === 0 && (
                  <p className="text-xs text-slate-500">No similar image found in this device&apos;s local history.</p>
                )}
                <div className="space-y-2">
                  {historyMatches.map((m) => (
                    <div key={m.entry.id} className="rounded-lg border border-border p-2.5 flex gap-3">
                      <img src={m.entry.thumbnailDataUrl} alt="" className="w-16 h-16 object-cover rounded border border-border shrink-0" />
                      <div className="space-y-0.5">
                        <p className="text-xs text-slate-200 break-all">{m.entry.fileName}</p>
                        <p className="text-[10px] text-slate-500">Investigated {new Date(m.entry.investigatedAt).toLocaleString()}</p>
                        {m.exactByteMatch ? (
                          <p className="text-[10px] text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Exact byte-for-byte match (identical SHA-256) — this exact file was investigated before</p>
                        ) : (
                          <>
                            <p className="text-[10px] text-slate-500">pHash distance: {m.pHashDistance}/64 · verdict: {m.verdict}</p>
                            {m.geometricallyVerified ? (
                              <p className="text-[10px] text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Geometrically verified ({m.inlierCount} RANSAC inliers)</p>
                            ) : (
                              <p className="text-[10px] text-amber-400">Perceptually similar, not geometrically verified</p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "evidence" && (
              <div className="space-y-2">
                {investigation.evidence.length === 0 && <p className="text-xs text-slate-500">No evidence items recorded yet.</p>}
                {investigation.evidence.map((e, i) => (
                  <div key={i} className="text-[10.5px] font-mono text-slate-400 flex flex-wrap gap-x-2 border-b border-border/50 pb-1">
                    <span className="text-slate-600">[{e.sourceEngine}]</span>
                    <span>{e.description}</span>
                    <span className={e.confidence === "high" ? "text-emerald-500/80" : e.confidence === "moderate" ? "text-amber-500/80" : "text-slate-600"}>confidence={e.confidence}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ProviderStateView({ state }: { state: any }) {
  if (state.status === "missing_key") {
    return (
      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
        <HelpCircle className="h-3 w-3" /> NOT CONFIGURED — set <code className="text-slate-400">{state.envVar}</code> to enable.
      </p>
    );
  }
  if (state.status === "ok") {
    return (
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {state.data.map((r: any, i: number) => (
          <div key={i} className="text-[11px] border-b border-border/50 pb-1">
            <a href={r.resultUrl ?? r.permalink ?? r.postUrl ?? r.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline break-all">
              {r.title ?? r.resultUrl ?? r.permalink ?? r.postUrl ?? r.sourceUrl}
            </a>
            {r.snippet && <p className="text-slate-500 mt-0.5">{r.snippet}</p>}
          </div>
        ))}
      </div>
    );
  }
  if (state.status === "not_found") return <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3" /> No results found.</p>;
  if (state.status === "rate_limited") return <p className="text-[11px] text-amber-400 flex items-center gap-1.5"><AlertTriangle className="h-3 w-3" /> Rate limited — try again shortly.</p>;
  return <p className="text-[11px] text-red-300 flex items-center gap-1.5"><ShieldAlert className="h-3 w-3" /> {state.message ?? "Error."}</p>;
}
