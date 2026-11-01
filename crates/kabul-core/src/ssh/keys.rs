//! Chaves em `~/.ssh`: caminho, tipo, bits e impressão digital, tirados só do `.pub` (público). A chave
//! privada nunca é aberta: aparece pelo nome do arquivo ao lado do `.pub` (ou `id_*` sem `.pub`).
//! A impressão digital é a mesma do `ssh-keygen -lf <arquivo>.pub` (`SHA256:` + base64 sem `=`).
use super::Roots;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct KeyInfo {
    /// Caminho da privada (o que vai no `IdentityFile`), mesmo se só o `.pub` existir.
    pub path: String,
    pub display: String,
    pub has_private: bool,
    pub has_public: bool,
    /// `ED25519`, `RSA`, `ECDSA`, `ED25519-SK`...
    pub kind: Option<String>,
    pub bits: Option<u32>,
    pub fingerprint: Option<String>,
    pub comment: Option<String>,
}

/// Arquivos do `.ssh` que nunca são chave.
const NOT_KEYS: &[&str] = &["config", "known_hosts", "known_hosts.old", "authorized_keys", "authorized_keys2", "environment", "rc"];

fn b64_decode(s: &str) -> Option<Vec<u8>> {
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32)
    };
    let bytes: Vec<u8> = s.bytes().filter(|c| *c != b'=').collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for ch in bytes.chunks(4) {
        let mut n = 0u32;
        for (i, c) in ch.iter().enumerate() {
            n |= val(*c)? << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if ch.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if ch.len() > 3 {
            out.push(n as u8);
        }
        if ch.len() == 1 {
            return None;
        }
    }
    Some(out)
}

fn b64_encode_nopad(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut o = String::new();
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..=c.len() {
            o.push(T[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    o
}

/// Campo `string` do formato SSH (u32 big-endian + bytes).
fn ssh_string(b: &[u8], at: &mut usize) -> Option<Vec<u8>> {
    let len = u32::from_be_bytes(b.get(*at..*at + 4)?.try_into().ok()?) as usize;
    let v = b.get(*at + 4..*at + 4 + len)?.to_vec();
    *at += 4 + len;
    Some(v)
}

/// Uma linha de `.pub`: tipo, bits, impressão digital e comentário.
pub fn parse_public(line: &str) -> Option<(String, Option<u32>, String, Option<String>)> {
    let mut it = line.split_whitespace();
    let algo = it.next()?;
    let blob = b64_decode(it.next()?)?;
    let comment = it.collect::<Vec<_>>().join(" ");
    let mut at = 0;
    let name = String::from_utf8(ssh_string(&blob, &mut at)?).ok()?;
    if name != algo {
        return None;
    }
    let (kind, bits) = match algo {
        "ssh-ed25519" => ("ED25519", Some(256)),
        "sk-ssh-ed25519@openssh.com" => ("ED25519-SK", Some(256)),
        "ssh-rsa" => {
            let _e = ssh_string(&blob, &mut at)?;
            let n = ssh_string(&blob, &mut at)?;
            let n: Vec<u8> = n.into_iter().skip_while(|b| *b == 0).collect();
            let bits = n.first().map(|f| (n.len() as u32) * 8 - f.leading_zeros()).unwrap_or(0);
            ("RSA", Some(bits))
        }
        a if a.starts_with("ecdsa-sha2-nistp") => ("ECDSA", a.trim_start_matches("ecdsa-sha2-nistp").parse().ok()),
        a if a.starts_with("sk-ecdsa-sha2-nistp") => ("ECDSA-SK", Some(256)),
        "ssh-dss" => ("DSA", Some(1024)),
        _ => (algo, None),
    };
    let fp = format!("SHA256:{}", b64_encode_nopad(&Sha256::digest(&blob)));
    Some((kind.to_string(), bits, fp, (!comment.is_empty()).then_some(comment)))
}

fn info_for(r: &Roots, private: &Path) -> KeyInfo {
    let pubp = private.with_file_name(format!("{}.pub", private.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default()));
    let parsed = std::fs::metadata(&pubp).ok().filter(|m| m.is_file() && m.len() < 16 * 1024).and_then(|_| std::fs::read_to_string(&pubp).ok()).and_then(|t| t.lines().find(|l| !l.trim().is_empty()).and_then(parse_public));
    KeyInfo {
        path: private.display().to_string(),
        display: r.display(private),
        has_private: private.is_file(),
        has_public: pubp.is_file(),
        kind: parsed.as_ref().map(|p| p.0.clone()),
        bits: parsed.as_ref().and_then(|p| p.1),
        fingerprint: parsed.as_ref().map(|p| p.2.clone()),
        comment: parsed.and_then(|p| p.3),
    }
}

/// Chaves do `~/.ssh` (pares `x`/`x.pub` e `id_*` sem `.pub`), em ordem de nome.
pub fn list(r: &Roots) -> Vec<KeyInfo> {
    let Ok(rd) = std::fs::read_dir(&r.ssh_dir) else { return vec![] };
    let mut names: Vec<String> = rd.filter_map(|e| e.ok()).filter(|e| e.file_type().map(|t| t.is_file() || t.is_symlink()).unwrap_or(false)).map(|e| e.file_name().to_string_lossy().to_string()).collect();
    names.sort();
    let set: std::collections::HashSet<&String> = names.iter().collect();
    let mut out = vec![];
    for n in &names {
        if let Some(base) = n.strip_suffix(".pub") {
            out.push(info_for(r, &r.ssh_dir.join(base)));
        } else if n.starts_with("id_") && !n.contains('.') && !set.contains(&format!("{n}.pub")) && !NOT_KEYS.contains(&n.as_str()) {
            out.push(info_for(r, &r.ssh_dir.join(n)));
        }
    }
    out
}

/// Detalhe de um caminho de `IdentityFile` (expande `~` e relativos).
pub fn describe(r: &Roots, identity: &str) -> KeyInfo {
    info_for(r, &r.resolve(identity))
}

/// Nome de arquivo aceito para uma chave nova (`~/.ssh/<nome>`).
pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && !name.starts_with(['.', '-']) && name.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) && !NOT_KEYS.contains(&name) && !name.ends_with(".pub")
}

#[cfg(test)]
mod tests {
    use super::*;

    // Chaves públicas de exemplo (geradas só para o teste; as privadas foram descartadas). As impressões
    // digitais esperadas são as do `ssh-keygen -lf`.
    const ED: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICM5ZkpnYDvSkCUhTH0balNVYswSsmQjiJ5Y1YLQACbn dev@example";
    const RSA: &str = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCxLn1hz5l/RefGZZNFIWCZrsnTFk4Coqs0b3scFWmwiTfiQHpwP2AFu7AhKTyMsjRDMAUQvWVxIBsxIsSTg0P5XT4DoUIPqJrIXnRDlDXVMkT3Up/RShBSp4lzjBRW3e9KOIgxs+JkGELsiKIwqZxGyHcP3eT5V08A7z2QEi/+u4NFw/4WTTZDKaIykFSHyOKweijlNldQN/uxdLTee85JEvVql7tWyFSJsZ/JzErxvS5935SLmkEU51UMDZ39r8ea7VDHbkEAKd4ZATkbnN0h0Vw/8F9Tjz1q++O4yS5JYwNa2vUW1OQTSmR22XA1iNUGt6XBHiVNijW+q0Tw25ssS0mM3zCz/Iaz8hbCyMbyW//ntsKF6ECIFZuITnRq0QSd0GptJ64ygp6lLVDt8xZCk8zwD4y/ahjLAEfJpfHFJjHMPCyKtnV8rAUIA7s8ELhRtm/sbpcnGjw99695I1pANSf7QQn68sGLfpUB+mKGuxhkHF5wk+YV7TT9ZJX0qs8= rsa@example";

    #[test]
    fn impressao_digital_como_o_ssh_keygen() {
        let (kind, bits, fp, comment) = parse_public(ED).unwrap();
        assert_eq!(kind, "ED25519");
        assert_eq!(bits, Some(256));
        assert_eq!(fp, "SHA256:m6vzsXr9Kdn2bnMRntO9NyqNjIquGKKIXlzbEnX9xP4");
        assert_eq!(comment.as_deref(), Some("dev@example"));
        let (kind, bits, fp, _) = parse_public(RSA).unwrap();
        assert_eq!((kind.as_str(), bits), ("RSA", Some(3072)));
        assert_eq!(fp, "SHA256:TIjol4qf8oRqlXTkMSpYL97wGu9uJSafnly6cvh49mY");
        // Base64 da referência (RFC 4648) e sem `=` como o ssh-keygen.
        assert_eq!(b64_encode_nopad(b"foobar"), "Zm9vYmFy");
        assert_eq!(b64_encode_nopad(b"fo"), "Zm8");
        assert_eq!(b64_decode("Zm9vYg==").unwrap(), b"foob");
        assert!(parse_public("ssh-rsa AAAAC3NzaC1lZDI1NTE5AAAAIGq3 x").is_none(), "tipo diferente do blob");
        assert!(parse_public("lixo").is_none());
    }

    #[test]
    fn lista_sem_abrir_a_privada() {
        let home = super::super::tests::tmp_home("keys");
        let ssh = home.join(".ssh");
        std::fs::write(ssh.join("id_ed25519.pub"), format!("{ED}\n")).unwrap();
        // "Privada" ilegível de propósito: se fosse lida, o teste notaria pelo conteúdo no resultado.
        std::fs::write(ssh.join("id_ed25519"), "SEGREDO-NAO-LER").unwrap();
        std::fs::write(ssh.join("id_rsa_velha"), "SEGREDO").unwrap();
        std::fs::write(ssh.join("known_hosts"), "x").unwrap();
        std::fs::write(ssh.join("config"), "Host a\n").unwrap();
        let r = Roots::at(&home);
        let l = list(&r);
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].display, "~/.ssh/id_ed25519");
        assert!(l[0].has_private && l[0].has_public);
        assert_eq!(l[0].kind.as_deref(), Some("ED25519"));
        assert_eq!(l[1].display, "~/.ssh/id_rsa_velha");
        assert!(l[1].kind.is_none() && !l[1].has_public);
        assert!(!format!("{l:?}").contains("SEGREDO"));
        assert!(describe(&r, "~/.ssh/id_ed25519").fingerprint.is_some());
        assert!(valid_name("id_ed25519_kabul") && !valid_name("../x") && !valid_name("config") && !valid_name("-o"));
        let _ = std::fs::remove_dir_all(home);
    }
}
