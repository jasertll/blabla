"use client";

import { useState } from "react";
import { FolderArchive, Loader2, AlertTriangle, File as FileIcon, Folder } from "lucide-react";

type ArchiveEntry = { name: string; dir: boolean; size: number; compressedSize: number; date: string | null };

const RISKY_EXTENSIONS = /\.(exe|scr|js|vbs|bat|cmd|ps1|hta|jar|com|pif|msi|dll|lnk)$/i;
const DOUBLE_EXTENSION = /\.\w{2,5}\.(exe|scr|js|vbs|bat|cmd|ps1|hta|com|pif|lnk)$/i;

export default function ArchiveInspector() {
  const [fileName, setFileName] = useState("");
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setFileName(file.name);
    setEntries(null);
    setError(null);
    try {
      const JSZip = (await import("jszip")).default;
      const buffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      // `_data` is JSZip's internal (undocumented, not in its public type
      // defs) CompressedObject — reading its size fields avoids fully
      // decompressing every entry just to list the archive.
      const list: ArchiveEntry[] = Object.values(zip.files).map((f: any) => ({
        name: f.name,
        dir: f.dir,
        size: f._data?.uncompressedSize ?? 0,
        compressedSize: f._data?.compressedSize ?? 0,
        date: f.date ? new Date(f.date).toISOString() : null,
      }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      setEntries(list);
    } catch {
      setError("Could not parse as a ZIP archive (corrupt, encrypted, or not a ZIP-based format).");
    }
    setLoading(false);
  }

  const risky = entries?.filter((e) => !e.dir && (RISKY_EXTENSIONS.test(e.name) || DOUBLE_EXTENSION.test(e.name))) ?? [];

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <FolderArchive className="h-3.5 w-3.5 text-accent" /> Archive Listing (ZIP)
      </p>
      <p className="text-[11px] text-slate-500">
        Lists real entries inside a ZIP archive without extracting anything to disk — flags
        double extensions and executable-adjacent file types, a common phishing-attachment pattern.
      </p>
      <label className="flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg py-4 cursor-pointer text-xs text-slate-400 hover:border-accent/50 transition-colors">
        {fileName || "Click to choose a .zip / .docx / .xlsx / .jar…"}
        <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </label>

      {loading && <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading archive…</div>}
      {error && (
        <div className="rounded-lg bg-[#0d0a18] border border-border p-2.5 text-xs text-slate-400 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" /> {error}
        </div>
      )}

      {entries && (
        <div className="rounded-lg bg-[#0d0a18] border border-border p-2.5 space-y-2">
          <p className="text-[11px] text-slate-500">{entries.length} entries</p>
          {risky.length > 0 && (
            <p className="text-[10px] text-amber-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 shrink-0" /> {risky.length} entr{risky.length === 1 ? "y looks" : "ies look"} executable-adjacent — check before opening.
            </p>
          )}
          <div className="space-y-0.5 max-h-64 overflow-y-auto">
            {entries.map((e) => {
              const isRisky = !e.dir && (RISKY_EXTENSIONS.test(e.name) || DOUBLE_EXTENSION.test(e.name));
              return (
                <div key={e.name} className={`flex items-center gap-2 text-[11px] font-mono px-1.5 py-0.5 rounded ${isRisky ? "bg-amber-950/40 text-amber-300" : "odd:bg-panel/30 text-slate-300"}`}>
                  {e.dir ? <Folder className="h-3 w-3 shrink-0 text-slate-500" /> : <FileIcon className="h-3 w-3 shrink-0 text-slate-500" />}
                  <span className="truncate flex-1">{e.name}</span>
                  {!e.dir && <span className="text-slate-500 shrink-0">{e.size.toLocaleString()}B</span>}
                  {isRisky && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
