const SUSPICIOUS_KEYWORDS = [
  "powershell", "cmd.exe", "wscript", "cscript", "mshta", "certutil",
  "rundll32", "regsvr32", "Invoke-Expression", "DownloadString",
  "CreateObject", "Shell(", "http://", "https://", "AutoOpen", "AutoExec",
  "Auto_Open", "Document_Open", "eval(", "base64", "WScript.Shell",
  "GetObject", "ShellExecute", "VirtualAlloc", "WriteProcessMemory",
  "URLDownloadToFile", "bitsadmin", "schtasks", "vssadmin", "-EncodedCommand",
  "-nop", "-w hidden", "IEX(", "New-Object Net.WebClient",
];

/** Extract printable ASCII runs (min length 4) — a classic quick-triage
 * technique (the `strings` utility) to spot embedded URLs, commands, or
 * script indicators inside a binary without executing it. */
export function extractInterestingStrings(bytes: Uint8Array, maxResults = 40): string[] {
  const runs: string[] = [];
  let current = "";
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    const printable = c >= 0x20 && c <= 0x7e;
    if (printable) {
      current += String.fromCharCode(c);
    } else {
      if (current.length >= 4) runs.push(current);
      current = "";
    }
  }
  if (current.length >= 4) runs.push(current);

  const flagged = runs.filter((s) =>
    SUSPICIOUS_KEYWORDS.some((kw) => s.toLowerCase().includes(kw.toLowerCase()))
  );

  const unique = Array.from(new Set(flagged));
  return unique.slice(0, maxResults);
}
