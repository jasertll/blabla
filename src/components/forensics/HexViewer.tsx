"use client";

import { useState } from "react";
import { FileCode, ChevronLeft, ChevronRight, Search } from "lucide-react";

const BYTES_PER_ROW = 16;
const ROWS_PER_PAGE = 24;
const PAGE_SIZE = BYTES_PER_ROW * ROWS_PER_PAGE;

function parseSearchQuery(query: string): number[] | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  // Hex pattern like "4D5A" or "4D 5A"
  const hexClean = trimmed.replace(/\s+/g, "");
  if (/^[0-9a-fA-F]+$/.test(hexClean) && hexClean.length % 2 === 0) {
    const bytes: number[] = [];
    for (let i = 0; i < hexClean.length; i += 2) bytes.push(parseInt(hexClean.slice(i, i + 2), 16));
    return bytes;
  }
  // Otherwise treat as ASCII text
  return Array.from(new TextEncoder().encode(trimmed));
}

function findBytes(haystack: Uint8Array, needle: number[], fromIndex = 0): number {
  outer: for (let i = fromIndex; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export default function HexViewer() {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState("");
  const [page, setPage] = useState(0);
  const [offsetInput, setOffsetInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [matchOffset, setMatchOffset] = useState<number | null>(null);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);

  async function handleFile(file: File) {
    const buffer = await file.arrayBuffer();
    setBytes(new Uint8Array(buffer));
    setFileName(file.name);
    setPage(0);
    setMatchOffset(null);
    setSearchStatus(null);
  }

  function jumpToOffset() {
    if (!bytes) return;
    const target = offsetInput.trim().toLowerCase().startsWith("0x")
      ? parseInt(offsetInput.trim(), 16)
      : parseInt(offsetInput.trim(), 10);
    if (isNaN(target) || target < 0 || target >= bytes.length) return;
    setPage(Math.floor(target / PAGE_SIZE));
    setMatchOffset(target);
  }

  function runSearch(fromLastMatch: boolean) {
    if (!bytes) return;
    const needle = parseSearchQuery(searchQuery);
    if (!needle) return;
    const startFrom = fromLastMatch && matchOffset !== null ? matchOffset + 1 : 0;
    const found = findBytes(bytes, needle, startFrom);
    if (found === -1) {
      setSearchStatus(fromLastMatch ? "No more matches." : "Not found.");
      if (fromLastMatch) return; // keep last match visible
      setMatchOffset(null);
    } else {
      setMatchOffset(found);
      setPage(Math.floor(found / PAGE_SIZE));
      setSearchStatus(`Match at offset 0x${found.toString(16)}`);
    }
  }

  const totalPages = bytes ? Math.ceil(bytes.length / PAGE_SIZE) : 0;
  const pageBytes = bytes ? bytes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : null;
  const pageStart = page * PAGE_SIZE;

  const rows: { offset: number; hex: string; ascii: string }[] = [];
  if (pageBytes) {
    for (let i = 0; i < pageBytes.length; i += BYTES_PER_ROW) {
      const chunk = pageBytes.slice(i, i + BYTES_PER_ROW);
      const offset = pageStart + i;
      const hex = Array.from(chunk).map((b) => b.toString(16).padStart(2, "0")).join(" ");
      const ascii = Array.from(chunk).map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".")).join("");
      rows.push({ offset, hex, ascii });
    }
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <FileCode className="h-3.5 w-3.5 text-accent" /> Hex Viewer
      </p>
      <label className="flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg py-4 cursor-pointer text-xs text-slate-400 hover:border-accent/50 transition-colors">
        {fileName || "Click to choose a file"}
        <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </label>

      {bytes && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Search className="h-3.5 w-3.5 text-slate-500" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch(false)}
                placeholder="Find hex (4D5A) or text"
                dir="ltr"
                className="bg-panel/60 border border-border rounded-lg px-2 py-1 text-[11px] font-mono text-slate-200 w-40 focus:outline-none focus:border-accent"
              />
              <button onClick={() => runSearch(false)} className="text-[11px] px-2 py-1 rounded-md bg-panel border border-border hover:border-accent/50 text-slate-300">Find</button>
              <button onClick={() => runSearch(true)} className="text-[11px] px-2 py-1 rounded-md bg-panel border border-border hover:border-accent/50 text-slate-300">Next</button>
            </div>
            <div className="flex items-center gap-1">
              <input
                value={offsetInput}
                onChange={(e) => setOffsetInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && jumpToOffset()}
                placeholder="Offset (0x1A0 or 416)"
                dir="ltr"
                className="bg-panel/60 border border-border rounded-lg px-2 py-1 text-[11px] font-mono text-slate-200 w-36 focus:outline-none focus:border-accent"
              />
              <button onClick={jumpToOffset} className="text-[11px] px-2 py-1 rounded-md bg-panel border border-border hover:border-accent/50 text-slate-300">Go</button>
            </div>
          </div>
          {searchStatus && <p className="text-[11px] text-slate-500">{searchStatus}</p>}

          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>{bytes.length.toLocaleString()} bytes</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="disabled:opacity-30">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              Page {page + 1} / {totalPages}
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="disabled:opacity-30">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="rounded-lg bg-[#0d0a18] border border-border p-2 overflow-x-auto">
            <table className="text-[11px] font-mono text-slate-300 whitespace-nowrap">
              <tbody>
                {rows.map((row) => {
                  const isMatchRow = matchOffset !== null && matchOffset >= row.offset && matchOffset < row.offset + BYTES_PER_ROW;
                  return (
                    <tr key={row.offset} className={isMatchRow ? "bg-accent/20" : ""}>
                      <td className="text-slate-500 pr-3">{row.offset.toString(16).padStart(8, "0")}</td>
                      <td className="pr-3 text-accent-glow">{row.hex.padEnd(BYTES_PER_ROW * 3 - 1, " ")}</td>
                      <td className="text-slate-400">{row.ascii}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
