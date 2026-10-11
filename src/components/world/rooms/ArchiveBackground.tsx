"use client";

// Distinct set dressing from the Terminal Hall — rows of glowing archive
// racks instead of structural struts, an amber/parchment-tinted far wash
// instead of a skyline, per the audit's §51 (every room should read as
// a different place, not the same room recolored).
const RACKS = [180, 560, 940, 1320, 1700, 2060];
const MOTES = [120, 340, 610, 890, 1150, 1480, 1830, 2100];

export default function ArchiveBackground({ cameraX }: { cameraX: number }) {
  return (
    <>
      {/* Far layer — a warm parchment-toned wash, suggesting old records rather than open sky */}
      <div
        className="absolute inset-0"
        style={{
          transform: `translateX(${-cameraX * 0.1}px)`,
          background: "radial-gradient(ellipse 900px 400px at 50% 0%, rgba(217,119,6,0.05) 0%, transparent 70%)",
        }}
      />

      {/* Mid layer — archive racks, each a stack of glowing record-slats */}
      <div className="absolute inset-0" style={{ transform: `translateX(${-cameraX * 0.5}px)` }}>
        {RACKS.map((x) => (
          <div key={x} className="absolute bottom-0" style={{ left: x, width: 70, height: 340 }}>
            <div className="w-full h-full rounded-t-sm" style={{ background: "linear-gradient(180deg, #171324 0%, #0d0a18 100%)", border: "1px solid rgba(61,46,99,0.6)" }} />
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className="absolute left-2 right-2 h-2 rounded-sm"
                style={{ top: 18 + i * 44, background: i % 3 === 0 ? "rgba(52,211,153,0.35)" : "rgba(217,119,6,0.22)" }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Drifting dust motes — slow, barely-visible, pure atmosphere */}
      <div className="absolute inset-0" style={{ transform: `translateX(${-cameraX * 0.3}px)` }}>
        {MOTES.map((x, i) => (
          <div
            key={x}
            className="absolute rounded-full"
            style={{
              left: x,
              top: 60 + (i % 4) * 90,
              width: 3,
              height: 3,
              background: "rgba(217,119,6,0.3)",
              animation: `float${i % 2} ${6 + (i % 3)}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>

      <div
        aria-hidden="true"
        className="absolute inset-y-0"
        style={{
          width: 2200 * 1.4,
          left: -cameraX * 0.2,
          background:
            "repeating-linear-gradient(90deg, rgba(217,119,6,0.025) 0px, rgba(217,119,6,0.025) 2px, transparent 2px, transparent 160px)",
        }}
      />

      <style jsx>{`
        @keyframes float0 {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-14px); }
        }
        @keyframes float1 {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(10px); }
        }
      `}</style>
    </>
  );
}
