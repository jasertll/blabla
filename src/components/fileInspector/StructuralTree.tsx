"use client";

import { useState } from "react";
import { ChevronRight, FileCode2 } from "lucide-react";
import type { PeInfo } from "@/lib/peAnalysis";
import type { ElfInfo } from "@/lib/elfAnalysis";
import type { MacroExtractionResult } from "@/lib/macroAnalysis";

function TreeNode({
  label,
  detail,
  badge,
  badgeColor,
  depth,
  defaultOpen,
  children,
}: {
  label: string;
  detail?: string;
  badge?: string;
  badgeColor?: string;
  depth: number;
  defaultOpen?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const hasChildren = !!children;
  return (
    <div style={{ marginLeft: depth * 16 }} className={depth > 0 ? "border-l border-border pl-3" : ""}>
      <div
        className={`flex items-center gap-1.5 py-1 text-[11px] ${hasChildren ? "cursor-pointer hover:text-slate-100" : ""}`}
        onClick={() => hasChildren && setOpen((v) => !v)}
      >
        {hasChildren ? (
          <ChevronRight className={`h-3 w-3 text-slate-500 transition-transform ${open ? "rotate-90" : ""}`} />
        ) : (
          <span className="w-3" />
        )}
        <span className="text-slate-300 font-mono">{label}</span>
        {detail && <span className="text-slate-500">{detail}</span>}
        {badge && (
          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: `${badgeColor}22`, color: badgeColor, border: `1px solid ${badgeColor}55` }}>
            {badge}
          </span>
        )}
      </div>
      {hasChildren && open && <div>{children}</div>}
    </div>
  );
}

function flagBadge(executable: boolean, writable: boolean): { badge: string; color: string } | null {
  if (executable && writable) return { badge: "W+X anomaly", color: "#dc2626" };
  if (executable) return { badge: "X", color: "#f59e0b" };
  if (writable) return { badge: "W", color: "#64748b" };
  return null;
}

/** A real hierarchical view of the file's own structure — PE sections
 * and imports, ELF segments/sections, or extracted macro modules and
 * their IOCs, depending on what this file actually is. Not a process
 * tree (this is static analysis; there is no real execution to show) —
 * an honest structural tree instead, expandable/collapsible. */
export default function StructuralTree({ fileName, peInfo, elfInfo, macroResult }: { fileName: string; peInfo: PeInfo | null; elfInfo: ElfInfo | null; macroResult: MacroExtractionResult | null }) {
  const hasContent = !!peInfo || !!elfInfo || !!macroResult?.found;
  if (!hasContent) {
    return (
      <div className="rounded-lg border border-border p-6 text-center text-xs text-slate-500">
        No structural breakdown available for this file type — the PE/ELF/macro tree only applies to executables and document containers.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[11px] text-slate-400 mb-2 flex items-center gap-1.5">
        <FileCode2 className="h-3 w-3 text-accent" /> Structural tree — this file's real internal layout
      </p>
      <TreeNode label={fileName} depth={0} defaultOpen>
        {peInfo && (
          <>
            <TreeNode label="Sections" detail={`(${peInfo.sections.length})`} depth={1} defaultOpen>
              {peInfo.sections.map((s, i) => {
                const fb = flagBadge(s.executable, s.writable);
                return <TreeNode key={i} label={s.name || "(unnamed)"} detail={`${(s.rawSize / 1024).toFixed(1)} KB`} badge={fb?.badge} badgeColor={fb?.color} depth={2} />;
              })}
            </TreeNode>
            <TreeNode label="Imports" detail={`(${peInfo.imports.length} DLLs)`} depth={1}>
              {peInfo.imports.map((imp, i) => (
                <TreeNode key={i} label={imp.dll} detail={`${imp.functions.length} functions`} depth={2}>
                  {imp.functions.length > 0 && (
                    <div style={{ marginLeft: 32 }} className="text-[10px] text-slate-500 font-mono py-1 border-l border-border pl-3">
                      {imp.functions.slice(0, 12).join(", ")}
                      {imp.functions.length > 12 && ` … +${imp.functions.length - 12} more`}
                    </div>
                  )}
                </TreeNode>
              ))}
            </TreeNode>
          </>
        )}
        {elfInfo && (
          <>
            <TreeNode label="Segments" detail={`(${elfInfo.segments.length})`} depth={1} defaultOpen>
              {elfInfo.segments.map((s, i) => {
                const fb = flagBadge(s.executable, s.writable);
                return <TreeNode key={i} label={s.typeName} detail={`${(s.filesz / 1024).toFixed(1)} KB`} badge={fb?.badge} badgeColor={fb?.color} depth={2} />;
              })}
            </TreeNode>
            {!elfInfo.sectionHeadersStripped && (
              <TreeNode label="Sections" detail={`(${elfInfo.sections.length})`} depth={1}>
                {elfInfo.sections.slice(0, 30).map((s, i) => (
                  <TreeNode key={i} label={s.name || "(unnamed)"} detail={`${(s.size / 1024).toFixed(1)} KB`} depth={2} />
                ))}
              </TreeNode>
            )}
          </>
        )}
        {macroResult?.found && (
          <TreeNode label="VBA Modules" detail={`(${macroResult.modules.length})`} depth={1} defaultOpen>
            {macroResult.modules.map((m, i) => (
              <TreeNode key={i} label={m.name} depth={2} />
            ))}
            {(macroResult.iocs.urls.length > 0 || macroResult.deobfuscatedIocs.urls.length > 0) && (
              <TreeNode label="Extracted URLs" detail={`(${macroResult.iocs.urls.length + macroResult.deobfuscatedIocs.urls.length})`} badge="IOC" badgeColor="#f59e0b" depth={2}>
                {[...macroResult.iocs.urls, ...macroResult.deobfuscatedIocs.urls].map((u, i) => (
                  <TreeNode key={i} label={u} depth={3} />
                ))}
              </TreeNode>
            )}
          </TreeNode>
        )}
      </TreeNode>
    </div>
  );
}
