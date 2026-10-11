export type TimestampConversions = {
  iso: string;
  unixSeconds: number;
  unixMillis: number;
  windowsFileTime: string;
  utc: string;
  local: string;
};

export function convertFromDate(date: Date): TimestampConversions {
  const unixMillis = date.getTime();
  const unixSeconds = Math.floor(unixMillis / 1000);
  // Windows FILETIME: 100-nanosecond intervals since 1601-01-01 UTC.
  const EPOCH_DIFF_MS = 11644473600000; // ms between 1601-01-01 and 1970-01-01
  const fileTime = BigInt(unixMillis + EPOCH_DIFF_MS) * 10000n;

  return {
    iso: date.toISOString(),
    unixSeconds,
    unixMillis,
    windowsFileTime: fileTime.toString(),
    utc: date.toUTCString(),
    local: date.toString(),
  };
}

export function parseUnixSeconds(value: string): Date | null {
  const n = Number(value);
  if (isNaN(n)) return null;
  return new Date(n * 1000);
}

export function parseUnixMillis(value: string): Date | null {
  const n = Number(value);
  if (isNaN(n)) return null;
  return new Date(n);
}

export function parseWindowsFileTime(value: string): Date | null {
  try {
    const ft = BigInt(value);
    const EPOCH_DIFF_MS = 11644473600000n;
    const ms = ft / 10000n - EPOCH_DIFF_MS;
    return new Date(Number(ms));
  } catch {
    return null;
  }
}

export function parseIso(value: string): Date | null {
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}
