use anyhow::{bail, Result};

mod serve;
use clap::{Parser, Subcommand};
use kabul_core::harness::{HarnessKind, SessionOptions};
use kabul_core::{agent, auth, conductor_db::ConductorDb, tmux, worktree};

#[derive(Parser)]
#[command(name = "kabul", about = "Sessões de agentes (Claude, Codex, Antigravity) no tmux")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Lista sessões tmux (com o agente detectado) e sessões do Conductor.
    Ls {
        /// Não lê o conductor.db.
        #[arg(long)]
        sem_conductor: bool,
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
    /// Um turno de chat estruturado (mesmo caminho do app). `--local <id>` usa um modelo local.
    Chat {
        prompt: String,
        #[arg(long, default_value = "claude")]
        agente: String,
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
}

fn main() -> Result<()> {
    match Cli::parse().cmd {
        Cmd::Ls { sem_conductor } => ls(!sem_conductor),
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
        Cmd::Serve { port, home } => serve::serve(port, home.into()),
        Cmd::Chat { prompt, agente, model, local, cwd, aprovar } => chat(&prompt, &agente, model, local, cwd, aprovar == "allow"),
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

fn ls(conductor: bool) -> Result<()> {
    let panes = tmux::list_panes()?;
    println!("== tmux ({} panes)", panes.len());
    for p in &panes {
        let a = agent::detect_pane(&p.command, p.pid);
        println!("{:<6} {:<12} {}:{}.{}  {:<10} {}", p.pane_id, a.label(), p.session, p.window_index, p.pane_index, p.command, p.path);
    }
    if conductor {
        match ConductorDb::open_default() {
            Ok(db) => {
                let ws = db.workspaces()?;
                let ss = db.sessions()?;
                println!("\n== conductor ({} workspaces, {} sessões)", ws.len(), ss.len());
                for w in &ws {
                    println!("{} / {} [{}]", w.repo_name.as_deref().unwrap_or("?"), w.directory_name.as_deref().unwrap_or("?"), w.branch.as_deref().unwrap_or("-"));
                    for s in ss.iter().filter(|s| s.workspace_id.as_deref() == Some(&w.id)).take(5) {
                        println!("    {:<8} {:<8} {}", s.agent_type.as_deref().unwrap_or("claude"), s.status.as_deref().unwrap_or("-"), s.title.as_deref().unwrap_or(""));
                    }
                }
            }
            Err(e) => println!("\n== conductor indisponível: {e}"),
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
        Some(kind.harness().interactive_command(&opts).shell_line())
    };
    let nome = nome.unwrap_or_else(|| (1..).map(|n| format!("kabul-{agente}-{n}")).find(|n| !tmux::has_session(n)).unwrap());
    tmux::new_session(&nome, Some(&cwd), command.as_deref())?;
    println!("sessão tmux '{nome}' criada em {cwd}\nanexar: tmux attach -t {nome}");
    Ok(())
}

fn chat(prompt: &str, agente: &str, model: Option<String>, local: Option<String>, cwd: Option<String>, allow: bool) -> Result<()> {
    use kabul_core::harness::{self, Event};
    let mut opts = SessionOptions { cwd: cwd.or_else(|| std::env::current_dir().ok().map(|d| d.display().to_string())), model, approvals_via_app: true, ..Default::default() };
    let kind = if let Some(id) = local {
        let src = kabul_core::local::discover(&[]);
        let s = src.iter().find(|s| s.models.iter().any(|m| m.id == id)).ok_or_else(|| anyhow::anyhow!("modelo local {id} não encontrado"))?;
        let m = s.models.iter().find(|m| m.id == id).unwrap();
        let reg = kabul_core::registry::Registry::parse(kabul_core::registry::DEFAULT)?;
        let r = reg.resolve(&id, &s.apis, &|h| h.installed());
        eprintln!("[kabul] {} ({})", r.note, s.name);
        opts.endpoint = Some(kabul_core::local::prepare(s, m, None)?);
        r.harness.ok_or_else(|| anyhow::anyhow!(r.note))?
    } else {
        HarnessKind::parse(agente).ok_or_else(|| anyhow::anyhow!("agente desconhecido"))?
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
