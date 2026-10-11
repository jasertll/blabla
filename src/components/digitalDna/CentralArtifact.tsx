"use client";

import { motion } from "framer-motion";
import { FileQuestion } from "lucide-react";
import { entropyColor } from "./shared";

// The file itself as the central object, per the "digital genome" brief
// — a real image render (not a generic icon) when the upload actually
// is one, with a scanning-line sweep as the only decorative flourish;
// everything else on this card (the entropy dial) is a real number.
export default function CentralArtifact({
  imageUrl,
  typeLabel,
  overallEntropy,
  dangerous,
}: {
  imageUrl: string | null;
  typeLabel: string;
  overallEntropy: number;
  dangerous: boolean;
}) {
  const angle = (overallEntropy / 8) * 270 - 135; // -135deg..+135deg gauge sweep

  return (
    <div className="rounded-lg border border-border p-3 flex flex-col items-center justify-center gap-3 relative overflow-hidden" style={{ minHeight: 260 }}>
      <div className="relative w-40 h-40 rounded-lg overflow-hidden border border-border/70 bg-[#05040a] flex items-center justify-center">
        {imageUrl ? (
          <img src={imageUrl} alt="Analyzed file" className="w-full h-full object-cover" />
        ) : (
          <FileQuestion className="h-12 w-12 text-slate-600" />
        )}
        {/* Scanning sweep — purely decorative, the only non-data element on this card. */}
        <motion.div
          className="absolute left-0 right-0 h-8 pointer-events-none"
          style={{ background: "linear-gradient(180deg, transparent, rgba(34,211,238,0.35), transparent)" }}
          initial={{ top: "-10%" }}
          animate={{ top: "110%" }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
        />
        {/* Corner brackets, matching the app's existing glass-panel corner-accent language. */}
        <span className="absolute top-1 left-1 w-3 h-3 border-t border-l border-accent/60" />
        <span className="absolute top-1 right-1 w-3 h-3 border-t border-r border-accent/60" />
        <span className="absolute bottom-1 left-1 w-3 h-3 border-b border-l border-accent/60" />
        <span className="absolute bottom-1 right-1 w-3 h-3 border-b border-r border-accent/60" />
      </div>

      <p className="text-[10px] text-slate-500 text-center max-w-[180px]">{typeLabel}</p>

      {/* Overall-entropy gauge — a real dial, angle driven by the actual number. */}
      <svg width="72" height="44" viewBox="0 0 72 44">
        <path d="M 6 40 A 30 30 0 0 1 66 40" fill="none" stroke="#1e293b" strokeWidth="5" strokeLinecap="round" />
        <path
          d="M 6 40 A 30 30 0 0 1 66 40"
          fill="none"
          stroke={entropyColor(overallEntropy)}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(overallEntropy / 8) * 94.2} 200`}
        />
        <text x="36" y="30" fill="#e2e8f0" fontSize="11" textAnchor="middle" fontFamily="monospace" fontWeight="bold">
          {overallEntropy.toFixed(1)}
        </text>
      </svg>
      <p className="text-[9px] text-slate-600 -mt-2">overall entropy / 8</p>

      {dangerous && <p className="text-[10px] text-amber-400/90 text-center">Executable/script-capable type</p>}
    </div>
  );
}
