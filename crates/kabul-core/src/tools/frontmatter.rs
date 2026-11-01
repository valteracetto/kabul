//! Frontmatter (`---` ... `---`) e um subconjunto tolerante de YAML: BOM, CRLF, escalares em bloco
//! (`|`, `>`), aspas simples e duplas, dois-pontos sem aspas no valor, listas (`- a` e `[a, b]`) e
//! mapas aninhados achatados (`metadata.origin`). Nunca falha: o que não reconhece vira aviso.

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Parsed {
    /// Campos na ordem do arquivo (aninhados como `pai.filho`; listas juntadas com ", ").
    pub fields: Vec<(String, String)>,
    pub warnings: Vec<String>,
    /// Onde começa o corpo (índice em bytes no texto original).
    pub body_start: usize,
    pub has_frontmatter: bool,
}

impl Parsed {
    pub fn get(&self, key: &str) -> Option<&str> {
        self.fields.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v.as_str()).filter(|v| !v.is_empty())
    }
}

/// Separa e lê o frontmatter de um Markdown.
pub fn parse(text: &str) -> Parsed {
    let bom = if text.starts_with('\u{feff}') { '\u{feff}'.len_utf8() } else { 0 };
    let t = &text[bom..];
    let mut lines = t.split_inclusive('\n');
    let first = lines.next().unwrap_or("");
    if first.trim_end() != "---" {
        return Parsed { body_start: bom, ..Default::default() };
    }
    let mut pos = bom + first.len();
    let start = pos;
    for l in lines {
        let tl = l.trim_end();
        if tl == "---" || tl == "..." {
            let (fields, warnings) = parse_yaml(&text[start..pos]);
            return Parsed { fields, warnings, body_start: pos + l.len(), has_frontmatter: true };
        }
        pos += l.len();
    }
    // Sem o `---` de fechamento: não é frontmatter (o texto inteiro é corpo).
    Parsed { warnings: vec!["frontmatter sem fechamento".into()], body_start: bom, ..Default::default() }
}

fn indent_of(l: &str) -> usize {
    l.chars().take_while(|c| *c == ' ' || *c == '\t').map(|c| if c == '\t' { 2 } else { 1 }).sum()
}

/// Posição do `:` que separa chave e valor (fora de aspas; seguido de espaço ou fim).
fn key_colon(s: &str) -> Option<usize> {
    if s.starts_with('"') || s.starts_with('\'') {
        let q = s.chars().next()?;
        let end = s[1..].find(q)? + 1;
        return s[end + 1..].starts_with(':').then_some(end + 1);
    }
    let b = s.as_bytes();
    (0..b.len()).find(|&i| b[i] == b':' && (i + 1 == b.len() || b[i + 1] == b' ' || b[i + 1] == b'\t')).filter(|&i| i > 0 && !s[..i].contains(": "))
}

fn unquote_key(k: &str) -> String {
    let k = k.trim();
    if k.len() >= 2 && ((k.starts_with('"') && k.ends_with('"')) || (k.starts_with('\'') && k.ends_with('\''))) {
        k[1..k.len() - 1].to_string()
    } else {
        k.to_string()
    }
}

fn strip_comment(v: &str) -> &str {
    match v.find(" #") {
        Some(i) => v[..i].trim_end(),
        None => v,
    }
}

fn inline_list(v: &str) -> String {
    v.trim_start_matches('[').trim_end_matches(']').split(',').map(|x| x.trim().trim_matches('"').trim_matches('\'')).filter(|x| !x.is_empty()).collect::<Vec<_>>().join(", ")
}

/// Lê um bloco YAML simples (sem âncoras nem tipos), achatando mapas aninhados.
pub fn parse_yaml(src: &str) -> (Vec<(String, String)>, Vec<String>) {
    let lines: Vec<&str> = src.lines().map(|l| l.trim_end_matches('\r')).collect();
    let mut fields: Vec<(String, String)> = vec![];
    let mut warnings = vec![];
    let mut stack: Vec<(usize, String)> = vec![];
    let mut i = 0;
    let set = |fields: &mut Vec<(String, String)>, warnings: &mut Vec<String>, k: String, v: String| {
        if let Some(e) = fields.iter_mut().find(|(x, _)| *x == k) {
            if e.1.is_empty() {
                e.1 = v;
            } else {
                warnings.push(format!("chave duplicada: {k}"));
            }
        } else {
            fields.push((k, v));
        }
    };
    while i < lines.len() {
        let raw = lines[i];
        let content = raw.trim();
        if content.is_empty() || content.starts_with('#') {
            i += 1;
            continue;
        }
        let ind = indent_of(raw);
        while stack.last().is_some_and(|(si, _)| ind <= *si) {
            stack.pop();
        }
        let prefix = stack.last().map(|(_, k)| format!("{k}.")).unwrap_or_default();
        if let Some(item) = content.strip_prefix("- ").or_else(|| (content == "-").then_some("")) {
            // Item de lista: junta no pai.
            let parent = stack.last().map(|(_, k)| k.clone()).unwrap_or_else(|| "_".into());
            let item = item.trim().trim_matches('"').trim_matches('\'').to_string();
            match fields.iter_mut().find(|(k, _)| *k == parent) {
                Some(e) if e.1.is_empty() => e.1 = item,
                Some(e) => {
                    e.1.push_str(", ");
                    e.1.push_str(&item);
                }
                None => fields.push((parent, item)),
            }
            i += 1;
            // Item que é um mapa (`- a: 1` seguido de `  b: 2`): o resto do item fica com ele.
            while i < lines.len() && (lines[i].trim().is_empty() || indent_of(lines[i]) > ind) {
                i += 1;
            }
            continue;
        }
        let Some(c) = key_colon(content) else {
            warnings.push(format!("linha não reconhecida: {}", content.chars().take(40).collect::<String>()));
            i += 1;
            continue;
        };
        let key = format!("{prefix}{}", unquote_key(&content[..c]));
        let rest = content[c + 1..].trim();
        i += 1;
        if rest.is_empty() {
            set(&mut fields, &mut warnings, key.clone(), String::new());
            stack.push((ind, key));
            continue;
        }
        let value = if rest.starts_with('|') || rest.starts_with('>') {
            let fold = rest.starts_with('>');
            let mut parts: Vec<String> = vec![];
            let mut block_ind = None;
            while i < lines.len() {
                let l = lines[i];
                if l.trim().is_empty() {
                    parts.push(String::new());
                    i += 1;
                    continue;
                }
                let li = indent_of(l);
                if li <= ind {
                    break;
                }
                let bi = *block_ind.get_or_insert(li);
                parts.push(l.chars().skip(bi.min(li)).collect());
                i += 1;
            }
            while parts.last().is_some_and(|p| p.is_empty()) {
                parts.pop();
            }
            if fold {
                let mut out = String::new();
                for p in parts {
                    if p.is_empty() {
                        out.push('\n');
                    } else {
                        if !out.is_empty() && !out.ends_with('\n') {
                            out.push(' ');
                        }
                        out.push_str(p.trim());
                    }
                }
                out
            } else {
                parts.join("\n")
            }
        } else if let Some(q) = rest.strip_prefix('"') {
            // Aspas duplas, podendo continuar nas linhas seguintes.
            let mut buf = q.to_string();
            while !closes_double(&buf) && i < lines.len() {
                buf.push(' ');
                buf.push_str(lines[i].trim());
                i += 1;
            }
            unescape_double(&buf)
        } else if let Some(q) = rest.strip_prefix('\'') {
            let mut buf = q.to_string();
            while !closes_single(&buf) && i < lines.len() {
                buf.push(' ');
                buf.push_str(lines[i].trim());
                i += 1;
            }
            let end = single_end(&buf).unwrap_or(buf.len());
            buf[..end].replace("''", "'")
        } else if rest.starts_with('[') {
            let mut buf = rest.to_string();
            while !buf.trim_end().ends_with(']') && i < lines.len() && indent_of(lines[i]) > ind {
                buf.push_str(lines[i].trim());
                i += 1;
            }
            inline_list(&buf)
        } else {
            // Escalar simples (dois-pontos no meio são parte do valor); continua nas linhas mais
            // indentadas que não são chave.
            let mut v = strip_comment(rest).to_string();
            while i < lines.len() && indent_of(lines[i]) > ind && !lines[i].trim().is_empty() && key_colon(lines[i].trim()).is_none() && !lines[i].trim().starts_with("- ") {
                v.push(' ');
                v.push_str(lines[i].trim());
                i += 1;
            }
            v
        };
        set(&mut fields, &mut warnings, key, value);
    }
    // Pais vazios que ganharam filhos somem (ficam só `pai.filho`).
    let keys: Vec<String> = fields.iter().map(|(k, _)| k.clone()).collect();
    fields.retain(|(k, v)| !(v.is_empty() && keys.iter().any(|x| x.len() > k.len() && x.starts_with(k.as_str()) && x.as_bytes()[k.len()] == b'.')));
    (fields, warnings)
}

fn closes_double(s: &str) -> bool {
    double_end(s).is_some()
}

fn double_end(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'\\' => i += 2,
            b'"' => return Some(i),
            _ => i += 1,
        }
    }
    None
}

fn unescape_double(s: &str) -> String {
    let end = double_end(s).unwrap_or(s.len());
    let mut out = String::new();
    let mut it = s[..end].chars();
    while let Some(c) = it.next() {
        if c == '\\' {
            match it.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some(o) => out.push(o),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn single_end(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\'' {
            if b.get(i + 1) == Some(&b'\'') {
                i += 2;
                continue;
            }
            return Some(i);
        }
        i += 1;
    }
    None
}

fn closes_single(s: &str) -> bool {
    single_end(s).is_some()
}

/// Primeira linha de texto do corpo (para itens sem descrição): pula títulos e linhas vazias.
pub fn first_paragraph(body: &str) -> Option<String> {
    body.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with("```") && !l.starts_with("<!--") && !l.starts_with("---")).map(|l| l.chars().take(300).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minimo() {
        let p = parse("---\nname: x\ndescription: Faz y\n---\n# Corpo\n");
        assert!(p.has_frontmatter);
        assert_eq!(p.get("name"), Some("x"));
        assert_eq!(p.get("description"), Some("Faz y"));
        assert_eq!(&"---\nname: x\ndescription: Faz y\n---\n# Corpo\n"[p.body_start..], "# Corpo\n");
    }

    #[test]
    fn sem_frontmatter_e_sem_fechamento() {
        let p = parse("# Só corpo\n");
        assert!(!p.has_frontmatter && p.fields.is_empty() && p.body_start == 0);
        let p = parse("---\nname: x\nsem fim\n");
        assert!(!p.has_frontmatter && !p.warnings.is_empty());
    }

    #[test]
    fn crlf_bom_e_blocos() {
        let t = "\u{feff}---\r\nname: x\r\ndescription: >\r\n  Primeira linha\r\n  continua aqui\r\n\r\n  outro parágrafo\r\nnotes: |\r\n  a\r\n  b\r\n---\r\ncorpo";
        let p = parse(t);
        assert_eq!(p.get("name"), Some("x"));
        assert_eq!(p.get("description"), Some("Primeira linha continua aqui\noutro parágrafo"));
        assert_eq!(p.get("notes"), Some("a\nb"));
        assert_eq!(&t[p.body_start..], "corpo");
    }

    #[test]
    fn dois_pontos_aspas_listas_e_aninhados() {
        let (f, w) = parse_yaml("description: Use when: o usuário pede X: e Y\ntitle: \"Com \\\"aspas\\\" e: dois\"\nother: 'it''s'\ntools: [Read, \"Bash\"]\nallowed:\n  - a\n  - b\nchain:\n  - pattern: x\n    message: m\n  - pattern: y\n    message: n\nmetadata:\n  origin: community\n  author:\n    name: Fulano\nname: x\nname: y\n");
        let g = |k: &str| f.iter().find(|(x, _)| x == k).map(|(_, v)| v.as_str());
        assert_eq!(g("description"), Some("Use when: o usuário pede X: e Y"));
        assert_eq!(g("title"), Some("Com \"aspas\" e: dois"));
        assert_eq!(g("other"), Some("it's"));
        assert_eq!(g("tools"), Some("Read, Bash"));
        assert_eq!(g("allowed"), Some("a, b"));
        assert_eq!(g("chain"), Some("pattern: x, pattern: y"));
        assert!(!w.iter().any(|w| w.contains("pattern")), "lista de mapas não duplica chave");
        assert_eq!(g("metadata.origin"), Some("community"));
        assert_eq!(g("metadata.author.name"), Some("Fulano"));
        assert!(g("metadata").is_none());
        assert_eq!(g("name"), Some("x"), "a primeira vence");
        assert!(w.iter().any(|w| w.contains("duplicada")));
    }

    #[test]
    fn lixo_nao_quebra() {
        for t in ["---\n:::\n---\n", "---\n\"aberta: x\n---\n", "---\n- solto\n---", "---\n\t\tx: [\n---\n", "\u{feff}", "---", "---\n---\n"] {
            let _ = parse(t);
        }
        let (f, _) = parse_yaml("a: 'sem fim\nb: c");
        assert!(!f.is_empty());
    }
}
