import type { ProviderState } from "@/lib/osintTypes";

// Real headlines from official, publicly-documented RSS feeds — not an
// auto-scored "impact on gold" analysis, because there's no honest way to
// deterministically quantify how a geopolitical headline will move the
// market. This just surfaces real, recent, real-source headlines for the
// user to read and judge herself, same spirit as the rest of this engine:
// show real data, never fabricate a conclusion we can't actually support.

export type Headline = { title: string; link: string; pubDate: number | null; source: string };

const FEEDS: { url: string; source: string; category: "world" | "business" }[] = [
  { url: "http://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC World", category: "world" },
  { url: "https://www.cnbc.com/id/100727362/device/rss/rss.html", source: "CNBC Economy", category: "business" },
];

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function parseRss(xml: string, source: string): Headline[] {
  const items: Headline[] = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const block of itemBlocks) {
    const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkMatch = block.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
    const dateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    if (!titleMatch) continue;

    const title = decodeEntities(titleMatch[1].trim());
    const link = linkMatch ? decodeEntities(linkMatch[1].trim()) : "";
    const pubDate = dateMatch ? new Date(dateMatch[1].trim()).getTime() : null;

    items.push({ title, link, pubDate: pubDate && !isNaN(pubDate) ? pubDate : null, source });
  }
  return items;
}

async function fetchOneFeed(url: string, source: string): Promise<Headline[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml, source);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchHeadlines(): Promise<ProviderState<{ world: Headline[]; business: Headline[] }>> {
  const results = await Promise.all(FEEDS.map((f) => fetchOneFeed(f.url, f.source).then((items) => ({ category: f.category, items }))));

  const world = results.filter((r) => r.category === "world").flatMap((r) => r.items);
  const business = results.filter((r) => r.category === "business").flatMap((r) => r.items);

  const sortRecent = (items: Headline[]) => [...items].sort((a, b) => (b.pubDate ?? 0) - (a.pubDate ?? 0)).slice(0, 10);

  if (world.length === 0 && business.length === 0) {
    return { status: "error", provider: "News Headlines", message: "تعذّر جلب أي عناوين أخبار حالياً." };
  }

  return { status: "ok", data: { world: sortRecent(world), business: sortRecent(business) } };
}
