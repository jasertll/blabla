export function defang(input: string): string {
  return input
    .replace(/https:\/\//gi, "hxxps://")
    .replace(/http:\/\//gi, "hxxp://")
    .replace(/\./g, "[.]")
    .replace(/@/g, "[at]");
}

export function refang(input: string): string {
  return input
    .replace(/hxxps:\/\//gi, "https://")
    .replace(/hxxp:\/\//gi, "http://")
    .replace(/\[\.\]/g, ".")
    .replace(/\[at\]/gi, "@");
}
