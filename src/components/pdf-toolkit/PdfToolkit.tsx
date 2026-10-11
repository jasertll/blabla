'use client';

/**
 * JOSINT · PDF Toolkit
 * تبويب أدوات المستندات — كل المعالجة داخل متصفح المستخدم، بلا خادم وبلا رفع.
 *
 * الاستخدام:
 *   import PdfToolkit from '@/components/pdf-toolkit/PdfToolkit';
 *   <PdfToolkit />
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { TOOLS, GROUPS, defaultsFor, type ToolDef, type Field } from './tools.config';
import { runTool, preScan, humanSize, type ToolResult, type Options } from '../../lib/pdf/runner';
import { downloadAll, downloadBytes, mimeFor } from '../../lib/pdf/zip';
import type { NamedFile } from '../../lib/pdf/tools';

interface PickedFile extends NamedFile {
  id: string;
  size: number;
}

type Phase = 'idle' | 'working' | 'done' | 'error';

const RISK_STYLE: Record<string, string> = {
  info: 'bg-slate-500/10 text-slate-300 border-slate-500/30',
  low: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  medium: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  high: 'bg-red-500/10 text-red-300 border-red-500/30',
};

const RISK_LABEL: Record<string, string> = {
  info: 'لا مؤشرات خطورة',
  low: 'خطورة منخفضة',
  medium: 'خطورة متوسطة',
  high: 'خطورة عالية',
};

export default function PdfToolkit() {
  const [tool, setTool] = useState<ToolDef | null>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [opts, setOpts] = useState<Options>({});
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<ToolResult | null>(null);
  const [error, setError] = useState('');
  const [scanHint, setScanHint] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = tool?.accepts === 'image' ? 'image/*' : 'application/pdf,.pdf';

  const openTool = useCallback((t: ToolDef) => {
    setTool(t);
    setFiles([]);
    setOpts(defaultsFor(t));
    setPhase('idle');
    setResult(null);
    setError('');
    setScanHint('');
    setProgress(0);
  }, []);

  const closeTool = useCallback(() => {
    setTool(null);
    setFiles([]);
    setResult(null);
    setError('');
  }, []);

  const addFiles = useCallback(async (list: FileList | File[]) => {
    if (!tool) return;
    const arr = Array.from(list);
    const picked: PickedFile[] = [];
    for (const f of tool.multi ? arr : arr.slice(0, 1)) {
      picked.push({
        id: Math.random().toString(36).slice(2),
        name: f.name,
        size: f.size,
        bytes: new Uint8Array(await f.arrayBuffer()),
      });
    }
    setFiles((prev) => (tool.multi ? [...prev, ...picked] : picked));
    setResult(null);
    setError('');

    if (tool.prescan && picked[0]) {
      setScanHint('جارٍ فحص الملف…');
      try {
        setScanHint(await preScan(picked[0].bytes));
      } catch (e) {
        setScanHint('تعذّر الفحص التمهيدي: ' + (e as Error).message);
      }
    }
  }, [tool]);

  const run = useCallback(async () => {
    if (!tool || !files.length) return;
    setPhase('working');
    setProgress(0);
    setStatus('جارٍ البدء…');
    setError('');
    setResult(null);
    try {
      const res = await runTool(tool.id, files, opts, (p, m) => {
        setProgress(p);
        setStatus(m);
      });
      setResult(res);
      setPhase('done');
      setProgress(100);
    } catch (e) {
      setError((e as Error).message || 'حدث خطأ غير متوقع.');
      setPhase('error');
    }
  }, [tool, files, opts]);

  const visibleFields = useMemo(
    () => (tool?.fields ?? []).filter((f) => !f.showIf || f.showIf(opts as Record<string, unknown>)),
    [tool, opts],
  );

  const canRun = files.length > 0
    && (!tool?.multi || tool.id !== 'merge' || files.length >= 2)
    && phase !== 'working';

  /* ------------------------------------------------------------------ */
  if (!tool) {
    return (
      <div dir="rtl" className="space-y-8">
        <Header />
        {GROUPS.map((group) => (
          <section key={group}>
            <h3 className="mb-3 text-sm font-semibold text-slate-400">{group}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {TOOLS.filter((t) => t.group === group).map((t) => (
                <motion.button
                  key={t.id}
                  onClick={() => openTool(t)}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.985 }}
                  className="group rounded-xl border border-border bg-surface-elevated p-4 text-right
                             transition-colors hover:border-accent/50 hover:bg-surface-high"
                >
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg
                                  border border-border bg-surface-high text-xl">
                    {t.icon}
                  </div>
                  <div className="font-semibold text-slate-100">{t.name}</div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{t.desc}</p>
                </motion.button>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  return (
    <div dir="rtl" className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-100">
          <span className="text-2xl">{tool.icon}</span>
          {tool.name}
        </h2>
        <button
          onClick={closeTool}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-slate-300
                     transition-colors hover:bg-surface-high"
        >
          رجوع
        </button>
      </div>

      {/* منطقة الإفلات */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors
          ${dragging
            ? 'border-accent bg-accent/10'
            : 'border-border bg-surface-elevated hover:border-accent/60'}`}
      >
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={accept}
          multiple={!!tool.multi}
          onChange={(e) => { if (e.target.files?.length) void addFiles(e.target.files); e.target.value = ''; }}
        />
        <p className="text-sm text-slate-300">
          {tool.multi ? 'اسحب الملفات هنا' : 'اسحب الملف هنا'} أو{' '}
          <span className="font-semibold text-accent-glow underline underline-offset-4">اختر من الجهاز</span>
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {tool.accepts === 'image' ? 'صور فقط' : 'ملفات PDF'} · لا يُرفع أي ملف — كل شيء داخل متصفحك
        </p>
      </div>

      {/* الملفات المختارة */}
      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface-elevated px-3 py-2"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-high text-xs
                               font-bold text-accent-glow">
                {(f.name.split('.').pop() ?? '?').toUpperCase().slice(0, 4)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{f.name}</span>
              <span className="shrink-0 text-xs text-slate-500">{humanSize(f.size)}</span>
              <button
                onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))}
                className="shrink-0 rounded-md px-2 text-slate-500 transition-colors hover:text-red-400"
                aria-label="إزالة"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* الخيارات */}
      {visibleFields.length > 0 && (
        <div className="grid gap-4 rounded-xl border border-border bg-surface-elevated p-4 sm:grid-cols-2">
          {visibleFields.map((f) => (
            <FieldInput key={f.key} field={f} value={opts[f.key]} onChange={(v) => setOpts((o) => ({ ...o, [f.key]: v }))} />
          ))}
        </div>
      )}

      {/* الفحص التمهيدي */}
      {tool.prescan && scanHint && (
        <p className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs text-slate-300">
          🔎 {scanHint}
        </p>
      )}

      {/* التنفيذ */}
      <button
        onClick={run}
        disabled={!canRun}
        className="w-full rounded-xl bg-gradient-to-l from-accent-violet to-accent px-5 py-3 font-semibold
                   text-white shadow-lg shadow-accent/20 transition
                   enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {phase === 'working' ? 'جارٍ التنفيذ…' : `تنفيذ: ${tool.name}`}
      </button>

      {/* التقدم */}
      <AnimatePresence>
        {phase === 'working' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="h-2 overflow-hidden rounded-full bg-surface-high">
              <motion.div
                className="h-full rounded-full bg-gradient-to-l from-accent-violet to-accent-glow"
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.25 }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-400">{progress}% — {status}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* الخطأ */}
      {phase === 'error' && error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* النتيجة */}
      <AnimatePresence>
        {phase === 'done' && result && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4"
          >
            <p className="text-sm font-medium text-emerald-200">✅ {result.message}</p>

            {result.warning && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {result.warning}
              </p>
            )}

            {result.forensics && <ForensicPanel report={result.forensics} />}

            {result.text !== undefined && (
              <textarea
                readOnly
                dir="auto"
                value={result.text.slice(0, 20000)}
                className="h-56 w-full resize-y rounded-lg border border-border bg-surface p-3
                           font-mono text-xs text-slate-200"
              />
            )}

            {result.files.length > 0 && (
              <div className="space-y-2">
                {result.files.slice(0, 12).map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-lg bg-surface-elevated px-3 py-2 text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate text-slate-200">{f.name}</span>
                    <span className="shrink-0 text-slate-500">{humanSize(f.bytes.length)}</span>
                    <button
                      onClick={() => downloadBytes(f.bytes, f.name, mimeFor(f.name))}
                      className="shrink-0 font-semibold text-accent-glow hover:underline"
                    >
                      تنزيل
                    </button>
                  </div>
                ))}
                {result.files.length > 12 && (
                  <p className="text-xs text-slate-500">و{result.files.length - 12} ملفاً آخر…</p>
                )}
                <button
                  onClick={() => void downloadAll(result.files, 'josint-pdf.zip')}
                  className="w-full rounded-lg border border-accent/40 bg-accent/10 px-4 py-2
                             text-sm font-semibold text-accent-glow transition hover:bg-accent/20"
                >
                  ⬇ تنزيل الكل{result.files.length > 1 ? ` (${result.files.length} ملفات ZIP)` : ''}
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------------------------------------------- */
function Header() {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <h2 className="text-lg font-bold text-slate-100">أدوات المستندات</h2>
      <p className="mt-1 text-sm text-slate-400">
        معالجة كاملة داخل متصفحك — لا يُرفع أي ملف إلى أي خادم، ولا يحتاج أي مفتاح.
      </p>
    </div>
  );
}

function FieldInput({
  field, value, onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (v: string | boolean | number) => void;
}) {
  const base = 'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm '
    + 'text-slate-100 outline-none transition focus:border-accent';

  if (field.kind === 'note') {
    return (
      <p className="sm:col-span-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2
                    text-xs leading-relaxed text-amber-200">
        {field.label}
      </p>
    );
  }

  if (field.kind === 'checkbox') {
    return (
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        {field.label}
      </label>
    );
  }

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{field.label}</span>
      {field.kind === 'select' ? (
        <select className={base} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map(([v, l]) => (
            <option key={v} value={v} className="bg-surface">{l}</option>
          ))}
        </select>
      ) : (
        <input
          className={base}
          type={field.kind === 'password' ? 'password' : field.kind === 'number' ? 'number' : 'text'}
          min={field.min}
          max={field.max}
          placeholder={field.placeholder}
          value={String(value ?? '')}
          onChange={(e) => onChange(field.kind === 'number' ? Number(e.target.value) : e.target.value)}
        />
      )}
    </label>
  );
}

function ForensicPanel({ report }: { report: NonNullable<ToolResult['forensics']> }) {
  const rows: Array<[string, string]> = [
    ['إصدار PDF', report.pdfVersion],
    ['الصفحات', String(report.pages)],
    ['عدد الكائنات', String(report.objectCount)],
    ['الحجم', humanSize(report.fileSize)],
    ['العنوان', report.metadata.title || '—'],
    ['المؤلف', report.metadata.author || '—'],
    ['أداة الإنشاء', report.metadata.creator || '—'],
    ['المنتِج', report.metadata.producer || '—'],
    ['تاريخ الإنشاء', report.metadata.creationDate || '—'],
    ['آخر تعديل', report.metadata.modificationDate || '—'],
  ];

  return (
    <div className="space-y-3">
      <div className={`inline-flex rounded-lg border px-3 py-1 text-xs font-semibold ${RISK_STYLE[report.risk]}`}>
        {RISK_LABEL[report.risk]}
      </div>

      <dl className="grid gap-x-4 gap-y-1 rounded-lg bg-surface-elevated p-3 text-xs sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="shrink-0 text-slate-500">{k}:</dt>
            <dd className="min-w-0 truncate text-slate-200" title={v}>{v}</dd>
          </div>
        ))}
      </dl>

      {report.indicators.length > 0 && (
        <ul className="space-y-1.5">
          {report.indicators.map((ind) => (
            <li key={ind.key} className={`rounded-lg border px-3 py-2 text-xs ${RISK_STYLE[ind.level]}`}>
              <span className="font-semibold">{ind.label}</span>
              {ind.count > 1 && <span className="opacity-70"> ×{ind.count}</span>}
              <p className="mt-0.5 opacity-80">{ind.detail}</p>
            </li>
          ))}
        </ul>
      )}

      {report.urls.length > 0 && (
        <details className="rounded-lg bg-surface-elevated p-3 text-xs">
          <summary className="cursor-pointer text-slate-300">الروابط داخل الملف ({report.urls.length})</summary>
          <ul className="mt-2 space-y-1" dir="ltr">
            {report.urls.slice(0, 50).map((u, i) => (
              <li key={i} className="break-all font-mono text-slate-400">{u}</li>
            ))}
          </ul>
        </details>
      )}

      {report.embeddedFiles.length > 0 && (
        <details className="rounded-lg bg-surface-elevated p-3 text-xs">
          <summary className="cursor-pointer text-slate-300">
            ملفات مرفقة ({report.embeddedFiles.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {report.embeddedFiles.map((f, i) => (
              <li key={i} className="break-all text-slate-400">{f}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
