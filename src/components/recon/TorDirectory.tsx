"use client";

import { Shield, ExternalLink } from "lucide-react";
import { useInvestigation } from "@/contexts/InvestigationContext";

// Deliberately NOT a "most popular onion links" aggregator — that surface
// is dominated by illegal marketplaces we have no way to filter for at
// scale. This is a small, hand-vetted list of real organizations that
// publicly run an official onion service, so you don't have to search
// for one each time. We link each org's own clearnet page (which they
// keep current) rather than a raw .onion address memorized/guessed here
// — a stale or mistyped .onion string is worse than useless, since it
// silently sends you nowhere or to a squatted lookalike instead.
const ENTRIES: { name: string; url: string; note: string }[] = [
  {
    name: "Tor Project — Official Onion Services",
    url: "https://community.torproject.org/onion-services/",
    note: "Tor Project's own directory of vetted, notable onion services — the most reliable starting point.",
  },
  {
    name: "Tor Project (main site)",
    url: "https://www.torproject.org/",
    note: "Tor Browser downloads, docs, and the project's own onion mirror (linked from the site).",
  },
  {
    name: "Ahmia — onion search engine",
    url: "https://ahmia.fi/",
    note: "A moderated onion search engine (filters abuse content) with a normal clearnet site — often the safer entry point vs. unmoderated dark-web search engines.",
  },
  {
    name: "SecureDrop Directory",
    url: "https://securedrop.org/directory/",
    note: "Official, verified list of news organizations' SecureDrop onion addresses for anonymous tips.",
  },
  {
    name: "ProPublica",
    url: "https://www.propublica.org/",
    note: "Investigative newsroom with a documented onion mirror — check their site's help/about section for the current address.",
  },
  {
    name: "The New York Times",
    url: "https://www.nytimes.com/",
    note: "Runs an official onion mirror, documented in their help center.",
  },
  {
    name: "BBC News",
    url: "https://www.bbc.com/news",
    note: "Publishes an onion mirror for audiences in countries that block bbc.com — documented on their site.",
  },
  {
    name: "DuckDuckGo",
    url: "https://duckduckgo.com/",
    note: "Onion address is auto-detected by Tor Browser's onion-location feature when you visit the regular site.",
  },
];

export default function TorDirectory() {
  const { addTimelineEvent } = useInvestigation();

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <Shield className="h-3.5 w-3.5 text-accent" /> Legitimate Tor Onion Services
      </p>
      <p className="text-[11px] text-slate-500">
        A curated, safety-vetted list — not a general "popular onion links" directory. Each entry
        opens the organization's own clearnet page; most either auto-redirect Tor Browser to their
        onion mirror or document the current address in their help/about pages, which stays
        accurate even as onion addresses occasionally rotate.
      </p>

      <div className="space-y-1.5">
        {ENTRIES.map((e) => (
          <a
            key={e.url}
            href={e.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => addTimelineEvent({ tool: "recon", label: "Tor directory entry opened", detail: e.name })}
            className="flex items-start gap-2 rounded-lg border border-border bg-[#0d0a18] px-2.5 py-2 hover:border-accent/50 transition-colors group"
          >
            <ExternalLink className="h-3 w-3 text-accent mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-slate-200 group-hover:text-accent-glow transition-colors">{e.name}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{e.note}</p>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
