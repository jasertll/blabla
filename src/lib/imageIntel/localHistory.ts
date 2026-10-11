// "Seen before in this tool?" — a per-device, local-only investigation
// history. Deliberately IndexedDB (the analyst's own browser), not a
// server-side Redis corpus: this tool explicitly handles potentially
// sensitive images, and a shared server-side store of every image any
// analyst has ever investigated would be a real, unnecessary privacy
// exposure this design avoids by keeping the corpus local to whoever
// is actually using it, fully under their own control (clearable any
// time via normal browser data controls).
//
// Matching uses the SAME two real engines already built and verified
// for candidate comparison (perceptualHash.ts, localFeatureMatch.ts) —
// a fast pHash pre-filter across the whole local history, then real
// ORB+RANSAC geometric verification only on the promising candidates,
// so a "match" here carries the same evidentiary weight as the
// Candidate Comparison tab's, not a cheap hash-distance guess.
import { hammingDistanceHex, classifyDistance } from "./perceptualHash";
import { matchLocalFeatures } from "./localFeatureMatch";
import type { PerceptualHashes } from "./types";

const DB_NAME = "jaser-imageintel-history";
const STORE = "investigations";
const DB_VERSION = 1;
export const MAX_HISTORY_ENTRIES = 200;

export type HistoryEntry = {
  id: string; // sha256
  fileName: string;
  width: number;
  height: number;
  hashes: PerceptualHashes;
  thumbnailDataUrl: string;
  investigatedAt: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveToHistory(entry: HistoryEntry): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await trimHistory(db);
  db.close();
}

async function trimHistory(db: IDBDatabase): Promise<void> {
  const all = await new Promise<HistoryEntry[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as HistoryEntry[]);
    req.onerror = () => reject(req.error);
  });
  if (all.length <= MAX_HISTORY_ENTRIES) return;
  const sorted = [...all].sort((a, b) => a.investigatedAt.localeCompare(b.investigatedAt));
  const toRemove = sorted.slice(0, all.length - MAX_HISTORY_ENTRIES);
  const tx = db.transaction(STORE, "readwrite");
  for (const e of toRemove) tx.objectStore(STORE).delete(e.id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllHistory(): Promise<HistoryEntry[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();
  const all = await new Promise<HistoryEntry[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as HistoryEntry[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return all;
}

export async function clearHistory(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export type HistoryMatch = {
  entry: HistoryEntry;
  pHashDistance: number;
  dHashDistance: number;
  verdict: ReturnType<typeof classifyDistance>;
  geometricallyVerified: boolean;
  inlierCount: number;
  exactByteMatch: boolean;
};

/** Pre-filters the whole local history by perceptual-hash distance
 * (cheap, instant), then runs REAL ORB+RANSAC only on candidates close
 * enough to be worth the heavier check — exactly the same two-stage
 * approach (cheap filter -> expensive verification) real reverse-image
 * search systems use, not just a hash-distance table.
 *
 * This is called BEFORE saveToHistory for the current investigation, so
 * the only way a history entry's id equals currentSha256 is a genuine
 * re-investigation of a byte-identical file from a past session — the
 * single strongest "seen before" signal there is. That case is reported
 * directly (byte-identical implies pixel-identical; running ORB on it
 * would be pure overhead), not filtered out. */
export async function findSimilarInHistory(
  currentSha256: string,
  currentHashes: PerceptualHashes,
  currentCanvas: HTMLCanvasElement
): Promise<HistoryMatch[]> {
  const all = await getAllHistory();

  const exactMatch = all.find((e) => e.id === currentSha256);
  const results: HistoryMatch[] = [];
  if (exactMatch) {
    results.push({ entry: exactMatch, pHashDistance: 0, dHashDistance: 0, verdict: "identical", geometricallyVerified: true, inlierCount: 0, exactByteMatch: true });
  }

  const candidates = all.filter((e) => e.id !== currentSha256);
  const prefiltered = candidates
    .map((entry) => {
      const pHashDistance = hammingDistanceHex(currentHashes.pHash, entry.hashes.pHash);
      const dHashDistance = hammingDistanceHex(currentHashes.dHash, entry.hashes.dHash);
      return { entry, pHashDistance, dHashDistance, verdict: classifyDistance(Math.min(pHashDistance, dHashDistance)) };
    })
    .filter((c) => c.verdict !== "unrelated")
    .sort((a, b) => a.pHashDistance - b.pHashDistance)
    .slice(0, 5); // cap geometric verification to the 5 closest candidates — real CV work, not free

  for (const candidate of prefiltered) {
    try {
      const candidateImg = await loadImageElement(candidate.entry.thumbnailDataUrl);
      const candidateCanvas = document.createElement("canvas");
      candidateCanvas.width = candidateImg.naturalWidth;
      candidateCanvas.height = candidateImg.naturalHeight;
      candidateCanvas.getContext("2d")!.drawImage(candidateImg, 0, 0);

      const match = await matchLocalFeatures(currentCanvas, candidateCanvas);
      results.push({
        entry: candidate.entry,
        pHashDistance: candidate.pHashDistance,
        dHashDistance: candidate.dHashDistance,
        verdict: candidate.verdict,
        geometricallyVerified: match.status === "ok" && match.geometricallyConsistent,
        inlierCount: match.status === "ok" ? match.inlierCount : 0,
        exactByteMatch: false,
      });
    } catch {
      results.push({ entry: candidate.entry, pHashDistance: candidate.pHashDistance, dHashDistance: candidate.dHashDistance, verdict: candidate.verdict, geometricallyVerified: false, inlierCount: 0, exactByteMatch: false });
    }
  }

  return results.sort(
    (a, b) => Number(b.exactByteMatch) - Number(a.exactByteMatch) || Number(b.geometricallyVerified) - Number(a.geometricallyVerified) || a.pHashDistance - b.pHashDistance
  );
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load history thumbnail."));
    img.src = src;
  });
}
