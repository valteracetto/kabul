//! Quem pode chamar o quê. O dono (localhost ou aparelho pareado) pode tudo. Convidados ficam presos
//! ao workspace do convite: observador só lê; editor também manda mensagem, aprova e digita.
use crate::auth::{Principal, Role};
use anyhow::{bail, Result};

/// Leitura liberada a convidados (dentro do workspace deles).
const GUEST_READ: &[&str] = &[
    "whoami",
    "live_sessions",
    "workspaces_list",
    "repos_list",
    "repo_avatar",
    "machine_info",
    "models_list",
    "chat_list",
    "chat_transcript",
    "term_attach",
    "presence_set",
    "presence_list",
    "push_key",
    "push_subscribe",
    "git_status",
    "workspace_changes",
    "workspace_file_diff",
    "file_list",
    "file_url",
    "proxy_ports",
    // Navegador do workspace só para ver (captura atualizada).
    "browser_status",
    "browser_screenshot",
];

/// Escrita liberada ao editor convidado.
const GUEST_WRITE: &[&str] = &["chat_send", "chat_approve", "chat_stop", "chat_queue_remove", "chat_start", "chat_switch", "term_input", "term_keys", "transcribe", "proxy_open"];

/// Comandos sem alvo (listas filtradas pelo próprio hub).
/// `presence_set` confere o escopo no próprio hub (sair do workspace manda `workspaceId` nulo).
const UNTARGETED: &[&str] = &["whoami", "live_sessions", "workspaces_list", "repos_list", "repo_avatar", "machine_info", "models_list", "chat_list", "push_key", "push_subscribe", "presence_set", "transcribe"];

/// `target_ws`: workspace a que o comando se refere (resolvido pelo hub a partir de workspaceId, chatId
/// ou sessão). `None` quando o comando não tem alvo ou o alvo não pertence a workspace nenhum.
pub fn check(who: &Principal, cmd: &str, target_ws: Option<&str>) -> Result<()> {
    if who.is_owner() {
        return Ok(());
    }
    let allowed = GUEST_READ.contains(&cmd) || (who.role == Role::Editor && GUEST_WRITE.contains(&cmd));
    if !allowed {
        if GUEST_WRITE.contains(&cmd) {
            bail!("observadores só acompanham: peça ao dono para te convidar como editor");
        }
        bail!("sem permissão para {cmd}");
    }
    if UNTARGETED.contains(&cmd) {
        return Ok(());
    }
    if !who.scope.allows_workspace(target_ws) {
        bail!("fora do workspace compartilhado com você");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::Scope;

    fn p(role: Role) -> Principal {
        Principal { id: "d".into(), user: "x".into(), device: "y".into(), role, scope: Scope::Workspace { id: "w1".into() }, color: String::new() }
    }

    #[test]
    fn papeis() {
        let dono = Principal::local_owner("dev");
        assert!(check(&dono, "device_revoke", None).is_ok());
        let obs = p(Role::Observer);
        assert!(check(&obs, "chat_transcript", Some("w1")).is_ok());
        assert!(check(&obs, "term_attach", Some("w1")).is_ok());
        assert!(check(&obs, "chat_send", Some("w1")).unwrap_err().to_string().contains("observadores"));
        assert!(check(&obs, "term_input", Some("w1")).is_err());
        let ed = p(Role::Editor);
        assert!(check(&ed, "chat_send", Some("w1")).is_ok());
        assert!(check(&ed, "chat_approve", Some("w1")).is_ok());
        assert!(check(&ed, "chat_send", Some("w2")).is_err(), "outro workspace");
        assert!(check(&ed, "term_input", None).is_err(), "sessão fora de workspace");
        assert!(check(&ed, "pair_create", None).is_err());
        assert!(check(&ed, "invite_create", Some("w1")).is_err());
        assert!(check(&ed, "workspace_archive", Some("w1")).is_err());
        // Uso, custos e limites são do dono (contas e gastos dele).
        for c in ["usage_overview", "usage_csv", "usage_refresh"] {
            assert!(check(&ed, c, Some("w1")).is_err(), "{c}");
            assert!(check(&dono, c, None).is_ok(), "{c}");
        }
        for c in ["workspace_create", "workspace_update", "workspace_unarchive", "accounts_list", "account_update", "cloud_start"] {
            assert!(check(&ed, c, Some("w1")).is_err(), "{c} é só do dono");
        }
        assert!(check(&ed, "live_sessions", None).is_ok());
        assert!(check(&obs, "file_url", Some("w1")).is_ok(), "observador vê arquivos do workspace dele");
        assert!(check(&obs, "file_url", Some("w2")).is_err());
        assert!(check(&obs, "file_list", None).is_err());
        assert!(check(&obs, "proxy_ports", Some("w1")).is_ok());
        assert!(check(&obs, "proxy_open", Some("w1")).is_err(), "abrir o app (que pode escrever) é de editor");
        assert!(check(&ed, "proxy_open", Some("w1")).is_ok());
        assert!(check(&ed, "proxy_open", Some("w2")).is_err());
        // Avatar do repo: leitura (o hub confere o repo do workspace); mudar o repo é do dono.
        assert!(check(&obs, "repo_avatar", None).is_ok());
        assert!(check(&ed, "repo_update", Some("w1")).is_err());
        assert!(check(&dono, "repo_update", None).is_ok());
    }
}
