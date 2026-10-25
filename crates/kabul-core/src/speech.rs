//! Ditado: áudio gravado no app -> wav 16 kHz (ffmpeg) -> texto (whisper-cli, offline).
//! As duas ferramentas são opcionais: sem elas o ditado avisa o que instalar (macOS: Homebrew;
//! Windows: winget/scoop ou o binário do whisper.cpp no PATH ou em `KABUL_BIN_WHISPER_CLI`).
use crate::harness::which;
use anyhow::{bail, Context, Result};
use std::path::PathBuf;

/// Modelo ggml: `KABUL_WHISPER_MODEL` ou o primeiro encontrado nos caches conhecidos.
pub fn find_model() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("KABUL_WHISPER_MODEL").map(PathBuf::from).filter(|p| p.is_file()) {
        return Some(p);
    }
    let home = crate::paths::home();
    if home.as_os_str().is_empty() {
        return None;
    }
    let names = ["ggml-small.bin", "ggml-base.bin", "ggml-medium.bin", "ggml-large-v3-turbo.bin", "ggml-tiny.bin"];
    // Pastas conhecidas e, depois, qualquer `~/.cache/*/whisper*` (outras ferramentas que já baixaram o modelo).
    let mut dirs = vec![home.join(".cache/kabul/whisper"), home.join(".cache/whisper")];
    if let Some(l) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        dirs.push(l.join("kabul").join("whisper"));
    }
    for e in std::fs::read_dir(home.join(".cache")).into_iter().flatten().flatten() {
        for sub in ["whisper", "whisper/models"] {
            dirs.push(e.path().join(sub));
        }
    }
    names.iter().flat_map(|n| dirs.iter().map(|d| d.join(n)).collect::<Vec<_>>()).find(|p| p.is_file())
}

pub fn whisper_args(model: &str, wav: &str, lang: &str) -> Vec<String> {
    ["-m", model, "-l", lang, "-nt", "-np", "-f", wav].iter().map(|s| s.to_string()).collect()
}

/// Como instalar o que falta para o ditado, por sistema.
pub fn missing_message(tool: &str) -> String {
    let how = if cfg!(target_os = "macos") {
        "brew install ffmpeg whisper-cpp"
    } else if cfg!(windows) {
        "winget install Gyan.FFmpeg e baixe o whisper.cpp (whisper-cli.exe) para uma pasta do PATH ou aponte KABUL_BIN_WHISPER_CLI"
    } else {
        "instale ffmpeg e whisper.cpp (whisper-cli) pelo gerenciador de pacotes"
    };
    format!("ditado indisponível: falta o {tool}. Para instalar: {how}")
}

/// Transcreve bytes de áudio (webm/mp4/wav/aiff...) em `lang` (ex.: `pt`).
pub fn transcribe(audio: &[u8], ext: &str, lang: &str) -> Result<String> {
    let ffmpeg = which("ffmpeg").with_context(|| missing_message("ffmpeg"))?;
    let whisper = which("whisper-cli").with_context(|| missing_message("whisper-cli"))?;
    let model = find_model().context("nenhum modelo whisper (ggml-*.bin) encontrado; baixe um em ~/.cache/whisper ou defina KABUL_WHISPER_MODEL")?;
    let dir = std::env::temp_dir().join(format!("kabul-stt-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_nanos()));
    std::fs::create_dir_all(&dir)?;
    let input = dir.join(format!("in.{}", ext.trim_start_matches('.')));
    let wav = dir.join("in.wav");
    std::fs::write(&input, audio)?;
    let r = (|| {
        let o = crate::shell::command(&ffmpeg).args(["-y", "-loglevel", "error", "-i"]).arg(&input).args(["-ar", "16000", "-ac", "1"]).arg(&wav).output().context("ffmpeg")?;
        if !o.status.success() {
            bail!("ffmpeg: {}", String::from_utf8_lossy(&o.stderr).trim());
        }
        let o = crate::shell::command(&whisper).args(whisper_args(&model.to_string_lossy(), &wav.to_string_lossy(), lang)).output().context("whisper-cli")?;
        if !o.status.success() {
            bail!("whisper-cli: {}", String::from_utf8_lossy(&o.stderr).lines().last().unwrap_or(""));
        }
        Ok(clean(&String::from_utf8_lossy(&o.stdout)))
    })();
    std::fs::remove_dir_all(&dir).ok();
    r
}

/// Junta as linhas e remove marcações do whisper como `[BLANK_AUDIO]`.
pub fn clean(out: &str) -> String {
    out.lines().map(str::trim).filter(|l| !l.is_empty() && !(l.starts_with('[') && l.ends_with(']'))).collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limpa() {
        assert_eq!(clean(" Olá mundo.\n[BLANK_AUDIO]\n tudo bem\n"), "Olá mundo. tudo bem");
        assert!(missing_message("ffmpeg").contains("falta o ffmpeg"));
    }

    /// Ponta a ponta com `say` (voz pt-BR) + ffmpeg + whisper-cli; pula se faltar algo.
    #[test]
    fn ponta_a_ponta_say() {
        let has = |b: &str| which(b).is_some();
        if !(has("say") && has("ffmpeg") && has("whisper-cli") && find_model().is_some()) {
            eprintln!("pulado: faltam say/ffmpeg/whisper-cli/modelo");
            return;
        }
        let f = std::env::temp_dir().join(format!("kabul-say-{}.aiff", std::process::id()));
        if !crate::shell::command("say").args(["-v", "Luciana", "-o"]).arg(&f).arg("bom dia, abra o terminal").status().map(|s| s.success()).unwrap_or(false) {
            eprintln!("pulado: voz Luciana indisponível");
            return;
        }
        let t = transcribe(&std::fs::read(&f).unwrap(), "aiff", "pt").unwrap().to_lowercase();
        std::fs::remove_file(&f).ok();
        assert!(t.contains("terminal"), "transcrição: {t}");
    }
}
