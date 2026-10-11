// Shared password-breach check (k-anonymity HaveIBeenPwned range query with
// a small offline fallback) — used by both the Utilities tool and the
// Exposure Dashboard, so the check logic lives in one place.

import { isCommonPassword } from "./commonPasswords";

export type PasswordBreachResult = { source: "hibp"; count: number } | { source: "local"; found: boolean };

export async function checkPasswordBreach(password: string): Promise<{ result: PasswordBreachResult; warning: string | null }> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error(
      "This check needs a secure context (HTTPS, or localhost during development) — the browser's crypto API isn't available here."
    );
  }

  try {
    const enc = new TextEncoder().encode(password);
    const digest = await crypto.subtle.digest("SHA-1", enc);
    const hashHex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    const prefix = hashHex.slice(0, 5);
    const suffix = hashHex.slice(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
    if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
    const text = await res.text();
    const match = text.split("\n").find((line) => line.trim().startsWith(suffix));
    return { result: { source: "hibp", count: match ? parseInt(match.split(":")[1].trim(), 10) : 0 }, warning: null };
  } catch (err) {
    // HaveIBeenPwned's live database (billions of real breached hashes) is
    // unreachable — fall back to a small, fully local/offline list of
    // well-known common passwords instead of just dead-ending. This is a
    // much weaker check (a few hundred entries vs billions), so it's
    // labeled as exactly that, not presented as equivalent.
    const detail = err instanceof Error ? err.message : String(err);
    return {
      result: { source: "local", found: isCommonPassword(password) },
      warning: `Couldn't reach the live HaveIBeenPwned database (${detail}) — showing a local fallback check instead (see below), which only covers a few hundred of the most common breached passwords, not the full live dataset.`,
    };
  }
}
