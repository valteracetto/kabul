import { useEffect, useState } from "react";
import { api, type AppSettings, type Model, type Prompts, type Repo, type RepoSettingsT } from "../api";
import { noSuggest } from "../noSuggest";
import { confirmDialog } from "../components/Confirm";
import { getThemePref, setThemePref, applyAppearance, type ThemePref } from "../theme";
import { IMonitor, IMoon, ISun, RepoMark } from "../icons";
import { DEFAULT_PROMPTS, PROMPT_LABEL } from "../components/useGit";
import { Row, Toggle, useAppSettings, useLocalPref } from "./settingsUi";
import { applyZoom } from "../App";
import { UpdatesSection } from "../components/Updates";
import type { Route } from "../App";

const SOUNDS = ["none", "Glass", "Ping", "Pop", "Purr", "Hero", "Submarine", "Funk", "Tink", "Bottle", "Frog", "Morse", "Sosumi", "Blow", "Basso"];

/** Geral: envio, fila, passos, notificações e som (com Teste), contexto, colagem longa, frase “absolutely right”. */
export function GeneralPage({ onError }: { onError: (e: string) => void }) {
  const [s, save] = useAppSettings(onError);
  if (!s) return null;
  return (
    <div className="set-group" data-testid="general">
      <Row label="Enviar mensagem com" hint="⇧↵ sempre quebra a linha"><select defaultValue={localStorage.getItem("kabul.sendKey") ?? "enter"} onChange={(e) => localStorage.setItem("kabul.sendKey", e.target.value)} data-testid="send-key"><option value="enter">↵</option><option value="cmdEnter">⌘↵</option></select></Row>
      <Row label="Mensagem enviada com o agente trabalhando" hint="Fila: espera o turno acabar. Redirecionar: entra no turno em andamento."><select defaultValue={localStorage.getItem("kabul.followUp") ?? "queue"} onChange={(e) => localStorage.setItem("kabul.followUp", e.target.value)} data-testid="follow-up"><option value="queue">Fila</option><option value="steer">Redirecionar</option></select></Row>
      <Row label="Não recolher os passos do agente (⌃O)" hint="Mostra todas as ferramentas e mensagens intermediárias"><select defaultValue={localStorage.getItem("kabul.noCollapse") ?? "0"} onChange={(e) => localStorage.setItem("kabul.noCollapse", e.target.value)}><option value="0">recolher</option><option value="1">mostrar tudo</option></select></Row>
      <Row label="Abrir workspace em (⌘O)" hint="⌘⇧O abre a lista de apps"><select defaultValue={localStorage.getItem("kabul.openIn.default") ?? ""} onChange={(e) => localStorage.setItem("kabul.openIn.default", e.target.value)} data-testid="open-default"><option value="">o último usado</option><option value="finder">Finder</option><option value="vscode">VS Code</option><option value="cursor">Cursor</option><option value="zed">Zed</option><option value="terminal">Terminal</option><option value="iterm">iTerm</option><option value="warp">Warp</option><option value="ghostty">Ghostty</option></select></Row>
      <Toggle s={s} save={save} k="notifications" label="Notificações" hint="Quando um agente termina ou pede permissão com o app em segundo plano" />
      <Row label="Som de conclusão" hint="Toca com a notificação do sistema">
        <div className="row">
          <select value={s.sound ? s.completion_sound ?? "Glass" : "none"} onChange={(e) => save({ ...s, sound: e.target.value !== "none", completion_sound: e.target.value })} data-testid="sound-select">
            {SOUNDS.map((x) => <option key={x} value={x}>{x === "none" ? "Sem som" : x}</option>)}
          </select>
          <button className="btn" disabled={!s.sound} onClick={() => api.soundPlay(s.completion_sound ?? "Glass").catch((e) => onError(String(e)))} data-testid="sound-test">Testar</button>
        </div>
      </Row>
      <Toggle s={s} save={save} k="show_resources" label="Mostrar uso de recursos na barra lateral" hint="Memória e CPU do Kabul e dos agentes; o detalhe abre com um clique" />
      <Toggle s={s} save={save} k="caffeinate" label="Manter o Mac acordado com agentes rodando" hint="Usa caffeinate enquanto houver uma sessão ativa" />
      <Toggle s={s} save={save} k="tray" label="Ícone na barra de menus" hint="Limites e gasto de IA, agentes rodando e ações rápidas (bandeja no Windows)" />
      <Row label="Avisar perto do limite" hint="Notifica quando uma janela de uso (5 h, semana, mês) passar disto" id="usage_alert_pct">
        <select value={s.usage_alert_pct ?? 80} onChange={(e) => save({ ...s, usage_alert_pct: Number(e.target.value) })} data-testid="usage-alert-pct">
          {[50, 70, 80, 90, 95].map((p) => <option key={p} value={p}>{p}%</option>)}
        </select>
      </Row>
      <Row label="Orçamento de IA (US$)" hint="Avisa em 80% e em 100%; só conta o custo que o agente reporta" id="usage_budget">
        <div className="row">
          <input type="number" min={0} step={1} placeholder="por dia" defaultValue={s.usage_daily_budget ?? ""} style={{ width: 90 }} onBlur={(e) => save({ ...s, usage_daily_budget: e.target.value ? Number(e.target.value) : null })} data-testid="usage-daily-budget" />
          <input type="number" min={0} step={1} placeholder="por mês" defaultValue={s.usage_monthly_budget ?? ""} style={{ width: 90 }} onBlur={(e) => save({ ...s, usage_monthly_budget: e.target.value ? Number(e.target.value) : null })} data-testid="usage-monthly-budget" />
        </div>
      </Row>
      <Toggle s={s} save={save} k="usage_codexbar" label="Ler o CodexBar quando instalado" hint="Limites de mais provedores, status e créditos pelo CLI do CodexBar (opcional)" />
      <Toggle s={s} save={save} k="always_show_context" label="Sempre mostrar o uso de contexto" hint="Sem isso, o anel só aparece acima de 70%" />
      <Toggle s={s} save={save} k="auto_convert_long_text" label="Converter texto longo em anexo" hint="Colar mais de 5.000 caracteres vira um arquivo em .context/attachments" />
      <Toggle s={s} save={save} k="not_absolutely_right" label="Esconder “You're absolutely right!”" hint="Tira a frase do começo das respostas" />
    </div>
  );
}

/** Aparência: tema, zoom, contraste, cores acessíveis, fontes, Markdown, terminal, ligaduras, diffs na barra lateral. */
export function AppearancePage() {
  const [p, setP] = useState<ThemePref>(getThemePref());
  const [zoom, setZoom] = useState(Number(localStorage.getItem("kabul.zoom") ?? "100"));
  const pref = (k: string, def: string) => {
    const [v, set] = useLocalPref(k, def);
    return [v, (n: string) => (set(n), applyAppearance())] as const;
  };
  const [contrast, setContrast] = pref("kabul.contrast", "normal");
  const [cb, setCb] = pref("kabul.cb", "default");
  const [mono, setMono] = pref("kabul.monoFont", "Geist Mono");
  const [md, setMd] = pref("kabul.mdStyle", "default");
  const [lig, setLig] = pref("kabul.ligatures", "on");
  const [diffs, setDiffs] = pref("kabul.sidebarDiffs", "colored");
  const [tfont, setTfont] = pref("kabul.term.font", "");
  const [tsize, setTsize] = pref("kabul.term.size", "12");
  useEffect(() => {
    const h = (e: Event) => setZoom((e as CustomEvent).detail);
    window.addEventListener("kabul:zoom-changed", h);
    return () => window.removeEventListener("kabul:zoom-changed", h);
  }, []);
  const opts: [ThemePref, string, React.ReactNode][] = [["light", "Claro", <ISun size={18} />], ["dark", "Escuro", <IMoon size={18} />], ["system", "Sistema", <IMonitor size={18} />]];
  return (
    <div className="set-group" data-testid="appearance">
      <div className="dim small">Tema da interface. “Sistema” segue a aparência do macOS. ⌥⌘T alterna; também em ⌘K.</div>
      <div className="theme-cards" data-testid="theme-cards">
        {opts.map(([k, label, icon]) => (
          <button key={k} className={"theme-card t-" + k + (p === k ? " on" : "")} onClick={() => (setThemePref(k), setP(k))}>
            <span className="theme-preview"><span /><span /><span /></span>
            <span className="row">{icon} {label}</span>
          </button>
        ))}
      </div>
      <Row label="Zoom do app" hint="⌘+ aumenta, ⌘− diminui, ⌘0 volta a 100%"><div className="row"><button className="btn" onClick={() => applyZoom(-1)}>−</button><span data-testid="zoom-value">{zoom}%</span><button className="btn" onClick={() => applyZoom(1)}>+</button><button className="btn" onClick={() => applyZoom(0)}>100%</button></div></Row>
      <Row label="Escuro de baixo contraste" hint="Fundo e texto mais próximos no tema escuro"><select value={contrast} onChange={(e) => setContrast(e.target.value)} data-testid="contrast"><option value="normal">Normal</option><option value="low">Baixo contraste</option></select></Row>
      <Row label="Cores acessíveis" hint="Troca verde/vermelho dos diffs e status"><select value={cb} onChange={(e) => setCb(e.target.value)} data-testid="cb"><option value="default">Padrão</option><option value="deuteranopia">Deuteranopia</option><option value="protanopia">Protanopia</option><option value="tritanopia">Tritanopia</option></select></Row>
      <Row label="Fonte monoespaçada" hint="Código, diffs e kbd"><select value={mono} onChange={(e) => setMono(e.target.value)} data-testid="mono-font"><option>Geist Mono</option><option>SF Mono</option><option>Menlo</option><option>JetBrains Mono</option></select></Row>
      <Row label="Estilo do Markdown" hint="Respostas do agente"><select value={md} onChange={(e) => setMd(e.target.value)} data-testid="md-style"><option value="default">Padrão</option><option value="tufte">Tufte (serifa)</option></select></Row>
      <Row label="Ligaduras no código"><select value={lig} onChange={(e) => setLig(e.target.value)}><option value="on">Ligadas</option><option value="off">Desligadas</option></select></Row>
      <Row label="Diffs coloridos na barra lateral" hint="+N −M em verde e vermelho"><select value={diffs} onChange={(e) => setDiffs(e.target.value)}><option value="colored">Coloridos</option><option value="plain">Discretos</option></select></Row>
      <h3>Terminal</h3>
      <Row label="Fonte do terminal" hint="Vazio = Menlo"><input {...noSuggest} autoComplete="off" value={tfont} onChange={(e) => setTfont(e.target.value)} placeholder="ex.: JetBrains Mono" data-testid="term-font" /></Row>
      <Row label="Tamanho da fonte do terminal" hint="10 a 20 px; vale para terminais abertos depois"><input type="number" min={10} max={20} value={tsize} onChange={(e) => setTsize(String(Math.min(20, Math.max(10, Number(e.target.value) || 12))))} data-testid="term-size" style={{ width: 70 }} /></Row>
      <div className="term-preview" style={{ fontFamily: `${tfont ? `"${tfont}", ` : ""}Menlo, monospace`, fontSize: Number(tsize) }}>dev@mac kabul % echo $KABUL_PORT<br />41000</div>
      <BigTerminalPreset />
    </div>
  );
}

/** Modelos: estilo de saída do Claude, personalidade do Codex, modelo da revisão e plano como padrão. */
export function ModelsPage({ onError }: { onError: (e: string) => void }) {
  const [s, save] = useAppSettings(onError);
  const [models, setModels] = useState<Model[]>([]);
  useEffect(() => void api.models().then(setModels, () => {}), []);
  if (!s) return null;
  return (
    <div className="set-group" data-testid="models-page">
      <Row label="Estilo de saída do Claude Code" hint="Passado ao Claude como --settings outputStyle"><select value={s.claude_output_style ?? "default"} onChange={(e) => save({ ...s, claude_output_style: e.target.value })} data-testid="output-style">{["default", "Proactive", "Concise", "Explanatory", "Learning"].map((o) => <option key={o} value={o}>{o === "default" ? "Padrão" : o}</option>)}</select></Row>
      <Row label="Personalidade do Codex" hint="Guardada; o Codex instalado ainda não tem a opção confirmada"><select value={s.codex_personality ?? "pragmatic"} onChange={(e) => save({ ...s, codex_personality: e.target.value })}><option value="pragmatic">Pragmática</option><option value="friendly">Amigável</option><option value="none">Nenhuma</option></select></Row>
      <Row label="Modelo da revisão" hint="O botão Revisar (⌘⇧R) abre uma conversa nova com este modelo"><select value={s.review_model ?? ""} onChange={(e) => save({ ...s, review_model: e.target.value || null })} data-testid="review-model"><option value="">O da conversa atual</option>{models.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></Row>
      <Toggle s={s} save={save} k="default_plan" label="Conversas novas em plan mode" hint="⇧⇥ alterna em cada conversa" />
      <Toggle s={s} k="agy_skip_permissions" danger label="Gemini: aprovar tudo automaticamente (--dangerously-skip-permissions)"
        hint="Desligado (padrão): cada comando ou escrita do Gemini (agy) pede aprovação num cartão e a regra aprovada fica só neste workspace. Ligado: o agente roda qualquer comando e grava qualquer arquivo sem perguntar. Vale para conversas novas."
        save={async (n) => {
          if (n.agy_skip_permissions && !(await confirmDialog("Aprovar tudo automaticamente no Gemini? O agente vai rodar comandos e alterar arquivos sem pedir permissão. Use só em repositórios em que você confia.", { ok: "Aprovar tudo", danger: true }))) return;
          save(n);
        }} />
    </div>
  );
}

/** Ambiente por escopo: usuário (todas as conversas), repo local (editável) e repo compartilhado (herdado, só leitura). */
export function EnvironmentPage({ repos, onError }: { repos: Repo[]; onError: (e: string) => void }) {
  const [s, save] = useAppSettings(onError);
  const [scope, setScope] = useState("user");
  const [bulk, setBulk] = useState("");
  const [layers, setLayers] = useState<[string, Record<string, string>][]>([]);
  const [repoSet, setRepoSet] = useState<RepoSettingsT | null>(null);
  useEffect(() => {
    if (scope === "user") return;
    api.repoEnvLayers(scope).then(setLayers, (e) => onError(String(e)));
    api.repoSettings(scope).then((r) => setRepoSet(r.settings), () => {});
  }, [scope, onError]);
  if (!s) return null;
  const valid = (k: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k);
  const parse = (t: string) => t.split("\n").map((l) => l.trim().replace(/^export\s+/, "")).filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^(["'])(.*)\1$/, "$2")] as [string, string]).filter(([k]) => valid(k));
  const shared = layers.find(([n]) => n === "repo")?.[1] ?? {};
  const local = layers.find(([n]) => n === "repo local")?.[1] ?? {};
  const saveLocal = async (env: Record<string, string>) => {
    if (!repoSet) return;
    // A camada local guarda só o que difere da compartilhada (o resto é herdado).
    const n = { ...repoSet, env };
    setRepoSet(n);
    await api.saveRepoSettings(scope, n).catch((e) => onError(String(e)));
    api.repoEnvLayers(scope).then(setLayers, () => {});
  };
  return (
    <div className="set-group" data-testid="env-page">
      <div className="scope-seg">
        <button className={"rtab" + (scope === "user" ? " on" : "")} onClick={() => setScope("user")} data-testid="env-scope-user">Usuário</button>
        {repos.map((r) => <button key={r.id} className={"rtab" + (scope === r.id ? " on" : "")} onClick={() => setScope(r.id)} data-testid="env-scope-repo">{r.name}</button>)}
      </div>
      {scope === "user" ? (
        <>
          <p className="dim small">Passadas aos agentes, scripts e terminais. Escopo “all” ou um agente (claude, codex, opencode, qwen, gemini, agy). Ex.: ANTHROPIC_BASE_URL, CLAUDE_CODE_USE_BEDROCK, HTTPS_PROXY.</p>
          {s.env.map((v, i) => (
            <div key={i} className="row env-row" data-testid="env-row">
              <input {...noSuggest} autoComplete="off" value={v.key} placeholder="CHAVE" className={v.key && !valid(v.key) ? "invalid" : ""} onChange={(e) => save({ ...s, env: s.env.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} />
              <input {...noSuggest} autoComplete="off" value={v.value} placeholder="valor" type="password" onChange={(e) => save({ ...s, env: s.env.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              <select value={v.scope} onChange={(e) => save({ ...s, env: s.env.map((x, j) => (j === i ? { ...x, scope: e.target.value } : x)) })}>{["all", "claude", "codex", "opencode", "qwen", "gemini", "agy"].map((o) => <option key={o}>{o}</option>)}</select>
              <button className="btn" onClick={() => save({ ...s, env: s.env.filter((_, j) => j !== i) })}>Remover</button>
            </div>
          ))}
          <div className="row"><button className="btn" onClick={() => save({ ...s, env: [...s.env, { key: "", value: "", scope: "all" }] })} data-testid="env-add">Adicionar variável</button></div>
          <label className="field">Colar em bloco (KEY=VALUE por linha)<textarea rows={3} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"API_URL=http://localhost:3000\nexport DEBUG=1"} data-testid="env-bulk" /></label>
          <div className="row"><button className="btn" disabled={!parse(bulk).length} onClick={() => (save({ ...s, env: [...s.env.filter((x) => !parse(bulk).some(([k]) => k === x.key)), ...parse(bulk).map(([key, value]) => ({ key, value, scope: "all" }))] }), setBulk(""))} data-testid="env-bulk-add">Adicionar {parse(bulk).length || ""} variáveis</button></div>
          <Row label="Arquivo .env do usuário" hint="Lido antes das variáveis acima (KEY=VALUE)"><input {...noSuggest} autoComplete="off" defaultValue={s.env_file ?? ""} onBlur={(e) => save({ ...s, env_file: e.target.value || null })} placeholder="~/.config/kabul/.env" data-testid="env-file" /></Row>
        </>
      ) : (
        <>
          <p className="dim small">Valem para os workspaces deste repositório. As do repositório compartilhado (<code>.kabul/settings.toml</code>, versionado) aparecem como herdadas; as suas ficam em <code>settings.local.toml</code> e sobrescrevem.</p>
          {Object.entries({ ...shared, ...local }).map(([k, v]) => {
            const inherited = k in shared && !(k in local);
            const over = k in shared && k in local;
            return (
              <div key={k} className="row env-row" data-testid="repo-env-row">
                <code>{k}</code>
                <input {...noSuggest} autoComplete="off" defaultValue={v} disabled={inherited} onBlur={(e) => e.target.value !== v && saveLocal({ ...local, [k]: e.target.value })} />
                {inherited && <span className="badge">herdada do repositório</span>}
                {over && <span className="badge ok">sobrescrita localmente</span>}
                {inherited ? <button className="btn" onClick={() => saveLocal({ ...local, [k]: v })}>Sobrescrever</button> : <button className="btn" onClick={() => { const n = { ...local }; delete n[k]; saveLocal(n); }}>{over ? "Voltar ao herdado" : "Remover"}</button>}
              </div>
            );
          })}
          <label className="field">Adicionar (KEY=VALUE por linha)<textarea rows={2} value={bulk} onChange={(e) => setBulk(e.target.value)} data-testid="repo-env-bulk" /></label>
          <div className="row"><button className="btn" disabled={!parse(bulk).length} onClick={() => (saveLocal({ ...local, ...Object.fromEntries(parse(bulk)) }), setBulk(""))} data-testid="repo-env-add">Adicionar</button></div>
        </>
      )}
    </div>
  );
}

/** Ações (por repositório): instruções extras para revisão, criar PR, corrigir erros, conflitos, branch e gerais. */
export function ActionsPage({ repos, repoId, onError, onRoute }: { repos: Repo[]; repoId?: string; onError: (e: string) => void; onRoute: (r: Route) => void }) {
  const [s, setS] = useState<RepoSettingsT | null>(null);
  const [saved, setSaved] = useState(false);
  const id = repoId ?? repos[0]?.id;
  useEffect(() => void (id && api.repoSettings(id).then((r) => setS(r.settings), (e) => onError(String(e)))), [id, onError]);
  if (!repos.length) return <p className="dim">Adicione um repositório primeiro.</p>;
  if (!s) return null;
  const prompts: Prompts = s.prompts ?? { general: null, review: null, create_pr: null, fix_errors: null, resolve_conflicts: null, branch_rename: null };
  const save = (k: keyof Prompts, v: string) => {
    const n = { ...s, prompts: { ...prompts, [k]: v.trim() ? v : null } };
    setS(n);
    api.saveRepoSettings(id!, n).then(() => (setSaved(true), setTimeout(() => setSaved(false), 1200)), (e) => onError(String(e)));
  };
  return (
    <div className="set-group" data-testid="actions-page">
      <div className="set-row"><div>Repositório</div><select value={id} onChange={(e) => onRoute({ kind: "settings", tab: "acoes", repoId: e.target.value })}>{repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
      <p className="dim small">Instruções acrescentadas ao prompt de cada ação, neste repositório. As “Preferências gerais” também vão para o Claude como instrução de sistema. {saved && <span className="ok">salvo</span>}</p>
      {PROMPT_LABEL.map(([k, label, hint]) => (
        <label key={k} className="field prompt-field">{label} <span className="dim small">{hint}</span>
          <textarea rows={3} defaultValue={prompts[k] ?? ""} onBlur={(e) => save(k, e.target.value)} placeholder={k === "general" ? "ex.: Responda em português; rode os testes antes de dizer que terminou." : `Padrão: ${(DEFAULT_PROMPTS[k] || "").slice(0, 110)}…`} data-testid={`prompt-${k}`} />
        </label>
      ))}
    </div>
  );
}

const ICONS = ["", "🚀", "🧪", "🛒", "📱", "🌐", "⚙️", "📦", "🎮", "📊", "🤖", "🔧"];

/** Diversos do repositório: ícone, caminhos (só leitura), URL de preview com a porta e remover. */
export function MiscPage({ repos, repoId, onError, onRoute, onChange }: { repos: Repo[]; repoId?: string; onError: (e: string) => void; onRoute: (r: Route) => void; onChange: () => void }) {
  const id = repoId ?? repos[0]?.id;
  const repo = repos.find((r) => r.id === id);
  const [s, setS] = useState<RepoSettingsT | null>(null);
  useEffect(() => void (id && api.repoSettings(id).then((r) => setS(r.settings), (e) => onError(String(e)))), [id, onError]);
  if (!repo) return <p className="dim">Adicione um repositório primeiro.</p>;
  return (
    <div className="set-group" data-testid="misc-page">
      <div className="set-row"><div>Repositório</div><select value={id} onChange={(e) => onRoute({ kind: "settings", tab: "diversos", repoId: e.target.value })}>{repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
      <Row label="Ícone" hint="Aparece na barra lateral no lugar da inicial">
        <div className="emoji-grid">{ICONS.map((e) => <button key={e || "none"} className={"emoji" + ((repo.icon ?? "") === e ? " on" : "")} onClick={() => api.repoUpdate(repo.id, { icon: e }).then(onChange, (x) => onError(String(x)))} data-testid="repo-icon">{e || <RepoMark name={repo.name} size={16} />}</button>)}</div>
      </Row>
      <Row label="Pasta do repositório"><code className="dim small">{repo.path}</code></Row>
      <Row label="URL de preview" hint="$KABUL_PORT e $((KABUL_PORT+1)) viram a porta do workspace (⌘⇧B no terminal abre localhost)">
        {s && <input {...noSuggest} autoComplete="off" defaultValue={s.preview_url ?? ""} placeholder="http://localhost:$KABUL_PORT" onBlur={(e) => api.saveRepoSettings(repo.id, { ...s, preview_url: e.target.value || null }).catch((x) => onError(String(x)))} data-testid="preview-url" />}
      </Row>
      <Row label="Remover repositório" hint="Tira do Kabul; a pasta continua no disco. Os workspaces precisam estar arquivados.">
        <button className="btn danger" onClick={async () => { if (await confirmDialog(`Remover ${repo.name} do Kabul?`, { ok: "Remover", danger: true })) api.removeRepo(repo.id).then(() => (onChange(), onRoute({ kind: "settings", tab: "geral" })), (e) => onError(String(e))); }} data-testid="repo-remove">Remover…</button>
      </Row>
    </div>
  );
}

/** Avançado: pasta de estado, executáveis dos agentes, scrollback do terminal e atualizações. */
export function AdvancedPage({ onError }: { onError: (e: string) => void }) {
  const [s, save] = useAppSettings(onError);
  if (!s) return null;
  const path = (k: "claude_path" | "codex_path" | "opencode_path", label: string, ph: string) => (
    <Row label={label} hint="Vazio = o do PATH"><div className="row"><input {...noSuggest} autoComplete="off" defaultValue={s[k] ?? ""} placeholder={ph} onBlur={(e) => save({ ...s, [k]: e.target.value || null })} data-testid={`bin-${k}`} /><button className="btn" onClick={() => save({ ...s, [k]: null })}>Padrão</button></div></Row>
  );
  return (
    <div className="set-group" data-testid="advanced-page">
      <Row label="Pasta de estado do Kabul" hint="Configurações, histórico e logs (logs/agents.log)"><code className="dim small">~/Library/Application Support/kabul</code></Row>
      {path("claude_path", "Executável do Claude Code", "/opt/homebrew/bin/claude")}
      {path("codex_path", "Executável do Codex", "/opt/homebrew/bin/codex")}
      {path("opencode_path", "Executável do OpenCode", "~/.opencode/bin/opencode")}
      <Row label="Limite do scrollback do terminal" hint="Em MB; vale para terminais abertos depois">
        <input type="number" min={1} max={200} defaultValue={s.scrollback_mb ?? 10} onBlur={(e) => { const v = Math.max(1, Number(e.target.value) || 10); localStorage.setItem("kabul.term.scrollback", String(v)); save({ ...s, scrollback_mb: v }); }} style={{ width: 80 }} data-testid="scrollback" />
      </Row>
      <UpdatesSection s={s} save={save} />
    </div>
  );
}

export type { AppSettings };

/** Terminal grande (aba ⌘⇧T no centro): comando que já roda ao abrir a aba. */
import { TERM_PRESETS, termPreset } from "../components/chatPrefs";
export { TERM_PRESETS, termPreset };
function BigTerminalPreset() {
  const [k, setK] = useState(localStorage.getItem("kabul.bigTerminal.preset") ?? "none");
  const [cmd, setCmd] = useState(localStorage.getItem("kabul.bigTerminal.command") ?? "");
  useEffect(() => void localStorage.setItem("kabul.bigTerminal.preset", k), [k]);
  useEffect(() => void localStorage.setItem("kabul.bigTerminal.command", cmd), [cmd]);
  return (
    <>
      <Row label="Aba de terminal (⌘⇧T) abre com" hint="O comando roda assim que a aba abre, no worktree do workspace">
        <select value={k} onChange={(e) => setK(e.target.value)} data-testid="term-preset">
          <option value="none">Nada (só o shell)</option><option value="claude">Claude Code</option><option value="codex">Codex</option><option value="agy">Gemini (Antigravity)</option><option value="opencode">OpenCode</option><option value="custom">Comando…</option>
        </select>
      </Row>
      {k === "custom" && <Row label="Comando"><input {...noSuggest} autoComplete="off" value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="ex.: npm run dev" data-testid="term-preset-cmd" /></Row>}
    </>
  );
}
