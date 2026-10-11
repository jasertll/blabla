// Builds a minimal, hand-crafted PDF that "phones home" the moment it's
// opened — the same underlying technique canarytokens.org uses for its
// "Adobe PDF" token: the document's /OpenAction runs a JavaScript action
// that calls the real Acrobat JS API method app.launchURL() against our
// own tracking endpoint, with no click required from whoever opens it.
//
// Honest limitation (also stated in the UI): PDF JavaScript only
// executes in Adobe Acrobat/Reader. Browser built-in PDF viewers
// (Chrome, Firefox/PDF.js, Edge, Safari/Preview) and most mobile PDF
// apps never run PDF JavaScript at all, so the beacon simply won't fire
// there. There is no PDF technique that works in every viewer — this is
// the real, standard one for the most widely used desktop reader.

import { PDFDocument } from "pdf-lib";

function escapePdfString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// PDF text strings can carry UTF-16BE (with a leading BOM) as an
// alternative to PDFDocEncoding, written as a hex string <FEFF...> —
// this is how a non-Latin label (Arabic here) survives correctly in the
// /Info dictionary, which most readers surface in "Document Properties".
function toUtf16BEHex(s: string): string {
  const bytes: number[] = [0xfe, 0xff];
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code > 0xffff) {
      const c = code - 0x10000;
      const hi = 0xd800 + (c >> 10);
      const lo = 0xdc00 + (c & 0x3ff);
      bytes.push(hi >> 8, hi & 0xff, lo >> 8, lo & 0xff);
    } else {
      bytes.push(code >> 8, code & 0xff);
    }
  }
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildCanaryPdf(opts: { label: string; hitUrl: string }): Buffer {
  const { label, hitUrl } = opts;
  const titleHex = toUtf16BEHex(label.trim() || "Confidential");
  // Base14 Helvetica has no Arabic glyphs, so the *visible* page content
  // stays plain ASCII (it's just a plausible-looking placeholder) — the
  // real label lives in the PDF's own metadata instead, which is where
  // the generator/dashboard reads it back from.
  const js = `app.launchURL(${JSON.stringify(hitUrl)}, true);`;
  const jsEscaped = escapePdfString(js);
  const content = "BT /F1 18 Tf 72 700 Td (CONFIDENTIAL - INTERNAL USE ONLY) Tj ET";
  const contentLen = Buffer.byteLength(content, "latin1");

  const objects: string[] = new Array(8);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R /OpenAction 5 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objects[3] =
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[5] = `<< /S /JavaScript /JS (${jsEscaped}) >>`;
  objects[6] = `<< /Length ${contentLen} >>\nstream\n${content}\nendstream`;
  objects[7] = `<< /Title <${titleHex}> /Producer (Jaser Canary Token) >>`;

  const header = "%PDF-1.4\n";
  let body = "";
  const offsets: number[] = new Array(8).fill(0);
  let offset = Buffer.byteLength(header, "latin1");

  for (let i = 1; i <= 7; i++) {
    offsets[i] = offset;
    const objStr = `${i} 0 obj\n${objects[i]}\nendobj\n`;
    body += objStr;
    offset += Buffer.byteLength(objStr, "latin1");
  }

  const xrefOffset = Buffer.byteLength(header, "latin1") + Buffer.byteLength(body, "latin1");
  let xref = "xref\n0 8\n0000000000 65535 f \n";
  for (let i = 1; i <= 7; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size 8 /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(header + body + xref + trailer, "latin1");
}

// Takes a real PDF the user already has (a payroll file, a contract,
// whatever) and returns a copy with the same beacon wired in as a
// document-level JavaScript — pdfDoc.addJavaScript() registers a script
// in the document's Names/JavaScript tree, which Acrobat runs
// automatically on open, same trigger as /OpenAction but additive: it
// doesn't touch or replace anything the original file was already doing
// (existing forms, links, other scripts, page content — all untouched).
//
// Hand-parsing an arbitrary real-world PDF well enough to safely inject
// into it isn't something to reinvent here — unlike buildCanaryPdf
// above, where every byte is under this file's own control, an uploaded
// PDF can come from any producer (Word, a scanner app, Acrobat itself)
// with structures (cross-reference streams, object streams, compressed
// data) a hand-rolled parser could easily get wrong and corrupt. pdf-lib
// is a mature, widely used pure-JS library that already handles that
// parsing correctly, so it does the one part of this job that's
// genuinely risky to hand-roll.
export async function injectCanaryIntoPdf(inputBytes: Uint8Array, hitUrl: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(inputBytes, { ignoreEncryption: true, updateMetadata: false });
  const js = `app.launchURL(${JSON.stringify(hitUrl)}, true);`;
  pdfDoc.addJavaScript("jaser_canary", js);
  return pdfDoc.save();
}
