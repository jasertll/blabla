/**
 * JOSINT · PDF Toolkit — Tool runner
 * طبقة واحدة تربط الواجهة بالمحرك: كل أداة لها معرّف وخيارات ونتيجة موحّدة.
 */

import {
  mergePdfs, splitPdf, extractPages, deletePages, rotatePdf,
  addPageNumbers, addWatermark, imagesToPdf,
  type NamedFile, type Progress, type SplitMode, type NumberPosition,
} from './tools';
import { protectPdf, unlockPdf } from './security';
import { removeWatermarks, scanWatermarks, describeReport, type WatermarkMode } from './watermark';
import { inspectPdf, extractImages, type ForensicReport } from './forensics';
import { compressSafe, compressStrong, type CompressLevel } from './compress';
import { extractText, renderPages, ocrPdf } from './render';
import { textFile, humanSize } from './zip';

export type ToolId =
  | 'remove-watermark' | 'watermark' | 'protect' | 'unlock'
  | 'merge' | 'split' | 'extract-pages' | 'delete-pages' | 'rotate'
  | 'page-numbers' | 'compress' | 'extract-text' | 'extract-images'
  | 'to-images' | 'images-to-pdf' | 'forensics' | 'ocr';

export interface ToolResult {
  /** ملفات جاهزة للتنزيل */
  files: NamedFile[];
  /** رسالة موجزة عمّا حدث */
  message: string;
  /** نص للعرض المباشر (استخراج نص / OCR) */
  text?: string;
  /** تقرير الفحص الجنائي */
  forensics?: ForensicReport;
  /** تحذير غير مانع */
  warning?: string;
}

export type Options = Record<string, string | number | boolean | undefined>;

const str = (o: Options, k: string, d = '') => String(o[k] ?? d);
const num = (o: Options, k: string, d: number) => {
  const v = Number(o[k]);
  return Number.isFinite(v) ? v : d;
};
const bool = (o: Options, k: string, d = false) => {
  const v = o[k];
  if (v === undefined) return d;
  return v === true || v === 'true' || v === '1';
};

const stem = (name: string) => name.replace(/\.[^.]+$/, '') || 'document';

/** هل تقبل الأداة عدة ملفات؟ */
export const MULTI_TOOLS: ToolId[] = ['merge', 'images-to-pdf'];

/** هل تعمل الأداة على صور بدل PDF؟ */
export const IMAGE_TOOLS: ToolId[] = ['images-to-pdf'];

export async function runTool(
  tool: ToolId,
  files: NamedFile[],
  options: Options = {},
  onProgress: Progress = () => {},
): Promise<ToolResult> {
  if (!files.length) throw new Error('اختر ملفاً أولاً.');
  const first = files[0];
  const base = stem(first.name);

  switch (tool) {
    /* ---------------- إزالة العلامة المائية ---------------- */
    case 'remove-watermark': {
      const mode = str(options, 'mode', 'auto') as WatermarkMode;
      const { bytes, report } = await removeWatermarks(first.bytes, {
        mode,
        text: str(options, 'text'),
        alpha: num(options, 'alpha', 0.7),
        removeImages: bool(options, 'removeImages', true),
        onProgress,
      });
      return {
        files: [{ name: `${base}_بلا-علامة.pdf`, bytes }],
        message: `${describeReport(report)} · ${humanSize(first.bytes.length)} ← ${humanSize(bytes.length)}`,
        warning: report.total === 0
          ? 'لم يُعثر على علامة مائية بهذه المعايير. جرّب وضع «نص محدد» أو «متقدم»، أو ارفع حساسية الشفافية.'
          : undefined,
      };
    }

    /* ---------------- إضافة علامة مائية ---------------- */
    case 'watermark': {
      const bytes = await addWatermark(first.bytes, {
        text: str(options, 'text', 'JOSINT'),
        opacity: num(options, 'opacity', 0.15),
        size: num(options, 'size', 48),
        rotate: num(options, 'rotate', 45),
        color: str(options, 'color', '#3366cc'),
      });
      onProgress(100, 'اكتمل');
      return { files: [{ name: `${base}_علامة-مائية.pdf`, bytes }], message: 'تمت إضافة العلامة المائية على كل الصفحات.' };
    }

    /* ---------------- الحماية ---------------- */
    case 'protect': {
      const bytes = await protectPdf(first.bytes, {
        userPassword: str(options, 'password'),
        ownerPassword: str(options, 'ownerPassword'),
        allowPrinting: bool(options, 'allowPrinting', true),
        allowCopying: bool(options, 'allowCopying', true),
        allowModifying: bool(options, 'allowModifying', false),
      });
      onProgress(100, 'اكتمل');
      return { files: [{ name: `${base}_محمي.pdf`, bytes }], message: 'تم تشفير الملف بكلمة المرور.' };
    }

    case 'unlock': {
      const bytes = await unlockPdf(first.bytes, str(options, 'password'));
      onProgress(100, 'اكتمل');
      return { files: [{ name: `${base}_مفتوح.pdf`, bytes }], message: 'تمت إزالة الحماية.' };
    }

    /* ---------------- عمليات الصفحات ---------------- */
    case 'merge': {
      if (files.length < 2) throw new Error('الدمج يحتاج ملفين على الأقل.');
      const bytes = await mergePdfs(files, onProgress);
      return { files: [{ name: 'مدموج.pdf', bytes }], message: `تم دمج ${files.length} ملفات.` };
    }

    case 'split': {
      const parts = await splitPdf(first.bytes, {
        mode: str(options, 'mode', 'each') as SplitMode,
        ranges: str(options, 'ranges'),
        every: num(options, 'every', 2),
        baseName: base,
      }, onProgress);
      return { files: parts, message: `تم إنتاج ${parts.length} ملف.` };
    }

    case 'extract-pages': {
      const bytes = await extractPages(first.bytes, str(options, 'pages'));
      onProgress(100, 'اكتمل');
      return { files: [{ name: `${base}_مستخرج.pdf`, bytes }], message: 'تم استخراج الصفحات المحددة.' };
    }

    case 'delete-pages': {
      const bytes = await deletePages(first.bytes, str(options, 'pages'));
      onProgress(100, 'اكتمل');
      return { files: [{ name: `${base}_محذوف.pdf`, bytes }], message: 'تم حذف الصفحات المحددة.' };
    }

    case 'rotate': {
      const bytes = await rotatePdf(first.bytes, num(options, 'angle', 90), str(options, 'pages'));
      onProgress(100, 'اكتمل');
      return { files: [{ name: `${base}_مُدار.pdf`, bytes }], message: 'تم تدوير الصفحات.' };
    }

    case 'page-numbers': {
      const bytes = await addPageNumbers(first.bytes, {
        position: str(options, 'position', 'bottom-center') as NumberPosition,
        start: num(options, 'start', 1),
      });
      onProgress(100, 'اكتمل');
      return { files: [{ name: `${base}_مرقّم.pdf`, bytes }], message: 'تمت إضافة أرقام الصفحات.' };
    }

    /* ---------------- الضغط ---------------- */
    case 'compress': {
      const strong = str(options, 'mode', 'safe') === 'strong';
      const level = str(options, 'level', 'medium') as CompressLevel;
      const r = strong
        ? await compressStrong(first.bytes, level, onProgress)
        : await compressSafe(first.bytes, level, onProgress);
      return {
        files: [{ name: `${base}_مضغوط.pdf`, bytes: r.bytes }],
        message: `${humanSize(r.before)} ← ${humanSize(r.after)} (توفير ${r.saved}%)`,
        warning: r.saved <= 0
          ? 'لم يتحقق توفير يُذكر — الملف مضغوط أصلاً أو صوره ليست JPEG. جرّب الوضع القوي.'
          : strong ? 'الوضع القوي حوّل الصفحات إلى صور: النص لم يعد قابلاً للبحث.' : undefined,
      };
    }

    /* ---------------- الاستخراج ---------------- */
    case 'extract-text': {
      const r = await extractText(first.bytes, onProgress);
      const out = r.pages.map((p) => `--- صفحة ${p.page} ---\n${p.text}`).join('\n\n');
      return {
        files: [textFile(`${base}.txt`, out)],
        message: `${r.pages.length} صفحة · ${out.length} حرف`,
        text: out,
        warning: r.empty
          ? 'الملف لا يحتوي نصاً قابلاً للاستخراج — يبدو ممسوحاً ضوئياً. استخدم أداة OCR.'
          : undefined,
      };
    }

    case 'extract-images': {
      const imgs = await extractImages(first.bytes);
      onProgress(100, 'اكتمل');
      if (!imgs.length) throw new Error('لا توجد صور مضمّنة في هذا الملف.');
      return {
        files: imgs.map((i) => ({ name: i.name, bytes: i.bytes })),
        message: `تم استخراج ${imgs.length} صورة.`,
      };
    }

    case 'to-images': {
      const type = str(options, 'format', 'png') === 'jpg' ? 'image/jpeg' : 'image/png';
      const ext = type === 'image/jpeg' ? 'jpg' : 'png';
      const pages = await renderPages(first.bytes, { dpi: num(options, 'dpi', 150), type }, onProgress);
      const out: NamedFile[] = [];
      for (const p of pages) {
        out.push({
          name: `${base}_page_${String(p.page).padStart(4, '0')}.${ext}`,
          bytes: new Uint8Array(await p.blob.arrayBuffer()),
        });
      }
      return { files: out, message: `تم تحويل ${out.length} صفحة إلى صور.` };
    }

    case 'images-to-pdf': {
      const bytes = await imagesToPdf(files, onProgress);
      return { files: [{ name: 'صور.pdf', bytes }], message: `تم تجميع ${files.length} صورة في ملف واحد.` };
    }

    /* ---------------- التحليل ---------------- */
    case 'forensics': {
      onProgress(40, 'تحليل بنية الملف…');
      const rep = await inspectPdf(first.bytes);
      onProgress(100, 'اكتمل');
      const riskLabel: Record<string, string> = {
        info: 'لا مؤشرات خطورة', low: 'خطورة منخفضة',
        medium: 'خطورة متوسطة', high: 'خطورة عالية',
      };
      return {
        files: [textFile(`${base}_تقرير.json`, JSON.stringify(rep, null, 2))],
        message: `PDF ${rep.pdfVersion} · ${rep.pages} صفحة · ${rep.objectCount} كائن · ${riskLabel[rep.risk]}`,
        forensics: rep,
      };
    }

    case 'ocr': {
      const r = await ocrPdf(first.bytes, {
        lang: str(options, 'lang', 'ara+eng'),
        dpi: num(options, 'dpi', 180),
      }, onProgress);
      return {
        files: [textFile(`${base}_ocr.txt`, r.full)],
        message: `تمت قراءة ${r.pages.length} صفحة · ${r.full.length} حرف`,
        text: r.full,
      };
    }

    default:
      throw new Error(`أداة غير معروفة: ${tool}`);
  }
}

/** فحص تمهيدي للعلامات المائية — تستدعيه الواجهة عند اختيار الملف */
export async function preScan(bytes: Uint8Array): Promise<string> {
  const scan = await scanWatermarks(bytes);
  if (scan.candidates.length) return 'تم رصد: ' + scan.candidates.join('، ');
  return 'لم يُرصد نمط علامة مائية معروف. جرّب وضع «نص محدد» أو «الوضع المتقدم».';
}

export { humanSize };
export type { NamedFile, ForensicReport };
