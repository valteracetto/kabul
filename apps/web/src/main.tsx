import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { App } from "./App";
import { applyTheme } from "./theme";

applyTheme();

createRoot(document.getElementById("root")!).render(<App />);
