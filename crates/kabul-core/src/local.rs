//! IAs locais: runtimes plugáveis ([`LocalRuntime`]) + endpoints custom (OpenAI/Anthropic-compatíveis,
//! inclusive em outra máquina da rede/Tailscale). Tudo por HTTP (via `curl`) e pelos CLIs dos runtimes.
use crate::harness::{Api, CmdSpec, Endpoint};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LocalModel {
    pub id: String,
    pub name: String,
    /// Id do runtime ou do endpoint custom que serve o modelo.
    pub source: String,
    pub size_bytes: Option<u64>,
    pub quant: Option<String>,
    pub params: Option<String>,
    pub context: Option<u64>,
    pub loaded: bool,
}

/// Endpoint configurado pelo usuário.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CustomEndpoint {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub apis: Vec<Api>,
    #[serde(default)]
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SourceStatus {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub base_url: String,
    /// CLI do runtime encontrado.
    pub installed: bool,
    /// Servidor respondendo.
    pub running: bool,
    pub apis: Vec<Api>,
    pub models: Vec<LocalModel>,
    pub can_start: bool,
    pub can_pull: bool,
    pub pull_hint: String,
    pub custom: bool,
}

pub trait LocalRuntime: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn default_url(&self) -> String;
    /// CLI que indica que o runtime está instalado.
    fn binary(&self) -> Option<&'static str>;
    fn installed(&self) -> bool {
        self.binary().map(|b| crate::harness::which(b).is_some()).unwrap_or(false)
    }
    /// Lista modelos (instalados), usando CLI ou API.
    fn list_models(&self, base: &str) -> Vec<LocalModel>;
    fn start_command(&self) -> Option<CmdSpec> {
        None
    }
    /// Carrega o modelo na memória (quando o runtime separa carregar de servir).
    fn load_command(&self, _model: &str) -> Option<CmdSpec> {
        None
    }
    /// Baixa um modelo (sempre com confirmação na UI).
    fn pull_command(&self, _model: &str) -> Option<CmdSpec> {
        None
    }
    fn pull_hint(&self) -> &'static str {
        ""
    }
}

pub fn http_get(url: &str) -> Option<String> {
    let o = crate::shell::command("curl").args(["-sf", "-m", "2", url]).output().ok()?;
    o.status.success().then(|| String::from_utf8_lossy(&o.stdout).into_owned())
}

/// `POST /v1/messages` vazio: 404 = sem API Anthropic; qualquer outra resposta HTTP = existe.
pub fn probe_anthropic(base: &str) -> bool {
    let url = format!("{}/v1/messages", base.trim_end_matches('/'));
    crate::shell::command("curl")
        .args(["-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "2", "-X", "POST", "-H", "content-type: application/json", "-d", "{}", &url])
        .output()
        .ok()
        .map(|o| {
            let c = String::from_utf8_lossy(&o.stdout).trim().to_string();
            !c.is_empty() && c != "000" && c != "404"
        })
        .unwrap_or(false)
}

pub fn parse_openai_models(json: &str, source: &str) -> Vec<LocalModel> {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    v.get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let id = m.get("id")?.as_str()?.to_string();
            Some(LocalModel { name: id.clone(), id, source: source.into(), size_bytes: None, quant: None, params: None, context: m.get("max_model_len").or_else(|| m.get("context_length")).and_then(Value::as_u64), loaded: true })
        })
        .filter(|m| !m.id.contains("embed"))
        .collect()
}

pub fn parse_ollama_tags(json: &str) -> Vec<LocalModel> {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    v.get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let id = m.get("name")?.as_str()?.to_string();
            let d = m.get("details").cloned().unwrap_or(Value::Null);
            Some(LocalModel {
                name: id.clone(),
                id,
                source: "ollama".into(),
                size_bytes: m.get("size").and_then(Value::as_u64),
                quant: d.get("quantization_level").and_then(Value::as_str).map(String::from),
                params: d.get("parameter_size").and_then(Value::as_str).map(String::from),
                context: None,
                loaded: false,
            })
        })
        .filter(|m| !m.id.contains("embed"))
        .collect()
}

/// Parse de `lms ls --json` (só LLMs).
pub fn parse_lms_ls(json: &str) -> Vec<LocalModel> {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    v.as_array()
        .into_iter()
        .flatten()
        .filter(|m| m.get("type").and_then(Value::as_str) == Some("llm"))
        .filter_map(|m| {
            Some(LocalModel {
                id: m.get("modelKey")?.as_str()?.into(),
                name: m.get("displayName").and_then(Value::as_str).unwrap_or("").into(),
                source: "lmstudio".into(),
                size_bytes: m.get("sizeBytes").and_then(Value::as_u64),
                quant: m.pointer("/quantization/name").and_then(Value::as_str).map(String::from),
                params: m.get("paramsString").and_then(Value::as_str).map(String::from),
                context: m.get("maxContextLength").and_then(Value::as_u64),
                loaded: false,
            })
        })
        .collect()
}

fn mark_loaded(mut v: Vec<LocalModel>, base: &str) -> Vec<LocalModel> {
    let live: Vec<String> = http_get(&format!("{base}/v1/models")).map(|j| parse_openai_models(&j, "").into_iter().map(|m| m.id).collect()).unwrap_or_default();
    for m in &mut v {
        m.loaded = live.contains(&m.id);
    }
    v
}

pub struct Ollama;
impl LocalRuntime for Ollama {
    fn id(&self) -> &'static str {
        "ollama"
    }
    fn name(&self) -> &'static str {
        "Ollama"
    }
    fn default_url(&self) -> String {
        "http://127.0.0.1:11434".into()
    }
    fn binary(&self) -> Option<&'static str> {
        Some("ollama")
    }
    fn list_models(&self, base: &str) -> Vec<LocalModel> {
        http_get(&format!("{base}/api/tags")).map(|j| parse_ollama_tags(&j)).unwrap_or_default()
    }
    fn start_command(&self) -> Option<CmdSpec> {
        Some(CmdSpec::new("ollama", ["serve"]))
    }
    fn pull_command(&self, m: &str) -> Option<CmdSpec> {
        Some(CmdSpec::new("ollama", ["pull", m]))
    }
    fn pull_hint(&self) -> &'static str {
        "ex.: qwen3-coder:30b, gpt-oss:20b, deepseek-r1:14b"
    }
}

pub struct LmStudio;
impl LocalRuntime for LmStudio {
    fn id(&self) -> &'static str {
        "lmstudio"
    }
    fn name(&self) -> &'static str {
        "LM Studio"
    }
    fn default_url(&self) -> String {
        "http://127.0.0.1:1234".into()
    }
    fn binary(&self) -> Option<&'static str> {
        Some("lms")
    }
    fn list_models(&self, base: &str) -> Vec<LocalModel> {
        let cli = CmdSpec::new("lms", ["ls", "--json"]).command().output().ok().filter(|o| o.status.success()).map(|o| parse_lms_ls(&String::from_utf8_lossy(&o.stdout))).unwrap_or_default();
        if cli.is_empty() {
            http_get(&format!("{base}/v1/models")).map(|j| parse_openai_models(&j, "lmstudio")).unwrap_or_default()
        } else {
            mark_loaded(cli, base)
        }
    }
    fn start_command(&self) -> Option<CmdSpec> {
        Some(CmdSpec::new("lms", ["server", "start"]))
    }
    fn load_command(&self, m: &str) -> Option<CmdSpec> {
        Some(CmdSpec::new("lms", ["load", m, "-y"]))
    }
    fn pull_command(&self, m: &str) -> Option<CmdSpec> {
        Some(CmdSpec::new("lms", ["get", m, "-y"]))
    }
    fn pull_hint(&self) -> &'static str {
        "ex.: qwen/qwen3-coder-30b, openai/gpt-oss-20b"
    }
}

/// Servidores OpenAI-compatíveis que não têm CLI de catálogo (llama.cpp, MLX, vLLM).
pub struct OpenAiServer {
    pub id: &'static str,
    pub name: &'static str,
    pub url: &'static str,
    pub bin: &'static str,
    pub hint: &'static str,
}
impl LocalRuntime for OpenAiServer {
    fn id(&self) -> &'static str {
        self.id
    }
    fn name(&self) -> &'static str {
        self.name
    }
    fn default_url(&self) -> String {
        self.url.into()
    }
    fn binary(&self) -> Option<&'static str> {
        Some(self.bin)
    }
    fn list_models(&self, base: &str) -> Vec<LocalModel> {
        http_get(&format!("{base}/v1/models")).map(|j| parse_openai_models(&j, self.id)).unwrap_or_default()
    }
    /// Baixa do Hugging Face (`hf download <repo>`); o servidor é iniciado pelo usuário com o modelo.
    fn pull_command(&self, m: &str) -> Option<CmdSpec> {
        Some(CmdSpec::new("hf", ["download", m]))
    }
    fn pull_hint(&self) -> &'static str {
        self.hint
    }
}

pub fn runtimes() -> Vec<Box<dyn LocalRuntime>> {
    vec![
        Box::new(Ollama),
        Box::new(LmStudio),
        Box::new(OpenAiServer { id: "llamacpp", name: "llama.cpp (llama-server)", url: "http://127.0.0.1:8080", bin: "llama-server", hint: "repo GGUF do Hugging Face; inicie com llama-server -hf <repo>" }),
        Box::new(OpenAiServer { id: "mlx", name: "MLX (mlx_lm.server)", url: "http://127.0.0.1:8081", bin: "mlx_lm.server", hint: "repo mlx-community/... do Hugging Face" }),
        Box::new(OpenAiServer { id: "vllm", name: "vLLM", url: "http://127.0.0.1:8000", bin: "vllm", hint: "repo do Hugging Face; inicie com vllm serve <repo>" }),
    ]
}

pub fn runtime(id: &str) -> Option<Box<dyn LocalRuntime>> {
    runtimes().into_iter().find(|r| r.id() == id)
}

pub fn load_endpoints(file: &Path) -> Vec<CustomEndpoint> {
    std::fs::read_to_string(file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save_endpoints(file: &Path, v: &[CustomEndpoint]) -> Result<()> {
    if let Some(d) = file.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(file, serde_json::to_vec_pretty(v)?).context("salvando endpoints")
}

fn apis_for(base: &str, running: bool) -> Vec<Api> {
    let mut v = vec![Api::Openai];
    if running && probe_anthropic(base) {
        v.push(Api::Anthropic);
    }
    v
}

/// Detecta runtimes e endpoints e lista os modelos de cada um.
pub fn discover(endpoints: &[CustomEndpoint]) -> Vec<SourceStatus> {
    let mut out: Vec<SourceStatus> = runtimes()
        .into_iter()
        .map(|r| {
            let base = r.default_url();
            let running = http_get(&format!("{base}/v1/models")).is_some() || (r.id() == "ollama" && http_get(&format!("{base}/api/tags")).is_some());
            let installed = r.installed();
            let models = if running || installed { r.list_models(&base) } else { vec![] };
            SourceStatus {
                id: r.id().into(),
                name: r.name().into(),
                kind: "runtime".into(),
                apis: apis_for(&base, running),
                base_url: base,
                installed,
                running,
                models,
                can_start: installed && r.start_command().is_some(),
                can_pull: r.pull_command("x").is_some(),
                pull_hint: r.pull_hint().into(),
                custom: false,
            }
        })
        .collect();
    for e in endpoints {
        let base = e.base_url.trim_end_matches('/').to_string();
        let models = http_get(&format!("{base}/v1/models")).map(|j| parse_openai_models(&j, &e.id)).unwrap_or_default();
        out.push(SourceStatus {
            id: e.id.clone(),
            name: e.name.clone(),
            kind: "endpoint".into(),
            running: !models.is_empty(),
            base_url: base,
            installed: true,
            apis: e.apis.clone(),
            models,
            can_start: false,
            can_pull: false,
            pull_hint: String::new(),
            custom: true,
        });
    }
    out
}

/// Garante servidor no ar e modelo carregado; devolve o endpoint para o harness.
pub fn prepare(source: &SourceStatus, model: &LocalModel, api_key: Option<String>) -> Result<Endpoint> {
    if let Some(r) = runtime(&source.id) {
        if !source.running {
            let spec = r.start_command().context("runtime parado e sem comando para iniciar")?;
            spec.command().stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().context("iniciando o runtime")?;
            for _ in 0..30 {
                if http_get(&format!("{}/v1/models", source.base_url)).is_some() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        }
        if !model.loaded {
            if let Some(spec) = r.load_command(&model.id) {
                let o = spec.command().output().context("carregando o modelo")?;
                anyhow::ensure!(o.status.success(), "falha ao carregar {}: {}", model.id, String::from_utf8_lossy(&o.stderr).trim());
            }
        }
    }
    Ok(Endpoint { base_url: source.base_url.clone(), apis: source.apis.clone(), api_key, model: model.id.clone(), context: model.context })
}

/// Memória total (no Mac com Apple Silicon é unificada: RAM e VRAM). macOS: `sysctl`; resto: `sysinfo`.
pub fn total_memory() -> Option<u64> {
    if cfg!(target_os = "macos") {
        let o = crate::shell::command("sysctl").args(["-n", "hw.memsize"]).output().ok()?;
        return String::from_utf8_lossy(&o.stdout).trim().parse().ok();
    }
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    Some(sys.total_memory()).filter(|m| *m > 0)
}

/// Cabe se pesos + ~20% (KV cache, overhead) ficam abaixo de 75% da memória.
pub fn fits(size: u64, memory: u64) -> bool {
    size as f64 * 1.2 <= memory as f64 * 0.75
}

pub fn family_label(id: &str) -> &'static str {
    let l = id.to_lowercase();
    [("gpt-oss", "gpt-oss"), ("qwen", "Qwen"), ("deepseek", "DeepSeek"), ("kimi", "Kimi"), ("glm", "GLM"), ("minimax", "MiniMax"), ("gemma", "Gemma"), ("llama", "Llama"), ("mistral", "Mistral"), ("phi", "Phi")]
        .iter()
        .find(|(k, _)| l.contains(k))
        .map(|(_, v)| *v)
        .unwrap_or("outro")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parsers() {
        let o = parse_ollama_tags(r#"{"models":[{"name":"qwen3-coder:30b","size":18556688736,"details":{"family":"qwen3moe","parameter_size":"30.5B","quantization_level":"Q4_K_M"}},{"name":"nomic-embed-text:latest","size":1}]}"#);
        assert_eq!(o.len(), 1);
        assert_eq!((o[0].quant.as_deref(), o[0].params.as_deref()), (Some("Q4_K_M"), Some("30.5B")));
        let l = parse_lms_ls(r#"[{"type":"llm","modelKey":"qwen3-8b","displayName":"Qwen3 8B","sizeBytes":4623782544,"paramsString":"8B","quantization":{"name":"4bit"},"maxContextLength":40960},{"type":"embedding","modelKey":"e"}]"#);
        assert_eq!((l.len(), l[0].context), (1, Some(40960)));
        let a = parse_openai_models(r#"{"data":[{"id":"qwen3-8b"},{"id":"text-embedding-nomic"}]}"#, "x");
        assert_eq!(a.len(), 1);
        assert!(fits(4_600_000_000, 32 << 30));
        assert!(!fits(40_000_000_000, 32 << 30));
        assert_eq!(family_label("openai/gpt-oss-20b"), "gpt-oss");
    }
}
