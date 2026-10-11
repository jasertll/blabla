import type { FileSignature } from "./signatures";

// ---------- Extension vs. real-type mismatch ----------

export type ExtensionCheck = {
  claimedExtension: string;
  mismatch: boolean;
  note: string;
};

/** Compares the file's actual extension against what its magic bytes say
 * it really is — the single most common malware-delivery trick (an .exe
 * or script renamed/disguised with a document/image extension, or a
 * double extension like "photo.jpg.exe"). */
export function checkExtensionMismatch(fileName: string, detected: FileSignature | null): ExtensionCheck {
  const parts = fileName.toLowerCase().split(".");
  const claimedExtension = parts.length > 1 ? parts[parts.length - 1] : "";

  // Double-extension trick: "invoice.pdf.exe" — the LAST extension is
  // what actually runs, but a quick glance sees ".pdf" first.
  if (parts.length > 2) {
    const secondToLast = parts[parts.length - 2];
    const looksLikeDocument = ["pdf", "doc", "docx", "xls", "xlsx", "jpg", "jpeg", "png", "txt", "csv"].includes(secondToLast);
    const lastIsDangerous = ["exe", "scr", "lnk", "js", "vbs", "bat", "cmd", "ps1", "jar", "com", "pif"].includes(claimedExtension);
    if (looksLikeDocument && lastIsDangerous) {
      return {
        claimedExtension,
        mismatch: true,
        note: `Double extension detected: "*.${secondToLast}.${claimedExtension}". Windows runs the LAST extension — this is designed to look like a "${secondToLast}" file at a glance while actually being a "${claimedExtension}" executable.`,
      };
    }
  }

  if (!detected) {
    return { claimedExtension, mismatch: false, note: "Real type couldn't be determined from magic bytes — no mismatch to compare." };
  }

  if (claimedExtension === "" || detected.typicalExtensions.includes(claimedExtension)) {
    return { claimedExtension, mismatch: false, note: `Extension matches the detected type (${detected.label}).` };
  }

  return {
    claimedExtension,
    mismatch: true,
    note: `File is named ".${claimedExtension}" but its actual content is "${detected.label}" — the extension does not match what the file really is.`,
  };
}
