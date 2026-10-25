import { useEffect, useState } from "react";
import { trLabel } from "../components/Usage";
import type { ConnState } from "../transport/websocket";
import { clearCred } from "../transport/credentials";
import { getThemePref, setThemePref, type ThemePref } from "../theme";
import { AGENT_LABEL, health, isOwner, k, me, type Account, type Device } from "./kabuld";
import { setListPrefs, useKabul, useListPrefs } from "./data";
import { push } from "./nav";
import { enablePush, pushBlocker, pushEnabled } from "./push";
import { Avatar, BackButton, Group, I, NavBar, Row, useCollapse } from "./ui";
import { LANG_NAMES, langPref, setLangPref, systemLang, t, type Lang, type LangPref } from "../i18n";
import { trError } from "../i18n/errors";

const themeLabel = (p: ThemePref) => ({ system: t("mobile.settings.themeSystem"), light: t("mobile.settings.themeLight"), dark: t("mobile.settings.themeDark") })[p];
const roleLabel = (r: string) => ({ owner: t("mobile.settings.roleOwner"), editor: t("mobile.settings.roleEditor"), observer: t("mobile.settings.roleObserver") } as Record<string, string>)[r] ?? r;

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
      <NavBar collapsed={collapsed} title={t("mobile.settings.title")} />
      <main className="m-scroll has-tabbar" onScroll={onScroll}>
        <h1 className="m-large-title">{t("mobile.settings.title")}</h1>
        {who && (
          <Group>
            <Row icon={<Avatar name={who.user} color={who.color || "#8a847f"} size={40} />} title={who.user} sub={`${who.device} · ${roleLabel(who.role)}${who.scope.kind === "workspace" ? t("mobile.settings.oneWorkspace") : ""}`} />
          </Group>
        )}
        <Group>
          <Row icon={<I.laptop />} title={t("mobile.settings.remote")} value={<span className="m-conn-label"><span className={`m-conn m-conn-${conn}`} /></span>} chevron onClick={() => push("v=settings/remote")} testid="m-devices" />
          {isOwner() && <Row icon={<I.arrows />} title={t("mobile.settings.manual")} toggle={prefs.manual} onClick={() => setListPrefs({ manual: !prefs.manual })} testid="m-manual" />}
        </Group>
        <Group>
          {isOwner() && <Row icon={<I.key />} title={t("mobile.settings.accounts")} chevron onClick={() => push("v=settings/accounts")} testid="m-accounts" />}
          <Row icon={<I.moon />} title={t("mobile.settings.theme")} value={themeLabel(theme)} chevron onClick={() => push("v=settings/theme")} testid="m-theme" />
          <Row icon={<I.globe />} title={t("settings.language")} value={langPref() === "system" ? t("settings.language.system", { lang: LANG_NAMES[systemLang()] }) : LANG_NAMES[langPref() as Lang]} chevron onClick={() => push("v=settings/language")} testid="m-language" />
        </Group>
        <PushGroup />
        <Group>
          <Row icon={<I.info />} title={t("mobile.settings.about")} chevron onClick={() => push("v=settings/about")} testid="m-about" />
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
      header={t("mobile.settings.notifications")}
      footer={
        on ? (
          <span data-testid="m-push-on">{t("mobile.settings.pushOn")}<button className="m-link" onClick={() => k.pushTest().catch(() => {})}>{t("mobile.settings.pushTest")}</button></span>
        ) : msg ? (
          <span data-testid="m-push-why">{trError(msg)}</span>
        ) : (
          t("mobile.settings.pushFooter")
        )
      }
    >
      <Row
        icon={<I.bell />}
        title={t("mobile.settings.pushToggle")}
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
  const title = ({ remote: t("mobile.settings.remote"), accounts: t("mobile.settings.accounts"), theme: t("mobile.settings.theme"), language: t("settings.language"), about: t("mobile.settings.about") } as Record<string, string>)[sub] ?? t("mobile.settings.title");
  return (
    <div className="m-page" data-testid={`m-settings-${sub}`}>
      <NavBar title={title} left={<BackButton onClick={onBack} />} />
      <main className="m-scroll">
        {sub === "remote" && <Remote conn={conn} />}
        {sub === "accounts" && <Accounts />}
        {sub === "theme" && <ThemePage />}
        {sub === "language" && <LanguagePage />}
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
      <Group header={t("mobile.settings.thisComputer")}>
        <Row icon={<I.laptop />} title={machine || "—"} sub={sistema} />
        <Row title={t("mobile.settings.connection")} value={<span className="m-conn-label"><span className={`m-conn m-conn-${conn}`} />{conn === "open" ? t("mobile.settings.connected") : t("mobile.settings.reconnecting")}</span>} />
        <Row title={t("mobile.settings.kabuldVersion")} value={version ?? "—"} />
      </Group>
      {who && (
        <Group header={t("mobile.settings.thisDevice")} footer={who.id !== "local" ? t("mobile.settings.forgetFooter") : undefined}>
          <Row title={t("mobile.settings.name")} value={who.device} />
          <Row title={t("mobile.settings.user")} value={who.user} />
          <Row title={t("mobile.settings.role")} value={roleLabel(who.role)} />
          {who.id !== "local" && <Row title={t("mobile.settings.forget")} danger onClick={() => (clearCred(), location.reload())} testid="m-forget" />}
        </Group>
      )}
      {isOwner() && (
        <Group header={t("mobile.settings.paired")} footer={t("mobile.settings.revokeFooter")}>
          {list.length === 0 && <Row title={t("mobile.settings.noDevice")} />}
          {list.map((d) => (
            <div key={d.id} className="m-row" data-testid="m-device">
              <span className="m-row-icon"><Avatar name={d.user} color={d.color} size={30} /></span>
              <span className="m-row-text">
                <span className="m-row-title">{d.user} · {d.name}</span>
                <span className="m-row-sub">{roleLabel(d.role)}{d.id === who?.id ? t("mobile.settings.thisDeviceSuffix") : ""}</span>
              </span>
              {confirm === d.id ? (
                <button className="m-chip-btn danger" onClick={() => k.revoke(d.id).then(() => (setConfirm(null), load()))} data-testid="m-revoke-confirm">{t("common.confirm")}</button>
              ) : (
                <button className="m-chip-btn" onClick={() => setConfirm(d.id)} data-testid="m-revoke">{t("mobile.settings.revoke")}</button>
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
            <Row key={a.id} title={trLabel(a.nickname)} sub={[a.email, a.plan, a.logged_in === false ? t("mobile.settings.noLogin") : null].filter(Boolean).join(" · ") || undefined} check={a.default} onClick={a.default ? undefined : () => void k.accountDefault(a.id).then(load)} testid="m-account-row" />
          ))}
        </Group>
      ))}
      <p className="m-sheet-note">{t("mobile.settings.accountsNote")}</p>
    </>
  );
}

function ThemePage() {
  const [cur, setCur] = useState(getThemePref());
  const set = (p: ThemePref) => (setThemePref(p), setCur(p));
  return (
    <Group footer={t("mobile.settings.themeFooter")}>
      {(["system", "light", "dark"] as ThemePref[]).map((p) => (
        <Row key={p} title={themeLabel(p)} check={cur === p} onClick={() => set(p)} testid={`m-theme-${p}`} />
      ))}
    </Group>
  );
}

/** Idioma: Sistema (o do aparelho), English ou Português. Trocar recarrega a PWA. */
function LanguagePage() {
  const cur = langPref();
  const opts: [LangPref, string][] = [["system", t("settings.language.system", { lang: LANG_NAMES[systemLang()] })], ["en", LANG_NAMES.en], ["pt-BR", LANG_NAMES["pt-BR"]]];
  return (
    <Group footer={t("settings.language.hint")}>
      {opts.map(([v, label]) => (
        <Row key={v} title={label} check={cur === v} onClick={() => cur !== v && setLangPref(v)} testid={`m-lang-${v}`} />
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
        <span>{t("mobile.settings.tagline")}</span>
      </div>
      <Group>
        <Row title="kabuld" value={h?.version ?? "—"} />
        <Row title={t("mobile.settings.computer")} value={h?.name ?? "—"} />
      </Group>
    </>
  );
}
