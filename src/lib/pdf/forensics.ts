/**
 * JOSINT · PDF Toolkit — Metadata & forensic triage
 * فحص جنائي أوّلي لملفات PDF — بيانات وصفية ومؤشرات خطورة
 *
 * مصمّم لسياق التحقيق: يكشف ما يجعل ملف PDF مشبوهاً — سكربتات مضمّنة،
 * إجراءات تلقائية عند الفتح، ملفات مرفقة، روابط خارجية، ونماذج ترسل بيانات.
 */

import {
  PDFDict,
  PDFArray,
  PDFName,
  PDFRawStream,
  PDFObject,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';

import { loadDoc, deref, textOf, streamDict } from './doc';

export type RiskLevel = 'info' | 'low' | 'medium' | 'high';

export interface Indicator {
  key: string;
  label: string;
  level: RiskLevel;
  detail: string;
  count: number;
}

export interface PdfMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  creationDate: string;
  modificationDate: string;
}

export interface ForensicReport {
  pages: number;
  encrypted: boolean;
  fileSize: number;
  pdfVersion: string;
  objectCount: number;
  metadata: PdfMetadata;
  indicators: Indicator[];
  urls: string[];
  embeddedFiles: string[];
  fonts: string[];
  /** أعلى مستوى خطورة وُجد */
  risk: RiskLevel;
}

const RISK_ORDER: RiskLevel[] = ['info', 'low', 'medium', 'high'];

/** استخراج البيانات الوصفية والمؤشرات الجنائية */
export async function inspectPdf(bytes: Uint8Array): Promise<ForensicReport> {
  const doc = await loadDoc(bytes);
  const ctx = doc.context;

  const header = new TextDecoder('latin1').decode(bytes.subarray(0, 16));
  const versionMatch = /%PDF-(\d\.\d)/.exec(header);

  const info: PdfMetadata = {
    title: safe(() => doc.getTitle() ?? ''),
    author: safe(() => doc.getAuthor() ?? ''),
    subject: safe(() => doc.getSubject() ?? ''),
    keywords: safe(() => (doc.getKeywords() ?? '')),
    creator: safe(() => doc.getCreator() ?? ''),
    producer: safe(() => doc.getProducer() ?? ''),
    creationDate: safe(() => fmtDate(doc.getCreationDate())),
    modificationDate: safe(() => fmtDate(doc.getModificationDate())),
  };

  const counters: Record<string, number> = {};
  const urls = new Set<string>();
  const embedded = new Set<string>();
  const fonts = new Set<string>();
  let objectCount = 0;

  const bump = (k: string, by = 1) => { counters[k] = (counters[k] ?? 0) + by; };

  /*
   * نمسح كل كائن غير مباشر، وننزل داخل القواميس والمصفوفات المضمّنة أيضاً.
   * السبب: كثير من المؤشرات (مثل /A << /S /URI /URI (...) >> داخل رابط)
   * تعيش في قواميس مضمّنة لا تظهر ككائنات مستقلة في التعداد.
   */
  const scanDict = (dict: PDFDict, depth: number): void => {
    if (depth > 6) return;

    for (const [keyName, value] of dict.entries()) {
      const key = keyName.asString().replace(/^\//, '');
      const val = deref(doc, value);

      switch (key) {
        case 'JS':
          bump('javascript');
          break;
        case 'Launch':
          bump('launch');
          break;
        case 'EmbeddedFile':
        case 'EmbeddedFiles':
          bump('embedded');
          break;
        case 'RichMedia':
        case 'Movie':
        case 'Sound':
          bump('media');
          break;
        case 'GoToR':
          bump('remoteGoto');
          break;
        case 'URI': {
          const u = textOf(val as PDFObject);
          if (u) { urls.add(u); bump('uri'); }
          break;
        }
        case 'F':
          if (dict.has(PDFName.of('EF')) || textOf(dict.get(PDFName.of('Type'))) === 'Filespec') {
            const fname = textOf(val as PDFObject);
            if (fname) embedded.add(fname);
          }
          break;
        case 'UF': {
          const fname = textOf(val as PDFObject);
          if (fname) embedded.add(fname);
          break;
        }
        case 'BaseFont': {
          const f = textOf(val as PDFObject);
          if (f) fonts.add(f.replace(/^[A-Z]{6}\+/, ''));
          break;
        }
        default:
          break;
      }

      // نوع الإجراء داخل قواميس الإجراءات
      if (key === 'S') classifyAction(textOf(val as PDFObject), bump);

      // النزول داخل القيم المضمّنة فقط — المراجع تُمسح في التعداد أصلاً
      if (value instanceof PDFDict) {
        scanDict(value, depth + 1);
      } else if (value instanceof PDFArray) {
        for (let i = 0; i < value.size(); i++) {
          const item = value.get(i);
          if (item instanceof PDFDict) scanDict(item, depth + 1);
        }
      }
    }
  };

  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    objectCount++;
    const dict = obj instanceof PDFDict ? obj : streamDict(obj);
    if (dict) scanDict(dict, 0);
  }

  /*
   * OpenAction و AA يحتاجان فحصاً دقيقاً:
   * القيمة الشائعة جداً هي مصفوفة وجهة ("افتح على الصفحة الأولى") وهي بريئة
   * تماماً — تصنيفها تهديداً يُغرق المحلل بإنذارات كاذبة. الخطر يكون فقط
   * حين تكون القيمة قاموس إجراء نوعه JavaScript أو Launch أو ما شابه.
   */
  try {
    inspectActionSlot(doc, doc.catalog.get(PDFName.of('OpenAction')), bump, 'openAction');

    const aa = deref(doc, doc.catalog.get(PDFName.of('AA')));
    if (aa instanceof PDFDict) {
      for (const [, v] of aa.entries()) inspectActionSlot(doc, v, bump, 'autoAction');
    }

    const acro = deref(doc, doc.catalog.get(PDFName.of('AcroForm')));
    if (acro instanceof PDFDict) bump('acroForm');

    const names = deref(doc, doc.catalog.get(PDFName.of('Names')));
    if (names instanceof PDFDict) {
      if (names.has(PDFName.of('EmbeddedFiles'))) bump('embedded');
      // جافاسكربت على مستوى المستند
      if (names.has(PDFName.of('JavaScript'))) bump('javascript');
    }
  } catch { /* تجاهل */ }

  const indicators: Indicator[] = [];
  const add = (key: string, label: string, level: RiskLevel, detail: string) => {
    const count = counters[key] ?? 0;
    if (count > 0) indicators.push({ key, label, level, detail, count });
  };

  add('javascript', 'جافاسكربت مضمّن', 'high',
    'الملف يحتوي كوداً ينفَّذ داخل قارئ PDF — ناقل شائع للبرمجيات الخبيثة.');
  add('openAction', 'إجراء تنفيذي عند الفتح', 'high',
    'ينفّذ أمراً بمجرد فتح الملف بدون تفاعل المستخدم '
    + '(الانتقال إلى صفحة معيّنة لا يُحتسب هنا).');
  add('autoAction', 'إجراءات تلقائية إضافية', 'medium',
    'إجراءات تنفيذية مرتبطة بأحداث مثل تغيير الصفحة أو الخروج.');
  add('launch', 'أمر تشغيل خارجي (Launch)', 'high',
    'يحاول تشغيل ملف أو أمر على النظام.');
  add('embedded', 'ملفات مرفقة داخل الملف', 'medium',
    'قد تخفي حمولة قابلة للتنفيذ.');
  add('submitForm', 'نموذج يرسل بيانات', 'medium',
    'قد يسرّب مدخلات المستخدم إلى خادم خارجي.');
  add('remoteGoto', 'انتقال إلى مستند خارجي', 'low',
    'يفتح ملفاً من مصدر خارجي.');
  add('media', 'وسائط مضمّنة', 'low',
    'محتوى صوتي أو مرئي أو RichMedia.');
  add('uri', 'روابط خارجية', 'info',
    'روابط ضمن الملف — راجعها في القائمة أدناه.');
  add('acroForm', 'نموذج تفاعلي', 'info',
    'الملف يحتوي حقول إدخال.');

  if (doc.isEncrypted) {
    indicators.push({
      key: 'encrypted', label: 'الملف مشفّر', level: 'low', count: 1,
      detail: 'محمي بكلمة مرور أو بقيود صلاحيات.',
    });
  }

  let risk: RiskLevel = 'info';
  for (const ind of indicators) {
    if (RISK_ORDER.indexOf(ind.level) > RISK_ORDER.indexOf(risk)) risk = ind.level;
  }

  return {
    pages: doc.getPageCount(),
    encrypted: doc.isEncrypted,
    fileSize: bytes.length,
    pdfVersion: versionMatch ? versionMatch[1] : 'غير معروف',
    objectCount,
    metadata: info,
    indicators,
    urls: [...urls].slice(0, 200),
    embeddedFiles: [...embedded].slice(0, 100),
    fonts: [...fonts].slice(0, 100),
    risk,
  };
}

type Bump = (key: string, by?: number) => void;

/** أنواع الإجراءات التي تُعدّ تنفيذية (وليست مجرد تنقّل داخل المستند) */
const EXECUTABLE_ACTIONS = new Set([
  'JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'GoToR', 'GoToE', 'Rendition',
]);

function classifyAction(action: string, bump: Bump): void {
  if (!action) return;
  switch (action) {
    case 'JavaScript': bump('javascript'); break;
    case 'Launch': bump('launch'); break;
    case 'SubmitForm': bump('submitForm'); break;
    case 'ImportData': bump('submitForm'); break;
    case 'GoToR':
    case 'GoToE': bump('remoteGoto'); break;
    case 'Rendition': bump('media'); break;
    default: break;      // GoTo / URI / Named وغيرها ليست تنفيذية
  }
}

/**
 * يفحص خانة إجراء (OpenAction أو أحد إدخالات AA).
 * مصفوفة = وجهة تنقّل بريئة. قاموس = إجراء، نفحص نوعه.
 */
function inspectActionSlot(
  doc: Awaited<ReturnType<typeof loadDoc>>,
  raw: PDFObject | undefined,
  bump: Bump,
  slotKey: string,
): void {
  const val = deref(doc, raw);
  if (!val || val instanceof PDFArray) return;      // وجهة تنقّل — بريئة
  if (!(val instanceof PDFDict)) return;

  const action = textOf(deref(doc, val.get(PDFName.of('S'))) as PDFObject);
  if (EXECUTABLE_ACTIONS.has(action)) {
    bump(slotKey);
    classifyAction(action, bump);
  }

  // إجراءات متسلسلة عبر /Next
  const next = deref(doc, val.get(PDFName.of('Next')));
  if (next instanceof PDFDict) {
    const na = textOf(deref(doc, next.get(PDFName.of('S'))) as PDFObject);
    if (EXECUTABLE_ACTIONS.has(na)) { bump(slotKey); classifyAction(na, bump); }
  }
}

/** استخراج الصور المضمّنة (JPEG مباشرة، والباقي عبر المتصفح) */
export async function extractImages(
  bytes: Uint8Array,
): Promise<Array<{ name: string; bytes: Uint8Array; type: string }>> {
  const doc = await loadDoc(bytes);
  const out: Array<{ name: string; bytes: Uint8Array; type: string }> = [];
  const seen = new Set<number>();

  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (textOf(dict.get(PDFName.of('Subtype'))) !== 'Image') continue;
    if (seen.has(ref.objectNumber)) continue;
    seen.add(ref.objectNumber);

    const filter = filterNames(dict);
    const num = ref.objectNumber;

    if (filter.includes('DCTDecode')) {
      out.push({ name: `image_${num}.jpg`, bytes: obj.asUint8Array(), type: 'image/jpeg' });
    } else if (filter.includes('JPXDecode')) {
      out.push({ name: `image_${num}.jp2`, bytes: obj.asUint8Array(), type: 'image/jp2' });
    } else {
      // بيانات نقطية خام — نبنيها كصورة PNG في المتصفح
      const png = await rawToPng(obj, doc);
      if (png) out.push({ name: `image_${num}.png`, bytes: png, type: 'image/png' });
    }
  }
  return out;
}

function filterNames(dict: PDFDict): string[] {
  const f = dict.get(PDFName.of('Filter'));
  if (f instanceof PDFName) return [f.asString().replace(/^\//, '')];
  if (f instanceof PDFArray) {
    const out: string[] = [];
    for (let i = 0; i < f.size(); i++) {
      const v = f.get(i);
      if (v instanceof PDFName) out.push(v.asString().replace(/^\//, ''));
    }
    return out;
  }
  return [];
}

async function rawToPng(stream: PDFRawStream, doc: Awaited<ReturnType<typeof loadDoc>>): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return null;
  try {
    const dict = stream.dict;
    const width = numberAt(dict, 'Width');
    const height = numberAt(dict, 'Height');
    const bpc = numberAt(dict, 'BitsPerComponent') ?? 8;
    if (!width || !height || bpc !== 8) return null;

    const cs = textOf(deref(doc, dict.get(PDFName.of('ColorSpace'))) as PDFObject);
    const comps = cs.includes('Gray') ? 1 : cs.includes('CMYK') ? 4 : 3;
    if (comps === 4) return null;

    const data = decodePDFRawStream(stream).decode();
    if (data.length < width * height * comps) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(width, height);
    for (let i = 0, p = 0; i < width * height; i++) {
      if (comps === 1) {
        const g = data[i];
        img.data[p++] = g; img.data[p++] = g; img.data[p++] = g; img.data[p++] = 255;
      } else {
        img.data[p++] = data[i * 3];
        img.data[p++] = data[i * 3 + 1];
        img.data[p++] = data[i * 3 + 2];
        img.data[p++] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

function numberAt(dict: PDFDict, key: string): number | null {
  const v = dict.get(PDFName.of(key));
  const n = (v as unknown as { asNumber?: () => number })?.asNumber;
  return typeof n === 'function' ? n.call(v) : null;
}

function fmtDate(d: Date | undefined): string {
  if (!d) return '';
  try { return d.toISOString().replace('T', ' ').slice(0, 19); } catch { return ''; }
}

function safe<T>(fn: () => T): T | '' {
  try { return fn(); } catch { return ''; }
}
