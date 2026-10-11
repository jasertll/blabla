// Builds real, keyless search URLs — no API, no scraping. Each one opens
// the actual search engine's own free public web UI in a new tab, with
// the query already filled in; the real search executes on the engine
// itself, not inside this app. This is the same thing a human does by
// right-clicking "Search image" in a browser, just assembled for them.
//
// Image-based engines need a fetchable image URL (none of them accept
// a direct file upload via URL parameter) — see app/api/imageintel/stage
// for the opt-in, short-lived public hosting that makes `imageUrl` exist
// in the first place. Text-based engines need no hosting at all.
//
// Yandex is listed first deliberately, not alphabetically: OSINT
// practitioners (Bellingcat and others have written about this
// repeatedly) consistently find Yandex's reverse image search more
// accurate than Google's for faces and locations specifically, which is
// exactly what an investigation tool's analyst is usually looking for.

export type ReverseSearchEngine = "yandex" | "google-lens" | "tineye" | "bing";

export function buildReverseImageSearchUrl(engine: ReverseSearchEngine, imageUrl: string): string {
  const encoded = encodeURIComponent(imageUrl);
  switch (engine) {
    case "yandex":
      return `https://yandex.com/images/search?rpt=imageview&url=${encoded}`;
    case "google-lens":
      return `https://lens.google.com/uploadbyurl?url=${encoded}`;
    case "tineye":
      return `https://tineye.com/search?url=${encoded}`;
    case "bing":
      return `https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIVSP&sbisrc=UrlPaste&q=imgurl:${encoded}`;
  }
}

export const REVERSE_SEARCH_ENGINES: { id: ReverseSearchEngine; label: string; note: string }[] = [
  { id: "yandex", label: "Yandex", note: "Widely regarded in OSINT practice as the strongest free reverse-image search for faces and locations." },
  { id: "google-lens", label: "Google Lens", note: "Strong for objects, landmarks, and on-image text." },
  { id: "tineye", label: "TinEye", note: "Best for exact/cropped/recompressed copies — weaker for merely similar images." },
  { id: "bing", label: "Bing Visual Search", note: "General-purpose fallback." },
];

export type TextSearchEngine = "google" | "duckduckgo";

export function buildTextSearchUrl(engine: TextSearchEngine, query: string): string {
  const encoded = encodeURIComponent(query);
  return engine === "google" ? `https://www.google.com/search?q=${encoded}` : `https://duckduckgo.com/?q=${encoded}`;
}
