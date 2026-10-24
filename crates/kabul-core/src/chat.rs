//! Início de uma conversa com o agente, igual no app e no `kabul serve`: resolve o harness (inclusive
//! modelos locais), monta o ambiente (workspace, repo, configurações, conta) e as opções da sessão.
use crate::accounts::{self, Accounts};
use crate::harness::{self, HarnessKind, Running, SessionOptions};
use crate::local::{self, CustomEndpoint};
use crate::models::{self, Model};
use crate::registry::Registry;
use crate::settings::AppSettings;
use crate::store::{Repo, Workspace};
use anyhow::{anyhow, Result};
use std::path::Path;

/// Pedido do frontend (mesmos campos do comando `chat_start`).
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub model: Option<Model>,
    pub effort: Option<String>,
    pub fast: Option<bool>,
    pub resume: Option<String>,
    pub plan: Option<bool>,
    pub disabled_mcp: Option<Vec<String>>,
    pub fork: Option<bool>,
    pub account: Option<String>,
}

pub struct Prepared {
    pub kind: HarnessKind,
    pub opts: SessionOptions,
    pub note: Option<String>,
}

/// Monta as opções da sessão para o workspace. `home` é a pasta de estado do Kabul.
pub fn prepare(home: &Path, w: &Workspace, r: &Repo, model: &Model, req: &ChatRequest, endpoints: &[CustomEndpoint], registry: &Registry) -> Result<Prepared> {
    let mut k = model.harness;
    let mut note = None;
    let mut endpoint = None;
    if let Some(l) = &model.local {
        let src = local::discover(endpoints).into_iter().find(|s| s.id == l.source).ok_or_else(|| anyhow!("fonte do modelo local não encontrada"))?;
        let lm = src.models.iter().find(|m| m.id == l.model).cloned().ok_or_else(|| anyhow!("modelo não está mais disponível"))?;
        let res = registry.resolve(&lm.id, &src.apis, &|h| h.installed());
        k = res.harness.ok_or_else(|| anyhow!(res.note.clone()))?;
        note = Some(res.note);
        let key = endpoints.iter().find(|x| x.id == src.id).and_then(|x| x.api_key.clone());
        endpoint = Some(local::prepare(&src, &lm, key)?);
    }
    let set = AppSettings::load(&home.join("app-settings.json"));
    let mut env = w.full_env(r);
    env.extend(set.env_for(k.binary()));
    // Conta escolhida para esta conversa (perfil com config isolada); sem escolha, a padrão do provedor.
    let accs = Accounts::open(home);
    let prof = req.account.as_deref().and_then(|id| accs.get(id)).unwrap_or_else(|| accs.default_for(accounts::provider_of(k)));
    env.extend(accounts::env_for(&prof));
    let cli_model = if endpoint.is_some() { None } else { Some(models::cli_model(model, req.effort.as_deref())) };
    let effort = if model.effort_in_id || model.efforts.is_empty() { None } else { req.effort.clone() };
    let disabled_mcp = req.disabled_mcp.clone().unwrap_or_default();
    // Claude: com MCP desligado na sessão, passa só os habilitados (--mcp-config + --strict-mcp-config).
    let mcp_config = if k == HarnessKind::Claude && !disabled_mcp.is_empty() {
        let entries = crate::mcp::list(k, Path::new(&w.path), Path::new(&r.path));
        Some(crate::mcp::claude_config_file(&entries, &disabled_mcp, &home.join("mcp"))?.display().to_string())
    } else {
        None
    };
    let h = k.harness();
    let plan = req.plan.unwrap_or(false);
    // Claude: estilo de saída (Configurações › Modelos) e preferências gerais do repo (› Ações).
    let (rs, _) = crate::settings::load(Path::new(&r.path), &r.default_branch);
    let settings_json = (k == HarnessKind::Claude && set.claude_output_style != "default" && !set.claude_output_style.is_empty()).then(|| serde_json::json!({ "outputStyle": set.claude_output_style }).to_string());
    let system_prompt = if k == HarnessKind::Claude { rs.prompts.general.clone().filter(|g| !g.trim().is_empty()) } else { None };
    let opts = SessionOptions {
        fork: req.fork.unwrap_or(false),
        mcp_config,
        disabled_mcp,
        cwd: Some(w.path.clone()),
        model: cli_model,
        effort,
        resume: req.resume.clone(),
        approvals_via_app: h.app_approvals(),
        // Claude em `default` (aprovações vêm para o app) ou `plan`; os outros no modo deles.
        permission_mode: if plan { Some("plan".into()) } else if k == HarnessKind::Claude { Some("default".into()) } else { None },
        endpoint,
        env,
        settings_json,
        system_prompt,
        ..Default::default()
    };
    Ok(Prepared { kind: k, opts, note })
}

/// Prepara e inicia a sessão.
pub fn start(home: &Path, w: &Workspace, r: &Repo, model: &Model, req: &ChatRequest, endpoints: &[CustomEndpoint], registry: &Registry) -> Result<(Prepared, Running)> {
    let p = prepare(home, w, r, model, req, endpoints, registry)?;
    let running = harness::spawn(p.kind.harness().as_ref(), &p.opts)?;
    Ok((p, running))
}

/// Repassa os eventos da sessão até ela terminar. Guarda as últimas linhas de stderr e, se o agente
/// sair sem responder (ou com erro) sem ter sido parado pelo usuário, emite um `error` legível antes
/// do `exited`. Registra início e fim em `log` (sem valores do ambiente).
pub fn pump(rx: std::sync::mpsc::Receiver<harness::Event>, emit: impl FnMut(serde_json::Value), stopped: impl Fn() -> bool, wait: impl FnOnce() -> Option<i32>, log: Option<(std::path::PathBuf, String)>) {
    pump_with(rx, |_| {}, emit, stopped, wait, log)
}

/// Como [`pump`], mas `tap` vê cada evento antes de ser emitido (ex.: espelho no kabuld embutido).
pub fn pump_with(rx: std::sync::mpsc::Receiver<harness::Event>, mut tap: impl FnMut(&harness::Event), mut emit: impl FnMut(serde_json::Value), stopped: impl Fn() -> bool, wait: impl FnOnce() -> Option<i32>, log: Option<(std::path::PathBuf, String)>) {
    use harness::Event;
    let mut tail: std::collections::VecDeque<String> = Default::default();
    let mut answered = false;
    for ev in rx {
        match &ev {
            Event::Log { line } => {
                tail.push_back(line.clone());
                if tail.len() > 20 {
                    tail.pop_front();
                }
            }
            Event::Text { .. } | Event::TextDelta { .. } | Event::TurnCompleted { .. } | Event::ToolUse { .. } | Event::ApprovalRequest { .. } => answered = true,
            _ => {}
        }
        tap(&ev);
        emit(serde_json::to_value(&ev).unwrap_or_default());
    }
    let code = wait();
    let user_stopped = stopped();
    if !user_stopped && (code.unwrap_or(0) != 0 || !answered) {
        let detail = tail.iter().rev().take(8).rev().cloned().collect::<Vec<_>>().join("\n");
        let what = match code { Some(0) | None => "O agente encerrou sem responder".to_string(), Some(c) => format!("O agente encerrou com erro (código {c})") };
        emit(serde_json::json!({ "type": "error", "message": if detail.is_empty() { what } else { format!("{what}:\n{detail}") } }));
    }
    if let Some((file, header)) = log {
        let _ = std::fs::create_dir_all(file.parent().unwrap_or(std::path::Path::new(".")));
        let line = format!("{header} · saiu {code:?}{} · respondeu {answered}\n{}\n", if user_stopped { " (parado)" } else { "" }, tail.iter().map(|l| format!("  | {l}")).collect::<Vec<_>>().join("\n"));
        let _ = std::fs::OpenOptions::new().create(true).append(true).open(file).and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
    }
    emit(serde_json::json!({ "type": "exited", "code": code }));
}

/// Cabeçalho do log de agentes: programa, argumentos, pasta e as CHAVES do ambiente (nunca valores).
pub fn log_header(p: &Prepared) -> String {
    let spec = p.kind.harness().command(&p.opts);
    let keys: Vec<&str> = p.opts.env.iter().map(|(k, _)| k.as_str()).collect();
    format!("[{}] {} {} (cwd {}) env: {}", crate::store::now(), spec.program, spec.args.join(" "), p.opts.cwd.as_deref().unwrap_or("-"), keys.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::Event;

    #[test]
    fn saida_sem_resposta_vira_erro() {
        let (tx, rx) = std::sync::mpsc::channel();
        tx.send(Event::Log { line: "erro: token expirado".into() }).unwrap();
        drop(tx);
        let mut got = vec![];
        let log = std::env::temp_dir().join(format!("kabul-agents-{}.log", std::process::id()));
        pump(rx, |v| got.push(v), || false, || Some(0), Some((log.clone(), "[t] agy -p=".into())));
        assert_eq!(got[1]["type"], "error");
        assert!(got[1]["message"].as_str().unwrap().contains("sem responder:\nerro: token expirado"));
        assert_eq!(got[2]["type"], "exited");
        assert!(std::fs::read_to_string(&log).unwrap().contains("respondeu false"));
        std::fs::remove_file(log).ok();
        // Parado pelo usuário: sem erro.
        let (tx, rx) = std::sync::mpsc::channel::<Event>();
        drop(tx);
        let mut got = vec![];
        pump(rx, |v| got.push(v), || true, || Some(137), None);
        assert_eq!(got.len(), 1);
        // Respondeu e saiu com 0: sem erro.
        let (tx, rx) = std::sync::mpsc::channel();
        tx.send(Event::TextDelta { text: "ok".into() }).unwrap();
        drop(tx);
        let mut got = vec![];
        pump(rx, |v| got.push(v), || false, || Some(0), None);
        assert_eq!(got.iter().filter(|v| v["type"] == "error").count(), 0);
    }
}

#[cfg(test)]
mod prep_tests {
    use super::*;

    #[test]
    fn estilo_e_preferencias_do_repo_no_claude() {
        let tmp = std::env::temp_dir().join(format!("kabul-chatprep-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let repo = tmp.join("r");
        std::fs::create_dir_all(repo.join(".kabul")).unwrap();
        std::fs::write(repo.join(".kabul/settings.toml"), "[prompts]\ngeneral = \"Responda em português.\"\n").unwrap();
        let home = tmp.join("home");
        let mut set = AppSettings::default();
        set.claude_output_style = "Explanatory".into();
        set.save(&home.join("app-settings.json")).unwrap();
        let r = Repo { id: "r".into(), name: "r".into(), path: repo.display().to_string(), default_branch: "main".into(), ..Default::default() };
        let w = Workspace { id: "w".into(), repo_id: "r".into(), name: "kabul".into(), path: repo.display().to_string(), ..Default::default() };
        let m = models::catalog().into_iter().find(|m| m.harness == HarnessKind::Claude).unwrap();
        let p = prepare(&home, &w, &r, &m, &ChatRequest::default(), &[], &Registry::load(&home.join("nao-existe.json"))).unwrap();
        let args = p.kind.harness().command(&p.opts).args.join(" ");
        assert!(args.contains(r#"--settings {"outputStyle":"Explanatory"}"#), "{args}");
        assert!(args.contains("--append-system-prompt Responda em português."), "{args}");
        assert!(log_header(&p).contains("env: KABUL_"));
        std::env::set_var(crate::harness::bin_override_var("kabul-teste"), "/bin/sh");
        assert_eq!(crate::harness::which("kabul-teste").unwrap(), std::path::PathBuf::from("/bin/sh"));
        std::fs::remove_dir_all(&tmp).ok();
    }
}
