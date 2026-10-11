"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Bird,
  KeyRound,
  Download,
  Loader2,
  ChevronDown,
  Trash2,
  MapPin,
  Monitor,
  Clock,
  AlertTriangle,
  Upload,
  FileText,
  X,
  Link2,
  Copy,
  Check,
  Code2,
} from "lucide-react";
import HudChip from "@/components/HudChip";
import type { CanaryTokenWithHits } from "@/lib/canaryTypes";
import { buildCosmeticFilename } from "@/lib/canaryFile";

type ListResponse = { configured: boolean; tokens: CanaryTokenWithHits[] };
type Mode = "pdf" | "link";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rowLinkUrl(origin: string, t: CanaryTokenWithHits): string {
  const filename = buildCosmeticFilename(t.label, t.filename ?? "document");
  return `${origin}/api/canary/view/${t.token}/${encodeURIComponent(filename)}`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CanaryToken() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [tokens, setTokens] = useState<CanaryTokenWithHits[]>([]);
  const [mode, setMode] = useState<Mode>("pdf");
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [linkResult, setLinkResult] = useState<{ url: string; label: string } | null>(null);
  const [displayText, setDisplayText] = useState("");
  const [copied, setCopied] = useState<"url" | "html" | null>(null);
  const [copiedRowToken, setCopiedRowToken] = useState<string | null>(null);
  const [anyUrl, setAnyUrl] = useState("");
  const [anyText, setAnyText] = useState("");
  const [anyCopied, setAnyCopied] = useState(false);
  const [anyError, setAnyError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/canary/list");
      const data: ListResponse = await res.json();
      setConfigured(data.configured);
      setTokens(data.tokens ?? []);
    } catch {
      setConfigured(false);
    }
  }

  useEffect(() => {
    refresh();
    // Opens can happen at any time after you've sent the document off —
    // this doesn't require the tool to be open, or even this browser
    // tab to exist; the hit lands in Redis the instant the beacon/link
    // fires, server-side, regardless. Polling here just means you don't
    // have to remember to manually refresh to see it show up.
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, []);

  function resetForm() {
    setLabel("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submitPdf() {
    const effectiveLabel = label.trim() || (file ? file.name.replace(/\.pdf$/i, "") : "");
    if (!effectiveLabel || generating) return;
    setGenerating(true);
    setError(null);
    try {
      let res: Response;
      if (file) {
        const form = new FormData();
        form.append("file", file);
        form.append("label", effectiveLabel);
        res = await fetch("/api/canary/upload", { method: "POST", body: form });
      } else {
        res = await fetch("/api/canary/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: effectiveLabel }),
        });
      }
      const contentType = res.headers.get("Content-Type") ?? "";
      if (!contentType.includes("application/pdf")) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? "Couldn't process the document.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${effectiveLabel.slice(0, 60)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      resetForm();
      await refresh();
    } catch {
      setError("Network error while processing the document.");
    } finally {
      setGenerating(false);
    }
  }

  async function submitLink() {
    if (!file || generating) return;
    setGenerating(true);
    setError(null);
    setLinkResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("label", label.trim());
      const res = await fetch("/api/canary/link", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setError(data.message ?? "Couldn't create the tracked link.");
        return;
      }
      setLinkResult({ url: data.url, label: label.trim() || (file ? file.name.replace(/\.[^.]+$/, "") : "") });
      setDisplayText("");
      resetForm();
      await refresh();
    } catch {
      setError("Network error while creating the link.");
    } finally {
      setGenerating(false);
    }
  }

  function submit() {
    if (mode === "pdf") submitPdf();
    else submitLink();
  }

  async function copyLink(url: string, rowToken?: string) {
    try {
      await navigator.clipboard.writeText(url);
      if (rowToken) {
        setCopiedRowToken(rowToken);
        setTimeout(() => setCopiedRowToken(null), 1800);
      } else {
        setCopied("url");
        setTimeout(() => setCopied(null), 1800);
      }
    } catch {
      // Clipboard API can be denied (permissions, insecure context) —
      // the URL is still visible and selectable in the text box either way.
    }
  }

  // Copies a real HTML hyperlink — pasting into anything that accepts
  // rich text (Gmail, Outlook, Word, Slack, Notion...) shows the
  // friendly `text` as clickable, familiar-looking text while the
  // actual tracking URL stays underneath, out of sight, exactly like
  // any normal hyperlink. Plain-text targets (a bare text field, SMS)
  // fall back to the plain URL — there's no way to disguise a raw URL
  // string in a context that can't render markup, which is what the
  // cosmetic filename segment on the URL itself is for instead.
  async function copyRichLink(url: string, text: string, rowToken?: string) {
    const safeText = text.trim() || url;
    try {
      if (typeof ClipboardItem !== "undefined") {
        const html = `<a href="${escapeHtml(url)}">${escapeHtml(safeText)}</a>`;
        const item = new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([safeText], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(url);
      }
      if (rowToken) {
        setCopiedRowToken(rowToken);
        setTimeout(() => setCopiedRowToken(null), 1800);
      } else {
        setCopied("html");
        setTimeout(() => setCopied(null), 1800);
      }
    } catch {
      // Same as copyLink — clipboard access can be denied; the raw URL
      // stays visible/selectable either way.
    }
  }

  // Standalone version of the same "copy as real hyperlink" trick, for
  // any URL — not just ones this tool generated. It's the exact same
  // thing Gmail/Outlook/Slack's own "Insert Link" button does: friendly
  // text shows as the clickable hyperlink, the real URL sits underneath
  // it as the href, same as every hyperlink anywhere has always worked.
  // This does NOT rewrite, shorten, or route the URL through any other
  // domain — the href is exactly what was typed in, so the actual
  // destination is never hidden or changed, just displayed differently.
  async function copyAnyLink() {
    setAnyError(null);
    const raw = anyUrl.trim();
    if (!raw) return;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    let parsed: URL;
    try {
      parsed = new URL(withScheme);
    } catch {
      setAnyError("That doesn't look like a valid URL.");
      return;
    }
    const safeText = anyText.trim() || parsed.href;
    try {
      if (typeof ClipboardItem !== "undefined") {
        const html = `<a href="${escapeHtml(parsed.href)}">${escapeHtml(safeText)}</a>`;
        const item = new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([safeText], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(parsed.href);
      }
      setAnyCopied(true);
      setTimeout(() => setAnyCopied(false), 1800);
    } catch {
      setAnyError("Couldn't access the clipboard — copy manually instead.");
    }
  }

  async function removeToken(token: string) {
    setTokens((prev) => prev.filter((t) => t.token !== token));
    try {
      await fetch("/api/canary/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
    } catch {
      // Local state already reflects the removal; a failed cleanup call
      // just leaves a stale Redis entry, which the next refresh masks
      // anyway since it's harmless clutter, not a correctness issue.
    }
  }

  function toggle(token: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });
  }

  const canSubmit = mode === "pdf" ? Boolean(label.trim() || file) : Boolean(file);

  return (
    <div className="space-y-4">
      <div className="glass-panel p-4 space-y-4">
        <div>
          <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
            <Bird className="h-4 w-4 text-accent" /> Canary Token Generator
          </h2>
          <p className="text-xs text-slate-500">
            Two ways to track who opens a document — pick whichever fits how you're sending it.
            Either way, an open reports back IP, approximate location, device, and the exact time,
            and lands in the dashboard below whether or not this tool is open when it happens.
          </p>
        </div>

        <div className="flex gap-1.5 border-b border-border/60 pb-2">
          <button
            onClick={() => {
              setMode("pdf");
              setError(null);
            }}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
              mode === "pdf" ? "bg-accent/80 text-white" : "text-slate-400 hover:text-slate-200 hover:bg-panel/60"
            }`}
          >
            <FileText className="h-3.5 w-3.5" /> PDF beacon
          </button>
          <button
            onClick={() => {
              setMode("link");
              setError(null);
            }}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
              mode === "link" ? "bg-accent/80 text-white" : "text-slate-400 hover:text-slate-200 hover:bg-panel/60"
            }`}
          >
            <Link2 className="h-3.5 w-3.5" /> Tracked link
          </button>
        </div>

        {mode === "pdf" ? (
          <div className="flex items-start gap-2 text-xs text-amber-300/90 bg-amber-900/20 border border-amber-700/40 rounded-lg p-2.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Only use this on documents you own or are authorized to track — the same idea as{" "}
              <span className="font-mono">canarytokens.org</span>. Honest limitation: the beacon is
              PDF JavaScript, which only runs in Adobe Acrobat/Reader. Browser-built-in PDF viewers
              (Chrome, Firefox, Edge, Safari/Preview), phones, and most mobile PDF apps never
              execute PDF JavaScript at all, so opens there won't be logged. The upside: it fires
              every time the file is opened in Acrobat, even months later, even after being
              forwarded on as a raw file.
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 text-xs text-emerald-300/90 bg-emerald-900/20 border border-emerald-700/40 rounded-lg p-2.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Works on <em>any</em> device or viewer — phone, browser, Preview, anything — because
              opening the link is a normal web request, not PDF JavaScript. Works for images too,
              not just PDFs. Only use this on documents you own or are authorized to track. Honest
              limitation: it only logs opens of <em>this link</em> — if someone downloads the file
              through it and forwards the raw file onward, further opens of that saved copy aren't
              tracked (there's no more link involved at that point).
            </span>
          </div>
        )}

        {configured === false && (
          <div className="flex items-center gap-2 text-xs text-amber-300/90 bg-amber-900/20 border border-amber-700/40 rounded-lg p-2.5">
            <KeyRound className="h-3.5 w-3.5 shrink-0" />
            <span>
              This needs <code className="font-mono">UPSTASH_REDIS_REST_URL</code> and{" "}
              <code className="font-mono">UPSTASH_REDIS_REST_TOKEN</code> in your environment
              (same store the gold engine and visitor counter use).
            </span>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {file ? (
              <div className="flex-1 flex items-center gap-2 bg-panel/60 border border-accent/40 rounded-lg px-3 py-2 text-sm text-slate-200 min-w-0">
                <FileText className="h-3.5 w-3.5 text-accent shrink-0" />
                <span className="truncate">{file.name}</span>
                <button
                  onClick={() => {
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="ml-auto text-slate-500 hover:text-red-400 transition-colors shrink-0"
                  title="Remove file"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <label className="flex-1 flex items-center gap-2 bg-panel/60 border border-dashed border-border rounded-lg px-3 py-2 text-sm text-slate-500 hover:border-accent/50 hover:text-slate-300 cursor-pointer transition-colors">
                <Upload className="h-3.5 w-3.5 shrink-0" />
                {mode === "pdf"
                  ? "Attach your own PDF (optional — a blank decoy is generated if you skip this)"
                  : "Attach a PDF or image (required — this mode has no blank-decoy fallback)"}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={mode === "pdf" ? "application/pdf,.pdf" : "application/pdf,.pdf,image/*"}
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder={file ? "Label (optional — defaults to the file name)" : "e.g. ملف الرواتب - نسخة أحمد"}
              className="flex-1 min-w-[160px] bg-panel/60 border border-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
            />
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={submit}
              disabled={!canSubmit || generating || configured === false}
              className="text-xs px-3 py-2 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors flex items-center gap-1.5 shrink-0"
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : mode === "pdf" ? (
                <Download className="h-3.5 w-3.5" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              {mode === "pdf" ? (file ? "Track & Download" : "Generate & Download") : "Create Tracked Link"}
            </motion.button>
          </div>
        </div>

        {linkResult && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 bg-panel/60 border border-accent/40 rounded-lg px-3 py-2">
              <Link2 className="h-3.5 w-3.5 text-accent shrink-0" />
              <span className="flex-1 text-xs text-slate-200 font-mono truncate" dir="ltr">
                {linkResult.url}
              </span>
              <button
                onClick={() => copyLink(linkResult.url)}
                className="text-xs px-2 py-1 rounded-md bg-panel border border-border hover:border-accent/50 text-slate-300 transition-colors flex items-center gap-1 shrink-0"
                title="Copy the raw URL — for plain-text places (SMS, WhatsApp) that can't render a hyperlink"
              >
                {copied === "url" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                {copied === "url" ? "Copied" : "Copy URL"}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={displayText}
                onChange={(e) => setDisplayText(e.target.value)}
                placeholder={`Display text for the hyperlink (defaults to "${linkResult.label}")`}
                className="flex-1 min-w-[160px] bg-panel/60 border border-border rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
              />
              <button
                onClick={() => copyRichLink(linkResult.url, displayText || linkResult.label)}
                className="text-xs px-2 py-1.5 rounded-md bg-panel border border-border hover:border-accent/50 text-slate-300 transition-colors flex items-center gap-1 shrink-0"
                title="Copy as a real hyperlink — paste into Gmail/Outlook/Word/Slack and it shows as clickable text, the URL stays hidden underneath"
              >
                {copied === "html" ? <Check className="h-3 w-3 text-emerald-400" /> : <Code2 className="h-3 w-3" />}
                {copied === "html" ? "Copied" : "Copy as Hyperlink"}
              </button>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-red-300">{error}</p>}
      </div>

      <div className="glass-panel p-4 space-y-3">
        <div>
          <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
            <Code2 className="h-4 w-4 text-accent" /> Hyperlink Formatter
          </h2>
          <p className="text-xs text-slate-500">
            Turn any URL into a real hyperlink with friendly display text — same as Gmail/Outlook/Slack's
            own "Insert Link" button. This doesn't shorten, rewrite, or route the link through any other
            domain — the address it actually opens is exactly what you paste below, just shown as
            readable text instead of a raw URL once pasted somewhere that renders rich text.
          </p>
        </div>
        <div className="space-y-2">
          <input
            value={anyUrl}
            onChange={(e) => setAnyUrl(e.target.value)}
            placeholder="Paste any link — e.g. https://example.com/report"
            dir="ltr"
            className="w-full bg-panel/60 border border-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={anyText}
              onChange={(e) => setAnyText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && copyAnyLink()}
              placeholder="Display text (optional — defaults to the URL)"
              className="flex-1 min-w-[160px] bg-panel/60 border border-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
            />
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={copyAnyLink}
              disabled={!anyUrl.trim()}
              className="text-xs px-3 py-2 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors flex items-center gap-1.5 shrink-0"
            >
              {anyCopied ? <Check className="h-3.5 w-3.5 text-emerald-100" /> : <Code2 className="h-3.5 w-3.5" />}
              {anyCopied ? "Copied" : "Copy as Hyperlink"}
            </motion.button>
          </div>
          {anyError && <p className="text-xs text-red-300">{anyError}</p>}
        </div>
      </div>

      {tokens.length > 0 && (
        <div className="glass-panel p-4 space-y-3">
          <h3 className="font-display font-semibold text-sm text-slate-100">
            Tracked documents ({tokens.length})
          </h3>
          {tokens.map((t) => {
            const isOpen = expanded.has(t.token);
            const isLink = t.kind === "link";
            return (
              <div key={t.token} className="border border-border/70 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggle(t.token)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-panel/40 transition-colors text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {isLink ? (
                        <Link2 className="h-3 w-3 text-emerald-400 shrink-0" />
                      ) : (
                        <FileText className="h-3 w-3 text-accent shrink-0" />
                      )}
                      <p className="text-sm text-slate-200 truncate">{t.label}</p>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {formatDate(t.createdAt)} · {isLink ? "Tracked link" : "PDF beacon"}
                    </p>
                  </div>
                  <HudChip color={t.hits.length > 0 ? "red" : "mint"}>
                    {t.hits.length} {t.hits.length === 1 ? "OPEN" : "OPENS"}
                  </HudChip>
                  {isLink && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyLink(rowLinkUrl(window.location.origin, t), t.token);
                        }}
                        className="text-slate-500 hover:text-accent transition-colors p-1"
                        title="Copy raw URL"
                      >
                        {copiedRowToken === t.token ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyRichLink(rowLinkUrl(window.location.origin, t), t.label, t.token);
                        }}
                        className="text-slate-500 hover:text-accent transition-colors p-1"
                        title="Copy as hyperlink (for Gmail/Outlook/Word/Slack)"
                      >
                        <Code2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeToken(t.token);
                    }}
                    className="text-slate-500 hover:text-red-400 transition-colors p-1"
                    title="Delete this token"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <ChevronDown
                    className={`h-4 w-4 text-slate-500 transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {isOpen && (
                  <div className="border-t border-border/70 divide-y divide-border/50">
                    {t.hits.length === 0 ? (
                      <p className="text-xs text-slate-500 px-3 py-3">
                        Not opened yet — nothing has triggered this token.
                      </p>
                    ) : (
                      t.hits.map((h, i) => (
                        <div key={i} className="px-3 py-2.5 text-xs space-y-1">
                          <div className="flex items-center gap-1.5 text-slate-300">
                            <Clock className="h-3 w-3 text-accent shrink-0" />
                            {formatDate(h.at)}
                          </div>
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <MapPin className="h-3 w-3 shrink-0" />
                            {h.ip} · {h.city ? `${h.city}, ` : ""}
                            {h.country}
                            {h.isp ? ` · ${h.isp}` : ""}
                          </div>
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <Monitor className="h-3 w-3 shrink-0" />
                            {h.browser} on {h.os} ({h.deviceType})
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
