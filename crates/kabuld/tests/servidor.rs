//! Servidor real numa porta livre: hello local, pareamento por ingresso, credencial por aparelho,
//! convidado observador barrado, terminal compartilhado e revogação derrubando a conexão.
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

type Ws = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

fn server() -> (kabuld::Server, std::path::PathBuf) {
    let home = std::env::temp_dir().join(format!("kabuld-it-{}-{}", std::process::id(), kabuld::auth::random_token(4)));
    let cfg = kabuld::Config { port: free_port(), home: home.clone(), web_dir: None, tailscale: false, secrets: Arc::new(kabuld::secrets::MemStore::default()), monitor_ms: 300, assets: None };
    (kabuld::start(cfg).unwrap(), home)
}

async fn connect(port: u16, origin: Option<&str>, cred: Option<(&str, &str)>) -> (Ws, Value) {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let mut req = format!("ws://127.0.0.1:{port}/ws").into_client_request().unwrap();
    if let Some(o) = origin {
        req.headers_mut().insert("origin", o.parse().unwrap());
    }
    let (mut ws, _) = tokio_tungstenite::connect_async(req).await.unwrap();
    let hello = match cred {
        Some((d, k)) => json!({"hello": {"device": d, "key": k}}),
        None => json!({"hello": {}}),
    };
    ws.send(Message::Text(hello.to_string().into())).await.unwrap();
    let ack = next_json(&mut ws).await;
    (ws, ack)
}

async fn next_json(ws: &mut Ws) -> Value {
    loop {
        match tokio::time::timeout(Duration::from_secs(5), ws.next()).await.expect("timeout") {
            Some(Ok(Message::Text(t))) => return serde_json::from_str(&t).unwrap(),
            Some(Ok(Message::Close(_))) | None => return Value::Null,
            _ => continue,
        }
    }
}

async fn call(ws: &mut Ws, id: u64, command: &str, args: Value) -> Value {
    ws.send(Message::Text(json!({"id": id, "command": command, "args": args}).to_string().into())).await.unwrap();
    loop {
        let v = next_json(ws).await;
        if v.is_null() || v["id"] == json!(id) {
            return v;
        }
    }
}

fn pair(port: u16, token: &str, user: &str) -> Value {
    let r = ureq::post(&format!("http://127.0.0.1:{port}/api/pair")).set("content-type", "application/json").send_string(&json!({"token": token, "user": user, "device": "iPhone"}).to_string());
    match r {
        Ok(r) => serde_json::from_str(&r.into_string().unwrap()).unwrap(),
        Err(ureq::Error::Status(_, r)) => serde_json::from_str(&r.into_string().unwrap()).unwrap(),
        Err(e) => panic!("{e}"),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn pareamento_papeis_e_revogacao() {
    let (srv, home) = server();
    let port = srv.addrs[0].port();

    // Página qualquer aberta no navegador do Mac não ganha acesso de dono.
    let (_ws, ack) = connect(port, Some("https://site.example"), None).await;
    assert_eq!(ack["hello"]["ok"], false);

    // Cliente local (sem Origin) é o dono.
    let (mut dono, ack) = connect(port, None, None).await;
    assert_eq!(ack["hello"]["principal"]["role"], "owner");
    let pc = call(&mut dono, 1, "pair_create", json!({})).await;
    let token = pc["value"]["token"].as_str().unwrap().to_string();
    assert!(pc["value"]["qr_svg"].as_str().unwrap().starts_with("<?xml") || pc["value"]["qr_svg"].as_str().unwrap().contains("<svg"));
    assert!(pc["value"]["url"].as_str().unwrap().contains("/m/#pair="));

    let p = pair(port, &token, "Dev");
    assert_eq!(p["ok"], true, "{p}");
    let (dev_id, key) = (p["value"]["device"]["id"].as_str().unwrap().to_string(), p["value"]["key"].as_str().unwrap().to_string());
    assert_eq!(pair(port, &token, "De novo")["ok"], false, "ingresso de uso único");

    // Aparelho pareado entra com a credencial, mesmo vindo "de fora" (Origin https).
    let (mut cel, ack) = connect(port, Some("https://mac.tailnet-exemplo.ts.net"), Some((&dev_id, &key))).await;
    assert_eq!(ack["hello"]["ok"], true);
    assert_eq!(ack["hello"]["principal"]["user"], "Dev");
    let devs = call(&mut dono, 2, "devices_list", json!({})).await;
    assert_eq!(devs["value"].as_array().unwrap().len(), 1);

    // Convite de observador para um workspace inexistente falha; convidado não pareia o dono.
    let inv = call(&mut dono, 3, "invite_create", json!({"workspaceId": "nao-existe", "role": "observer"})).await;
    assert_eq!(inv["ok"], false);

    // Terminal compartilhado pelo backend do sistema (tmux no macOS; PTY no Windows ou sem tmux),
    // com prefixo kabul-test-.
    {
        use kabul_core::harness::CmdSpec;
        use kabul_core::term::{self, Cmd, Launch, What};
        let name = format!("kabul-test-it-{}", std::process::id());
        let shell = if cfg!(windows) { CmdSpec::new("cmd.exe", ["/Q"]) } else { CmdSpec::new("sh", Vec::<String>::new()) };
        term::backend().open(&Launch::new(&name, None, What::Exec(Cmd::Spec(shell)))).unwrap();
        tokio::time::sleep(Duration::from_millis(700)).await;
        let live = call(&mut cel, 4, "live_sessions", json!({})).await;
        assert!(live["value"]["sessions"].as_array().unwrap().iter().any(|s| s["name"] == json!(name)), "{live}");
        cel.send(Message::Text(json!({"sub": "term-output"}).to_string().into())).await.unwrap();
        let t = call(&mut cel, 5, "term_attach", json!({"session": name})).await;
        assert_eq!(t["ok"], true, "{t}");
        let pane = t["value"]["pane"].as_str().unwrap().to_string();
        let k = call(&mut dono, 6, "term_keys", json!({"session": name, "pane": pane, "keys": ["C-c"]})).await;
        assert_eq!(k["ok"], true);
        let line = if cfg!(windows) { "echo kabul-4^2\r" } else { "echo kabul-$((40+2))\r" };
        call(&mut dono, 7, "term_input", json!({"session": name, "pane": pane, "data": line})).await;
        let mut got = String::new();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline && !got.contains("kabul-42") {
            let v = next_json(&mut cel).await;
            if v["channel"] == "term-output" {
                let b: Vec<u8> = serde_json::from_value(v["payload"]["data"].clone()).unwrap();
                got.push_str(&String::from_utf8_lossy(&b));
            }
        }
        let _ = term::backend().kill(&name);
        assert!(got.contains("kabul-42"), "{got:?}");
    }

    // Revogar derruba a conexão aberta e invalida a credencial.
    let r = call(&mut dono, 8, "device_revoke", json!({"id": dev_id})).await;
    assert_eq!(r["ok"], true);
    let mut closed = false;
    for _ in 0..50 {
        let v = next_json(&mut cel).await;
        if v.is_null() {
            closed = true;
            break;
        }
    }
    assert!(closed, "conexão do aparelho revogado caiu");
    let (_ws, ack) = connect(port, Some("https://mac.tailnet-exemplo.ts.net"), Some((&dev_id, &key))).await;
    assert_eq!(ack["hello"]["ok"], false);

    srv.stop();
    let _ = std::fs::remove_dir_all(home);
}

#[tokio::test(flavor = "multi_thread")]
async fn saude_e_cors() {
    let (srv, home) = server();
    let port = srv.addrs[0].port();
    let r = ureq::get(&format!("http://127.0.0.1:{port}/api/health")).call().unwrap();
    assert_eq!(r.header("access-control-allow-origin"), Some("*"));
    let v: Value = serde_json::from_str(&r.into_string().unwrap()).unwrap();
    assert_eq!(v["kabuld"], true);
    srv.stop();
    let _ = std::fs::remove_dir_all(home);
}

/// Preview de arquivos: link por arquivo emitido pelo WebSocket, só dentro do workspace, conteúdo do
/// repo nunca executa no origin do kabuld, Range para vídeo, convidado sem segredos nem outro
/// workspace, revogação derruba os links.
#[tokio::test(flavor = "multi_thread")]
async fn preview_de_arquivos_seguro() {
    let home = std::env::temp_dir().join(format!("kabuld-files-it-{}-{}", std::process::id(), kabuld::auth::random_token(4)));
    let (w1, w2) = (home.join("workspaces/app/w1"), home.join("workspaces/app/w2"));
    for d in [&w1, &w2] {
        std::fs::create_dir_all(d).unwrap();
    }
    std::fs::write(w1.join("index.html"), "<script>alert(1)</script>").unwrap();
    std::fs::write(w1.join("logo.svg"), "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>").unwrap();
    std::fs::write(w1.join(".env"), "TOKEN=segredo").unwrap();
    std::fs::write(w1.join("video.mp4"), vec![7u8; 1000]).unwrap();
    std::fs::write(home.join("fora.txt"), "fora").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(home.join("fora.txt"), w1.join("atalho.txt")).unwrap();
    std::fs::write(w2.join("b.txt"), "do outro").unwrap();
    let state = json!({
        "repos": [{"id": "r1", "name": "app", "path": w1, "default_branch": "main"}],
        "workspaces": [
            {"id": "w1", "repo_id": "r1", "name": "w1", "branch": "dev/w1", "path": w1, "archived": false, "created_at": 0, "status": "in-progress", "state": "ready", "pinned": false, "notes": "", "port": 41000},
            {"id": "w2", "repo_id": "r1", "name": "w2", "branch": "dev/w2", "path": w2, "archived": false, "created_at": 0, "status": "in-progress", "state": "ready", "pinned": false, "notes": "", "port": 41010}
        ]
    });
    std::fs::write(home.join("state.json"), state.to_string()).unwrap();
    let cfg = kabuld::Config { port: free_port(), home: home.clone(), web_dir: None, tailscale: false, secrets: Arc::new(kabuld::secrets::MemStore::default()), monitor_ms: 300, assets: None };
    let srv = kabuld::start(cfg).unwrap();
    let port = srv.addrs[0].port();
    let fetch = |url: &str, range: Option<&str>| {
        let mut r = ureq::get(&format!("http://127.0.0.1:{port}{url}"));
        if let Some(x) = range {
            r = r.set("range", x);
        }
        let resp = match r.call() {
            Ok(r) => r,
            Err(ureq::Error::Status(_, r)) => r,
            Err(e) => panic!("{e}"),
        };
        let hs: std::collections::HashMap<String, String> = resp.headers_names().into_iter().map(|n| (n.clone(), resp.header(&n).unwrap_or("").to_string())).collect();
        (resp.status(), hs, resp.into_string().unwrap_or_default())
    };

    let (mut dono, _) = connect(port, None, None).await;
    let url = |v: &Value| v["value"]["url"].as_str().unwrap_or_default().to_string();
    let html = call(&mut dono, 1, "file_url", json!({"workspaceId": "w1", "path": "index.html"})).await;
    let (st, hs, body) = fetch(&url(&html), None);
    assert_eq!(st, 200);
    assert_eq!(hs["content-type"], "text/plain; charset=utf-8", "HTML do repo não vira página");
    assert_eq!(hs["x-content-type-options"], "nosniff");
    assert!(hs["content-security-policy"].contains("sandbox") && !hs.contains_key("access-control-allow-origin"));
    assert!(body.contains("<script>"));
    let svg = call(&mut dono, 2, "file_url", json!({"workspaceId": "w1", "path": "logo.svg"})).await;
    let (_, hs, _) = fetch(&url(&svg), None);
    assert_eq!(hs["content-type"], "image/svg+xml");
    assert!(hs["content-security-policy"].contains("default-src 'none'") && hs["content-security-policy"].contains("sandbox"));
    let vid = call(&mut dono, 3, "file_url", json!({"workspaceId": "w1", "path": "video.mp4"})).await;
    let (st, hs, _) = fetch(&url(&vid), Some("bytes=10-19"));
    assert_eq!((st, hs["content-range"].as_str(), hs["content-length"].as_str()), (206, "bytes 10-19/1000", "10"));
    for bad in ["../fora.txt", "/etc/passwd", "atalho.txt", ".git/config"] {
        assert_eq!(call(&mut dono, 4, "file_url", json!({"workspaceId": "w1", "path": bad})).await["ok"], false, "{bad}");
    }
    assert_eq!(call(&mut dono, 5, "file_url", json!({"workspaceId": "w1", "path": ".env"})).await["ok"], true, "dono vê o .env");
    assert_eq!(fetch("/api/file?t=inventado", None).0, 403);

    // Convidado observador do w1.
    let inv = call(&mut dono, 6, "invite_create", json!({"workspaceId": "w1", "role": "observer"})).await;
    let p = pair(port, inv["value"]["token"].as_str().unwrap(), "Bia");
    let (gid, gkey) = (p["value"]["device"]["id"].as_str().unwrap().to_string(), p["value"]["key"].as_str().unwrap().to_string());
    let (mut conv, ack) = connect(port, Some("https://mac.tailnet-exemplo.ts.net"), Some((&gid, &gkey))).await;
    assert_eq!(ack["hello"]["principal"]["role"], "observer");
    let ok = call(&mut conv, 1, "file_url", json!({"workspaceId": "w1", "path": "index.html"})).await;
    assert_eq!(ok["ok"], true, "{ok}");
    assert_eq!(call(&mut conv, 2, "file_url", json!({"workspaceId": "w1", "path": ".env"})).await["ok"], false, "segredo só para o dono");
    assert_eq!(call(&mut conv, 3, "file_url", json!({"workspaceId": "w2", "path": "b.txt"})).await["ok"], false, "outro workspace");
    assert_eq!(call(&mut conv, 4, "file_url", json!({"workspaceId": "w1", "chatId": "x", "path": "index.html"})).await["ok"], false);
    assert_eq!(fetch(&url(&ok), None).0, 200);
    call(&mut dono, 7, "device_revoke", json!({"id": gid})).await;
    assert_eq!(fetch(&url(&ok), None).0, 403, "revogado perde os links");

    srv.stop();
    let _ = std::fs::remove_dir_all(home);
}

/// Proxy do Run: só portas do workspace, outro origin (listener próprio), entrada por ingresso de uso
/// único que vira cookie HttpOnly, observador não abre, revogação derruba a sessão.
#[tokio::test(flavor = "multi_thread")]
async fn proxy_do_run() {
    use std::io::{Read, Write};
    let home = std::env::temp_dir().join(format!("kabuld-proxy-it-{}-{}", std::process::id(), kabuld::auth::random_token(4)));
    let w1 = home.join("workspaces/app/w1");
    std::fs::create_dir_all(&w1).unwrap();
    // "App" do workspace: responde com o caminho e o Host recebidos.
    let app = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let app_port = app.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for s in app.incoming().flatten() {
            let mut s = s;
            let mut b = [0u8; 4096];
            let n = s.read(&mut b).unwrap_or(0);
            let req = String::from_utf8_lossy(&b[..n]).to_string();
            let line = req.lines().next().unwrap_or("").to_string();
            let body = format!("app ok: {line}");
            let _ = write!(s, "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
        }
    });
    let state = json!({
        "repos": [{"id": "r1", "name": "app", "path": w1, "default_branch": "main"}],
        "workspaces": [{"id": "w1", "repo_id": "r1", "name": "w1", "branch": "dev/w1", "path": w1, "archived": false, "created_at": 0, "status": "in-progress", "state": "ready", "pinned": false, "notes": "", "port": app_port}]
    });
    std::fs::write(home.join("state.json"), state.to_string()).unwrap();
    let cfg = kabuld::Config { port: free_port(), home: home.clone(), web_dir: None, tailscale: false, secrets: Arc::new(kabuld::secrets::MemStore::default()), monitor_ms: 300, assets: None };
    let srv = kabuld::start(cfg).unwrap();
    let port = srv.addrs[0].port();
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    let get = |url: &str, cookie: Option<&str>| {
        let mut r = agent.get(url);
        if let Some(c) = cookie {
            r = r.set("cookie", c);
        }
        let resp = match r.call() {
            Ok(r) => r,
            Err(ureq::Error::Status(_, r)) => r,
            Err(e) => panic!("{e}"),
        };
        let set_cookie = resp.header("set-cookie").unwrap_or("").to_string();
        (resp.status(), set_cookie, resp.into_string().unwrap_or_default())
    };

    let (mut dono, _) = connect(port, None, None).await;
    let ports = call(&mut dono, 1, "proxy_ports", json!({"workspaceId": "w1"})).await;
    assert_eq!(ports["value"]["ports"][0], json!({"port": app_port, "listening": true}), "{ports}");
    for bad in [22u64, 5432, app_port as u64 + 10] {
        assert_eq!(call(&mut dono, 2, "proxy_open", json!({"workspaceId": "w1", "port": bad})).await["ok"], false, "porta {bad} fora do workspace");
    }
    let o = call(&mut dono, 3, "proxy_open", json!({"workspaceId": "w1", "port": app_port})).await;
    let url = o["value"]["url"].as_str().unwrap().to_string();
    let pport = o["value"]["port"].as_u64().unwrap() as u16;
    assert_ne!(pport, port, "outro origin: o app não roda no origin do kabuld");
    let base = format!("http://127.0.0.1:{pport}");
    assert_eq!(get(&format!("{base}/"), None).0, 401, "sem cookie não entra");
    let (st, cookie, _) = get(&url, None);
    assert_eq!(st, 302);
    assert!(cookie.contains("HttpOnly") && cookie.contains(&format!("kabul_proxy_{pport}=")), "{cookie}");
    assert_eq!(get(&url, None).0, 403, "ingresso de uso único");
    let c = cookie.split(';').next().unwrap().to_string();
    let (st, _, body) = get(&format!("{base}/painel?x=1"), Some(&c));
    assert_eq!((st, body.as_str()), (200, "app ok: GET /painel?x=1 HTTP/1.1"));
    assert_eq!(get(&format!("{base}/"), Some("kabul_proxy_1=inventado")).0, 401);

    // Convidado: observador não abre o app; editor abre.
    let inv = call(&mut dono, 4, "invite_create", json!({"workspaceId": "w1", "role": "observer"})).await;
    let p = pair(port, inv["value"]["token"].as_str().unwrap(), "Bia");
    let (gid, gkey) = (p["value"]["device"]["id"].as_str().unwrap().to_string(), p["value"]["key"].as_str().unwrap().to_string());
    let (mut obs, _) = connect(port, Some("https://mac.tailnet-exemplo.ts.net"), Some((&gid, &gkey))).await;
    assert_eq!(call(&mut obs, 1, "proxy_ports", json!({"workspaceId": "w1"})).await["ok"], true);
    assert_eq!(call(&mut obs, 2, "proxy_open", json!({"workspaceId": "w1", "port": app_port})).await["ok"], false);
    let inv = call(&mut dono, 5, "invite_create", json!({"workspaceId": "w1", "role": "editor"})).await;
    let p = pair(port, inv["value"]["token"].as_str().unwrap(), "Caio");
    let (eid, ekey) = (p["value"]["device"]["id"].as_str().unwrap().to_string(), p["value"]["key"].as_str().unwrap().to_string());
    let (mut ed, _) = connect(port, Some("https://mac.tailnet-exemplo.ts.net"), Some((&eid, &ekey))).await;
    let o = call(&mut ed, 1, "proxy_open", json!({"workspaceId": "w1", "port": app_port})).await;
    assert_eq!(o["value"]["port"].as_u64().unwrap() as u16, pport, "mesmo listener para o mesmo app");
    let (_, cookie, _) = get(o["value"]["url"].as_str().unwrap(), None);
    let ce = cookie.split(';').next().unwrap().to_string();
    assert_eq!(get(&format!("{base}/"), Some(&ce)).0, 200);
    call(&mut dono, 6, "device_revoke", json!({"id": eid})).await;
    assert_eq!(get(&format!("{base}/"), Some(&ce)).0, 401, "revogado perde a sessão do proxy");
    assert_eq!(get(&format!("{base}/"), Some(&c)).0, 200, "o dono continua");

    srv.stop();
    let _ = std::fs::remove_dir_all(home);
}

/// Segurança: DNS rebinding (Host de outro domínio) é recusado; a PWA sai com CSP e sem iframe.
#[tokio::test(flavor = "multi_thread")]
async fn host_e_cabecalhos_de_seguranca() {
    let (srv, home) = server();
    let port = srv.addrs[0].port();
    let get = |host: &str, path: &str| match ureq::get(&format!("http://127.0.0.1:{port}{path}")).set("host", host).call() {
        Ok(r) => (r.status(), r.header("content-security-policy").map(String::from), r.header("x-frame-options").map(String::from)),
        Err(ureq::Error::Status(c, r)) => (c, r.header("content-security-policy").map(String::from), r.header("x-frame-options").map(String::from)),
        Err(e) => panic!("{e}"),
    };
    assert_eq!(get("evil.example:7777", "/api/health").0, 421);
    assert_eq!(get("127.0.0.1.nip.io", "/m/").0, 421);
    assert_eq!(get(&format!("localhost:{port}"), "/api/health").0, 200);
    let (_, csp, xfo) = get(&format!("127.0.0.1:{port}"), "/m/");
    let csp = csp.expect("CSP na PWA");
    assert!(csp.contains("script-src 'self'") && csp.contains("frame-ancestors 'none'") && !csp.contains("unsafe-eval"), "{csp}");
    assert_eq!(xfo.as_deref(), Some("DENY"));
    // WebSocket com Host de rebinding nem chega ao hello.
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let mut req = format!("ws://127.0.0.1:{port}/ws").into_client_request().unwrap();
    req.headers_mut().insert("host", "evil.example".parse().unwrap());
    assert!(tokio_tungstenite::connect_async(req).await.is_err());
    srv.stop();
    let _ = std::fs::remove_dir_all(home);
}

async fn hello_raw(port: u16, hello: Value) -> Value {
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}/ws")).await.unwrap();
    ws.send(Message::Text(hello.to_string().into())).await.unwrap();
    next_json(&mut ws).await
}

#[tokio::test(flavor = "multi_thread")]
async fn handshake_de_versao() {
    let (srv, home) = server();
    let port = srv.addrs[0].port();
    let proto = kabul_core::schema::PROTOCOL;
    // Cliente atual: aceito, e a resposta diz a versão e o protocolo do kabuld.
    let ack = hello_raw(port, json!({"hello": {"client": kabul_core::schema::hello_info("teste")}})).await;
    assert_eq!(ack["hello"]["ok"], true);
    assert_eq!(ack["hello"]["server"]["version"], kabul_core::schema::APP_VERSION);
    assert_eq!(ack["hello"]["server"]["protocol"], proto);
    // Cliente de antes do handshake (sem `client`): continua funcionando.
    assert_eq!(hello_raw(port, json!({"hello": {}})).await["hello"]["ok"], true);
    // Cliente antigo demais: recusado com aviso para atualizar (não um erro genérico).
    let ack = hello_raw(port, json!({"hello": {"client": {"version": "0.0.1", "protocol": 0}}})).await;
    assert_eq!((ack["hello"]["ok"].as_bool(), ack["hello"]["incompatible"].as_bool()), (Some(false), Some(true)));
    assert!(ack["hello"]["error"].as_str().unwrap().contains("Atualize"), "{ack}");
    let h: Value = serde_json::from_str(&ureq::get(&format!("http://127.0.0.1:{port}/api/health")).call().unwrap().into_string().unwrap()).unwrap();
    assert_eq!((h["version"].as_str(), h["protocol"].as_u64()), (Some(kabul_core::schema::APP_VERSION), Some(proto as u64)));
    srv.stop();
    let _ = std::fs::remove_dir_all(home);
}
