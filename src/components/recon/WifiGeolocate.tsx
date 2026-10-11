"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Wifi, Loader2, ExternalLink, Pin, FileDown } from "lucide-react";
import { ProviderBadge } from "@/components/ResolvedIpPanel";
import type { WifiLookupResult, WifiSsidSearchResult } from "@/app/api/osint/wifi/route";
import { useInvestigation } from "@/contexts/InvestigationContext";
import { buildWifiReport, buildWifiSsidReport, openReport } from "@/lib/reportGenerator";

type Mode = "bssid" | "ssid";

export default function WifiGeolocate() {
  const [mode, setMode] = useState<Mode>("bssid");
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bssidData, setBssidData] = useState<WifiLookupResult | null>(null);
  const [ssidData, setSsidData] = useState<WifiSsidSearchResult | null>(null);
  const { incrementSessionCount, mergeGraph, setToolAlert, addTimelineEvent } = useInvestigation();

  async function scan() {
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    setBssidData(null);
    setSsidData(null);
    try {
      const param = mode === "bssid" ? `bssid=${encodeURIComponent(target.trim())}` : `ssid=${encodeURIComponent(target.trim())}`;
      const res = await fetch(`/api/osint/wifi?${param}`);
      const json = await res.json();
      if (!res.ok) {
        setError((json as any).error ?? `HTTP ${res.status}`);
        return;
      }
      incrementSessionCount();
      if (mode === "bssid") {
        setBssidData(json);
        addTimelineEvent({ tool: "recon", label: "WiFi BSSID geolocation", detail: target.trim() });
        setToolAlert("recon", json.location.status === "ok");
      } else {
        setSsidData(json);
        addTimelineEvent({ tool: "recon", label: "WiFi SSID search", detail: target.trim() });
        setToolAlert("recon", json.matches.status === "ok");
      }
    } catch {
      setError("Network error reaching the WiFi geolocation API.");
    } finally {
      setLoading(false);
    }
  }

  function pinBssid() {
    if (!bssidData || bssidData.location.status !== "ok") return;
    const id = `wifi:${bssidData.bssid}`;
    mergeGraph(
      [{ id, type: "wifi", label: bssidData.bssid, detail: `${bssidData.location.data.lat.toFixed(4)}, ${bssidData.location.data.lon.toFixed(4)}` }],
      []
    );
  }

  function pinSsidMatch(bssid: string, lat: number, lon: number) {
    const id = `wifi:${bssid}`;
    mergeGraph(
      [{ id, type: "wifi", label: bssid, detail: `${ssidData?.ssid} · ${lat.toFixed(4)}, ${lon.toFixed(4)}`, raw: { ssid: ssidData?.ssid } }],
      []
    );
  }

  function exportBssidReport() {
    if (!bssidData || bssidData.location.status !== "ok") return;
    openReport(buildWifiReport(bssidData.bssid, bssidData.location.data));
  }

  function exportSsidReport() {
    if (!ssidData || ssidData.matches.status !== "ok") return;
    openReport(buildWifiSsidReport(ssidData.ssid, ssidData.matches.data.items));
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <Wifi className="h-3.5 w-3.5 text-accent" /> WiFi Geolocation
      </p>
      <p className="text-[11px] text-slate-500">
        Two search modes over real wardriving databases: by{" "}
        <span className="text-slate-300">BSSID</span> (Mylnikov, free/keyless) when you already
        have the access point's MAC address, or by{" "}
        <span className="text-slate-300">network name</span> (WiGLE, needs a free account — see{" "}
        <code className="font-mono">WIGLE_API_NAME</code>/<code className="font-mono">WIGLE_API_TOKEN</code>)
        when you only know the SSID. Both return approximate location/metadata only — never a
        password, which would enable unauthorized network access rather than just identify one.
      </p>

      <div className="flex gap-1.5">
        <button
          onClick={() => { setMode("bssid"); setTarget(""); setError(null); setBssidData(null); setSsidData(null); }}
          className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${mode === "bssid" ? "border-accent text-accent-glow bg-accent/10" : "border-border text-slate-500 hover:text-slate-300"}`}
        >
          By BSSID/MAC
        </button>
        <button
          onClick={() => { setMode("ssid"); setTarget(""); setError(null); setBssidData(null); setSsidData(null); }}
          className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${mode === "ssid" ? "border-accent text-accent-glow bg-accent/10" : "border-border text-slate-500 hover:text-slate-300"}`}
        >
          By Network Name (SSID)
        </button>
      </div>

      <div className="flex gap-2">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && scan()}
          placeholder={mode === "bssid" ? "e.g. AA:BB:CC:DD:EE:FF" : "e.g. MyHomeNetwork"}
          dir="ltr"
          className="flex-1 bg-panel/60 border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
        />
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={scan}
          disabled={loading || !target.trim()}
          className="text-xs px-3 py-1.5 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Lookup"}
        </motion.button>
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}

      {mode === "bssid" && bssidData && !loading && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          <ProviderBadge state={bssidData.location} label="Mylnikov WiFi Geolocation" />
          {bssidData.location.status === "not_found" && (
            <p className="text-xs text-slate-500">No record of this BSSID in the wardriving database.</p>
          )}
          {bssidData.location.status === "ok" && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-3 text-xs text-slate-300">
                <span><span className="text-slate-500">Lat:</span> {bssidData.location.data.lat.toFixed(5)}</span>
                <span><span className="text-slate-500">Lon:</span> {bssidData.location.data.lon.toFixed(5)}</span>
                {bssidData.location.data.rangeMeters !== null && (
                  <span><span className="text-slate-500">Est. accuracy:</span> ±{bssidData.location.data.rangeMeters}m</span>
                )}
              </div>
              <a
                href={`https://www.openstreetmap.org/?mlat=${bssidData.location.data.lat}&mlon=${bssidData.location.data.lon}#map=16/${bssidData.location.data.lat}/${bssidData.location.data.lon}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-accent-glow hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> View on OpenStreetMap
              </a>
              <div className="flex gap-2">
                <button
                  onClick={pinBssid}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
                >
                  <Pin className="h-3 w-3" /> Pin to Intelligence Graph
                </button>
                <button
                  onClick={exportBssidReport}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
                >
                  <FileDown className="h-3 w-3" /> Export Report
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {mode === "ssid" && ssidData && !loading && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          <ProviderBadge state={ssidData.matches} label="WiGLE" />
          {ssidData.matches.status === "not_found" && (
            <p className="text-xs text-slate-500">No networks named "{ssidData.ssid}" in WiGLE's database.</p>
          )}
          {ssidData.matches.status === "ok" && (
            <div className="space-y-1.5">
              <button
                onClick={exportSsidReport}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
              >
                <FileDown className="h-3 w-3" /> Export Report
              </button>
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {ssidData.matches.data.items.map((m) => (
                <div key={m.bssid} className="rounded-lg border border-border bg-[#0d0a18] px-2.5 py-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-200">{m.bssid}</span>
                    {m.encryption && <span className="text-slate-500">{m.encryption}</span>}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${m.lat}&mlon=${m.lon}#map=16/${m.lat}/${m.lon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-accent-glow hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> Map
                    </a>
                    <button
                      onClick={() => pinSsidMatch(m.bssid, m.lat, m.lon)}
                      className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-border text-slate-400 hover:border-accent/50 hover:text-slate-200 transition-colors"
                    >
                      <Pin className="h-2.5 w-2.5" /> Pin
                    </button>
                  </div>
                </div>
              ))}
              {ssidData.matches.data.truncated && (
                <p className="text-[10px] text-slate-600">More results exist — showing the first {ssidData.matches.data.items.length}.</p>
              )}
            </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
