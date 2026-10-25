//! Navegador do Kabul: um Chromium por workspace, controlado pelo Chrome DevTools Protocol e
//! compartilhado entre o humano (aba Browser do app) e todos os agentes (MCP `kabul-browser`).
//!
//! - Usa o Chrome/Edge/Chromium/Brave instalado (ou o `chrome-headless-shell` baixado com
//!   consentimento, ver [`install`]), sempre em modo headless e com um perfil próprio por workspace
//!   (`<estado>/browser/<workspace>/profile`): nunca abre o perfil pessoal do usuário e os cookies de
//!   um workspace não chegam a outro.
//! - Descoberta entre processos: o Chromium grava `DevToolsActivePort` no perfil; quem chega depois
//!   (outro agente, o app) conecta no mesmo navegador. Um lock evita duas inicializações juntas.
//! - Estado compartilhado em arquivos ao lado do perfil: aba ativa, viewport, pausa ("assumir
//!   controle"), atividade dos agentes, log de ações e a fila de aprovações (ver [`policy`]).
pub mod cdp;
pub mod install;
pub mod live;
pub mod mcp;
pub mod page;
pub mod policy;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

pub use cdp::Cdp;

/// Pastas e arquivos do navegador de um workspace.
#[derive(Debug, Clone)]
pub struct Dirs {
    pub home: PathBuf,
    pub workspace: String,
    pub root: PathBuf,
}

/// Id de workspace seguro como nome de pasta.
fn clean_id(id: &str) -> String {
    let s: String = id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    if s.is_empty() {
        "_".into()
    } else {
        s
    }
}

impl Dirs {
    pub fn new(home: &Path, workspace: &str) -> Self {
        Self { home: home.to_path_buf(), workspace: workspace.to_string(), root: home.join("browser").join(clean_id(workspace)) }
    }
    pub fn profile(&self) -> PathBuf {
        self.root.join("profile")
    }
    pub fn file(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }
    pub fn approvals(&self) -> PathBuf {
        self.root.join("approvals")
    }
}

/// Executável escolhido e de onde veio.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Binary {
    pub path: String,
    /// chrome | edge | chromium | brave | headless-shell | custom
    pub kind: String,
    /// `chrome-headless-shell`: já é headless (não aceita `--headless=new`).
    pub shell: bool,
}

fn exists(p: &Path) -> bool {
    p.is_file()
}

/// Candidatos por sistema, na ordem de preferência.
pub fn candidates(os: &str, home: &Path, env: &dyn Fn(&str) -> Option<String>) -> Vec<(PathBuf, &'static str)> {
    let mut v: Vec<(PathBuf, &'static str)> = vec![];
    match os {
        "macos" => {
            for root in [PathBuf::from("/Applications"), home.join("Applications")] {
                v.push((root.join("Google Chrome.app/Contents/MacOS/Google Chrome"), "chrome"));
                v.push((root.join("Chromium.app/Contents/MacOS/Chromium"), "chromium"));
                v.push((root.join("Microsoft Edge.app/Contents/MacOS/Microsoft Edge"), "edge"));
                v.push((root.join("Brave Browser.app/Contents/MacOS/Brave Browser"), "brave"));
                v.push((root.join("Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"), "chrome"));
            }
        }
        "windows" => {
            let bases: Vec<PathBuf> = ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"].iter().filter_map(|k| env(k)).map(PathBuf::from).collect();
            for b in &bases {
                v.push((b.join("Google\\Chrome\\Application\\chrome.exe"), "chrome"));
            }
            for b in &bases {
                v.push((b.join("Microsoft\\Edge\\Application\\msedge.exe"), "edge"));
            }
            for b in &bases {
                v.push((b.join("Chromium\\Application\\chrome.exe"), "chromium"));
                v.push((b.join("BraveSoftware\\Brave-Browser\\Application\\brave.exe"), "brave"));
            }
        }
        _ => {
            for (n, k) in [("google-chrome", "chrome"), ("google-chrome-stable", "chrome"), ("chromium", "chromium"), ("chromium-browser", "chromium"), ("microsoft-edge", "edge"), ("brave-browser", "brave")] {
                for d in ["/usr/bin", "/usr/local/bin", "/snap/bin"] {
                    v.push((Path::new(d).join(n), k));
                }
            }
        }
    }
    v
}

/// Acha o navegador: `KABUL_BROWSER_BIN`, o caminho das Configurações, o baixado pelo Kabul e os
/// instalados no sistema.
pub fn find_binary(home: &Path) -> Option<Binary> {
    let mk = |p: PathBuf, kind: &str| {
        let s = p.display().to_string();
        let shell = s.contains("headless_shell") || s.contains("headless-shell");
        Binary { path: s, kind: if shell { "headless-shell".into() } else { kind.into() }, shell }
    };
    if let Some(p) = std::env::var_os("KABUL_BROWSER_BIN").map(PathBuf::from).filter(|p| exists(p)) {
        return Some(mk(p, "custom"));
    }
    let set = crate::settings::AppSettings::load(&home.join("app-settings.json"));
    if let Some(p) = set.browser_path.as_deref().filter(|p| !p.trim().is_empty()).map(|p| PathBuf::from(crate::paths::expand_tilde(p))).filter(|p| exists(p)) {
        return Some(mk(p, "custom"));
    }
    if let Some(p) = install::installed(home) {
        return Some(mk(p, "headless-shell"));
    }
    let env = |k: &str| std::env::var(k).ok();
    candidates(std::env::consts::OS, &crate::paths::home(), &env).into_iter().find(|(p, _)| exists(p)).map(|(p, k)| mk(p, k))
}

/// Argumentos do Chromium: headless, perfil próprio, porta do DevTools escolhida pelo sistema e sem
/// nada que toque no chaveiro ou no perfil do usuário.
pub fn launch_args(b: &Binary, profile: &Path, viewport: &Viewport) -> Vec<String> {
    let mut a = vec![
        format!("--user-data-dir={}", profile.display()),
        "--remote-debugging-port=0".into(),
        "--remote-debugging-address=127.0.0.1".into(),
        "--no-first-run".into(),
        "--no-default-browser-check".into(),
        "--disable-sync".into(),
        "--disable-extensions".into(),
        "--disable-component-update".into(),
        "--disable-default-apps".into(),
        "--disable-features=Translate,MediaRouter,OptimizationHints".into(),
        "--metrics-recording-only".into(),
        // Sem chaveiro do sistema (macOS pediria permissão; Linux abriria o gnome-keyring).
        "--use-mock-keychain".into(),
        "--password-store=basic".into(),
        "--hide-scrollbars".into(),
        // Abas fora de foco (a aba do humano ou de outro agente) continuam renderizando: sem isso o
        // Chrome sem janela adia quadros e o print/screencast pode ficar sem resposta.
        "--disable-background-timer-throttling".into(),
        "--disable-backgrounding-occluded-windows".into(),
        "--disable-renderer-backgrounding".into(),
        "--mute-audio".into(),
        format!("--window-size={},{}", viewport.width, viewport.height),
    ];
    if !b.shell {
        a.insert(0, "--headless=new".into());
    }
    a.push("about:blank".into());
    a
}

/// Tamanho da página que o humano e os agentes veem (vale para todos: fica em `viewport.json`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Viewport {
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub mobile: bool,
    #[serde(default = "one")]
    pub scale: f64,
}

fn one() -> f64 {
    1.0
}

impl Default for Viewport {
    fn default() -> Self {
        Self { width: 1280, height: 800, mobile: false, scale: 1.0 }
    }
}

impl Viewport {
    /// `desktop` (1280×800), `laptop` (1440×900), `tablet` (820×1180) ou `mobile` (390×844).
    pub fn preset(name: &str) -> Option<Self> {
        Some(match name {
            "desktop" => Self::default(),
            "laptop" => Self { width: 1440, height: 900, ..Self::default() },
            "tablet" => Self { width: 820, height: 1180, mobile: true, scale: 2.0 },
            "mobile" | "phone" | "celular" => Self { width: 390, height: 844, mobile: true, scale: 3.0 },
            _ => return None,
        })
    }
}

/// Navegador rodando: porta do DevTools e URL do WebSocket do navegador.
#[derive(Debug, Clone, Serialize)]
pub struct Endpoint {
    pub port: u16,
    pub ws: String,
}

fn read_active_port(profile: &Path) -> Option<(u16, String)> {
    let t = std::fs::read_to_string(profile.join("DevToolsActivePort")).ok()?;
    let mut l = t.lines();
    let port = l.next()?.trim().parse().ok()?;
    let path = l.next()?.trim().to_string();
    Some((port, path))
}

/// Navegador já aberto para este workspace (responde no DevTools)?
pub fn running(d: &Dirs) -> Option<Endpoint> {
    let (port, path) = read_active_port(&d.profile())?;
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(300)).ok()?;
    Some(Endpoint { port, ws: format!("ws://127.0.0.1:{port}{path}") })
}

/// Garante o navegador do workspace (abre se preciso) e devolve o endpoint.
pub fn ensure(d: &Dirs) -> Result<Endpoint> {
    if let Some(e) = running(d) {
        return Ok(e);
    }
    std::fs::create_dir_all(d.profile())?;
    let lock = d.file("launch.lock");
    // Outro processo pode estar abrindo: espera ele (lock com prazo de 20 s).
    let t0 = std::time::Instant::now();
    let got = loop {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&lock) {
            Ok(_) => break true,
            Err(_) => {
                if let Some(e) = running(d) {
                    return Ok(e);
                }
                let stale = std::fs::metadata(&lock).and_then(|m| m.modified()).ok().and_then(|m| m.elapsed().ok()).is_some_and(|e| e > Duration::from_secs(20));
                if stale {
                    let _ = std::fs::remove_file(&lock);
                    continue;
                }
                if t0.elapsed() > Duration::from_secs(25) {
                    break false;
                }
                std::thread::sleep(Duration::from_millis(150));
            }
        }
    };
    let r = if got { launch(d) } else { running(d).context("outro processo está abrindo o navegador e não terminou") };
    if got {
        let _ = std::fs::remove_file(&lock);
    }
    r
}

fn launch(d: &Dirs) -> Result<Endpoint> {
    let Some(b) = find_binary(&d.home) else { bail!("Nenhum Chrome, Edge ou Chromium encontrado. Instale um deles ou baixe o navegador do Kabul em Configurações › Navegador (kabul browser install).") };
    let _ = std::fs::remove_file(d.profile().join("DevToolsActivePort"));
    let vp = viewport(d);
    let mut c = std::process::Command::new(&b.path);
    c.args(launch_args(&b, &d.profile(), &vp)).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null());
    let errf = std::fs::File::create(d.file("chromium.log")).ok();
    match errf {
        Some(f) => c.stderr(f),
        None => c.stderr(std::process::Stdio::null()),
    };
    // Processo próprio: continua vivo quando o agente que o abriu termina (o próximo reaproveita).
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        c.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS
        c.creation_flags(0x0800_0000 | 0x0000_0200 | 0x0000_0008);
    }
    let mut child = c.spawn().with_context(|| format!("iniciando {}", b.path))?;
    std::fs::write(d.file("pid"), child.id().to_string()).ok();
    let t0 = std::time::Instant::now();
    loop {
        if let Some(e) = running(d) {
            std::fs::write(d.file("binary.json"), serde_json::to_vec(&b)?).ok();
            // Não espera o filho: ele segue sozinho (o SO recolhe quando sair).
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            return Ok(e);
        }
        if let Ok(Some(st)) = child.try_wait() {
            let log = std::fs::read_to_string(d.file("chromium.log")).unwrap_or_default();
            let tail: Vec<&str> = log.lines().rev().take(6).collect();
            bail!("o navegador saiu ao iniciar ({st}): {}", tail.into_iter().rev().collect::<Vec<_>>().join(" | "));
        }
        if t0.elapsed() > Duration::from_secs(20) {
            let _ = child.kill();
            bail!("o navegador não abriu o DevTools em 20 s");
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Fecha o navegador do workspace (pelo próprio DevTools: `Browser.close`).
pub fn stop(d: &Dirs) -> Result<bool> {
    let Some(e) = running(d) else { return Ok(false) };
    let c = Cdp::connect(&e.ws)?;
    let _ = c.call_timeout(None, "Browser.close", json!({}), Duration::from_secs(5));
    let t0 = std::time::Instant::now();
    while running(d).is_some() && t0.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(100));
    }
    live::forget(&d.workspace);
    Ok(true)
}

/// Apaga cookies, sessões e cache do workspace (fecha o navegador antes).
pub fn clear(d: &Dirs) -> Result<()> {
    stop(d)?;
    if d.profile().exists() {
        std::fs::remove_dir_all(d.profile()).context("apagando o perfil do navegador")?;
    }
    for f in ["active.json", "activity.json", "actions.jsonl"] {
        let _ = std::fs::remove_file(d.file(f));
    }
    Ok(())
}

// ---------- estado compartilhado (arquivos pequenos ao lado do perfil) ----------

fn read<T: serde::de::DeserializeOwned>(p: &Path) -> Option<T> {
    std::fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

/// Grava de forma atômica (arquivo temporário + rename): leitores de outros processos nunca veem
/// metade do JSON.
pub(crate) fn write_atomic(p: &Path, data: &[u8]) -> Result<()> {
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = p.with_extension(format!("tmp{}", std::process::id()));
    std::fs::write(&tmp, data)?;
    std::fs::rename(&tmp, p).or_else(|_| {
        let _ = std::fs::remove_file(p);
        std::fs::rename(&tmp, p)
    })?;
    Ok(())
}

pub fn viewport(d: &Dirs) -> Viewport {
    read(&d.file("viewport.json")).unwrap_or_default()
}

pub fn set_viewport(d: &Dirs, v: &Viewport) -> Result<()> {
    write_atomic(&d.file("viewport.json"), &serde_json::to_vec(v)?)
}

/// Aba ativa (a que o humano vê e os agentes usam).
pub fn active_target(d: &Dirs) -> Option<String> {
    read::<Value>(&d.file("active.json")).and_then(|v| v.get("target").and_then(Value::as_str).map(String::from))
}

pub fn set_active_target(d: &Dirs, id: &str) -> Result<()> {
    write_atomic(&d.file("active.json"), json!({ "target": id }).to_string().as_bytes())
}

/// Pausa: o humano assumiu o controle; agentes só leem.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Control {
    pub paused: bool,
    #[serde(default)]
    pub at: u64,
}

pub fn control(d: &Dirs) -> Control {
    read(&d.file("control.json")).unwrap_or_default()
}

pub fn set_paused(d: &Dirs, paused: bool) -> Result<()> {
    write_atomic(&d.file("control.json"), &serde_json::to_vec(&Control { paused, at: crate::store::now() })?)
}

/// Uma ação de agente no navegador (log da sessão e indicador "agente controlando").
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Action {
    /// Milissegundos desde 1970.
    pub at: u64,
    pub agent: String,
    pub tool: String,
    pub detail: String,
    #[serde(default)]
    pub ok: bool,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Registra a ação (arquivo JSONL com teto de tamanho) e atualiza a atividade.
pub fn log_action(d: &Dirs, a: &Action) {
    let f = d.file("actions.jsonl");
    let _ = std::fs::create_dir_all(&d.root);
    if std::fs::metadata(&f).map(|m| m.len() > 256 * 1024).unwrap_or(false) {
        // Mantém a metade mais nova.
        if let Ok(t) = std::fs::read_to_string(&f) {
            let lines: Vec<&str> = t.lines().collect();
            let keep = lines[lines.len() / 2..].join("\n") + "\n";
            let _ = write_atomic(&f, keep.as_bytes());
        }
    }
    let line = serde_json::to_string(a).unwrap_or_default() + "\n";
    let _ = std::fs::OpenOptions::new().create(true).append(true).open(&f).and_then(|mut h| std::io::Write::write_all(&mut h, line.as_bytes()));
    let _ = write_atomic(&d.file("activity.json"), &serde_json::to_vec(a).unwrap_or_default());
}

/// Últimas `n` ações.
pub fn actions(d: &Dirs, n: usize) -> Vec<Action> {
    let t = std::fs::read_to_string(d.file("actions.jsonl")).unwrap_or_default();
    let mut v: Vec<Action> = t.lines().rev().take(n).filter_map(|l| serde_json::from_str(l).ok()).collect();
    v.reverse();
    v
}

pub fn activity(d: &Dirs) -> Option<Action> {
    read(&d.file("activity.json"))
}

/// Aba do navegador (resumo).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TabInfo {
    pub id: String,
    pub url: String,
    pub title: String,
    pub active: bool,
}

/// O que a aba Browser mostra.
#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub running: bool,
    pub binary: Option<Binary>,
    pub profile: String,
    pub tabs: Vec<TabInfo>,
    pub url: Option<String>,
    pub title: Option<String>,
    pub viewport: Viewport,
    pub paused: bool,
    /// Último agente que agiu (com `at` em ms); a interface mostra "controlando" se for recente.
    pub agent: Option<Action>,
    pub actions: Vec<Action>,
    pub approvals: Vec<policy::Request>,
    pub policy: String,
}

/// Abas abertas (só páginas).
pub fn tabs(c: &Cdp, d: &Dirs) -> Result<Vec<TabInfo>> {
    let v = c.call(None, "Target.getTargets", json!({}))?;
    let active = active_target(d);
    let pages: Vec<&Value> = v["targetInfos"].as_array().map(|a| a.iter().filter(|t| t["type"] == "page").collect()).unwrap_or_default();
    let has_active = pages.iter().any(|t| Some(t["targetId"].as_str().unwrap_or("")) == active.as_deref());
    Ok(pages
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let id = t["targetId"].as_str().unwrap_or("").to_string();
            TabInfo { active: if has_active { Some(id.as_str()) == active.as_deref() } else { i == 0 }, id, url: t["url"].as_str().unwrap_or("").into(), title: t["title"].as_str().unwrap_or("").into() }
        })
        .collect())
}

pub fn status(d: &Dirs) -> Status {
    let set = crate::settings::AppSettings::load(&d.home.join("app-settings.json"));
    let ep = running(d);
    let tabs = ep.as_ref().and_then(|e| live::cdp_for(&d.workspace, e).ok()).and_then(|c| tabs(&c, d).ok()).unwrap_or_default();
    let cur = tabs.iter().find(|t| t.active);
    Status {
        running: ep.is_some(),
        binary: read(&d.file("binary.json")).filter(|_: &Binary| ep.is_some()).or_else(|| find_binary(&d.home)),
        profile: d.profile().display().to_string(),
        url: cur.map(|t| t.url.clone()),
        title: cur.map(|t| t.title.clone()),
        tabs: tabs.clone(),
        viewport: viewport(d),
        paused: control(d).paused,
        agent: activity(d),
        actions: actions(d, 30),
        approvals: policy::pending(d),
        policy: set.browser_policy.clone(),
    }
}

/// A extensão Claude in Chrome está registrada (host nativo do Claude Code no Chrome)? Só olha o
/// nome do arquivo de registro; não lê nada do perfil do usuário.
pub fn claude_chrome_available() -> bool {
    const HOST: &str = "com.anthropic.claude_code_browser_extension";
    let h = crate::paths::home();
    let dirs: Vec<PathBuf> = match std::env::consts::OS {
        "macos" => vec![h.join("Library/Application Support/Google/Chrome/NativeMessagingHosts"), h.join("Library/Application Support/Microsoft Edge/NativeMessagingHosts")],
        "windows" => {
            // Registro: HKCU\Software\Google\Chrome\NativeMessagingHosts\<host>.
            return ["Google\\Chrome", "Microsoft\\Edge"].iter().any(|b| crate::shell::command("reg").args(["query", &format!("HKCU\\Software\\{b}\\NativeMessagingHosts\\{HOST}")]).output().map(|o| o.status.success()).unwrap_or(false));
        }
        _ => vec![h.join(".config/google-chrome/NativeMessagingHosts"), h.join(".config/chromium/NativeMessagingHosts")],
    };
    dirs.iter().any(|d| d.join(format!("{HOST}.json")).is_file())
}

/// Conexão nova com o navegador do workspace (abre se preciso).
pub fn connect(d: &Dirs) -> Result<Arc<Cdp>> {
    let e = ensure(d)?;
    Cdp::connect(&e.ws)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidatos_por_sistema() {
        let env = |k: &str| match k {
            "PROGRAMFILES" => Some("C:\\Program Files".to_string()),
            "LOCALAPPDATA" => Some("C:\\Users\\v\\AppData\\Local".to_string()),
            _ => None,
        };
        let w = candidates("windows", Path::new("C:\\Users\\v"), &env);
        assert!(w[0].0.display().to_string().ends_with("Google\\Chrome\\Application\\chrome.exe"));
        assert!(w.iter().any(|(p, k)| *k == "edge" && p.display().to_string().contains("msedge.exe")));
        let m = candidates("macos", Path::new("/Users/v"), &|_| None);
        assert_eq!(m[0].0, PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
        assert!(candidates("linux", Path::new("/home/v"), &|_| None).iter().any(|(p, _)| p == Path::new("/usr/bin/chromium")));
    }

    #[test]
    fn argumentos_isolam_o_perfil() {
        let b = Binary { path: "chrome".into(), kind: "chrome".into(), shell: false };
        let a = launch_args(&b, Path::new("/tmp/k/profile"), &Viewport::default());
        assert!(a.contains(&"--user-data-dir=/tmp/k/profile".to_string()) && a.contains(&"--headless=new".to_string()) && a.contains(&"--remote-debugging-port=0".to_string()));
        assert!(a.contains(&"--use-mock-keychain".to_string()) && a.contains(&"--window-size=1280,800".to_string()));
        let s = Binary { shell: true, ..b };
        assert!(!launch_args(&s, Path::new("/p"), &Viewport::default()).iter().any(|x| x.starts_with("--headless")));
        // Pasta por workspace, sem caracteres perigosos.
        let d = Dirs::new(Path::new("/h"), "../x y");
        assert_eq!(d.profile(), PathBuf::from("/h/browser/___x_y/profile"));
        assert_eq!(Viewport::preset("mobile").unwrap().width, 390);
    }

    #[test]
    fn estado_compartilhado_em_arquivos() {
        let h = std::env::temp_dir().join(format!("kabul-browser-st-{}", std::process::id()));
        let d = Dirs::new(&h, "w1");
        assert!(!control(&d).paused);
        set_paused(&d, true).unwrap();
        assert!(control(&d).paused);
        set_active_target(&d, "T1").unwrap();
        assert_eq!(active_target(&d).as_deref(), Some("T1"));
        for i in 0..5 {
            log_action(&d, &Action { at: i, agent: "claude".into(), tool: "click".into(), detail: format!("e{i}"), ok: true });
        }
        let a = actions(&d, 3);
        assert_eq!(a.iter().map(|x| x.at).collect::<Vec<_>>(), vec![2, 3, 4]);
        assert_eq!(activity(&d).unwrap().detail, "e4");
        std::fs::remove_dir_all(&h).ok();
    }
}
