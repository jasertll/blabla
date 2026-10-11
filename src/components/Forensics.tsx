"use client";

import { Fingerprint } from "lucide-react";
import TimestampConverter from "@/components/forensics/TimestampConverter";
import EncodeDecode from "@/components/forensics/EncodeDecode";
import HexViewer from "@/components/forensics/HexViewer";
import ImageForensics from "@/components/forensics/ImageForensics";
import IocExtractor from "@/components/forensics/IocExtractor";
import HashCalculator from "@/components/forensics/HashCalculator";
import PeInspector from "@/components/forensics/PeInspector";
import ArchiveInspector from "@/components/forensics/ArchiveInspector";

export default function Forensics() {
  return (
    <div className="glass-panel p-4 space-y-4">
      <div>
        <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
          <Fingerprint className="h-4 w-4 text-accent" /> Digital Forensics Toolkit
        </h2>
        <p className="text-xs text-slate-500">
          Incident-response and evidence-analysis utilities — everything runs locally in your
          browser. Nothing here uploads your files anywhere except the SHA-256 hash lookups
          already covered in the File Inspector.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <IocExtractor />
        <ImageForensics />
        <TimestampConverter />
        <HashCalculator />
        <EncodeDecode />
        <HexViewer />
        <PeInspector />
        <ArchiveInspector />
      </div>
    </div>
  );
}
