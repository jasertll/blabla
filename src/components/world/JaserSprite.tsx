"use client";

// Placeholder Jaser — real commissioned sprite art doesn't exist yet (see
// the architecture audit: CharacterAsset.tsx's two existing portraits are
// decorative companions, not a playable character, and there is no
// existing Jaser character design to extend). Built the same way this
// codebase already builds every other mascot/glyph — RabbitLogo.tsx and
// AlienShapes.tsx are both hand-rolled inline SVG, no external asset
// pipeline — rather than blocking the whole vertical slice on art that
// would need to be commissioned separately. A hooded, featureless
// silhouette reads as "mysterious investigator" even as a placeholder,
// and two small glowing eyes echo RabbitLogo's glowing-red-eyes motif in
// the app's own mint-green `terminal` accent instead of the rabbit's red,
// tying Jaser back to the existing brand without literally putting rabbit
// ears on a person.
//
// Animation is driven entirely by the `bob`/`lean` props the parent
// passes in on every animation frame (see WorldScene's game loop) rather
// than this component running its own timer — keeps a single source of
// truth for "what frame is it" instead of two independent clocks drifting.
export type JaserSpriteProps = {
  facing: "left" | "right";
  bob: number; // vertical offset in px, sine-driven idle breathing / walk bounce
  lean: number; // rotation in degrees, 0 when idle, slight lean in travel direction when moving
  size?: number;
};

export default function JaserSprite({ facing, bob, lean, size = 72 }: JaserSpriteProps) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size * 1.4,
        transform: `translateY(${bob}px) scaleX(${facing === "left" ? -1 : 1}) rotate(${lean}deg)`,
        transition: "transform 0.05s linear",
        filter: "drop-shadow(0 0 10px rgba(52,211,153,0.45)) drop-shadow(0 6px 10px rgba(0,0,0,0.55))",
      }}
    >
      <svg viewBox="0 0 48 68" width="100%" height="100%" fill="none">
        {/* ground contact shadow */}
        <ellipse cx="24" cy="65" rx="13" ry="3" fill="rgba(0,0,0,0.45)" />

        {/* cloak/coat body */}
        <path
          d="M24 14 C33 14 38 22 37 34 C40 44 42 54 40 62 L8 62 C6 54 8 44 11 34 C10 22 15 14 24 14 Z"
          fill="#1b1826"
          stroke="#34d399"
          strokeOpacity="0.55"
          strokeWidth="1"
        />
        {/* inner coat seam / chest line, subtle structure so it doesn't read as a blob */}
        <path d="M24 18 L24 58" stroke="#34d399" strokeOpacity="0.2" strokeWidth="1" />
        {/* shoulders */}
        <path d="M13 26 C10 30 8 36 9 42" stroke="#34d399" strokeOpacity="0.3" strokeWidth="1" fill="none" />
        <path d="M35 26 C38 30 40 36 39 42" stroke="#34d399" strokeOpacity="0.3" strokeWidth="1" fill="none" />

        {/* hood */}
        <path
          d="M24 2 C32 2 37 9 36 17 C36 20 32 22 24 22 C16 22 12 20 12 17 C11 9 16 2 24 2 Z"
          fill="#15131f"
          stroke="#34d399"
          strokeOpacity="0.55"
          strokeWidth="1"
        />
        {/* face shadow beneath the hood — no face detail, deliberately */}
        <ellipse cx="24" cy="15" rx="8" ry="6" fill="#05040a" />
        {/* glowing eyes — the one brand-tying detail, echoing RabbitLogo's glowing eyes in the app's mint-green `terminal` accent instead of the rabbit's red */}
        <circle cx="20.5" cy="15" r="1.4" fill="#6ee7b7" />
        <circle cx="27.5" cy="15" r="1.4" fill="#6ee7b7" />

        {/* "Signal Blade" — not a weapon, a tool: Jaser's ability to cut
            through noise/misinformation/hidden infrastructure (see the
            directive's own framing). A short glowing baton at his hip
            gives him a readable silhouette beyond "hooded blob" without
            turning this into a combat character. */}
        <g transform="translate(34, 40) rotate(18)">
          <rect x="-1" y="-13" width="2" height="13" rx="1" fill="#6ee7b7" opacity="0.9" />
          <rect x="-2.5" y="-1" width="5" height="3" rx="1" fill="#1b1826" stroke="#34d399" strokeWidth="0.6" />
        </g>
      </svg>
    </div>
  );
}
