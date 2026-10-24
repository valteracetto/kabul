//! Ambiente do shell de login para o app aberto pelo Dock/Finder. Um app de interface herda um
//! ambiente mínimo (PATH curto, sem LANG): CLIs com `#!/usr/bin/env node` não acham o node, e o tmux
//! sem locale UTF-8 troca o TAB do formato por "_". Aqui lemos `env` de um shell de login uma vez e
//! completamos o ambiente do processo (PATH do shell primeiro; o resto só se não existir).
use std::collections::BTreeMap;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Variáveis do shell que não fazem sentido copiar para o app.
const SKIP: &[&str] = &["PWD", "OLDPWD", "SHLVL", "_", "TERM_SESSION_ID", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "TMUX", "TMUX_PANE", "ITERM_SESSION_ID", "COLUMNS", "LINES"];

/// Parse de `env -0` (pares `K=V` separados por NUL).
pub fn parse_env0(out: &[u8]) -> BTreeMap<String, String> {
    out.split(|b| *b == 0)
        .filter_map(|kv| {
            let s = String::from_utf8_lossy(kv);
            let (k, v) = s.split_once('=')?;
            (!k.is_empty() && !k.contains(char::is_whitespace)).then(|| (k.to_string(), v.to_string()))
        })
        .collect()
}

/// Lê o ambiente de `$SHELL -l -i -c 'env -0'` (com limite de tempo). `None` se falhar.
#[cfg(unix)]
pub fn read_login_env(timeout: Duration) -> Option<BTreeMap<String, String>> {
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".into());
    let mut child = Command::new(&shell).args(["-l", "-i", "-c", "env -0"]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => return None,
        }
    }
    let mut out = vec![];
    std::io::Read::read_to_end(&mut child.stdout.take()?, &mut out).ok()?;
    let env = parse_env0(&out);
    env.contains_key("PATH").then_some(env)
}

#[cfg(not(unix))]
pub fn read_login_env(_timeout: Duration) -> Option<BTreeMap<String, String>> {
    None
}

/// O que aplicar ao processo: PATH do shell (mais as pastas extras), LANG UTF-8 garantido, e as
/// demais variáveis do shell que ainda não existem.
pub fn merge(current: &BTreeMap<String, String>, shell: Option<&BTreeMap<String, String>>, extra_path: &[String]) -> Vec<(String, String)> {
    let mut out = vec![];
    let mut path: Vec<String> = vec![];
    for p in shell.and_then(|s| s.get("PATH")).into_iter().chain(current.get("PATH")).flat_map(|p| p.split(':')).map(String::from).chain(extra_path.iter().cloned()) {
        if !p.is_empty() && !path.contains(&p) {
            path.push(p);
        }
    }
    out.push(("PATH".into(), path.join(":")));
    if let Some(sh) = shell {
        for (k, v) in sh {
            if k != "PATH" && !SKIP.contains(&k.as_str()) && !current.contains_key(k) {
                out.push((k.clone(), v.clone()));
            }
        }
    }
    let has_utf8 = |m: &BTreeMap<String, String>| ["LC_ALL", "LC_CTYPE", "LANG"].iter().any(|k| m.get(*k).is_some_and(|v| v.to_uppercase().contains("UTF-8") || v.to_uppercase().contains("UTF8")));
    let after: BTreeMap<String, String> = current.clone().into_iter().chain(out.clone()).collect();
    if !has_utf8(&after) {
        out.push(("LANG".into(), "en_US.UTF-8".into()));
    }
    out
}

/// Aplica ao processo atual (chamar no início do `main`, antes de criar threads).
pub fn apply(extra_path: &[String]) {
    let current: BTreeMap<String, String> = std::env::vars().collect();
    let shell = read_login_env(Duration::from_secs(4));
    for (k, v) in merge(&current, shell.as_ref(), extra_path) {
        std::env::set_var(k, v);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mescla_path_lang_e_resto() {
        let sh = parse_env0(b"PATH=/home/dev/.nvm/bin:/usr/bin\0LANG=pt_BR.UTF-8\0NVM_DIR=/home/dev/.nvm\0PWD=/x\0HOME=/outra\0");
        assert_eq!(sh["NVM_DIR"], "/home/dev/.nvm");
        let cur: BTreeMap<String, String> = [("PATH".to_string(), "/usr/bin:/bin".to_string()), ("HOME".to_string(), "/home/dev".to_string())].into();
        let m: BTreeMap<String, String> = merge(&cur, Some(&sh), &["/opt/homebrew/bin".into()]).into_iter().collect();
        assert_eq!(m["PATH"], "/home/dev/.nvm/bin:/usr/bin:/bin:/opt/homebrew/bin");
        assert_eq!(m["LANG"], "pt_BR.UTF-8");
        assert_eq!(m["NVM_DIR"], "/home/dev/.nvm");
        assert!(!m.contains_key("PWD") && !m.contains_key("HOME"), "não sobrescreve nem copia PWD");
        // Sem shell e sem locale: garante LANG UTF-8.
        let m2: BTreeMap<String, String> = merge(&cur, None, &[]).into_iter().collect();
        assert_eq!(m2["LANG"], "en_US.UTF-8");
    }
}
