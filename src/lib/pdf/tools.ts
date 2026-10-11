/**
 * JOSINT · PDF Toolkit — Page operations
 * عمليات الصفحات: دمج، تقسيم، استخراج، حذف، تدوير، ترقيم، علامة مائية، صور→PDF
 * كلها تعمل داخل المتصفح بلا خادم.
 */

import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
} from '@cantoo/pdf-lib';

import { loadDoc } from './doc';

export interface NamedFile {
  name: string;
  bytes: Uint8Array;
}

export type Progress = (percent: number, message: string) => void;

const noop: Progress = () => {};

/* ------------------------------------------------------------------ */
/* نطاقات الصفحات                                                      */
/* ------------------------------------------------------------------ */

/** "1-3,5,8-10" → [[0,1,2],[4],[7,8,9]] */
export function parseRanges(spec: string, total: number): number[][] {
  const groups: number[][] = [];
  for (const chunkRaw of String(spec ?? '').replace(/،/g, ',').split(',')) {
    const chunk = chunkRaw.trim();
    if (!chunk) continue;
    if (chunk.includes('-')) {
      const [aRaw, bRaw] = chunk.split('-');
      const a = aRaw.trim() ? parseInt(aRaw, 10) : 1;
      const b = bRaw.trim() ? parseInt(bRaw, 10) : total;
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const g: number[] = [];
      for (let i = lo; i <= hi; i++) if (i >= 1 && i <= total) g.push(i - 1);
      if (g.length) groups.push(g);
    } else {
      const i = parseInt(chunk, 10);
      if (!Number.isNaN(i) && i >= 1 && i <= total) groups.push([i - 1]);
    }
  }
  return groups;
}

/** كل الصفحات المذكورة، مرتبة وبلا تكرار */
export function flatPages(spec: string, total: number): number[] {
  const set = new Set<number>();
  for (const g of parseRanges(spec, total)) for (const i of g) set.add(i);
  return [...set].sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ */
/* دمج                                                                 */
/* ------------------------------------------------------------------ */
export async function mergePdfs(files: NamedFile[], onProgress: Progress = noop): Promise<Uint8Array> {
  if (files.length < 2) throw new Error('الدمج يحتاج ملفين على الأقل.');
  const out = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    const src = await loadDoc(files[i].bytes);
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
    onProgress(10 + Math.floor((80 * (i + 1)) / files.length), `دمج ${i + 1}/${files.length}`);
  }
  return out.save({ useObjectStreams: true });
}

/* ------------------------------------------------------------------ */
/* تقسيم                                                               */
/* ------------------------------------------------------------------ */
export type SplitMode = 'each' | 'every' | 'range';

export async function splitPdf(
  bytes: Uint8Array,
  opts: { mode?: SplitMode; ranges?: string; every?: number; baseName?: string },
  onProgress: Progress = noop,
): Promise<NamedFile[]> {
  const src = await loadDoc(bytes);
  const total = src.getPageCount();
  const base = opts.baseName ?? 'document';
  const mode = opts.mode ?? 'each';
  const out: NamedFile[] = [];

  const build = async (indices: number[], label: string) => {
    const doc = await PDFDocument.create();
    const copied = await doc.copyPages(src, indices.filter((i) => i >= 0 && i < total));
    copied.forEach((p) => doc.addPage(p));
    out.push({ name: `${base}_${label}.pdf`, bytes: await doc.save({ useObjectStreams: true }) });
  };

  if (mode === 'range') {
    const groups = parseRanges(opts.ranges ?? '', total);
    if (!groups.length) throw new Error('لم يتم تحديد نطاقات صالحة.');
    for (let i = 0; i < groups.length; i++) {
      await build(groups[i], `part${i + 1}`);
      onProgress(10 + Math.floor((80 * (i + 1)) / groups.length), `جزء ${i + 1}`);
    }
  } else if (mode === 'every') {
    const step = Math.max(1, Math.floor(opts.every ?? 1));
    let n = 0;
    for (let start = 0; start < total; start += step) {
      n++;
      const idx: number[] = [];
      for (let i = start; i < Math.min(start + step, total); i++) idx.push(i);
      await build(idx, `part${n}`);
      onProgress(10 + Math.floor((80 * Math.min(start + step, total)) / total), `جزء ${n}`);
    }
  } else {
    for (let i = 0; i < total; i++) {
      await build([i], `page${String(i + 1).padStart(4, '0')}`);
      onProgress(10 + Math.floor((80 * (i + 1)) / total), `صفحة ${i + 1}/${total}`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* استخراج / حذف صفحات                                                 */
/* ------------------------------------------------------------------ */
export async function extractPages(bytes: Uint8Array, spec: string): Promise<Uint8Array> {
  const src = await loadDoc(bytes);
  const idx = flatPages(spec, src.getPageCount());
  if (!idx.length) throw new Error('لم يتم تحديد صفحات صالحة.');
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, idx);
  copied.forEach((p) => out.addPage(p));
  return out.save({ useObjectStreams: true });
}

export async function deletePages(bytes: Uint8Array, spec: string): Promise<Uint8Array> {
  const src = await loadDoc(bytes);
  const total = src.getPageCount();
  const remove = new Set(flatPages(spec, total));
  if (!remove.size) throw new Error('لم يتم تحديد صفحات صالحة.');
  const keep: number[] = [];
  for (let i = 0; i < total; i++) if (!remove.has(i)) keep.push(i);
  if (!keep.length) throw new Error('لا يمكن حذف كل الصفحات.');
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, keep);
  copied.forEach((p) => out.addPage(p));
  return out.save({ useObjectStreams: true });
}

/* ------------------------------------------------------------------ */
/* تدوير                                                               */
/* ------------------------------------------------------------------ */
export async function rotatePdf(
  bytes: Uint8Array,
  angle: number,
  spec?: string,
): Promise<Uint8Array> {
  const doc = await loadDoc(bytes);
  const total = doc.getPageCount();
  const targets = spec && spec.trim()
    ? new Set(flatPages(spec, total))
    : new Set(Array.from({ length: total }, (_, i) => i));

  for (let i = 0; i < total; i++) {
    if (!targets.has(i)) continue;
    const page = doc.getPage(i);
    const current = page.getRotation().angle;
    page.setRotation(degrees(((current + angle) % 360 + 360) % 360));
  }
  return doc.save({ useObjectStreams: true });
}

/* ------------------------------------------------------------------ */
/* ترقيم الصفحات                                                       */
/* ------------------------------------------------------------------ */
export type NumberPosition =
  | 'bottom-center' | 'bottom-right' | 'bottom-left'
  | 'top-center' | 'top-right' | 'top-left';

export async function addPageNumbers(
  bytes: Uint8Array,
  opts: { position?: NumberPosition; start?: number; size?: number } = {},
): Promise<Uint8Array> {
  const doc = await loadDoc(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = opts.size ?? 11;
  const start = opts.start ?? 1;
  const position = opts.position ?? 'bottom-center';

  doc.getPages().forEach((page, i) => {
    const label = String(start + i);
    const { width, height } = page.getSize();
    const w = font.widthOfTextAtSize(label, size);
    const y = position.startsWith('bottom') ? 24 : height - 30;
    let x: number;
    if (position.endsWith('left')) x = 40;
    else if (position.endsWith('right')) x = width - 40 - w;
    else x = (width - w) / 2;
    page.drawText(label, { x, y, size, font, color: rgb(0.25, 0.25, 0.25) });
  });

  return doc.save({ useObjectStreams: true });
}

/* ------------------------------------------------------------------ */
/* إضافة علامة مائية                                                   */
/* ------------------------------------------------------------------ */

/**
 * يرسم النص على لوحة canvas ثم يضمّنه كصورة.
 * السبب: هذا يجعل العربية (والصينية وأي لغة) تُشكَّل وتُعرض بشكل صحيح،
 * لأن المتصفح هو من يتولّى تشكيل الحروف — pdf-lib وحده لا يشكّل العربية.
 */
async function renderTextToPng(
  text: string,
  fontSize: number,
  color: string,
): Promise<{ png: Uint8Array; width: number; height: number } | null> {
  if (typeof document === 'undefined') return null;
  const pad = Math.ceil(fontSize * 0.4);
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return null;
  const fontSpec = `bold ${fontSize}px "Segoe UI", Tahoma, Arial, sans-serif`;
  measure.font = fontSpec;
  const m = measure.measureText(text);
  const w = Math.ceil(m.width) + pad * 2;
  const h = Math.ceil(fontSize * 1.5) + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = fontSpec;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) return null;
  return { png: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}

export async function addWatermark(
  bytes: Uint8Array,
  opts: {
    text?: string;
    opacity?: number;
    size?: number;
    rotate?: number;
    color?: string;
  } = {},
): Promise<Uint8Array> {
  const text = (opts.text ?? 'JOSINT').trim() || 'JOSINT';
  const opacity = Math.min(1, Math.max(0.02, opts.opacity ?? 0.15));
  const size = opts.size ?? 48;
  const rotate = opts.rotate ?? 45;
  const color = opts.color ?? '#3366cc';

  const doc = await loadDoc(bytes);
  const rendered = await renderTextToPng(text, size * 3, color);

  if (rendered) {
    const img = await doc.embedPng(rendered.png);
    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      const scale = Math.min((width * 0.75) / rendered.width, (height * 0.75) / rendered.height);
      const w = rendered.width * scale;
      const h = rendered.height * scale;
      page.drawImage(img, {
        x: (width - w) / 2,
        y: (height - h) / 2,
        width: w,
        height: h,
        opacity,
        rotate: degrees(rotate),
      });
    }
  } else {
    // بديل بلا canvas (بيئة الخادم): نص لاتيني فقط
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      const w = font.widthOfTextAtSize(text, size);
      page.drawText(text, {
        x: (width - w) / 2,
        y: height / 2,
        size,
        font,
        opacity,
        rotate: degrees(rotate),
        color: rgb(0.2, 0.4, 0.8),
      });
    }
  }

  return doc.save({ useObjectStreams: true });
}

/* ------------------------------------------------------------------ */
/* صور → PDF                                                           */
/* ------------------------------------------------------------------ */
export async function imagesToPdf(
  files: NamedFile[],
  onProgress: Progress = noop,
): Promise<Uint8Array> {
  if (!files.length) throw new Error('اختر صورة واحدة على الأقل.');
  const doc = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const lower = f.name.toLowerCase();
    let img;
    try {
      if (lower.endsWith('.png')) img = await doc.embedPng(f.bytes);
      else if (/\.(jpe?g)$/.test(lower)) img = await doc.embedJpg(f.bytes);
      else {
        // صيغة أخرى: نحوّلها إلى PNG عبر canvas
        const png = await transcodeToPng(f.bytes);
        if (!png) throw new Error(`صيغة غير مدعومة: ${f.name}`);
        img = await doc.embedPng(png);
      }
    } catch {
      throw new Error(`تعذّرت قراءة الصورة: ${f.name}`);
    }
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    onProgress(10 + Math.floor((80 * (i + 1)) / files.length), `صورة ${i + 1}/${files.length}`);
  }

  return doc.save({ useObjectStreams: true });
}

/** تحويل أي صورة يدعمها المتصفح إلى PNG */
export async function transcodeToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  try {
    const blob = new Blob([bytes as unknown as BlobPart]);
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const out: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!out) return null;
    return new Uint8Array(await out.arrayBuffer());
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* معلومات سريعة                                                       */
/* ------------------------------------------------------------------ */
export interface QuickInfo {
  pages: number;
  encrypted: boolean;
  title: string;
  author: string;
}

export async function quickInfo(bytes: Uint8Array): Promise<QuickInfo> {
  const doc = await loadDoc(bytes);
  return {
    pages: doc.getPageCount(),
    encrypted: doc.isEncrypted,
    title: safe(() => doc.getTitle() ?? ''),
    author: safe(() => doc.getAuthor() ?? ''),
  };
}

function safe<T>(fn: () => T): T | '' {
  try { return fn(); } catch { return ''; }
}
