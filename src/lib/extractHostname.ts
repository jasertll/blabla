export function extractHostname(input: string): string {
  let value = input.trim().toLowerCase();
  if (!value) return value;

  // No protocol? Add one temporarily so URL() can parse it — this is what
  // was failing before: "example.com/page" or a bare "example.com" with
  // no scheme isn't reliably parseable by URL() on its own.
  if (!/^https?:\/\//.test(value)) {
    value = `https://${value}`;
  }

  try {
    return new URL(value).hostname;
  } catch {
    // Last-resort fallback: strip protocol and anything after the first slash by hand.
    return value.replace(/^https?:\/\//, "").split("/")[0];
  }
}
