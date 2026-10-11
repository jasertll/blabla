/**
 * JOSINT · PDF Toolkit — Text extraction, page rendering, OCR
 * تعتمد على pdf.js و tesseract.js — كلاهما يعمل في المتصفح بلا مفاتيح.
 *
 * تُحمَّل المكتبات كسولاً (dynamic import) حتى لا تثقل الحزمة الأساسية.
 */

import type { Progress } from './tools';
const noop: Progress = () => {};

let workerConfigured = false;

/** ضبط عامل pdf.js مرة واحدة */
/**
 * المسار الافتراضي لعامل pdf.js.
 * نضعه في public/ بدل تمريره عبر أداة الحزم: محاولة تحزيم العامل تفشل
 * لأن Terser لا يستطيع تصغير وحدة تستخدم import.meta خارج سياق الوحدات.
 * انسخ الملف مرة واحدة:
 *   node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs → public/pdf.worker.min.mjs
 */
export const DEFAULT_WORKER_SRC = typeof document !== 'undefined' ? new URL('pdf.worker.min.mjs', document.baseURI).href : '/pdf.worker.min.mjs';

/*
 * نستخدم بناء legacy من pdf.js عمداً: فهو يحمل الحشوات (polyfills) اللازمة
 * للمتصفحات الأقدم. البناء الحديث يعتمد على دوال جديدة جداً مثل
 * Map.prototype.getOrInsertComputed وتنهار عليها متصفحات لا تزال شائعة.
 */
async function getPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = customWorkerSrc || DEFAULT_WORKER_SRC;
    workerConfigured = true;
  }
  return pdfjs;
}

let customWorkerSrc = '';

/** تحديد مسار عامل pdf.js يدوياً من التطبيق المضيف (يُستدعى قبل أول استخدام) */
export function setPdfWorkerSrc(src: string): void {
  customWorkerSrc = src;
  workerConfigured = false;
}

/* ------------------------------------------------------------------ */
/* استخراج النص                                                        */
/* ------------------------------------------------------------------ */
export interface PageText {
  page: number;
  text: string;
}

export async function extractText(
  bytes: Uint8Array,
  onProgress: Progress = noop,
): Promise<{ pages: PageText[]; full: string; empty: boolean }> {
  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  const pages: PageText[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const parts: string[] = [];
    let lastY: number | null = null;
    for (const item of content.items as Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>) {
      if (typeof item.str !== 'string') continue;
      const y = item.transform ? Math.round(item.transform[5]) : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) parts.push('\n');
      parts.push(item.str);
      if (item.hasEOL) parts.push('\n');
      lastY = y;
    }
    pages.push({ page: i, text: parts.join('').replace(/[ \t]+\n/g, '\n') });
    page.cleanup();
    onProgress(Math.floor((95 * i) / doc.numPages), `صفحة ${i}/${doc.numPages}`);
  }

  await task.destroy();
  const full = pages.map((p) => p.text).join('\n\n');
  return { pages, full, empty: full.replace(/\s/g, '').length < 20 };
}

/* ------------------------------------------------------------------ */
/* تحويل الصفحات إلى صور                                               */
/* ------------------------------------------------------------------ */
export interface RenderedPage {
  page: number;
  blob: Blob;
  width: number;
  height: number;
}

export async function renderPages(
  bytes: Uint8Array,
  opts: { dpi?: number; type?: 'image/png' | 'image/jpeg'; quality?: number } = {},
  onProgress: Progress = noop,
): Promise<RenderedPage[]> {
  if (typeof document === 'undefined') throw new Error('تحويل الصفحات إلى صور يعمل داخل المتصفح فقط.');
  const dpi = opts.dpi ?? 150;
  const type = opts.type ?? 'image/png';
  const quality = opts.quality ?? 0.92;

  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  const out: RenderedPage[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('تعذّر إنشاء لوحة الرسم.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvas, canvasContext: ctx, viewport } as never).promise;

    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, type, quality));
    if (blob) out.push({ page: i, blob, width: canvas.width, height: canvas.height });
    page.cleanup();
    onProgress(Math.floor((95 * i) / doc.numPages), `تحويل صفحة ${i}/${doc.numPages}`);
  }

  await task.destroy();
  return out;
}

/* ------------------------------------------------------------------ */
/* OCR                                                                 */
/* ------------------------------------------------------------------ */
export async function ocrPdf(
  bytes: Uint8Array,
  opts: { lang?: string; dpi?: number } = {},
  onProgress: Progress = noop,
): Promise<{ pages: PageText[]; full: string }> {
  if (typeof document === 'undefined') throw new Error('OCR يعمل داخل المتصفح فقط.');
  const lang = opts.lang ?? 'ara+eng';
  const dpi = opts.dpi ?? 180;

  onProgress(4, 'تحميل محرك التعرّف الضوئي…');
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(lang.split('+'));

  try {
    onProgress(15, 'تحويل الصفحات…');
    const rendered = await renderPages(bytes, { dpi, type: 'image/png' },
      (p, m) => onProgress(15 + Math.floor(p * 0.25), m));

    const pages: PageText[] = [];
    for (let i = 0; i < rendered.length; i++) {
      const { data } = await worker.recognize(rendered[i].blob);
      pages.push({ page: rendered[i].page, text: data.text });
      onProgress(40 + Math.floor((55 * (i + 1)) / rendered.length),
        `قراءة صفحة ${i + 1}/${rendered.length}`);
    }
    return { pages, full: pages.map((p) => p.text).join('\n\n') };
  } finally {
    await worker.terminate();
  }
}

/** OCR لصورة واحدة */
export async function ocrImage(
  blob: Blob,
  lang = 'ara+eng',
  onProgress: Progress = noop,
): Promise<string> {
  onProgress(10, 'تحميل محرك التعرّف الضوئي…');
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(lang.split('+'));
  try {
    onProgress(50, 'قراءة النص…');
    const { data } = await worker.recognize(blob);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
