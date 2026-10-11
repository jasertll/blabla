/** Best-effort PDF metadata via regex on the raw bytes. Works for PDFs
 * with an uncompressed /Info dictionary (common for simple/older PDFs);
 * PDFs with compressed object streams won't yield results here — that's
 * a known limitation of a lightweight, dependency-free approach. */
export function extractPdfMetadataBestEffort(text: string): Record<string, string> {
  const fields = ["Author", "Producer", "Creator", "CreationDate", "ModDate", "Title"];
  const result: Record<string, string> = {};
  for (const field of fields) {
    const match = text.match(new RegExp(`/${field}\\s*\\(([^)]*)\\)`));
    if (match) result[field] = match[1];
  }
  return result;
}

export type PdfActiveContentFinding = { keyword: string; count: number; label: string; severity: "danger" | "warning" };

const PDF_ACTIVE_CONTENT_KEYWORDS: { keyword: string; label: string; severity: "danger" | "warning" }[] = [
  { keyword: "/JavaScript", label: "Embedded JavaScript", severity: "danger" },
  { keyword: "/JS", label: "Embedded JavaScript (short form)", severity: "danger" },
  { keyword: "/OpenAction", label: "Auto-run action on open", severity: "danger" },
  { keyword: "/AA", label: "Additional (event-triggered) actions", severity: "warning" },
  { keyword: "/Launch", label: "Launch external program/file action", severity: "danger" },
  { keyword: "/EmbeddedFile", label: "Embedded file attachment", severity: "warning" },
  { keyword: "/RichMedia", label: "Embedded rich media (Flash/video) object", severity: "warning" },
  { keyword: "/SubmitForm", label: "Form-submission action (can exfiltrate data)", severity: "warning" },
  { keyword: "/GoToR", label: "Remote go-to action (can reach external URLs/files)", severity: "warning" },
];

/** PDF is a real programming environment, not just a document format —
 * it can embed JavaScript, auto-run actions on open, launch external
 * programs, and embed other files. These keywords are the standard,
 * well-documented static indicators analysts check for in a suspected
 * malicious PDF (used in real-world exploit delivery for well over a
 * decade). A match doesn't prove malice — plenty of legitimate PDFs use
 * JavaScript for form validation — but their presence is real, checkable
 * evidence, not a guess. */
export function scanPdfActiveContent(text: string): PdfActiveContentFinding[] {
  const findings: PdfActiveContentFinding[] = [];
  for (const k of PDF_ACTIVE_CONTENT_KEYWORDS) {
    const re = new RegExp(k.keyword.replace(/\//g, "\\/"), "g");
    const matches = text.match(re);
    if (matches && matches.length > 0) {
      findings.push({ keyword: k.keyword, count: matches.length, label: k.label, severity: k.severity });
    }
  }
  return findings;
}
