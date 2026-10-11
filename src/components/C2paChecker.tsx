"use client";

import { useRef, useState, type ReactElement } from "react";
import { motion } from "framer-motion";
import {
  BadgeCheck, Upload, Loader2, ShieldCheck, ShieldAlert, ShieldQuestion, Info,
  ChevronDown, ChevronUp, ImageIcon,
} from "lucide-react";
import { verifyC2pa, type C2paVerification } from "@/lib/c2pa/verify";
import type { ValidationStatus, Action, Ingredient } from "@contentauth/c2pa-types";
import { useInvestigation } from "@/contexts/InvestigationContext";

const ACTION_LABEL_AR: Record<string, string> = {
  "c2pa.created": "أُنشئ",
  "c2pa.opened": "فُتح للتحرير",
  "c2pa.placed": "أُدرج عنصر بداخله",
  "c2pa.removed": "أُزيل عنصر منه",
  "c2pa.repackaged": "أُعيدت تغليفته",
  "c2pa.transcoded": "أُعيد ترميزه",
  "c2pa.edited": "عُدّل",
  "c2pa.color_adjustments": "عُدّلت ألوانه",
  "c2pa.converted": "حُوّلت صيغته",
  "c2pa.cropped": "قُصّ",
  "c2pa.filtered": "طُبّق عليه فلتر",
  "c2pa.published": "نُشر",
  "c2pa.resized": "غُيّر حجمه",
  "c2pa.watermarked": "أُضيفت له علامة مائية",
  "c2pa.redacted": "حُجب جزء منه",
  "c2pa.drawing": "رُسم/عُدّل يدوياً",
  "c2pa.produced": "أُنتج",
  "c2pa.managed": "أُدير عبر أداة",
};

const VERDICT: Record<
  "trusted" | "valid" | "invalid" | "none",
  { border: string; bg: string; text: string; icon: ReactElement; label: string }
> = {
  trusted: {
    border: "border-emerald-500/40", bg: "bg-emerald-500/10", text: "text-emerald-300",
    icon: <ShieldCheck className="h-5 w-5" />, label: "موثّق — التوقيع صحيح والموقِّع بقائمة الثقة",
  },
  valid: {
    border: "border-sky-500/40", bg: "bg-sky-500/10", text: "text-sky-300",
    icon: <ShieldCheck className="h-5 w-5" />, label: "التوقيع صحيح — بس الموقِّع مش بقائمة الثقة الافتراضية",
  },
  invalid: {
    border: "border-red-500/40", bg: "bg-red-500/10", text: "text-red-300",
    icon: <ShieldAlert className="h-5 w-5" />, label: "فشل التحقق — البيانات اتعدّلت بعد التوقيع أو التوقيع تالف",
  },
  none: {
    border: "border-border", bg: "bg-surface-elevated", text: "text-slate-400",
    icon: <ShieldQuestion className="h-5 w-5" />, label: "ما في بصمة C2PA بهالملف",
  },
};

function verdictKey(v: C2paVerification): keyof typeof VERDICT {
  if (!v.present) return "none";
  if (v.validationState === "Trusted") return "trusted";
  if (v.validationState === "Valid") return "valid";
  return "invalid";
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function softwareAgentName(a: Action): string | null {
  const agent = a.softwareAgent;
  if (!agent) return null;
  if (typeof agent === "string") return agent;
  return [agent.name, agent.version].filter(Boolean).join(" ");
}

function bucketStatus(v: C2paVerification): { success: ValidationStatus[]; informational: ValidationStatus[]; failure: ValidationStatus[] } {
  const flat = v.validationStatus;
  const success = flat.filter((s) => s.success === true);
  const failure = flat.filter((s) => s.success === false);
  const informational = flat.filter((s) => s.success == null);
  return { success, informational, failure };
}

export default function C2paChecker() {
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<"engine" | "verifying" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number } | null>(null);
  const [result, setResult] = useState<C2paVerification | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { incrementSessionCount, addTimelineEvent } = useInvestigation();

  async function handleFile(file: File) {
    setLoading(true);
    setLoadingStage("engine");
    setError(null);
    setResult(null);
    setShowDetails(false);
    try {
      const engineTimer = setTimeout(() => setLoadingStage("verifying"), 300);
      const res = await verifyC2pa(file);
      clearTimeout(engineTimer);
      if (res.error) {
        setError(res.error);
      } else {
        setResult(res);
        setFileInfo({ name: file.name, size: file.size });
        incrementSessionCount();
        addTimelineEvent({
          tool: "c2pa",
          label: "C2PA verification",
          detail: `${file.name} — ${VERDICT[verdictKey(res)].label}`,
        });
      }
    } catch {
      setError("صار خطأ غير متوقع أثناء الفحص.");
    } finally {
      setLoading(false);
      setLoadingStage(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  const verdict = result ? VERDICT[verdictKey(result)] : null;
  const buckets = result ? bucketStatus(result) : null;
  const ingredients: Ingredient[] = result?.manifest?.ingredients ?? [];
  const doNotTrain = (result?.manifest?.assertions ?? []).some(
    (a) => a.label === "c2pa.training-mining" || a.label === "cawg.training-mining" || a.label?.includes("training-mining")
  );

  return (
    <div className="space-y-4">
      <div className="glass-panel p-4 space-y-4">
        <div>
          <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-accent" /> Content Credentials (C2PA) Checker
          </h2>
          <p className="text-xs text-slate-500 max-w-xl">
            تحقق حقيقي وكامل — مش مجرد فحص وجود. بيستخدم محرّك C2PA الرسمي (نفس اللي وراء
            contentcredentials.org/verify) عشان يتحقق من التوقيع الرقمي فعلياً، يتأكد إنه ما في
            تلاعب بالبيانات بعد التوقيع، ويفحص هوية الموقِّع مقابل قائمة الثقة الرسمية — كل هذا
            محلياً بمتصفحك، بدون ما يترفع الملف لأي مكان.
          </p>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="border border-dashed border-border rounded-lg py-8 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-accent/50 transition-colors"
        >
          {loading ? (
            <Loader2 className="h-5 w-5 text-accent animate-spin" />
          ) : (
            <Upload className="h-5 w-5 text-slate-500" />
          )}
          <p className="text-xs text-slate-400">
            {loading
              ? loadingStage === "engine"
                ? "جارٍ تحميل محرك التحقق (أول مرة بس، ~8 م.ب)…"
                : "جارٍ التحقق من التوقيع…"
              : "اسحب صورة أو فيديو هون أو اضغط للاختيار"}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/*,audio/*,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
        </div>

        {error && <p className="text-xs text-red-300 leading-relaxed">{error}</p>}
      </div>

      {result && verdict && fileInfo && !loading && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className={`glass-panel p-4 border ${verdict.border} ${verdict.bg}`}>
            <div className={`flex items-start gap-2.5 ${verdict.text}`}>
              {verdict.icon}
              <div className="min-w-0">
                <p className="text-sm font-semibold">{verdict.label}</p>
                <p className="text-[11px] text-slate-500 mt-0.5 break-all">
                  {fileInfo.name} · {fmtBytes(fileInfo.size)}
                </p>
              </div>
            </div>
          </div>

          {result.present && result.manifest && (
            <>
              <div className="glass-panel p-4 grid sm:grid-cols-2 gap-4">
                {result.thumbnailUrl && (
                  <div className="sm:col-span-2 flex items-center gap-3">
                    <img
                      src={result.thumbnailUrl}
                      alt="C2PA thumbnail"
                      className="h-20 w-20 rounded-lg object-cover border border-border"
                    />
                    <p className="text-[11px] text-slate-500 flex items-center gap-1">
                      <ImageIcon className="h-3.5 w-3.5" /> الصورة المصغّرة المحفوظة بالمانيفست نفسه
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Claim Generator</p>
                  <p className="text-xs font-mono text-slate-200 break-all">{result.manifest.claim_generator ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">العنوان</p>
                  <p className="text-xs text-slate-200 break-all">{result.manifest.title ?? "—"}</p>
                </div>
                {result.manifest.signature_info && (
                  <>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">جهة التوقيع</p>
                      <p className="text-xs text-slate-200 break-all">
                        {result.manifest.signature_info.common_name ?? result.manifest.signature_info.issuer ?? "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">وقت التوقيع</p>
                      <p className="text-xs text-slate-200">{fmtDate(result.manifest.signature_info.time)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">خوارزمية التوقيع</p>
                      <p className="text-xs font-mono text-slate-200">{result.manifest.signature_info.alg ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">حالة إبطال الشهادة</p>
                      <p className="text-xs text-slate-200">
                        {result.manifest.signature_info.revocation_status === true
                          ? "مُبطلة ⚠"
                          : result.manifest.signature_info.revocation_status === false
                          ? "غير مُبطلة"
                          : "غير مفحوصة"}
                      </p>
                    </div>
                  </>
                )}
              </div>

              {doNotTrain && (
                <div className="glass-panel p-3 border border-amber-500/40 bg-amber-500/10">
                  <p className="text-[12px] text-amber-300 font-semibold">🚫 تصريح "Do Not Train"</p>
                  <p className="text-[11px] text-amber-200/80 mt-0.5">
                    صاحب هالمحتوى صرّح صراحة إنه ما بيسمح لشركات الذكاء الاصطناعي تستخدمه بتدريب
                    موديلاتها.
                  </p>
                </div>
              )}

              {result.actions.length > 0 && (
                <div className="glass-panel p-4 space-y-2">
                  <h3 className="font-display font-semibold text-sm text-slate-100">سجل التعديل (Actions)</h3>
                  <div className="space-y-1.5">
                    {result.actions.map((a, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-xs border-b border-border/50 pb-1.5 last:border-0 last:pb-0">
                        <span className="text-slate-200">{ACTION_LABEL_AR[a.action] ?? a.action}</span>
                        <span className="text-slate-500 text-[11px] text-left">
                          {softwareAgentName(a) ?? ""} {a.when ? `· ${fmtDate(a.when)}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {ingredients.length > 0 && (
                <div className="glass-panel p-4 space-y-2">
                  <h3 className="font-display font-semibold text-sm text-slate-100">
                    سلسلة المصدر (Ingredients) <span className="text-slate-600 font-normal">({ingredients.length})</span>
                  </h3>
                  <div className="space-y-1.5">
                    {ingredients.map((ing, i) => (
                      <div key={i} className="text-xs border-b border-border/50 pb-1.5 last:border-0 last:pb-0">
                        <p className="text-slate-200">
                          {ing.title ?? "(بدون اسم)"}{" "}
                          <span className="text-slate-500">
                            — {ing.relationship === "parentOf" ? "الأصل" : ing.relationship === "componentOf" ? "مكوّن" : ing.relationship ?? "—"}
                          </span>
                        </p>
                        {ing.validation_status && ing.validation_status.some((s) => s.success === false) && (
                          <p className="text-[11px] text-red-300 mt-0.5">⚠ فشل التحقق من هالعنصر</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {buckets && (buckets.failure.length > 0 || buckets.informational.length > 0 || buckets.success.length > 0) && (
                <div className="glass-panel p-4 space-y-2">
                  <button
                    onClick={() => setShowDetails((v) => !v)}
                    className="w-full flex items-center justify-between text-sm font-display font-semibold text-slate-100"
                  >
                    <span>
                      تفاصيل التحقق التقنية
                      {buckets.failure.length > 0 && <span className="text-red-300"> · {buckets.failure.length} فشل</span>}
                    </span>
                    {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {showDetails && (
                    <div className="space-y-3 pt-1">
                      {buckets.failure.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[11px] font-semibold text-red-300">فشل</p>
                          {buckets.failure.map((s, i) => (
                            <p key={i} className="text-[11px] font-mono text-slate-400 break-all">{s.code}{s.explanation ? ` — ${s.explanation}` : ""}</p>
                          ))}
                        </div>
                      )}
                      {buckets.informational.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[11px] font-semibold text-slate-400">معلوماتي</p>
                          {buckets.informational.map((s, i) => (
                            <p key={i} className="text-[11px] font-mono text-slate-500 break-all">{s.code}{s.explanation ? ` — ${s.explanation}` : ""}</p>
                          ))}
                        </div>
                      )}
                      {buckets.success.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[11px] font-semibold text-emerald-300">نجح</p>
                          {buckets.success.map((s, i) => (
                            <p key={i} className="text-[11px] font-mono text-slate-500 break-all">{s.code}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="glass-panel p-4 flex items-start gap-2.5">
            <Info className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {result.present ? (
                <>
                  هاد تحقق حقيقي (توقيع + قائمة ثقة)، بس في حدود لازم تعرفها: "موثّق" بيعني الموقِّع
                  موجود بقائمة الثقة الافتراضية لِـ C2PA — موقِّع شرعي بس مش موجود بهالقائمة (بعض
                  الأدوات الأصغر أو الداخلية) بيطلع "صحيح" بس مش "موثّق"، وهاد مش دليل تزوير. وكمان:
                  هاد بيتحقق من البيانات اللي بالمانيفست نفسه — إذا حدا شال المانيفست بالكامل من
                  الملف (ممكن بأدوات معينة) رح تطلع النتيجة "ما في بصمة C2PA" مش "فشل تحقق"، فغياب
                  البصمة مش دليل إنه المحتوى مزيّف، بس فقدان معلومة كان ممكن تكون مفيدة.
                </>
              ) : (
                <>
                  ما لقينا بيانات C2PA بهالملف إطلاقاً — يا إما الأداة اللي أنشأت الملف ما بتدعم
                  C2PA أصلاً، يا إما البيانات انشالت لاحقاً. هاد المعنى: غياب البصمة مش دليل إنه
                  المحتوى مزيّف أو AI — بس ما في معلومة نعتمد عليها.
                </>
              )}
            </p>
          </div>
        </motion.div>
      )}
    </div>
  );
}
