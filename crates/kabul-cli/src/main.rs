use anyhow::{bail, Result};

mod loadtest;
mod serve;
use clap::{Parser, Subcommand};
use kabul_core::harness::{HarnessKind, SessionOptions};
use kabul_core::term::{self, Cmd as TermCmd, Launch, What};
use kabul_core::{agent, auth, import::sessions::SessionImporter, worktree};

#[derive(Parser)]
#[command(name = "kabul", about = "Sessões de agentes (Claude, Codex, Antigravity) no tmux ou no terminal do Kabul")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Lista sessões tmux (com o agente detectado) e as sessões importadas de outro app.
    Ls {
        /// Não lê o banco de sessões importadas.
        #[arg(long)]
        sem_importadas: bool,
    },
    /// Cria uma sessão tmux rodando o agente: claude | codex | agy | shell.
    Run {
        agente: String,
        /// Nome da sessão tmux (padrão: kabul-<agente>-<n>).
        #[arg(long)]
        nome: Option<String>,
        /// Diretório de trabalho (padrão: atual).
        #[arg(long)]
        cwd: Option<String>,
        #[arg(long)]
        model: Option<String>,
        /// Liga o remote-control nativo (claude/agy) com esse nome.
        #[arg(long)]
        remote_control: Option<String>,
        /// Cria antes um git worktree com essa branch em ../<branch>.
        #[arg(long)]
        worktree: Option<String>,
    },
    /// Mostra se cada agente está logado (sem ler tokens).
    Auth,
    /// Runtimes locais, modelos e o harness escolhido pelo registro.
    Local,
    /// RPC HTTP sobre o core (E2E contra o backend real; embrião do kabuld).
    Serve {
        #[arg(long, default_value_t = 7790)]
        port: u16,
        /// Pasta de estado (como KABUL_HOME).
        #[arg(long)]
        home: String,
    },
    /// Um turno de chat estruturado (mesmo caminho do app). `--local <id>` usa um modelo local com o
    /// harness do registro por família (ou o de `--agente`, se ele falar uma API do servidor).
    Chat {
        prompt: String,
        /// Padrão: claude (sem `--local`) ou o do registro (com `--local`).
        #[arg(long)]
        agente: Option<String>,
        #[arg(long)]
        model: Option<String>,
        #[arg(long)]
        local: Option<String>,
        #[arg(long)]
        cwd: Option<String>,
        /// Responde pedidos de aprovação: allow | deny.
        #[arg(long, default_value = "allow")]
        aprovar: String,
    },
    /// Teste de carga do backend: kabuld real, N workspaces sintéticos, M agentes falsos e K clientes
    /// WebSocket; relatório JSON (CPU/memória do servidor, latência evento → cliente, RPC).
    Loadtest {
        #[arg(long, default_value_t = 100)]
        workspaces: usize,
        #[arg(long, default_value_t = 30)]
        agents: usize,
        /// Eventos por segundo por agente.
        #[arg(long, default_value_t = 20.0)]
        rate: f64,
        /// Segundos medidos (depois do aquecimento).
        #[arg(long, default_value_t = 20)]
        duration: u64,
        #[arg(long, default_value_t = 3)]
        warmup: u64,
        /// Clientes WebSocket: 0 e 1 assinam tudo (app, espelho); os demais só status (celular).
        #[arg(long, default_value_t = 3)]
        clients: usize,
        /// Sessões tmux de teste (prefixo kabul-test-perf-) imprimindo sem parar; o cliente 0 assiste.
        #[arg(long, default_value_t = 0)]
        tmux: usize,
        #[arg(long, default_value_t = 1500)]
        monitor_ms: u64,
        /// Limite de agentes simultâneos no kabuld (fila "aguardando vaga").
        #[arg(long)]
        max_agents: Option<usize>,
        /// Pede compressão por mensagem ao kabuld (hello.compress = deflate).
        #[arg(long)]
        compress: bool,
        /// Grava o relatório também neste arquivo.
        #[arg(long)]
        out: Option<std::path::PathBuf>,
        /// Limites (perf-budgets.json): sai com código 1 se algum passar.
        #[arg(long)]
        budgets: Option<std::path::PathBuf>,
        #[arg(long)]
        label: Option<String>,
    },
    /// Servidores MCP embutidos: `kabul mcp browser --workspace <id>` (navegador do Kabul, stdio).
    Mcp {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Navegador do Kabul de um workspace: status | open [url] | stop | clear | install.
    Browser {
        acao: String,
        /// URL (com `open`).
        url: Option<String>,
        /// Workspace (padrão: o da pasta atual).
        #[arg(long)]
        workspace: Option<String>,
        /// Pasta de estado (como KABUL_HOME).
        #[arg(long)]
        home: Option<String>,
    },
    /// Repositórios do Kabul (o mesmo estado do app; o app aberto vê a mudança sozinho).
    Repo {
        #[command(subcommand)]
        acao: RepoCmd,
    },
    /// Processo servidor do loadtest (interno).
    #[command(hide = true)]
    LoadtestWorker {
        #[arg(long)]
        home: std::path::PathBuf,
        #[arg(long)]
        port: u16,
        #[arg(long)]
        workspaces: usize,
        #[arg(long)]
        agents: usize,
        #[arg(long)]
        rate: f64,
        #[arg(long)]
        tmux: usize,
        #[arg(long)]
        monitor_ms: u64,
        /// 0 = sem limite.
        #[arg(long, default_value_t = 0)]
        max_agents: usize,
    },
}

#[derive(Subcommand)]
enum RepoCmd {
    /// Adiciona repositórios git (vários caminhos). Pula o que não é repositório git e o que já está
    /// no Kabul; uma subpasta adiciona o repositório inteiro.
    Add {
        #[arg(required = true)]
        caminhos: Vec<std::path::PathBuf>,
        /// Pasta de estado (padrão: KABUL_HOME ou a do app).
        #[arg(long)]
        home: Option<std::path::PathBuf>,
    },
    /// Lista os repositórios (nome, branch padrão, caminho).
    Ls {
        /// Pasta de estado (padrão: KABUL_HOME ou a do app).
        #[arg(long)]
        home: Option<std::path::PathBuf>,
        /// Saída em JSON.
        #[arg(long)]
        json: bool,
    },
}

fn main() -> Result<()> {
    match Cli::parse().cmd {
        Cmd::Repo { acao } => repo(acao),
        Cmd::Ls { sem_importadas } => ls(!sem_importadas),
        Cmd::Run { agente, nome, cwd, model, remote_control, worktree: wt } => run(&agente, nome, cwd, model, remote_control, wt),
        Cmd::Local => {
            let src = kabul_core::local::discover(&[]);
            for s in &src {
                println!("{:<26} instalado={:<5} rodando={:<5} apis={:?} {}", s.name, s.installed, s.running, s.apis, s.base_url);
            }
            let reg = kabul_core::registry::Registry::parse(kabul_core::registry::DEFAULT)?;
            for m in kabul_core::models::local_models(&src, &reg) {
                let l = m.local.unwrap();
                println!("  {:<32} {:<10} {}", m.id, l.source, l.note);
            }
            Ok(())
        }
        Cmd::Serve { port, home } => {
            kabul_core::shell_env::apply(&[]);
            serve::serve(port, home.into())
        }
        Cmd::Loadtest { workspaces, agents, rate, duration, warmup, clients, tmux, monitor_ms, max_agents, compress, out, budgets, label } => {
            let code = loadtest::run(loadtest::Opts { workspaces, agents, rate, duration, warmup, clients, tmux, monitor_ms, max_agents, compress, out, budgets, label })?;
            std::process::exit(code)
        }
        Cmd::LoadtestWorker { home, port, workspaces, agents, rate, tmux, monitor_ms, max_agents } => {
            loadtest::worker(loadtest::WorkerOpts { home, port, workspaces, agents, rate, tmux, monitor_ms, max_agents: (max_agents > 0).then_some(max_agents) })
        }
        Cmd::Mcp { args } => {
            let argv: Vec<String> = std::iter::once("mcp".to_string()).chain(args).collect();
            kabul_core::browser::mcp::dispatch(&argv).unwrap_or_else(|| bail!("servidor MCP desconhecido (use: kabul mcp browser --workspace <id>)"))
        }
        Cmd::Browser { acao, url, workspace, home } => browser(&acao, url, workspace, home),
        Cmd::Chat { prompt, agente, model, local, cwd, aprovar } => chat(&prompt, agente, model, local, cwd, aprovar == "allow"),
        Cmd::Auth => {
            for k in [HarnessKind::Claude, HarnessKind::Codex, HarnessKind::Antigravity] {
                match auth::status(k) {
                    Ok(s) => println!("{:<12} {}", k.binary(), if s.logged_in { "logado" } else { "NÃO logado" }),
                    Err(e) => println!("{:<12} erro: {e}", k.binary()),
                }
            }
            Ok(())
        }
    }
}

fn ls(importadas: bool) -> Result<()> {
    let b = term::backend();
    let panes = b.list()?;
    println!("== {} ({} panes)", b.kind(), panes.len());
    for (p, a) in panes.iter().zip(agent::detect_panes(&panes)) {
        println!("{:<6} {:<12} {}:{}.{}  {:<10} {}", p.pane_id, a.label(), p.session, p.window_index, p.pane_index, p.command, p.path);
    }
    if importadas {
        match SessionImporter::open_detected(None) {
            Ok(db) => {
                let ws = db.workspaces()?;
                let ss = db.sessions()?;
                println!("\n== sessões importadas ({} workspaces, {} sessões)", ws.len(), ss.len());
                for w in &ws {
                    println!("{} / {} [{}]", w.repo_name.as_deref().unwrap_or("?"), w.directory_name.as_deref().unwrap_or("?"), w.branch.as_deref().unwrap_or("-"));
                    for s in ss.iter().filter(|s| s.workspace_id.as_deref() == Some(&w.id)).take(5) {
                        println!("    {:<8} {:<8} {}", s.agent_type.as_deref().unwrap_or("claude"), s.status.as_deref().unwrap_or("-"), s.title.as_deref().unwrap_or(""));
                    }
                }
            }
            Err(e) => println!("\n== sessões importadas indisponíveis: {e}"),
        }
    }
    Ok(())
}

fn run(agente: &str, nome: Option<String>, cwd: Option<String>, model: Option<String>, remote_control: Option<String>, wt: Option<String>) -> Result<()> {
    let mut cwd = cwd.unwrap_or_else(|| std::env::current_dir().unwrap().display().to_string());
    if let Some(branch) = wt {
        let repo = std::path::PathBuf::from(&cwd);
        let path = repo.parent().unwrap_or(&repo).join(branch.replace('/', "-"));
        worktree::add(&repo, &path, &branch, None)?;
        cwd = path.display().to_string();
    }
    let command = if agente == "shell" {
        None
    } else {
        let Some(kind) = HarnessKind::parse(agente) else { bail!("agente desconhecido: {agente} (use claude, codex, agy ou shell)") };
        let opts = SessionOptions { cwd: Some(cwd.clone()), model, remote_control, ..Default::default() };
        Some(kind.harness().interactive_command(&opts))
    };
    let b = term::backend();
    if b.kind() != "tmux" {
        // Sem tmux (Windows): as sessões do PTY vivem no app/kabuld, não sobrevivem a este processo.
        // Roda aqui mesmo, neste terminal.
        let mut c = match &command {
            Some(spec) => {
                #[allow(unused_mut)]
                let mut c = spec.command();
                // Interativo neste console: sem o CREATE_NO_WINDOW que o core põe nos processos de fundo.
                #[cfg(windows)]
                std::os::windows::process::CommandExt::creation_flags(&mut c, 0);
                c
            }
            None => {
                let sh = kabul_core::shell::Shell::interactive();
                let mut c = std::process::Command::new(&sh.program);
                c.args(sh.interactive_args());
                c
            }
        };
        let st = c.current_dir(&cwd).status()?;
        std::process::exit(st.code().unwrap_or(1));
    }
    let nome = nome.unwrap_or_else(|| (1..).map(|n| format!("kabul-{agente}-{n}")).find(|n| !b.has(n)).unwrap());
    let what = match command {
        Some(spec) => What::Exec(TermCmd::Spec(spec)),
        None => What::Shell,
    };
    b.open(&Launch::new(&nome, Some(&cwd), what))?;
    println!("sessão tmux '{nome}' criada em {cwd}\nanexar: tmux attach -t {nome}");
    Ok(())
}

fn chat(prompt: &str, agente: Option<String>, model: Option<String>, local: Option<String>, cwd: Option<String>, allow: bool) -> Result<()> {
    use kabul_core::harness::{self, Event};
    let mut opts = SessionOptions { cwd: cwd.or_else(|| std::env::current_dir().ok().map(|d| d.display().to_string())), model, approvals_via_app: true, ..Default::default() };
    let kind = if let Some(id) = local {
        let src = kabul_core::local::discover(&[]);
        let s = src.iter().find(|s| s.models.iter().any(|m| m.id == id)).ok_or_else(|| anyhow::anyhow!("modelo local {id} não encontrado"))?;
        let m = s.models.iter().find(|m| m.id == id).unwrap();
        let reg = kabul_core::registry::Registry::parse(kabul_core::registry::DEFAULT)?;
        let r = reg.resolve(&id, &s.apis, &|h| h.installed());
        eprintln!("[kabul] {} ({}, APIs {:?})", r.note, s.name, s.apis);
        opts.endpoint = Some(kabul_core::local::prepare(s, m, None)?);
        match agente.as_deref() {
            Some(a) => {
                let k = HarnessKind::parse(a).ok_or_else(|| anyhow::anyhow!("agente desconhecido"))?;
                if !k.harness().endpoint_apis().iter().any(|x| s.apis.contains(x)) {
                    bail!("{} não fala nenhuma API de {} ({:?})", k.label(), s.name, s.apis);
                }
                eprintln!("[kabul] usando {} (--agente)", k.label());
                k
            }
            None => r.harness.ok_or_else(|| anyhow::anyhow!(r.note))?,
        }
    } else {
        HarnessKind::parse(agente.as_deref().unwrap_or("claude")).ok_or_else(|| anyhow::anyhow!("agente desconhecido"))?
    };
    if kind == HarnessKind::Claude {
        opts.permission_mode = Some("default".into());
    }
    let h = kind.harness();
    let run = harness::spawn(h.as_ref(), &opts)?;
    run.send(prompt)?;
    for ev in run.events.iter() {
        match &ev {
            Event::Log { .. } | Event::Raw { .. } => continue,
            Event::ApprovalRequest { request_id, tool, .. } => {
                println!("APROVACAO {tool} -> {}", if allow { "aprovar" } else { "negar" });
                run.approve(request_id, allow)?;
            }
            Event::TurnCompleted { .. } => {
                println!("{}", serde_json::to_string(&ev)?);
                break;
            }
            _ => println!("{}", serde_json::to_string(&ev)?),
        }
    }
    Ok(())
}

fn browser(acao: &str, url: Option<String>, workspace: Option<String>, home: Option<String>) -> Result<()> {
    use kabul_core::browser;
    let home = home.map(std::path::PathBuf::from).unwrap_or_else(browser::mcp::default_home);
    let ws = match workspace {
        Some(w) => w,
        None => {
            let cwd = std::env::current_dir()?;
            browser::mcp::workspace_from_cwd(&home, &cwd).ok_or_else(|| anyhow::anyhow!("esta pasta não é de um workspace do Kabul: use --workspace <id>"))?
        }
    };
    let a = serde_json::json!({ "workspaceId": ws, "url": url });
    let cmd = match acao {
        "status" | "open" | "stop" | "clear" | "install" => acao,
        o => bail!("ação desconhecida: {o} (use status, open, stop, clear ou install)"),
    };
    let v = browser::live::command(&home, cmd, &a)?;
    println!("{}", serde_json::to_string_pretty(&v)?);
    Ok(())
}

/// Estado do Kabul: `--home`, senão KABUL_HOME, senão o do app (mesma regra do app desktop).
fn open_store(home: Option<std::path::PathBuf>) -> Result<kabul_core::store::Store> {
    use kabul_core::store::Store;
    let (file, root) = match home.or_else(|| std::env::var_os("KABUL_HOME").map(std::path::PathBuf::from)) {
        Some(h) => (h.join("state.json"), h.join("workspaces")),
        None => Store::default_paths(),
    };
    let dir = file.parent().map(std::path::Path::to_path_buf).unwrap_or_default();
    let prefix = kabul_core::settings::AppSettings::load(&dir.join("app-settings.json")).branch_prefix();
    Store::open(file, root, prefix)
}

fn repo(acao: RepoCmd) -> Result<()> {
    match acao {
        RepoCmd::Add { caminhos, home } => {
            let mut st = open_store(home)?;
            let (mut added, mut had, mut skipped) = (0, 0, 0);
            for c in &caminhos {
                let p = std::path::absolute(c).unwrap_or_else(|_| c.clone());
                if !p.is_dir() {
                    println!("- {}: pasta não encontrada", c.display());
                    skipped += 1;
                    continue;
                }
                let before = st.state.repos.len();
                match st.add_repo(&p) {
                    Ok(r) if st.state.repos.len() > before => {
                        println!("+ {}  {}", r.name, r.path);
                        added += 1;
                    }
                    Ok(r) => {
                        println!("= {}  {} (já estava no Kabul)", r.name, r.path);
                        had += 1;
                    }
                    Err(e) => {
                        println!("- {}: {}", c.display(), e);
                        skipped += 1;
                    }
                }
            }
            println!("{added} adicionado(s), {had} já estava(m), {skipped} pulado(s).");
            Ok(())
        }
        RepoCmd::Ls { home, json } => {
            let st = open_store(home)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&st.state.repos)?);
                return Ok(());
            }
            if st.state.repos.is_empty() {
                println!("Nenhum repositório. Adicione com: kabul repo add <caminho>");
            }
            for r in &st.state.repos {
                println!("{:<24} {:<12} {}{}", r.name, r.default_branch, r.path, if r.hidden { " (oculto)" } else { "" });
            }
            Ok(())
        }
    }
}
