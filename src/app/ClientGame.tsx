"use client";

import dynamic from "next/dynamic";

// WebGL + WebAudio only exist in the browser.
const Game = dynamic(() => import("@/game/Game"), { ssr: false });

export default function ClientGame() {
  return <Game />;
}
