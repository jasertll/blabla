"use client";

// Hand-placed set dressing at fixed world-x positions (not procedurally
// tiled) — per the audit's design direction, a hand-crafted room reads
// differently from a repeating pattern stretched across the width, even
// built from nothing but SVG/CSS the way this codebase already builds
// every other background (TerminalBootBackground, FastCodeBackground).
// Warm lamp pools + a cool mint accent on the terminals themselves is the
// one deliberate color contrast in the room — Echo Weaver's reviewed-on
// "a dash of turquoise... gives extra pop" principle, translated into
// this app's own existing `terminal` token instead of a new color.
const LAMPS = [260, 760, 1320, 1780];
const STRUTS = [60, 420, 840, 1200, 1560, 1920, 2140];

export default function TerminalHallBackground({ cameraX }: { cameraX: number }) {
  return (
    <>
      {/* Far layer — distant skyline glimpsed through a high window, barely moves */}
      <div className="absolute inset-0 overflow-hidden" style={{ transform: `translateX(${-cameraX * 0.12}px)` }}>
        <div
          className="absolute"
          style={{
            left: 680,
            top: 40,
            width: 420,
            height: 140,
            background: "linear-gradient(180deg, rgba(52,211,153,0.08) 0%, rgba(52,211,153,0.02) 70%, transparent 100%)",
            clipPath: "polygon(0% 100%, 4% 40%, 10% 60%, 18% 20%, 26% 55%, 34% 10%, 44% 50%, 54% 25%, 64% 58%, 74% 15%, 84% 48%, 94% 30%, 100% 100%)",
          }}
        />
      </div>

      {/* Mid layer — structural struts + hanging lamps, moderate parallax */}
      <div className="absolute inset-0" style={{ transform: `translateX(${-cameraX * 0.45}px)` }}>
        {STRUTS.map((x) => (
          <div
            key={x}
            className="absolute top-0 bottom-0 w-[3px]"
            style={{ left: x, background: "linear-gradient(180deg, transparent, rgba(61,46,99,0.9) 15%, rgba(61,46,99,0.9) 85%, transparent)" }}
          />
        ))}
        {LAMPS.map((x) => (
          <div key={x} className="absolute" style={{ left: x - 90, top: 0 }}>
            {/* lamp fixture */}
            <div className="mx-auto w-px h-10" style={{ background: "rgba(61,46,99,0.7)" }} />
            <div className="mx-auto w-5 h-2 rounded-b-full" style={{ background: "#1c1538", border: "1px solid rgba(251,191,36,0.3)" }} />
            {/* warm light pool on the floor below */}
            <div
              className="absolute"
              style={{
                left: -70,
                top: 420,
                width: 180,
                height: 90,
                background: "radial-gradient(ellipse, rgba(251,191,36,0.10) 0%, rgba(251,191,36,0.03) 55%, transparent 80%)",
              }}
            />
          </div>
        ))}
      </div>

      {/* Base ambience — subtle scanline texture, near-full parallax */}
      <div
        aria-hidden="true"
        className="absolute inset-y-0"
        style={{
          width: 2200 * 1.4,
          left: -cameraX * 0.2,
          background:
            "repeating-linear-gradient(90deg, rgba(52,211,153,0.03) 0px, rgba(52,211,153,0.03) 2px, transparent 2px, transparent 140px)",
        }}
      />
    </>
  );
}
