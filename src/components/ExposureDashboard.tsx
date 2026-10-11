"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Eye, Plus, X, Loader2, ShieldAlert, ShieldCheck, KeyRound, ShieldQuestion, Bell } from "lucide-react";
import { checkPasswordBreach, type PasswordBreachResult } from "@/lib/passwordBreach";
import { useInvestigation } from "@/contexts/InvestigationContext";

const STORAGE_KEY = "jaser:exposure:emails";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type EmailStatus = {
  email: string;
  loading: boolean;
  error: string | null;
  breachCount: number | null;
  lastChecked: number | null;
};

type WatchedDomainStatus = { domain: string; newCerts: { id: number }[]; totalCerts: number; error?: string };

function loadEmails(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveEmails(emails: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(emails));
  } catch {
    /* private-browsing / quota — the list just won't persist this session */
  }
}

export default function ExposureDashboard() {
  const [emails, setEmails] = useState<EmailStatus[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [certDomains, setCertDomains] = useState<WatchedDomainStatus[] | null>(null);
  const [certConfigured, setCertConfigured] = useState(true);
  const [password, setPassword] = useState("");
  const [pwResult, setPwResult] = useState<PasswordBreachResult | null>(null);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const { addTimelineEvent, setToolAlert } = useInvestigation();

  useEffect(() => {
    const saved = loadEmails();
    setEmails(saved.map((email) => ({ email, loading: false, error: null, breachCount: null, lastChecked: null })));
    loadCertWatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadCertWatch() {
    try {
      const res = await fetch("/api/osint/certwatch/list");
      const json = await res.json();
      setCertConfigured(json.configured !== false);
      setCertDomains(json.domains ?? []);
    } catch {
      setCertDomains([]);
    }
  }

  useEffect(() => {
    const anyNewCerts = (certDomains ?? []).some((d) => d.newCerts.length > 0);
    const anyBreach = emails.some((e) => (e.breachCount ?? 0) > 0);
    setToolAlert("exposure", anyNewCerts || anyBreach);
  }, [certDomains, emails, setToolAlert]);

  function addEmail() {
    const e = newEmail.trim().toLowerCase();
    if (!e || !EMAIL_RE.test(e)) return;
    if (emails.some((x) => x.email === e)) return;
    const next = [...emails, { email: e, loading: false, error: null, breachCount: null, lastChecked: null }];
    setEmails(next);
    saveEmails(next.map((x) => x.email));
    setNewEmail("");
    checkEmail(e);
  }

  function removeEmail(email: string) {
    const next = emails.filter((x) => x.email !== email);
    setEmails(next);
    saveEmails(next.map((x) => x.email));
  }

  async function checkEmail(email: string) {
    setEmails((prev) => prev.map((x) => (x.email === email ? { ...x, loading: true, error: null } : x)));
    try {
      const res = await fetch(`/api/osint/email?email=${encodeURIComponent(email)}`);
      const json = await res.json();
      const breaches = json.breaches;
      const count = breaches?.status === "ok" ? breaches.data.items.length : breaches?.status === "not_found" ? 0 : null;
      setEmails((prev) =>
        prev.map((x) =>
          x.email === email
            ? { ...x, loading: false, breachCount: count, lastChecked: Date.now(), error: count === null ? (breaches?.message ?? json.error ?? "Lookup failed") : null }
            : x
        )
      );
      if (count) addTimelineEvent({ tool: "exposure", label: "Exposure check — email breach", detail: `${email} — ${count} breach(es)` });
    } catch {
      setEmails((prev) => prev.map((x) => (x.email === email ? { ...x, loading: false, error: "Network error." } : x)));
    }
  }

  async function checkAllEmails() {
    for (const e of emails) await checkEmail(e.email);
  }

  async function checkPassword() {
    if (!password) return;
    setPwLoading(true);
    setPwError(null);
    setPwResult(null);
    try {
      const { result, warning } = await checkPasswordBreach(password);
      setPwResult(result);
      if (warning) setPwError(warning);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Couldn't check this password.");
    } finally {
      setPwLoading(false);
    }
  }

  const totalNewCerts = (certDomains ?? []).reduce((sum, d) => sum + d.newCerts.length, 0);
  const totalBreachedEmails = emails.filter((e) => (e.breachCount ?? 0) > 0).length;

  return (
    <div className="space-y-4">
      <div className="glass-panel p-4">
        <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
          <Eye className="h-4 w-4 text-accent" /> Personal Exposure Dashboard
        </h2>
        <p className="text-xs text-slate-500 max-w-xl">
          بتجمّعلك بمكان واحد كل مؤشرات انكشافك الشخصي: شهادات SSL جديدة لدوماينات بتراقبها،
          تسريبات إيميل معروفة، وفحص باسورد سريع — بدون ما يترفع أي شي حساس لمكان مش لازم.
        </p>
        <div className="flex gap-3 mt-3">
          <span className={`text-[11px] px-2.5 py-1 rounded-full border ${totalNewCerts > 0 ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-border text-slate-500"}`}>
            {totalNewCerts} new certificate(s)
          </span>
          <span className={`text-[11px] px-2.5 py-1 rounded-full border ${totalBreachedEmails > 0 ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-border text-slate-500"}`}>
            {totalBreachedEmails} email(s) with breaches
          </span>
        </div>
      </div>

      <div className="glass-panel p-4 space-y-3">
        <h3 className="font-display font-semibold text-sm text-slate-100 flex items-center gap-2">
          <Bell className="h-4 w-4 text-accent" /> Certificate Watch
        </h3>
        {!certConfigured ? (
          <p className="text-xs text-slate-600">Needs Redis configured (UPSTASH_REDIS_REST_URL/TOKEN) — see Certificate Watch tool.</p>
        ) : certDomains && certDomains.length > 0 ? (
          <div className="space-y-1.5">
            {certDomains.map((d) => (
              <div key={d.domain} className="flex items-center justify-between text-xs">
                <span className="font-mono text-slate-300">{d.domain}</span>
                <span className={d.newCerts.length > 0 ? "text-amber-300" : "text-slate-500"}>
                  {d.newCerts.length > 0 ? `${d.newCerts.length} new` : `${d.totalCerts} total`}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-600">مافي دوماينات مراقَبة بعد — ضيفهم من أداة Certificate Watch.</p>
        )}
      </div>

      <div className="glass-panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold text-sm text-slate-100">Email Breach Monitor</h3>
          {emails.length > 0 && (
            <button onClick={checkAllEmails} className="text-[11px] px-2.5 py-1 rounded-md border border-border text-slate-400 hover:border-accent/50 hover:text-slate-200 transition-colors">
              Check all
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addEmail()}
            placeholder="you@example.com"
            dir="ltr"
            className="flex-1 bg-panel/60 border border-border rounded-lg px-3 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
          />
          <button onClick={addEmail} className="flex items-center gap-1 text-xs px-3 py-2 rounded-lg bg-accent/80 hover:bg-accent text-white transition-colors">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
        <div className="space-y-1.5">
          {emails.map((e) => (
            <div key={e.email} className="rounded-lg border border-border px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-slate-300 truncate">{e.email}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {e.loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
                  ) : e.breachCount === null ? (
                    <button onClick={() => checkEmail(e.email)} className="text-[11px] text-slate-500 hover:text-slate-300">Check</button>
                  ) : e.breachCount > 0 ? (
                    <span className="flex items-center gap-1 text-red-300"><ShieldAlert className="h-3.5 w-3.5" /> {e.breachCount} breach(es)</span>
                  ) : (
                    <span className="flex items-center gap-1 text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" /> Clean</span>
                  )}
                  <button onClick={() => removeEmail(e.email)} className="text-slate-600 hover:text-red-300">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {e.error && <p className="text-[10px] text-slate-600 mt-1">{e.error}</p>}
            </div>
          ))}
          {emails.length === 0 && <p className="text-xs text-slate-600">ما ضفت إيميل للمراقبة بعد.</p>}
        </div>
      </div>

      <div className="glass-panel p-4 space-y-2">
        <h3 className="font-display font-semibold text-sm text-slate-100 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-accent" /> Quick Password Check
        </h3>
        <p className="text-[11px] text-slate-500">
          فحص فوري بس — ما بنخزّن الباسورد ولا شي متعلق فيه، حتى بالمتصفح.
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && checkPassword()}
            placeholder="Enter a password to check"
            dir="ltr"
            className="flex-1 bg-panel/60 border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-accent"
          />
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={checkPassword}
            disabled={pwLoading || !password}
            className="text-xs px-3 py-1.5 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors"
          >
            {pwLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Check"}
          </motion.button>
        </div>
        {pwError && <p className="text-xs text-slate-500">{pwError}</p>}
        {pwResult && pwResult.source === "hibp" && (
          <div className="flex items-center gap-2 text-xs">
            {pwResult.count > 0 ? (
              <><ShieldAlert className="h-4 w-4 text-red-400" /><span className="text-red-300">Found in {pwResult.count.toLocaleString()} known breaches.</span></>
            ) : (
              <><ShieldCheck className="h-4 w-4 text-emerald-400" /><span className="text-emerald-300">Not found in known breach datasets.</span></>
            )}
          </div>
        )}
        {pwResult && pwResult.source === "local" && (
          <div className="flex items-center gap-2 text-xs">
            {pwResult.found ? (
              <><ShieldAlert className="h-4 w-4 text-red-400" /><span className="text-red-300">On the local common-password list.</span></>
            ) : (
              <><ShieldQuestion className="h-4 w-4 text-amber-300" /><span className="text-amber-300">Not on the small local list — but the live database was unreachable.</span></>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
