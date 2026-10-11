import { NextResponse } from "next/server";

export const revalidate = 30;

type IssPosition = { latitude: number; longitude: number; timestamp: number } | null;
type CloseApproach = {
  designation: string;
  dateCloseApproach: string;
  distanceLunar: number;
  velocityKmS: number;
  diameterEstimateKm: string;
};

async function fetchIss(): Promise<IssPosition> {
  try {
    const res = await fetch("https://api.wheretheiss.at/v1/satellites/25544", {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { latitude: data.latitude, longitude: data.longitude, timestamp: data.timestamp };
  } catch {
    return null;
  }
}

async function fetchCloseApproaches(): Promise<CloseApproach[]> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(
      `https://ssd-api.jpl.nasa.gov/cad.api?date-min=${today}&date-max=%2B60&dist-max=0.2&sort=date`,
      { cache: "no-store", signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const fields: string[] = data.fields ?? [];
    const idx = (name: string) => fields.indexOf(name);

    return (data.data ?? []).slice(0, 12).map((row: string[]) => ({
      designation: row[idx("des")],
      dateCloseApproach: row[idx("cd")],
      distanceLunar: parseFloat(row[idx("dist")]) * 389.17,
      velocityKmS: parseFloat(row[idx("v_rel")]),
      diameterEstimateKm: row[idx("h")],
    }));
  } catch {
    return [];
  }
}

type Astronaut = { name: string; craft: string };

async function fetchAstronauts(): Promise<Astronaut[]> {
  try {
    const res = await fetch("http://api.open-notify.org/astros.json", {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.people ?? []).map((p: any) => ({ name: p.name, craft: p.craft }));
  } catch {
    return [];
  }
}

type Fireball = {
  date: string;
  energyKt: number | null;
  latitude: number | null;
  longitude: number | null;
};

async function fetchFireballs(): Promise<Fireball[]> {
  try {
    // NASA CNEOS Fireball API — free, public, no key. Real atmospheric
    // impact ("shooting star" / bolide) events reported by US Government
    // sensors, going back through recent history.
    const res = await fetch("https://ssd-api.jpl.nasa.gov/fireball.api?limit=15", {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const fields: string[] = data.fields ?? [];
    const idx = (name: string) => fields.indexOf(name);
    return (data.data ?? []).map((row: string[]) => ({
      date: row[idx("date")],
      energyKt: row[idx("energy")] ? parseFloat(row[idx("energy")]) : null,
      latitude: row[idx("lat")] ? parseFloat(row[idx("lat")]) : null,
      longitude: row[idx("lon")] ? parseFloat(row[idx("lon")]) : null,
    }));
  } catch {
    return [];
  }
}

export async function GET() {
  const [iss, closeApproaches, astronauts, fireballs] = await Promise.all([
    fetchIss(),
    fetchCloseApproaches(),
    fetchAstronauts(),
    fetchFireballs(),
  ]);
  return NextResponse.json({ iss, closeApproaches, astronauts, fireballs, fetchedAt: new Date().toISOString() });
}
