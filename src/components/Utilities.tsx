"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Wand2, KeyRound, Copy, Check, ShieldAlert, ShieldCheck, Loader2 } from "lucide-react";
import { defang, refang } from "@/lib/defang";
import BulkInvestigation from "@/components/BulkInvestigation";
import { checkPasswordBreach, type PasswordBreachResult } from "@/lib/passwordBreach";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-xs flex items-center gap-1 text-slate-400 hover:text-slate-200"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function IocUtility() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <Wand2 className="h-3.5 w-3.5 text-accent" /> IOC Defang / Refang
      </p>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Paste IOCs, e.g. https://evil.com or hxxp://evil[.]com"
        rows={3}
        dir="ltr"
        className="w-full bg-panel/60 border border-border rounded-lg p-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
      />
      <div className="flex gap-2">
        <button
          onClick={() => setOutput(defang(input))}
          className="text-xs px-2.5 py-1 rounded-md bg-accent/80 hover:bg-accent text-white transition-colors"
        >
          Defang
        </button>
        <button
          onClick={() => setOutput(refang(input))}
          className="text-xs px-2.5 py-1 rounded-md bg-panel border border-border hover:border-accent/50 text-slate-200 transition-colors"
        >
          Refang
        </button>
      </div>
      {output && (
        <div className="rounded-lg bg-[#0d0a18] border border-border p-2 flex items-start justify-between gap-2">
          <p className="text-xs font-mono text-slate-300 break-all">{output}</p>
          <CopyButton text={output} />
        </div>
      )}
    </div>
  );
}

function PasswordBreachCheck() {
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<PasswordBreachResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    if (!password) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { result: r, warning } = await checkPasswordBreach(password);
      setResult(r);
      if (warning) setError(warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check this password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <KeyRound className="h-3.5 w-3.5 text-accent" /> Password Breach Check
      </p>
      <p className="text-[11px] text-slate-500">
        Uses the HaveIBeenPwned k-anonymity model — only a 5-character hash prefix is sent,
        never the password itself. Free, keyless, and safe to use with real passwords.
      </p>
      <div className="flex gap-2">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && check()}
          placeholder="Enter a password to check"
          dir="ltr"
          className="flex-1 bg-panel/60 border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-accent"
        />
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={check}
          disabled={loading || !password}
          className="text-xs px-3 py-1.5 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Check"}
        </motion.button>
      </div>
      {error && <p className="text-xs text-slate-500">{error}</p>}
      {result && result.source === "hibp" && (
        <div className="flex items-center gap-2 text-xs">
          {result.count > 0 ? (
            <>
              <ShieldAlert className="h-4 w-4 text-red-400" />
              <span className="text-red-300">
                Found in {result.count.toLocaleString()} known breaches — do not use this password.
              </span>
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span className="text-emerald-300">Not found in known breach datasets.</span>
            </>
          )}
        </div>
      )}
      {result && result.source === "local" && (
        <div className="flex items-center gap-2 text-xs">
          {result.found ? (
            <>
              <ShieldAlert className="h-4 w-4 text-red-400" />
              <span className="text-red-300">
                On the local list of well-known common/breached passwords — do not use this password.
              </span>
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4 text-amber-300" />
              <span className="text-amber-300">
                Not on the small local list — but the live database couldn't be reached, so this is a
                weaker "unknown" result, not a clean pass.
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Utilities() {
  return (
    <div className="glass-panel p-4 space-y-4">
      <h2 className="font-display font-semibold text-sm text-slate-100">Utilities</h2>
      <BulkInvestigation />
      <IocUtility />
      <PasswordBreachCheck />
    </div>
  );
}
