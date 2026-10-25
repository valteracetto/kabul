import { useEffect, useState } from "react";
import type { ConnState } from "../transport/websocket";
import { clearCred } from "../transport/credentials";
import { getThemePref, setThemePref, type ThemePref } from "../theme";
import { AGENT_LABEL, health, isOwner, k, me, type Account, type Device } from "./kabuld";
import { setListPrefs, useKabul, useListPrefs } from "./data";
import { push } from "./nav";
import { enablePush, pushBlocker, pushEnabled } from "./push";
import { Avatar, BackButton, Group, I, NavBar, Row, useCollapse } from "./ui";

const THEME_LABEL: Record<ThemePref, string> = { system: "Sistema", light: "Claro", dark: "Escuro" };
const ROLE_LABEL: Record<string, string> = { owner: "Dono", editor: "Editor", observer: "Observador" };

/** Aba Configurações (também aberta pelo avatar da tela inicial). */
export function Settings({ conn }: { conn: ConnState }) {
  const [collapsed, onScroll] = useCollapse();
  const prefs = useListPrefs();
  const who = me();
  const [theme, setTheme] = useState(getThemePref());
  useEffect(() => {
    const h = () => setTheme(getThemePref());
    window.addEventListener("kabul:theme", h);
    return () => window.removeEventListener("kabul:theme", h);
  }, []);
  return (
    <div className="m-page" data-testid="m-settings">
      <NavBar collapsed={collapsed} title="Configurações" />
      <main className="m-scroll has-tabbar" onScroll={onScroll}>
        <h1 className="m-large-title">Configurações</h1>
        {who && (
          <Group>
            <Row icon={<Avatar name={who.user} color={who.color || "#8a847f"} size={40} />} title={who.user} sub={`${who.device} · ${ROLE_LABEL[who.role] ?? who.role}${who.scope.kind === "workspace" ? " · um workspace" : ""}`} />
          </Group>
        )}
        <Group>
          <Row icon={<I.laptop />} title="Controle remoto" value={<span className="m-conn-label"><span className={`m-conn m-conn-${conn}`} /></span>} chevron onClick={() => push("v=settings/remote")} testid="m-devices" />
          {isOwner() && <Row icon={<I.arrows />} title="Organizar workspaces manualmente" toggle={prefs.manual} onClick={() => setListPrefs({ manual: !prefs.manual })} testid="m-manual" />}
        </Group>
        <Group>
          {isOwner() && <Row icon={<I.key />} title="Contas" chevron onClick={() => push("v=settings/accounts")} testid="m-accounts" />}
          <Row icon={<I.moon />} title="Tema" value={THEME_LABEL[theme]} chevron onClick={() => push("v=settings/theme")} testid="m-theme" />
        </Group>
        <PushGroup />
        <Group>
          <Row icon={<I.info />} title="Sobre" chevron onClick={() => push("v=settings/about")} testid="m-about" />
        </Group>
        <div className="m-scroll-end" />
      </main>
    </div>
  );
}

function PushGroup() {
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState<string | null>(pushBlocker());
  const [busy, setBusy] = useState(false);
  useEffect(() => void pushEnabled().then(setOn), []);
  const blocked = !!pushBlocker();
  return (
    <Group
      header="Notificações"
      footer={
        on ? (
          <span data-testid="m-push-on">Ligadas neste aparelho. <button className="m-link" onClick={() => k.pushTest().catch(() => {})}>Mandar um teste</button></span>
        ) : msg ? (
          <span data-testid="m-push-why">{msg}</span>
        ) : (
          "Avisa quando um agente para e espera uma decisão sua."
        )
      }
    >
      <Row
        icon={<I.bell />}
        title="Avisar quando um agente esperar por mim"
        toggle={on}
        disabled={busy || blocked || on}
        onClick={() => (setBusy(true), enablePush().then(() => setOn(true), (e) => setMsg(String(e.message ?? e))).finally(() => setBusy(false)))}
        testid="m-push"
      />
    </Group>
  );
}

/** Subtelas das configurações (pilha: ‹ circular e título no centro). */
export function SettingsPage({ sub, conn, onBack }: { sub: string; conn: ConnState; onBack: () => void }) {
  const title = { remote: "Controle remoto", accounts: "Contas", theme: "Tema", about: "Sobre" }[sub] ?? "Configurações";
  return (
    <div className="m-page" data-testid={`m-settings-${sub}`}>
      <NavBar title={title} left={<BackButton onClick={onBack} />} />
      <main className="m-scroll">
        {sub === "remote" && <Remote conn={conn} />}
        {sub === "accounts" && <Accounts />}
        {sub === "theme" && <ThemePage />}
        {sub === "about" && <About />}
        <div className="m-scroll-end" />
      </main>
    </div>
  );
}

function Remote({ conn }: { conn: ConnState }) {
  const { machine, os } = useKabul();
  const [list, setList] = useState<Device[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const load = () => void (isOwner() && k.devices().then(setList, () => {}));
  useEffect(() => (load(), void health().then((h) => setVersion(h?.version ?? null))), []);
  const who = me();
  const sistema = os === "macos" ? "macOS" : os === "windows" ? "Windows" : os === "linux" ? "Linux" : os || "—";
  return (
    <>
      <Group header="Este computador">
        <Row icon={<I.laptop />} title={machine || "—"} sub={sistema} />
        <Row title="Conexão" value={<span className="m-conn-label"><span className={`m-conn m-conn-${conn}`} />{conn === "open" ? "Conectado" : "Reconectando…"}</span>} />
        <Row title="Versão do kabuld" value={version ?? "—"} />
      </Group>
      {who && (
        <Group header="Este aparelho" footer={who.id !== "local" ? "Esquecer apaga a credencial deste aparelho. Para voltar, pareie de novo pelo QR." : undefined}>
          <Row title="Nome" value={who.device} />
          <Row title="Usuário" value={who.user} />
          <Row title="Papel" value={ROLE_LABEL[who.role] ?? who.role} />
          {who.id !== "local" && <Row title="Esquecer este aparelho" danger onClick={() => (clearCred(), location.reload())} testid="m-forget" />}
        </Group>
      )}
      {isOwner() && (
        <Group header="Aparelhos pareados" footer="Revogar derruba na hora as conexões abertas do aparelho.">
          {list.length === 0 && <Row title="Nenhum aparelho" />}
          {list.map((d) => (
            <div key={d.id} className="m-row" data-testid="m-device">
              <span className="m-row-icon"><Avatar name={d.user} color={d.color} size={30} /></span>
              <span className="m-row-text">
                <span className="m-row-title">{d.user} · {d.name}</span>
                <span className="m-row-sub">{ROLE_LABEL[d.role] ?? d.role}{d.id === who?.id ? " · este aparelho" : ""}</span>
              </span>
              {confirm === d.id ? (
                <button className="m-chip-btn danger" onClick={() => k.revoke(d.id).then(() => (setConfirm(null), load()))} data-testid="m-revoke-confirm">Confirmar</button>
              ) : (
                <button className="m-chip-btn" onClick={() => setConfirm(d.id)} data-testid="m-revoke">Revogar</button>
              )}
            </div>
          ))}
        </Group>
      )}
    </>
  );
}

const PROVIDERS: { id: string; label: string }[] = [
  { id: "claude", label: AGENT_LABEL.claude },
  { id: "codex", label: AGENT_LABEL.codex },
  { id: "agy", label: AGENT_LABEL.antigravity },
  { id: "gemini", label: AGENT_LABEL.gemini },
];

function Accounts() {
  const [rows, setRows] = useState<Record<string, Account[]>>({});
  const load = () => PROVIDERS.forEach((p) => k.accounts(p.id).then((a) => setRows((r) => ({ ...r, [p.id]: a })), () => {}));
  useEffect(load, []);
  return (
    <>
      {PROVIDERS.map((p) => (
        <Group key={p.id} header={p.label}>
          {(rows[p.id] ?? []).map((a) => (
            <Row key={a.id} title={a.nickname} sub={[a.email, a.plan, a.logged_in === false ? "sem login" : null].filter(Boolean).join(" · ") || undefined} check={a.default} onClick={a.default ? undefined : () => void k.accountDefault(a.id).then(load)} testid="m-account-row" />
          ))}
        </Group>
      ))}
      <p className="m-sheet-note">A conta marcada é a que as conversas novas usam. Para adicionar ou entrar numa conta, use Configurações › Contas no app desktop.</p>
    </>
  );
}

function ThemePage() {
  const [t, setT] = useState(getThemePref());
  const set = (p: ThemePref) => (setThemePref(p), setT(p));
  return (
    <Group footer="Sistema acompanha o modo claro/escuro do iPhone.">
      {(["system", "light", "dark"] as ThemePref[]).map((p) => (
        <Row key={p} title={THEME_LABEL[p]} check={t === p} onClick={() => set(p)} testid={`m-theme-${p}`} />
      ))}
    </Group>
  );
}

function About() {
  const [h, setH] = useState<{ name: string; version: string } | null>(null);
  useEffect(() => void health().then(setH), []);
  return (
    <>
      <div className="m-about">
        <img src="/icon-192.png" alt="" width={84} height={84} />
        <b>Kabul</b>
        <span>Agentes em paralelo no seu computador, ao vivo no celular.</span>
      </div>
      <Group>
        <Row title="kabuld" value={h?.version ?? "—"} />
        <Row title="Computador" value={h?.name ?? "—"} />
      </Group>
    </>
  );
}
