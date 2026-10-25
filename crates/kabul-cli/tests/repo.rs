//! `kabul repo add` / `kabul repo ls` com um KABUL_HOME temporário, e o app aberto (um `SharedStore`
//! no mesmo estado) vendo os repositórios novos sem reabrir.
use kabul_core::store::{SharedStore, Store};
use std::path::{Path, PathBuf};
use std::process::Command;

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("kabul-repo-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d.canonicalize().unwrap()
}

fn git_repo(dir: &Path) {
    std::fs::create_dir_all(dir.join("src")).unwrap();
    let ok = Command::new("git").arg("-C").arg(dir).args(["init", "-q", "-b", "main"]).status().unwrap().success();
    assert!(ok);
}

fn kabul(home: &Path, args: &[&str], cwd: &Path) -> (String, bool) {
    let o = Command::new(env!("CARGO_BIN_EXE_kabul")).args(args).current_dir(cwd).env("KABUL_HOME", home).output().unwrap();
    (String::from_utf8_lossy(&o.stdout).into_owned() + &String::from_utf8_lossy(&o.stderr), o.status.success())
}

#[test]
fn repo_add_e_ls_com_kabul_home() {
    let t = tmp("cli");
    let home = t.join("home");
    let (a, b, plain) = (t.join("alfa"), t.join("beta"), t.join("nao-e-git"));
    git_repo(&a);
    git_repo(&b);
    std::fs::create_dir_all(&plain).unwrap();

    // O "app" já aberto no mesmo estado (vazio).
    let app = SharedStore::new(Store::open(home.join("state.json"), home.join("workspaces"), "val".into()).unwrap());
    assert!(app.lock().unwrap().state.repos.is_empty());

    let (out, ok) = kabul(&home, &["repo", "ls"], &t);
    assert!(ok && out.contains("Nenhum repositório"), "{out}");

    // Vários caminhos: relativo, subpasta (vale o repositório inteiro), não-git, inexistente e repetido.
    let (out, ok) = kabul(&home, &["repo", "add", "alfa", "beta/src", "nao-e-git", "sumiu", "alfa"], &t);
    assert!(ok, "{out}");
    assert!(out.contains(&format!("+ alfa  {}", a.display())), "{out}");
    assert!(out.contains(&format!("+ beta  {}", b.display())), "{out}");
    assert!(out.contains("- nao-e-git: a pasta não é um repositório git"), "{out}");
    assert!(out.contains("- sumiu: pasta não encontrada"), "{out}");
    assert!(out.contains("(já estava no Kabul)"), "{out}");
    assert!(out.contains("2 adicionado(s), 1 já estava(m), 2 pulado(s)."), "{out}");

    // De novo: nada novo.
    let (out, _) = kabul(&home, &["repo", "add", a.to_str().unwrap()], &t);
    assert!(out.contains("0 adicionado(s), 1 já estava(m), 0 pulado(s)."), "{out}");

    let (out, ok) = kabul(&home, &["repo", "ls", "--json"], &t);
    assert!(ok, "{out}");
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    let names: Vec<&str> = v.as_array().unwrap().iter().map(|r| r["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["alfa", "beta"]);
    let (out, _) = kabul(&home, &["repo", "ls"], &t);
    assert!(out.lines().any(|l| l.starts_with("alfa") && l.contains("main") && l.ends_with(&a.display().to_string())), "{out}");

    // O app aberto enxerga sem reiniciar (e uma gravação dele não apaga o que o CLI adicionou).
    assert!(app.changed_on_disk());
    let mut st = app.lock().unwrap();
    assert_eq!(st.state.repos.len(), 2);
    let id = st.state.repos[0].id.clone();
    st.update_repo(&id, |r| r.hidden = true).unwrap();
    drop(st);
    let disk = Store::open(home.join("state.json"), home.join("workspaces"), "val".into()).unwrap();
    assert_eq!(disk.state.repos.len(), 2);
    assert!(disk.state.repos[0].hidden);
    std::fs::remove_dir_all(&t).ok();
}
