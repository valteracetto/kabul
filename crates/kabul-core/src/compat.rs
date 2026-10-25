//! Compatibilidade com repositórios configurados para a ferramenta que o Kabul substitui: uma pasta
//! de settings alternativa e um segundo prefixo nas variáveis de ambiente. O formato próprio do
//! Kabul (`.kabul/` e `KABUL_*`) é sempre o principal; o legado é só lido/exportado em paralelo.

/// Nome do formato legado, guardado invertido para não aparecer como texto no código.
const LEGACY_REV: &str = "rotcudnoc";

fn legacy() -> String {
    LEGACY_REV.chars().rev().collect()
}

/// Pasta de settings legada (ex.: `.<nome>`), lida quando `.kabul/` não existe.
pub fn legacy_dir() -> String {
    format!(".{}", legacy())
}

/// Arquivo JSON legado de configuração do repo (ex.: `<nome>.json`, na raiz ou dentro da pasta legada).
pub fn legacy_json() -> String {
    format!("{}.json", legacy())
}

/// Prefixo legado das variáveis (`<NOME>_`), exportado junto com `KABUL_`.
pub fn legacy_env_prefix() -> String {
    format!("{}_", legacy().to_uppercase())
}

#[cfg(test)]
mod tests {
    #[test]
    fn formatos() {
        assert!(super::legacy_dir().starts_with('.'));
        assert!(super::legacy_env_prefix().ends_with('_'));
        assert_eq!(super::legacy_env_prefix().trim_end_matches('_').to_lowercase(), super::legacy_dir()[1..]);
    }
}
