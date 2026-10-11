// Real OCR via tesseract.js — same engine and loading pattern already
// used by this app's PDF Toolkit (lib/pdf/render.ts's ocrImage()):
// createWorker(), recognize(), terminate() in a finally block. Entity
// extraction itself lives in ocrEntities.ts (pure, unit-tested) — this
// module's only job is running the real engine and handing its output
// to that extractor.
import { extractEntities, generateSearchQueries } from "./ocrEntities";
import type { OcrExtraction, OcrWord, SearchQueryCandidate } from "./types";

export async function runOcr(
  canvas: HTMLCanvasElement,
  lang = "eng",
  onProgress: (pct: number, message: string) => void = () => {}
): Promise<{ extraction: OcrExtraction; searchQueries: SearchQueryCandidate[] }> {
  onProgress(5, "Loading OCR engine…");
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(lang.split("+"));

  try {
    onProgress(40, "Reading text…");
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))), "image/png")
    );
    const { data } = await worker.recognize(blob, {}, { blocks: true });

    // tesseract.js nests words inside blocks -> paragraphs -> lines ->
    // words (data.words is not a flat top-level array — see its own
    // Page/Block/Paragraph/Line/Word type definitions) — flatten that
    // real hierarchy rather than assuming a shape that doesn't exist.
    const words: OcrWord[] = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          for (const w of line.words ?? []) {
            words.push({ text: w.text, confidence: w.confidence, bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 } });
          }
        }
      }
    }

    const rawText = data.text ?? "";
    const normalizedText = rawText.replace(/\s+/g, " ").trim();
    const meanConfidence = words.length > 0 ? words.reduce((a, w) => a + w.confidence, 0) / words.length : 0;

    const entities = extractEntities(rawText);
    const extraction: OcrExtraction = {
      rawText,
      normalizedText,
      meanConfidence,
      words,
      usernames: entities.usernames,
      urls: entities.urls,
      domains: entities.domains,
      emails: entities.emails,
      hashtags: entities.hashtags,
      phoneNumbers: entities.phoneNumbers,
    };

    onProgress(100, "OCR complete.");
    return { extraction, searchQueries: generateSearchQueries(entities, rawText) };
  } finally {
    await worker.terminate();
  }
}
