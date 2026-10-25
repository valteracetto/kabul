//! `kabuld`: o servidor do Kabul rodando sozinho (sem o app desktop).
use clap::Parser;
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "kabuld", about = "Servidor do Kabul: celular, outras máquinas e colaboração (localhost + Tailscale)")]
struct Args {
    /// Porta (padrão 7777 ou KABULD_PORT).
    #[arg(long)]
    port: Option<u16>,
    /// Pasta de estado do Kabul (padrão: a do app ou KABUL_HOME).
    #[arg(long)]
    home: Option<PathBuf>,
    /// Build da PWA (apps/web/dist). Padrão: KABULD_WEB ou ./apps/web/dist.
    #[arg(long)]
    web: Option<PathBuf>,
    /// Só localhost, mesmo com o Tailscale conectado.
    #[arg(long)]
    no_tailscale: bool,
    /// Onde guardar segredos: keyring (padrão), file ou memory.
    #[arg(long)]
    secrets: Option<String>,
    /// Gera um QR de pareamento ao subir e imprime o link.
    #[arg(long)]
    pair: bool,
}

fn main() -> anyhow::Result<()> {
    // `kabuld mcp browser --workspace <id>`: as conversas iniciadas pelo kabuld usam o próprio
    // executável como servidor MCP do navegador do Kabul.
    let argv: Vec<String> = std::env::args().skip(1).collect();
    if let Some(r) = kabul_core::browser::mcp::dispatch(&argv) {
        return r;
    }
    let a = Args::parse();
    if let Some(s) = &a.secrets {
        std::env::set_var("KABULD_SECRETS", s);
    }
    if let Some(h) = &a.home {
        std::env::set_var("KABUL_HOME", h);
    }
    let mut cfg = kabuld::Config::from_env();
    if let Some(p) = a.port {
        cfg.port = p;
    }
    if a.no_tailscale {
        cfg.tailscale = false;
    }
    cfg.web_dir = a.web.or(cfg.web_dir).or_else(|| Some(PathBuf::from("apps/web/dist")).filter(|p| p.join("index.html").is_file()));
    let srv = kabuld::start(cfg)?;
    for addr in &srv.addrs {
        eprintln!("kabuld escutando em http://{addr}");
    }
    let st = srv.hub.net.status(srv.port());
    if let Some(m) = st.message {
        eprintln!("kabuld: {m}");
    }
    eprintln!("kabuld: abra no celular {}/m/", srv.hub.base_url());
    if a.pair {
        let owner = kabuld::auth::Principal::local_owner("kabuld");
        let v = srv.hub.call(&owner, 0, "pair_create", &serde_json::json!({}))?;
        eprintln!("kabuld: link de pareamento (vale 5 min): {}", v["url"].as_str().unwrap_or_default());
    }
    // Espera Ctrl-C.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().expect("runtime");
        rt.block_on(async {
            let _ = tokio::signal::ctrl_c().await;
        });
        let _ = tx.send(());
    });
    let _ = rx.recv();
    eprintln!("kabuld: encerrando");
    srv.stop();
    Ok(())
}
