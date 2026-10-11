/**
 * JOSINT · PDF Toolkit — Packaging & download helpers
 * تجميع النتائج وتنزيلها — كل شيء داخل المتصفح
 */

import type { NamedFile } from './tools';

/** ضغط عدة ملفات في أرشيف ZIP مع منع تكرار الأسماء */
export async function zipFiles(files: NamedFile[]): Promise<Uint8Array> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const used = new Map<string, number>();

  for (const f of files) {
    let name = f.name;
    const count = used.get(name);
    if (count !== undefined) {
      used.set(name, count + 1);
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      name = `${stem}_${count + 1}${ext}`;
    } else {
      used.set(name, 1);
    }
    zip.file(name, f.bytes as unknown as ArrayBuffer);
  }

  const blob = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return blob as Uint8Array;
}

/** تنزيل ملف واحد من المتصفح */
export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/pdf'): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** تنزيل مجموعة ملفات: ملف واحد مباشرةً، أو ZIP إن تعددت */
export async function downloadAll(files: NamedFile[], zipName = 'josint-pdf.zip'): Promise<void> {
  if (!files.length) return;
  if (files.length === 1) {
    downloadBytes(files[0].bytes, files[0].name, mimeFor(files[0].name));
    return;
  }
  const zipped = await zipFiles(files);
  downloadBytes(zipped, zipName, 'application/zip');
}

export function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    jp2: 'image/jp2',
    txt: 'text/plain;charset=utf-8',
    json: 'application/json;charset=utf-8',
    csv: 'text/csv;charset=utf-8',
    zip: 'application/zip',
  };
  return map[ext] ?? 'application/octet-stream';
}

/** تحويل نص إلى ملف قابل للتنزيل */
export function textFile(name: string, content: string): NamedFile {
  return { name, bytes: new TextEncoder().encode(content) };
}

export function humanSize(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${u[i]}`;
}
