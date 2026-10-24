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

    // Terminal compartilhado: tmux real com prefixo kabul-test-.
    if kabul_core::harness::which("tmux").is_some() {
        let name = format!("kabul-test-it-{}", std::process::id());
        kabul_core::tmux::new_session(&name, None, Some("sh")).unwrap();
        tokio::time::sleep(Duration::from_millis(700)).await;
        let live = call(&mut cel, 4, "live_sessions", json!({})).await;
        assert!(live["value"]["sessions"].as_array().unwrap().iter().any(|s| s["name"] == json!(name)), "{live}");
        cel.send(Message::Text(json!({"sub": "term-output"}).to_string().into())).await.unwrap();
        let t = call(&mut cel, 5, "term_attach", json!({"session": name})).await;
        assert_eq!(t["ok"], true, "{t}");
        let pane = t["value"]["pane"].as_str().unwrap().to_string();
        let k = call(&mut dono, 6, "term_keys", json!({"session": name, "pane": pane, "keys": ["C-c"]})).await;
        assert_eq!(k["ok"], true);
        call(&mut dono, 7, "term_input", json!({"session": name, "pane": pane, "data": "echo kabul-$((40+2))\r"})).await;
        let mut got = String::new();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline && !got.contains("kabul-42") {
            let v = next_json(&mut cel).await;
            if v["channel"] == "term-output" {
                let b: Vec<u8> = serde_json::from_value(v["payload"]["data"].clone()).unwrap();
                got.push_str(&String::from_utf8_lossy(&b));
            }
        }
        let _ = kabul_core::tmux::kill_session(&name);
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
