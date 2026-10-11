import * as satellite from "satellite.js";

export type TleEntry = { name: string; line1: string; line2: string; group: string };
export type SatellitePosition = { name: string; group: string; latitude: number; longitude: number; altitudeKm: number };

export function propagateAll(entries: TleEntry[], date: Date): SatellitePosition[] {
  const results: SatellitePosition[] = [];

  for (const entry of entries) {
    try {
      const satrec = satellite.twoline2satrec(entry.line1, entry.line2);
      const posVel = satellite.propagate(satrec, date);
      if (!posVel || typeof posVel.position === "boolean" || !posVel.position) continue;
      // A structurally invalid TLE doesn't make twoline2satrec/propagate
      // throw or return `false` the way a decayed/invalid-orbit failure
      // does — it silently returns a position with null x/y/z instead,
      // which would otherwise flow through eciToGeodetic into a
      // NaN-filled "position" that looks like a normal result to every
      // caller. Catch that here rather than ever pushing NaN coordinates.
      const { x, y, z } = posVel.position;
      if (x === null || y === null || z === null || Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;

      const gmst = satellite.gstime(date);
      const geo = satellite.eciToGeodetic(posVel.position, gmst);

      const latitude = satellite.degreesLat(geo.latitude);
      const longitude = satellite.degreesLong(geo.longitude);
      if (Number.isNaN(latitude) || Number.isNaN(longitude) || Number.isNaN(geo.height)) continue;

      results.push({ name: entry.name, group: entry.group, latitude, longitude, altitudeKm: geo.height });
    } catch {
      continue;
    }
  }

  return results;
}
