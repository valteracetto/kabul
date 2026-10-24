//! Leitura read-only do banco do Conductor (`conductor.db`).
//! Só lê metadados (ids, status, título, modelo, branch); nunca mensagens, prompts ou scripts.
use anyhow::{Context, Result};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub fn default_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support/com.conductor.app/conductor.db"))
}

#[derive(Debug, Clone, Serialize)]
pub struct ConductorWorkspace {
    pub id: String,
    pub repo_name: Option<String>,
    pub directory_name: Option<String>,
    pub workspace_name: Option<String>,
    pub branch: Option<String>,
    pub state: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConductorSession {
    pub id: String,
    pub workspace_id: Option<String>,
    pub status: Option<String>,
    pub title: Option<String>,
    pub model: Option<String>,
    pub agent_type: Option<String>,
    pub updated_at: Option<String>,
}

pub struct ConductorDb {
    conn: Connection,
}

impl ConductorDb {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
            .with_context(|| format!("abrindo {} read-only", path.display()))?;
        conn.busy_timeout(std::time::Duration::from_millis(500))?;
        Ok(Self { conn })
    }

    pub fn open_default() -> Result<Self> {
        Self::open(&default_path().context("HOME não definido")?)
    }

    pub fn workspaces(&self) -> Result<Vec<ConductorWorkspace>> {
        let mut st = self.conn.prepare(
            "SELECT w.local_id, r.name, w.directory_name, w.workspace_name, w.branch, w.state, w.workspace_path
             FROM workspaces w LEFT JOIN repos r ON r.id = w.repository_id
             WHERE COALESCE(w.state,'active') != 'archived'
             ORDER BY w.updated_at DESC",
        )?;
        let rows = st.query_map([], |r| {
            Ok(ConductorWorkspace {
                id: r.get(0)?,
                repo_name: r.get(1)?,
                directory_name: r.get(2)?,
                workspace_name: r.get(3)?,
                branch: r.get(4)?,
                state: r.get(5)?,
                path: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn sessions(&self) -> Result<Vec<ConductorSession>> {
        let mut st = self.conn.prepare(
            "SELECT id, workspace_id, status, title, model, agent_type, updated_at
             FROM sessions WHERE COALESCE(is_hidden,0) = 0
             ORDER BY updated_at DESC",
        )?;
        let rows = st.query_map([], |r| {
            Ok(ConductorSession {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                status: r.get(2)?,
                title: r.get(3)?,
                model: r.get(4)?,
                agent_type: r.get(5)?,
                updated_at: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_banco_falso() {
        let p = std::env::temp_dir().join(format!("kabul-cdb-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&p);
        {
            let c = Connection::open(&p).unwrap();
            c.execute_batch(
                "CREATE TABLE repos(id TEXT PRIMARY KEY, name TEXT);
                 CREATE TABLE workspaces(local_id TEXT PRIMARY KEY, repository_id TEXT, directory_name TEXT, workspace_name TEXT, branch TEXT, state TEXT, workspace_path TEXT, updated_at TEXT);
                 CREATE TABLE sessions(id TEXT PRIMARY KEY, workspace_id TEXT, status TEXT, title TEXT, model TEXT, agent_type, updated_at TEXT, is_hidden INTEGER DEFAULT 0);
                 INSERT INTO repos VALUES('r1','playground');
                 INSERT INTO workspaces VALUES('w1','r1','kabul','Kabul','feat','active',NULL,'2');
                 INSERT INTO workspaces VALUES('w2','r1','velho','V','x','archived',NULL,'1');
                 INSERT INTO sessions VALUES('s1','w1','working','Teste','opus','claude','2',0);
                 INSERT INTO sessions VALUES('s2','w1','idle','Oculta',NULL,NULL,'1',1);",
            )
            .unwrap();
        }
        let db = ConductorDb::open(&p).unwrap();
        let ws = db.workspaces().unwrap();
        assert_eq!(ws.len(), 1);
        assert_eq!(ws[0].repo_name.as_deref(), Some("playground"));
        let ss = db.sessions().unwrap();
        assert_eq!(ss.len(), 1);
        assert_eq!(ss[0].status.as_deref(), Some("working"));
        assert!(db.conn.execute("DELETE FROM sessions", []).is_err(), "deve ser read-only");
        std::fs::remove_file(&p).ok();
    }
}
