import { ATTACK_TECHNIQUES, type AttackTechnique } from "./attackData";

type AttackMappingRule = { test: RegExp; techniques: string[] };

// Maps this app's own internal finding ids/titles (from
// lib/fileAnalysis/verdicts.ts, lib/peAnalysis.ts, lib/elfAnalysis.ts,
// lib/malwareIndicators.ts, lib/macroAnalysis.ts, lib/fileAnalysis/pdf.ts)
// to real MITRE ATT&CK Enterprise technique IDs — the same kind of
// technique association real static-analysis tools carry (Mandiant's
// `capa`, for instance, ships ATT&CK mappings directly in its rules).
// Every rule here traces to a documented, real technique; nothing is
// invented. Patterns are matched against both the finding's id and its
// title since several ids are built dynamically (macro-${f.id},
// pdf-active-${keyword}) rather than being fixed strings.
const RULES: AttackMappingRule[] = [
  { test: /injection|cross-process-write/i, techniques: ["T1055"] },
  { test: /keylog/i, techniques: ["T1056"] },
  { test: /credential|mimikatz/i, techniques: ["T1003"] },
  { test: /antidebug|anti-debug|tls-callback/i, techniques: ["T1497"] },
  { test: /amsi|etw-patching|defender-tamper/i, techniques: ["T1562"] },
  { test: /persistence-registry|^pe-persistence/i, techniques: ["T1547"] },
  { test: /wmi-persistence/i, techniques: ["T1546"] },
  { test: /schtasks-persistence/i, techniques: ["T1053"] },
  { test: /uac-bypass/i, techniques: ["T1548"] },
  { test: /shadowcopy-delete/i, techniques: ["T1490"] },
  { test: /network-c2|cobalt-strike|sliver-c2|havoc-c2|brute-ratel|posh-empire|asyncrat-njrat|darkcomet-nanocore/i, techniques: ["T1071"] },
  { test: /agenttesla|infostealer-redline/i, techniques: ["T1555"] },
  { test: /ransomware-pattern|ransomware-note/i, techniques: ["T1486"] },
  { test: /webshell/i, techniques: ["T1505"] },
  { test: /reverse-shell/i, techniques: ["T1059"] },
  { test: /wmic-process-create/i, techniques: ["T1047"] },
  { test: /powershell-encoded|powershell-downloadstring/i, techniques: ["T1059"] },
  { test: /lolbas-|forfiles|diskshadow|odbcconf/i, techniques: ["T1218"] },
  { test: /bitsadmin/i, techniques: ["T1105"] },
  { test: /download-execute|remote-template/i, techniques: ["T1105"] },
  { test: /packer-marker|wx-section|unusual-sections|minimal-imports|wx-segment|minimal-segments|minimal-dynsym|packer-sections|no-section-headers|entropy-elevated|entropy-localized/i, techniques: ["T1027"] },
  { test: /embedded-signatures|trailing-data/i, techniques: ["T1027", "T1036"] },
  { test: /extension-mismatch|checksum-mismatch|unusual-interpreter/i, techniques: ["T1036"] },
  { test: /timestamp-future|timestamp-implausible/i, techniques: ["T1070"] },
  { test: /macro/i, techniques: ["T1059", "T1204"] },
  { test: /pdf-active/i, techniques: ["T1059"] },
];

export type AttackMatch = { technique: AttackTechnique; triggeredBy: string[] };

/** Resolves a list of this app's own finding ids/titles to real ATT&CK
 * techniques, deduplicated, each carrying which specific finding(s)
 * triggered it — so a matched technique always traces back to concrete
 * evidence in the report above it, rather than being asserted on its
 * own the way a fabricated "AI risk score" would be. */
export function resolveAttackTechniques(findings: { id: string; title: string }[]): AttackMatch[] {
  const byTechnique = new Map<string, Set<string>>();
  for (const f of findings) {
    for (const rule of RULES) {
      if (rule.test.test(f.id) || rule.test.test(f.title)) {
        for (const techId of rule.techniques) {
          if (!byTechnique.has(techId)) byTechnique.set(techId, new Set());
          byTechnique.get(techId)!.add(f.title);
        }
      }
    }
  }
  const matches: AttackMatch[] = [];
  for (const [techId, triggeredBySet] of byTechnique) {
    const technique = ATTACK_TECHNIQUES.find((t) => t.id === techId);
    if (technique) matches.push({ technique, triggeredBy: Array.from(triggeredBySet) });
  }
  return matches.sort((a, b) => a.technique.tactic.localeCompare(b.technique.tactic));
}
