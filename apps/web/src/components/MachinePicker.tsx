import { useCallback, useEffect, useRef, useState } from "react";
import { Floating } from "./Floating";
import { api, type MachineInfo } from "../api";
import { useDismiss } from "./useDismiss";
import { activeMachine, machines, switchMachine } from "./machines";
import { discovered } from "./RemotePanel";
import { IChevronDown, IGear, IPlus } from "../icons";
import type { Route } from "../App";

const Avatar = ({ src, name, size = 18 }: { src?: string | null; name: string; size?: number }) =>
  src ? <img className="mach-avatar" src={src} alt="" width={size} height={size} /> : <span className="mach-avatar mono" style={{ width: size, height: size }}>{name.slice(0, 1).toUpperCase()}</span>;

const IServer = () => <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><rect x="3" y="2.5" width="10" height="11" rx="1.2" /><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h2" /></svg>;
const ICloud = () => <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M4.5 12.5h7.2a2.8 2.8 0 0 0 .3-5.6 4 4 0 0 0-7.7.9A2.4 2.4 0 0 0 4.5 12.5Z" /></svg>;

/** Seletor de máquina do topo da barra lateral: este Mac, outras com kabuld (Tailscale) e a Nuvem Kabul (em breve). ⌃1…⌃9 troca. */
export function MachinePicker({ onRoute }: { onRoute: (r: Route) => void }) {
  const [info, setInfo] = useState<MachineInfo | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, useCallback(() => setOpen(false), []));
  useEffect(() => void api.machineInfo().then(setInfo, () => {}), []);
  const list = machines();
  const act = activeMachine();
  const ids = ["local", ...list.map((m) => m.id)];
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !/^Digit[1-9]$/.test(e.code)) return;
      const id = ids[Number(e.code.slice(5)) - 1];
      if (id) (e.preventDefault(), switchMachine(id));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [ids.join()]);
  const localName = info?.name ?? "Este Mac";
  const current = act === "local" ? localName : list.find((m) => m.id === act)?.name ?? localName;
  const who = info?.user ? info.user.email ?? `@${info.user.login}` : "GitHub não conectado";
  return (
    <div className="picker machine-picker" ref={ref}>
      <button className="machine-btn" onClick={() => setOpen(!open)} data-testid="machine-picker" title="Trocar de máquina (⌃1…⌃9)">
        {act === "local" ? <Avatar src={info?.user?.avatar} name={localName} /> : <IServer />}
        <span className="machine-name">{current}</span>
        <IChevronDown size={12} />
      </button>
      {open && (
        <Floating className="machine-pop" placement="bottom-start" testid="machine-pop">
          <div className="pop-title machine-who" data-testid="machine-who">{who}</div>
          <div className="pop-sep" />
          <div className={"pop-row" + (act === "local" ? " on" : "")} onClick={() => (setOpen(false), switchMachine("local"))} data-testid="machine-local">
            <Avatar src={info?.user?.avatar} name={localName} /> <span className="label">{localName}</span><span className="grow" />{act === "local" ? <span className="check">✓</span> : <span className="kbd-hint">⌃1</span>}
          </div>
          {list.map((m, i) => (
            <div key={m.id} className={"pop-row" + (act === m.id ? " on" : "")} onClick={() => (setOpen(false), switchMachine(m.id))} data-testid="machine-row" title={m.url}>
              <IServer /> <span className="label">{m.name}</span><span className="grow" />{act === m.id ? <span className="check">✓</span> : i < 8 && <span className="kbd-hint">⌃{i + 2}</span>}
            </div>
          ))}
          {discovered().filter((d) => !list.some((m) => m.url.includes(d.dns_name ?? d.ip))).map((d) => (
            <div key={d.ip} className="pop-row" onClick={() => (setOpen(false), onRoute({ kind: "settings", tab: "celular" }))} data-testid="machine-found" title="kabuld achado na tailnet: pareie para operar">
              <IServer /> <span className="label">{d.machine ?? d.name}</span><span className="grow" /><span className="dim small">parear</span>
            </div>
          ))}
          <div className="pop-row" onClick={() => (setOpen(false), onRoute({ kind: "settings", tab: "remoto" }))} data-testid="machine-add"><IPlus size={14} /> <span className="label">Adicionar máquina…</span><span className="grow" /><span className="dim small">Tailscale</span></div>
          <div className="pop-row disabled" title="em breve"><ICloud /> <span className="label">Nuvem Kabul</span><span className="grow" /><span className="dim small">em breve</span></div>
          <div className="pop-sep" />
          <div className="pop-row" onClick={() => (setOpen(false), onRoute({ kind: "settings", tab: "geral" }))}><IGear size={14} /> <span className="label">Configurações</span><span className="grow" /><span className="kbd-hint">⌘,</span></div>
        </Floating>
      )}
    </div>
  );
}
