/**
 * JOSINT · PDF Toolkit — Compression
 * وضعان: آمن (يحافظ على النص) وقوي (يحوّل الصفحات إلى صور)
 */

import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from '@cantoo/pdf-lib';
import { loadDoc, textOf } from './doc';

import type { Progress } from './tools';
const noop: Progress = () => {};

export type CompressLevel = 'high' | 'medium' | 'low';

export interface CompressResult {
  bytes: Uint8Array;
  before: number;
  after: number;
  /** نسبة التوفير المئوية */
  saved: number;
  mode: 'safe' | 'strong';
}

const QUALITY: Record<CompressLevel, number> = { high: 0.85, medium: 0.65, low: 0.45 };
const MAX_EDGE: Record<CompressLevel, number> = { high: 2200, medium: 1600, low: 1100 };

/**
 * ضغط آمن: يعيد ترميز الصور الكبيرة بجودة أقل ويعيد بناء الملف
 * بتدفّقات كائنات مضغوطة. النص يبقى نصاً.
 */
export async function compressSafe(
  bytes: Uint8Array,
  level: CompressLevel = 'medium',
  onProgress: Progress = noop,
): Promise<CompressResult> {
  const doc = await loadDoc(bytes);
  const quality = QUALITY[level];
  const maxEdge = MAX_EDGE[level];
  const canUseCanvas = typeof document !== 'undefined' && typeof createImageBitmap !== 'undefined';

  if (canUseCanvas) {
    const streams: Array<[number, PDFRawStream]> = [];
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream
        && textOf(obj.dict.get(PDFName.of('Subtype'))) === 'Image') {
        streams.push([ref.objectNumber, obj]);
      }
    }

    for (let i = 0; i < streams.length; i++) {
      const [, stream] = streams[i];
      await recompressImage(stream, quality, maxEdge);
      onProgress(10 + Math.floor((75 * (i + 1)) / Math.max(streams.length, 1)),
        `ضغط صورة ${i + 1}/${streams.length}`);
    }
  }

  onProgress(90, 'إعادة بناء الملف…');
  const out = await doc.save({ useObjectStreams: true });
  return {
    bytes: out,
    before: bytes.length,
    after: out.length,
    saved: Math.max(0, Math.round((1 - out.length / Math.max(bytes.length, 1)) * 100)),
    mode: 'safe',
  };
}

async function recompressImage(stream: PDFRawStream, quality: number, maxEdge: number): Promise<void> {
  try {
    const dict = stream.dict;
    const filter = textOf(dict.get(PDFName.of('Filter')));
    if (!filter.includes('DCTDecode')) return;      // نتعامل مع JPEG فقط بأمان

    const raw = stream.asUint8Array();
    if (raw.length < 40_000) return;                // الصور الصغيرة لا تستحق

    const bmp = await createImageBitmap(new Blob([raw as unknown as BlobPart], { type: 'image/jpeg' }));
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();

    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob || blob.size >= raw.length) return;

    const next = new Uint8Array(await blob.arrayBuffer());
    stream.updateContents(next);
    dict.set(PDFName.of('Width'), PDFNumber.of(w));
    dict.set(PDFName.of('Height'), PDFNumber.of(h));
  } catch { /* نتجاهل الصورة التي تفشل */ }
}

/**
 * ضغط قوي: يحوّل كل صفحة إلى صورة JPEG ثم يعيد بناء المستند.
 * ⚠️ يفقد النص القابل للبحث — يُستخدم فقط عند الحاجة الشديدة لتصغير الحجم.
 */
export async function compressStrong(
  bytes: Uint8Array,
  level: CompressLevel = 'medium',
  onProgress: Progress = noop,
): Promise<CompressResult> {
  if (typeof document === 'undefined') {
    throw new Error('الضغط القوي يعمل داخل المتصفح فقط.');
  }
  const { renderPages } = await import('./render');
  const dpi = level === 'high' ? 150 : level === 'medium' ? 110 : 80;

  const rendered = await renderPages(
    bytes,
    { dpi, type: 'image/jpeg', quality: QUALITY[level] },
    (p, m) => onProgress(Math.floor(p * 0.7), m),
  );

  const out = await PDFDocument.create();
  for (let i = 0; i < rendered.length; i++) {
    const buf = new Uint8Array(await rendered[i].blob.arrayBuffer());
    const img = await out.embedJpg(buf);
    const page = out.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    onProgress(70 + Math.floor((25 * (i + 1)) / rendered.length), `صفحة ${i + 1}`);
  }

  const saved = await out.save({ useObjectStreams: true });
  return {
    bytes: saved,
    before: bytes.length,
    after: saved.length,
    saved: Math.max(0, Math.round((1 - saved.length / Math.max(bytes.length, 1)) * 100)),
    mode: 'strong',
  };
}
