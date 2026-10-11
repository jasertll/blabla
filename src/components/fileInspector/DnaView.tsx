"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Repeat, Layers, Dna } from "lucide-react";
import type { EntropyProfile, FileSignature } from "@/lib/fileAnalysis";
import {
  buildGenomeRegions,
  buildRelationshipEdges,
  byteFrequencyHistogram,
  detectRepeatedSequences,
  replayEntropyComputation,
  REGION_CLASS_LABEL,
  REGION_CLASS_COLOR,
} from "@/lib/fileGenome";
import HudChip from "@/components/HudChip";
import { entropyColor, sampleRegions, formatBytes } from "@/components/digitalDna/shared";
import CentralArtifact from "@/components/digitalDna/CentralArtifact";
import EntropyHeatmap from "@/components/digitalDna/EntropyHeatmap";
import EntropyTopology from "@/components/digitalDna/EntropyTopology";
import ByteRelationshipGraph from "@/components/digitalDna/ByteRelationshipGraph";
import GenomeFingerprint from "@/components/digitalDna/GenomeFingerprint";
import EntropyLandscape3D from "@/components/digitalDna/EntropyLandscape3D";
import SelectedRegionPanel from "@/components/digitalDna/SelectedRegionPanel";

const HIGH_ENTROPY_THRESHOLD = 7.2;
const GRAPH_NODE_CAP = 90;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] text-terminal uppercase tracking-[0.2em] hud-text mb-1.5">{children}</p>;
}

// Reuses the already-computed hash/type/entropy from File Inspector's own
// analysis pass — this view adds a second layer of real genome data (region
// classification, byte-relationship graph, repeated-sequence detection) on
// top of it rather than re-reading and re-hashing the file from scratch,
// the way the old standalone Digital DNA tool had to.
export default function DnaView({
  fileName,
  fileSize,
  sha256,
  typeLabel,
  primaryType,
  entropyProfile,
  bytes,
  imageUrl,
}: {
  fileName: string;
  fileSize: number;
  sha256: string;
  typeLabel: string;
  primaryType: FileSignature | null;
  entropyProfile: EntropyProfile;
  bytes: Uint8Array;
  imageUrl: string | null;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [revealCount, setRevealCount] = useState(0);
  const replayCancelRef = useRef<(() => void) | null>(null);

  const genome = useMemo(() => {
    const regions = buildGenomeRegions(
      bytes,
      entropyProfile.blockSize || bytes.length || 1,
      entropyProfile.blocks.length > 0 ? entropyProfile.blocks : [entropyProfile.overall]
    );
    const sampled = sampleRegions(regions, GRAPH_NODE_CAP);
    const edges = buildRelationshipEdges(sampled);
    const histogram = byteFrequencyHistogram(bytes);
    const repeated = detectRepeatedSequences(bytes);
    return { regions, sampled, edges, histogram, repeated };
  }, [bytes, entropyProfile]);

  useEffect(() => {
    setSelectedIndex(null);
    setHoveredIndex(null);
    setRevealCount(genome.regions.length);
    replayCancelRef.current?.();
    setReplaying(false);
    return () => replayCancelRef.current?.();
  }, [genome]);

  const startReplay = useCallback(() => {
    replayCancelRef.current?.();
    setReplaying(true);
    setRevealCount(0);
    const cancel = replayEntropyComputation(
      bytes,
      entropyProfile.blockSize || bytes.length || 1,
      genome.regions.length,
      (batch) => setRevealCount((prev) => Math.min(genome.regions.length, prev + batch.length)),
      () => setReplaying(false)
    );
    replayCancelRef.current = cancel;
  }, [bytes, entropyProfile.blockSize, genome.regions.length]);

  const run = entropyProfile.highEntropyRun ?? null;
  const highEntropyBlockCount = entropyProfile.blocks.filter((b) => b >= HIGH_ENTROPY_THRESHOLD).length;
  const highEntropyShare = entropyProfile.blocks.length > 0 ? highEntropyBlockCount / entropyProfile.blocks.length : 0;

  const classBreakdown = (Object.keys(REGION_CLASS_LABEL) as Array<keyof typeof REGION_CLASS_LABEL>).map((cls) => ({
    cls,
    count: genome.regions.filter((r) => r.classification === cls).length,
  }));

  const selectedRegion = genome.regions.find((r) => r.index === selectedIndex) ?? null;
  const hoveredRegion = genome.regions.find((r) => r.index === hoveredIndex) ?? null;
  const displayedRegion = hoveredRegion ?? selectedRegion;

  const sampledVisible = genome.sampled.filter((r) => r.index < revealCount);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Dna className="h-4 w-4 text-accent" />
          <HudChip color="cyan">SEQUENCED</HudChip>
          <span className="text-[11px] text-slate-500">{genome.regions.length} real regions sampled</span>
        </div>
        <button
          onClick={startReplay}
          disabled={replaying}
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border border-accent/50 text-accent-glow hover:bg-accent/10 disabled:opacity-50 transition-colors"
        >
          {replaying ? <Repeat className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          {replaying ? "Replaying analysis…" : "Replay analysis"}
        </button>
      </div>

      <SelectedRegionPanel region={displayedRegion} live={!selectedRegion || hoveredRegion !== null} />

      <div>
        <SectionLabel>File</SectionLabel>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
          <CentralArtifact imageUrl={imageUrl} typeLabel={typeLabel} overallEntropy={entropyProfile.overall} dangerous={!!primaryType?.dangerous} />
          <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-[11px] text-slate-500 mb-1">File</p>
              <p className="text-slate-200 text-sm break-all">{fileName}</p>
              <p className="text-xs text-slate-500 mt-1">{formatBytes(fileSize)} · {typeLabel}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-[11px] text-slate-500 mb-1">SHA-256</p>
              <p className="text-slate-300 font-mono text-[11px] break-all">{sha256}</p>
            </div>
            {(() => {
              const naturallyHigh = !!primaryType?.naturallyHighEntropy;
              const tone = naturallyHigh ? "safe" : highEntropyShare > 0.4 ? "danger" : highEntropyShare > 0.1 ? "warning" : "safe";
              const borderClass = tone === "danger" ? "border-red-700/60 bg-red-950/30" : tone === "warning" ? "border-amber-700/60 bg-amber-950/25" : "border-emerald-700/60 bg-emerald-950/20";
              const textClass = tone === "danger" ? "text-red-300" : tone === "warning" ? "text-amber-300" : "text-emerald-300";
              return (
                <div className={`sm:col-span-2 rounded-lg border p-3 flex items-center gap-3 ${borderClass}`}>
                  <span className={`text-lg font-bold font-mono ${textClass}`}>{Math.round(highEntropyShare * 100)}%</span>
                  <p className="text-xs text-slate-300">
                    of this file reads as high-entropy (random-looking) data
                    {naturallyHigh ? `, expected for ${typeLabel}'s built-in compression.` : "."}{" "}
                    {run && run.length >= 3
                      ? naturallyHigh
                        ? `One contiguous region stands out from the rest (bytes ${run.startByte.toLocaleString()}–${run.endByte.toLocaleString()}) — could just be an already-compressed embedded asset (an image, another archive) rather than anything hidden; the same pattern would be a stronger signal in a plaintext-based format.`
                        : `The largest contiguous block spans bytes ${run.startByte.toLocaleString()}–${run.endByte.toLocaleString()} — worth a closer look.`
                      : naturallyHigh
                      ? "No single region stands out from the rest — consistent with uniform compression throughout."
                      : "No large suspicious contiguous block found."}
                  </p>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      <div>
        <SectionLabel>Structure — genome fingerprint</SectionLabel>
        <GenomeFingerprint regions={genome.regions} selectedIndex={selectedIndex} onSelect={setSelectedIndex} revealCount={revealCount} />
        <div className="flex flex-wrap gap-3 mt-2">
          {classBreakdown.map(({ cls, count }) => (
            <span key={cls} className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <span className="h-2 w-2 rounded-full" style={{ background: REGION_CLASS_COLOR[cls] }} />
              {REGION_CLASS_LABEL[cls]} · {count}
            </span>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>Entropy — regions across the file</SectionLabel>
        <EntropyHeatmap regions={genome.regions} fileSize={fileSize} selectedIndex={selectedIndex} onSelect={setSelectedIndex} onHover={setHoveredIndex} revealCount={revealCount} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <EntropyTopology regions={sampledVisible} fileSize={fileSize} selectedIndex={selectedIndex} hoveredIndex={hoveredIndex} onSelect={setSelectedIndex} onHover={setHoveredIndex} />
        <ByteRelationshipGraph
          regions={sampledVisible}
          edges={genome.edges.filter((e) => sampledVisible.some((r) => r.index === e.a) && sampledVisible.some((r) => r.index === e.b))}
          selectedIndex={selectedIndex}
          hoveredIndex={hoveredIndex}
          onSelect={setSelectedIndex}
          onHover={setHoveredIndex}
        />
      </div>

      <div>
        <SectionLabel>3D entropy landscape</SectionLabel>
        {/* Always the full sampled set, deliberately NOT filtered by
            revealCount like the 2D views above — rebuilding the WebGL
            scene on every replay animation-frame batch would thrash the
            GL context tens of times per second. The 2D views already
            carry the "watch it get revealed" beat; this one is fully
            interactive throughout instead. */}
        <EntropyLandscape3D regions={genome.sampled} fileSize={fileSize} selectedIndex={selectedIndex} onSelect={setSelectedIndex} onHover={setHoveredIndex} />
      </div>

      <div>
        <SectionLabel>Patterns — repeated byte sequences</SectionLabel>
        <div className="rounded-lg border border-border p-3">
          {genome.repeated.length === 0 ? (
            <p className="text-xs text-slate-500">No 4-byte sequence repeats more than twice in the sampled portion of this file — consistent with high-entropy or highly varied content.</p>
          ) : (
            <div className="space-y-1.5">
              {genome.repeated.map((seq, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-accent-glow">{seq.bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")}</span>
                  <span className="text-slate-500">{seq.count}× in sample, first at byte {seq.firstOffset.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div>
        <SectionLabel>Anomalies</SectionLabel>
        <div className="rounded-lg border border-border p-3">
          {run && run.length >= 3 ? (
            primaryType?.naturallyHighEntropy ? (
              <p className="text-xs text-slate-300">
                <span className="text-amber-300 font-semibold">Localized high-entropy segment:</span> bytes{" "}
                {run.startByte.toLocaleString()}–{run.endByte.toLocaleString()} (~{((run.endByte - run.startByte) / 1024).toFixed(1)} KB) sit above the surrounding regions' entropy. In a{" "}
                {typeLabel} — already compressed by design — one region standing out is far less unusual than in a plaintext-based format: it's commonly an already-compressed embedded
                object (an image, a font, another archive) bundled inside. Still worth a look if you want to confirm what's there (try the Steganography Scanner or a hex viewer), but this
                alone isn't a red flag the way it would be in a document or script.
              </p>
            ) : (
              <p className="text-xs text-slate-300">
                <span className="text-red-300 font-semibold">Localized high-entropy segment:</span> bytes{" "}
                {run.startByte.toLocaleString()}–{run.endByte.toLocaleString()} (~{((run.endByte - run.startByte) / 1024).toFixed(1)} KB) sit at or above the 7.2 bits/byte suspicion threshold
                while the surrounding regions don't — a real, localized statistical outlier, worth extracting and inspecting on its own (try the Steganography Scanner or a hex viewer).
              </p>
            )
          ) : (
            <p className="text-xs text-slate-500">No localized entropy anomaly found — the entropy profile is either uniformly low or uniformly high throughout, with no standout contiguous region.</p>
          )}
        </div>
      </div>

      <div>
        <SectionLabel>Forensic profile</SectionLabel>
        <div className="rounded-lg border border-border p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
          <div>
            <p className="text-slate-500">FILE TYPE</p>
            <p className="text-slate-300 mt-0.5">{typeLabel}</p>
          </div>
          <div>
            <p className="text-slate-500">OVERALL ENTROPY</p>
            <p className="mt-0.5 font-mono" style={{ color: entropyColor(entropyProfile.overall) }}>
              {entropyProfile.overall.toFixed(2)} / 8
            </p>
          </div>
          <div>
            <p className="text-slate-500">DOMINANT STRUCTURE</p>
            <p className="text-slate-300 mt-0.5">
              {REGION_CLASS_LABEL[classBreakdown.reduce((a, b) => (b.count > a.count ? b : a), classBreakdown[0]).cls]}
            </p>
          </div>
          <div>
            <p className="text-slate-500">REPEATED SEQUENCES FOUND</p>
            <p className="text-slate-300 mt-0.5">{genome.repeated.length}</p>
          </div>
          <div className="col-span-2 md:col-span-4 flex items-center gap-1.5">
            <Layers className="h-3 w-3 text-slate-500" />
            <p className="text-slate-500">
              Built from {genome.regions.length} real sampled regions of {formatBytes(fileSize)} — every number and position above traces back to this file's actual bytes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
