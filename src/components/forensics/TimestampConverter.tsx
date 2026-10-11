"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import {
  convertFromDate,
  parseUnixSeconds,
  parseUnixMillis,
  parseWindowsFileTime,
  parseIso,
  TimestampConversions,
} from "@/lib/timestampConvert";

type Format = "unixSeconds" | "unixMillis" | "windowsFileTime" | "iso";

export default function TimestampConverter() {
  const [format, setFormat] = useState<Format>("unixSeconds");
  const [input, setInput] = useState(String(Math.floor(Date.now() / 1000)));
  const [result, setResult] = useState<TimestampConversions | null>(null);
  const [error, setError] = useState<string | null>(null);

  function convert() {
    setError(null);
    let date: Date | null = null;
    if (format === "unixSeconds") date = parseUnixSeconds(input);
    else if (format === "unixMillis") date = parseUnixMillis(input);
    else if (format === "windowsFileTime") date = parseWindowsFileTime(input);
    else date = parseIso(input);

    if (!date || isNaN(date.getTime())) {
      setError("Couldn't parse that value for the selected format.");
      setResult(null);
      return;
    }
    setResult(convertFromDate(date));
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5 text-accent" /> Timestamp Converter
      </p>
      <p className="text-[11px] text-slate-500">
        Common forensic timestamp formats — log timestamps, Windows registry/NTFS artifacts, epoch values.
      </p>
      <div className="flex gap-2">
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as Format)}
          className="bg-panel/60 border border-border rounded-lg px-2 py-1.5 text-xs text-slate-200"
        >
          <option value="unixSeconds">Unix (seconds)</option>
          <option value="unixMillis">Unix (milliseconds)</option>
          <option value="windowsFileTime">Windows FILETIME</option>
          <option value="iso">ISO 8601 / date string</option>
        </select>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && convert()}
          dir="ltr"
          className="flex-1 bg-panel/60 border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-accent"
        />
        <button
          onClick={convert}
          className="text-xs px-3 py-1.5 rounded-md bg-accent/80 hover:bg-accent text-white transition-colors"
        >
          Convert
        </button>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      {result && (
        <div className="rounded-lg bg-[#0d0a18] border border-border p-2.5 space-y-1 text-xs font-mono">
          <p><span className="text-slate-500">ISO 8601:</span> <span className="text-slate-200">{result.iso}</span></p>
          <p><span className="text-slate-500">UTC:</span> <span className="text-slate-200">{result.utc}</span></p>
          <p><span className="text-slate-500">Local:</span> <span className="text-slate-200">{result.local}</span></p>
          <p><span className="text-slate-500">Unix (s):</span> <span className="text-slate-200">{result.unixSeconds}</span></p>
          <p><span className="text-slate-500">Unix (ms):</span> <span className="text-slate-200">{result.unixMillis}</span></p>
          <p><span className="text-slate-500">Windows FILETIME:</span> <span className="text-slate-200">{result.windowsFileTime}</span></p>
        </div>
      )}
    </div>
  );
}
