// Shared by proxy.ts (Node.js runtime) and app/api/site-auth/route.ts
// (Node runtime) — crypto.subtle is the one hashing API available on
// both, so this stays framework-agnostic rather than needing a
// Node-only vs Edge-only branch.

export const SITE_AUTH_COOKIE = "jaser_site_auth";
export const SITE_AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 180; // 180 days

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function loginPageHtml(wrongPassword: boolean): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Jaser — Locked</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#05070c; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color:#e2e8f0; }
  form { background:#0d1220; border:1px solid #1e293b; border-radius:12px; padding:32px; width:min(90vw,340px);
    box-shadow:0 20px 60px rgba(0,0,0,0.5); }
  h1 { font-size:15px; margin:0 0 4px; color:#f1f5f9; }
  p { font-size:12px; color:#64748b; margin:0 0 20px; }
  input { width:100%; box-sizing:border-box; background:#161d2e; border:1px solid #253045; border-radius:8px;
    padding:10px 12px; color:#e2e8f0; font-size:14px; margin-bottom:12px; }
  input:focus { outline:none; border-color:#7c5cff; }
  button { width:100%; background:#7c5cff; border:none; border-radius:8px; padding:10px; color:white;
    font-size:14px; font-weight:600; cursor:pointer; }
  button:hover { background:#6b4ce8; }
  .err { color:#f87171; font-size:12px; margin:-4px 0 12px; }
</style></head>
<body>
  <form method="POST" action="/api/site-auth">
    <h1>🐰 Jaser</h1>
    <p>Enter the site password to continue.</p>
    ${wrongPassword ? '<div class="err">Wrong password.</div>' : ""}
    <input type="password" name="password" placeholder="Password" autofocus required />
    <button type="submit">Unlock</button>
  </form>
</body></html>`;
}
