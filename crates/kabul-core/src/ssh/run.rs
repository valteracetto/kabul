//! O que roda o `ssh` de verdade: valor efetivo (`ssh -G`), teste de conexão e geração de chave. Tudo
//! com prazo: processo que passa do tempo é morto.
use super::{ensure_known, keys, Roots};
use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

/// Saída de um processo com prazo.
pub struct Out {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub ms: u64,
}

/// Roda sem entrada (o ssh não pode parar para perguntar nada) e mata se passar de `timeout`.
pub fn run_with_timeout(mut cmd: std::process::Command, timeout: Duration) -> Result<Out> {
    let t0 = Instant::now();
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().context("não consegui rodar o ssh")?;
    let mut so = child.stdout.take().unwrap();
    let mut se = child.stderr.take().unwrap();
    let ho = std::thread::spawn(move || {
        let mut s = vec![];
        let _ = so.read_to_end(&mut s);
        s
    });
    let he = std::thread::spawn(move || {
        let mut s = vec![];
        let _ = se.read_to_end(&mut s);
        s
    });
    let mut timed_out = false;
    let status = loop {
        if let Some(st) = child.try_wait()? {
            break Some(st);
        }
        if t0.elapsed() >= timeout {
            timed_out = true;
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    // Um neto (ProxyCommand) pode segurar o pipe: não espera a leitura para sempre.
    let join = |h: std::thread::JoinHandle<Vec<u8>>| {
        let t = Instant::now();
        while !h.is_finished() && t.elapsed() < Duration::from_secs(1) {
            std::thread::sleep(Duration::from_millis(10));
        }
        if h.is_finished() {
            String::from_utf8_lossy(&h.join().unwrap_or_default()).into_owned()
        } else {
            String::new()
        }
    };
    Ok(Out { code: status.and_then(|s| s.code()), stdout: join(ho), stderr: join(he), timed_out, ms: t0.elapsed().as_millis() as u64 })
}

fn ssh_cmd(r: &Roots) -> Result<std::process::Command> {
    let ssh = r.ssh.as_ref().context("ssh não encontrado (instale o cliente OpenSSH)")?;
    let mut c = crate::shell::command(ssh);
    if r.explicit_config {
        c.arg("-F").arg(&r.config);
    }
    Ok(c)
}

/// Valor efetivo de um host (o que o ssh vai usar, já com `Host *`, `Match` e `Include`).
#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
pub struct Effective {
    pub alias: String,
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub port: Option<String>,
    pub identity_files: Vec<String>,
    pub proxy_jump: Option<String>,
    pub proxy_command: Option<String>,
    pub forward_agent: Option<String>,
    pub error: Option<String>,
}

/// Lê a saída do `ssh -G` (`chave valor`, chaves em minúsculas).
pub fn parse_g(alias: &str, out: &str) -> Effective {
    let mut e = Effective { alias: alias.into(), ..Default::default() };
    for l in out.lines() {
        let Some((k, v)) = l.split_once(' ') else { continue };
        let v = v.trim().to_string();
        match k {
            "hostname" => e.hostname = Some(v),
            "user" => e.user = Some(v),
            "port" => e.port = Some(v),
            "identityfile" => e.identity_files.push(v),
            "proxyjump" if v != "none" => e.proxy_jump = Some(v),
            "proxycommand" if v != "none" => e.proxy_command = Some(v),
            "forwardagent" => e.forward_agent = Some(v),
            _ => {}
        }
    }
    e
}

/// `ssh -G <alias>` (não conecta; pode rodar um `Match exec` do próprio config). Prazo de 3 s.
pub fn effective(r: &Roots, alias: &str) -> Result<Effective> {
    ensure_known(r, alias)?;
    let mut c = ssh_cmd(r)?;
    c.arg("-G").arg("--").arg(alias);
    let o = run_with_timeout(c, Duration::from_secs(3))?;
    if o.timed_out {
        return Ok(Effective { alias: alias.into(), error: Some("timeout".into()), ..Default::default() });
    }
    if o.code != Some(0) {
        return Ok(Effective { alias: alias.into(), error: Some(o.stderr.trim().to_string()), ..Default::default() });
    }
    Ok(parse_g(alias, &o.stdout))
}

/// Vários de uma vez (até 6 em paralelo).
pub fn effective_many(r: &Roots, aliases: &[String]) -> Vec<Effective> {
    let mut out = Vec::with_capacity(aliases.len());
    for chunk in aliases.chunks(6) {
        let hs: Vec<_> = chunk
            .iter()
            .map(|a| {
                let (r, a) = (r.clone(), a.clone());
                std::thread::spawn(move || effective(&r, &a).unwrap_or_else(|e| Effective { alias: a, error: Some(format!("{e:#}")), ..Default::default() }))
            })
            .collect();
        out.extend(hs.into_iter().filter_map(|h| h.join().ok()));
    }
    out
}

/// Resultado do teste de conexão. `kind`: `ok`, `host_key_unknown`, `host_key_changed`,
/// `permission_denied`, `timeout`, `dns`, `refused`, `unreachable`, `passphrase`, `other`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TestResult {
    pub ok: bool,
    pub kind: &'static str,
    /// Erro real do ssh (últimas linhas do stderr, sem os avisos de "Warning: Permanently added").
    pub message: String,
    pub ms: u64,
    pub command: String,
}

/// Classifica o stderr do ssh.
pub fn classify(stderr: &str, timed_out: bool) -> &'static str {
    let s = stderr.to_ascii_lowercase();
    if s.contains("remote host identification has changed") || (s.contains("host key for") && s.contains("has changed")) {
        "host_key_changed"
    } else if s.contains("host key verification failed") || s.contains("host key is known") {
        "host_key_unknown"
    } else if s.contains("could not resolve hostname") || s.contains("name or service not known") || s.contains("nodename nor servname") {
        "dns"
    } else if s.contains("connection refused") {
        "refused"
    } else if timed_out || s.contains("timed out") || s.contains("timeout") {
        "timeout"
    } else if s.contains("no route to host") || s.contains("network is unreachable") || s.contains("host is down") {
        "unreachable"
    } else if s.contains("passphrase") || s.contains("sign_and_send_pubkey") || s.contains("agent refused") {
        "passphrase"
    } else if s.contains("permission denied") || s.contains("too many authentication failures") {
        "permission_denied"
    } else {
        "other"
    }
}

/// `ssh -o BatchMode=yes -o ConnectTimeout=5 <alias> true`: nunca pergunta nada (senha, host novo);
/// quando falha, mostra o erro real do ssh.
pub fn test(r: &Roots, alias: &str) -> Result<TestResult> {
    ensure_known(r, alias)?;
    let mut c = ssh_cmd(r)?;
    c.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-o", "ConnectionAttempts=1", "--", alias, "true"]);
    let o = run_with_timeout(c, Duration::from_secs(15))?;
    let message: String = o.stderr.lines().filter(|l| !l.trim().is_empty() && !l.starts_with("Warning: Permanently added")).collect::<Vec<_>>().join("\n");
    let message = if message.len() > 2000 { message[message.len() - 2000..].to_string() } else { message };
    let ok = !o.timed_out && o.code == Some(0);
    Ok(TestResult { ok, kind: if ok { "ok" } else { classify(&message, o.timed_out) }, message, ms: o.ms, command: format!("ssh -o BatchMode=yes -o ConnectTimeout=5 {} true", crate::harness::shell_quote(alias)) })
}

/// `ssh-keygen -t ed25519` sem senha em `~/.ssh/<name>` (recusa nome existente). Para chave com senha,
/// o usuário roda o `ssh-keygen` num terminal (a senha não passa pelo app).
pub fn keygen(r: &Roots, name: &str, comment: &str) -> Result<keys::KeyInfo> {
    if !keys::valid_name(name) {
        bail!("nome de chave inválido: use letras, números, ponto, _ ou -");
    }
    if comment.chars().any(|c| c.is_control()) || comment.len() > 200 {
        bail!("comentário inválido");
    }
    let path = r.ssh_dir.join(name);
    if path.exists() || path.with_file_name(format!("{name}.pub")).exists() {
        bail!("{} já existe", r.display(&path));
    }
    ensure_ssh_dir(&r.ssh_dir)?;
    let kg = r.keygen.as_ref().context("ssh-keygen não encontrado (instale o cliente OpenSSH)")?;
    let mut c = crate::shell::command(kg);
    c.args(["-q", "-t", "ed25519", "-N", "", "-C", comment, "-f"]).arg(&path);
    let o = run_with_timeout(c, Duration::from_secs(20))?;
    if o.code != Some(0) {
        bail!("ssh-keygen falhou: {}", o.stderr.trim());
    }
    Ok(keys::describe(r, &path.display().to_string()))
}

/// Cria `~/.ssh` com 0700 se faltar.
pub fn ensure_ssh_dir(dir: &Path) -> Result<()> {
    if !dir.exists() {
        std::fs::create_dir_all(dir).with_context(|| format!("criar {}", dir.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn erros_reais_do_ssh() {
        assert_eq!(classify("No ED25519 host key is known for x and you have requested strict checking.\nHost key verification failed.", false), "host_key_unknown");
        assert_eq!(classify("@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@", false), "host_key_changed");
        assert_eq!(classify("dev@192.0.2.1: Permission denied (publickey).", false), "permission_denied");
        assert_eq!(classify("ssh: connect to host 192.0.2.1 port 22: Operation timed out", false), "timeout");
        assert_eq!(classify("ssh: connect to host 192.0.2.1 port 22: Connection timed out", false), "timeout");
        assert_eq!(classify("", true), "timeout");
        assert_eq!(classify("ssh: Could not resolve hostname nada.invalid: nodename nor servname provided, or not known", false), "dns");
        assert_eq!(classify("ssh: connect to host 127.0.0.1 port 2222: Connection refused", false), "refused");
        assert_eq!(classify("ssh: connect to host 10.0.0.1 port 22: No route to host", false), "unreachable");
        assert_eq!(classify("algo novo", false), "other");
    }

    #[test]
    fn ssh_g() {
        let e = parse_g("web", "user dev\nhostname web.example.com\nport 2222\nidentityfile ~/.ssh/id_web\nidentityfile ~/.ssh/id_rsa\nproxyjump none\nforwardagent no\n");
        assert_eq!(e.hostname.as_deref(), Some("web.example.com"));
        assert_eq!(e.port.as_deref(), Some("2222"));
        assert_eq!(e.identity_files.len(), 2);
        assert!(e.proxy_jump.is_none());
        assert_eq!(e.forward_agent.as_deref(), Some("no"));
    }

    #[test]
    fn sem_binario_nao_roda_nada() {
        let home = super::super::tests::tmp_home("run");
        let r = Roots::at(&home);
        std::fs::write(&r.config, "Host a\n  HostName 192.0.2.1\n").unwrap();
        assert!(test(&r, "a").is_err());
        assert!(effective(&r, "a").is_err());
        assert!(keygen(&r, "id_x", "dev").is_err());
        assert!(keygen(&r, "../fora", "dev").is_err());
        assert!(effective_many(&r, &["a".into()])[0].error.is_some());
        let _ = std::fs::remove_dir_all(home);
    }

    #[cfg(unix)]
    #[test]
    fn prazo_mata_o_processo() {
        let mut c = std::process::Command::new("sleep");
        c.arg("5");
        let o = run_with_timeout(c, Duration::from_millis(200)).unwrap();
        assert!(o.timed_out && o.ms < 3000);
    }
}
