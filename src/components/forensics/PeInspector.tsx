"use client";

import { useState } from "react";
import { Cpu, Loader2, AlertTriangle } from "lucide-react";
import { parsePeMetadata, PeMetadata } from "@/lib/peMetadata";

function entropyColor(e: number): string {
  if (e >= 7.2) return "text-red-400";
  if (e >= 6.5) return "text-amber-400";
  return "text-emerald-400";
}

// This tool only ever gets uploaded PE files by construction — but this
// upload box sits right next to Image Forensics/Archive Listing in the
// same panel, and they all look like the same dashed drop-zone, so
// "wrong box" mix-ups are the single most common real-world cause of
// "Not a valid PE file" (reported directly: uploading an image here
// every time and getting confused by the raw parse error). Sniff a few
// unmistakable magic-byte signatures so the error can say what the file
// actually is and where to take it instead of just rejecting it.
function sniffKnownNonPeType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "a JPEG image — try Image Forensics above";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "a PNG image — try Image Forensics above";
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "a GIF image — try Image Forensics above";
  if (b.length >= 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "a WEBP image — try Image Forensics above";
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "a HEIC/HEIF image — try Image Forensics above";
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "a PDF document";
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05) && (b[3] === 0x04 || b[3] === 0x06))
    return "a ZIP-based file (.zip/.docx/.xlsx/.jar) — try Archive Listing below";
  return null;
}

export default function PeInspector() {
  const [fileName, setFileName] = useState("");
  const [meta, setMeta] = useState<PeMetadata | null | "invalid">(null);
  const [detectedType, setDetectedType] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleFile(file: File) {
    setLoading(true);
    setFileName(file.name);
    setMeta(null);
    setDetectedType(null);
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const parsed = parsePeMetadata(bytes);
    if (!parsed) setDetectedType(sniffKnownNonPeType(bytes));
    setMeta(parsed ?? "invalid");
    setLoading(false);
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <Cpu className="h-3.5 w-3.5 text-accent" /> PE (Windows Executable) Metadata
      </p>
      <p className="text-[11px] text-slate-500">
        Parses the real COFF/PE header bytes client-side — machine type, build timestamp, sections,
        and per-section entropy (a packing heuristic, not a verdict). No execution, nothing uploaded.
      </p>
      <label className="flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg py-4 cursor-pointer text-xs text-slate-400 hover:border-accent/50 transition-colors">
        {fileName || "Click to choose a .exe / .dll"}
        <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </label>

      {loading && <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Parsing…</div>}

      {meta === "invalid" && (
        <div className="rounded-lg bg-[#0d0a18] border border-border p-2.5 text-xs text-slate-400 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          {detectedType ? (
            <span>This looks like <strong className="text-slate-200">{detectedType}</strong>, not a Windows executable — wrong upload box.</span>
          ) : (
            <span>Not a valid PE file (no MZ/PE signature found).</span>
          )}
        </div>
      )}

      {meta && meta !== "invalid" && (
        <div className="rounded-lg bg-[#0d0a18] border border-border p-2.5 space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-1.5">
            <p><span className="text-slate-500">Machine:</span> <span className="text-slate-200">{meta.machine}</span></p>
            <p><span className="text-slate-500">Bitness:</span> <span className="text-slate-200">{meta.is64Bit ? "64-bit (PE32+)" : "32-bit (PE32)"}</span></p>
            <p><span className="text-slate-500">Subsystem:</span> <span className="text-slate-200">{meta.subsystem}</span></p>
            <p><span className="text-slate-500">Sections:</span> <span className="text-slate-200">{meta.numberOfSections}</span></p>
            <p className="col-span-2">
              <span className="text-slate-500">Build timestamp:</span>{" "}
              <span className={meta.timestampSuspicious ? "text-amber-400" : "text-slate-200"}>
                {meta.timestamp ?? "none"}
              </span>
              {meta.timestampSuspicious && <span className="text-amber-500 ml-1">— outside a plausible range (patched or forged)</span>}
            </p>
            <p className="col-span-2">
              <span className="text-slate-500">Whole-file entropy:</span>{" "}
              <span className={entropyColor(meta.overallEntropy)}>{meta.overallEntropy.toFixed(2)} / 8</span>
            </p>
          </div>

          {meta.characteristics.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {meta.characteristics.map((c) => (
                <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-panel/60 border border-border text-slate-400">{c}</span>
              ))}
            </div>
          )}

          <div className="space-y-1">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Sections</p>
            {meta.sections.map((s) => (
              <div key={s.name} className="flex items-center justify-between gap-2 text-[11px] font-mono px-1.5 py-1 odd:bg-panel/30 rounded">
                <span className="text-slate-300 truncate w-20">{s.name}</span>
                <span className="text-slate-500">{s.rawSize.toLocaleString()}B</span>
                <span className="text-slate-500">
                  {s.readable ? "R" : "-"}{s.writable ? "W" : "-"}{s.executable ? "X" : "-"}
                </span>
                <span className={entropyColor(s.entropy)}>{s.entropy.toFixed(2)}</span>
              </div>
            ))}
            {meta.sections.some((s) => s.executable && s.entropy >= 7.2) && (
              <p className="text-[10px] text-amber-400 flex items-center gap-1 pt-1">
                <AlertTriangle className="h-3 w-3" /> An executable section has high entropy — consistent with (not proof of) packing/encryption.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
