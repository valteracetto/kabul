//! Navegador do Kabul de ponta a ponta: o servidor MCP `kabul mcp browser` (o binário de verdade)
//! dirigindo um Chromium headless real numa página servida pelo próprio teste.
//!
//! Navegador: `KABUL_BROWSER_BIN` ou o Chrome/Chromium/Edge instalado (CI: o Chrome do runner). Sem
//! nenhum, os testes com navegador são pulados (o protocolo é coberto pelos testes do kabul-core).
//!
//! Agente real (LLM falso, sem modelo): `KABUL_TESTE_BROWSER_AGENTE=claude cargo test -p kabul-cli
//! --test navegador agente_real -- --ignored --nocapture` (claude, codex, gemini, qwen, opencode, goose).
use kabul_core::browser::{self, policy, Dirs};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const PAGE: &str = r#"<!doctype html><html><head><title>Teste Kabul</title></head><body>
<h1>Olá navegador</h1>
<label>Nome <input id="nome"></label>
<button id="b" onclick="fetch('/clicado?nome='+encodeURIComponent(document.getElementById('nome').value));document.getElementById('out').textContent='clicado:'+document.getElementById('nome').value;console.log('clique!')">Enviar</button>
<select id="s" aria-label="Letra"><option value="a">Alpha</option><option value="b">Beta</option></select>
<p id="out"></p>
<a href="/dois">Página dois</a>
<a href="http://kabul-fora.invalid/x">Site de fora</a>
<a href="/vai-fora">Redireciona</a>
<a href="http://kabul-fora.invalid/aba" target="_blank">Abre aba</a>
</body></html>"#;

/// Servidor HTTP mínimo: `/` (a página), `/dois` e `/clicado` (registra o pedido).
fn serve() -> (u16, Arc<Mutex<Vec<String>>>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    let hits: Arc<Mutex<Vec<String>>> = Default::default();
    let h2 = hits.clone();
    std::thread::spawn(move || {
        for s in l.incoming().flatten() {
            let h3 = h2.clone();
            std::thread::spawn(move || {
                let mut s = s;
                let mut buf = [0u8; 4096];
                let n = s.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                h3.lock().unwrap().push(path.clone());
                if path == "/vai-fora" {
                    let _ = write!(s, "HTTP/1.1 302 Found\r\nlocation: http://kabul-fora.invalid/r\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
                    return;
                }
                let body = if path == "/" {
                    PAGE.to_string()
                } else if path == "/dois" {
                    "<!doctype html><title>Dois</title><p>segunda página</p>".to_string()
                } else {
                    "ok".to_string()
                };
                let _ = write!(s, "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
            });
        }
    });
    (port, hits)
}

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("kabul-nav-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d.canonicalize().unwrap()
}

/// Navegador disponível? (respeita `KABUL_BROWSER_BIN`).
/// Um Chrome real por vez: em runners de CI com pouca CPU, vários ao mesmo tempo atrasam prints e screencast.
static CHROME: Mutex<()> = Mutex::new(());

fn chrome_lock() -> std::sync::MutexGuard<'static, ()> {
    CHROME.lock().unwrap_or_else(|e| e.into_inner())
}

fn have_browser(home: &Path) -> bool {
    let ok = browser::find_binary(home).is_some();
    if !ok {
        eprintln!("sem Chrome/Chromium/Edge: teste do navegador pulado");
    }
    ok
}

struct Mcp {
    child: Child,
    stdin: ChildStdin,
    out: Receiver<String>,
    id: u64,
}

impl Mcp {
    fn start(home: &Path, ws: &str) -> Mcp {
        let mut child = Command::new(env!("CARGO_BIN_EXE_kabul"))
            .args(["mcp", "browser", "--workspace", ws, "--home"])
            .arg(home)
            .args(["--agent", "teste", "--approval-timeout", "20"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for l in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = tx.send(l);
            }
        });
        Mcp { child, stdin, out: rx, id: 0 }
    }
    fn rpc(&mut self, method: &str, params: Value) -> Value {
        self.id += 1;
        writeln!(self.stdin, "{}", json!({ "jsonrpc": "2.0", "id": self.id, "method": method, "params": params })).unwrap();
        self.stdin.flush().unwrap();
        loop {
            let l = self.out.recv_timeout(Duration::from_secs(60)).expect("sem resposta do MCP");
            let v: Value = serde_json::from_str(&l).unwrap();
            if v["id"] == self.id {
                return v;
            }
        }
    }
    fn call(&mut self, name: &str, args: Value) -> (String, bool, Value) {
        let r = self.rpc("tools/call", json!({ "name": name, "arguments": args }));
        let res = r["result"].clone();
        let text = res["content"].as_array().map(|a| a.iter().filter_map(|c| c["text"].as_str()).collect::<Vec<_>>().join("\n")).unwrap_or_default();
        eprintln!("{name} → {}", text.chars().take(300).collect::<String>());
        (text, res["isError"].as_bool().unwrap_or(false), res)
    }
}

impl Drop for Mcp {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Ref do elemento `role "nome"` no snapshot.
fn ref_of(snap: &str, role: &str, name: &str) -> String {
    let pat = format!("{role} \"{name}\"");
    let line = snap.lines().find(|l| l.contains(&pat)).unwrap_or_else(|| panic!("{pat} não está no snapshot:\n{snap}"));
    line.split("[ref=").nth(1).unwrap().split(']').next().unwrap().to_string()
}

/// Responde a próxima aprovação pendente do workspace.
fn answer_next(d: &Dirs, allow: bool) -> std::thread::JoinHandle<policy::Request> {
    let d = d.clone();
    std::thread::spawn(move || {
        let t0 = std::time::Instant::now();
        loop {
            if let Some(r) = policy::pending(&d).pop() {
                policy::decide(&d, &r.id, policy::Decision { allow, always: false }).unwrap();
                return r;
            }
            assert!(t0.elapsed() < Duration::from_secs(20), "nenhuma aprovação pedida");
            std::thread::sleep(Duration::from_millis(50));
        }
    })
}

#[test]
fn mcp_com_chromium_real() {
    let _chrome = chrome_lock();
    let home = tmp("mcp");
    if !have_browser(&home) {
        return;
    }
    let (port, hits) = serve();
    let base = format!("http://127.0.0.1:{port}");
    let d = Dirs::new(&home, "ws-teste");
    let mut m = Mcp::start(&home, "ws-teste");
    let init = m.rpc("initialize", json!({ "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "teste" } }));
    assert_eq!(init["result"]["serverInfo"]["name"], "kabul-browser");
    let tools = m.rpc("tools/list", json!({}));
    assert!(tools["result"]["tools"].as_array().unwrap().len() >= 15);

    // Navegar (localhost passa sem pedir) e ler a página.
    let (t, err, _) = m.call("browser_navigate", json!({ "url": format!("{base}/") }));
    assert!(!err && t.contains("Teste Kabul"), "{t}");
    let (snap, err, _) = m.call("browser_snapshot", json!({}));
    assert!(!err && snap.contains("heading \"Olá navegador\""), "{snap}");
    let campo = ref_of(&snap, "textbox", "Nome");
    let botao = ref_of(&snap, "button", "Enviar");
    // Perfil isolado do workspace, nunca o do usuário.
    assert!(d.profile().join("DevToolsActivePort").exists());

    // Digitar, clicar, esperar o efeito.
    let (t, err, _) = m.call("browser_type", json!({ "ref": campo, "text": "Val" }));
    assert!(!err, "{t}");
    let (t, err, _) = m.call("browser_click", json!({ "ref": botao }));
    assert!(!err && t.contains("Enviar"), "{t}");
    let (t, err, _) = m.call("browser_wait_for", json!({ "text": "clicado:Val", "timeout_ms": 5000 }));
    assert!(!err, "{t}");
    let t0 = std::time::Instant::now();
    while !hits.lock().unwrap().iter().any(|h| h == "/clicado?nome=Val") && t0.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(hits.lock().unwrap().iter().any(|h| h == "/clicado?nome=Val"), "{:?}", hits.lock().unwrap());
    // Seletor CSS também vale.
    let (t, err, _) = m.call("browser_select", json!({ "ref": "#s", "values": ["Beta"] }));
    assert!(!err && t.contains("Beta"), "{t}");
    let (t, _, _) = m.call("browser_console", json!({}));
    assert!(t.contains("clique!"), "{t}");
    let (t, _, _) = m.call("browser_network", json!({ "filter": "/clicado" }));
    assert!(t.contains("GET") && t.contains("/clicado?nome=Val") && t.contains("200"), "{t}");
    let (t, _, _) = m.call("browser_press", json!({ "key": "Tab", "ref": campo }));
    assert!(t.contains("Tab"), "{t}");
    let (t, err, _) = m.call("browser_hover", json!({ "ref": botao }));
    assert!(!err, "{t}");
    let (t, err, _) = m.call("browser_scroll", json!({ "dy": 200 }));
    assert!(!err, "{t}");

    // Captura em JPEG.
    let (_, err, res) = m.call("browser_screenshot", json!({}));
    let img = &res["content"][0];
    assert!(!err && img["type"] == "image" && img["mimeType"] == "image/jpeg" && img["data"].as_str().unwrap().starts_with("/9j/"), "{res}");

    // evaluate pede aprovação (política padrão: localhost) — negado e depois permitido.
    let h = answer_next(&d, false);
    let (t, err, _) = m.call("browser_evaluate", json!({ "expression": "1+1" }));
    assert!(err && t.contains("não aprovou"), "{t}");
    assert_eq!(h.join().unwrap().kind, "evaluate");
    let h = answer_next(&d, true);
    let (t, err, _) = m.call("browser_evaluate", json!({ "expression": "document.getElementById('out').textContent" }));
    assert!(!err && t == "clicado:Val", "{t}");
    h.join().unwrap();

    // Site de fora pede aprovação; negado não sai do lugar.
    let h = answer_next(&d, false);
    let (t, err, _) = m.call("browser_navigate", json!({ "url": "https://example.org/" }));
    assert!(err, "{t}");
    assert_eq!(h.join().unwrap().detail, "https://example.org/");

    // Link clicado na página (não só a navegação direta) também passa pela política: negado, a
    // navegação é barrada e a página fica onde estava.
    let (snap, _, _) = m.call("browser_snapshot", json!({}));
    let h = answer_next(&d, false);
    let (t, err, _) = m.call("browser_click", json!({ "ref": ref_of(&snap, "link", "Site de fora") }));
    assert!(err && t.contains("kabul-fora.invalid/x") && t.contains("não aprovou"), "{t}");
    let req = h.join().unwrap();
    assert_eq!((req.kind.as_str(), req.detail.as_str(), req.agent.as_str()), ("navigate", "http://kabul-fora.invalid/x", "teste"));
    let here = || browser::status(&d).url.unwrap_or_default();
    assert_eq!(here(), format!("{base}/"));
    // Link local que redireciona (302) para fora: o destino do redirecionamento também pede.
    let h = answer_next(&d, false);
    let (t, err, _) = m.call("browser_click", json!({ "ref": ref_of(&snap, "link", "Redireciona") }));
    assert!(err && t.contains("kabul-fora.invalid/r"), "{t}");
    assert_eq!(h.join().unwrap().detail, "http://kabul-fora.invalid/r");
    assert_eq!(here(), format!("{base}/"));
    // Link que abre outra aba (target=_blank): a aba nova nasce pausada, pede e, negada, é fechada.
    let h = answer_next(&d, false);
    let (t, err, _) = m.call("browser_click", json!({ "ref": ref_of(&snap, "link", "Abre aba") }));
    assert!(err && t.contains("kabul-fora.invalid/aba"), "{t}");
    assert_eq!(h.join().unwrap().detail, "http://kabul-fora.invalid/aba");
    let t0 = std::time::Instant::now();
    while browser::status(&d).tabs.len() > 1 && t0.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(100));
    }
    assert_eq!(browser::status(&d).tabs.len(), 1, "{:?}", browser::status(&d).tabs);
    assert_eq!(here(), format!("{base}/"));
    assert!(policy::pending(&d).is_empty());

    // Link para outra página, voltar e avançar.
    let (snap, _, _) = m.call("browser_snapshot", json!({}));
    let link = ref_of(&snap, "link", "Página dois");
    let (t, err, _) = m.call("browser_click", json!({ "ref": link }));
    assert!(!err && t.contains("/dois"), "{t}");
    let (t, err, _) = m.call("browser_navigate", json!({ "go": "back" }));
    assert!(!err && t.contains("Teste Kabul"), "{t}");
    let (t, err, _) = m.call("browser_navigate", json!({ "go": "forward" }));
    assert!(!err && t.contains("/dois"), "{t}");

    // Celular: viewport compartilhado (vale para o humano e para os outros agentes).
    let (t, err, _) = m.call("browser_resize", json!({ "preset": "mobile" }));
    assert!(!err && t.contains("390"), "{t}");
    assert!(browser::viewport(&d).mobile);
    std::fs::write(home.join("app-settings.json"), r#"{"browser_policy":"all"}"#).unwrap();
    let (t, _, _) = m.call("browser_evaluate", json!({ "expression": "[screen.width, navigator.maxTouchPoints > 0]" }));
    assert_eq!(t, "[390,true]");

    // Abas: nova, lista, troca, fecha.
    let (t, err, _) = m.call("browser_tabs", json!({ "action": "new", "url": format!("{base}/") }));
    assert!(!err && t.lines().count() == 2, "{t}");
    let first = t.lines().find(|l| !l.starts_with('*')).unwrap().split_whitespace().next().unwrap().to_string();
    let (t, _, _) = m.call("browser_tabs", json!({ "action": "close" }));
    assert_eq!(t.lines().count(), 1, "{t}");
    let (t, _, _) = m.call("browser_tabs", json!({ "action": "select", "id": first }));
    assert!(t.starts_with('*'), "{t}");

    // Humano assumiu o controle: ações bloqueadas, leitura continua.
    browser::set_paused(&d, true).unwrap();
    let (t, err, _) = m.call("browser_navigate", json!({ "url": format!("{base}/") }));
    assert!(err && t.contains("assumiu o controle"), "{t}");
    let (_, err, _) = m.call("browser_snapshot", json!({}));
    assert!(!err);
    browser::set_paused(&d, false).unwrap();

    // Log da sessão com as ações (e quem fez).
    let acts = browser::actions(&d, 100);
    assert!(acts.iter().any(|a| a.tool == "click" && a.agent == "teste" && a.ok));
    assert!(acts.iter().any(|a| a.tool == "evaluate" && !a.ok));

    // O lado do humano (app) vê o mesmo navegador: status e uma captura.
    let st = browser::status(&d);
    assert!(st.running && st.tabs.len() == 1 && st.url.as_deref().unwrap_or("").contains("/dois"), "{:?}", st.tabs);
    let f = browser::live::snapshot_frame(&d, 50).unwrap().unwrap();
    assert!(f.data.starts_with("/9j/") && f.width == 390.0);

    drop(m);
    assert!(browser::stop(&d).unwrap());
    assert!(browser::running(&d).is_none());
    // Limpar apaga cookies e sessões do workspace.
    browser::clear(&d).unwrap();
    assert!(!d.profile().exists());
    std::fs::remove_dir_all(&home).ok();
}

/// Dois agentes (dois processos MCP) e o humano no mesmo navegador do workspace; outro workspace tem
/// outro navegador (perfil e cookies separados).
#[test]
fn compartilhado_entre_agentes_e_isolado_por_workspace() {
    let _chrome = chrome_lock();
    let home = tmp("dois");
    if !have_browser(&home) {
        return;
    }
    let (port, _) = serve();
    let base = format!("http://127.0.0.1:{port}");
    let (a, b) = (Dirs::new(&home, "wa"), Dirs::new(&home, "wb"));
    let mut m1 = Mcp::start(&home, "wa");
    let mut m2 = Mcp::start(&home, "wa");
    let (_, err, _) = m1.call("browser_navigate", json!({ "url": format!("{base}/") }));
    assert!(!err);
    // Cookie gravado pelo primeiro agente...
    std::fs::write(home.join("app-settings.json"), r#"{"browser_policy":"all"}"#).unwrap();
    m1.call("browser_evaluate", json!({ "expression": "document.cookie='sessao=1; max-age=3600'" }));
    // ...o segundo vê a mesma página e o mesmo cookie.
    let (snap, _, _) = m2.call("browser_snapshot", json!({}));
    assert!(snap.contains("Olá navegador"), "{snap}");
    let (c, _, _) = m2.call("browser_evaluate", json!({ "expression": "document.cookie" }));
    assert!(c.contains("sessao=1"), "{c}");
    // Outro workspace: outro Chromium, sem o cookie.
    let mut m3 = Mcp::start(&home, "wb");
    m3.call("browser_navigate", json!({ "url": format!("{base}/") }));
    let (c, _, _) = m3.call("browser_evaluate", json!({ "expression": "document.cookie" }));
    assert!(!c.contains("sessao"), "{c}");
    assert_ne!(browser::running(&a).unwrap().port, browser::running(&b).unwrap().port);
    drop((m1, m2, m3));
    browser::stop(&a).unwrap();
    browser::stop(&b).unwrap();
    std::fs::remove_dir_all(&home).ok();
}

/// O lado do humano (aba Browser do app e kabuld): comandos, screencast e entrada de mouse/teclado.
#[test]
fn aba_browser_screencast_e_entrada() {
    let _chrome = chrome_lock();
    use kabul_core::browser::live;
    let home = tmp("aba");
    if !have_browser(&home) {
        return;
    }
    let (port, hits) = serve();
    let d = Dirs::new(&home, "wh");
    let cmd = |c: &str, a: Value| live::command(&home, c, &a).unwrap();
    let st = cmd("open", json!({ "workspaceId": "wh", "url": format!("127.0.0.1:{port}/") }));
    assert_eq!(st["running"], true);
    assert_eq!(st["title"], "Teste Kabul", "{st}");
    // Screencast: quadros JPEG chegam pelo callback.
    let (tx, rx) = std::sync::mpsc::channel();
    live::screencast(&home, "wh", 800, 600, move |f| {
        let _ = tx.send(f);
    })
    .unwrap();
    let frame = loop {
        if let Some(f) = rx.recv_timeout(Duration::from_secs(10)).expect("sem quadro do screencast") {
            break f;
        }
    };
    assert!(frame.data.starts_with("/9j/") && frame.width > 0.0, "{}", frame.width);
    // Clique do humano: coordenadas em pixels CSS da página.
    let p = live::page(&d).unwrap();
    let r = p
        .eval("(() => { const r = document.getElementById('nome').getBoundingClientRect(); const b = document.getElementById('b').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, b.x + b.width / 2, b.y + b.height / 2]; })()")
        .unwrap();
    let n = |i: usize| r[i].as_f64().unwrap();
    let mouse = |kind: &str, x: f64, y: f64| json!({ "type": "mouse", "kind": kind, "x": x, "y": y, "button": "left", "clicks": 1 });
    for k in ["down", "up"] {
        cmd("input", json!({ "workspaceId": "wh", "event": mouse(k, n(0), n(1)) }));
    }
    // Teclado: tecla com texto, depois colar.
    cmd("input", json!({ "workspaceId": "wh", "event": { "type": "key", "kind": "down", "key": "V", "code": "KeyV", "text": "V", "keyCode": 86 } }));
    cmd("input", json!({ "workspaceId": "wh", "event": { "type": "key", "kind": "up", "key": "V", "code": "KeyV", "keyCode": 86 } }));
    cmd("input", json!({ "workspaceId": "wh", "event": { "type": "text", "text": "al" } }));
    for k in ["down", "up"] {
        cmd("input", json!({ "workspaceId": "wh", "event": mouse(k, n(2), n(3)) }));
    }
    let t0 = std::time::Instant::now();
    while !hits.lock().unwrap().iter().any(|h| h == "/clicado?nome=Val") && t0.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(hits.lock().unwrap().iter().any(|h| h == "/clicado?nome=Val"), "{:?}", hits.lock().unwrap());
    // Barra de endereço: texto sem cara de URL vira busca (não navega aqui), voltar/recarregar.
    let r = cmd("nav", json!({ "workspaceId": "wh", "action": "goto", "url": format!("http://127.0.0.1:{port}/dois") }));
    assert!(r.as_str().unwrap().contains("/dois"));
    let r = cmd("nav", json!({ "workspaceId": "wh", "action": "back" }));
    assert!(r.as_str().unwrap().contains("Teste Kabul"), "{r}");
    // Abas e tamanho.
    let st = cmd("tab", json!({ "workspaceId": "wh", "action": "new", "url": "about:blank" }));
    assert_eq!(st["tabs"].as_array().unwrap().len(), 2);
    let first = st["tabs"].as_array().unwrap().iter().find(|t| t["active"] == false).unwrap()["id"].as_str().unwrap().to_string();
    let st = cmd("tab", json!({ "workspaceId": "wh", "action": "select", "id": first }));
    assert_eq!(st["title"], "Teste Kabul");
    let v = cmd("resize", json!({ "workspaceId": "wh", "preset": "mobile" }));
    assert_eq!(v["width"], 390);
    // Captura avulsa (celular) e pausa.
    let f = cmd("screenshot", json!({ "workspaceId": "wh" }));
    assert!(f["data"].as_str().unwrap().starts_with("/9j/"));
    assert_eq!(cmd("control", json!({ "workspaceId": "wh", "paused": true }))["paused"], true);
    assert_eq!(cmd("status", json!({ "workspaceId": "wh" }))["paused"], true);
    live::stop_screencast("wh");
    assert_eq!(cmd("stop", json!({ "workspaceId": "wh" })), json!(true));
    assert_eq!(cmd("screenshot", json!({ "workspaceId": "wh" })), Value::Null);
    cmd("clear", json!({ "workspaceId": "wh" }));
    std::fs::remove_dir_all(&home).ok();
}

/// Um agente de verdade (CLI instalado) com o LLM falso navega, lê e clica pelo MCP embutido.
#[test]
#[ignore]
fn agente_real() {
    use kabul_core::harness::{Api, Endpoint, Event, HarnessKind, SessionOptions};
    use kabul_core::mcp_share;
    let Some(kind) = std::env::var("KABUL_TESTE_BROWSER_AGENTE").ok().and_then(|a| HarnessKind::parse(&a)) else {
        eprintln!("defina KABUL_TESTE_BROWSER_AGENTE");
        return;
    };
    let home = tmp(&format!("agente-{}", kind.binary()));
    if !have_browser(&home) {
        return;
    }
    let (port, hits) = serve();
    let ws = home.join("ws");
    std::fs::create_dir_all(&ws).unwrap();
    // O mesmo registro que a conversa do app usa: o MCP embutido, servido por este binário.
    if std::env::var_os("KABUL_MCP_BIN").is_none() {
        std::env::set_var("KABUL_MCP_BIN", env!("CARGO_BIN_EXE_kabul"));
    }
    let all = mcp_share::builtin(&home, "ws-agente", None, &[]);
    let p = mcp_share::plan(kind, &all, &[], &mcp_share::Prefs::default());
    assert_eq!(p.inject.len(), 1);
    let mut fake = Command::new("node").arg(concat!(env!("CARGO_MANIFEST_DIR"), "/../kabul-core/tests/fake-llm.mjs")).arg("0").env("FAKE_LLM_LOG", home.join("llm.log")).stdout(Stdio::piped()).spawn().unwrap();
    let mut line = String::new();
    BufReader::new(fake.stdout.take().unwrap()).read_line(&mut line).unwrap();
    let llm = line.trim().trim_start_matches("PORTA ").to_string();
    let mut opts = SessionOptions {
        cwd: Some(ws.display().to_string()),
        approvals_via_app: true,
        permission_mode: Some("default".into()),
        endpoint: Some(Endpoint { base_url: format!("http://127.0.0.1:{llm}"), apis: vec![Api::Openai, Api::Anthropic, Api::Gemini], api_key: None, model: "fake-model".into(), context: Some(128_000) }),
        ..Default::default()
    };
    if kind == HarnessKind::Claude {
        let (f, _) = mcp_share::claude_config(&p, &home.join("mcp")).unwrap().unwrap();
        opts.mcp_config = Some(f.display().to_string());
        opts.allowed_tools = vec!["mcp__kabul-browser".into()];
    } else {
        opts.mcp_inject = p.inject.clone();
    }
    let h = kind.harness();
    let mut r = kabul_core::harness::spawn(h.as_ref(), &opts).unwrap();
    r.send(&format!("Abra a página de teste e clique em Enviar. [KABUL-BROWSER http://127.0.0.1:{port}/ Enviar]")).unwrap();
    let mut text = String::new();
    let mut used = vec![];
    loop {
        match r.events.recv_timeout(Duration::from_secs(90)).expect("sem eventos do agente") {
            Event::ApprovalRequest { request_id, tool, .. } => {
                eprintln!("aprovação do agente: {tool}");
                r.approve_ext(&request_id, true, &tool, None, false).unwrap();
            }
            Event::ToolUse { name, .. } => {
                eprintln!("ferramenta: {name}");
                used.push(name);
            }
            Event::ToolResult { output, is_error, .. } => eprintln!("resultado ({is_error}): {}", output.to_string().chars().take(200).collect::<String>()),
            Event::TextDelta { text: t } | Event::Text { text: t } => text.push_str(&t),
            Event::TurnCompleted { .. } => break,
            Event::Error { message } => panic!("{message}"),
            e => {
                if std::env::var_os("KABUL_TESTE_VERBOSO").is_some() {
                    eprintln!("{e:?}");
                }
            }
        }
    }
    eprintln!("texto: {text}");
    let _ = r.kill();
    let _ = fake.kill();
    let _ = fake.wait();
    let d = Dirs::new(&home, "ws-agente");
    let acts = browser::actions(&d, 20);
    eprintln!("ações: {acts:?}");
    let _ = browser::stop(&d);
    assert!(hits.lock().unwrap().iter().any(|h| h.starts_with("/clicado")), "o clique do {kind:?} não chegou à página: {text}");
    assert_eq!(acts.iter().map(|a| a.tool.as_str()).collect::<Vec<_>>(), vec!["navigate", "snapshot", "click"]);
    assert!(acts.iter().all(|a| a.ok));
    std::fs::remove_dir_all(&home).ok();
}
