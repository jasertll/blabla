import { NextResponse } from "next/server";

export const revalidate = 3600;

type TleEntry = { name: string; line1: string; line2: string; group: string };

const GROUPS = [
  { id: "stations", url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle" },
  { id: "visual", url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle" },
];

function parseTle(text: string, group: string): TleEntry[] {
  const lines = text.split("\n").map((l) => l.trimEnd()).filter(Boolean);
  const entries: TleEntry[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    if (lines[i + 1]?.startsWith("1 ") && lines[i + 2]?.startsWith("2 ")) {
      entries.push({ name: lines[i].trim(), line1: lines[i + 1], line2: lines[i + 2], group });
    }
  }
  return entries;
}

export async function GET() {
  try {
    const results = await Promise.all(
      GROUPS.map(async (g) => {
        try {
          const res = await fetch(g.url, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(8000) });
          if (!res.ok) return [];
          const text = await res.text();
          return parseTle(text, g.id);
        } catch {
          return [];
        }
      })
    );

    const seen = new Set<string>();
    const merged: TleEntry[] = [];
    for (const entry of results.flat()) {
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      merged.push(entry);
      if (merged.length >= 60) break;
    }

    return NextResponse.json({ satellites: merged, fetchedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ satellites: [], fetchedAt: new Date().toISOString() });
  }
}
