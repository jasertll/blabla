// Angular, colored-border rounded-rect label — the "GEOCENTRIC MAP" /
// "SENTRY" panel-title chip style pulled from the mission-control mood
// board reference. Chrome/ambience only, layered on top of the existing
// glass-panel + corner-bracket look, not a replacement for it.
const COLOR_MAP: Record<string, string> = {
  amber: "border-accent/70 text-accent-glow",
  mint: "border-terminal/70 text-terminal-bright",
  cyan: "border-cyan-600/70 text-cyan-300",
  red: "border-red-600/60 text-red-300",
};

export default function HudChip({
  children,
  color = "amber",
  className = "",
}: {
  children: React.ReactNode;
  color?: keyof typeof COLOR_MAP;
  className?: string;
}) {
  return (
    <span
      className={`hud-text inline-block px-2.5 py-1 rounded-md border text-[10px] tracking-widest bg-[#0d0a18]/70 ${COLOR_MAP[color]} ${className}`}
    >
      {children}
    </span>
  );
}
