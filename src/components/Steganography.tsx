"use client";

import { useCallback, useState, type ReactElement } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, Loader2, ShieldAlert, AlertTriangle, CheckCircle2, HelpCircle, Download, Eye, Layers, EyeOff, Image as ImageIcon, Paperclip } from "lucide-react";
import { detectFileType, type FileSignature } from "@/lib/fileAnalysis";
import {
  analyzeImageLsb,
  analyzeWavLsb,
  extractFileInFile,
  scanZeroWidthSteganography,
  embedLsbInImage,
  embedByAppending,
  lsbCapacityBytes,
  encodeContainer,
  bruteForceLsbScan,
  scanPngTextChunks,
  scanJpegComments,
  scanId3Comments,
  deepScanStrings,
  hasRealTransparency,
  type StegoFinding,
  type Severity,
  type HiddenPayload,
} from "@/lib/steganography";

const SEVERITY_STYLE: Record<Severity, { border: string; bg: string; text: string; icon: ReactElement; label: string }> = {
  danger: { border: "border-red-700/60", bg: "bg-red-950/40", text: "text-red-300", icon: <ShieldAlert className="h-4 w-4" />, label: "DANGER" },
  warning: { border: "border-amber-700/60", bg: "bg-amber-950/30", text: "text-amber-300", icon: <AlertTriangle className="h-4 w-4" />, label: "WARNING" },
  info: { border: "border-cyan-700/60", bg: "bg-cyan-950/30", text: "text-cyan-300", icon: <HelpCircle className="h-4 w-4" />, label: "INFO" },
  safe: { border: "border-emerald-700/60", bg: "bg-emerald-950/30", text: "text-emerald-300", icon: <CheckCircle2 className="h-4 w-4" />, label: "OK" },
};

function downloadBytes(bytes: Uint8Array, filename: string, mime: string) {
  const blob = new Blob([Uint8Array.from(bytes)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/bmp": "bmp", "image/webp": "webp",
  "application/pdf": "pdf", "application/zip": "zip", "application/x-rar-compressed": "rar",
  "application/x-7z-compressed": "7z", "audio/wav": "wav", "audio/mpeg": "mp3", "video/mp4": "mp4",
  "text/plain": "txt", "application/x-msdownload": "exe", "application/x-elf": "elf",
};

/** Names the download after what was actually found, instead of a
 * generic ".bin" that gives no hint of the detected type — a real file
 * signature match already tells us what this almost certainly is. */
function extractedFilename(id: string, mime: string): string {
  const ext = MIME_EXTENSIONS[mime] ?? "bin";
  return `extracted-${id}.${ext}`;
}

function FindingCard({ f }: { f: StegoFinding }) {
  const s = SEVERITY_STYLE[f.severity];
  const [showEvidence, setShowEvidence] = useState(false);
  return (
    <div className={`rounded-lg border p-3 ${s.border} ${s.bg}`}>
      <div className={`flex items-center gap-1.5 text-[10px] font-bold tracking-wide ${s.text}`}>
        {s.icon} {s.label}
      </div>
      <p className="text-sm text-slate-100 font-medium mt-1">{f.title}</p>
      <p className="text-xs text-slate-300 mt-1">{f.summary}</p>
      <p className="text-[11px] text-slate-500 mt-1.5"><span className="text-slate-400">Why it matters:</span> {f.explanation}</p>
      <p className="text-[11px] text-slate-400 mt-1"><span className="text-slate-500">Recommended:</span> {f.recommendation}</p>

      {f.evidence && f.evidence.length > 0 && (
        <div className="mt-2 pt-2 border-t border-current/10">
          <button onClick={() => setShowEvidence((x) => !x)} className="text-[10px] text-slate-500 hover:text-slate-300 underline">
            {showEvidence ? "Hide" : "Show"} evidence ({f.evidence.length})
          </button>
          {showEvidence && (
            <div className="mt-1.5 space-y-1">
              {f.evidence.map((e, i) => (
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

      {f.extracted?.kind === "text" && f.extracted.text && (
        <div className="mt-2.5 rounded-md border border-border bg-[#05040a] p-2.5">
          <p className="text-[10px] text-slate-500 mb-1">{f.extracted.label}</p>
          <p className="text-xs font-mono text-emerald-300/90 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">{f.extracted.text}</p>
        </div>
      )}
      {f.extracted?.kind === "binary" && f.extracted.bytes && (
        <button
          onClick={() => downloadBytes(f.extracted!.bytes!, extractedFilename(f.id, f.extracted!.mime ?? "application/octet-stream"), f.extracted!.mime ?? "application/octet-stream")}
          className="mt-2.5 flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
        >
          <Download className="h-3 w-3" /> Download extracted data ({(f.extracted.bytes.length / 1024).toFixed(1)} KB)
        </button>
      )}
    </div>
  );
}

type Mode = "file" | "text" | "hide";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const CANVAS_DECODABLE_MIME = /^image\/(png|jpeg|gif|bmp|webp)$/;

async function loadImageData(file: File): Promise<ImageData | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(img, 0, 0);
      try {
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

async function loadFirstVideoFrame(file: File): Promise<ImageData | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    const cleanup = () => URL.revokeObjectURL(url);
    video.onloadeddata = () => {
      video.currentTime = 0;
    };
    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx || canvas.width === 0) { cleanup(); resolve(null); return; }
      ctx.drawImage(video, 0, 0);
      try {
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
      } catch {
        resolve(null);
      } finally {
        cleanup();
      }
    };
    video.onerror = () => { cleanup(); resolve(null); };
  });
}

function printableRatioQuick(bytes: Uint8Array): number {
  const n = Math.min(bytes.length, 4000);
  if (n === 0) return 0;
  let printable = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if ((b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d) printable++;
  }
  return printable / n;
}

export default function Steganography() {
  const [mode, setMode] = useState<Mode>("file");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [findings, setFindings] = useState<StegoFinding[] | null>(null);
  const [analyzedAs, setAnalyzedAs] = useState<string[] | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [textFindings, setTextFindings] = useState<StegoFinding[] | null>(null);

  // --- Hide mode state ---
  const [hideCover, setHideCover] = useState<File | null>(null);
  const [hideCoverIsImage, setHideCoverIsImage] = useState(false);
  const [hideCapacity, setHideCapacity] = useState<number | null>(null);
  const [hideMethod, setHideMethod] = useState<"lsb" | "append">("append");
  const [hidePayloadType, setHidePayloadType] = useState<"text" | "file">("text");
  const [hidePayloadText, setHidePayloadText] = useState("");
  const [hidePayloadFile, setHidePayloadFile] = useState<File | null>(null);
  const [hideBusy, setHideBusy] = useState(false);
  const [hideError, setHideError] = useState<string | null>(null);
  const [hideSuccess, setHideSuccess] = useState<string | null>(null);
  const [hideTransparencyWarning, setHideTransparencyWarning] = useState<string | null>(null);

  async function selectHideCover(file: File) {
    setHideCover(file);
    setHideError(null);
    setHideSuccess(null);
    setHideTransparencyWarning(null);
    const isImage = /^image\/(png|jpeg|gif|bmp|webp)$/.test(file.type) || CANVAS_DECODABLE_MIME.test(file.type);
    setHideCoverIsImage(isImage);
    if (isImage) {
      const imageData = await loadImageData(file);
      setHideCapacity(imageData ? lsbCapacityBytes(imageData.width, imageData.height) : null);
      if (imageData && hasRealTransparency(imageData)) {
        setHideMethod("append");
        setHideTransparencyWarning(
          "This image has transparency (an alpha channel with non-opaque pixels). Pixel LSB embedding isn't reliably recoverable for semi-transparent images — browsers can round RGB values on those pixels by ±1 during the save/reload round-trip, corrupting the hidden bits even though the image looks identical. Defaulted to \"Append to file\" instead, which works reliably for any image."
        );
      } else {
        setHideMethod("lsb");
      }
    } else {
      setHideCapacity(null);
      setHideMethod("append");
    }
  }

  async function runHide() {
    if (!hideCover) return;
    setHideBusy(true);
    setHideError(null);
    setHideSuccess(null);
    try {
      let payload: HiddenPayload;
      if (hidePayloadType === "text") {
        if (!hidePayloadText.trim()) { setHideError("Enter the text you want to hide."); return; }
        payload = { kind: "text", text: hidePayloadText };
      } else {
        if (!hidePayloadFile) { setHideError("Choose a file (e.g. an image) to hide."); return; }
        const buf = await hidePayloadFile.arrayBuffer();
        payload = { kind: "file", bytes: new Uint8Array(buf), filename: hidePayloadFile.name, mime: hidePayloadFile.type || "application/octet-stream" };
      }

      if (hideMethod === "lsb") {
        const imageData = await loadImageData(hideCover);
        if (!imageData) { setHideError("Couldn't decode the cover as an image — use the \"append to file\" method instead."); return; }
        const { result, usedBytes, capacityBytes } = embedLsbInImage(imageData, payload);
        const canvas = document.createElement("canvas");
        canvas.width = result.width;
        canvas.height = result.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { setHideError("Canvas not available."); return; }
        ctx.putImageData(result, 0, 0);
        await new Promise<void>((resolve) => {
          canvas.toBlob((blob) => {
            if (blob) downloadBlob(blob, `${hideCover.name.replace(/\.[^.]+$/, "")}-hidden.png`);
            resolve();
          }, "image/png");
        });
        setHideSuccess(`Hidden ${usedBytes.toLocaleString()} bytes into the image's pixel data (${capacityBytes.toLocaleString()} bytes available) — downloaded as a lossless PNG. The image looks visually identical; re-uploading it to Scan a File will recover the exact hidden content.`);
      } else {
        const coverBuf = await hideCover.arrayBuffer();
        const outBytes = embedByAppending(new Uint8Array(coverBuf), payload);
        downloadBytes(outBytes, hideCover.name, hideCover.type || "application/octet-stream");
        setHideSuccess(`Hidden content appended after the cover file's own data (${outBytes.length.toLocaleString()} bytes total, cover was ${coverBuf.byteLength.toLocaleString()}) and downloaded with the same name/type — it opens/plays completely normally. Re-uploading it to Scan a File will recover the exact hidden content.`);
      }
    } catch (e: any) {
      setHideError(e?.message ?? "Failed to hide content.");
    } finally {
      setHideBusy(false);
    }
  }

  const hidePayloadSizeEstimate = hidePayloadType === "text"
    ? encodeContainer({ kind: "text", text: hidePayloadText }).length
    : hidePayloadFile ? hidePayloadFile.size + hidePayloadFile.name.length + 20 : 0;

  const processFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setFindings(null);
    setAnalyzedAs(null);
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const primaryType: FileSignature | null = detectFileType(bytes);
      const results: StegoFinding[] = [];
      const analyzedMethods: string[] = [];

      // File-in-file: works for absolutely any file type.
      results.push(...extractFileInFile(bytes, primaryType));
      analyzedMethods.push("Embedded/trailing file-in-file scan");

      const mime = file.type || primaryType?.mime || "";

      if (CANVAS_DECODABLE_MIME.test(mime) || (primaryType && ["PNG Image", "JPEG Image", "GIF Image", "BMP Image", "WebP Image"].includes(primaryType.label))) {
        const imageData = await loadImageData(file);
        if (imageData) {
          results.push(...analyzeImageLsb(imageData));
          analyzedMethods.push(`Image LSB analysis (${imageData.width}×${imageData.height}px, default bit0/RGB convention)`);

          results.push(...bruteForceLsbScan(imageData));
          analyzedMethods.push("Multi-convention LSB brute force (other channel/bit-plane/order combinations — tool-agnostic)");

          if (primaryType?.label === "PNG Image") {
            const pngText = scanPngTextChunks(bytes);
            if (pngText.length > 0) {
              results.push(...pngText);
              analyzedMethods.push("PNG text-chunk scan (tEXt/iTXt/zTXt)");
            }
          }
          if (primaryType?.label === "JPEG Image") {
            const jpegComments = scanJpegComments(bytes);
            if (jpegComments.length > 0) {
              results.push(...jpegComments);
              analyzedMethods.push("JPEG comment-marker scan");
            }
          }
        } else {
          results.push({
            id: "image-decode-failed", severity: "info", title: "Couldn't decode this image for LSB analysis",
            summary: "The browser couldn't render this file as an image (unsupported variant or corrupted data).",
            explanation: "LSB pixel analysis needs a fully decoded bitmap — this doesn't affect the file-in-file scan above, which works on raw bytes regardless.",
            recommendation: "The Image Forensics tool under Digital Forensics Toolkit may give more detail on why decoding failed.",
          });
        }
      } else if (mime === "audio/wav" || mime === "audio/x-wav" || primaryType?.label === "WAV Audio") {
        results.push(...analyzeWavLsb(bytes));
        analyzedMethods.push("Raw PCM audio LSB analysis");
      } else if (mime.startsWith("audio/")) {
        results.push({
          id: "audio-compressed", severity: "info", title: "This cover file is compressed audio — pixel/sample-level LSB analysis skipped",
          summary: "This is just describing the uploaded file itself (e.g. an MP3) — only uncompressed PCM WAV supports byte-exact LSB extraction, so that specific check is skipped for this format.",
          explanation: "Lossy compression (MP3, AAC, compressed WAV) doesn't preserve exact sample bytes, so any LSB-based hiding technique wouldn't survive it intact anyway — real audio steganography in lossy formats uses echo hiding or phase coding instead, which need signal-processing analysis this tool doesn't perform.",
          recommendation: "If you suspect hidden data in compressed audio, a dedicated audio-forensics tool (Audacity's spectrogram view is a good free starting point — many audio-steganography tools hide messages visible as shapes in the spectrogram) is the next step.",
        });
        const id3 = scanId3Comments(bytes);
        if (id3.length > 0) {
          results.push(...id3);
          analyzedMethods.push("ID3 comment/lyrics tag scan");
        }
      } else if (mime.startsWith("video/") || primaryType?.label.includes("MP4")) {
        const frame = await loadFirstVideoFrame(file);
        if (frame) {
          const frameFindings = analyzeImageLsb(frame);
          results.push(...frameFindings.map((f) => ({ ...f, id: `video-frame0-${f.id}`, summary: `[First frame only] ${f.summary}` })));
          analyzedMethods.push(`First video frame LSB analysis (${frame.width}×${frame.height}px) — audio track and other frames not covered`);
        } else {
          results.push({
            id: "video-decode-failed", severity: "info", title: "Couldn't extract a frame from this video",
            summary: "The browser couldn't decode a frame for analysis.",
            explanation: "Video steganography analysis here is necessarily partial — even when it works, only the first frame is checked, not the whole stream or the audio track.",
            recommendation: "The file-in-file scan above still covers the raw container bytes regardless.",
          });
        }
      }

      // If the whole file decodes as mostly-printable text, also run the
      // zero-width Unicode scan on it directly.
      if (printableRatioQuick(bytes) > 0.95 && bytes.length < 2_000_000) {
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          const zw = scanZeroWidthSteganography(text);
          if (!(zw.length === 1 && zw[0].id === "zw-none")) {
            results.push(...zw);
            analyzedMethods.push("Zero-width Unicode text scan");
          }
        } catch {
          // Not valid UTF-8 text — skip.
        }
      }

      // Generic, tool-agnostic deep scan: strings + base64 across the
      // raw bytes, regardless of file type or how (or whether) anything
      // was deliberately hidden. Always runs, on every file.
      results.push(...deepScanStrings(bytes));
      analyzedMethods.push("Generic string/base64 deep scan (works regardless of file type or embedding tool)");

      setFindings(results);
      setAnalyzedAs(analyzedMethods);
    } catch {
      setError("Couldn't read this file in the browser. Try a smaller file.");
    } finally {
      setLoading(false);
    }
  }, []);

  function runTextScan() {
    if (!pasteText.trim()) return;
    setTextFindings(scanZeroWidthSteganography(pasteText));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  return (
    <div className="glass-panel p-4 space-y-4">
      <div>
        <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
          <Layers className="h-4 w-4 text-accent" /> Steganography Scanner
        </h2>
        <p className="text-xs text-slate-500">
          Detects AND extracts hidden content regardless of what tool hid it — not just this
          scanner's own Hide feature. Every scan brute-forces multiple LSB conventions (channel
          selection, bit plane, bit order — not just the default), checks PNG/JPEG/ID3 metadata text
          fields (a common tool-agnostic hiding spot), zero-width Unicode text steganography,
          file-in-file hiding (embedded/trailing data, extracted not just flagged), and a generic
          strings + base64 deep scan across the raw bytes of any file, plus a statistical
          pairs-analysis check for LSB tampering. Runs entirely in your browser. No technique covers
          every possible steganography method — see each finding's explanation for exactly what
          evidence it's based on.
        </p>
      </div>

      <div className="flex gap-1.5 border-b border-border pb-2.5">
        <button onClick={() => setMode("file")} className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${mode === "file" ? "border-accent/60 bg-accent/15 text-accent-glow" : "border-border text-slate-500 hover:text-slate-300 hover:border-border/80"}`}>
          <Upload className="h-3 w-3" /> Scan a File
        </button>
        <button onClick={() => setMode("text")} className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${mode === "text" ? "border-accent/60 bg-accent/15 text-accent-glow" : "border-border text-slate-500 hover:text-slate-300 hover:border-border/80"}`}>
          <Eye className="h-3 w-3" /> Scan Pasted Text
        </button>
        <button onClick={() => setMode("hide")} className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${mode === "hide" ? "border-accent/60 bg-accent/15 text-accent-glow" : "border-border text-slate-500 hover:text-slate-300 hover:border-border/80"}`}>
          <EyeOff className="h-3 w-3" /> Hide Content
        </button>
      </div>

      {mode === "file" && (
        <>
          <motion.label
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-xl py-10 cursor-pointer bg-[#0d0a18]/60"
          >
            <Upload className="h-6 w-6 text-accent" />
            <span className="text-sm text-slate-300">Drop an image, audio, video, or any file here — or click to browse</span>
            <span className="text-xs text-slate-500">Analyzed locally — nothing is uploaded to a server</span>
            <input
              type="file"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }}
            />
          </motion.label>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-accent" /> Scanning{fileName ? ` ${fileName}` : ""}…
            </div>
          )}
          {error && <p className="text-sm text-red-300">{error}</p>}

          <AnimatePresence>
            {findings && !loading && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                {analyzedAs && (
                  <div className="rounded-lg border border-border/60 bg-panel/40 px-3 py-2">
                    <p className="text-[10px] text-slate-500 mb-1">Methods applied to {fileName}</p>
                    <ul className="text-[11px] text-slate-400 space-y-0.5">
                      {analyzedAs.map((m, i) => <li key={i}>• {m}</li>)}
                    </ul>
                  </div>
                )}
                <div className="space-y-2">
                  {findings.map((f) => <FindingCard key={f.id} f={f} />)}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {mode === "text" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Paste any text — a suspicious message, a document's text content, a chat log — to check
            for invisible Unicode steganography (zero-width characters that encode a hidden binary
            message but render as nothing).
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste text here…"
            rows={6}
            dir="ltr"
            className="w-full bg-panel/60 border border-border rounded-lg p-3 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
          />
          <motion.button whileTap={{ scale: 0.97 }} onClick={runTextScan} disabled={!pasteText.trim()} className="text-xs px-3 py-1.5 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors">
            Scan Text
          </motion.button>

          {textFindings && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
              {textFindings.map((f) => <FindingCard key={f.id} f={f} />)}
            </motion.div>
          )}
        </div>
      )}

      {mode === "hide" && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Hide text or a whole file (including another image) inside a cover file. Two methods,
            picked automatically based on your cover: <strong className="text-slate-300">pixel LSB</strong>{" "}
            (image covers only, downloads a lossless PNG — the hidden content changes pixel values by
            at most 1, invisible to the eye) or <strong className="text-slate-300">append</strong>{" "}
            (works with ANY cover file — image, audio, video, PDF, anything — the hidden content rides
            along after the cover's own data, so the cover still opens/plays completely normally).
            Either way, uploading the result back into "Scan a File" on this same tool recovers the
            hidden content byte-for-byte.
          </p>

          <div>
            <p className="text-[11px] text-slate-500 mb-1.5">1. Cover file (what the hidden content goes inside)</p>
            <label className="flex items-center gap-2 border border-dashed border-border rounded-lg px-3 py-3 cursor-pointer hover:border-accent/50 transition-colors bg-[#0d0a18]/60">
              <Upload className="h-4 w-4 text-accent shrink-0" />
              <span className="text-xs text-slate-300 truncate">{hideCover ? hideCover.name : "Choose a cover file — image, audio, video, or anything else"}</span>
              <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) selectHideCover(f); }} />
            </label>
          </div>

          {hideCover && (
            <>
              <div>
                <p className="text-[11px] text-slate-500 mb-1.5">2. Method</p>
                <div className="flex gap-1.5">
                  <button
                    disabled={!hideCoverIsImage}
                    onClick={() => setHideMethod("lsb")}
                    className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${hideMethod === "lsb" ? "border-accent/60 bg-accent/15 text-accent-glow" : "border-border text-slate-500 hover:text-slate-300"}`}
                  >
                    <ImageIcon className="h-3 w-3" /> Pixel LSB {hideCoverIsImage ? "" : "(image covers only)"}
                  </button>
                  <button
                    onClick={() => setHideMethod("append")}
                    className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${hideMethod === "append" ? "border-accent/60 bg-accent/15 text-accent-glow" : "border-border text-slate-500 hover:text-slate-300"}`}
                  >
                    <Paperclip className="h-3 w-3" /> Append to file
                  </button>
                </div>
                {hideMethod === "lsb" && hideCapacity !== null && (
                  <p className="text-[10px] text-slate-600 mt-1.5">
                    Capacity: ~{(hideCapacity / 1024).toFixed(1)} KB. Your payload is currently ~{(hidePayloadSizeEstimate / 1024).toFixed(2)} KB
                    {hidePayloadSizeEstimate > hideCapacity ? <span className="text-red-400"> — too large for this cover, use a bigger image or switch to Append.</span> : "."}
                  </p>
                )}
                {hideTransparencyWarning && (
                  <p className="text-[10px] text-amber-400/90 mt-1.5 flex items-start gap-1">
                    <span className="shrink-0">⚠</span> {hideTransparencyWarning}
                  </p>
                )}
              </div>

              <div>
                <p className="text-[11px] text-slate-500 mb-1.5">3. What to hide</p>
                <div className="flex gap-1.5 mb-2">
                  <button onClick={() => setHidePayloadType("text")} className={`text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${hidePayloadType === "text" ? "border-accent/60 bg-accent/15 text-accent-glow" : "border-border text-slate-500 hover:text-slate-300"}`}>
                    Text
                  </button>
                  <button onClick={() => setHidePayloadType("file")} className={`text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${hidePayloadType === "file" ? "border-accent/60 bg-accent/15 text-accent-glow" : "border-border text-slate-500 hover:text-slate-300"}`}>
                    File / Image
                  </button>
                </div>
                {hidePayloadType === "text" ? (
                  <textarea
                    value={hidePayloadText}
                    onChange={(e) => setHidePayloadText(e.target.value)}
                    placeholder="Text to hide…"
                    rows={4}
                    dir="ltr"
                    className="w-full bg-panel/60 border border-border rounded-lg p-3 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
                  />
                ) : (
                  <label className="flex items-center gap-2 border border-dashed border-border rounded-lg px-3 py-3 cursor-pointer hover:border-accent/50 transition-colors bg-[#0d0a18]/60">
                    <Upload className="h-4 w-4 text-accent shrink-0" />
                    <span className="text-xs text-slate-300 truncate">{hidePayloadFile ? `${hidePayloadFile.name} (${(hidePayloadFile.size / 1024).toFixed(1)} KB)` : "Choose the file/image to hide"}</span>
                    <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setHidePayloadFile(f); }} />
                  </label>
                )}
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={runHide}
                disabled={hideBusy || (hidePayloadType === "text" ? !hidePayloadText.trim() : !hidePayloadFile)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors"
              >
                {hideBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <EyeOff className="h-3.5 w-3.5" />}
                Hide & Download
              </motion.button>

              {hideError && <p className="text-xs text-red-300">{hideError}</p>}
              {hideSuccess && (
                <div className="rounded-lg border border-emerald-700/60 bg-emerald-950/30 p-3">
                  <p className="text-xs text-emerald-300 flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Done</p>
                  <p className="text-[11px] text-slate-300 mt-1">{hideSuccess}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
