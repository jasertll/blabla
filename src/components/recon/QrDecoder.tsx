"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { QrCode, Upload, AlertTriangle, ArrowRight, Copy, Check } from "lucide-react";
import jsQR from "jsqr";
import { defang } from "@/lib/defang";
import { detectIndicator, indicatorLabel } from "@/lib/detectIndicator";
import { useInvestigation } from "@/contexts/InvestigationContext";

const SHORTENER_HOSTS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly",
  "rebrand.ly", "cutt.ly", "shorturl.at", "rb.gy", "tiny.cc", "s.id",
]);

export default function QrDecoder() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [decoded, setDecoded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { runLookup } = useInvestigation();

  async function handleFile(file: File) {
    setError(null);
    setDecoded(null);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setError("Canvas not available in this browser.");
        return;
      }
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(imageData.data, imageData.width, imageData.height);
      if (!result) {
        setError("No QR code found in this image.");
        return;
      }
      setDecoded(result.data);
    } catch {
      setError("Couldn't read this image file.");
    }
  }

  const type = decoded ? detectIndicator(decoded) : "unknown";
  let host: string | null = null;
  if (type === "url") {
    try { host = new URL(decoded!).hostname; } catch { /* ignore */ }
  }
  const isShortener = host ? SHORTENER_HOSTS.has(host.replace(/^www\./, "")) : false;

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <QrCode className="h-3.5 w-3.5 text-accent" /> QR Code Decoder
      </p>
      <p className="text-[11px] text-slate-500">
        Decodes a QR code from an uploaded image entirely in your browser — nothing is uploaded
        anywhere. Flags URL shorteners (which hide the real destination) and can hand a decoded
        domain straight to the Domain Scan tool.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      <button
        onClick={() => inputRef.current?.click()}
        className="w-full flex items-center justify-center gap-2 text-xs px-3 py-3 rounded-lg border border-dashed border-border hover:border-accent/50 text-slate-400 hover:text-slate-200 transition-colors"
      >
        <Upload className="h-3.5 w-3.5" /> Upload a QR code image
      </button>

      {error && <p className="text-xs text-red-300">{error}</p>}

      {decoded && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          <div className="rounded-lg bg-[#0d0a18] border border-border p-2 flex items-start justify-between gap-2">
            <p className="text-xs font-mono text-slate-300 break-all" dir="ltr">{defang(decoded)}</p>
            <button
              onClick={() => { navigator.clipboard.writeText(decoded); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
              className="text-slate-500 hover:text-slate-200 transition-colors shrink-0"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>

          <p className="text-[11px] text-slate-500">Detected type: <span className="text-slate-300">{indicatorLabel(type)}</span></p>

          {isShortener && (
            <div className="flex items-center gap-2 text-xs text-amber-300/90 bg-amber-900/20 border border-amber-700/40 rounded-lg p-2.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              This is a link shortener ({host}) — the real destination is hidden. Treat with caution
              before opening.
            </div>
          )}

          {(type === "url" || type === "domain") && (
            <button
              onClick={() => runLookup(host ?? decoded)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent/80 hover:bg-accent text-white transition-colors"
            >
              Scan in Domain Tool <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </motion.div>
      )}
    </div>
  );
}
