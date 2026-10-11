// Real per-cookie flag analysis from actual Set-Cookie response headers —
// the standard passive check for session-cookie hardening (Secure /
// HttpOnly / SameSite), same as what browser devtools' security panel
// already surfaces to any visitor.

export type CookieFinding = {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
  looksLikeSession: boolean;
  issues: string[];
};

const SESSION_NAME_HINTS = /session|sess|token|auth|jwt|jsessionid|phpsessid|connect\.sid|_sid\b/i;

export function analyzeCookies(setCookieHeaders: string[]): CookieFinding[] {
  return setCookieHeaders.map((raw) => {
    const parts = raw.split(";").map((p) => p.trim());
    const [nameValue] = parts;
    const name = nameValue.split("=")[0] ?? "unknown";
    const lower = parts.map((p) => p.toLowerCase());

    const secure = lower.some((p) => p === "secure");
    const httpOnly = lower.some((p) => p === "httponly");
    const sameSiteEntry = parts.find((p) => p.toLowerCase().startsWith("samesite="));
    const sameSite = sameSiteEntry ? sameSiteEntry.split("=")[1] : null;
    const looksLikeSession = SESSION_NAME_HINTS.test(name);

    const issues: string[] = [];
    if (looksLikeSession && !secure) issues.push("Missing Secure — can be sent over plain HTTP, exposing it to network interception");
    if (looksLikeSession && !httpOnly) issues.push("Missing HttpOnly — readable by JavaScript, so an XSS bug could steal it directly");
    if (looksLikeSession && (!sameSite || sameSite.toLowerCase() === "none")) issues.push(`SameSite is ${sameSite ?? "unset (defaults vary by browser)"} — offers little/no CSRF protection`);

    return { name, secure, httpOnly, sameSite, looksLikeSession, issues };
  });
}
