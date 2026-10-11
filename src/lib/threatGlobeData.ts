export type GlobeStats = {
  topVendor: { name: string; count: number } | null;
  highestCve: { id: string; score: number } | null;
  ransomwareCount: number;
  totalKev: number;
  totalCritical: number;
  latestKev: { id: string; product: string; dateAdded: string } | null;
  kevList: { id: string; product: string; dateAdded: string; ransomware: boolean }[];
  cveList: { id: string; score: number | null; published: string | null }[];
};

export async function fetchGlobeStats(): Promise<GlobeStats> {
  const [kevRes, cveRes] = await Promise.all([
    fetch("/api/kev").then((r) => r.json()).catch(() => ({ items: [] })),
    fetch("/api/cve").then((r) => r.json()).catch(() => ({ items: [] })),
  ]);

  const kevItems: any[] = kevRes.items ?? [];
  const cveItems: any[] = cveRes.items ?? [];

  const vendorCounts = new Map<string, number>();
  for (const k of kevItems) {
    vendorCounts.set(k.vendorProject, (vendorCounts.get(k.vendorProject) ?? 0) + 1);
  }
  let topVendor: GlobeStats["topVendor"] = null;
  for (const [name, count] of vendorCounts.entries()) {
    if (!topVendor || count > topVendor.count) topVendor = { name, count };
  }

  let highestCve: GlobeStats["highestCve"] = null;
  for (const c of cveItems) {
    if (c.score !== null && (!highestCve || c.score > highestCve.score)) {
      highestCve = { id: c.id, score: c.score };
    }
  }

  const ransomwareCount = kevItems.filter((k) => k.knownRansomwareUse).length;
  const latestKevRaw = [...kevItems].sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime())[0];

  return {
    topVendor,
    highestCve,
    ransomwareCount,
    totalKev: kevItems.length,
    totalCritical: cveItems.length,
    latestKev: latestKevRaw
      ? { id: latestKevRaw.cveID, product: `${latestKevRaw.vendorProject} ${latestKevRaw.product}`, dateAdded: latestKevRaw.dateAdded }
      : null,
    kevList: [...kevItems]
      .sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime())
      .map((k) => ({ id: k.cveID, product: `${k.vendorProject} ${k.product}`, dateAdded: k.dateAdded, ransomware: k.knownRansomwareUse })),
    cveList: cveItems.map((c) => ({ id: c.id, score: c.score, published: c.published })),
  };
}
