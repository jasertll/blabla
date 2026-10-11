// Shared "tagged ATT&CK techniques" storage — originally local to
// AttackMapper.tsx, pulled out here so any tool (File Inspector's real
// technique matches, eventually others) can write to the exact same
// store and show up in AttackMapper's own heatmap, instead of each tool
// keeping its own disconnected copy.

export type TaggedTechniques = Record<string, { taggedAt: number; note: string }>;
const STORAGE_KEY = "jaser:attack:tagged";

export function loadTaggedTechniques(): TaggedTechniques {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveTaggedTechniques(t: TaggedTechniques) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch {
    /* private-browsing / quota — tagging just won't persist this session */
  }
}

export function isTechniqueTagged(id: string): boolean {
  return !!loadTaggedTechniques()[id];
}

export function setTechniqueTagged(id: string, tagged: boolean, note = ""): TaggedTechniques {
  const current = loadTaggedTechniques();
  const next = { ...current };
  if (tagged) {
    next[id] = { taggedAt: Date.now(), note };
  } else {
    delete next[id];
  }
  saveTaggedTechniques(next);
  return next;
}
