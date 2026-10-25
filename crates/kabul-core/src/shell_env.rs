//! Ambiente do shell de login para o app aberto pelo Dock/Finder. Um app de interface herda um
//! ambiente mínimo (PATH curto, sem LANG): CLIs com `#!/usr/bin/env node` não acham o node, e o tmux
//! sem locale UTF-8 troca o TAB do formato por "_". Aqui lemos `env` de um shell de login uma vez e
//! completamos o ambiente do processo (PATH do shell primeiro; o resto só se não existir).
//!
//! No Windows não há shell de login: o app herda o ambiente do Explorer, que fica velho quando um CLI
//! é instalado depois do login. Lemos o PATH do usuário e do sistema direto do registro
//! (`HKCU\Environment` e `HKLM\...\Session Manager\Environment`, com `%VAR%` expandidas).
use std::collections::BTreeMap;
use std::time::Duration;

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
    use std::process::Stdio;
    use std::time::Instant;
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".into());
    let mut child = crate::shell::command(&shell).args(["-l", "-i", "-c", "env -0"]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
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

/// Windows: PATH do sistema + do usuário, do registro (o que um terminal novo enxergaria).
#[cfg(windows)]
pub fn read_login_env(_timeout: Duration) -> Option<BTreeMap<String, String>> {
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    let system = reg_string(HKEY_LOCAL_MACHINE, "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", "Path");
    let user = reg_string(HKEY_CURRENT_USER, "Environment", "Path");
    let path: Vec<String> = [system, user].into_iter().flatten().filter(|p| !p.is_empty()).collect();
    (!path.is_empty()).then(|| BTreeMap::from([("PATH".to_string(), path.join(";"))]))
}

/// Valor texto do registro (REG_SZ ou REG_EXPAND_SZ, já expandido).
#[cfg(windows)]
fn reg_string(root: windows_sys::Win32::System::Registry::HKEY, key: &str, name: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_SZ};
    let wide = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
    let (key, name) = (wide(key), wide(name));
    let mut size: u32 = 0;
    for _ in 0..3 {
        let mut buf = vec![0u16; (size as usize / 2).max(256) + 1];
        let mut len = (buf.len() * 2) as u32;
        let r = unsafe { RegGetValueW(root, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut len) };
        match r {
            0 => {
                let end = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
                return Some(String::from_utf16_lossy(&buf[..end]));
            }
            // ERROR_MORE_DATA: tenta de novo com o tamanho pedido.
            234 => size = len.max(size * 2),
            _ => return None,
        }
    }
    None
}

#[cfg(not(any(unix, windows)))]
pub fn read_login_env(_timeout: Duration) -> Option<BTreeMap<String, String>> {
    None
}

/// Separador do PATH (`;` no Windows, `:` no resto).
pub const PATH_SEP: char = if cfg!(windows) { ';' } else { ':' };

/// Valor de uma variável sem diferenciar maiúsculas no Windows (lá o PATH vem como `Path`).
fn get<'a>(m: &'a BTreeMap<String, String>, key: &str) -> Option<&'a String> {
    m.get(key).or_else(|| if cfg!(windows) { m.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v) } else { None })
}

/// O que aplicar ao processo: PATH do shell (mais as pastas extras), LANG UTF-8 garantido, e as
/// demais variáveis do shell que ainda não existem.
pub fn merge(current: &BTreeMap<String, String>, shell: Option<&BTreeMap<String, String>>, extra_path: &[String]) -> Vec<(String, String)> {
    let mut out = vec![];
    let mut path: Vec<String> = vec![];
    let same = |a: &str, b: &str| if cfg!(windows) { a.trim_end_matches('\\').eq_ignore_ascii_case(b.trim_end_matches('\\')) } else { a == b };
    for p in shell.and_then(|s| get(s, "PATH")).into_iter().chain(get(current, "PATH")).flat_map(|p| p.split(PATH_SEP)).map(String::from).chain(extra_path.iter().cloned()) {
        if !p.is_empty() && !path.iter().any(|x| same(x, &p)) {
            path.push(p);
        }
    }
    out.push(("PATH".into(), path.join(&PATH_SEP.to_string())));
    if let Some(sh) = shell {
        for (k, v) in sh {
            if !k.eq_ignore_ascii_case("PATH") && !SKIP.contains(&k.as_str()) && get(current, k).is_none() {
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
        let j = |v: &[&str]| v.join(&PATH_SEP.to_string());
        let env0 = format!("PATH={}\0LANG=pt_BR.UTF-8\0NVM_DIR=/home/dev/.nvm\0PWD=/x\0HOME=/outra\0", j(&["/home/dev/.nvm/bin", "/usr/bin"]));
        let sh = parse_env0(env0.as_bytes());
        assert_eq!(sh["NVM_DIR"], "/home/dev/.nvm");
        let cur: BTreeMap<String, String> = [("PATH".to_string(), j(&["/usr/bin", "/bin"])), ("HOME".to_string(), "/home/dev".to_string())].into();
        let m: BTreeMap<String, String> = merge(&cur, Some(&sh), &["/opt/homebrew/bin".into()]).into_iter().collect();
        assert_eq!(m["PATH"], j(&["/home/dev/.nvm/bin", "/usr/bin", "/bin", "/opt/homebrew/bin"]));
        assert_eq!(m["LANG"], "pt_BR.UTF-8");
        assert_eq!(m["NVM_DIR"], "/home/dev/.nvm");
        assert!(!m.contains_key("PWD") && !m.contains_key("HOME"), "não sobrescreve nem copia PWD");
        // Sem shell e sem locale: garante LANG UTF-8.
        let m2: BTreeMap<String, String> = merge(&cur, None, &[]).into_iter().collect();
        assert_eq!(m2["LANG"], "en_US.UTF-8");
    }

    /// No Windows o PATH do processo vem como `Path` e caminhos repetem com outra caixa.
    #[cfg(windows)]
    #[test]
    fn path_do_windows() {
        let cur: BTreeMap<String, String> = [("Path".to_string(), "C:\\Windows;C:\\Tools\\".to_string())].into();
        let reg: BTreeMap<String, String> = [("PATH".to_string(), "c:\\windows;C:\\Users\\dev\\AppData\\Roaming\\npm".to_string())].into();
        let m: BTreeMap<String, String> = merge(&cur, Some(&reg), &["C:\\tools".into()]).into_iter().collect();
        assert_eq!(m["PATH"], "c:\\windows;C:\\Users\\dev\\AppData\\Roaming\\npm;C:\\Tools\\");
        assert!(read_login_env(Duration::from_secs(1)).is_some_and(|e| e["PATH"].to_lowercase().contains("system32")));
    }
}
