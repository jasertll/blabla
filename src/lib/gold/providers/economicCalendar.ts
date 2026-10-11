import type { ProviderState } from "@/lib/osintTypes";

// Official first-party government sources, fetched live and parsed —
// deliberately NOT a hardcoded date list, because a wrong hand-typed
// FOMC/CPI date would be a worse failure mode than honestly reporting
// "unavailable". If parsing ever yields something implausible (zero
// matches, or so many that it looks like noise rather than a clean
// calendar), this returns not_found instead of trusting a bad parse.

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

// Some government sites reject requests that don't look like a real
// browser (missing/blank User-Agent) — send a normal browser UA and set
// a hard timeout so a slow response can't hang the request indefinitely.
async function fetchHtml(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Finds every occurrence of `keyword` in raw HTML/text and looks for the
 * first "Month Day[-Day], Year?" date pattern within a short window after
 * it. Generic on purpose — robust to markup changes since it doesn't
 * depend on specific tag structure, only on the keyword and a date
 * appearing near each other in the rendered text.
 */
function extractDatesNear(html: string, keyword: string, windowChars = 400): Date[] {
  const dates: Date[] = [];
  const lowerHtml = html.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const datePattern = new RegExp(`(${MONTHS})\\.?\\s+(\\d{1,2})(?:\\s*[-–—]\\s*(\\d{1,2}))?,?\\s*(\\d{4})?`, "i");

  let searchFrom = 0;
  let idx = lowerHtml.indexOf(lowerKeyword, searchFrom);
  let guard = 0;
  while (idx !== -1 && guard < 200) {
    guard++;
    const windowText = html.slice(idx, idx + windowChars);
    const m = windowText.match(datePattern);
    if (m) {
      const month = m[1];
      const dayRangeEnd = m[3] ? parseInt(m[3], 10) : parseInt(m[2], 10);
      const year = m[4] ? parseInt(m[4], 10) : new Date().getUTCFullYear();
      const d = new Date(`${month} ${dayRangeEnd}, ${year} 18:00:00 UTC`); // 2pm ET FOMC decision time ≈ 18:00 UTC (accounting for typical ET offset); refined per-source below where relevant
      if (!isNaN(d.getTime())) dates.push(d);
    }
    searchFrom = idx + keyword.length;
    idx = lowerHtml.indexOf(lowerKeyword, searchFrom);
  }
  return dates;
}

function plausibleFutureDates(dates: Date[], now: number): Date[] {
  const maxFuture = now + 400 * 24 * 60 * 60_000; // ~13 months out — beyond that, treat as noise/unrelated year mentions
  return dates.filter((d) => d.getTime() >= now - 24 * 60 * 60_000 && d.getTime() <= maxFuture).sort((a, b) => a.getTime() - b.getTime());
}

export async function fetchNextFomcDate(): Promise<ProviderState<{ date: number }>> {
  try {
    const res = await fetchHtml("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm");
    if (!res.ok) return { status: "error", provider: "Federal Reserve", message: `HTTP ${res.status}` };
    const html = await res.text();

    const raw = extractDatesNear(html, "FOMC Meeting", 300);
    // A sane calendar page yields a small handful of upcoming meetings, not
    // dozens — if the keyword-proximity parse returns something that looks
    // like noise, don't trust it.
    if (raw.length === 0 || raw.length > 30) return { status: "not_found", provider: "Federal Reserve" };

    const future = plausibleFutureDates(raw, Date.now());
    if (future.length === 0) return { status: "not_found", provider: "Federal Reserve" };

    return { status: "ok", data: { date: future[0].getTime() } };
  } catch (err: any) {
    const message = err?.name === "AbortError" ? "Request timed out reaching federalreserve.gov." : "Network error reaching federalreserve.gov.";
    return { status: "error", provider: "Federal Reserve", message };
  }
}

// Weekly Initial Jobless Claims — the Department of Labor releases this
// every Thursday at 8:30am ET, a fixed and publicly documented schedule.
// Computed directly rather than fetched/parsed, since there's nothing to
// parse: the date is deterministic, not published data that could change.
export function nextWeeklyJoblessClaimsDate(now: number): number {
  const d = new Date(now);
  const day = d.getUTCDay();
  const daysUntilThursday = (4 - day + 7) % 7;
  const candidate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysUntilThursday, 13, 30, 0, 0));
  if (candidate.getTime() < now) candidate.setUTCDate(candidate.getUTCDate() + 7);
  return candidate.getTime();
}

export async function fetchNextBeaReleaseDate(releaseKeyword: string, label: string): Promise<ProviderState<{ date: number }>> {
  try {
    const res = await fetchHtml("https://www.bea.gov/news/schedule");
    if (!res.ok) return { status: "error", provider: label, message: `HTTP ${res.status}` };
    const html = await res.text();

    const raw = extractDatesNear(html, releaseKeyword, 500);
    if (raw.length === 0 || raw.length > 20) return { status: "not_found", provider: label };

    const future = plausibleFutureDates(raw, Date.now());
    if (future.length === 0) return { status: "not_found", provider: label };

    const d = future[0];
    d.setUTCHours(12, 30, 0, 0); // BEA releases at 8:30am ET — approximate, DST-agnostic like the other sources here
    return { status: "ok", data: { date: d.getTime() } };
  } catch (err: any) {
    const message = err?.name === "AbortError" ? "Request timed out reaching bea.gov." : "Network error reaching bea.gov.";
    return { status: "error", provider: label, message };
  }
}

export async function fetchNextBlsReleaseDate(
  releaseKeyword: string,
  label: string
): Promise<ProviderState<{ date: number }>> {
  try {
    const year = new Date().getUTCFullYear();
    const res = await fetchHtml(`https://www.bls.gov/schedule/news_release/${year}_sched.htm`);
    if (!res.ok) return { status: "error", provider: label, message: `HTTP ${res.status}` };
    const html = await res.text();

    const raw = extractDatesNear(html, releaseKeyword, 500);
    if (raw.length === 0 || raw.length > 20) return { status: "not_found", provider: label };

    const future = plausibleFutureDates(raw, Date.now());
    if (future.length === 0) return { status: "not_found", provider: label };

    // BLS releases 8:30am ET ≈ 13:30 UTC (accounting for typical ET offset) — refine the naive noon-UTC parse above to the known standard release time.
    const d = future[0];
    d.setUTCHours(13, 30, 0, 0);
    return { status: "ok", data: { date: d.getTime() } };
  } catch (err: any) {
    const message = err?.name === "AbortError" ? "Request timed out reaching bls.gov." : "Network error reaching bls.gov.";
    return { status: "error", provider: label, message };
  }
}
