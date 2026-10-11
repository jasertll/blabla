// Metadata forensics — classifies and structures whatever exifr (already
// a dependency, used the same way in components/FileInspector.tsx's
// tryExif()) extracts, rather than re-implementing EXIF/XMP/IPTC
// parsing from scratch. Split into a pure classifier (classifyMetadata,
// unit-testable against synthetic exifr-shaped objects) and a thin
// browser-only extraction wrapper that calls exifr and hands its output
// to the classifier.
import type { GpsEvidence, MetadataField, MetadataReport } from "./types";

type RawExif = Record<string, unknown>;

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" || typeof v === "string") return String(v);
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter(Boolean).join(", ");
  return null;
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === "string") {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

const CAMERA_KEYS = ["Make", "Model", "LensModel", "LensMake", "Software"];
const TIMESTAMP_KEYS = ["DateTimeOriginal", "CreateDate", "ModifyDate", "DateTime"];
const CATEGORY_HINTS: { prefix: string; category: MetadataField["category"] }[] = [
  { prefix: "GPS", category: "exif" },
  { prefix: "xmp", category: "xmp" },
  { prefix: "iptc", category: "iptc" },
  { prefix: "icc", category: "icc" },
];

function categoryFor(key: string): MetadataField["category"] {
  for (const { prefix, category } of CATEGORY_HINTS) {
    if (key.toLowerCase().startsWith(prefix.toLowerCase())) return category;
  }
  return "exif";
}

/** Pure — takes whatever exifr.parse() returned (or null on total
 * failure) and classifies it. No network, no DOM, fully unit-testable
 * against a synthetic object shaped like exifr's real output. */
export function classifyMetadata(raw: RawExif | null): MetadataReport {
  if (!raw || Object.keys(raw).length === 0) {
    return {
      status: "absent",
      fields: [],
      gps: null,
      camera: { make: null, model: null, lens: null, software: null },
      timestamps: { original: null, digitized: null, modified: null },
      orientation: null,
      inconsistencyNotes: [],
    };
  }

  const fields: MetadataField[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const str = asString(value);
    if (str !== null && str !== "") fields.push({ key, value: str, category: categoryFor(key) });
  }

  let gps: GpsEvidence | null = null;
  const lat = typeof raw.latitude === "number" ? raw.latitude : typeof raw.GPSLatitude === "number" ? raw.GPSLatitude : null;
  const lon = typeof raw.longitude === "number" ? raw.longitude : typeof raw.GPSLongitude === "number" ? raw.GPSLongitude : null;
  if (lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon)) {
    gps = {
      source: "exif-gps",
      latitude: lat,
      longitude: lon,
      altitude: typeof raw.GPSAltitude === "number" ? raw.GPSAltitude : null,
      timestamp: asString(raw.GPSDateStamp ?? raw.GPSTimeStamp) ?? null,
    };
  }

  const camera = {
    make: asString(raw.Make),
    model: asString(raw.Model),
    lens: asString(raw.LensModel ?? raw.LensMake),
    software: asString(raw.Software),
  };

  const original = asDate(raw.DateTimeOriginal);
  const digitized = asDate(raw.CreateDate);
  const modified = asDate(raw.ModifyDate ?? raw.DateTime);

  const inconsistencyNotes: string[] = [];
  if (original && modified && modified.getTime() < original.getTime()) {
    inconsistencyNotes.push(
      `Modify date (${modified.toISOString()}) is earlier than the original capture date (${original.toISOString()}) — the file's own metadata timeline doesn't add up, which can happen with a clock misconfiguration or a metadata-editing tool that didn't update all fields consistently.`
    );
  }
  if (camera.software && /photoshop|gimp|lightroom|affinity|pixlr|snapseed/i.test(camera.software)) {
    inconsistencyNotes.push(`Software field records "${camera.software}" — this file was processed by an image editor at some point after capture, not only by the camera itself.`);
  }
  const hasAnyCameraField = camera.make || camera.model;
  const hasAnyTimestamp = original || digitized || modified;
  if (!hasAnyCameraField && hasAnyTimestamp) {
    inconsistencyNotes.push("Timestamps are present but no camera make/model is recorded — consistent with metadata having been partially stripped or edited, or a capture device that doesn't report this field.");
  }

  const orientation = typeof raw.Orientation === "number" ? raw.Orientation : null;

  return {
    status: inconsistencyNotes.length > 0 ? "inconsistent" : "found",
    fields,
    gps,
    camera,
    timestamps: {
      original: original?.toISOString() ?? null,
      digitized: digitized?.toISOString() ?? null,
      modified: modified?.toISOString() ?? null,
    },
    orientation,
    inconsistencyNotes,
  };
}

/** Browser-only — needs exifr's real parser against an actual File. */
export async function extractMetadata(file: File): Promise<MetadataReport> {
  try {
    const exifr = (await import("exifr")).default;
    const raw = await exifr.parse(file, { gps: true, xmp: true, iptc: true, icc: true });
    return classifyMetadata(raw ?? null);
  } catch {
    return classifyMetadata(null);
  }
}
