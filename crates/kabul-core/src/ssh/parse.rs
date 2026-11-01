//! Leitor tolerante e sem perdas do `ssh_config`. Cada linha guarda o intervalo exato de bytes no
//! arquivo (com a quebra de linha), então o editor troca só o que precisa e o resto sai igual, byte a
//! byte (comentários, recuo, `=`, aspas, CRLF do Windows).
//!
//! Regras do OpenSSH seguidas aqui: palavra-chave sem diferença de maiúsculas, separador por espaço ou
//! `=`, argumentos entre aspas duplas, `#` no começo de um argumento abre comentário, um bloco `Host`
//! ou `Match` vai até o próximo. Nada é interpretado além do necessário para listar e editar: `Match`
//! vira "regra" e o valor efetivo de cada host vem do próprio `ssh -G`.

/// Linha do arquivo com o intervalo de bytes (`start..end`, inclui a quebra de linha).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Line {
    pub start: usize,
    pub end: usize,
    pub kind: Kind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Kind {
    Blank,
    Comment(String),
    /// `key` como escrito; `args` já sem aspas; `value` é o intervalo (absoluto) do valor, do primeiro
    /// ao último argumento (sem comentário no fim nem espaços), para trocar só ele.
    Directive {
        key: String,
        args: Vec<String>,
        value: (usize, usize),
    },
}

impl Line {
    pub fn key_lower(&self) -> Option<String> {
        match &self.kind {
            Kind::Directive { key, .. } => Some(key.to_ascii_lowercase()),
            _ => None,
        }
    }
    pub fn args(&self) -> &[String] {
        match &self.kind {
            Kind::Directive { args, .. } => args,
            _ => &[],
        }
    }
    pub fn is_blank(&self) -> bool {
        matches!(self.kind, Kind::Blank)
    }
    pub fn is_comment(&self) -> bool {
        matches!(self.kind, Kind::Comment(_))
    }
}

/// Bloco: o trecho antes do primeiro `Host`/`Match` (global) ou um `Host`/`Match` até o próximo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block {
    pub kind: BlockKind,
    /// Índice da linha do cabeçalho (`None` no global).
    pub header: Option<usize>,
    /// Primeira linha do bloco contando os comentários colados logo acima do cabeçalho.
    pub first: usize,
    /// Uma depois da última linha (sem os comentários colados ao próximo bloco).
    pub end: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockKind {
    Global,
    Host(Vec<String>),
    Match(Vec<String>),
}

/// Arquivo lido: texto original, linhas e blocos.
#[derive(Debug, Clone)]
pub struct Parsed {
    pub text: String,
    pub lines: Vec<Line>,
    pub blocks: Vec<Block>,
    /// `\r\n` se o arquivo já usa (Windows), senão `\n`.
    pub eol: &'static str,
}

impl Parsed {
    pub fn line_text(&self, i: usize) -> &str {
        let l = &self.lines[i];
        self.text[l.start..l.end].trim_end_matches(['\n', '\r'])
    }
    /// Linhas de diretiva dentro do bloco (sem o cabeçalho).
    pub fn directives(&self, b: &Block) -> impl Iterator<Item = usize> + '_ {
        let from = b.header.map(|h| h + 1).unwrap_or(b.first);
        (from..b.end).filter(move |&i| matches!(self.lines[i].kind, Kind::Directive { .. }))
    }
    /// Comentários colados acima do cabeçalho (sem o `#`).
    pub fn attached_comment(&self, b: &Block) -> Option<String> {
        let h = b.header?;
        let v: Vec<String> = (b.first..h).filter_map(|i| if let Kind::Comment(c) = &self.lines[i].kind { Some(c.clone()) } else { None }).collect();
        (!v.is_empty()).then(|| v.join("\n"))
    }
    /// Recuo usado nas diretivas dos blocos (o primeiro encontrado), senão 4 espaços.
    pub fn indent(&self) -> String {
        for b in &self.blocks {
            if b.header.is_none() {
                continue;
            }
            if let Some(i) = self.directives(b).next() {
                let t = &self.text[self.lines[i].start..self.lines[i].end];
                let ws: String = t.chars().take_while(|c| *c == ' ' || *c == '\t').collect();
                if !ws.is_empty() {
                    return ws;
                }
            }
        }
        "    ".into()
    }
}

/// Divide os argumentos como o OpenSSH (`argv_split`): espaço separa, aspas duplas agrupam, `\"`
/// escapa dentro das aspas, e um `#` no começo de um argumento termina a linha. Devolve os argumentos
/// e o fim (relativo) do último.
fn split_args(s: &str) -> (Vec<String>, usize) {
    let b = s.as_bytes();
    let mut out = vec![];
    let mut i = 0;
    let mut last_end = 0;
    while i < b.len() {
        while i < b.len() && (b[i] == b' ' || b[i] == b'\t') {
            i += 1;
        }
        if i >= b.len() || b[i] == b'#' {
            break;
        }
        let mut arg = String::new();
        if b[i] == b'"' {
            i += 1;
            // Aspas sem fechar: o resto da linha vira o argumento (o ssh recusaria; aqui só se lista).
            while i < b.len() {
                if b[i] == b'\\' && i + 1 < b.len() && (b[i + 1] == b'"' || b[i + 1] == b'\\') {
                    arg.push(b[i + 1] as char);
                    i += 2;
                    continue;
                }
                if b[i] == b'"' {
                    i += 1;
                    break;
                }
                let ch = s[i..].chars().next().unwrap();
                arg.push(ch);
                i += ch.len_utf8();
            }
        } else {
            while i < b.len() && b[i] != b' ' && b[i] != b'\t' {
                let ch = s[i..].chars().next().unwrap();
                arg.push(ch);
                i += ch.len_utf8();
            }
        }
        last_end = i;
        out.push(arg);
    }
    (out, last_end)
}

/// Uma linha (sem a quebra) a partir do byte `base` do arquivo.
fn parse_line(raw: &str, base: usize) -> Kind {
    let t = raw.trim_start_matches([' ', '\t']);
    let lead = raw.len() - t.len();
    let t = t.trim_end_matches(['\r']);
    if t.trim().is_empty() {
        return Kind::Blank;
    }
    if let Some(c) = t.strip_prefix('#') {
        return Kind::Comment(c.strip_prefix(' ').unwrap_or(c).to_string());
    }
    let key_len = t.find([' ', '\t', '=']).unwrap_or(t.len());
    let key = t[..key_len].to_string();
    // Separador: espaços, no máximo um `=`, espaços.
    let mut j = key_len;
    let tb = t.as_bytes();
    while j < tb.len() && (tb[j] == b' ' || tb[j] == b'\t') {
        j += 1;
    }
    if j < tb.len() && tb[j] == b'=' {
        j += 1;
        while j < tb.len() && (tb[j] == b' ' || tb[j] == b'\t') {
            j += 1;
        }
    }
    let rest = &t[j..];
    let (args, rel_end) = split_args(rest);
    let vstart = base + lead + j;
    let vend = if args.is_empty() { vstart } else { vstart + rel_end };
    Kind::Directive { key, args, value: (vstart, vend) }
}

/// Lê o texto inteiro. Nunca falha: linha que o ssh recusaria continua no arquivo como está.
pub fn parse(text: &str) -> Parsed {
    let mut lines = vec![];
    let mut pos = 0;
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    while pos < text.len() {
        let end = text[pos..].find('\n').map(|i| pos + i + 1).unwrap_or(text.len());
        let raw = text[pos..end].trim_end_matches('\n');
        lines.push(Line { start: pos, end, kind: parse_line(raw, pos) });
        pos = end;
    }
    let blocks = blocks_of(&lines);
    Parsed { text: text.to_string(), lines, blocks, eol }
}

fn blocks_of(lines: &[Line]) -> Vec<Block> {
    let headers: Vec<(usize, BlockKind)> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, l)| match l.key_lower().as_deref() {
            Some("host") => Some((i, BlockKind::Host(l.args().to_vec()))),
            Some("match") => Some((i, BlockKind::Match(l.args().to_vec()))),
            _ => None,
        })
        .collect();
    // Comentários colados logo acima de um cabeçalho (sem linha em branco no meio) são dele.
    let attached = |h: usize| {
        let mut f = h;
        while f > 0 && lines[f - 1].is_comment() {
            f -= 1;
        }
        f
    };
    let mut out = vec![];
    let first_header = headers.first().map(|(h, _)| attached(*h)).unwrap_or(lines.len());
    out.push(Block { kind: BlockKind::Global, header: None, first: 0, end: first_header });
    for (n, (h, kind)) in headers.iter().enumerate() {
        let end = headers.get(n + 1).map(|(nh, _)| attached(*nh)).unwrap_or(lines.len());
        out.push(Block { kind: kind.clone(), header: Some(*h), first: attached(*h), end: end.max(h + 1) });
    }
    out
}

/// Padrão concreto: um alias que dá para usar em `ssh <alias>` (sem curinga nem negação).
pub fn is_concrete(pattern: &str) -> bool {
    !pattern.is_empty() && !pattern.contains(['*', '?']) && !pattern.starts_with('!')
}

/// Curinga do ssh (`*` e `?`), usado também nos globs do `Include`.
pub fn wildcard(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0, 0);
    let (mut star, mut mark) = (None, 0);
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = ti;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diretivas_aspas_igual_e_comentario() {
        let p = parse("Host a b\n  HostName=10.0.0.1 # ip\n\tIdentityFile \"~/.ssh/minha chave\"\n# solto\n\nPort 22\r\n");
        assert_eq!(p.lines.len(), 6);
        match &p.lines[1].kind {
            Kind::Directive { key, args, value } => {
                assert_eq!(key, "HostName");
                assert_eq!(args, &vec!["10.0.0.1".to_string()]);
                assert_eq!(&p.text[value.0..value.1], "10.0.0.1");
            }
            k => panic!("{k:?}"),
        }
        assert_eq!(p.lines[2].args(), &["~/.ssh/minha chave".to_string()]);
        let v = match &p.lines[2].kind {
            Kind::Directive { value, .. } => *value,
            _ => unreachable!(),
        };
        assert_eq!(&p.text[v.0..v.1], "\"~/.ssh/minha chave\"");
        assert!(p.lines[3].is_comment());
        assert!(p.lines[4].is_blank());
        assert_eq!(p.lines[5].args(), &["22".to_string()]);
        assert_eq!(p.eol, "\r\n");
    }

    #[test]
    fn blocos_e_comentarios_colados() {
        let p = parse("Include x\n\n# servidor de teste\nHost alfa\n  User dev\n\n# geral\nHost *\n  ServerAliveInterval 30\n");
        assert_eq!(p.blocks.len(), 3);
        assert_eq!(p.blocks[0].kind, BlockKind::Global);
        assert_eq!((p.blocks[0].first, p.blocks[0].end), (0, 2));
        assert_eq!(p.blocks[1].kind, BlockKind::Host(vec!["alfa".into()]));
        assert_eq!((p.blocks[1].first, p.blocks[1].header, p.blocks[1].end), (2, Some(3), 6));
        assert_eq!(p.attached_comment(&p.blocks[1]).as_deref(), Some("servidor de teste"));
        assert_eq!((p.blocks[2].first, p.blocks[2].end), (6, 9));
        assert_eq!(p.indent(), "  ");
    }

    #[test]
    fn curingas() {
        assert!(wildcard("*.example.com", "a.example.com"));
        assert!(wildcard("web-??", "web-01"));
        assert!(!wildcard("web-??", "web-1"));
        assert!(wildcard("*", ""));
        assert!(is_concrete("Acme/Prod"));
        assert!(!is_concrete("*"));
        assert!(!is_concrete("!bastion"));
    }

    #[test]
    fn aspas_com_escape_e_hash_no_meio() {
        let p = parse("ProxyCommand ssh -W %h:%p bastion#1 \"a \\\"b\\\"\" #fim\n");
        assert_eq!(p.lines[0].args(), &["ssh", "-W", "%h:%p", "bastion#1", "a \"b\""].map(String::from));
    }
}
