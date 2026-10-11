import type { Verdict, Severity } from "./fileAnalysis";
import type { PeInfo } from "./peAnalysis";
import type { ElfInfo } from "./elfAnalysis";
import type { MacroExtractionResult } from "./macroAnalysis";
import { resolveAttackTechniques } from "./attackMapping";

export type EvidenceNodeType = "file" | "hash" | "section" | "import" | "api" | "string" | "ioc" | "yara" | "finding" | "attack";

export type EvidenceNode = {
  id: string;
  type: EvidenceNodeType;
  label: string;
  detail?: string;
  severity?: Severity;
  /** Real edge count touching this node — drives node size. Filled in
   * after edges are built, never asserted up front. */
  weight: number;
};

export type EvidenceEdge = { source: string; target: string };

export type EvidenceGraphInput = {
  fileName: string;
  overallSeverity: Severity;
  verdicts: Verdict[];
  interestingStrings: string[];
  peInfo: PeInfo | null;
  elfInfo: ElfInfo | null;
  macroResult: MacroExtractionResult | null;
};

/**
 * Builds a real evidence graph — every node is something this analysis
 * actually found, every edge is a real, traceable relationship (file
 * contains this section/import, or this finding's own summary text
 * names this specific API/section/DLL). Nothing is invented to fill
 * space: a file with no PE/ELF structure and no interesting strings
 * just produces a small graph, honestly.
 */
export function buildEvidenceGraph(input: EvidenceGraphInput): { nodes: EvidenceNode[]; edges: EvidenceEdge[] } {
  const nodes: EvidenceNode[] = [];
  const edges: EvidenceEdge[] = [];
  const byId = new Map<string, EvidenceNode>();

  function addNode(n: Omit<EvidenceNode, "weight">) {
    if (byId.has(n.id)) return byId.get(n.id)!;
    const full: EvidenceNode = { ...n, weight: 0 };
    nodes.push(full);
    byId.set(n.id, full);
    return full;
  }
  function addEdge(source: string, target: string) {
    if (!byId.has(source) || !byId.has(target)) return;
    edges.push({ source, target });
  }

  const fileId = "file";
  addNode({ id: fileId, type: "file", label: input.fileName.length > 28 ? input.fileName.slice(0, 26) + "…" : input.fileName });

  const hashId = "hash";
  addNode({ id: hashId, type: "hash", label: "SHA-256" });
  addEdge(fileId, hashId);

  // --- Structural entities (real, from actual parsed PE/ELF headers) ---
  const sectionNodeByName = new Map<string, string>();
  if (input.peInfo) {
    for (const s of input.peInfo.sections.slice(0, 20)) {
      const id = `section-${s.name || "unnamed"}`;
      const wx = s.executable && s.writable;
      addNode({ id, type: "section", label: s.name || "(unnamed)", detail: `${(s.rawSize / 1024).toFixed(1)} KB`, severity: wx ? "warning" : undefined });
      addEdge(fileId, id);
      sectionNodeByName.set(s.name, id);
    }
  } else if (input.elfInfo) {
    for (const s of input.elfInfo.segments.slice(0, 20)) {
      const id = `segment-${s.typeName}`;
      const wx = s.executable && s.writable;
      addNode({ id, type: "section", label: s.typeName, detail: `${(s.filesz / 1024).toFixed(1)} KB`, severity: wx ? "warning" : undefined });
      addEdge(fileId, id);
    }
  }

  const importNodeByDll = new Map<string, string>();
  const apiNodeByName = new Map<string, string>();
  if (input.peInfo) {
    for (const imp of input.peInfo.imports.slice(0, 12)) {
      const dllId = `import-${imp.dll}`;
      addNode({ id: dllId, type: "import", label: imp.dll, detail: `${imp.functions.length} functions` });
      addEdge(fileId, dllId);
      importNodeByDll.set(imp.dll, dllId);
      for (const fn of imp.functions.slice(0, 6)) {
        const apiId = `api-${fn}`;
        if (!apiNodeByName.has(fn)) {
          addNode({ id: apiId, type: "api", label: fn });
          apiNodeByName.set(fn, apiId);
        }
        addEdge(dllId, apiId);
      }
    }
  } else if (input.elfInfo?.interpreter) {
    const id = "import-interp";
    addNode({ id, type: "import", label: input.elfInfo.interpreter, detail: "dynamic linker" });
    addEdge(fileId, id);
  }

  // --- Strings / IOCs (real, extracted text) ---
  const stringNodeByText = new Map<string, string>();
  input.interestingStrings.slice(0, 10).forEach((s, i) => {
    const id = `string-${i}`;
    addNode({ id, type: "string", label: s.length > 26 ? s.slice(0, 24) + "…" : s });
    addEdge(fileId, id);
    stringNodeByText.set(s, id);
  });

  let vbaHubId: string | null = null;
  if (input.macroResult?.found) {
    vbaHubId = "vba-modules";
    addNode({ id: vbaHubId, type: "string", label: `${input.macroResult.modules.length} VBA module(s)` });
    addEdge(fileId, vbaHubId);
    const iocs = [...input.macroResult.iocs.urls, ...input.macroResult.deobfuscatedIocs.urls].slice(0, 8);
    iocs.forEach((u, i) => {
      const id = `ioc-${i}`;
      addNode({ id, type: "ioc", label: u.length > 26 ? u.slice(0, 24) + "…" : u });
      addEdge(vbaHubId!, id);
    });
  }

  // --- Findings/YARA-style matches, each wired to whatever real entity
  //     its own summary text actually names — never to the file's hash,
  //     which carries no evidentiary relationship of its own. ---
  const relevantVerdicts = input.verdicts.filter((v) => v.severity !== "safe" && v.severity !== "info");
  const findingIdByTitle = new Map<string, string>();

  for (const v of relevantVerdicts) {
    const isSignatureMatch = v.id.startsWith("sig-");
    const nodeId = `finding-${v.id}`;
    addNode({ id: nodeId, type: isSignatureMatch ? "yara" : "finding", label: v.title, severity: v.severity });
    findingIdByTitle.set(v.title, nodeId);

    // Trace to the most specific real source this finding's own summary
    // actually names — API first (most specific), then section, then
    // import/DLL, then a VBA hub, falling back to the file itself only
    // when nothing more specific is determinable.
    let wired = false;
    for (const [name, id] of apiNodeByName) {
      if (v.summary.includes(name)) {
        addEdge(id, nodeId);
        wired = true;
      }
    }
    if (!wired) {
      for (const [name, id] of sectionNodeByName) {
        if (name && v.summary.includes(name)) {
          addEdge(id, nodeId);
          wired = true;
        }
      }
    }
    if (!wired) {
      for (const [name, id] of importNodeByDll) {
        if (v.summary.includes(name)) {
          addEdge(id, nodeId);
          wired = true;
        }
      }
    }
    if (!wired && vbaHubId && v.id.includes("macro")) {
      addEdge(vbaHubId, nodeId);
      wired = true;
    }
    if (!wired && stringNodeByText.size > 0 && v.id.includes("suspicious-strings")) {
      for (const id of stringNodeByText.values()) addEdge(id, nodeId);
      wired = true;
    }
    if (!wired) addEdge(fileId, nodeId);
  }

  // --- Real ATT&CK techniques, connected FROM the finding(s) that
  //     triggered them — never from hash/section/import directly. ---
  const matches = resolveAttackTechniques(relevantVerdicts);
  for (const m of matches) {
    const id = `attack-${m.technique.id}`;
    addNode({ id, type: "attack", label: m.technique.id, detail: m.technique.name });
    for (const title of m.triggeredBy) {
      const sourceId = findingIdByTitle.get(title);
      if (sourceId) addEdge(sourceId, id);
    }
  }

  // Real weight = actual degree.
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  for (const n of nodes) n.weight = degree.get(n.id) ?? 0;

  return { nodes, edges };
}
