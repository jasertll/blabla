export type CanaryHit = {
  ip: string;
  country: string;
  city: string | null;
  isp: string | null;
  browser: string;
  os: string;
  deviceType: "desktop" | "mobile" | "tablet" | "unknown";
  ua: string;
  at: number;
};

export type CanaryTokenMeta = {
  label: string;
  createdAt: number;
  // "pdf-beacon" (or absent, for tokens created before this field
  // existed): a PDF whose own JavaScript calls home — only fires in
  // Adobe Acrobat/Reader. "link": a shareable URL that logs the hit on
  // any device/browser before serving the file back — works for any
  // file type, but only for opens of that link itself, not further
  // copies someone downloads and forwards as a raw file.
  kind?: "pdf-beacon" | "link";
  filename?: string;
};

export type CanaryTokenWithHits = CanaryTokenMeta & {
  token: string;
  hits: CanaryHit[];
};
