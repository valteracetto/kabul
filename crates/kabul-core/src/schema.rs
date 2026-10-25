//! Versão dos formatos gravados em disco e do protocolo entre kabuld e clientes.
//!
//! Cada arquivo leva `schema_version` (ausente = 0, o formato de antes do versionamento). Ao ler,
//! [`migrate`] aplica em ordem as migrações `v -> v+1` até a versão atual; o original vai antes para
//! `<arquivo>.v<N>.bak`. Arquivo de uma versão **mais nova** (o usuário voltou para um Kabul antigo)
//! é lido no melhor esforço (campos desconhecidos são ignorados) e também ganha backup, porque o
//! próximo save grava no formato antigo.
//!
//! Para mudar um formato: suba a constante, acrescente a migração no fim da lista do arquivo e um
//! teste com um exemplo da versão anterior.
use anyhow::{bail, Result};
use serde_json::{json, Value};
use std::path::Path;

/// Versão do app (a mesma em todos os crates, `[workspace.package]`).
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// `state.json` (repos, workspaces, comentários, seções).
pub const STATE: u32 = 1;
/// `app-settings.json` (Configurações do app). v2: `tray_icon` (o que o ícone da barra mostra).
pub const APP_SETTINGS: u32 = 2;
/// `settings.toml` / `settings.local.toml` (do repo e do usuário).
pub const REPO_SETTINGS: u32 = 1;
/// `accounts.json` (perfis de conta por provedor).
pub const ACCOUNTS: u32 = 1;
/// Transcript canônico (`kabul_core::transcript`).
pub const TRANSCRIPT: u32 = 1;

/// Uma migração leva o documento da versão `i` para `i + 1` (índice `i` da lista).
pub type Migration = fn(&mut Value) -> Result<()>;

/// O que aconteceu ao ler.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Já estava na versão atual.
    Current,
    /// Migrado de `from` para a versão atual: vale gravar de volta.
    Migrated { from: u32 },
    /// Gravado por um Kabul mais novo: lido no melhor esforço.
    Newer { found: u32 },
}

pub fn version_of(v: &Value) -> u32 {
    v.get("schema_version").and_then(Value::as_u64).map(|n| n as u32).unwrap_or(0)
}

/// Migra `doc` (objeto JSON) para `current`. `migrations.len()` tem de ser igual a `current`.
pub fn migrate(doc: &mut Value, current: u32, migrations: &[Migration]) -> Result<Outcome> {
    debug_assert_eq!(migrations.len() as u32, current, "uma migração por versão");
    let found = version_of(doc);
    if found > current {
        return Ok(Outcome::Newer { found });
    }
    if found == current {
        return Ok(Outcome::Current);
    }
    for (i, m) in migrations.iter().enumerate().skip(found as usize) {
        m(doc)?;
        if !doc.is_object() {
            bail!("migração v{i} -> v{} não devolveu um objeto", i + 1);
        }
        doc["schema_version"] = json!(i as u32 + 1);
    }
    Ok(Outcome::Migrated { from: found })
}

/// Só carimba a versão (formato igual ao anterior). Documento que não é objeto vira `{}`.
pub fn stamp(doc: &mut Value) -> Result<()> {
    if !doc.is_object() {
        *doc = json!({});
    }
    Ok(())
}

/// Guarda uma cópia do arquivo antes de migrar ou de regravar num formato mais antigo
/// (`state.json` -> `state.json.v0.bak`). Não sobrescreve um backup que já existe.
pub fn backup(file: &Path, version: u32) {
    let Some(name) = file.file_name() else { return };
    let bak = file.with_file_name(format!("{}.v{version}.bak", name.to_string_lossy()));
    if file.is_file() && !bak.exists() {
        let _ = std::fs::copy(file, bak);
    }
}

/// Lê um arquivo JSON versionado: migra (com backup) e devolve o documento pronto para o serde.
/// `None` se o arquivo não existe ou não é JSON.
pub fn load_json(file: &Path, current: u32, migrations: &[Migration]) -> Option<(Value, Outcome)> {
    let text = std::fs::read_to_string(file).ok()?;
    let mut doc: Value = serde_json::from_str(&text).ok()?;
    let outcome = migrate(&mut doc, current, migrations).ok()?;
    match outcome {
        Outcome::Migrated { from } => backup(file, from),
        Outcome::Newer { found } => {
            backup(file, found);
            eprintln!("kabul: {} foi gravado por um Kabul mais novo (formato v{found}, este entende até v{current}); lido no melhor esforço", file.display());
        }
        Outcome::Current => {}
    }
    Some((doc, outcome))
}

// ---------------- migrações por arquivo ----------------

/// `state.json`: v0 -> v1 só carimba a versão.
pub const STATE_MIGRATIONS: &[Migration] = &[stamp];
/// `app-settings.json`: v1 -> v2 acrescenta `tray_icon` com o comportamento de antes (os dois limites mais
/// apertados em barras, com a porcentagem ao lado no macOS).
pub const APP_SETTINGS_MIGRATIONS: &[Migration] = &[stamp, app_settings_v1_to_v2];
pub const REPO_SETTINGS_MIGRATIONS: &[Migration] = &[stamp];
pub const TRANSCRIPT_MIGRATIONS: &[Migration] = &[stamp];
/// `accounts.json`: v0 era a lista pura; v1 é `{schema_version, accounts: [...]}`.
pub const ACCOUNTS_MIGRATIONS: &[Migration] = &[accounts_v0_to_v1];

fn app_settings_v1_to_v2(doc: &mut Value) -> Result<()> {
    if !doc.get("tray_icon").is_some_and(Value::is_object) {
        doc["tray_icon"] = json!({ "mode": "auto", "pinned": [], "style": "bars_percent", "show_spend": false });
    }
    Ok(())
}

fn accounts_v0_to_v1(doc: &mut Value) -> Result<()> {
    let list = match doc.take() {
        Value::Array(a) => Value::Array(a),
        Value::Object(mut o) => o.remove("accounts").unwrap_or_else(|| json!([])),
        _ => json!([]),
    };
    *doc = json!({ "accounts": list });
    Ok(())
}

// ---------------- protocolo kabuld <-> clientes ----------------

/// Versão do protocolo do WebSocket (`hello`, RPC, eventos). Suba quando um lado deixar de entender
/// o outro; mudanças compatíveis (campo novo opcional, comando novo) não sobem.
pub const PROTOCOL: u32 = 1;
/// Menor protocolo do outro lado que esta versão ainda atende.
pub const MIN_PEER_PROTOCOL: u32 = 1;

/// Resultado do handshake visto deste lado.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Compat {
    Ok,
    /// O outro lado é antigo demais: ele precisa atualizar.
    PeerOutdated {
        peer_version: String,
        peer_protocol: u32,
    },
    /// Este lado é antigo demais para o outro: este precisa atualizar.
    SelfOutdated {
        peer_version: String,
        peer_min_protocol: u32,
    },
}

/// Compara com o outro lado. Campos ausentes valem o protocolo 1 (o formato de antes do handshake).
pub fn compat(peer_version: Option<&str>, peer_protocol: Option<u32>, peer_min_protocol: Option<u32>) -> Compat {
    let peer_version = peer_version.unwrap_or("desconhecida").to_string();
    let proto = peer_protocol.unwrap_or(1);
    if proto < MIN_PEER_PROTOCOL {
        return Compat::PeerOutdated { peer_version, peer_protocol: proto };
    }
    let min = peer_min_protocol.unwrap_or(1);
    if PROTOCOL < min {
        return Compat::SelfOutdated { peer_version, peer_min_protocol: min };
    }
    Compat::Ok
}

/// Bloco que cada lado manda no `hello`.
pub fn hello_info(role: &str) -> Value {
    json!({ "name": role, "version": APP_VERSION, "protocol": PROTOCOL, "min_protocol": MIN_PEER_PROTOCOL })
}

/// Mensagem amigável para quem precisa atualizar.
pub fn compat_message(c: &Compat, peer: &str) -> Option<String> {
    match c {
        Compat::Ok => None,
        Compat::PeerOutdated { peer_version, .. } => Some(format!("{peer} está numa versão antiga do Kabul ({peer_version}); esta é {APP_VERSION}. Atualize o Kabul em {peer} para continuar.")),
        Compat::SelfOutdated { peer_version, .. } => Some(format!("Este Kabul ({APP_VERSION}) é antigo para {peer} ({peer_version}). Atualize este aparelho para continuar.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("kabul-schema-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn cadeia_de_migracoes_em_ordem() {
        fn a(d: &mut Value) -> Result<()> {
            d["a"] = json!(true);
            Ok(())
        }
        fn b(d: &mut Value) -> Result<()> {
            // v1 -> v2: renomeia `a` para `b` (só vê o que a anterior deixou).
            let v = d.as_object_mut().unwrap().remove("a").unwrap();
            d["b"] = v;
            Ok(())
        }
        let mut d = json!({"x": 1});
        assert_eq!(migrate(&mut d, 2, &[a, b]).unwrap(), Outcome::Migrated { from: 0 });
        assert_eq!(d, json!({"x": 1, "b": true, "schema_version": 2}));
        let mut d = json!({"schema_version": 1, "a": 5});
        assert_eq!(migrate(&mut d, 2, &[a, b]).unwrap(), Outcome::Migrated { from: 1 });
        assert_eq!(d["b"], 5);
        assert_eq!(migrate(&mut d, 2, &[a, b]).unwrap(), Outcome::Current);
        let mut d = json!({"schema_version": 7});
        assert_eq!(migrate(&mut d, 2, &[a, b]).unwrap(), Outcome::Newer { found: 7 });
    }

    #[test]
    fn contas_v0_lista_pura() {
        let mut d = json!([{"id": "claude:1", "provider": "claude", "nickname": "Trabalho"}]);
        assert_eq!(migrate(&mut d, ACCOUNTS, ACCOUNTS_MIGRATIONS).unwrap(), Outcome::Migrated { from: 0 });
        assert_eq!(d["schema_version"], 1);
        assert_eq!(d["accounts"][0]["nickname"], "Trabalho");
    }

    #[test]
    fn configuracoes_v1_ganham_o_icone_da_barra() {
        let mut d = json!({"schema_version": 1, "tray": false, "usage_alert_pct": 90});
        assert_eq!(migrate(&mut d, APP_SETTINGS, APP_SETTINGS_MIGRATIONS).unwrap(), Outcome::Migrated { from: 1 });
        assert_eq!(d["schema_version"], 2);
        assert_eq!(d["tray_icon"], json!({"mode": "auto", "pinned": [], "style": "bars_percent", "show_spend": false}));
        assert_eq!((d["tray"].as_bool(), d["usage_alert_pct"].as_u64()), (Some(false), Some(90)), "o resto fica como estava");
        // Já tinha (gravado por uma versão de teste): não sobrescreve.
        let mut d = json!({"schema_version": 1, "tray_icon": {"mode": "manual", "pinned": [], "style": "icon"}});
        migrate(&mut d, APP_SETTINGS, APP_SETTINGS_MIGRATIONS).unwrap();
        assert_eq!(d["tray_icon"]["style"], "icon");
        // Sem versão nenhuma (v0) passa pelas duas.
        let mut d = json!({});
        assert_eq!(migrate(&mut d, APP_SETTINGS, APP_SETTINGS_MIGRATIONS).unwrap(), Outcome::Migrated { from: 0 });
        assert_eq!(d["tray_icon"]["mode"], "auto");
    }

    #[test]
    fn backup_antes_de_migrar_e_de_versao_nova() {
        let d = tmp("bak");
        let f = d.join("state.json");
        std::fs::write(&f, r#"{"repos": []}"#).unwrap();
        let (doc, out) = load_json(&f, STATE, STATE_MIGRATIONS).unwrap();
        assert_eq!((out, doc["schema_version"].as_u64()), (Outcome::Migrated { from: 0 }, Some(1)));
        assert_eq!(std::fs::read_to_string(d.join("state.json.v0.bak")).unwrap(), r#"{"repos": []}"#);
        std::fs::write(&f, r#"{"schema_version": 9, "repos": [], "novidade": 1}"#).unwrap();
        let (_, out) = load_json(&f, STATE, STATE_MIGRATIONS).unwrap();
        assert_eq!(out, Outcome::Newer { found: 9 });
        assert!(d.join("state.json.v9.bak").is_file());
        assert!(load_json(&d.join("nao-existe.json"), STATE, STATE_MIGRATIONS).is_none());
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn handshake() {
        assert_eq!(compat(Some("0.9.0"), Some(PROTOCOL), Some(MIN_PEER_PROTOCOL)), Compat::Ok);
        // Cliente de antes do handshake (sem campos) fala o protocolo 1.
        assert_eq!(compat(None, None, None), Compat::Ok);
        assert!(matches!(compat(Some("0.1.0"), Some(0), None), Compat::PeerOutdated { peer_protocol: 0, .. }));
        let c = compat(Some("3.0.0"), Some(PROTOCOL + 5), Some(PROTOCOL + 1));
        assert!(matches!(c, Compat::SelfOutdated { peer_min_protocol, .. } if peer_min_protocol == PROTOCOL + 1));
        assert!(compat_message(&c, "o kabuld do Studio").unwrap().contains("Atualize este aparelho"));
        assert!(compat_message(&Compat::Ok, "x").is_none());
        assert_eq!(hello_info("desktop")["protocol"], PROTOCOL);
    }
}
