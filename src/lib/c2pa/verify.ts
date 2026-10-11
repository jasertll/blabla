/**
 * lib/c2pa/verify.ts — real C2PA ("Content Credentials") verification,
 * entirely client-side, using Adobe/CAI's official `@contentauth/c2pa-web`
 * SDK (a WebAssembly build of `c2pa-rs`, the C2PA reference implementation
 * — the same engine behind contentcredentials.org/verify). Unlike a
 * hand-rolled byte-string scan, this actually:
 *   - Parses the real CBOR/JUMBF manifest structure.
 *   - Cryptographically verifies the COSE signature and the hash binding
 *     between the manifest and the asset's bytes (catches tampering after
 *     signing).
 *   - Checks the signer's certificate against C2PA's default trust list
 *     (the same one used across the ecosystem), producing one of the
 *     spec's three validation states: Invalid / Valid / Trusted.
 * The WASM binary (~8MB) and its worker are only loaded the first time
 * this module is used, not on every page load.
 */

import { createC2pa, Reader, type C2pa } from "@contentauth/c2pa-web";
import type { Manifest, ValidationState, ValidationStatus, Action } from "@contentauth/c2pa-types";

let c2paPromise: Promise<C2pa> | null = null;

function getC2pa(): Promise<C2pa> {
  if (!c2paPromise) {
    c2paPromise = createC2pa({ wasmSrc: "c2pa_bg.wasm" }).catch((err) => {
      c2paPromise = null; // allow retrying on the next call instead of caching a permanent failure
      throw err;
    });
  }
  return c2paPromise;
}

export type C2paVerification = {
  present: boolean;
  validationState: ValidationState | null;
  manifest: Manifest | null;
  validationStatus: ValidationStatus[];
  actions: Action[];
  thumbnailUrl: string | null;
  error: string | null;
};

export function extractActions(manifest: Manifest): Action[] {
  const actions: Action[] = [];
  for (const a of manifest.assertions ?? []) {
    if (a.label !== "c2pa.actions" && !a.label?.startsWith("c2pa.actions.")) continue;
    const data = a.data as { actions?: Action[] } | null | undefined;
    if (data?.actions && Array.isArray(data.actions)) actions.push(...data.actions);
  }
  return actions;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  avif: "image/avif", heic: "image/heic", heif: "image/heif", tif: "image/tiff",
  tiff: "image/tiff", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime",
  m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav", pdf: "application/pdf",
  avi: "video/x-msvideo", webm: "video/webm",
};

export function resolveFormat(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

// The container had *something* in the slot C2PA data lives in (a PNG
// caBX chunk, a JPEG APP11 segment, …) but it isn't valid JUMBF/CBOR —
// most likely corrupted, truncated, or hand-edited. That's meaningfully
// different from "no C2PA data at all", so it's worth saying plainly
// rather than surfacing the raw Rust error text.
export function classifyC2paError(raw: string): string {
  const looksCorrupt = /jumbf|cbor|parse/i.test(raw);
  return looksCorrupt
    ? "لقينا شي بالملف بمكان بيانات C2PA المتوقّع، بس البنية تالفة أو مش صالحة — ممكن الملف يكون انعدّل يدوياً أو تعرّض للتلف. هاد بحد ذاته مؤشر يستاهل الانتباه له."
    : "تعذر تحليل هالملف.";
}

export async function verifyC2pa(file: File): Promise<C2paVerification> {
  const empty: C2paVerification = {
    present: false, validationState: null, manifest: null,
    validationStatus: [], actions: [], thumbnailUrl: null, error: null,
  };

  let c2pa: C2pa;
  try {
    c2pa = await getC2pa();
  } catch {
    return { ...empty, error: "تعذر تحميل محرك التحقق من C2PA (مشكلة شبكة على الأغلب) — جرب تاني." };
  }

  let reader: Reader | null = null;
  try {
    reader = await Reader.fromBlob(c2pa, resolveFormat(file), file);
    if (!reader) return empty;

    const [store, manifest] = await Promise.all([reader.manifestStore(), reader.activeManifest()]);

    let thumbnailUrl: string | null = null;
    if (manifest.thumbnail?.identifier) {
      try {
        const bytes = await reader.resourceToBytes(manifest.thumbnail.identifier);
        const blob = new Blob([bytes as BlobPart], { type: manifest.thumbnail.format || "image/jpeg" });
        thumbnailUrl = URL.createObjectURL(blob);
      } catch {
        // best-effort — a missing/unreadable thumbnail resource doesn't invalidate the rest
      }
    }

    return {
      present: true,
      validationState: store.validation_state ?? null,
      manifest,
      validationStatus: store.validation_status ?? [],
      actions: extractActions(manifest),
      thumbnailUrl,
      error: null,
    };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return { ...empty, error: classifyC2paError(raw) };
  } finally {
    await reader?.free().catch(() => {});
  }
}
