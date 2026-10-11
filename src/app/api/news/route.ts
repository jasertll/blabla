import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";

export const revalidate = 300; // cache for 5 minutes

const FEEDS = [
  { source: "The Hacker News", url: "https://feeds.feedburner.com/TheHackersNews" },
  { source: "BleepingComputer", url: "https://www.bleepingcomputer.com/feed/" },
];

type NewsItem = {
  title: string;
  link: string;
  source: string;
  pubDate: string;
};

async function fetchFeed(source: string, url: string): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "cti-dashboard-rss-reader/1.0" },
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error(`Feed ${source} returned ${res.status}`);

    const xml = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml);
    const items = parsed?.rss?.channel?.item ?? [];
    const list = Array.isArray(items) ? items : [items];

    return list.slice(0, 10).map((item: any) => ({
      title: String(item.title ?? "Untitled"),
      link: String(item.link ?? "#"),
      source,
      pubDate: String(item.pubDate ?? ""),
    }));
  } catch (err) {
    // Graceful degradation: one dead feed shouldn't break the whole panel.
    return [];
  }
}

export async function GET() {
  const results = await Promise.all(
    FEEDS.map((f) => fetchFeed(f.source, f.url))
  );
  const merged = results
    .flat()
    .sort((a, b) => (a.pubDate < b.pubDate ? 1 : -1));

  return NextResponse.json({
    items: merged,
    sourcesOk: results.map((r, i) => ({ source: FEEDS[i].source, ok: r.length > 0 })),
    fetchedAt: new Date().toISOString(),
  });
}
