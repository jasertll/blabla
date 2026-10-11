"use client";

import { useRef, useState } from "react";
import { ImageIcon, MapPin, Loader2, CheckCircle2, AlertTriangle, HelpCircle, Info } from "lucide-react";
import { analyzeEla, ElaVerdict } from "@/lib/imageForensics";
import { analyzeExif, ExifSignal } from "@/lib/exifAnalysis";
import { extractHeicExifTiff } from "@/lib/heicExif";

type GpsInfo = { latitude: number; longitude: number } | null;

const VERDICT_STYLE: Record<ElaVerdict["verdict"], { icon: typeof CheckCircle2; color: string; bg: string }> = {
  "strong-signs-of-modification": { icon: AlertTriangle, color: "text-red-300", bg: "bg-red-900/20 border-red-700/40" },
  "possible-modification": { icon: AlertTriangle, color: "text-amber-300", bg: "bg-amber-900/20 border-amber-700/40" },
  "likely-original": { icon: CheckCircle2, color: "text-emerald-300", bg: "bg-emerald-900/20 border-emerald-700/40" },
  "inconclusive": { icon: HelpCircle, color: "text-slate-400", bg: "bg-slate-900/20 border-slate-700/40" },
};

const SIGNAL_STYLE: Record<ExifSignal["status"], { icon: typeof CheckCircle2; color: string }> = {
  flag: { icon: AlertTriangle, color: "text-red-300" },
  clear: { icon: CheckCircle2, color: "text-emerald-300" },
  info: { icon: Info, color: "text-slate-400" },
};

export default function ImageForensics() {
  const [original, setOriginal] = useState<string | null>(null);
  const [elaResult, setElaResult] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<ElaVerdict | null>(null);
  const [exifSignals, setExifSignals] = useState<ExifSignal[]>([]);
  const [fullExif, setFullExif] = useState<Record<string, any> | null>(null);
  const [showFullExif, setShowFullExif] = useState(false);
  const [gps, setGps] = useState<GpsInfo>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [convertedFromHeic, setConvertedFromHeic] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    setElaResult(null);
    setVerdict(null);
    setGps(null);
    setExifSignals([]);
    setFullExif(null);
    setConvertedFromHeic(false);

    const isHeic = file.type === "image/heic" || file.type === "image/heif" || /\.hei[cf]$/i.test(file.name);

    try {
      // EXIF is always read from the ORIGINAL file bytes — this works
      // before/regardless of the HEIC->JPEG conversion below.
      try {
        const exifr = (await import("exifr")).default;
        // exifr's own HEIC container reader has a real bug (see
        // lib/heicExif.ts) that makes it misread the Exif item's byte
        // range on most real-world HEIC files. For HEIC specifically,
        // locate and hand it the raw TIFF bytes ourselves; fall back to
        // exifr's normal path (JPEG/PNG, or a HEIC file that bug doesn't
        // hit) otherwise.
        let source: File | ArrayBuffer = file;
        if (isHeic) {
          const buf = await file.arrayBuffer();
          const tiff = extractHeicExifTiff(buf);
          if (tiff) source = tiff;
        }
        const [full, gpsData] = await Promise.all([
          exifr.parse(source, true).catch(() => null),
          exifr.gps(source).catch(() => null),
        ]);
        setFullExif(full ?? null);
        setExifSignals(analyzeExif(full));
        if (gpsData) setGps({ latitude: gpsData.latitude, longitude: gpsData.longitude });
      } catch {
        setExifSignals(analyzeExif(null));
      }

      // Chromium/Firefox have no built-in HEIC/HEIF decoder (the default
      // capture format on iPhones since iOS 11), so <img>/canvas can't
      // touch it directly — convert to a real JPEG client-side first
      // (WASM, bundled with the app, no network call) so preview + ELA
      // work the same as any other phone photo instead of just erroring.
      let displayBlob: Blob = file;
      if (isHeic) {
        const heic2any = (await import("heic2any")).default;
        const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
        displayBlob = Array.isArray(converted) ? converted[0] : converted;
        setConvertedFromHeic(true);
      }

      const url = URL.createObjectURL(displayBlob);
      setOriginal(url);

      const wasOriginallyJpeg = isHeic || file.type === "image/jpeg" || file.type === "image/jpg";
      await runEla(url, wasOriginallyJpeg);
    } catch (err) {
      setError(
        `Couldn't process this image for ELA (${err instanceof Error ? err.message : "unknown decode error"}). EXIF metadata above, if any, was still read directly from the file.`
      );
    } finally {
      setLoading(false);
    }
  }

  function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function runEla(src: string, wasOriginallyJpeg: boolean) {
    const img = await loadImage(src);
    const w = img.width, h = img.height;

    const originalCanvas = document.createElement("canvas");
    originalCanvas.width = w;
    originalCanvas.height = h;
    const octx = originalCanvas.getContext("2d")!;
    octx.drawImage(img, 0, 0);
    const originalData = octx.getImageData(0, 0, w, h);

    const resavedDataUrl = originalCanvas.toDataURL("image/jpeg", 0.9);
    const resavedImg = await loadImage(resavedDataUrl);
    const resavedCanvas = document.createElement("canvas");
    resavedCanvas.width = w;
    resavedCanvas.height = h;
    const rctx = resavedCanvas.getContext("2d")!;
    rctx.drawImage(resavedImg, 0, 0);
    const resavedData = rctx.getImageData(0, 0, w, h);

    const result = analyzeEla(originalData, resavedData, wasOriginallyJpeg);
    setVerdict(result);

    const outCanvas = canvasRef.current!;
    outCanvas.width = w;
    outCanvas.height = h;
    const outCtx = outCanvas.getContext("2d")!;
    const outData = outCtx.createImageData(w, h);

    const AMPLIFY = 12;
    for (let i = 0; i < originalData.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const diff = Math.abs(originalData.data[i + c] - resavedData.data[i + c]) * AMPLIFY;
        outData.data[i + c] = Math.min(255, diff);
      }
      outData.data[i + 3] = 255;
    }
    outCtx.putImageData(outData, 0, 0);

    if (result.verdict === "strong-signs-of-modification") {
      const gridSize = Math.sqrt(result.blocks.length);
      const blockW = w / gridSize;
      const blockH = h / gridSize;
      const threshold = result.blocks.reduce((a, b) => a + b.intensity, 0) / result.blocks.length;
      outCtx.strokeStyle = "#22d3ee";
      outCtx.lineWidth = Math.max(2, w / 300);
      for (const block of result.blocks) {
        if (block.intensity > threshold * 2 && block.intensity > 4) {
          outCtx.strokeRect(block.col * blockW, block.row * blockH, blockW, blockH);
        }
      }
    }

    setElaResult(outCanvas.toDataURL());
  }

  const VerdictIcon = verdict ? VERDICT_STYLE[verdict.verdict].icon : null;
  const flagCount = exifSignals.filter((s) => s.status === "flag").length + (verdict?.verdict === "strong-signs-of-modification" ? 1 : 0);

  return (
    <div className="rounded-lg border border-border p-3 space-y-3 lg:col-span-2">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <ImageIcon className="h-3.5 w-3.5 text-accent" /> Image Forensics
      </p>
      <p className="text-[11px] text-slate-500">
        Two independent checks: Error Level Analysis (compression-artifact pattern) and EXIF
        metadata (editing software, capture/modify date mismatch). Neither alone is proof —
        agreement between both is a stronger signal than either on its own. Works with JPEG/PNG
        (Android, PC) and HEIC/HEIF (iPhone's default photo format) — HEIC is converted to JPEG
        client-side first since browsers can't decode it natively.
      </p>

      <label className="flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg py-4 cursor-pointer text-xs text-slate-400 hover:border-accent/50 transition-colors">
        Click to choose an image
        <input type="file" accept="image/*,.heic,.heif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </label>

      {loading && <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing…</div>}
      {error && <p className="text-xs text-red-300">{error}</p>}

      {/* Two genuinely separate checks, deliberately shown as two
          distinct labeled sections (not one merged "Tampering
          Indicators" list) — reported confusion where the EXIF/metadata
          half wasn't noticed as being a separate thing from the ELA
          check. This is a UI clarity fix, not a functional change: both
          checks always ran and were always shown, just not obviously
          split before. */}
      {exifSignals.length > 0 && !loading && (
        <div className="rounded-lg border border-border p-3 bg-panel/40">
          <p className="text-xs font-semibold text-slate-200 mb-2">📷 Metadata (EXIF)</p>
          <div className="space-y-2">
            {exifSignals.map((s, i) => {
              const Icon = SIGNAL_STYLE[s.status].icon;
              return (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${SIGNAL_STYLE[s.status].color}`} />
                  <div>
                    <p className={`font-medium ${SIGNAL_STYLE[s.status].color}`}>{s.label}</p>
                    <p className="text-slate-400 mt-0.5">{s.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {verdict && VerdictIcon && !loading && (
        <div className="rounded-lg border border-border p-3 bg-panel/40">
          <p className="text-xs font-semibold text-slate-200 mb-2">
            🔍 Tampering Analysis (ELA) {flagCount > 0 ? `— ${flagCount} flag${flagCount > 1 ? "s" : ""} raised` : "— nothing flagged"}
          </p>
          <div className="flex items-start gap-2 text-xs">
            <VerdictIcon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${VERDICT_STYLE[verdict.verdict].color}`} />
            <div>
              <p className={`font-medium ${VERDICT_STYLE[verdict.verdict].color}`}>{verdict.headline}</p>
              <p className="text-slate-400 mt-0.5">{verdict.explanation}</p>
            </div>
          </div>
        </div>
      )}

      {gps && (
        <div className="flex items-center gap-2 text-xs text-slate-300 bg-panel/60 border border-border rounded-lg p-2">
          <MapPin className="h-3.5 w-3.5 text-accent shrink-0" />
          GPS: {gps.latitude.toFixed(5)}, {gps.longitude.toFixed(5)}
          <a
            href={`https://www.openstreetmap.org/?mlat=${gps.latitude}&mlon=${gps.longitude}#map=15/${gps.latitude}/${gps.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-glow hover:underline ml-auto"
          >
            View on map
          </a>
        </div>
      )}

      {fullExif && Object.keys(fullExif).length > 0 && (
        <div>
          <button onClick={() => setShowFullExif((v) => !v)} className="text-[11px] text-slate-400 hover:text-slate-200 underline">
            {showFullExif ? "Hide" : "Show"} full EXIF dump ({Object.keys(fullExif).length} fields)
          </button>
          {showFullExif && (
            <div className="mt-2 rounded-lg bg-[#0d0a18] border border-border p-2 max-h-48 overflow-y-auto space-y-0.5">
              {Object.entries(fullExif).map(([k, v]) => (
                <p key={k} className="text-[11px] font-mono text-slate-400 break-all">
                  <span className="text-slate-600">{k}:</span> {String(v)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {convertedFromHeic && (
        <p className="text-[11px] text-terminal flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5 shrink-0" />
          Converted from HEIC to JPEG client-side (no upload) for preview/ELA — EXIF above was read
          from the original HEIC file, not the converted copy.
        </p>
      )}

      {original && elaResult && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] text-slate-500 mb-1">Original{convertedFromHeic ? " (converted from HEIC)" : ""}</p>
            <img src={original} alt="Original" className="w-full rounded-lg border border-border" />
          </div>
          <div>
            <p className="text-[10px] text-slate-500 mb-1">ELA Output {verdict?.verdict === "strong-signs-of-modification" && "(cyan boxes = flagged regions)"}</p>
            <img src={elaResult} alt="ELA result" className="w-full rounded-lg border border-border bg-black" />
          </div>
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
