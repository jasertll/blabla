import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import { cacheGet, cacheSet, TTL } from "@/lib/cache";

export const runtime = "nodejs";

// Sherlock/WhatsMyName-style username OSINT: for an investigative alias
// (e.g. a suspected threat actor's handle, or confirming who really owns
// a piece of phishing/malware infrastructure), check whether a public
// profile page exists on each platform. Every target here is a FIXED,
// hardcoded domain — the username only ever becomes a path segment, never
// a host — so this can't be turned into an SSRF against arbitrary hosts
// the way a "scan this URL" tool could be.
//
// Two confidence tiers, both real (nothing here is fabricated):
// - "reliable": the platform gives a clean, documented status-code or
//   JSON-field signal (GitHub returns a real 404, Reddit's about.json
//   returns a real 404 body, etc).
// - "heuristic": platforms that block most unauthenticated/bot traffic or
//   render everything client-side (Instagram, Facebook, Telegram, X,
//   LinkedIn) don't give a clean signal — we still make a real HTTP
//   request and look for known page-text markers, but the result is a
//   best-effort guess, not a verified fact, and is labeled as such in the
//   UI rather than presented with false confidence. Often resolves to
//   "unknown" in practice when the platform's bot wall kicks in — that's
//   the honest outcome, not a bug.
type CheckStatus = "found" | "not_found" | "unknown";
type Confidence = "reliable" | "heuristic";
type PlatformResult = { platform: string; url: string; status: CheckStatus; confidence: Confidence };

const UA = "Mozilla/5.0 (compatible; JaserOSINT/1.0; +https://github.com)";

async function statusCheck(
  platform: string,
  url: string,
  confidence: Confidence,
  notFoundStatus: number[] = [404]
): Promise<PlatformResult> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": UA, Accept: "text/html,application/json" },
    });
    if (notFoundStatus.includes(res.status)) return { platform, url, status: "not_found", confidence };
    if (res.ok) return { platform, url, status: "found", confidence };
    return { platform, url, status: "unknown", confidence };
  } catch {
    return { platform, url, status: "unknown", confidence };
  }
}

// For bot-walled/SPA platforms: fetch the real page and look for known
// text markers. This used to default an ambiguous response (no not-found
// marker matched) to "found" — but several of these platforms (notably
// Instagram/Facebook/X) serve an identical generic/login-wall page to
// server-side requests regardless of whether the account exists, so that
// default was producing false "found" results that led nowhere when
// clicked. Now: a not-found marker match is "not_found"; a found-marker
// match is "found"; anything else is honestly "unknown" — no found
// marker means no claim of existence, full stop.
async function bodyTextCheck(
  platform: string,
  url: string,
  notFoundMarkers: string[],
  foundMarkers: string[] = []
): Promise<PlatformResult> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": UA, Accept: "text/html" },
    });
    if (!res.ok && res.status !== 404) return { platform, url, status: "unknown", confidence: "heuristic" };
    const text = await res.text();
    if (notFoundMarkers.some((m) => text.includes(m))) return { platform, url, status: "not_found", confidence: "heuristic" };
    if (foundMarkers.some((m) => text.includes(m))) return { platform, url, status: "found", confidence: "heuristic" };
    return { platform, url, status: "unknown", confidence: "heuristic" };
  } catch {
    return { platform, url, status: "unknown", confidence: "heuristic" };
  }
}

async function hackerNewsCheck(username: string): Promise<PlatformResult> {
  const url = `https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(username)}.json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const text = await res.text();
    return { platform: "Hacker News", url: `https://news.ycombinator.com/user?id=${username}`, status: text.trim() === "null" ? "not_found" : "found", confidence: "reliable" };
  } catch {
    return { platform: "Hacker News", url: `https://news.ycombinator.com/user?id=${username}`, status: "unknown", confidence: "reliable" };
  }
}

async function codeforcesCheck(username: string): Promise<PlatformResult> {
  const displayUrl = `https://codeforces.com/profile/${username}`;
  try {
    const res = await fetch(`https://codeforces.com/api/user.info?handles=${encodeURIComponent(username)}`, {
      signal: AbortSignal.timeout(6000),
    });
    const json = await res.json().catch(() => null);
    if (json?.status === "OK") return { platform: "Codeforces", url: displayUrl, status: "found", confidence: "reliable" };
    if (json?.status === "FAILED") return { platform: "Codeforces", url: displayUrl, status: "not_found", confidence: "reliable" };
    return { platform: "Codeforces", url: displayUrl, status: "unknown", confidence: "reliable" };
  } catch {
    return { platform: "Codeforces", url: displayUrl, status: "unknown", confidence: "reliable" };
  }
}

async function dockerHubCheck(username: string): Promise<PlatformResult> {
  const displayUrl = `https://hub.docker.com/u/${username}`;
  const result = await statusCheck("Docker Hub", `https://hub.docker.com/v2/users/${encodeURIComponent(username)}/`, "reliable", [404]);
  return { ...result, url: displayUrl };
}

async function telegramCheck(username: string): Promise<PlatformResult> {
  const url = `https://t.me/${encodeURIComponent(username)}`;
  return bodyTextCheck("Telegram", url, [], ["tgme_page_title", "tgme_action_button_new"]);
}

export async function GET(req: NextRequest) {
  const usernameRaw = req.nextUrl.searchParams.get("target") ?? "";
  const username = usernameRaw.trim();

  if (!username) {
    return NextResponse.json({ error: "Missing ?target=<username>" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_.-]{1,40}$/.test(username)) {
    return NextResponse.json(
      { error: "Username must be 1-40 chars, letters/digits/._- only." },
      { status: 400 }
    );
  }

  const rateLimit = checkRateLimit(`username:${getClientKey(req)}`, 15, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 30) } }
    );
  }

  const cacheKey = `username:${username.toLowerCase()}`;
  const cached = cacheGet<{ target: string; results: PlatformResult[] }>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const u = encodeURIComponent(username);
  const results = await Promise.all([
    // Reliable — clean status-code or JSON-field signal
    statusCheck("GitHub", `https://github.com/${u}`, "reliable"),
    statusCheck("GitLab", `https://gitlab.com/${u}`, "reliable"),
    statusCheck("PyPI", `https://pypi.org/user/${u}/`, "reliable"),
    statusCheck("dev.to", `https://dev.to/${u}`, "reliable"),
    statusCheck("Mastodon (mastodon.social)", `https://mastodon.social/@${u}`, "reliable"),
    statusCheck("Reddit", `https://www.reddit.com/user/${u}/about.json`, "reliable", [404]),
    statusCheck("TikTok", `https://www.tiktok.com/@${u}`, "reliable"),
    statusCheck("YouTube", `https://www.youtube.com/@${u}`, "reliable"),
    hackerNewsCheck(username),
    codeforcesCheck(username),
    dockerHubCheck(username),
    // Heuristic — bot-walled/SPA platforms, real requests but a best-effort
    // text-marker guess rather than a clean signal. A missing positive
    // marker means "unknown", never "found" — see bodyTextCheck's comment.
    // Facebook and X block/challenge almost all server-side requests
    // deeply enough that no reliable found-marker exists at all — they
    // only ever report not_found (rare) or unknown, by design, not a bug.
    bodyTextCheck(
      "Instagram",
      `https://www.instagram.com/${u}/`,
      ["Sorry, this page isn't available", "Page Not Found"],
      ["\"username\":\"" + username.toLowerCase() + "\"", "profilePage_"]
    ),
    bodyTextCheck("Facebook", `https://www.facebook.com/${u}`, ["This content isn't available", "Page Not Found", "content isn't available right now"]),
    bodyTextCheck("X (Twitter)", `https://twitter.com/${u}`, ["This account doesn't exist", "Page doesn't exist"]),
    bodyTextCheck(
      "LinkedIn",
      `https://www.linkedin.com/in/${u}`,
      ["Page not found", "This profile is not available"],
      ["\"publicIdentifier\":\"" + username.toLowerCase() + "\""]
    ),
    telegramCheck(username),
  ]);

  const result = { target: username, results };
  cacheSet(cacheKey, result, TTL.FIVE_MINUTES);
  return NextResponse.json(result);
}
