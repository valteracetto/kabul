//! Disco para o scan: links (real/link/quebrado), leitura com teto, hash de pasta com teto e um
//! cache por arquivo `(caminho, mtime, tamanho)` para o scan quente só fazer `stat`.
use super::frontmatter;
use super::Link;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Teto por arquivo no hash (o resto entra só pelo tamanho).
pub const FILE_CAP: u64 = 1024 * 1024;
/// Teto por item: passou disso, o hash é parcial (marcado com `~`).
pub const ITEM_CAP: u64 = 4 * 1024 * 1024;
/// Pastas que nunca entram no hash nem na listagem.
pub const SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", ".venv", "__pycache__", ".DS_Store", "dist", ".next"];

/// Como `p` está no disco. O alvo do link é resolvido relativo à pasta do link.
pub fn classify(p: &Path) -> Option<(Link, PathBuf)> {
    let meta = std::fs::symlink_metadata(p).ok()?;
    if !meta.file_type().is_symlink() {
        return Some((Link::Real, p.to_path_buf()));
    }
    let target = std::fs::read_link(p).ok().unwrap_or_default();
    let abs = if target.is_absolute() { target.clone() } else { p.parent().map(|d| d.join(&target)).unwrap_or(target.clone()) };
    // `metadata` segue a cadeia inteira (e falha em loop de links).
    let shown = target.display().to_string().replace('\\', "/");
    if std::fs::metadata(p).is_ok() {
        Some((Link::Symlink { target: shown }, std::fs::canonicalize(p).unwrap_or(abs)))
    } else {
        Some((Link::Broken { target: shown }, abs))
    }
}

pub fn mtime_secs(m: &std::fs::Metadata) -> Option<u64> {
    m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs())
}

/// Lê até `max` bytes como texto (UTF-8 com perdas). Devolve (texto, cortado?).
pub fn read_capped(p: &Path, max: usize) -> (String, bool) {
    let Ok(f) = std::fs::File::open(p) else { return (String::new(), false) };
    let mut buf = Vec::with_capacity(max.min(64 * 1024));
    let n = f.take(max as u64 + 1).read_to_end(&mut buf).unwrap_or(0);
    let cut = n > max;
    buf.truncate(max);
    let mut s = String::from_utf8_lossy(&buf).into_owned();
    if cut {
        // Não termina no meio de um caractere trocado.
        while s.ends_with('\u{fffd}') {
            s.pop();
        }
    }
    (s, cut)
}

/// Arquivos de uma pasta (relativos, ordenados), sem seguir links e sem as pastas pesadas.
pub fn list_files(dir: &Path, max: usize) -> Vec<String> {
    let mut out = vec![];
    walk(dir, dir, 0, &mut |rel, _| {
        out.push(rel.to_string());
        out.len() < max
    });
    out.sort();
    out
}

/// Percorre a pasta (profundidade até 6). `f(relativo, metadata)` devolve `false` para parar.
fn walk(root: &Path, dir: &Path, depth: usize, f: &mut dyn FnMut(&str, &std::fs::Metadata) -> bool) -> bool {
    if depth > 6 {
        return true;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return true };
    let mut entries: Vec<_> = rd.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let name = e.file_name();
        let name = name.to_string_lossy();
        if SKIP_DIRS.contains(&name.as_ref()) {
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(e.path()) else { continue };
        if meta.is_dir() {
            if !walk(root, &e.path(), depth + 1, f) {
                return false;
            }
        } else {
            let rel = e.path().strip_prefix(root).map(|r| r.display().to_string().replace('\\', "/")).unwrap_or_default();
            if !f(&rel, &meta) {
                return false;
            }
        }
    }
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Entry {
    m: u64,
    s: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    h: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    f: Option<Front>,
}

/// O que o scan guarda do frontmatter de um arquivo.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Front {
    pub fields: Vec<(String, String)>,
    pub warnings: Vec<String>,
    pub has: bool,
    /// Primeira linha de texto do corpo (fallback da descrição).
    pub first: Option<String>,
    pub size: u64,
}

/// Cache por arquivo. Gravado em `<estado>/tools-cache.json` (só metadados e hashes, nada de corpo).
#[derive(Debug, Default)]
pub struct FileCache {
    map: HashMap<String, Entry>,
    seen: std::collections::HashSet<String>,
    pub dirty: bool,
    pub hits: usize,
    pub misses: usize,
}

/// Sobe quando o leitor de frontmatter ou o hash mudam (o cache antigo é descartado).
const CACHE_VERSION: u32 = 2;

impl FileCache {
    pub fn load(file: &Path) -> Self {
        #[derive(Deserialize)]
        struct Doc {
            v: u32,
            map: HashMap<String, Entry>,
        }
        let map = std::fs::read(file).ok().and_then(|b| serde_json::from_slice::<Doc>(&b).ok()).filter(|d| d.v == CACHE_VERSION).map(|d| d.map).unwrap_or_default();
        Self { map, ..Default::default() }
    }

    /// Grava só o que foi visto neste scan (o resto sumiu do disco).
    pub fn save(&mut self, file: &Path) {
        if !self.dirty && self.seen.len() == self.map.len() {
            return;
        }
        let seen = std::mem::take(&mut self.seen);
        self.map.retain(|k, _| seen.contains(k));
        if let Some(d) = file.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let doc = serde_json::json!({ "v": CACHE_VERSION, "map": self.map });
        let tmp = file.with_extension("json.tmp");
        if std::fs::write(&tmp, serde_json::to_vec(&doc).unwrap_or_default()).is_ok() {
            let _ = std::fs::rename(&tmp, file);
        }
        self.dirty = false;
    }

    fn entry(&mut self, p: &Path, meta: &std::fs::Metadata) -> &mut Entry {
        let key = p.display().to_string();
        let (m, s) = (meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos() as u64).unwrap_or(0), meta.len());
        self.seen.insert(key.clone());
        let fresh = self.map.get(&key).is_some_and(|e| e.m == m && e.s == s);
        if fresh {
            self.hits += 1;
        } else {
            self.misses += 1;
            self.dirty = true;
            self.map.insert(key.clone(), Entry { m, s, h: None, f: None });
        }
        self.map.get_mut(&key).unwrap()
    }

    /// sha256 do arquivo (até [`FILE_CAP`]; maior que isso, o tamanho entra no hash).
    pub fn file_hash(&mut self, p: &Path, meta: &std::fs::Metadata) -> String {
        if let Some(h) = self.entry(p, meta).h.clone() {
            return h;
        }
        let (mut buf, len) = (Vec::new(), meta.len());
        if let Ok(f) = std::fs::File::open(p) {
            let _ = f.take(FILE_CAP).read_to_end(&mut buf);
        }
        if len > FILE_CAP {
            buf.extend_from_slice(format!("|{len}").as_bytes());
        }
        let h = crate::usage::sha256_hex(&buf);
        self.dirty = true;
        self.entry(p, meta).h = Some(h.clone());
        h
    }

    /// Frontmatter do arquivo (lê só os primeiros 64 KB).
    pub fn front(&mut self, p: &Path) -> Option<Front> {
        let meta = std::fs::metadata(p).ok()?;
        if let Some(f) = self.entry(p, &meta).f.clone() {
            return Some(f);
        }
        let (text, _) = read_capped(p, 64 * 1024);
        let parsed = frontmatter::parse(&text);
        let first = frontmatter::first_paragraph(&text[parsed.body_start.min(text.len())..]);
        let f = Front { fields: parsed.fields, warnings: parsed.warnings, has: parsed.has_frontmatter, first, size: meta.len() };
        self.dirty = true;
        self.entry(p, &meta).f = Some(f.clone());
        Some(f)
    }

    /// Hash curto (12 hex) do conteúdo de uma pasta; `~` no fim quando passou do teto.
    pub fn dir_hash(&mut self, dir: &Path) -> Option<String> {
        let mut acc = String::new();
        let mut total = 0u64;
        let mut partial = false;
        let mut files = vec![];
        walk(dir, dir, 0, &mut |rel, meta| {
            files.push((rel.to_string(), meta.clone()));
            true
        });
        if files.is_empty() {
            return None;
        }
        for (rel, meta) in files {
            if rel.ends_with(".DS_Store") {
                continue;
            }
            if total > ITEM_CAP {
                partial = true;
                break;
            }
            total += meta.len().min(FILE_CAP);
            let h = if meta.file_type().is_symlink() { std::fs::read_link(dir.join(&rel)).map(|t| t.display().to_string()).unwrap_or_default() } else { self.file_hash(&dir.join(&rel), &meta) };
            acc.push_str(&rel);
            acc.push('\0');
            acc.push_str(&h);
            acc.push('\n');
        }
        let h = crate::usage::sha256_hex(acc.as_bytes())[..12].to_string();
        Some(if partial { format!("{h}~") } else { h })
    }

    /// Hash curto de um arquivo só.
    pub fn short_hash(&mut self, p: &Path) -> Option<String> {
        let meta = std::fs::metadata(p).ok()?;
        Some(self.file_hash(p, &meta)[..12].to_string())
    }
}

#[cfg(test)]
pub(crate) mod testfs {
    //! Árvores sintéticas em pasta temporária (cada teste a sua).
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    static N: AtomicUsize = AtomicUsize::new(0);

    pub struct Tmp(pub PathBuf);
    impl Tmp {
        pub fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!("kabul-tools-{tag}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
            let _ = std::fs::remove_dir_all(&p);
            std::fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
        pub fn path(&self) -> &Path {
            &self.0
        }
        pub fn write(&self, rel: &str, text: &str) -> PathBuf {
            let p = self.0.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, text).unwrap();
            p
        }
        /// Link simbólico `rel` → `target` (texto do link, relativo ou absoluto).
        pub fn link(&self, target: &str, rel: &str) -> bool {
            let p = self.0.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            symlink(Path::new(target), &p)
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[cfg(unix)]
    pub fn symlink(target: &Path, at: &Path) -> bool {
        std::os::unix::fs::symlink(target, at).is_ok()
    }
    /// No Windows o link de pasta exige modo de desenvolvedor; sem ele o teste pula a parte de links.
    #[cfg(windows)]
    pub fn symlink(target: &Path, at: &Path) -> bool {
        std::os::windows::fs::symlink_dir(target, at).is_ok()
    }
    #[cfg(not(any(unix, windows)))]
    pub fn symlink(_: &Path, _: &Path) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::testfs::Tmp;
    use super::*;

    #[test]
    fn links_e_hash() {
        let t = Tmp::new("fsx");
        t.write("a/SKILL.md", "---\nname: a\n---\nx");
        t.write("b/SKILL.md", "---\nname: a\n---\nx");
        t.write("c/SKILL.md", "---\nname: a\n---\ny");
        let mut c = FileCache::default();
        let (ha, hb, hc) = (c.dir_hash(&t.path().join("a")), c.dir_hash(&t.path().join("b")), c.dir_hash(&t.path().join("c")));
        assert_eq!(ha, hb);
        assert_ne!(ha, hc);
        assert_eq!(classify(&t.path().join("a")).unwrap().0, Link::Real);
        if t.link("a", "l") {
            assert!(matches!(classify(&t.path().join("l")).unwrap().0, Link::Symlink { .. }));
            assert!(t.link("nao-existe", "q"));
            assert!(matches!(classify(&t.path().join("q")).unwrap().0, Link::Broken { .. }));
            // Loop de links não trava nem quebra.
            assert!(t.link("loop2", "loop1") && t.link("loop1", "loop2"));
            assert!(matches!(classify(&t.path().join("loop1")).unwrap().0, Link::Broken { .. }));
        }
        assert!(classify(&t.path().join("nada")).is_none());
    }

    #[test]
    fn cache_quente_e_teto() {
        let t = Tmp::new("fsx-cache");
        let p = t.write("x/SKILL.md", "---\nname: x\ndescription: d\n---\ncorpo");
        let file = t.path().join("cache.json");
        let mut c = FileCache::load(&file);
        assert_eq!(c.front(&p).unwrap().fields[0], ("name".into(), "x".into()));
        let h1 = c.dir_hash(&t.path().join("x"));
        c.save(&file);
        let mut c2 = FileCache::load(&file);
        assert_eq!(c2.dir_hash(&t.path().join("x")), h1);
        assert!(c2.front(&p).is_some());
        assert_eq!(c2.misses, 0, "tudo do cache");
        // Arquivo grande: lê só até o teto.
        let big = "a".repeat(200_000);
        let pb = t.write("big.md", &big);
        let (s, cut) = read_capped(&pb, 64 * 1024);
        assert!(cut && s.len() == 64 * 1024);
    }
}
