// Small keyless User-Agent heuristic — no external lookup service, just
// pattern matching against the handful of tokens that cover the vast
// majority of real traffic. Same "honest, best-effort" spirit as the
// rest of this app's local static analysis: good enough to tell a
// canary-token dashboard "Windows, Chrome, desktop" without needing a
// paid UA-parsing API.
export type ParsedUserAgent = {
  browser: string;
  os: string;
  deviceType: "desktop" | "mobile" | "tablet" | "unknown";
};

export function parseUserAgent(ua: string): ParsedUserAgent {
  if (!ua) return { browser: "Unknown", os: "Unknown", deviceType: "unknown" };

  let browser = "Unknown";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = "Safari";
  else if (/AdobeReader|Acrobat/i.test(ua)) browser = "Adobe Acrobat/Reader";
  else if (/MSIE|Trident/.test(ua)) browser = "Internet Explorer";

  let os = "Unknown";
  // iOS UAs always carry "like Mac OS X" as a compatibility token, so
  // the iPhone/iPad/iPod check must run before the Mac OS X one or
  // every iPhone gets misreported as a desktop Mac.
  if (/Windows NT/.test(ua)) os = "Windows";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";

  let deviceType: ParsedUserAgent["deviceType"] = "desktop";
  if (/iPad|Tablet/.test(ua)) deviceType = "tablet";
  else if (/Mobile|iPhone|Android/.test(ua)) deviceType = "mobile";

  return { browser, os, deviceType };
}
