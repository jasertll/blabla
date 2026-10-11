// Entry for the single-page build (no Next.js): renders the game into #root.
import { createRoot } from "react-dom/client";
import Game from "./game/Game";

createRoot(document.getElementById("root")!).render(<Game />);
