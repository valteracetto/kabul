//! Ações de git e GitHub do workspace: escopo do diff, status (sujo, à frente/atrás, conflitos),
//! pull/push, descartar arquivo, busca nos arquivos e o PR via `gh` (status, merge, ready, editar,
//! re-rodar checks, logs, comentários). Tudo que fala com o GitHub aceita `dry_run`: monta e devolve
//! os comandos sem executar.
use crate::harness::shell_quote;
use crate::store::{FileChange, Repo, Store, Workspace};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

fn run(dir: &Path, bin: &str, args: &[&str]) -> Result<(bool, String, String)> {
    let o = crate::shell::command(bin).args(args).current_dir(dir).output().with_context(|| format!("falha ao executar {bin}"))?;
    Ok((o.status.success(), String::from_utf8_lossy(&o.stdout).into_owned(), String::from_utf8_lossy(&o.stderr).into_owned()))
}

fn git(dir: &Path, args: &[&str]) -> Result<String> {
    let (ok, out, err) = run(dir, "git", args)?;
    if !ok {
        bail!("git {}: {}", args.join(" "), err.trim());
    }
    Ok(out.trim_end().to_string())
}

fn cmdline(bin: &str, args: &[&str]) -> String {
    std::iter::once(bin.to_string()).chain(args.iter().map(|a| if a.chars().all(|c| c.is_ascii_alphanumeric() || "-_./:=@".contains(c)) { a.to_string() } else { shell_quote(a) })).collect::<Vec<_>>().join(" ")
}

/// Resultado de uma ação: comandos (sempre) e saída (quando executou).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Outcome {
    pub ok: bool,
    pub dry_run: bool,
    pub commands: Vec<String>,
    pub output: String,
}

/// Roda os comandos em sequência (ou só lista, em dry-run); para no primeiro erro.
fn sequence(dir: &Path, steps: &[(&str, Vec<&str>)], dry_run: bool) -> Result<Outcome> {
    let commands: Vec<String> = steps.iter().map(|(b, a)| cmdline(b, a)).collect();
    if dry_run {
        return Ok(Outcome { ok: true, dry_run, commands, output: String::new() });
    }
    let mut output = String::new();
    for (bin, args) in steps {
        let (ok, out, err) = run(dir, bin, args)?;
        output.push_str(&out);
        output.push_str(&err);
        if !ok {
            bail!("{}: {}", cmdline(bin, args), err.trim());
        }
    }
    Ok(Outcome { ok: true, dry_run, commands, output: output.trim().to_string() })
}

// ---------------- branch alvo e escopo do diff ----------------

/// Remote do repo (Configurações › Git › Remote; padrão `origin`).
pub fn remote(repo: &Repo) -> String {
    let (s, _) = crate::settings::load(Path::new(&repo.path), &repo.default_branch);
    // Vem do settings.toml versionado do repo: nome com `-` na frente viraria opção do git.
    s.remote.filter(|r| valid_remote(r)).unwrap_or_else(|| "origin".into())
}

pub fn valid_remote(r: &str) -> bool {
    !r.is_empty() && r.len() <= 100 && !r.starts_with('-') && r.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
}

/// Caminho relativo dentro do workspace (sem `..`, absoluto ou opção). Arquivos de fora nunca entram
/// no diff (no kabuld, convidados chamam `workspace_file_diff`).
pub fn safe_rel(file: &str) -> Result<&str> {
    let p = Path::new(file);
    let ok = !file.is_empty() && !file.starts_with('-') && !file.contains('\0') && p.is_relative() && p.components().all(|c| matches!(c, std::path::Component::Normal(_) | std::path::Component::CurDir));
    anyhow::ensure!(ok, "caminho inválido: {file:?}");
    Ok(file)
}

/// Remotes configurados no repo (`git remote`).
pub fn remotes(repo_path: &Path) -> Vec<String> {
    git(repo_path, &["remote"]).map(|s| s.lines().map(String::from).filter(|l| !l.is_empty()).collect()).unwrap_or_default()
}

pub fn merge_flag(method: &str) -> &'static str {
    match method {
        "merge" => "--merge",
        "rebase" => "--rebase",
        _ => "--squash",
    }
}

/// Onde abrir o PR: `github` (o link do PR), `linear` (a issue ligada, se houver) ou `graphite`.
pub fn pr_open_url(target: &str, pr_url: &str, linear_url: Option<&str>) -> String {
    match target {
        "linear" => linear_url.unwrap_or(pr_url).to_string(),
        "graphite" => {
            // https://github.com/<owner>/<repo>/pull/<n> → https://app.graphite.dev/github/pr/<owner>/<repo>/<n>
            let parts: Vec<&str> = pr_url.trim_end_matches('/').split('/').collect();
            match parts.as_slice() {
                [.., owner, name, "pull", n] => format!("https://app.graphite.dev/github/pr/{owner}/{name}/{n}"),
                _ => pr_url.to_string(),
            }
        }
        _ => pr_url.to_string(),
    }
}

/// Identidade do git (nome, e-mail) e de onde vem: `repo` (config local) ou `global`.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct Identity {
    pub name: String,
    pub email: String,
    pub scope: String,
    pub global_name: String,
    pub global_email: String,
}

pub fn identity(repo_path: &Path) -> Identity {
    let get = |args: &[&str]| git(repo_path, args).unwrap_or_default();
    let (ln, le) = (get(&["config", "--local", "user.name"]), get(&["config", "--local", "user.email"]));
    let (gn, ge) = (get(&["config", "--global", "user.name"]), get(&["config", "--global", "user.email"]));
    let local = !ln.is_empty() || !le.is_empty();
    Identity { name: if ln.is_empty() { gn.clone() } else { ln }, email: if le.is_empty() { ge.clone() } else { le }, scope: if local { "repo".into() } else { "global".into() }, global_name: gn, global_email: ge }
}

/// Grava nome/e-mail no config local do repo (vale para todos os worktrees); vazio remove.
pub fn set_identity(repo_path: &Path, name: &str, email: &str) -> Result<()> {
    for (k, v) in [("user.name", name), ("user.email", email)] {
        if v.trim().is_empty() {
            let _ = git(repo_path, &["config", "--local", "--unset", k]);
        } else {
            git(repo_path, &["config", "--local", k, v.trim()])?;
        }
    }
    Ok(())
}

/// Marca quais checks são obrigatórios (nomes de `gh pr checks --required`).
pub fn mark_required(checks: &mut [Value], required: &[String]) {
    for c in checks.iter_mut() {
        let name = c.get("name").and_then(Value::as_str).unwrap_or("").to_string();
        if let Some(o) = c.as_object_mut() {
            o.insert("required".into(), Value::Bool(required.contains(&name)));
        }
    }
}

/// Checks que falharam e bloqueiam o merge: só os obrigatórios, ou todos com "optional as blocking".
pub fn blocking_failures(checks: &[Value], optional_blocking: bool) -> Vec<String> {
    checks
        .iter()
        .filter(|c| c.get("bucket").and_then(Value::as_str) == Some("fail"))
        .filter(|c| optional_blocking || c.get("required").and_then(Value::as_bool).unwrap_or(true))
        .filter_map(|c| c.get("name").and_then(Value::as_str).map(String::from))
        .collect()
}

/// Checks do PR (`gh pr checks`), com `required` marcado.
pub fn pr_checks(ws: &Workspace) -> Result<(Vec<Value>, Option<String>)> {
    let p = Path::new(&ws.path);
    let (_, out, err) = run(p, &gh(), &["pr", "checks", "--json", "name,state,bucket,link,workflow,startedAt,completedAt,description"])?;
    match serde_json::from_str::<Vec<Value>>(&out) {
        Ok(mut checks) => {
            let (_, req, _) = run(p, &gh(), &["pr", "checks", "--required", "--json", "name"])?;
            let names: Vec<String> = serde_json::from_str::<Vec<Value>>(&req).unwrap_or_default().iter().filter_map(|c| c.get("name").and_then(Value::as_str).map(String::from)).collect();
            mark_required(&mut checks, &names);
            Ok((checks.clone(), checks.is_empty().then(|| "O PR não tem checks configurados.".into())))
        }
        Err(_) => {
            let e = err.trim().to_string();
            let msg = if e.contains("no pull requests found") || e.contains("no default remote") || e.contains("not a git repository") || e.contains("none of the git remotes") {
                "Sem PR aberto para esta branch.".to_string()
            } else if e.is_empty() {
                "Sem checks.".into()
            } else {
                e
            };
            Ok((vec![], Some(msg)))
        }
    }
}

/// Branch alvo do workspace (a do workspace, senão a padrão do repo).
pub fn target(repo: &Repo, ws: &Workspace) -> String {
    ws.target_branch.clone().filter(|t| !t.is_empty()).unwrap_or_else(|| repo.default_branch.clone())
}

/// Ref da branch alvo: `origin/<alvo>` se existir, senão `<alvo>`.
pub fn target_ref(repo: &Repo, ws: &Workspace) -> String {
    let t = target(repo, ws);
    let remote = format!("{}/{t}", remote(repo));
    if git(Path::new(&ws.path), &["rev-parse", "--verify", "-q", &remote]).is_ok() {
        remote
    } else if git(Path::new(&ws.path), &["rev-parse", "--verify", "-q", &t]).is_ok() {
        t
    } else {
        Store::base_ref(repo)
    }
}

/// Escopo do diff: tudo contra a alvo, só os commits da branch ou só o não commitado.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    #[default]
    All,
    Branch,
    Uncommitted,
}

impl Scope {
    pub fn parse(s: Option<&str>) -> Scope {
        match s {
            Some("branch") => Scope::Branch,
            Some("uncommitted") => Scope::Uncommitted,
            _ => Scope::All,
        }
    }
}

/// Argumentos do `git diff` para o escopo (sem o caminho).
fn range(repo: &Repo, ws: &Workspace, scope: Scope) -> Result<Vec<String>> {
    let p = Path::new(&ws.path);
    Ok(match scope {
        Scope::Uncommitted => vec!["HEAD".into()],
        Scope::Branch => vec![format!("{}..HEAD", git(p, &["merge-base", "HEAD", &target_ref(repo, ws)])?)],
        Scope::All => vec![git(p, &["merge-base", "HEAD", &target_ref(repo, ws)])?],
    })
}

/// Arquivos mudados no escopo (não rastreados entram em "tudo" e "não commitado").
pub fn changes(repo: &Repo, ws: &Workspace, scope: Scope) -> Result<Vec<FileChange>> {
    let p = Path::new(&ws.path);
    let r = range(repo, ws, scope)?;
    let mut args = vec!["diff", "--numstat"];
    args.extend(r.iter().map(String::as_str));
    let mut v = crate::store::parse_numstat(&git(p, &args)?);
    if scope != Scope::Branch {
        for f in git(p, &["ls-files", "--others", "--exclude-standard"])?.lines().filter(|l| !l.is_empty()) {
            let n = std::fs::read_to_string(p.join(f)).map(|s| s.lines().count() as u32).ok();
            v.push(FileChange { path: f.into(), added: n, removed: Some(0), untracked: true });
        }
    }
    Ok(v)
}

/// Diff de um arquivo no escopo. `ignore_ws` = "Hide whitespace changes" (`-w`).
pub fn file_diff(repo: &Repo, ws: &Workspace, file: &str, scope: Scope, ignore_ws: bool) -> Result<String> {
    let file = safe_rel(file)?;
    let p = Path::new(&ws.path);
    let r = range(repo, ws, scope)?;
    let mut args = vec!["diff", "--no-color"];
    if ignore_ws {
        args.push("-w");
    }
    args.extend(r.iter().map(String::as_str));
    args.extend(["--", file]);
    let d = git(p, &args)?;
    if !d.is_empty() || scope == Scope::Branch || git(p, &["ls-files", "--error-unmatch", "--", file]).is_ok() {
        return Ok(d);
    }
    let (_, out, _) = run(p, "git", &["diff", "--no-color", "--no-index", "--", "/dev/null", file])?;
    Ok(out)
}

/// Descarta as mudanças de um arquivo: rastreado volta ao HEAD; não rastreado é apagado.
pub fn discard(ws: &Workspace, file: &str) -> Result<()> {
    let _inv = Invalidate(&ws.path);
    let p = Path::new(&ws.path);
    let file = safe_rel(file)?;
    let tracked = git(p, &["ls-files", "--error-unmatch", "--", file]).is_ok();
    if tracked {
        git(p, &["checkout", "HEAD", "--", file])?;
    } else {
        std::fs::remove_file(p.join(file)).context("apagando o arquivo")?;
    }
    Ok(())
}

// ---------------- status ----------------

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct GitStatus {
    pub branch: String,
    pub target: String,
    pub upstream: Option<String>,
    /// Arquivos com mudanças não commitadas (inclui não rastreados).
    pub dirty: u32,
    /// Commits à frente / atrás do upstream (origin/<branch>).
    pub ahead: u32,
    pub behind: u32,
    /// Commits da alvo que a branch ainda não tem.
    pub behind_target: u32,
    /// Arquivos que dariam conflito ao juntar com a alvo (ou em conflito agora).
    pub conflicts: Vec<String>,
}

pub fn status(repo: &Repo, ws: &Workspace) -> Result<GitStatus> {
    let p = Path::new(&ws.path);
    let porcelain = git(p, &["status", "--porcelain"])?;
    let mut conflicts: Vec<String> = porcelain.lines().filter(|l| l.len() > 3 && matches!(&l[..2], "UU" | "AA" | "DD" | "AU" | "UA" | "DU" | "UD")).map(|l| l[3..].to_string()).collect();
    // O worktree nasce rastreando origin/<alvo>; "remoto" aqui é a própria branch no origin.
    let branch = git(p, &["branch", "--show-current"]).unwrap_or_default();
    let upstream = git(p, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).ok().filter(|u| u.ends_with(&format!("/{branch}"))).or_else(|| {
        let r = format!("origin/{branch}");
        git(p, &["rev-parse", "--verify", "-q", &r]).ok().map(|_| r)
    });
    let count = |a: &str| git(p, &["rev-list", "--count", a]).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(0);
    let (ahead, behind) = match &upstream {
        Some(u) => (count(&format!("{u}..HEAD")), count(&format!("HEAD..{u}"))),
        None => (0, 0),
    };
    let tref = target_ref(repo, ws);
    if conflicts.is_empty() {
        // `merge-tree --write-tree` (git ≥ 2.38) simula o merge sem tocar no worktree.
        let (ok, out, _) = run(p, "git", &["merge-tree", "--write-tree", "--name-only", "--no-messages", "HEAD", &tref])?;
        if !ok {
            conflicts = out.lines().skip(1).filter(|l| !l.is_empty()).map(String::from).collect();
        }
    }
    Ok(GitStatus { branch, target: target(repo, ws), upstream, dirty: porcelain.lines().filter(|l| !l.is_empty()).count() as u32, ahead, behind, behind_target: count(&format!("HEAD..{tref}")), conflicts })
}

/// Traz os commits da própria branch no remote (não da alvo).
pub fn pull(ws: &Workspace, remote: &str, dry_run: bool) -> Result<Outcome> {
    let _inv = Invalidate(&ws.path);
    let p = Path::new(&ws.path);
    let branch = git(p, &["branch", "--show-current"]).unwrap_or_else(|_| ws.branch.clone());
    sequence(p, &[("git", vec!["pull", "--no-rebase", "--no-edit", remote, branch.as_str()])], dry_run)
}

/// `git push [-u] <remote> HEAD` (o `-u` vem de Configurações › Git › "Set upstream").
pub fn push(ws: &Workspace, remote: &str, set_upstream: bool, dry_run: bool) -> Result<Outcome> {
    let _inv = Invalidate(&ws.path);
    let mut args = vec!["push"];
    if set_upstream {
        args.push("-u");
    }
    args.extend([remote, "HEAD"]);
    sequence(Path::new(&ws.path), &[("git", args)], dry_run)
}

// ---------------- busca ----------------

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GrepHit {
    pub path: String,
    pub line: u32,
    pub text: String,
}

/// Busca de texto nos arquivos do workspace (rastreados e não ignorados), sem diferenciar maiúsculas.
pub fn grep(ws: &Workspace, query: &str, max: usize) -> Result<Vec<GrepHit>> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    let (_, out, _) = run(Path::new(&ws.path), "git", &["grep", "-n", "-I", "-i", "-F", "--untracked", "--no-color", "-e", query])?;
    Ok(parse_grep(&out, max))
}

pub fn parse_grep(out: &str, max: usize) -> Vec<GrepHit> {
    out.lines()
        .filter_map(|l| {
            let (path, rest) = l.split_once(':')?;
            let (n, text) = rest.split_once(':')?;
            Some(GrepHit { path: path.into(), line: n.parse().ok()?, text: text.chars().take(240).collect() })
        })
        .take(max)
        .collect()
}

// ---------------- PR (gh) ----------------

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct PrComment {
    pub author: String,
    pub body: String,
    pub url: Option<String>,
    pub path: Option<String>,
    pub line: Option<u32>,
    /// `comment` (conversa), `review` (resumo da revisão) ou `inline` (linha do diff).
    pub kind: String,
    pub state: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct PrInfo {
    pub number: u32,
    pub title: String,
    pub body: String,
    pub url: String,
    /// OPEN, MERGED, CLOSED
    pub state: String,
    pub is_draft: bool,
    /// MERGEABLE, CONFLICTING, UNKNOWN
    pub mergeable: String,
    /// CLEAN, BLOCKED, BEHIND, DIRTY, UNSTABLE, HAS_HOOKS, DRAFT, UNKNOWN
    pub merge_state: String,
    /// APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED ou vazio
    pub review_decision: String,
    pub head: String,
    pub base: String,
    pub comments: Vec<PrComment>,
}

pub const PR_FIELDS: &str = "number,title,body,url,state,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefName,baseRefName,reviews,comments";

fn st(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or("").to_string()
}

pub fn parse_pr(json: &str) -> Option<PrInfo> {
    let v: Value = serde_json::from_str(json).ok()?;
    let author = |c: &Value| c.get("author").and_then(|a| a.get("login")).and_then(Value::as_str).unwrap_or("").to_string();
    let mut comments: Vec<PrComment> =
        v.get("comments").and_then(Value::as_array).into_iter().flatten().map(|c| PrComment { author: author(c), body: st(c, "body"), url: Some(st(c, "url")).filter(|s| !s.is_empty()), kind: "comment".into(), ..Default::default() }).collect();
    comments.extend(v.get("reviews").and_then(Value::as_array).into_iter().flatten().filter(|r| !st(r, "body").trim().is_empty() || st(r, "state") == "CHANGES_REQUESTED" || st(r, "state") == "APPROVED").map(|r| PrComment {
        author: author(r),
        body: st(r, "body"),
        kind: "review".into(),
        state: Some(st(r, "state")),
        ..Default::default()
    }));
    Some(PrInfo {
        number: v.get("number")?.as_u64()? as u32,
        title: st(&v, "title"),
        body: st(&v, "body"),
        url: st(&v, "url"),
        state: st(&v, "state"),
        is_draft: v.get("isDraft").and_then(Value::as_bool).unwrap_or(false),
        mergeable: st(&v, "mergeable"),
        merge_state: st(&v, "mergeStateStatus"),
        review_decision: st(&v, "reviewDecision"),
        head: st(&v, "headRefName"),
        base: st(&v, "baseRefName"),
        comments,
    })
}

/// Comentários de linha do PR (`gh api .../pulls/N/comments`).
pub fn parse_inline_comments(json: &str) -> Vec<PrComment> {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    v.as_array()
        .into_iter()
        .flatten()
        .map(|c| PrComment {
            author: c.get("user").and_then(|u| u.get("login")).and_then(Value::as_str).unwrap_or("").into(),
            body: st(c, "body"),
            url: Some(st(c, "html_url")).filter(|s| !s.is_empty()),
            path: Some(st(c, "path")).filter(|s| !s.is_empty()),
            line: c.get("line").or_else(|| c.get("original_line")).and_then(Value::as_u64).map(|n| n as u32),
            kind: "inline".into(),
            state: None,
        })
        .collect()
}

fn gh() -> String {
    crate::harness::which("gh").map(|p| p.display().to_string()).unwrap_or_else(|| "gh".into())
}

/// PR da branch do workspace, com comentários de conversa, revisões e de linha. `None` sem PR.
pub fn pr_view(ws: &Workspace) -> Result<Option<PrInfo>> {
    let p = Path::new(&ws.path);
    let (ok, out, err) = run(p, &gh(), &["pr", "view", "--json", PR_FIELDS])?;
    if !ok {
        let e = err.to_lowercase();
        if e.contains("no pull requests found") || e.contains("no default remote") || e.contains("none of the git remotes") || e.contains("not a git repository") {
            return Ok(None);
        }
        bail!("gh pr view: {}", err.trim());
    }
    let Some(mut pr) = parse_pr(&out) else { return Ok(None) };
    let path = format!("repos/{{owner}}/{{repo}}/pulls/{}/comments", pr.number);
    if let Ok((true, out, _)) = run(p, &gh(), &["api", &path]) {
        pr.comments.extend(parse_inline_comments(&out));
    }
    Ok(Some(pr))
}

/// `squash` (padrão), `merge` ou `rebase`.
pub fn pr_merge(ws: &Workspace, method: &str, delete_branch: bool, dry_run: bool) -> Result<Outcome> {
    let _inv = Invalidate(&ws.path);
    let mut args = vec!["pr", "merge", merge_flag(method)];
    if delete_branch {
        args.push("--delete-branch");
    }
    sequence(Path::new(&ws.path), &[("gh", args)], dry_run)
}

pub fn pr_ready(ws: &Workspace, dry_run: bool) -> Result<Outcome> {
    let _inv = Invalidate(&ws.path);
    sequence(Path::new(&ws.path), &[("gh", vec!["pr", "ready"])], dry_run)
}

pub fn pr_edit(ws: &Workspace, title: &str, body: &str, dry_run: bool) -> Result<Outcome> {
    let _inv = Invalidate(&ws.path);
    sequence(Path::new(&ws.path), &[("gh", vec!["pr", "edit", "--title", title, "--body", body])], dry_run)
}

/// Fecha o PR (usado em "Archive and close PR").
pub fn pr_close(ws: &Workspace, dry_run: bool) -> Result<Outcome> {
    let _inv = Invalidate(&ws.path);
    sequence(Path::new(&ws.path), &[("gh", vec!["pr", "close"])], dry_run)
}

/// (run, job) a partir do link de um check do Actions.
pub fn run_job(link: &str) -> Option<(String, Option<String>)> {
    let rest = link.split("/actions/runs/").nth(1)?;
    let mut it = rest.split('/');
    let run = it.next()?.split(['?', '#']).next()?.to_string();
    let job = match (it.next(), it.next()) {
        (Some("job"), Some(j)) => Some(j.split(['?', '#']).next()?.to_string()),
        _ => None,
    };
    run.chars().all(|c| c.is_ascii_digit()).then_some((run, job))
}

/// Re-roda os jobs que falharam nos runs dos links dados (um `gh run rerun --failed` por run).
pub fn checks_rerun(ws: &Workspace, links: &[String], dry_run: bool) -> Result<Outcome> {
    let _inv = Invalidate(&ws.path);
    let mut runs: Vec<String> = links.iter().filter_map(|l| run_job(l).map(|(r, _)| r)).collect();
    runs.sort();
    runs.dedup();
    anyhow::ensure!(!runs.is_empty(), "nenhum check do GitHub Actions para re-rodar");
    let steps: Vec<(&str, Vec<&str>)> = runs.iter().map(|r| ("gh", vec!["run", "rerun", r.as_str(), "--failed"])).collect();
    sequence(Path::new(&ws.path), &steps, dry_run)
}

/// Log do check (só as etapas que falharam; se não houver, o log inteiro), cortado nas últimas linhas.
pub fn check_log(ws: &Workspace, link: &str, max_lines: usize) -> Result<String> {
    let (run_id, job) = run_job(link).context("o check não é do GitHub Actions; abra o link")?;
    let p = Path::new(&ws.path);
    let mut base = vec!["run", "view", run_id.as_str()];
    if let Some(j) = &job {
        base.extend(["--job", j.as_str()]);
    }
    let mut failed = base.clone();
    failed.push("--log-failed");
    let (ok, mut out, err) = run(p, &gh(), &failed)?;
    if !ok || out.trim().is_empty() {
        let mut all = base.clone();
        all.push("--log");
        let (ok2, out2, err2) = run(p, &gh(), &all)?;
        if !ok2 {
            bail!("gh run view: {}", if err2.trim().is_empty() { err.trim() } else { err2.trim() });
        }
        out = out2;
    }
    Ok(tail(&out, max_lines))
}

pub fn tail(s: &str, n: usize) -> String {
    let lines: Vec<&str> = s.lines().collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

// ---------------- cache (TTL) ----------------

/// `git status` são ~7 processos git; com o frontend consultando vários workspaces, o mesmo
/// resultado serve por alguns segundos (e o watcher de arquivos invalida antes, quando houver).
pub const STATUS_TTL: std::time::Duration = std::time::Duration::from_secs(2);
/// `gh pr view` / `gh pr checks` vão à rede: 30 s / 20 s (ações do Kabul invalidam na hora).
pub const PR_TTL: std::time::Duration = std::time::Duration::from_secs(30);
pub const CHECKS_TTL: std::time::Duration = std::time::Duration::from_secs(20);

static STATUS: crate::cache::TtlCache<GitStatus> = crate::cache::TtlCache::new(2048);
static PR: crate::cache::TtlCache<Option<PrInfo>> = crate::cache::TtlCache::new(2048);
static CHECKS: crate::cache::TtlCache<(Vec<Value>, Option<String>)> = crate::cache::TtlCache::new(2048);

fn key(ws: &Workspace, what: &str) -> String {
    format!("{}\u{0}{}\u{0}{what}", ws.path, ws.branch)
}

/// Esquece o que estiver guardado do workspace (arquivos mudaram, push, merge...).
pub fn invalidate(ws_path: &str) {
    let prefix = format!("{ws_path}\u{0}");
    STATUS.invalidate(&prefix);
    PR.invalidate(&prefix);
    CHECKS.invalidate(&prefix);
}

/// Invalida ao sair da função (depois da escrita, para não guardar o estado de antes).
struct Invalidate<'a>(&'a str);
impl Drop for Invalidate<'_> {
    fn drop(&mut self) {
        invalidate(self.0);
    }
}

pub fn status_cached(repo: &Repo, ws: &Workspace) -> Result<GitStatus> {
    STATUS.get_or(&key(ws, "status"), STATUS_TTL, || status(repo, ws))
}

pub fn pr_view_cached(ws: &Workspace) -> Result<Option<PrInfo>> {
    PR.get_or(&key(ws, "pr"), PR_TTL, || pr_view(ws))
}

pub fn pr_checks_cached(ws: &Workspace) -> Result<(Vec<Value>, Option<String>)> {
    CHECKS.get_or(&key(ws, "checks"), CHECKS_TTL, || pr_checks(ws))
}

#[cfg(test)]
mod tests {
    #[test]
    fn caminhos_e_remotes_seguros() {
        for ok in ["a.txt", "src/main.rs", "./x/y", "com espaço.md"] {
            assert!(super::safe_rel(ok).is_ok(), "{ok}");
        }
        for bad in ["", "/etc/passwd", "../x", "a/../../b", "-x", "--output=/tmp/x"] {
            assert!(super::safe_rel(bad).is_err(), "{bad}");
        }
        assert!(super::valid_remote("origin") && super::valid_remote("upstream-2"));
        assert!(!super::valid_remote("--upload-pack=x") && !super::valid_remote("a b") && !super::valid_remote(""));
    }

    use super::*;

    fn g(d: &Path, a: &[&str]) {
        let o = crate::shell::command("git").arg("-C").arg(d).args(["-c", "user.name=dev", "-c", "user.email=dev@example.com"]).args(a).output().unwrap();
        assert!(o.status.success(), "{a:?}: {}", String::from_utf8_lossy(&o.stderr));
    }

    #[test]
    fn escopo_status_pull_push_descartar_busca() {
        let tmp = std::env::temp_dir().join(format!("kabul-gitops-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let origin = tmp.join("origin.git");
        let repo = tmp.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        g(&tmp, &["init", "-q", "--bare", "-b", "main", origin.to_str().unwrap()]);
        g(&repo, &["init", "-q", "-b", "main"]);
        std::fs::write(repo.join("a.txt"), "um\ndois\n").unwrap();
        g(&repo, &["add", "."]);
        g(&repo, &["commit", "-qm", "i"]);
        g(&repo, &["remote", "add", "origin", origin.to_str().unwrap()]);
        g(&repo, &["push", "-q", "-u", "origin", "main"]);

        let mut s = Store::open(tmp.join("state.json"), tmp.join("ws"), "dev".into()).unwrap();
        let r = s.add_repo(&repo).unwrap();
        let w = s.create_workspace(&r.id).unwrap();
        let wp = Path::new(&w.path);

        // Commit na branch + mudança não commitada + arquivo novo.
        std::fs::write(wp.join("a.txt"), "um\ndois\ntres\n").unwrap();
        g(wp, &["commit", "-qam", "tres"]);
        std::fs::write(wp.join("a.txt"), "um\ndois\ntres\nquatro\n").unwrap();
        std::fs::write(wp.join("novo.txt"), "x\n").unwrap();
        let all = changes(&r, &w, Scope::All).unwrap();
        assert_eq!(all.iter().map(|c| c.path.as_str()).collect::<Vec<_>>(), ["a.txt", "novo.txt"]);
        assert_eq!(all[0].added, Some(2));
        let br = changes(&r, &w, Scope::Branch).unwrap();
        assert_eq!((br.len(), br[0].added), (1, Some(1)));
        let un = changes(&r, &w, Scope::Uncommitted).unwrap();
        assert_eq!((un.len(), un[0].added), (2, Some(1)));
        assert!(file_diff(&r, &w, "a.txt", Scope::Uncommitted, false).unwrap().contains("+quatro"));
        assert!(!file_diff(&r, &w, "a.txt", Scope::Uncommitted, false).unwrap().contains("+tres"));
        assert!(file_diff(&r, &w, "novo.txt", Scope::All, false).unwrap().contains("+x"));

        // Mudança só de espaço some com -w.
        std::fs::write(wp.join("a.txt"), "um  \ndois\ntres\n").unwrap();
        assert!(file_diff(&r, &w, "a.txt", Scope::Uncommitted, false).unwrap().contains("+um  "));
        assert_eq!(file_diff(&r, &w, "a.txt", Scope::Uncommitted, true).unwrap(), "");

        // Busca.
        let hits = grep(&w, "DOIS", 10).unwrap();
        assert_eq!(hits, vec![GrepHit { path: "a.txt".into(), line: 2, text: "dois".into() }]);

        // Status: 2 sujos, sem upstream; descartar volta ao HEAD e apaga o não rastreado.
        let st = status(&r, &w).unwrap();
        assert_eq!((st.dirty, st.upstream.as_deref(), st.target.as_str(), st.conflicts.len()), (2, None, "main", 0));
        discard(&w, "a.txt").unwrap();
        discard(&w, "novo.txt").unwrap();
        assert!(!wp.join("novo.txt").exists());
        assert_eq!(status(&r, &w).unwrap().dirty, 0);
        assert!(discard(&w, "../fora").is_err());

        // Push (dry-run só lista; de verdade vai para o origin local) e pull.
        let o = push(&w, "origin", true, true).unwrap();
        assert_eq!((o.dry_run, o.commands.as_slice()), (true, ["git push -u origin HEAD".to_string()].as_slice()));
        assert_eq!(push(&w, "origin", false, true).unwrap().commands, ["git push origin HEAD"]);
        push(&w, &remote(&r), true, false).unwrap();
        let st = status(&r, &w).unwrap();
        assert_eq!((st.upstream.as_deref(), st.ahead, st.behind), (Some("origin/dev/kabul"), 0, 0));
        // Outro clone empurra um commit na mesma branch: fica 1 atrás; pull traz.
        let other = tmp.join("other");
        g(&tmp, &["clone", "-q", "-b", "dev/kabul", origin.to_str().unwrap(), other.to_str().unwrap()]);
        std::fs::write(other.join("b.txt"), "b\n").unwrap();
        g(&other, &["add", "."]);
        g(&other, &["commit", "-qm", "b"]);
        g(&other, &["push", "-q"]);
        g(wp, &["fetch", "-q"]);
        assert_eq!(status(&r, &w).unwrap().behind, 1);
        assert_eq!(pull(&w, "origin", true).unwrap().commands, ["git pull --no-rebase --no-edit origin dev/kabul"]);
        pull(&w, "origin", false).unwrap();
        assert!(wp.join("b.txt").exists());

        // Conflito com a alvo: main muda a mesma linha.
        std::fs::write(repo.join("a.txt"), "UM\ndois\n").unwrap();
        g(&repo, &["commit", "-qam", "conflito"]);
        g(&repo, &["push", "-q"]);
        g(wp, &["fetch", "-q"]);
        std::fs::write(wp.join("a.txt"), "Um!\ndois\ntres\n").unwrap();
        g(wp, &["commit", "-qam", "meu"]);
        let st = status(&r, &w).unwrap();
        assert_eq!((st.behind_target, st.conflicts.clone()), (1, vec!["a.txt".to_string()]));

        // Identidade do git no repo (local) por cima da global.
        set_identity(&repo, "Dev Kabul", "dev@example.com").unwrap();
        let id = identity(wp);
        assert_eq!((id.name.as_str(), id.email.as_str(), id.scope.as_str()), ("Dev Kabul", "dev@example.com", "repo"));
        set_identity(&repo, "", "").unwrap();
        assert_eq!(identity(&repo).scope, "global");

        // Remote e branch base vindos das configurações do repo.
        g(&repo, &["remote", "add", "upstream", origin.to_str().unwrap()]);
        g(&repo, &["fetch", "-q", "upstream"]);
        g(&repo, &["push", "-q", "upstream", "main:release"]);
        g(&repo, &["fetch", "-q", "upstream"]);
        assert_eq!(remotes(&repo), ["origin", "upstream"]);
        std::fs::create_dir_all(repo.join(".kabul")).unwrap();
        std::fs::write(repo.join(".kabul/settings.local.toml"), "remote = \"upstream\"\nbase_branch = \"release\"\n").unwrap();
        assert_eq!(remote(&r), "upstream");
        assert_eq!(Store::base_ref(&r), "upstream/release");
        let w3 = s.create_workspace(&r.id).unwrap();
        assert_eq!(git(Path::new(&w3.path), &["rev-parse", "HEAD"]).unwrap(), git(&repo, &["rev-parse", "upstream/release"]).unwrap());
        assert_eq!(target_ref(&r, &w3), "upstream/main");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn abrir_pr_em_e_checks_obrigatorios() {
        let u = "https://github.com/dev/demo/pull/7";
        assert_eq!(pr_open_url("github", u, Some("https://linear.app/x/issue/ENG-1")), u);
        assert_eq!(pr_open_url("linear", u, Some("https://linear.app/x/issue/ENG-1")), "https://linear.app/x/issue/ENG-1");
        assert_eq!(pr_open_url("linear", u, None), u);
        assert_eq!(pr_open_url("graphite", u, None), "https://app.graphite.dev/github/pr/dev/demo/7");
        let mut c: Vec<Value> = serde_json::from_str(r#"[{"name":"build","bucket":"fail"},{"name":"lint","bucket":"fail"},{"name":"e2e","bucket":"pass"}]"#).unwrap();
        mark_required(&mut c, &["build".into()]);
        assert_eq!(c[1]["required"], Value::Bool(false));
        assert_eq!(blocking_failures(&c, false), ["build"]);
        assert_eq!(blocking_failures(&c, true), ["build", "lint"]);
    }

    #[test]
    fn pr_json_e_links() {
        let j = r#"{"number":7,"title":"Corrige login","body":"desc","url":"https://github.com/dev/demo/pull/7","state":"OPEN","isDraft":true,"mergeable":"CONFLICTING","mergeStateStatus":"DIRTY","reviewDecision":"CHANGES_REQUESTED","headRefName":"dev/kabul","baseRefName":"main",
            "comments":[{"author":{"login":"rev"},"body":"Faltou teste","url":"https://github.com/dev/demo/pull/7#c1"}],
            "reviews":[{"author":{"login":"rev"},"body":"","state":"COMMENTED"},{"author":{"login":"rev"},"body":"Mude o nome","state":"CHANGES_REQUESTED"}]}"#;
        let p = parse_pr(j).unwrap();
        assert_eq!((p.number, p.is_draft, p.mergeable.as_str(), p.review_decision.as_str()), (7, true, "CONFLICTING", "CHANGES_REQUESTED"));
        assert_eq!(p.comments.len(), 2);
        assert_eq!((p.comments[1].kind.as_str(), p.comments[1].state.as_deref()), ("review", Some("CHANGES_REQUESTED")));
        let inl = parse_inline_comments(r#"[{"user":{"login":"rev"},"body":"nome ruim","path":"src/a.rs","line":12,"html_url":"https://github.com/dev/demo/pull/7#r1"}]"#);
        assert_eq!((inl[0].path.as_deref(), inl[0].line, inl[0].kind.as_str()), (Some("src/a.rs"), Some(12), "inline"));
        assert_eq!(run_job("https://github.com/dev/demo/actions/runs/123/job/456"), Some(("123".into(), Some("456".into()))));
        assert_eq!(run_job("https://github.com/dev/demo/actions/runs/99?pr=1"), Some(("99".into(), None)));
        assert_eq!(run_job("https://vercel.com/x"), None);
        let ws = Workspace {
            id: "w".into(),
            repo_id: "r".into(),
            name: "kabul".into(),
            branch: "dev/kabul".into(),
            path: std::env::temp_dir().display().to_string(),
            archived: false,
            created_at: 0,
            title: None,
            status: "in-progress".into(),
            state: "ready".into(),
            pinned: false,
            notes: String::new(),
            port: 41000,
            target_branch: None,
            pr_url: None,
            archive_checkpoint: None,
            user_set_branch: false,
            files_copied: 0,
            linear: None,
            ..Default::default()
        };
        let o = checks_rerun(&ws, &["https://github.com/dev/demo/actions/runs/123/job/1".into(), "https://github.com/dev/demo/actions/runs/123/job/2".into(), "https://github.com/dev/demo/actions/runs/124/job/3".into()], true).unwrap();
        assert_eq!(o.commands, ["gh run rerun 123 --failed", "gh run rerun 124 --failed"]);
        assert_eq!(pr_merge(&ws, "squash", true, true).unwrap().commands, ["gh pr merge --squash --delete-branch"]);
        assert_eq!(pr_ready(&ws, true).unwrap().commands, ["gh pr ready"]);
        assert_eq!(pr_edit(&ws, "Novo título", "corpo", true).unwrap().commands, ["gh pr edit --title 'Novo título' --body corpo"]);
        assert_eq!(parse_grep("src/a.rs:3:fn main() {\nb.txt:x:ruim\n", 10).len(), 1);
        assert_eq!(tail("a\nb\nc", 2), "b\nc");
    }
}
