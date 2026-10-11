// Pure query-string generation — no network calls. Builds a curated set
// of Google/Bing dorks, each with a direct search-engine URL. Purely a
// query composer: it never fetches results itself, so there's nothing
// here that can be rate-limited or need a key.

export type DorkCategory = {
  category: string;
  items: { label: string; query: string; risk: "info" | "caution" | "sensitive" }[];
};

function googleUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
function bingUrl(query: string): string {
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
}

export type DorkResult = { label: string; query: string; risk: "info" | "caution" | "sensitive"; googleUrl: string; bingUrl: string };
export type DorkMode = "domain" | "person";

// Same domain-shape check used by lib/detectIndicator.ts — anything that
// doesn't look like a real hostname (a person's name, a book title, a
// company name with spaces) falls through to the person/topic dorks
// instead, since `site:` only means something in front of an actual
// domain. Feeding a name into `site:<name>` is a malformed query and
// silently returns zero results — that mismatch, not a broken dork, is
// why "site:<my name> filetype:pdf" comes back empty.
const DOMAIN_SHAPE = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63})+$/;

function detectMode(cleanedTarget: string): DorkMode {
  return DOMAIN_SHAPE.test(cleanedTarget) ? "domain" : "person";
}

function buildDomainDorks(target: string): DorkCategory[] {
  return [
    {
      category: "Exposed Documents",
      items: [
        { label: "Office documents", query: `site:${target} (filetype:doc OR filetype:docx OR filetype:xls OR filetype:xlsx OR filetype:ppt OR filetype:pptx)`, risk: "caution" },
        { label: "PDFs", query: `site:${target} filetype:pdf`, risk: "info" },
        { label: "Config / backup files", query: `site:${target} (ext:env OR ext:bak OR ext:sql OR ext:log OR ext:config OR ext:ini)`, risk: "sensitive" },
        { label: "Exposed .git", query: `site:${target} inurl:".git"`, risk: "sensitive" },
      ],
    },
    {
      category: "Login & Admin Surfaces",
      items: [
        { label: "Login panels", query: `site:${target} (inurl:login OR inurl:signin OR inurl:wp-login)`, risk: "caution" },
        { label: "Admin panels", query: `site:${target} (inurl:admin OR inurl:dashboard OR inurl:cpanel)`, risk: "caution" },
        { label: "phpMyAdmin / DB tools", query: `site:${target} (inurl:phpmyadmin OR inurl:adminer)`, risk: "sensitive" },
      ],
    },
    {
      category: "Indexed Directories & Errors",
      items: [
        { label: "Open directory listings", query: `site:${target} intitle:"index of"`, risk: "sensitive" },
        { label: "Error / stack traces", query: `site:${target} (intext:"stack trace" OR intext:"sql syntax" OR intext:"fatal error")`, risk: "sensitive" },
        { label: "Server/software version banners", query: `site:${target} (intext:"Apache/" OR intext:"nginx/" OR intext:"Powered by")`, risk: "info" },
      ],
    },
    {
      category: "Subdomains & Attack Surface",
      items: [
        { label: "All indexed subdomains", query: `site:*.${target} -site:www.${target}`, risk: "info" },
        { label: "Dev/staging/test environments", query: `site:${target} (inurl:dev OR inurl:staging OR inurl:test OR inurl:uat)`, risk: "caution" },
        { label: "API endpoints", query: `site:${target} (inurl:api OR inurl:v1 OR inurl:v2 OR inurl:graphql)`, risk: "info" },
      ],
    },
    {
      category: "Leaked Credentials & Secrets",
      items: [
        { label: "GitHub — secrets mentioning this domain", query: `site:github.com "${target}" (password OR api_key OR apikey OR secret OR token)`, risk: "sensitive" },
        { label: "Pastebin mentions", query: `site:pastebin.com "${target}"`, risk: "sensitive" },
        { label: "Trello/Google Docs leaks", query: `site:trello.com OR site:docs.google.com "${target}"`, risk: "caution" },
      ],
    },
    {
      category: "People & Contact Info",
      items: [
        { label: "Email addresses on domain", query: `site:${target} intext:"@${target}"`, risk: "caution" },
        { label: "LinkedIn employees", query: `site:linkedin.com/in "${target}"`, risk: "info" },
        { label: "Resumes/CVs mentioning domain", query: `filetype:pdf (resume OR cv) "${target}"`, risk: "info" },
      ],
    },
  ];
}

// For a person's name, a company name, a book title, or any other
// non-domain query — no `site:<query>` here, since the query itself
// isn't a hostname. `site:` is only used where it's paired with an
// actual platform domain (facebook.com, linkedin.com, etc.).
function buildPersonDorks(query: string): DorkCategory[] {
  const q = `"${query}"`;
  return [
    {
      category: "Social Media Profiles",
      items: [
        { label: "Facebook", query: `site:facebook.com ${q}`, risk: "info" },
        { label: "Instagram", query: `site:instagram.com ${q}`, risk: "info" },
        { label: "LinkedIn", query: `site:linkedin.com/in ${q}`, risk: "info" },
        { label: "X / Twitter", query: `(site:twitter.com OR site:x.com) ${q}`, risk: "info" },
        { label: "TikTok", query: `site:tiktok.com ${q}`, risk: "info" },
      ],
    },
    {
      category: "Documents & Files",
      items: [
        { label: "PDFs mentioning this", query: `filetype:pdf ${q}`, risk: "info" },
        { label: "Office documents mentioning this", query: `(filetype:doc OR filetype:docx OR filetype:xls OR filetype:xlsx OR filetype:ppt OR filetype:pptx) ${q}`, risk: "info" },
        { label: "Resumes/CVs", query: `filetype:pdf (resume OR cv) ${q}`, risk: "info" },
      ],
    },
    {
      category: "General Web Mentions",
      items: [
        { label: "Exact phrase anywhere", query: q, risk: "info" },
        { label: "In page titles", query: `intitle:${q}`, risk: "info" },
        { label: "In page body text", query: `intext:${q}`, risk: "info" },
        { label: "Excluding social media noise", query: `${q} -site:facebook.com -site:instagram.com -site:twitter.com -site:x.com`, risk: "info" },
      ],
    },
    {
      category: "Forums, Leaks & Pastes",
      items: [
        { label: "Reddit mentions", query: `site:reddit.com ${q}`, risk: "info" },
        { label: "Pastebin mentions", query: `site:pastebin.com ${q}`, risk: "sensitive" },
        { label: "GitHub mentions", query: `site:github.com ${q}`, risk: "info" },
      ],
    },
  ];
}

export function buildDorks(rawTarget: string): { category: string; items: DorkResult[] }[] {
  const cleaned = rawTarget.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!rawTarget.trim()) return [];

  const mode = detectMode(cleaned);
  const categories = mode === "domain" ? buildDomainDorks(cleaned) : buildPersonDorks(rawTarget.trim());

  return categories.map((c) => ({
    category: c.category,
    items: c.items.map((i) => ({ ...i, googleUrl: googleUrl(i.query), bingUrl: bingUrl(i.query) })),
  }));
}

export function detectDorkMode(rawTarget: string): DorkMode {
  const cleaned = rawTarget.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return detectMode(cleaned);
}
