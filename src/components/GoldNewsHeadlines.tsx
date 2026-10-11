"use client";

import { useEffect, useState } from "react";
import { Newspaper, Globe2, TrendingUp, ExternalLink, Loader2 } from "lucide-react";

type Headline = { title: string; link: string; pubDate: number | null; source: string };

function timeAgo(ms: number | null): string {
  if (!ms) return "";
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 60) return `منذ ${mins} د`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `منذ ${hours} س`;
  return `منذ ${Math.round(hours / 24)} يوم`;
}

function HeadlineList({ items }: { items: Headline[] }) {
  if (items.length === 0) return <p className="text-xs text-slate-500">لا توجد عناوين متاحة حالياً.</p>;
  return (
    <ul className="space-y-2">
      {items.map((h, i) => (
        <li key={i}>
          <a
            href={h.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-1.5 text-xs text-slate-300 hover:text-accent-glow transition-colors group"
          >
            <ExternalLink className="h-3 w-3 shrink-0 mt-0.5 text-slate-600 group-hover:text-accent-glow" />
            <span>
              {h.title}
              <span className="text-[10px] text-slate-600 mr-1.5">
                · {h.source}
                {h.pubDate && ` · ${timeAgo(h.pubDate)}`}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function GoldNewsHeadlines() {
  const [world, setWorld] = useState<Headline[]>([]);
  const [business, setBusiness] = useState<Headline[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/gold/news", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
        } else {
          setWorld(json.world ?? []);
          setBusiness(json.business ?? []);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("تعذّر جلب الأخبار.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div id="gold-news-headlines" className="glass-panel p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Newspaper className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-display font-semibold text-slate-100">أخبار عالمية واقتصادية — للمراجعة اليدوية</h3>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        عناوين حقيقية حديثة من مصادر رسمية (BBC للأخبار العالمية/السياسية والحروب، CNBC للاقتصاد) — بدون أي تحليل آلي
        لتأثيرها على الذهب، لأنه لا توجد طريقة موثوقة لقياس ذلك تلقائياً. راجعها بنفسك قبل قرارات مهمة، خصوصاً وقت
        الأحداث الجيوسياسية الكبيرة.
      </p>

      {error && <p className="text-xs text-amber-300/90">{error}</p>}

      {!error && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] text-slate-400 font-semibold mb-2">
              <Globe2 className="h-3 w-3" /> عالمية وسياسية
            </p>
            <HeadlineList items={world} />
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-[11px] text-slate-400 font-semibold mb-2">
              <TrendingUp className="h-3 w-3" /> اقتصادية
            </p>
            <HeadlineList items={business} />
          </div>
        </div>
      )}
    </div>
  );
}
