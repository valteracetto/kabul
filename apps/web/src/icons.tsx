/** Ícones de traço desenhados para o Kabul (16px, stroke 1.4). */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 16, ...p }: P) => ({ width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, ...p });

export const IGrid = (p: P) => <svg {...base(p)}><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></svg>;
export const IGauge = (p: P) => <svg {...base(p)}><path d="M2.6 11.5a5.6 5.6 0 1 1 10.8 0" /><path d="m8 9.6 2.6-3" /><circle cx="8" cy="9.8" r=".6" fill="currentColor" /></svg>;
export const IHome =(p: P) => <svg {...base(p)}><path d="M2.5 7.2 8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5Z" /><path d="M6.5 13.5V10h3v3.5" /></svg>;
export const IPlus = (p: P) => <svg {...base(p)}><path d="M8 3v10M3 8h10" /></svg>;
export const ISearch = (p: P) => <svg {...base(p)}><circle cx="7" cy="7" r="4.2" /><path d="m10.2 10.2 3.3 3.3" /></svg>;
export const IBranch = (p: P) => <svg {...base(p)}><circle cx="4.5" cy="3.8" r="1.4" /><circle cx="4.5" cy="12.2" r="1.4" /><circle cx="11.5" cy="5.5" r="1.4" /><path d="M4.5 5.2v5.6M11.5 6.9c0 2.6-7 1.6-7 3.9" /></svg>;
export const IGear = (p: P) => <svg {...base(p)} strokeWidth={1.3}><path d="M6.9 1.9h2.2l.35 1.6a4.7 4.7 0 0 1 1.15.66l1.56-.5 1.1 1.9-1.2 1.1a4.8 4.8 0 0 1 0 1.33l1.2 1.1-1.1 1.9-1.56-.5a4.7 4.7 0 0 1-1.15.66l-.35 1.6H6.9l-.35-1.6a4.7 4.7 0 0 1-1.15-.66l-1.56.5-1.1-1.9 1.2-1.1a4.8 4.8 0 0 1 0-1.33l-1.2-1.1 1.1-1.9 1.56.5a4.7 4.7 0 0 1 1.15-.66Z" transform="translate(0 .5)" /><circle cx="8" cy="8" r="2" /></svg>;
export const IHelp = (p: P) => <svg {...base(p)}><circle cx="8" cy="8" r="5.8" /><path d="M6.4 6.3a1.7 1.7 0 0 1 3.2.6c0 1.2-1.6 1.4-1.6 2.4" /><circle cx="8" cy="11.3" r=".3" fill="currentColor" /></svg>;
export const IChevron = (p: P) => <svg {...base(p)}><path d="m6 4 4 4-4 4" /></svg>;
export const IChevronDown = (p: P) => <svg {...base(p)}><path d="m4 6 4 4 4-4" /></svg>;
export const IMic = (p: P) => <svg {...base(p)}><rect x="6" y="2" width="4" height="7.5" rx="2" /><path d="M3.8 7.8a4.2 4.2 0 0 0 8.4 0M8 12v2" /></svg>;
export const IStop = (p: P) => <svg {...base(p)}><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" /></svg>;
export const IArrowUp = (p: P) => <svg {...base(p)}><path d="M8 13V3.5M4 7.3 8 3.3l4 4" /></svg>;
export const IArrowOut = (p: P) => <svg {...base(p)}><path d="M5 11 11 5M6 5h5v5" /></svg>;
export const IDrag = (p: P) => <svg {...base(p)} strokeWidth={0}><g fill="currentColor"><circle cx="6" cy="4" r="1" /><circle cx="10" cy="4" r="1" /><circle cx="6" cy="8" r="1" /><circle cx="10" cy="8" r="1" /><circle cx="6" cy="12" r="1" /><circle cx="10" cy="12" r="1" /></g></svg>;
export const IPR = (p: P) => <svg {...base(p)}><circle cx="4.5" cy="3.8" r="1.4" /><circle cx="4.5" cy="12.2" r="1.4" /><circle cx="11.5" cy="12.2" r="1.4" /><path d="M4.5 5.2v5.6M11.5 10.8V6.5a2 2 0 0 0-2-2H7.5M8.8 3.2 7.5 4.5l1.3 1.3" /></svg>;
export const IClose = (p: P) => <svg {...base(p)}><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></svg>;
export const IArchive = (p: P) => <svg {...base(p)}><rect x="2.2" y="3" width="11.6" height="3" rx=".6" /><path d="M3.2 6v6.4c0 .3.2.6.6.6h8.4c.4 0 .6-.3.6-.6V6M6.5 8.7h3" /></svg>;
export const IFile = (p: P) => <svg {...base(p)}><path d="M4 2.5h5l3 3V13a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 13V3a.5.5 0 0 1 .5-.5Z" /><path d="M9 2.5V5.5h3" /></svg>;
export const ISidebar = (p: P) => <svg {...base(p)}><rect x="2" y="3" width="12" height="10" rx="1.6" /><path d="M6 3v10" /></svg>;
export const ITerminal = (p: P) => <svg {...base(p)}><path d="m3.5 5 3 3-3 3M8.5 11.5h4" /></svg>;
export const IThink = (p: P) => <svg {...base(p)}><circle cx="8" cy="8" r="5.8" /><path d="M8 5v3.3l2 1.2" /></svg>;
export const ITool = (p: P) => <svg {...base(p)}><path d="M10.2 2.6a3 3 0 0 0-3.6 3.9L2.8 10.3a1.2 1.2 0 0 0 1.7 1.7l3.8-3.8a3 3 0 0 0 3.9-3.6l-1.8 1.8-1.5-.4-.4-1.5Z" /></svg>;
export const ICopy = (p: P) => <svg {...base(p)}><rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.2" /><path d="M10.5 5.5V4A1 1 0 0 0 9.5 3H4a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h1.5" /></svg>;

/** Marca do provedor (desenho próprio, cores neutras por provedor). */
export function ProviderMark({ provider, size = 16 }: { provider: string; size?: number }) {
  const s = { width: size, height: size, viewBox: "0 0 16 16" };
  if (provider === "anthropic") return <svg {...s}><rect x="2" y="2" width="12" height="12" rx="3.5" fill="#c4825f" /><path d="M5.2 11 8 4.8l2.8 6.2M6.3 8.9h3.4" stroke="#1b1917" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (provider === "openai") return <svg {...s}><rect x="2" y="2" width="12" height="12" rx="6" fill="#7f86e8" /><path d="m5.6 6.2 1.8 1.8-1.8 1.8M8.6 10.2h2" stroke="#16151f" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (provider === "google") return <svg {...s}><path d="M8 1.8c.5 3.3 2.9 5.7 6.2 6.2-3.3.5-5.7 2.9-6.2 6.2-.5-3.3-2.9-5.7-6.2-6.2C5.1 7.5 7.5 5.1 8 1.8Z" fill="#78a6e8" /></svg>;
  if (provider === "local") return <svg {...s}><rect x="2.5" y="3" width="11" height="8" rx="1.5" fill="none" stroke="#9fc4a8" strokeWidth="1.4" /><path d="M5.5 13.5h5M8 11v2.5" stroke="#9fc4a8" strokeWidth="1.4" strokeLinecap="round" /></svg>;
  return <svg {...s}><circle cx="8" cy="8" r="5.5" fill="#6e6a66" /></svg>;
}

/** Avatar do repositório: inicial sobre cor derivada do nome. */
export function RepoMark({ name, size = 16 }: { name: string; size?: number }) {
  const hues = ["#b5654a", "#5d7fb8", "#7a9a5c", "#a0784f", "#8b6aa8", "#4f8f8a"];
  const c = hues[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % hues.length];
  return <span className="repo-mark" style={{ width: size, height: size, background: c, fontSize: size * 0.62 }}>{name[0]?.toUpperCase()}</span>;
}
export const IPlay = (p: P) => <svg {...base(p)}><path d="M5 3.5v9l7-4.5Z" fill="currentColor" stroke="none" /></svg>;
export const IApps = (p: P) => <svg {...base(p)}><rect x="2.5" y="8.5" width="5" height="5" rx="1" /><rect x="8.5" y="8.5" width="5" height="5" rx="1" /><rect x="2.5" y="2.5" width="5" height="5" rx="1" /><rect x="9.6" y="1.6" width="4.6" height="4.6" rx="1" transform="rotate(12 11.9 3.9)" /></svg>;
export const IPin = (p: P) => <svg {...base(p)}><path d="M9.5 2.5 13.5 6.5 11 7.5 8.5 10l-.5 3L3 8l3-.5L8.5 5Z" /><path d="m5.5 10.5-3 3" /></svg>;
export const IComment = (p: P) => <svg {...base(p)}><path d="M3 3.5h10a.5.5 0 0 1 .5.5v6.5a.5.5 0 0 1-.5.5H7l-3 2.5V11H3a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z" /></svg>;
export const IRestore = (p: P) => <svg {...base(p)}><path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5V5h2.5" /></svg>;
export const ICube = (p: P) => <svg {...base(p)}><path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5Z" /><path d="M2.5 5 8 8.2 13.5 5M8 8.2v6" /></svg>;
export const IPlan = (p: P) => <svg {...base(p)}><path d="M4 3.5h8M4 8h8M4 12.5h5" /><circle cx="2" cy="3.5" r=".4" fill="currentColor" /><circle cx="2" cy="8" r=".4" fill="currentColor" /><circle cx="2" cy="12.5" r=".4" fill="currentColor" /></svg>;
export const IQueue = (p: P) => <svg {...base(p)}><path d="M3 4.5h10M3 8h10M3 11.5h6" /></svg>;

export const IFolder = ({ open, ...p }: P & { open?: boolean }) => (
  <svg {...base(p)} strokeWidth={1.2}>{open ? <path d="M1.8 4.2c0-.5.4-.9.9-.9h3.2l1.3 1.4h5.5c.5 0 .9.4.9.9V6H4.3L2.5 12.6H2.7c-.5 0-.9-.4-.9-.9Zm2.5 1.8h11l-1.8 6.6H2.5Z" /> : <path d="M1.8 4.2c0-.5.4-.9.9-.9h3.2l1.3 1.4h6.1c.5 0 .9.4.9.9v6.3c0 .5-.4.9-.9.9H2.7a.9.9 0 0 1-.9-.9Z" />}</svg>
);
export const IEye = (p: P) => <svg {...base(p)}><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="2" /></svg>;
export const IHistory = (p: P) => <svg {...base(p)}><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.6h2.6M8 5.2V8l1.9 1.2" /></svg>;
export const IPanel = (p: P) => <svg {...base(p)}><rect x="2" y="3" width="12" height="10" rx="1.6" /><path d="M10 3v10" /></svg>;
export const IMore = (p: P) => <svg {...base(p)} strokeWidth={0}><g fill="currentColor"><circle cx="3.5" cy="8" r="1.1" /><circle cx="8" cy="8" r="1.1" /><circle cx="12.5" cy="8" r="1.1" /></g></svg>;
export const IBack = (p: P) => <svg {...base(p)}><path d="M9.5 3.5 5 8l4.5 4.5" /></svg>;
export const IFwd = (p: P) => <svg {...base(p)}><path d="M6.5 3.5 11 8l-4.5 4.5" /></svg>;

/** Ícone por tipo de arquivo (desenho próprio, cores por linguagem). */
export function FileIcon({ name, size = 15 }: { name: string; size?: number }) {
  const n = name.toLowerCase();
  const ext = n.includes(".") ? n.slice(n.lastIndexOf(".") + 1) : "";
  const s = { width: size, height: size, viewBox: "0 0 16 16", style: { flex: "none" } as const };
  const badge = (bg: string, text: string, fg = "#141210") => (
    <svg {...s}><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill={bg} /><text x="8" y="11" textAnchor="middle" fontSize={text.length > 2 ? 5.6 : 7} fontWeight="700" fontFamily="-apple-system, sans-serif" fill={fg}>{text}</text></svg>
  );
  if (n.startsWith(".git")) return <svg {...s}><rect x="3" y="3" width="10" height="10" rx="1.6" transform="rotate(45 8 8)" fill="#e2702f" /><path d="M6.4 5.6 8 7.2M8 7.2v3.4M8 7.2l1.8 1.8" stroke="#1b1917" strokeWidth="1.1" strokeLinecap="round" /><circle cx="8" cy="10.6" r=".9" fill="#1b1917" /><circle cx="9.9" cy="9.1" r=".9" fill="#1b1917" /></svg>;
  if (ext === "rs" || n === "cargo.toml" || n === "cargo.lock") return <svg {...s}><circle cx="8" cy="8" r="6" fill="none" stroke="#d76c35" strokeWidth="1.6" strokeDasharray="1.6 1" /><text x="8" y="10.7" textAnchor="middle" fontSize="7.5" fontWeight="800" fontFamily="-apple-system, sans-serif" fill="#d76c35">R</text></svg>;
  if (ext === "ts" || ext === "tsx") return badge("#3a78c9", "TS", "#fff");
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") return badge("#e3c84d", "JS");
  if (ext === "json") return badge("#8a7d3a", "{}", "#f2e9b8");
  if (ext === "md" || ext === "mdx") return badge("#5f7d9c", "M↓", "#fff");
  if (ext === "toml" || ext === "yaml" || ext === "yml" || n.startsWith(".env")) return badge("#6b6560", ext === "toml" ? "TO" : ext ? "YM" : "EN", "#eee");
  if (ext === "css" || ext === "scss") return badge("#7a5fc0", "#", "#fff");
  if (ext === "html") return badge("#d4643a", "<>", "#fff");
  if (ext === "py") return badge("#3d6e9e", "Py", "#f3d34a");
  if (ext === "go") return badge("#3fa6c6", "Go", "#fff");
  if (ext === "swift") return badge("#e8663c", "Sw", "#fff");
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "icns"].includes(ext)) return <svg {...s}><rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="#7fb07a" strokeWidth="1.3" /><circle cx="6" cy="6.5" r="1.2" fill="#7fb07a" /><path d="m3 12 3.5-3.5L9 11l2-2 2.5 3" fill="none" stroke="#7fb07a" strokeWidth="1.3" /></svg>;
  if (ext === "sh" || ext === "zsh") return badge("#3c4a3c", "$_", "#9fd49a");
  return <svg {...s}><path d="M4 2.5h5l3 3V13a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 13V3a.5.5 0 0 1 .5-.5Z" fill="none" stroke="#8b887d" strokeWidth="1.2" /><path d="M9 2.5V5.5h3" fill="none" stroke="#8b887d" strokeWidth="1.2" /></svg>;
}

export const ISun = (p: P) => <svg {...base(p)}><circle cx="8" cy="8" r="2.8" /><path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4" /></svg>;
export const IMoon = (p: P) => <svg {...base(p)}><path d="M13 9.6A5.5 5.5 0 0 1 6.4 3a5.5 5.5 0 1 0 6.6 6.6Z" /></svg>;
export const IMonitor = (p: P) => <svg {...base(p)}><rect x="2" y="3" width="12" height="8" rx="1.2" /><path d="M6 14h4M8 11v3" /></svg>;
export const IChevronRight = (p: P) => <svg {...base(p)}><path d="m6 4 4 4-4 4" /></svg>;
// Passos do agente (linhas compactas do chat).
export const IBrain = (p: P) => <svg {...base(p)}><path d="M8 3.2v9.6M8 3.2a2.2 2.2 0 0 0-3.9 1.2A2.2 2.2 0 0 0 3 8.3a2.2 2.2 0 0 0 1.3 3.3A2.2 2.2 0 0 0 8 12.8M8 3.2a2.2 2.2 0 0 1 3.9 1.2A2.2 2.2 0 0 1 13 8.3a2.2 2.2 0 0 1-1.3 3.3A2.2 2.2 0 0 1 8 12.8M5.6 6.2 8 7.4l2.4-1.2M5.6 9.8 8 8.8l2.4 1" /></svg>;
export const IPencil = (p: P) => <svg {...base(p)}><path d="M10.6 2.9a1.4 1.4 0 0 1 2 2L5.4 12.1 2.8 12.8l.7-2.6Z" /><path d="m9.6 3.9 2.5 2.5" /></svg>;
export const IGlobe = (p: P) => <svg {...base(p)}><circle cx="8" cy="8" r="5.6" /><path d="M2.4 8h11.2M8 2.4c1.6 1.6 2.4 3.4 2.4 5.6S9.6 12 8 13.6C6.4 12 5.6 10.2 5.6 8S6.4 4 8 2.4Z" /></svg>;
export const IList = (p: P) => <svg {...base(p)}><path d="M6 4h7.5M6 8h7.5M6 12h7.5" /><circle cx="3" cy="4" r=".5" fill="currentColor" /><circle cx="3" cy="8" r=".5" fill="currentColor" /><circle cx="3" cy="12" r=".5" fill="currentColor" /></svg>;
export const ISend = (p: P) => <svg {...base(p)}><path d="M13.5 2.5 2.5 7l4.4 1.6L8.5 13Z" /><path d="m6.9 8.6 6.6-6.1" /></svg>;
export const IPlug = (p: P) => <svg {...base(p)}><path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2.2a3.5 3.5 0 0 1-7 0ZM8 11.2v2.3" /></svg>;
export const IMinus = (p: P) => <svg {...base(p)}><path d="M3 8h10" /></svg>;
export const IVolume = (p: P) => <svg {...base(p)}><path d="M3 6.2h2.2L8.5 3.5v9L5.2 9.8H3Z" /><path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.3 4a5.7 5.7 0 0 1 0 8" /></svg>;
export const ILink = (p: P) => <svg {...base(p)}><path d="M6.6 9.4 9.4 6.6M5.4 7.4 4 8.8a2.5 2.5 0 0 0 3.5 3.5l1.4-1.4M10.6 8.6 12 7.2A2.5 2.5 0 0 0 8.5 3.7L7.1 5.1" /></svg>;
export const IEyeOff = (p: P) => <svg {...base(p)}><path d="M2.5 2.5l11 11M6.7 4.2A6 6 0 0 1 8 4c3.2 0 5.3 2.6 6 4-.3.6-.8 1.4-1.6 2.1M4.3 5.4C3.1 6.2 2.4 7.3 2 8c.7 1.4 2.8 4 6 4 .9 0 1.7-.2 2.4-.5" /><path d="M6.6 6.7a2 2 0 0 0 2.7 2.7" /></svg>;
export const ITrash = (p: P) => <svg {...base(p)}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v4M9.2 7v4" /></svg>;
export const IForkTab = (p: P) => <svg {...base(p)}><path d="M3 3.5h10a.5.5 0 0 1 .5.5v6.5a.5.5 0 0 1-.5.5H7l-3 2.5V11H3a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z" /><path d="M8 5.5v3.5M6.25 7.25h3.5" /></svg>;
export const IFork = (p: P) => <svg {...base(p)}><path d="M8 13.5V9.5L4 5.5M8 9.5l4-4M3 3h3v.01M3 3v3M13 3h-3M13 3v3" /></svg>;
