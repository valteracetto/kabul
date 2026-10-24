import { useEffect, useMemo, useRef, useState } from "react";
import { api, type GhRepo, type Repo } from "../api";
import { noSuggest } from "../noSuggest";
import { ISearch } from "../icons";

const ago = (iso: string) => {
  const d = (Date.now() - Date.parse(iso)) / 86400000;
  if (!isFinite(d)) return "";
  if (d < 1) return "hoje";
  if (d < 2) return "ontem";
  if (d < 30) return `há ${Math.floor(d)} dias`;
  if (d < 365) return `há ${Math.floor(d / 30)} ${Math.floor(d / 30) === 1 ? "mês" : "meses"}`;
  return `há ${Math.floor(d / 365)} ano${d >= 730 ? "s" : ""}`;
};

const looksLikeRepo = (t: string) => /^(https?:\/\/|git@|ssh:\/\/|github\.com\/)/.test(t.trim()) || /^[\w.-]+\/[\w.-]+$/.test(t.trim());

/** Pasta padrão dos projetos novos (configurações), carregada uma vez. */
export function useCloneDir(): [string, (d: string) => void] {
  const [dir, setDir] = useState("~/Developer");
  useEffect(() => void api.appSettings().then((s) => s.clone_dir && setDir(s.clone_dir), () => {}), []);
  return [dir, setDir];
}

function Location({ dir, setDir }: { dir: string; setDir: (d: string) => void }) {
  return (
    <label className="field">Local
      <div className="row">
        <input {...noSuggest} autoComplete="off" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="Caminho ou clique em Escolher…" data-testid="clone-dir" style={{ flex: 1 }} />
        <button className="btn" onClick={async () => { const p = await api.pickFolder().catch(() => null); if (p) setDir(p); }}>Escolher…</button>
      </div>
    </label>
  );
}

/** "Abrir projeto do GitHub": repos da conta conectada (recentes primeiro) ou URL/owner/repo; clona com progresso. */
export function CloneDialog({ onClose, onDone }: { onClose: () => void; onDone: (r: Repo) => void }) {
  const [repos, setRepos] = useState<GhRepo[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dir, setDir] = useCloneDir();
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<{ phase: string; pct: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => void api.ghRepos().then(setRepos, (e) => (setRepos([]), setListErr(String(e)))), []);
  useEffect(() => api.onCloneProgress(setProg), []);
  useEffect(() => input.current?.focus(), []);
  const shown = useMemo(() => (repos ?? []).filter((r) => !q || looksLikeRepo(q) && q.includes(r.name_with_owner) || r.name_with_owner.toLowerCase().includes(q.toLowerCase().trim())), [repos, q]);
  const clone = async (target: string) => {
    setErr(null);
    if (!target.trim()) return setErr("Informe a URL ou owner/repo.");
    if (!dir.trim()) return setErr("Escolha a pasta de destino.");
    setBusy(true);
    setProg(null);
    try {
      onDone(await api.cloneTo(target.trim(), dir.trim()));
    } catch (e) {
      setErr(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay" onMouseDown={() => !busy && onClose()}>
      <div className="popover dialog clone-dialog" onMouseDown={(e) => e.stopPropagation()} data-testid="clone-dialog" onKeyDown={(e) => e.key === "Escape" && !busy && (e.stopPropagation(), onClose())}>
        <div className="dialog-title">Clonar repositório do GitHub</div>
        <div className="dim small">Escolha um repositório recente da sua conta ou cole a URL (ou owner/repo).</div>
        <label className="pop-search"><ISearch />
          <input ref={input} {...noSuggest} autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ou colar https://github.com/owner/repo" data-testid="clone-q"
            onKeyDown={(e) => e.key === "Enter" && !busy && clone(looksLikeRepo(q) ? q : shown[0]?.name_with_owner ?? q)} />
        </label>
        <div className="pop-title">Recentes</div>
        <div className="clone-list" data-testid="clone-list">
          {repos === null && <div className="dim small">Carregando os repositórios da conta…</div>}
          {listErr && <div className="dim small">Não deu para listar os repositórios ({listErr}). Cole a URL acima.</div>}
          {shown.map((r) => (
            <div key={r.name_with_owner} className={"pop-row" + (q === r.name_with_owner ? " on" : "")} onClick={() => setQ(r.name_with_owner)} onDoubleClick={() => clone(r.name_with_owner)} data-testid="clone-repo" title={r.description ?? r.url}>
              {r.avatar ? <img className="mach-avatar" src={r.avatar} alt="" width={18} height={18} /> : <span className="mach-avatar mono" style={{ width: 18, height: 18 }}>{r.owner[0]?.toUpperCase()}</span>}
              <span className="label">{r.name_with_owner}</span>
              <span className={"badge" + (r.private ? "" : " ok")}>{r.private ? "privado" : "público"}</span>
              <span className="grow" /><span className="dim small">{ago(r.updated_at)}</span>
            </div>
          ))}
          {repos && !listErr && shown.length === 0 && <div className="dim small">{looksLikeRepo(q) ? `Clonar ${q}` : "Nenhum repositório com esse nome."}</div>}
        </div>
        <Location dir={dir} setDir={setDir} />
        {busy && <div className="clone-progress" data-testid="clone-progress"><div className="bar"><span style={{ width: `${prog?.pct ?? 8}%` }} /></div><span className="dim small">{prog ? `${prog.phase} ${prog.pct}%` : "Clonando…"}</span></div>}
        {err && <div className="error small" role="alert" data-testid="clone-error">{err}</div>}
        <div className="row end">
          <button className="btn" disabled={busy} onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy || !q.trim()} onClick={() => clone(q)} data-testid="clone-go">{busy ? "Clonando…" : "Clonar"}</button>
        </div>
      </div>
    </div>
  );
}

/** "Início rápido": projeto novo do zero (pasta, git init, README e primeiro commit). */
export function QuickStartDialog({ onClose, onDone }: { onClose: () => void; onDone: (r: Repo) => void }) {
  const [name, setName] = useState("");
  const [dir, setDir] = useCloneDir();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setErr(null);
    setBusy(true);
    try {
      onDone(await api.quickStart(name.trim(), dir.trim()));
    } catch (e) {
      setErr(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay" onMouseDown={() => !busy && onClose()}>
      <div className="popover dialog" onMouseDown={(e) => e.stopPropagation()} data-testid="quick-dialog" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}>
        <div className="dialog-title">Início rápido</div>
        <div className="dim small">Cria uma pasta com git, README e o primeiro commit, e já adiciona como projeto.</div>
        <label className="field">Nome do projeto<input autoFocus {...noSuggest} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && go()} placeholder="meu-app" data-testid="quick-name" /></label>
        <Location dir={dir} setDir={setDir} />
        {err && <div className="error small" role="alert">{err}</div>}
        <div className="row end"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !name.trim()} onClick={go} data-testid="quick-go">{busy ? "Criando…" : "Criar projeto"}</button></div>
      </div>
    </div>
  );
}
