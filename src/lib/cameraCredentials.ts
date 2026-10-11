// Real, widely-published default credentials for common camera/DVR/NVR
// vendors — the same public knowledge Mirai-class botnets and hardening
// guides both already rely on. Listed for authorized-testing/hardening
// checklists only (this tool never attempts to log in with them).

export type DefaultCredential = { username: string; password: string; note?: string };

export const DEFAULT_CREDENTIALS: Record<string, DefaultCredential[]> = {
  hikvision: [
    { username: "admin", password: "12345" },
    { username: "admin", password: "admin12345" },
  ],
  dahua: [
    { username: "admin", password: "admin" },
    { username: "888888", password: "888888" },
    { username: "666666", password: "666666" },
  ],
  foscam: [
    { username: "admin", password: "" , note: "blank password by default on many models"},
  ],
  axis: [
    { username: "root", password: "pass" },
  ],
  vivotek: [
    { username: "root", password: "" , note: "blank password prompted on first setup, often skipped"},
  ],
  reolink: [
    { username: "admin", password: "" , note: "blank password by default"},
  ],
  amcrest: [
    { username: "admin", password: "admin" },
  ],
  uniview: [
    { username: "admin", password: "123456" },
  ],
  generic: [
    { username: "admin", password: "admin" },
    { username: "admin", password: "1234" },
    { username: "admin", password: "" },
    { username: "root", password: "12345" },
    { username: "user", password: "user" },
  ],
};

export function credentialsForVendor(vendor: string | null): DefaultCredential[] {
  if (vendor && DEFAULT_CREDENTIALS[vendor]) return DEFAULT_CREDENTIALS[vendor];
  return DEFAULT_CREDENTIALS.generic;
}
