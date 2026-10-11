/**
 * JOSINT · PDF Toolkit — Encryption
 * الحماية بكلمة مرور وفك الحماية — داخل المتصفح بالكامل
 */

import { PDFDocument } from '@cantoo/pdf-lib';
import { loadDoc } from './doc';

export interface ProtectOptions {
  userPassword: string;
  ownerPassword?: string;
  /** السماح بالطباعة */
  allowPrinting?: boolean;
  /** السماح بنسخ النص */
  allowCopying?: boolean;
  /** السماح بالتعديل */
  allowModifying?: boolean;
  /** السماح بالتعليقات */
  allowAnnotating?: boolean;
}

/** هل الملف محمي بكلمة مرور؟ */
export async function isEncrypted(bytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
      updateMetadata: false,
    });
    return doc.isEncrypted;
  } catch {
    return true;
  }
}

/** تشفير الملف بكلمة مرور */
export async function protectPdf(bytes: Uint8Array, opts: ProtectOptions): Promise<Uint8Array> {
  const pw = (opts.userPassword ?? '').trim();
  if (!pw) throw new Error('أدخل كلمة المرور.');

  const doc = await loadDoc(bytes);
  doc.encrypt({
    userPassword: pw,
    ownerPassword: (opts.ownerPassword ?? '').trim() || pw,
    permissions: {
      printing: opts.allowPrinting === false ? undefined : 'highResolution',
      copying: opts.allowCopying === false ? undefined : true,
      modifying: opts.allowModifying === false ? undefined : true,
      annotating: opts.allowAnnotating === false ? undefined : true,
    },
  } as never);
  return doc.save({ useObjectStreams: false });
}

/**
 * إزالة الحماية.
 * يغطي حالتين: ملف بكلمة مرور مستخدم (نحتاجها)، وملف بقيود المالك فقط
 * (شائع جداً — لا يحتاج كلمة مرور أصلاً).
 */
export async function unlockPdf(bytes: Uint8Array, password = ''): Promise<Uint8Array> {
  let src: PDFDocument;
  try {
    src = await loadDoc(bytes, password || undefined);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/password|encrypt/i.test(msg)) {
      throw new Error(password
        ? 'كلمة المرور غير صحيحة.'
        : 'هذا الملف محمي بكلمة مرور — أدخلها للمتابعة.');
    }
    throw e;
  }

  // إعادة بناء المستند بلا تشفير
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, src.getPageIndices());
  pages.forEach((p) => out.addPage(p));

  try {
    const t = src.getTitle(); if (t) out.setTitle(t);
    const a = src.getAuthor(); if (a) out.setAuthor(a);
    const s = src.getSubject(); if (s) out.setSubject(s);
  } catch { /* بيانات وصفية اختيارية */ }

  return out.save({ useObjectStreams: true });
}
