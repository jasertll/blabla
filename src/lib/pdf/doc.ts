/**
 * JOSINT · PDF Toolkit — pdf-lib helpers
 * أدوات مساعدة للتعامل مع كائنات PDF منخفضة المستوى
 */

import {
  PDFDocument,
  PDFDict,
  PDFArray,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFStream,
  PDFRef,
  PDFString,
  PDFHexString,
  PDFObject,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';

import { concatStreams } from './stream';

export type AnyDoc = PDFDocument;

export const LOAD_OPTS = {
  ignoreEncryption: true,
  throwOnInvalidObject: false,
  updateMetadata: false,
} as const;

/** تحميل مستند مع تسامح مع الملفات غير المثالية */
export async function loadDoc(bytes: Uint8Array, password?: string): Promise<PDFDocument> {
  const opts: Record<string, unknown> = { ...LOAD_OPTS };
  if (password) opts.password = password;
  return PDFDocument.load(bytes, opts as never);
}

/** نص من PDFString / PDFHexString / PDFName */
export function textOf(obj: PDFObject | undefined): string {
  if (!obj) return '';
  try {
    if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
    if (obj instanceof PDFName) return obj.asString().replace(/^\//, '');
  } catch { /* تجاهل */ }
  try {
    return obj.toString();
  } catch {
    return '';
  }
}

/** رقم من كائن PDF */
export function numOf(obj: PDFObject | undefined): number | null {
  if (obj instanceof PDFNumber) return obj.asNumber();
  return null;
}

/** موارد الصفحة مع مراعاة الوراثة من عقدة Pages الأب */
export function pageResources(doc: PDFDocument, leafIndex: number): PDFDict | undefined {
  const leaf = doc.getPage(leafIndex).node;
  const direct = leaf.Resources();
  if (direct) return direct;
  const inherited = leaf.getInheritableAttribute(PDFName.of('Resources'));
  if (inherited instanceof PDFDict) return inherited;
  if (inherited instanceof PDFRef) {
    const v = doc.context.lookup(inherited);
    if (v instanceof PDFDict) return v;
  }
  return undefined;
}

/** قاموس فرعي داخل الموارد (ExtGState / XObject / Properties / Font) */
export function resourceDict(res: PDFDict | undefined, category: string): PDFDict | undefined {
  if (!res) return undefined;
  const v = res.lookup(PDFName.of(category));
  return v instanceof PDFDict ? v : undefined;
}

/** حل مرجع إلى كائن */
export function deref(doc: PDFDocument, v: PDFObject | undefined): PDFObject | undefined {
  if (!v) return undefined;
  if (v instanceof PDFRef) return doc.context.lookup(v);
  return v;
}

/** رقم الكائن لمرجع داخل قاموس */
export function refNumber(dict: PDFDict | undefined, key: string): number | null {
  if (!dict) return null;
  const raw = dict.get(PDFName.of(key));
  return raw instanceof PDFRef ? raw.objectNumber : null;
}

/** قراءة محتوى الصفحة مفكوك الضغط (قد يكون موزعاً على عدة تدفّقات) */
export function readPageContents(doc: PDFDocument, pageIndex: number): Uint8Array | null {
  const leaf = doc.getPage(pageIndex).node;
  const contents = leaf.Contents();
  if (!contents) return null;

  const parts: Uint8Array[] = [];
  const push = (obj: PDFObject | undefined) => {
    const o = deref(doc, obj);
    if (o instanceof PDFRawStream) {
      try {
        parts.push(decodePDFRawStream(o).decode());
      } catch { /* مرشّح غير مدعوم — نتجاهل هذا الجزء */ }
    } else if (o instanceof PDFStream) {
      try {
        parts.push((o as unknown as { getContents(): Uint8Array }).getContents());
      } catch { /* تجاهل */ }
    }
  };

  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) push(contents.get(i));
  } else {
    push(contents);
  }

  if (!parts.length) return null;
  return concatStreams(parts);
}

/** كتابة محتوى جديد للصفحة كتدفّق واحد مضغوط */
export function writePageContents(doc: PDFDocument, pageIndex: number, bytes: Uint8Array): void {
  const leaf = doc.getPage(pageIndex).node;
  const stream = doc.context.flateStream(bytes);
  const ref = doc.context.register(stream);
  leaf.set(PDFName.of('Contents'), ref);
}

/** قراءة تدفّق أي كائن (مثل Form XObject) */
export function readStream(doc: PDFDocument, ref: PDFRef | PDFObject | undefined): Uint8Array | null {
  const o = deref(doc, ref as PDFObject);
  if (o instanceof PDFRawStream) {
    try {
      return decodePDFRawStream(o).decode();
    } catch {
      return null;
    }
  }
  return null;
}

/** قاموس أي تدفّق */
export function streamDict(obj: PDFObject | undefined): PDFDict | undefined {
  if (obj instanceof PDFRawStream || obj instanceof PDFStream) {
    return (obj as unknown as { dict: PDFDict }).dict;
  }
  if (obj instanceof PDFDict) return obj;
  return undefined;
}

/** أقل شفافية معلنة في حالة رسومية */
export function extGStateAlpha(doc: PDFDocument, res: PDFDict | undefined, name: string): number | null {
  const gsDict = resourceDict(res, 'ExtGState');
  if (!gsDict) return null;
  const entry = deref(doc, gsDict.get(PDFName.of(name)));
  if (!(entry instanceof PDFDict)) return null;
  let a: number | null = null;
  for (const key of ['ca', 'CA']) {
    const v = numOf(deref(doc, entry.get(PDFName.of(key))) as PDFObject);
    if (v !== null) a = a === null ? v : Math.min(a, v);
  }
  return a;
}

/** طبقات المحتوى الاختيارية: رقم الكائن → الاسم */
export function listOCGs(doc: PDFDocument): Map<number, string> {
  const out = new Map<number, string>();
  try {
    const props = deref(doc, doc.catalog.get(PDFName.of('OCProperties')));
    if (!(props instanceof PDFDict)) return out;
    const ocgs = deref(doc, props.get(PDFName.of('OCGs')));
    if (!(ocgs instanceof PDFArray)) return out;
    for (let i = 0; i < ocgs.size(); i++) {
      const raw = ocgs.get(i);
      if (!(raw instanceof PDFRef)) continue;
      const d = doc.context.lookup(raw);
      if (d instanceof PDFDict) {
        out.set(raw.objectNumber, textOf(deref(doc, d.get(PDFName.of('Name')))));
      }
    }
  } catch { /* تجاهل */ }
  return out;
}

/** ضبط رؤية الطبقات في الإعداد الافتراضي */
export function turnOffLayers(doc: PDFDocument, refs: Set<number>): void {
  try {
    const props = deref(doc, doc.catalog.get(PDFName.of('OCProperties')));
    if (!(props instanceof PDFDict)) return;
    const dcfg = deref(doc, props.get(PDFName.of('D')));
    if (!(dcfg instanceof PDFDict)) return;
    const ocgs = deref(doc, props.get(PDFName.of('OCGs')));
    if (!(ocgs instanceof PDFArray)) return;
    const off: PDFRef[] = [];
    for (let i = 0; i < ocgs.size(); i++) {
      const raw = ocgs.get(i);
      if (raw instanceof PDFRef && refs.has(raw.objectNumber)) off.push(raw);
    }
    if (!off.length) return;
    dcfg.set(PDFName.of('OFF'), doc.context.obj(off));
  } catch { /* تجاهل */ }
}

export { PDFDocument };
