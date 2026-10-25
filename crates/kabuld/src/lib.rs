//! kabuld: servidor do Kabul. Fala o mesmo contrato do transporte Tauri por WebSocket, espelha ao
//! vivo todas as sessões tmux (qualquer agente), serve a PWA do celular, pareia aparelhos por QR,
//! manda Web Push e coordena a colaboração em tempo real (presença, papéis, fila única).
//!
//! Roda sozinho (`kabuld`) ou embutido no app desktop ([`start`] / [`Server::stop`]).
pub mod auth;
pub mod bus;
pub mod chat;
pub mod files;
pub mod hub;
pub mod machines;
pub mod net;
pub mod policy;
pub mod presence;
pub mod proxy;
pub mod push;
pub mod secrets;
pub mod server;
pub mod sessions;
pub mod terminal;

use anyhow::{Context, Result};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;

pub const DEFAULT_PORT: u16 = 7777;

pub struct Config {
    pub port: u16,
    /// Pasta de estado do Kabul (a mesma do app: `state.json`, `app-settings.json`...).
    pub home: PathBuf,
    /// Build da PWA (`apps/web/dist`).
    pub web_dir: Option<PathBuf>,
    /// Escutar também no IP da tailnet.
    pub tailscale: bool,
    pub secrets: Arc<dyn secrets::SecretStore>,
    pub monitor_ms: u64,
    /// Arquivos da PWA sem pasta no disco (o app desktop passa os assets embutidos).
    pub assets: Option<server::Assets>,
}

impl Config {
    /// Padrões: porta 7777, estado do app (ou `KABUL_HOME`), cofre do sistema (ou arquivo com
    /// `KABULD_SECRETS=file`), PWA em `KABULD_WEB`.
    pub fn from_env() -> Self {
        let home = std::env::var_os("KABUL_HOME").map(PathBuf::from).unwrap_or_else(|| kabul_core::store::Store::default_paths().0.parent().map(PathBuf::from).unwrap_or_default());
        let secrets: Arc<dyn secrets::SecretStore> = match std::env::var("KABULD_SECRETS").as_deref() {
            Ok("file") => Arc::new(secrets::FileStore::new(home.join("kabuld-secrets.json"))),
            Ok("memory") => Arc::new(secrets::MemStore::default()),
            _ => Arc::new(secrets::KeyringStore::new("kabuld")),
        };
        Self {
            port: std::env::var("KABULD_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(DEFAULT_PORT),
            web_dir: std::env::var_os("KABULD_WEB").map(PathBuf::from),
            tailscale: std::env::var("KABULD_NO_TAILSCALE").is_err(),
            monitor_ms: 1500,
            assets: None,
            home,
            secrets,
        }
    }
}

/// Servidor rodando numa thread própria (com runtime tokio próprio): serve para o app desktop.
pub struct Server {
    pub hub: Arc<hub::Hub>,
    pub addrs: Vec<SocketAddr>,
    shutdown: Option<tokio::sync::watch::Sender<bool>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Server {
    pub fn port(&self) -> u16 {
        self.hub.port
    }
    pub fn stop(mut self) {
        self.shutdown_now();
    }
    fn shutdown_now(&mut self) {
        self.hub.alive.store(false, Ordering::Relaxed);
        if let Some(s) = self.shutdown.take() {
            let _ = s.send(true);
        }
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.shutdown_now();
    }
}

/// Sobe o kabuld e só volta depois de abrir as portas (ou com o erro de bind).
pub fn start(cfg: Config) -> Result<Server> {
    let net: Arc<dyn net::NetTransport> = if cfg.tailscale { Arc::new(net::Tailscale::new()) } else { Arc::new(net::LocalOnly) };
    let hub = hub::Hub::new(cfg.home.clone(), cfg.port, net.clone(), cfg.secrets.clone())?;
    hub.spawn_monitor(std::time::Duration::from_millis(cfg.monitor_ms));
    let addrs = net::listen_addrs(net.as_ref(), cfg.port);
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<Vec<SocketAddr>>>();
    let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
    let srv = server::Srv::new(hub.clone());
    let web = cfg.web_dir.clone();
    let assets = cfg.assets.clone();
    let proxy_hub = Arc::downgrade(&hub);
    let thread = std::thread::Builder::new()
        .name("kabuld".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread().enable_all().worker_threads(4).build() {
                Ok(rt) => rt,
                Err(e) => {
                    let _ = ready_tx.send(Err(e.into()));
                    return;
                }
            };
            rt.block_on(async move {
                // Proxy do Run: listeners no mesmo runtime; credencial conferida no hub (sem ciclo).
                if let Some(h) = proxy_hub.upgrade() {
                    let w = proxy_hub.clone();
                    h.proxy.attach(tokio::runtime::Handle::current(), Arc::new(move |id: &str| w.upgrade().map(|h| h.auth.is_active(id)).unwrap_or(false)));
                }
                let mut bound = vec![];
                let mut listeners = vec![];
                for a in addrs {
                    match tokio::net::TcpListener::bind(a).await {
                        Ok(l) => {
                            bound.push(l.local_addr().unwrap_or(a));
                            listeners.push(l);
                        }
                        // O loopback é obrigatório; o IP da tailnet pode sumir (Tailscale desligou).
                        Err(e) if a.ip().is_loopback() => {
                            let _ = ready_tx.send(Err(anyhow::anyhow!("porta {} ocupada? {e}", a.port())));
                            return;
                        }
                        Err(e) => eprintln!("kabuld: não deu para escutar em {a}: {e}"),
                    }
                }
                let _ = ready_tx.send(Ok(bound));
                let app = server::router(srv, web, assets);
                let mut tasks = vec![];
                for l in listeners {
                    let app = app.clone();
                    let mut stop = stop_rx.clone();
                    tasks.push(tokio::spawn(async move {
                        let _ = axum::serve(l, app.into_make_service_with_connect_info::<SocketAddr>())
                            .with_graceful_shutdown(async move {
                                let _ = stop.wait_for(|v| *v).await;
                            })
                            .await;
                    }));
                }
                let mut stop = stop_rx.clone();
                let _ = stop.wait_for(|v| *v).await;
                // Conexões WebSocket abertas não seguram o desligamento.
                let _ = tokio::time::timeout(std::time::Duration::from_secs(2), futures_util::future::join_all(tasks)).await;
            });
        })
        .context("thread do kabuld")?;
    let addrs = ready_rx.recv().context("kabuld não iniciou")??;
    Ok(Server { hub, addrs, shutdown: Some(stop_tx), thread: Some(thread) })
}
