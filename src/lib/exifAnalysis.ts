export type ExifSignal = {
  status: "flag" | "clear" | "info";
  label: string;
  detail: string;
};

const EDITING_SOFTWARE_KEYWORDS = [
  "photoshop", "gimp", "lightroom", "snapseed", "pixlr", "canva",
  "affinity photo", "paint.net", "picsart", "facetune", "photoscape",
  "capture one", "luminar",
];

export function analyzeExif(exif: Record<string, any> | null): ExifSignal[] {
  const signals: ExifSignal[] = [];

  if (!exif || Object.keys(exif).length === 0) {
    signals.push({
      status: "info",
      label: "No EXIF metadata",
      detail: "Common when re-saved by messaging apps, screenshot tools, or social platforms — not inherently suspicious on its own, but it does mean camera/software/date fields aren't available to check.",
    });
    return signals;
  }

  // exifr sometimes doesn't throw on a malformed/partial EXIF block —
  // it returns an object whose only content is an `errors` field. Left
  // unchecked this looks identical to "parsed fine, nothing notable
  // found," which is actively misleading (silently hides a real parse
  // failure instead of just having no data). Surface it explicitly.
  if ("errors" in exif && Object.keys(exif).length === 1) {
    signals.push({
      status: "info",
      label: "EXIF present but couldn't be fully parsed",
      detail: `The file has an EXIF block, but it's malformed or in a form this parser doesn't handle: "${String(exif.errors)}". This is a parsing limitation, not a finding — try the original file straight from the device if this was re-encoded/converted first.`,
    });
    return signals;
  }

  const software: string | undefined = exif.Software;
  if (software) {
    const matched = EDITING_SOFTWARE_KEYWORDS.find((kw) => software.toLowerCase().includes(kw));
    if (matched) {
      signals.push({
        status: "flag",
        label: "Editing software detected",
        detail: `The image's own metadata records it was processed with "${software}" — a direct signal, independent of ELA, that this file was edited (though it doesn't say what was changed).`,
      });
    } else {
      signals.push({
        status: "info",
        label: "Software tag present",
        detail: `Recorded software: "${software}". Not a known photo editor, so likely just the camera/phone firmware — but worth noting.`,
      });
    }
  }

  const original = exif.DateTimeOriginal ?? exif.CreateDate;
  const modified = exif.ModifyDate;
  if (original && modified) {
    const origDate = new Date(original);
    const modDate = new Date(modified);
    if (!isNaN(origDate.getTime()) && !isNaN(modDate.getTime())) {
      const diffSeconds = Math.abs(modDate.getTime() - origDate.getTime()) / 1000;
      if (diffSeconds > 60) {
        signals.push({
          status: "flag",
          label: "Capture/modify date mismatch",
          detail: `Captured ${origDate.toLocaleString()}, but last modified ${modDate.toLocaleString()} — a gap of ${Math.round(diffSeconds / 60)} minute(s). The file was opened and re-saved by some application after the original capture.`,
        });
      } else {
        signals.push({
          status: "clear",
          label: "Capture/modify dates match",
          detail: "No meaningful gap between capture and last-modified timestamps.",
        });
      }
    }
  }

  if (exif.Make || exif.Model) {
    signals.push({
      status: "info",
      label: "Camera/device identified",
      detail: `${exif.Make ?? ""} ${exif.Model ?? ""}`.trim(),
    });
  }

  return signals;
}
