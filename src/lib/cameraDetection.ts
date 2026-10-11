// Recognizes common IP-camera / DVR / NVR fingerprints from the same
// Shodan InternetDB data already used by the IP analyzer. This is
// pattern-matching on public metadata (open ports, CPE strings), not
// interaction with the device — nothing here connects to the camera
// itself.

export type CriticalPort = { port: number; service: string; note: string };

export type CameraSignals = {
  isLikelyCamera: boolean;
  matchedSignals: string[];
  criticalPorts: CriticalPort[];
  vendorGuess: string | null;
};

const CAMERA_PORT_SIGNATURES: Record<number, { service: string; note: string }> = {
  554: { service: "RTSP", note: "Video streaming protocol — classic IP camera signature." },
  8554: { service: "RTSP (alt)", note: "Alternate RTSP streaming port." },
  8000: { service: "Hikvision SDK/HTTP", note: "Common Hikvision device management port." },
  37777: { service: "Dahua DVR", note: "Dahua's proprietary TCP port — very commonly left open by default." },
  34567: { service: "DVR (generic)", note: "Used by many low-cost Chinese DVR/NVR brands." },
  9000: { service: "NVR/Camera admin", note: "Frequently used for NVR web management." },
  5000: { service: "Camera web UI", note: "Common consumer IP-camera web interface port." },
};

const VENDOR_KEYWORDS = [
  "hikvision", "dahua", "axis", "foscam", "dvr", "nvr", "onvif",
  "webcam", "ipcam", "cctv", "vivotek", "reolink", "amcrest", "uniview",
];

export function analyzeCameraSignals(internetdb: {
  ports: number[];
  hostnames: string[];
  cpes: string[];
  tags: string[];
}): CameraSignals {
  const matchedSignals: string[] = [];
  const criticalPorts: CriticalPort[] = [];

  for (const port of internetdb.ports) {
    const sig = CAMERA_PORT_SIGNATURES[port];
    if (sig) {
      criticalPorts.push({ port, ...sig });
      matchedSignals.push(`Port ${port} (${sig.service})`);
    }
  }

  const haystack = [
    ...internetdb.hostnames,
    ...internetdb.cpes,
    ...internetdb.tags,
  ].join(" ").toLowerCase();

  let vendorGuess: string | null = null;
  for (const kw of VENDOR_KEYWORDS) {
    if (haystack.includes(kw)) {
      matchedSignals.push(`Fingerprint match: "${kw}"`);
      if (!vendorGuess && ["hikvision", "dahua", "axis", "foscam", "vivotek", "reolink", "amcrest", "uniview"].includes(kw)) {
        vendorGuess = kw;
      }
    }
  }

  return {
    isLikelyCamera: matchedSignals.length > 0,
    matchedSignals,
    criticalPorts,
    vendorGuess,
  };
}

export function remediationAdvice(hasVulns: boolean, criticalPorts: CriticalPort[]): string[] {
  const advice = [
    "Change the default username and password immediately — the single most common cause of camera compromise.",
    "Don't expose the camera directly to the internet. Disable UPnP auto port-forwarding on the router and use a VPN for remote access instead.",
    "Update the firmware to the latest vendor version, especially if any CVEs are listed below.",
    "Disable unnecessary P2P/cloud discovery features (e.g. Dahua P2P, Hikvision's cloud service) if you don't actively use them — they're a common attack vector on consumer DVRs.",
    "Disable Telnet/FTP if enabled by default; use SSH or the vendor's HTTPS admin panel only.",
    "Put the camera on a separate VLAN/network segment, isolated from other devices.",
  ];

  if (criticalPorts.some((p) => p.port === 554 || p.port === 8554)) {
    advice.push("If RTSP is exposed, restrict it to trusted IPs via firewall rules — it typically has no built-in rate limiting against credential brute-forcing.");
  }
  if (hasVulns) {
    advice.unshift("This device has known CVEs listed below — treat firmware update as priority #1, not #3.");
  }

  return advice;
}
