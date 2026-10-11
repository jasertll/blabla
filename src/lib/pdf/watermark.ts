/**
 * JOSINT · PDF Toolkit — Watermark removal engine
 * محرك إزالة العلامات المائية — يعمل بالكامل داخل المتصفح
 *
 * الفكرة: بدل تنقيح المساحة (الذي يمحو النص الأصلي تحت العلامة)، نفكّك
 * تدفّق محتوى الصفحة ونحدد بالبايت عوامل الرسم التي تُنتج العلامة المائية،
 * ثم نحذفها وحدها. النص الأصلي يبقى نصاً قابلاً للبحث والنسخ.
 *
 * سبع استراتيجيات:
 *   1. تعليقات وأختام Watermark / Stamp
 *   2. طبقات المحتوى الاختيارية (OCG) المسمّاة كعلامة مائية
 *   3. العناصر المرسومة بشفافية منخفضة (الأكثر شيوعاً)
 *   4. كائنات Form XObject التي تمثّل علامة مائية
 *   5. الصور المتكررة في كل الصفحات (شعار / ختم)
 *   6. نص محدّد يكتبه المستخدم
 *   7. الكتل المتطابقة في كل الصفحات (الوضع المتقدم)
 */

import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFObject,
} from '@cantoo/pdf-lib';

import {
  loadDoc,
  deref,
  textOf,
  pageResources,
  resourceDict,
  readPageContents,
  writePageContents,
  readStream,
  streamDict,
  extGStateAlpha,
  listOCGs,
  turnOffLayers,
  numOf,
} from './doc';

import {
  tokenize,
  findBlocks,
  findMarked,
  innermost,
  collectStrings,
  matchesText,
  mergeCuts,
  applyCuts,
  hashRange,
  kw,
  nameOf,
  type Cut,
  type Tok,
} from './stream';

/** كلمات تدل على أن الطبقة أو الكائن علامة مائية */
export const WATERMARK_WORDS = [
  'watermark', 'wasserzeichen', 'filigrane', 'marcadeagua', 'marcadagua',
  'draft', 'confidential', 'sample', 'specimen', 'trial', 'demo',
  'evaluation', 'unregistered', 'unlicensed', 'preview',
  'علامة', 'مائية', 'مسودة', 'نسخة', 'سري', 'تجريبي', 'عينة',
];

export type WatermarkMode = 'auto' | 'text' | 'aggressive';

export interface WatermarkOptions {
  mode?: WatermarkMode;
  /** نص العلامة المائية — مطلوب في وضع text */
  text?: string;
  /** أي عنصر شفافيته ≤ هذه القيمة يُعتبر علامة مائية */
  alpha?: number;
  /** إزالة الصور المتكررة في كل الصفحات */
  removeImages?: boolean;
  onProgress?: (percent: number, message: string) => void;
}

export interface WatermarkReport {
  annots: number;
  layers: number;
  transparent: number;
  forms: number;
  images: number;
  text: number;
  repeated: number;
  total: number;
  pages: number;
}

export interface WatermarkScan {
  pages: number;
  annots: number;
  layers: string[];
  transparentPages: number;
  repeatedImages: number;
  candidates: string[];
}

const REPORT_KEYS = ['annots', 'layers', 'transparent', 'forms', 'images', 'text', 'repeated'] as const;
type ReportKey = (typeof REPORT_KEYS)[number];

function emptyReport(pages: number): WatermarkReport {
  return { annots: 0, layers: 0, transparent: 0, forms: 0, images: 0, text: 0, repeated: 0, total: 0, pages };
}

function looksLikeWatermark(name: string): boolean {
  const low = (name || '').toLowerCase().replace(/\s+/g, '');
  return WATERMARK_WORDS.some((w) => low.includes(w));
}

/* ------------------------------------------------------------------ */
/* فحص تمهيدي                                                          */
/* ------------------------------------------------------------------ */
export async function scanWatermarks(bytes: Uint8Array, alpha = 0.7): Promise<WatermarkScan> {
  const doc = await loadDoc(bytes);
  const pages = doc.getPageCount();
  const ocgs = listOCGs(doc);
  const scan: WatermarkScan = {
    pages,
    annots: 0,
    layers: [...ocgs.values()].filter(Boolean),
    transparentPages: 0,
    repeatedImages: 0,
    candidates: [],
  };

  const imagePages = new Map<number, Set<number>>();

  for (let p = 0; p < pages; p++) {
    const leaf = doc.getPage(p).node;

    // تعليقات
    const annots = leaf.Annots();
    if (annots instanceof PDFArray) {
      for (let i = 0; i < annots.size(); i++) {
        const a = deref(doc, annots.get(i));
        if (a instanceof PDFDict) {
          const sub = textOf(a.get(PDFName.of('Subtype')));
          if (sub === 'Watermark' || sub === 'Stamp') scan.annots++;
        }
      }
    }

    const res = pageResources(doc, p);

    // صور
    const xobj = resourceDict(res, 'XObject');
    if (xobj) {
      for (const key of xobj.keys()) {
        const raw = xobj.get(key);
        if (!(raw instanceof PDFRef)) continue;
        const o = doc.context.lookup(raw);
        const d = streamDict(o);
        if (d && textOf(d.get(PDFName.of('Subtype'))) === 'Image') {
          if (!imagePages.has(raw.objectNumber)) imagePages.set(raw.objectNumber, new Set());
          imagePages.get(raw.objectNumber)!.add(p);
        }
      }
    }

    // شفافية
    const buf = readPageContents(doc, p);
    if (buf) {
      const toks = tokenize(buf);
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.k !== 'kw' || kw(buf, t) !== 'gs') continue;
        if (i === 0 || toks[i - 1].k !== 'name') continue;
        const a = extGStateAlpha(doc, res, nameOf(buf, toks[i - 1]));
        if (a !== null && a <= alpha) { scan.transparentPages++; break; }
      }
    }
  }

  const need = Math.max(2, Math.floor(pages * 0.8));
  for (const set of imagePages.values()) if (set.size >= need) scan.repeatedImages++;

  const wmLayers = [...ocgs.values()].some(looksLikeWatermark);
  if (scan.annots) scan.candidates.push('تعليقات/أختام');
  if (wmLayers) scan.candidates.push('طبقة علامة مائية');
  if (scan.transparentPages) scan.candidates.push('عناصر شفافة');
  if (scan.repeatedImages) scan.candidates.push('صور متكررة');

  return scan;
}

/* ------------------------------------------------------------------ */
/* الإزالة                                                             */
/* ------------------------------------------------------------------ */
export async function removeWatermarks(
  bytes: Uint8Array,
  options: WatermarkOptions = {},
): Promise<{ bytes: Uint8Array; report: WatermarkReport }> {
  const mode: WatermarkMode = options.mode ?? 'auto';
  const wanted = (options.text ?? '').trim();
  const alpha = Math.min(0.99, Math.max(0.01, options.alpha ?? 0.7));
  const removeImages = options.removeImages !== false;
  const progress = options.onProgress ?? (() => {});

  if (mode === 'text' && !wanted) {
    throw new Error('اكتب نص العلامة المائية المراد إزالته، أو اختر الوضع التلقائي.');
  }

  const doc = await loadDoc(bytes);
  const pages = doc.getPageCount();
  const report = emptyReport(pages);

  progress(6, 'قراءة بنية الملف…');

  // --- الطبقات الاختيارية التي تبدو علامة مائية ---
  const ocgNames = listOCGs(doc);
  const wmOcgs = new Set<number>();
  for (const [ref, name] of ocgNames) if (looksLikeWatermark(name)) wmOcgs.add(ref);

  // --- 1) التعليقات والأختام ---
  for (let p = 0; p < pages; p++) {
    const leaf = doc.getPage(p).node;
    const annots = leaf.Annots();
    if (!(annots instanceof PDFArray)) continue;
    const keep: PDFObject[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const raw = annots.get(i);
      const a = deref(doc, raw);
      let drop = false;
      if (a instanceof PDFDict) {
        const sub = textOf(a.get(PDFName.of('Subtype')));
        const title = textOf(deref(doc, a.get(PDFName.of('T'))));
        const subj = textOf(deref(doc, a.get(PDFName.of('Subj'))));
        drop = sub === 'Watermark' || sub === 'Stamp'
          || looksLikeWatermark(title) || looksLikeWatermark(subj);
      }
      if (drop) report.annots++;
      else keep.push(raw);
    }
    if (keep.length !== annots.size()) {
      leaf.set(PDFName.of('Annots'), doc.context.obj(keep));
    }
  }
  progress(14, 'فحص التعليقات والطبقات…');

  // --- 2) الصور المتكررة في كل الصفحات ---
  const wmImages = new Set<number>();
  if (removeImages && pages >= 2) {
    const imagePages = new Map<number, Set<number>>();
    for (let p = 0; p < pages; p++) {
      const xobj = resourceDict(pageResources(doc, p), 'XObject');
      if (!xobj) continue;
      for (const key of xobj.keys()) {
        const raw = xobj.get(key);
        if (!(raw instanceof PDFRef)) continue;
        const d = streamDict(doc.context.lookup(raw));
        if (d && textOf(d.get(PDFName.of('Subtype'))) === 'Image') {
          if (!imagePages.has(raw.objectNumber)) imagePages.set(raw.objectNumber, new Set());
          imagePages.get(raw.objectNumber)!.add(p);
        }
      }
    }
    const need = Math.max(2, Math.floor(pages * 0.8));
    for (const [num, set] of imagePages) if (set.size >= need) wmImages.add(num);
  }
  progress(22, 'تحليل الصور المتكررة…');

  // --- 3) الكتل المتطابقة (الوضع المتقدم) ---
  const repeated = new Set<string>();
  if (mode === 'aggressive' && pages >= 2) {
    const counts = new Map<string, number>();
    for (let p = 0; p < pages; p++) {
      const buf = readPageContents(doc, p);
      if (!buf) continue;
      const toks = tokenize(buf);
      const limit = Math.min(400, Math.floor(Math.max(1, toks.length) * 0.7));
      const seen = new Set<string>();
      for (const b of findBlocks(buf, toks)) {
        if (b.t1 - b.t0 > limit) continue;
        const h = hashRange(buf, b.b0, b.b1);
        if (seen.has(h)) continue;
        seen.add(h);
        counts.set(h, (counts.get(h) ?? 0) + 1);
      }
    }
    const need = Math.max(2, Math.floor(pages * 0.8));
    for (const [h, c] of counts) if (c >= need) repeated.add(h);
    progress(32, 'تحليل العناصر المتكررة…');
  }

  // --- 4) جراحة تدفّق المحتوى ---
  const formVerdict = new Map<number, boolean>();

  for (let p = 0; p < pages; p++) {
    const buf = readPageContents(doc, p);
    if (!buf || !buf.length) {
      progress(35 + Math.floor((55 * (p + 1)) / pages), `صفحة ${p + 1}/${pages}`);
      continue;
    }

    const res = pageResources(doc, p);
    const toks = tokenize(buf);
    const blocks = findBlocks(buf, toks);
    const maxSpan = Math.floor(Math.max(1, toks.length) * 0.7);
    const cuts: Cut[] = [];
    const doSites = new Map<string, Cut[]>();

    const bump = (k: ReportKey) => { report[k]++; };

    // 4-أ) مناطق الطبقات
    if (wmOcgs.size) {
      const propsDict = resourceDict(res, 'Properties');
      for (const region of findMarked(buf, toks)) {
        if (region.tag !== 'OC' || !region.prop) continue;
        const raw = propsDict?.get(PDFName.of(region.prop));
        const num = raw instanceof PDFRef ? raw.objectNumber : null;
        if (num !== null && wmOcgs.has(num) && region.t1 - region.t0 <= maxSpan) {
          cuts.push([region.b0, region.b1]);
          bump('layers');
        }
      }
    }

    // 4-ب) عوامل الرسم
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.k !== 'kw') continue;
      const w = kw(buf, t);
      const prevName = i > 0 && toks[i - 1].k === 'name' ? nameOf(buf, toks[i - 1]) : null;

      // شفافية منخفضة: نحذف من عامل gs حتى إغلاق أصغر كتلة تحتويه،
      // لأن الشفافية تسري من هذه النقطة حتى نهاية الكتلة
      if (w === 'gs' && prevName) {
        const a = extGStateAlpha(doc, res, prevName);
        if (a !== null && a <= alpha) {
          const blk = innermost(blocks, i);
          if (blk && blk.t1 - i <= maxSpan) {
            cuts.push([toks[i - 1].a, toks[blk.t1].a]);
            bump('transparent');
          }
        }
        continue;
      }

      // رسم كائن خارجي
      if (w === 'Do' && prevName) {
        const site: Cut = [toks[i - 1].a, t.b];
        if (!doSites.has(prevName)) doSites.set(prevName, []);
        doSites.get(prevName)!.push(site);

        const xobj = resourceDict(res, 'XObject');
        const raw = xobj?.get(PDFName.of(prevName));
        if (!(raw instanceof PDFRef)) continue;

        if (wmImages.has(raw.objectNumber)) {
          cuts.push(site);
          bump('images');
        } else if (isWatermarkForm(doc, raw, alpha, wmOcgs, formVerdict)) {
          cuts.push(site);
          bump('forms');
        }
      }
    }

    // 4-ج) كتل نصية مطابقة
    if (mode === 'text') {
      let depth = 0;
      let btStart = 0;
      let btTok = -1;
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.k !== 'kw') continue;
        const w = kw(buf, t);
        if (w === 'BT') {
          depth++;
          if (depth === 1) { btStart = t.a; btTok = i; }
        } else if (w === 'ET' && depth > 0) {
          depth--;
          if (depth === 0 && btTok >= 0) {
            if (matchesText(collectStrings(buf, toks, btTok, i), wanted)) {
              cuts.push([btStart, t.b]);
              bump('text');
            }
            btTok = -1;
          }
        }
      }
    }

    // 4-د) الكتل المتكررة
    if (mode === 'aggressive' && repeated.size) {
      for (const b of blocks) {
        if (b.t1 - b.t0 > maxSpan || b.t1 - b.t0 > 400) continue;
        if (repeated.has(hashRange(buf, b.b0, b.b1))) {
          cuts.push([b.b0, b.b1]);
          bump('repeated');
        }
      }
    }

    if (cuts.length) {
      const merged = mergeCuts(cuts);
      // إزالة الموارد التي لم تعد مرسومة إطلاقاً
      const xobj = resourceDict(res, 'XObject');
      if (xobj) {
        for (const [name, sites] of doSites) {
          const allCut = sites.every(([s, e]) => merged.some(([a, b]) => a <= s && e <= b));
          if (allCut) {
            try { xobj.delete(PDFName.of(name)); } catch { /* تجاهل */ }
          }
        }
      }
      writePageContents(doc, p, applyCuts(buf, merged));
    }

    progress(35 + Math.floor((55 * (p + 1)) / pages), `معالجة صفحة ${p + 1}/${pages}`);
  }

  // --- 5) إطفاء الطبقات المتبقية احتياطاً ---
  if (wmOcgs.size) turnOffLayers(doc, wmOcgs);

  progress(94, 'حفظ الملف…');
  const out = await doc.save({ useObjectStreams: true });

  report.total = REPORT_KEYS.reduce((s, k) => s + report[k], 0);
  progress(100, 'اكتمل');
  return { bytes: out, report };
}

/* ------------------------------------------------------------------ */
function isWatermarkForm(
  doc: Awaited<ReturnType<typeof loadDoc>>,
  ref: PDFRef,
  alpha: number,
  wmOcgs: Set<number>,
  cache: Map<number, boolean>,
): boolean {
  const num = ref.objectNumber;
  const cached = cache.get(num);
  if (cached !== undefined) return cached;

  let verdict = false;
  try {
    const obj = doc.context.lookup(ref);
    const dict = streamDict(obj);
    if (dict && textOf(dict.get(PDFName.of('Subtype'))) === 'Form') {
      // طبقة اختيارية معروفة
      const oc = dict.get(PDFName.of('OC'));
      if (oc instanceof PDFRef && wmOcgs.has(oc.objectNumber)) verdict = true;

      // شفافية منخفضة داخل موارد الكائن نفسه
      if (!verdict) {
        const res = deref(doc, dict.get(PDFName.of('Resources')));
        if (res instanceof PDFDict) {
          const gs = resourceDict(res, 'ExtGState');
          if (gs) {
            for (const key of gs.keys()) {
              const entry = deref(doc, gs.get(key));
              if (!(entry instanceof PDFDict)) continue;
              for (const k of ['ca', 'CA']) {
                const v = numOf(deref(doc, entry.get(PDFName.of(k))) as PDFObject);
                if (v !== null && v <= alpha) { verdict = true; break; }
              }
              if (verdict) break;
            }
          }
        }
      }

      // تلميح بالاسم داخل تدفّق الكائن
      if (!verdict) {
        const stream = readStream(doc, obj as PDFRawStream);
        if (stream && stream.length < 40000) {
          let s = '';
          for (let i = 0; i < stream.length; i++) s += String.fromCharCode(stream[i]);
          if (looksLikeWatermark(s)) verdict = true;
        }
      }
    }
  } catch { /* تجاهل */ }

  cache.set(num, verdict);
  return verdict;
}

/** وصف عربي مختصر لما تمت إزالته */
export function describeReport(r: WatermarkReport): string {
  const labels: Array<[ReportKey, string]> = [
    ['annots', 'تعليق/ختم'],
    ['layers', 'عنصر في طبقة علامة مائية'],
    ['transparent', 'عنصر شفاف'],
    ['forms', 'كائن علامة مائية'],
    ['images', 'صورة متكررة'],
    ['text', 'كتلة نصية'],
    ['repeated', 'عنصر متكرر'],
  ];
  const parts = labels.filter(([k]) => r[k] > 0).map(([k, l]) => `${r[k]} ${l}`);
  if (!parts.length) return 'لم يُعثر على علامة مائية مطابقة للمعايير المحددة.';
  return 'تمت إزالة: ' + parts.join('، ');
}

export type { Tok };
