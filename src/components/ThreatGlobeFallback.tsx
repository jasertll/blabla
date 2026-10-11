"use client";

export default function ThreatGlobeFallback() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative w-40 h-40">
        <div
          className="absolute inset-0 rounded-full animate-pulse"
          style={{
            background:
              "radial-gradient(circle, rgba(220,38,38,0.5) 0%, rgba(147,51,234,0.4) 35%, rgba(34,211,238,0.25) 60%, transparent 75%)",
            filter: "blur(6px)",
          }}
        />
        <div
          className="absolute inset-6 rounded-full border border-accent/40"
          style={{ animation: "spin 14s linear infinite" }}
        />
        <div
          className="absolute inset-10 rounded-full border border-purple-500/30"
          style={{ animation: "spin 20s linear infinite reverse" }}
        />
      </div>
    </div>
  );
}
