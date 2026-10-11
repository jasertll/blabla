// Real, standards-based parsing of SPF (RFC 7208) and DMARC (RFC 7489)
// record content — not just "present/absent". A record can exist and
// still be functionally weak (e.g. SPF ending in "+all", or DMARC with
// p=none), which is the actual signal a mail-security review cares about.

export type SpfAnalysis = {
  found: boolean;
  qualifier: "fail" | "softfail" | "neutral" | "pass-all" | "unknown";
  lookupMechanisms: number;
  overLookupLimit: boolean;
  tone: "good" | "warn" | "bad";
  note: string;
};

export function analyzeSpf(record: string | null): SpfAnalysis {
  if (!record) {
    return { found: false, qualifier: "unknown", lookupMechanisms: 0, overLookupLimit: false, tone: "bad", note: "No SPF record — anyone can send mail claiming to be from this domain with no SPF check to fail." };
  }

  const terms = record.trim().split(/\s+/);
  const allTerm = terms.find((t) => /^[+\-~?]?all$/i.test(t));
  let qualifier: SpfAnalysis["qualifier"] = "unknown";
  let tone: SpfAnalysis["tone"] = "warn";
  let note = "SPF present but its final mechanism could not be parsed.";

  if (allTerm) {
    const symbol = allTerm.startsWith("+") ? "+" : allTerm.startsWith("-") ? "-" : allTerm.startsWith("~") ? "~" : allTerm.startsWith("?") ? "?" : "+";
    if (symbol === "-") {
      qualifier = "fail";
      tone = "good";
      note = "Ends in -all (hard fail) — mail servers are told to reject messages from senders not explicitly authorized. This is the strict, recommended setting.";
    } else if (symbol === "~") {
      qualifier = "softfail";
      tone = "warn";
      note = "Ends in ~all (soft fail) — unauthorized senders are marked suspicious but usually still delivered. Weaker than -all.";
    } else if (symbol === "?") {
      qualifier = "neutral";
      tone = "warn";
      note = "Ends in ?all (neutral) — provides no real enforcement, equivalent to not specifying a policy for unlisted senders.";
    } else {
      qualifier = "pass-all";
      tone = "bad";
      note = "Ends in +all — explicitly authorizes ANY server to send mail as this domain. This defeats the purpose of SPF and is a serious misconfiguration.";
    }
  }

  // RFC 7208 §4.6.4: SPF evaluation must not perform more than 10 DNS
  // lookups (include/a/mx/ptr/exists/redirect); exceeding it is a real
  // "permerror" that can make the entire SPF record fail open.
  const lookupMechanisms = terms.filter((t) => /^(include|a|mx|ptr|exists|redirect)(:|\/|=|$)/i.test(t)).length;
  const overLookupLimit = lookupMechanisms > 10;

  return { found: true, qualifier, lookupMechanisms, overLookupLimit, tone, note };
}

export type DmarcAnalysis = {
  found: boolean;
  policy: "reject" | "quarantine" | "none" | "unknown";
  pct: number;
  hasAggregateReports: boolean;
  tone: "good" | "warn" | "bad";
  note: string;
};

export function analyzeDmarc(record: string | null): DmarcAnalysis {
  if (!record) {
    return { found: false, policy: "unknown", pct: 100, hasAggregateReports: false, tone: "bad", note: "No DMARC record — even a strong SPF/DKIM setup has no enforcement policy without DMARC." };
  }

  const tags = new Map<string, string>();
  for (const part of record.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k && v) tags.set(k.trim().toLowerCase(), v.trim());
  }

  const p = (tags.get("p") ?? "").toLowerCase();
  const pct = tags.get("pct") ? parseInt(tags.get("pct")!, 10) : 100;
  const hasAggregateReports = tags.has("rua");

  let policy: DmarcAnalysis["policy"] = "unknown";
  let tone: DmarcAnalysis["tone"] = "warn";
  let note = "DMARC policy tag could not be parsed.";

  if (p === "reject") {
    policy = "reject";
    tone = "good";
    note = "p=reject — mail servers are told to reject messages that fail DMARC alignment outright. The strongest enforcement level.";
  } else if (p === "quarantine") {
    policy = "quarantine";
    tone = "warn";
    note = "p=quarantine — failing messages are flagged/sent to spam rather than rejected. Moderate enforcement.";
  } else if (p === "none") {
    policy = "none";
    tone = "bad";
    note = "p=none — monitoring only, no actual enforcement. Spoofed mail using this domain will still be delivered normally.";
  }

  if (policy !== "none" && pct < 100) {
    note += ` Only applied to ${pct}% of mail (pct=${pct}) — the rest bypasses enforcement entirely.`;
    if (tone === "good") tone = "warn";
  }

  return { found: true, policy, pct, hasAggregateReports, tone, note };
}
