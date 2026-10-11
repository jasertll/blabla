"use client";

import { Radar } from "lucide-react";
import ArchiveLookup from "@/components/recon/ArchiveLookup";
import DorkBuilder from "@/components/recon/DorkBuilder";
import FaviconPivot from "@/components/recon/FaviconPivot";
import TyposquatChecker from "@/components/recon/TyposquatChecker";
import QrDecoder from "@/components/recon/QrDecoder";
import EmailAccountsLookup from "@/components/recon/EmailAccountsLookup";
import TorDirectory from "@/components/recon/TorDirectory";
import WifiGeolocate from "@/components/recon/WifiGeolocate";

export default function ReconToolkit() {
  return (
    <div className="glass-panel p-4 space-y-4">
      <div>
        <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
          <Radar className="h-4 w-4 text-accent" /> Recon Toolkit
        </h2>
        <p className="text-xs text-slate-500">
          Passive reconnaissance and pivoting utilities from the OSINT Framework — historical
          archive snapshots, search-engine dorks, favicon fingerprint pivoting, phishing/lookalike
          domain detection, a local QR decoder, email/breach lookup, WiFi BSSID geolocation, and a
          curated legitimate Tor onion-services directory. All keyless (or work keyless with
          reduced results, clearly labeled where a paid key would unlock more).
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ArchiveLookup />
        <DorkBuilder />
        <FaviconPivot />
        <TyposquatChecker />
        <QrDecoder />
        <EmailAccountsLookup />
        <WifiGeolocate />
        <TorDirectory />
      </div>
    </div>
  );
}
