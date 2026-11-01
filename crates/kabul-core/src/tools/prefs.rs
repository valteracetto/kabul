//! Preferências pessoais das Ferramentas (favoritos, nota e categoria manual), no estado do Kabul —
//! nunca nas pastas das IAs. Arquivo: `<estado>/tools-prefs.json`.
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    #[serde(default)]
    pub schema_version: u32,
    #[serde(default)]
    pub favorites: BTreeSet<String>,
    #[serde(default)]
    pub notes: BTreeMap<String, String>,
    #[serde(default)]
    pub categories: BTreeMap<String, String>,
}

/// Mudança pedida pela interface (`tools_prefs_set`). Campo ausente = não mexe; texto vazio = apaga.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub id: String,
    #[serde(default)]
    pub favorite: Option<bool>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
}

pub fn file(state: &Path) -> PathBuf {
    state.join("tools-prefs.json")
}

impl Prefs {
    pub fn load(state: &Path) -> Self {
        std::fs::read(file(state)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    pub fn save(&self, state: &Path) -> Result<()> {
        std::fs::create_dir_all(state)?;
        let mut me = self.clone();
        me.schema_version = 1;
        std::fs::write(file(state), serde_json::to_vec_pretty(&me)?).context("gravando tools-prefs.json")
    }

    pub fn apply(&mut self, c: &Change) {
        let id = c.id.trim().to_string();
        if id.is_empty() {
            return;
        }
        if let Some(f) = c.favorite {
            if f {
                self.favorites.insert(id.clone());
            } else {
                self.favorites.remove(&id);
            }
        }
        if let Some(n) = &c.note {
            let n: String = n.trim().chars().take(4000).collect();
            if n.is_empty() {
                self.notes.remove(&id);
            } else {
                self.notes.insert(id.clone(), n);
            }
        }
        if let Some(cat) = &c.category {
            let cat = cat.trim();
            if cat.is_empty() {
                self.categories.remove(&id);
            } else {
                self.categories.insert(id, cat.chars().take(40).collect());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn favorito_nota_categoria() {
        let t = crate::tools::fsx::testfs::Tmp::new("prefs");
        let mut p = Prefs::load(t.path());
        p.apply(&Change { id: "skill:x".into(), favorite: Some(true), note: Some(" uso no deploy ".into()), category: Some("cloud".into()) });
        p.save(t.path()).unwrap();
        let q = Prefs::load(t.path());
        assert!(q.favorites.contains("skill:x"));
        assert_eq!(q.notes["skill:x"], "uso no deploy");
        let mut q = q;
        q.apply(&Change { id: "skill:x".into(), favorite: Some(false), note: Some(String::new()), category: None });
        assert!(q.favorites.is_empty() && q.notes.is_empty() && q.categories["skill:x"] == "cloud");
    }
}
