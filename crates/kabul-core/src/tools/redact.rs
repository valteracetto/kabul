//! Redação de segredos no que vai para a tela: argumentos de MCP, comandos de hook, URLs e campos de
//! frontmatter/manifesto. Variáveis de ambiente nunca saem com valor (só o nome).

pub const MASK: &str = "•••";

/// A chave parece guardar segredo.
pub fn secret_key(k: &str) -> bool {
    let k = k.to_ascii_lowercase().replace(['-', '.'], "_");
    ["token", "secret", "password", "passwd", "apikey", "api_key", "auth", "bearer", "credential", "cookie", "private_key", "access_key", "session"].iter().any(|s| k.contains(s)) || k == "key" || k.ends_with("_key") || k.ends_with("_pat")
}

/// Parece um segredo solto: comprido, sem espaço, misturando letras e dígitos (ou prefixos conhecidos).
pub fn looks_secret(s: &str) -> bool {
    let s = s.trim_matches(|c| c == '"' || c == '\'');
    let known = ["sk-", "sk_", "ghp_", "gho_", "github_pat_", "xox", "AKIA", "AIza", "glpat-", "eyJ", "pk_live", "rk_live", "ntn_", "secret_"];
    if s.len() >= 12 && known.iter().any(|p| s.starts_with(p)) {
        return true;
    }
    if s.len() < 28 || s.contains('/') || (s.contains('.') && !s.contains("eyJ")) {
        return false;
    }
    let ok = s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '=' || c == '+');
    ok && s.chars().any(|c| c.is_ascii_digit()) && s.chars().any(|c| c.is_ascii_alphabetic())
}

/// Valor de um campo `chave: valor`.
pub fn value(k: &str, v: &str) -> String {
    if secret_key(k) && !v.is_empty() && !placeholder(v) {
        return MASK.into();
    }
    command(v)
}

/// URL sem usuário/senha e sem valores de parâmetros sensíveis.
pub fn url(u: &str) -> String {
    let (scheme, rest) = match u.split_once("://") {
        Some((s, r)) => (format!("{s}://"), r),
        None => (String::new(), u),
    };
    let (auth_host, tail) = match rest.find(['/', '?', '#']) {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    let host = match auth_host.rsplit_once('@') {
        Some((_, h)) => format!("{MASK}@{h}"),
        None => auth_host.to_string(),
    };
    let tail = match tail.split_once('?') {
        Some((path, q)) => {
            let q: Vec<String> = q
                .split('&')
                .map(|kv| match kv.split_once('=') {
                    Some((k, v)) if secret_key(k) || looks_secret(v) => format!("{k}={MASK}"),
                    _ => kv.to_string(),
                })
                .collect();
            format!("{path}?{}", q.join("&"))
        }
        None => tail.to_string(),
    };
    format!("{scheme}{host}{tail}")
}

/// Linha de comando com segredos trocados por [`MASK`] (flags `--token X`, `--key=X`, `VAR=X`,
/// `Bearer X`, URLs e strings com cara de chave).
pub fn command(cmd: &str) -> String {
    let mut out: Vec<String> = vec![];
    let mut mask_next = false;
    for tok in cmd.split(' ') {
        if mask_next && !tok.is_empty() {
            out.push(MASK.into());
            mask_next = false;
            continue;
        }
        let bare = tok.trim_matches(|c| c == '"' || c == '\'');
        let t = if let Some((k, _)) = bare.split_once('=').filter(|(k, v)| !v.is_empty() && (secret_key(k.trim_start_matches('-')))) {
            format!("{k}={MASK}")
        } else if (bare.starts_with("--") && secret_key(bare.trim_start_matches('-')) && !bare.contains('=')) || bare.eq_ignore_ascii_case("bearer") || bare.eq_ignore_ascii_case("authorization:") {
            mask_next = true;
            tok.to_string()
        } else if bare.contains("://") {
            url(bare)
        } else if looks_secret(bare) {
            MASK.into()
        } else {
            tok.to_string()
        };
        out.push(t);
    }
    out.join(" ")
}

/// Texto de exemplo esquecido na config (`YOUR_API_KEY_HERE`, `<your-token>`, `REPLACE_ME`).
pub fn placeholder(v: &str) -> bool {
    let u = v.to_ascii_uppercase();
    (u.contains("YOUR_") && u.contains("_HERE")) || u.contains("<YOUR") || u.contains("REPLACE_ME") || u.contains("YOUR-API-KEY") || u.contains("CHANGEME") || u.contains("<INSERT")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segredos_somem() {
        assert_eq!(command("npx -y srv --token abc123 --api-key=zzz"), format!("npx -y srv --token {MASK} --api-key={MASK}"));
        assert_eq!(command("env GITHUB_TOKEN=ghp_123456789012345 node x.js"), format!("env GITHUB_TOKEN={MASK} node x.js")); // gitleaks:allow (token falso do teste)
        assert_eq!(command("curl -H Bearer eyJhbGciOiJIUzI1NiJ9xyz"), format!("curl -H Bearer {MASK}"));
        assert!(!command("run sk-proj-aaaaaaaaaaaaaaaaaaaaaaaa").contains("sk-proj"));
        assert_eq!(url("https://user:pw@mcp.example.com/sse?api_key=123&x=1"), format!("https://{MASK}@mcp.example.com/sse?api_key={MASK}&x=1"));
        assert_eq!(command("/usr/local/bin/tool --mode fast ./a/b"), "/usr/local/bin/tool --mode fast ./a/b");
        assert_eq!(value("apiKey", "123"), MASK);
        assert_eq!(value("apiKey", "YOUR_API_KEY_HERE"), "YOUR_API_KEY_HERE");
        assert_eq!(value("description", "Faz x"), "Faz x");
        assert!(placeholder("YOUR_NOTION_TOKEN_HERE") && placeholder("<your-key>") && !placeholder("abc"));
    }
}
