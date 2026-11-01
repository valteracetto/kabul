//! Raízes do scan, injetáveis: pasta pessoal, `%APPDATA%`, `$XDG_CONFIG_HOME`, sistema e as
//! variáveis que movem a config de cada IA. Nada no scan chama `paths::home()` direto: os testes
//! montam um home sintético (inclusive "Windows" em qualquer sistema) e o app passa o de verdade.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub struct Roots {
    pub home: PathBuf,
    /// `%APPDATA%` (Windows). Fora do Windows fica `None`.
    pub appdata: Option<PathBuf>,
    /// `$XDG_CONFIG_HOME` (padrão `~/.config`).
    pub xdg_config: Option<PathBuf>,
    /// `macos` | `windows` | `linux` ...
    pub os: String,
    /// Variáveis que movem pastas de IA (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, ...), só as definidas.
    pub env: BTreeMap<String, PathBuf>,
    /// Pasta de estado do Kabul (contas isoladas, cache e preferências).
    pub state: PathBuf,
}

impl Roots {
    /// Raízes do processo atual.
    pub fn from_env(state: &Path) -> Self {
        let mut env = BTreeMap::new();
        for p in super::providers::PROVIDERS {
            if let Some(var) = p.env {
                if let Some(v) = std::env::var_os(var).filter(|v| !v.is_empty()) {
                    env.insert(var.to_string(), PathBuf::from(v));
                }
            }
        }
        for var in ["npm_config_prefix", "NPM_CONFIG_PREFIX", "UV_TOOL_DIR"] {
            if let Some(v) = std::env::var_os(var).filter(|v| !v.is_empty()) {
                env.insert(var.to_string(), PathBuf::from(v));
            }
        }
        Self {
            home: crate::paths::home(),
            appdata: std::env::var_os("APPDATA").map(PathBuf::from).filter(|p| !p.as_os_str().is_empty()),
            xdg_config: std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).filter(|p| p.is_absolute()),
            os: std::env::consts::OS.to_string(),
            env,
            state: state.to_path_buf(),
        }
    }

    /// Raízes sintéticas de um sistema (testes; `windows` funciona em qualquer SO).
    pub fn for_os(os: &str, home: &Path) -> Self {
        let appdata = (os == "windows").then(|| home.join("AppData").join("Roaming"));
        Self { home: home.to_path_buf(), appdata, xdg_config: None, os: os.into(), env: BTreeMap::new(), state: home.join(".kabul-state") }
    }

    /// `~/.config` (ou `$XDG_CONFIG_HOME`). No Windows as CLIs em Node também usam `~/.config`.
    pub fn config(&self) -> PathBuf {
        self.xdg_config.clone().unwrap_or_else(|| self.home.join(".config"))
    }

    /// `%APPDATA%` no Windows; nos outros, a pasta de suporte do sistema.
    pub fn appdata(&self) -> PathBuf {
        match self.os.as_str() {
            "windows" => self.appdata.clone().unwrap_or_else(|| self.home.join("AppData").join("Roaming")),
            "macos" => self.home.join("Library").join("Application Support"),
            _ => self.config(),
        }
    }

    /// Resolve um caminho da tabela: `~/x`, `$CONFIG/x`, `$APPDATA/x` (com `/` como separador).
    pub fn resolve(&self, spec: &str) -> PathBuf {
        let (base, rest) = if let Some(r) = spec.strip_prefix("~/") {
            (self.home.clone(), r)
        } else if let Some(r) = spec.strip_prefix("$CONFIG/") {
            (self.config(), r)
        } else if let Some(r) = spec.strip_prefix("$APPDATA/") {
            (self.appdata(), r)
        } else if spec == "~" {
            return self.home.clone();
        } else {
            return PathBuf::from(spec);
        };
        rest.split('/').filter(|s| !s.is_empty()).fold(base, |p, s| p.join(s))
    }

    /// Caminho para exibir: `~` no lugar da pasta pessoal, sempre com `/`.
    pub fn display(&self, p: &Path) -> String {
        let s = match p.strip_prefix(&self.home) {
            Ok(rest) if !self.home.as_os_str().is_empty() => {
                if rest.as_os_str().is_empty() {
                    "~".to_string()
                } else {
                    format!("~/{}", rest.display())
                }
            }
            _ => p.display().to_string(),
        };
        s.replace('\\', "/")
    }

    /// Volta do caminho exibido para o absoluto.
    pub fn expand(&self, shown: &str) -> PathBuf {
        match shown.strip_prefix("~/") {
            Some(rest) => rest.split('/').fold(self.home.clone(), |p, s| p.join(s)),
            None if shown == "~" => self.home.clone(),
            None => PathBuf::from(shown),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caminhos_por_sistema() {
        let w = Roots::for_os("windows", Path::new("C:/Users/dev"));
        assert_eq!(w.resolve("$APPDATA/npm"), Path::new("C:/Users/dev").join("AppData").join("Roaming").join("npm"));
        assert_eq!(w.resolve("~/.claude/skills"), Path::new("C:/Users/dev").join(".claude").join("skills"));
        let m = Roots::for_os("macos", Path::new("/Users/dev"));
        assert_eq!(m.resolve("$APPDATA/Code/User"), Path::new("/Users/dev/Library/Application Support/Code/User"));
        assert_eq!(m.resolve("$CONFIG/opencode"), Path::new("/Users/dev/.config/opencode"));
        assert_eq!(m.display(Path::new("/Users/dev/.agents/skills")), "~/.agents/skills");
        assert_eq!(m.display(Path::new("/opt/x")), "/opt/x");
        assert_eq!(m.expand("~/.agents/skills"), Path::new("/Users/dev/.agents/skills"));
        let l = Roots { xdg_config: Some("/x/cfg".into()), ..Roots::for_os("linux", Path::new("/home/dev")) };
        assert_eq!(l.resolve("$CONFIG/goose/skills"), Path::new("/x/cfg/goose/skills"));
        assert_eq!(l.resolve("$APPDATA/Code/User"), Path::new("/x/cfg/Code/User"));
    }
}
