//! Shells por plataforma: zsh/bash/sh no macOS e Linux; PowerShell (pwsh ou Windows PowerShell), cmd e
//! Git Bash no Windows. Monta a linha de comando de cada um (aspas, código de saída, log) sem concatenar
//! o ambiente: as variáveis vão pela API do processo.
//!
//! Escolha: `KABUL_SHELL` (caminho ou nome) para o terminal interativo; `KABUL_SCRIPT_SHELL` para os
//! scripts do `settings.toml` (escritos em sh). Sem eles: no Windows o terminal abre no PowerShell e os
//! scripts rodam no Git Bash quando ele existe (senão no PowerShell); no Unix, `$SHELL`.
use crate::harness::{shell_quote, which, CmdSpec};
use std::path::PathBuf;

/// `Command` para rodar em segundo plano. No Windows, com `CREATE_NO_WINDOW`: sem isso cada `git`,
/// `gh` ou agente aberto pelo app (que não tem console) pisca uma janela de console. Para um processo
/// interativo no terminal do usuário (CLI), use `std::process::Command` direto.
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellKind {
    /// sh, bash (inclusive o Git Bash), zsh, fish...
    Posix,
    /// `pwsh` (PowerShell 7) ou `powershell` (Windows PowerShell 5.1).
    PowerShell,
    Cmd,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shell {
    pub kind: ShellKind,
    pub program: String,
}

fn base(p: &str) -> String {
    let b = p.rsplit(['/', '\\']).next().unwrap_or(p).to_ascii_lowercase();
    b.strip_suffix(".exe").map(String::from).unwrap_or(b)
}

/// Caminhos comuns do Git Bash (o `bash.exe` do PATH pode ser o do WSL, que não enxerga `C:\`).
fn git_bash() -> Option<PathBuf> {
    let mut v: Vec<PathBuf> = vec![];
    for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Some(d) = std::env::var_os(var).map(PathBuf::from) {
            v.push(d.join("Git").join("bin").join("bash.exe"));
            v.push(d.join("Programs").join("Git").join("bin").join("bash.exe"));
        }
    }
    v.into_iter().find(|p| p.is_file())
}

impl Shell {
    pub fn from_program(program: &str) -> Shell {
        let kind = match base(program).as_str() {
            "pwsh" | "powershell" => ShellKind::PowerShell,
            "cmd" => ShellKind::Cmd,
            _ => ShellKind::Posix,
        };
        Shell { kind, program: program.to_string() }
    }

    fn from_env(var: &str) -> Option<Shell> {
        let v = std::env::var(var).ok().filter(|s| !s.trim().is_empty())?;
        let resolved = if v == "git-bash" || v == "gitbash" { git_bash()?.display().to_string() } else { which(&v).map(|p| p.display().to_string()).unwrap_or(v) };
        Some(Shell::from_program(&resolved))
    }

    /// PowerShell 7 se instalado; senão o Windows PowerShell (sempre presente); senão cmd.
    fn windows_default() -> Shell {
        for p in ["pwsh", "powershell"] {
            if let Some(path) = which(p) {
                return Shell::from_program(&path.display().to_string());
            }
        }
        let cmd = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into());
        Shell::from_program(&cmd)
    }

    /// Shell do terminal interativo.
    pub fn interactive() -> Shell {
        if let Some(s) = Self::from_env("KABUL_SHELL") {
            return s;
        }
        if cfg!(windows) {
            return Self::windows_default();
        }
        let sh = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/sh".into());
        Shell::from_program(&sh)
    }

    /// Shell dos scripts (setup/run/archive, instalação de CLIs, nuvem).
    pub fn for_scripts() -> Shell {
        if let Some(s) = Self::from_env("KABUL_SCRIPT_SHELL") {
            return s;
        }
        if cfg!(windows) {
            return git_bash().map(|p| Shell::from_program(&p.display().to_string())).unwrap_or_else(Self::windows_default);
        }
        Self::interactive()
    }

    /// Argumentos do shell interativo (de login, quando o shell tem isso).
    pub fn interactive_args(&self) -> Vec<String> {
        match self.kind {
            ShellKind::Posix => vec!["-l".into()],
            ShellKind::PowerShell => vec!["-NoLogo".into()],
            ShellKind::Cmd => vec![],
        }
    }

    /// Argumentos para rodar `line`. `keep_open`: depois do comando, fica no shell interativo.
    pub fn run_args(&self, line: &str, keep_open: bool) -> Vec<String> {
        match (self.kind, keep_open) {
            // `$0` é o próprio shell (passado depois da linha): reabre o mesmo, de login.
            (ShellKind::Posix, true) => vec!["-lc".into(), format!("{line}; exec \"$0\" -l"), self.program.clone()],
            (ShellKind::Posix, false) => vec!["-lc".into(), line.into()],
            (ShellKind::PowerShell, true) => vec!["-NoLogo".into(), "-NoExit".into(), "-Command".into(), line.into()],
            (ShellKind::PowerShell, false) => vec!["-NoLogo".into(), "-Command".into(), line.into()],
            (ShellKind::Cmd, true) => vec!["/K".into(), line.into()],
            (ShellKind::Cmd, false) => vec!["/C".into(), line.into()],
        }
    }

    /// Uma palavra com as aspas do shell.
    pub fn quote(&self, s: &str) -> String {
        match self.kind {
            ShellKind::Posix => shell_quote(s),
            ShellKind::PowerShell => {
                if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_./\\:=+,".contains(c)) {
                    s.to_string()
                } else {
                    format!("'{}'", s.replace('\'', "''"))
                }
            }
            ShellKind::Cmd => {
                if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_./\\:=+,".contains(c)) {
                    s.to_string()
                } else {
                    format!("\"{}\"", s.replace('"', "\"\""))
                }
            }
        }
    }

    /// Programa + argumentos como uma linha deste shell (o ambiente do `CmdSpec` fica de fora: vai pela API).
    pub fn join(&self, spec: &CmdSpec) -> String {
        let prog = self.quote(&spec.program);
        let args: Vec<String> = spec.args.iter().map(|a| self.quote(a)).collect();
        let head = if self.kind == ShellKind::PowerShell { format!("& {prog}") } else { prog };
        std::iter::once(head).chain(args).collect::<Vec<_>>().join(" ")
    }

    /// Roda `line`, mostra `[kabul] saiu com N` (lido pela nuvem e pela UI) e, com `log`, grava a saída
    /// no arquivo também.
    pub fn script_line(&self, line: &str, log: Option<&std::path::Path>) -> String {
        match (self.kind, log) {
            (ShellKind::Posix, Some(l)) => {
                let q = shell_quote(&l.display().to_string());
                format!("{{ ( {line} ) 2>&1; echo \"[kabul] saiu com $?\"; }} | tee -a {q}")
            }
            (ShellKind::Posix, None) => format!("( {line} ); echo \"[kabul] saiu com $?\""),
            (ShellKind::PowerShell, Some(l)) => {
                let q = self.quote(&l.display().to_string());
                format!("& {{ {line} }} 2>&1 | Tee-Object -Append -FilePath {q}; $c = if ($LASTEXITCODE) {{ $LASTEXITCODE }} else {{ 0 }}; \"[kabul] saiu com $c\" | Tee-Object -Append -FilePath {q}")
            }
            (ShellKind::PowerShell, None) => format!("& {{ {line} }}; $c = if ($LASTEXITCODE) {{ $LASTEXITCODE }} else {{ 0 }}; \"[kabul] saiu com $c\""),
            // cmd não tem tee: o log fica de fora. `call` + `%^ERRORLEVEL%` lê o código depois do comando.
            (ShellKind::Cmd, _) => format!("({line}) & call echo [kabul] saiu com %^ERRORLEVEL%"),
        }
    }

    /// `CmdSpec` que roda este shell com os argumentos dados.
    pub fn spec(&self, args: Vec<String>) -> CmdSpec {
        CmdSpec { program: self.program.clone(), args, cwd: None, env: vec![] }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tipos() {
        assert_eq!(Shell::from_program("/bin/zsh").kind, ShellKind::Posix);
        assert_eq!(Shell::from_program("C:\\Program Files\\PowerShell\\7\\pwsh.exe").kind, ShellKind::PowerShell);
        assert_eq!(Shell::from_program("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe").kind, ShellKind::PowerShell);
        assert_eq!(Shell::from_program("C:\\Windows\\system32\\cmd.exe").kind, ShellKind::Cmd);
        assert_eq!(Shell::from_program("C:\\Program Files\\Git\\bin\\bash.exe").kind, ShellKind::Posix);
    }

    #[test]
    fn linhas() {
        let sh = Shell::from_program("/bin/bash");
        assert_eq!(sh.run_args("npm i", true), vec!["-lc", "npm i; exec \"$0\" -l", "/bin/bash"]);
        assert_eq!(sh.script_line("make", None), "( make ); echo \"[kabul] saiu com $?\"");
        assert_eq!(sh.script_line("make", Some(std::path::Path::new("/w/log.txt"))), "{ ( make ) 2>&1; echo \"[kabul] saiu com $?\"; } | tee -a /w/log.txt");
        let ps = Shell::from_program("pwsh.exe");
        assert_eq!(ps.quote("it's"), "'it''s'");
        assert_eq!(ps.join(&CmdSpec::new("claude", ["--cloud", "faz x"])), "& claude --cloud 'faz x'");
        assert_eq!(ps.run_args("dir", false), vec!["-NoLogo", "-Command", "dir"]);
        assert!(ps.script_line("npm test", None).contains("[kabul] saiu com $c"));
        let cmd = Shell::from_program("cmd.exe");
        assert_eq!(cmd.quote("a b\"c"), "\"a b\"\"c\"");
        assert_eq!(cmd.run_args("dir", true), vec!["/K", "dir"]);
    }
}
