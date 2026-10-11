"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Bug, Upload, Loader2, AlertTriangle, CheckCircle2, XCircle, Info, FileCode, X,
} from "lucide-react";
import {
  compileYaraSource, YaraEngineLoadError,
  type YaraCompileResult, type YaraScanResult,
} from "@/lib/yara/engine";
import { useInvestigation } from "@/contexts/InvestigationContext";

type RulePreset = { label: string; source: string };

const PRESETS: RulePreset[] = [
  {
    label: "نص/hex بسيط",
    source: `rule example_suspicious_string
{
    meta:
        author = "you"
        description = "مثال بسيط — عدّله زي ما بدك"

    strings:
        $a = "powershell -enc" nocase
        $b = { 4D 5A 90 00 }  // MZ header, hex pattern

    condition:
        $a or $b
}`,
  },
  {
    label: "Regex",
    source: `rule example_regex
{
    meta:
        description = "مثال regex — رابط base64-encoded طويل داخل نص"

    strings:
        $b64_blob = /[A-Za-z0-9+\\/]{80,}={0,2}/

    condition:
        $b64_blob
}`,
  },
  {
    label: "ملف PE (pe module)",
    source: `import "pe"

rule example_pe_check
{
    meta:
        description = "مثال وحدة pe — ملف PE حقيقي ببنية Imports معيّنة"

    condition:
        pe.is_pe and pe.number_of_sections > 0
}`,
  },
  {
    label: "هاش معروف (hash module)",
    source: `import "hash"

rule example_known_hash
{
    meta:
        description = "مثال وحدة hash — عدّل القيمة بأي MD5 حقيقي بدك تدوّر عليه"

    condition:
        hash.md5(0, filesize) == "d41d8cd98f00b204e9800998ecf8427e" // MD5 of an empty file
}`,
  },
  {
    label: "إنتروبيا عالية (math module)",
    source: `import "math"

rule example_high_entropy
{
    meta:
        description = "مثال وحدة math — إنتروبيا عالية ممكن تدل على تشفير/ضغط/حمولة معبّأة"

    condition:
        math.entropy(0, filesize) >= 7.0
}`,
  },
];

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file — generous for malware-sample-sized files, bounded to keep WASM scanning snappy
const MAX_FILES = 20;

type ScannedFile = {
  name: string;
  size: number;
  bytes: Uint8Array;
  scanResult: YaraScanResult | null;
  scanError: string | null;
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function YaraTester() {
  const [ruleSource, setRuleSource] = useState(PRESETS[0].source);
  const [files, setFiles] = useState<ScannedFile[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "loading-engine" | "compiling" | "scanning">("idle");
  const [compileErrors, setCompileErrors] = useState<string[] | null>(null);
  const [compileWarnings, setCompileWarnings] = useState<string[]>([]);
  const [engineError, setEngineError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const compiledRef = useRef<(YaraCompileResult & { ok: true }) | null>(null);
  const { incrementSessionCount, addTimelineEvent, setToolAlert } = useInvestigation();

  // The compiled Rules/Scanner objects live in the WASM heap, not JS's
  // GC'd heap — free whatever's currently held whenever it's about to
  // be replaced by a new compile, and on unmount, so repeated edit/test
  // cycles in one session don't leak.
  useEffect(() => {
    return () => {
      compiledRef.current?.dispose();
      compiledRef.current = null;
    };
  }, []);

  async function runTest(targets: { name: string; size: number; bytes: Uint8Array }[]) {
    setCompileErrors(null);
    setCompileWarnings([]);
    setEngineError(null);
    setExpandedIndex(null);

    compiledRef.current?.dispose();
    compiledRef.current = null;

    setStatus("loading-engine");
    const engineTimer = setTimeout(() => setStatus("compiling"), 250);
    let result: YaraCompileResult;
    try {
      result = await compileYaraSource(ruleSource);
    } catch (e) {
      clearTimeout(engineTimer);
      setStatus("idle");
      setEngineError(e instanceof YaraEngineLoadError ? e.message : "صار خطأ غير متوقع بتحميل المحرك.");
      return;
    }
    clearTimeout(engineTimer);

    if (!result.ok) {
      setStatus("idle");
      setCompileErrors(result.errors);
      setCompileWarnings(result.warnings);
      return;
    }

    setCompileWarnings(result.warnings);
    compiledRef.current = result;
    setStatus("scanning");

    let totalMatches = 0;
    const scanned: ScannedFile[] = targets.map((t) => {
      try {
        const scanResult = result.scan(t.bytes);
        totalMatches += scanResult.matches.length;
        return { ...t, scanResult, scanError: null };
      } catch (e) {
        return { ...t, scanResult: null, scanError: e instanceof Error ? e.message : "صار خطأ أثناء الفحص." };
      }
    });
    setFiles(scanned);
    setStatus("idle");

    incrementSessionCount();
    addTimelineEvent({
      tool: "yara",
      label: "YARA scan",
      detail: `${targets.length} ملف — ${totalMatches} تطابق إجمالاً`,
    });
    setToolAlert("yara", totalMatches > 0);
  }

  async function handleFiles(fileList: FileList) {
    const incoming = Array.from(fileList).slice(0, MAX_FILES);
    const oversized = incoming.filter((f) => f.size > MAX_FILE_BYTES);
    if (oversized.length > 0) {
      setEngineError(`${oversized.length} ملف أكبر من الحد المسموح (${fmtBytes(MAX_FILE_BYTES)}) واتجوهل.`);
    }
    const valid = incoming.filter((f) => f.size <= MAX_FILE_BYTES);
    if (valid.length === 0) return;

    const newTargets = await Promise.all(
      valid.map(async (f) => ({ name: f.name, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) }))
    );
    // Adds to whatever's already loaded (matching the drop-zone's own
    // "اسحب ملفات تانية" hint) rather than replacing the batch, capped
    // at MAX_FILES total.
    const merged = [...files, ...newTargets].slice(0, MAX_FILES);
    runTest(merged);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  }

  function retest() {
    if (files.length > 0) runTest(files);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setExpandedIndex(null);
  }

  const busy = status !== "idle";
  const totalMatches = files.reduce((sum, f) => sum + (f.scanResult?.matches.length ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="glass-panel p-4 space-y-3">
        <div>
          <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
            <Bug className="h-4 w-4 text-accent" /> YARA Rule Tester
          </h2>
          <p className="text-xs text-slate-500 max-w-xl">
            محرك YARA-X حقيقي وكامل — مش محاكاة ولا قائمة نصوص مكتوبة مسبقاً (هاد الفرق عن قائمة
            المؤشرات الجاهزة بأداة File Inspector). بتكتب قاعدة YARA حقيقية وبتجرّبها فعلياً على
            ملف أو عدة ملفات: مطابقة نصوص/hex/regex حقيقية، منطق condition حقيقي، ووحدات YARA-X
            المدمجة (pe, hash, math, elf...) — كله محلياً بمتصفحك، بدون ما يترفع أي ملف لأي مكان.
          </p>
        </div>

        <div className="flex gap-1.5 flex-wrap">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setRuleSource(p.source)}
              className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
                ruleSource === p.source
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-border text-slate-400 hover:border-accent/30 hover:text-slate-200"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <textarea
          value={ruleSource}
          onChange={(e) => setRuleSource(e.target.value)}
          spellCheck={false}
          dir="ltr"
          className="w-full h-48 rounded-lg border border-border bg-surface-elevated p-3 text-xs font-mono text-slate-200 resize-y focus:outline-none focus:border-accent/50"
          placeholder="rule my_rule { strings: $a = &quot;...&quot; condition: $a }"
        />

        <div className="flex items-center gap-2">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className="flex-1 border border-dashed border-border rounded-lg py-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-accent/50 transition-colors"
          >
            {busy ? (
              <Loader2 className="h-5 w-5 text-accent animate-spin" />
            ) : (
              <Upload className="h-5 w-5 text-slate-500" />
            )}
            <p className="text-xs text-slate-400">
              {status === "loading-engine"
                ? "جارٍ تحميل محرك YARA-X (أول مرة بس، ~6 م.ب)…"
                : status === "compiling"
                ? "جارٍ تصريف القاعدة…"
                : status === "scanning"
                ? `جارٍ فحص ${files.length} ملف…`
                : files.length > 0
                ? `${files.length} ملف محمّل — اسحب ملفات تانية أو اضغط للإضافة`
                : "اسحب ملف أو عدة ملفات هون أو اضغط للاختيار"}
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {files.length > 0 && (
            <button
              onClick={retest}
              disabled={busy}
              className="shrink-0 px-3 py-2 rounded-lg border border-border text-xs text-slate-300 hover:border-accent/50 hover:text-accent disabled:opacity-40 transition-colors flex items-center gap-1.5 self-stretch"
            >
              <FileCode className="h-3.5 w-3.5" /> أعد الاختبار
            </button>
          )}
        </div>

        {engineError && <p className="text-xs text-red-300 leading-relaxed">{engineError}</p>}
      </div>

      {compileErrors && compileErrors.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="glass-panel p-4 border border-red-500/40 bg-red-500/10 space-y-2">
          <div className="flex items-center gap-2 text-red-300">
            <XCircle className="h-4 w-4" />
            <p className="text-sm font-semibold">فشل تصريف القاعدة — في خطأ حقيقي بصياغة YARA</p>
          </div>
          <div className="space-y-1">
            {compileErrors.map((err, i) => (
              <p key={i} className="text-[11px] font-mono text-red-200/90 break-all" dir="ltr">{err}</p>
            ))}
          </div>
        </motion.div>
      )}

      {compileWarnings.length > 0 && (
        <div className="glass-panel p-3 border border-amber-500/30 bg-amber-500/5 space-y-1">
          <div className="flex items-center gap-2 text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            <p className="text-xs font-semibold">تحذيرات تصريف (القاعدة اشتغلت، بس في ملاحظات)</p>
          </div>
          {compileWarnings.map((w, i) => (
            <p key={i} className="text-[11px] font-mono text-amber-200/80 break-all" dir="ltr">{w}</p>
          ))}
        </div>
      )}

      {files.length > 0 && !busy && !compileErrors && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div
            className={`glass-panel p-4 border flex items-start gap-2.5 ${
              totalMatches > 0 ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {totalMatches > 0 ? <AlertTriangle className="h-5 w-5 shrink-0" /> : <CheckCircle2 className="h-5 w-5 shrink-0" />}
            <p className="text-sm font-semibold">
              {totalMatches > 0
                ? `${totalMatches} تطابق بالمجموع عبر ${files.filter((f) => (f.scanResult?.matches.length ?? 0) > 0).length} من ${files.length} ملف`
                : `ما في أي تطابق بـ${files.length} ملف — القاعدة اشتغلت صح بس ما لقت شي`}
            </p>
          </div>

          <div className="glass-panel divide-y divide-border/50">
            {files.map((f, i) => {
              const matchCount = f.scanResult?.matches.length ?? 0;
              const expanded = expandedIndex === i;
              return (
                <div key={`${f.name}-${i}`}>
                  <button
                    onClick={() => setExpandedIndex(expanded ? null : i)}
                    className="w-full flex items-center justify-between gap-2 p-3 text-left hover:bg-surface-elevated/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {f.scanError ? (
                        <XCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      ) : matchCount > 0 ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      )}
                      <span className="text-xs text-slate-200 truncate" dir="ltr">{f.name}</span>
                      <span className="text-[10px] text-slate-500 shrink-0">{fmtBytes(f.size)}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {f.scanError ? (
                        <span className="text-[10px] text-amber-400">خطأ فحص</span>
                      ) : (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${matchCount > 0 ? "bg-red-500/15 text-red-300" : "bg-emerald-500/10 text-emerald-300"}`}>
                          {matchCount} تطابق
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                        className="text-slate-600 hover:text-red-400 transition-colors"
                        title="إزالة"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </button>

                  {expanded && f.scanResult && (
                    <div className="px-3 pb-3 space-y-2.5">
                      {f.scanResult.matches.length === 0 ? (
                        <p className="text-[11px] text-slate-500">ما في تطابق بهالملف.</p>
                      ) : (
                        f.scanResult.matches.map((m, j) => (
                          <div key={j} className="rounded-lg border border-border/60 bg-surface-elevated/40 p-3 space-y-2">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <p className="text-xs font-semibold text-slate-100 font-mono" dir="ltr">{m.identifier}</p>
                              {m.tags.length > 0 && (
                                <div className="flex gap-1.5 flex-wrap">
                                  {m.tags.map((t) => (
                                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 font-mono">{t}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                            {m.metadata.length > 0 && (
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                                {m.metadata.map((md, k) => (
                                  <span key={k} className="font-mono" dir="ltr">{md.identifier} = {JSON.stringify(md.value)}</span>
                                ))}
                              </div>
                            )}
                            {m.patterns.length > 0 && (
                              <div className="space-y-1 pt-1 border-t border-border/50">
                                {m.patterns.map((p, k) => (
                                  <div key={k} className="text-[11px] font-mono text-slate-400 flex items-center gap-2 flex-wrap" dir="ltr">
                                    <span className="text-slate-300">{p.identifier}</span>
                                    <span className="text-slate-600">({p.kind})</span>
                                    <span className="text-slate-500">
                                      {p.matches.length} match{p.matches.length === 1 ? "" : "es"}:{" "}
                                      {p.matches.slice(0, 5).map((pm) => `offset=${pm.offset} len=${pm.length}`).join(", ")}
                                      {p.matches.length > 5 ? `, +${p.matches.length - 5} more` : ""}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                  {expanded && f.scanError && (
                    <div className="px-3 pb-3">
                      <p className="text-[11px] font-mono text-amber-300 break-all" dir="ltr">{f.scanError}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="glass-panel p-4 flex items-start gap-2.5">
            <Info className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-500 leading-relaxed">
              تطابق قاعدة YARA بيعني الملف فيه النمط اللي وصفتَه بالقاعدة — مش حكم جاهز إنه الملف
              خبيث أو سليم. دقة النتيجة بتعتمد بالكامل عالقاعدة نفسها: قاعدة عامة جداً ممكن تطابق
              ملفات سليمة (false positive)، وقاعدة ضيقة جداً ممكن تفوّت تهديد حقيقي. استخدم النتيجة
              كدليل تتحقق فيه، مش كقرار نهائي.
            </p>
          </div>
        </motion.div>
      )}
    </div>
  );
}
