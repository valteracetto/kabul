//! Processos que o agente deixou rodando: ao parar, o Kabul interrompe só o agente (pelo protocolo dele)
//! e depois lista os descendentes que continuaram vivos (servidores, watchers, `docker run`...), para o
//! usuário decidir se mantém ou encerra. Nada é encerrado sozinho.
//!
//! Portável pela crate `sysinfo` (árvore de processos e sinais). Portas que escutam: `lsof` no
//! macOS/Linux e `netstat -ano` no Windows (melhor esforço). Contêineres: CLI do `docker`.
use crate::resources::{self, Proc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::time::Duration;

/// Processo identificado por pid + início (o pid sozinho pode ser reaproveitado pelo sistema).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Key {
    pub pid: u32,
    pub start: u64,
}

/// Processo deixado pelo agente.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Leftover {
    pub pid: u32,
    pub start: u64,
    pub name: String,
    /// Linha de comando curta (até 120 caracteres).
    pub cmd: String,
    /// Portas TCP em que escuta.
    #[serde(default)]
    pub ports: Vec<u16>,
    /// Segundos desde que começou.
    #[serde(default)]
    pub age: u64,
    #[serde(default)]
    pub workspace_id: Option<String>,
}

impl Leftover {
    pub fn key(&self) -> Key {
        Key { pid: self.pid, start: self.start }
    }
}

/// Contêiner do Docker criado durante o turno (com `-d` ele não morre com o cliente).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Container {
    pub id: String,
    pub image: String,
    pub name: String,
}

/// Resposta do "Parar": se o agente continua vivo (sessão retomável) e o que ficou rodando.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StopReport {
    pub alive: bool,
    pub leftovers: Vec<Leftover>,
    pub containers: Vec<Container>,
}

/// Os testes com processos de verdade rodam um de cada vez.
#[cfg(test)]
pub(crate) static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Descendentes de `root` (sem ele), a partir de uma lista de processos.
pub fn descendants(procs: &[Proc], root: u32) -> Vec<Proc> {
    let mut kids: HashMap<u32, Vec<&Proc>> = HashMap::new();
    for p in procs {
        if let Some(pp) = p.parent.filter(|pp| *pp != p.pid) {
            kids.entry(pp).or_default().push(p);
        }
    }
    let mut out = vec![];
    let mut stack = vec![root];
    let mut seen = HashSet::new();
    while let Some(pid) = stack.pop() {
        for c in kids.get(&pid).into_iter().flatten() {
            if seen.insert(c.pid) {
                out.push((*c).clone());
                stack.push(c.pid);
            }
        }
    }
    out
}

/// Chaves dos descendentes de `root` agora (linha de base: o que já existia, como servidores MCP).
pub fn baseline(root: u32) -> HashSet<Key> {
    descendants(&resources::processes(), root).iter().map(|p| Key { pid: p.pid, start: p.start }).collect()
}

/// Descendentes de `root` que não estão na linha de base: o que o agente abriu durante as conversas.
/// Só os "topos" (um processo cujo pai também entrou na lista fica de fora, para não listar cada filho do `npm`).
pub fn extra(procs: &[Proc], root: u32, base: &HashSet<Key>) -> Vec<Proc> {
    let all: Vec<Proc> = descendants(procs, root).into_iter().filter(|p| !base.contains(&Key { pid: p.pid, start: p.start })).collect();
    let pids: HashSet<u32> = all.iter().map(|p| p.pid).collect();
    all.iter().filter(|p| !p.parent.is_some_and(|pp| pids.contains(&pp))).cloned().collect()
}

/// Dos processos dados, os que continuam vivos (mesmo pid e mesmo início).
pub fn alive(procs: &[Proc], keys: &[Key]) -> Vec<Proc> {
    let want: HashSet<Key> = keys.iter().copied().collect();
    procs.iter().filter(|p| want.contains(&Key { pid: p.pid, start: p.start })).cloned().collect()
}

/// Shells e o próprio processo de ferramenta que o CLI encerra ao interromper não contam como "deixados"
/// quando não têm filhos vivos (o comando em primeiro plano já morreu com a interrupção).
fn idle_shell(p: &Proc, procs: &[Proc]) -> bool {
    let base = p.name.rsplit(['/', '\\']).next().unwrap_or(&p.name).trim_end_matches(".exe");
    matches!(base, "bash" | "zsh" | "sh" | "dash" | "fish") && !procs.iter().any(|c| c.parent == Some(p.pid))
}

pub fn to_leftovers(procs: &[Proc], list: &[Proc]) -> Vec<Leftover> {
    let ports = listening_ports(&list.iter().map(|p| p.pid).collect::<Vec<_>>());
    let t = now();
    list.iter()
        .filter(|p| !idle_shell(p, procs))
        .map(|p| {
            let cmd = if p.cmd.is_empty() { p.name.clone() } else { p.cmd.join(" ") };
            let cmd = if cmd.chars().count() > 120 { format!("{}…", cmd.chars().take(120).collect::<String>()) } else { cmd };
            let name = p.name.rsplit(['/', '\\']).next().unwrap_or(&p.name).trim_end_matches(".exe").to_string();
            Leftover { pid: p.pid, start: p.start, name, cmd, ports: ports.get(&p.pid).cloned().unwrap_or_default(), age: t.saturating_sub(p.start), workspace_id: None }
        })
        .collect()
}

/// SIGKILL só nesses processos (sem a subárvore), se ainda forem os mesmos (pid + início).
pub fn kill_exact(keys: &[Key]) -> usize {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    keys.iter().filter_map(|k| sys.process(Pid::from_u32(k.pid)).filter(|p| p.start_time() == k.start)).filter(|p| p.kill()).count()
}

/// Encerra os processos e os filhos deles: SIGTERM, espera até `grace`, depois SIGKILL em quem sobrou.
/// No Windows o `sysinfo` só tem o Kill (TerminateProcess); o "grupo" vira a subárvore.
pub fn terminate(keys: &[Key], grace: Duration) -> usize {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, Signal, System};
    let procs = resources::processes();
    // A subárvore inteira de cada um (filhos primeiro na hora de matar).
    let mut targets: Vec<Key> = vec![];
    for k in alive(&procs, keys) {
        for d in descendants(&procs, k.pid).into_iter().rev() {
            targets.push(Key { pid: d.pid, start: d.start });
        }
        targets.push(Key { pid: k.pid, start: k.start });
    }
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let send = |sys: &System, sig: Signal| {
        for k in &targets {
            if let Some(p) = sys.process(Pid::from_u32(k.pid)).filter(|p| p.start_time() == k.start) {
                if p.kill_with(sig).is_none() {
                    p.kill();
                }
            }
        }
    };
    send(&sys, Signal::Term);
    let t0 = std::time::Instant::now();
    loop {
        std::thread::sleep(Duration::from_millis(100));
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
        let left = targets.iter().filter(|k| sys.process(Pid::from_u32(k.pid)).is_some_and(|p| p.start_time() == k.start)).count();
        if left == 0 {
            return targets.len();
        }
        if t0.elapsed() >= grace {
            break;
        }
    }
    send(&sys, Signal::Kill);
    targets.len()
}

/// "Parar": interrompe só o turno do agente (protocolo ou SIGINT), espera o CLI encerrar o comando em
/// primeiro plano e devolve o que continuou vivo. Não encerra nada além disso.
pub fn stop_turn(r: &std::sync::Mutex<crate::harness::Running>, settle: Duration) -> StopReport {
    let before = resources::processes();
    let (pre, since) = {
        let g = r.lock().unwrap();
        (g.extra_procs(&before), g.turn_started())
    };
    let _ = r.lock().unwrap().interrupt();
    // O CLI encerra o comando em primeiro plano; quem sobreviver depois disso foi deixado rodando.
    let keys: Vec<Key> = pre.iter().map(|p| Key { pid: p.pid, start: p.start }).collect();
    let t0 = std::time::Instant::now();
    let mut procs;
    loop {
        std::thread::sleep(Duration::from_millis(150));
        procs = resources::processes();
        if t0.elapsed() >= settle || alive(&procs, &keys).is_empty() {
            break;
        }
    }
    let mut g = r.lock().unwrap();
    let alive_agent = g.alive();
    let mut list = alive(&procs, &keys);
    // Também o que o agente abriu depois da foto (ainda vivo e ainda filho dele).
    for p in g.extra_procs(&procs) {
        if !list.iter().any(|x| x.pid == p.pid) {
            list.push(p);
        }
    }
    drop(g);
    StopReport { alive: alive_agent, leftovers: to_leftovers(&procs, &list), containers: if since > 0 { containers_since(since) } else { vec![] } }
}

/// Processos que o agente abriu e que continuariam vivos se a sessão fosse encerrada agora (para a
/// confirmação ao fechar a aba, arquivar ou sair).
pub fn session_leftovers(r: &std::sync::Mutex<crate::harness::Running>) -> Vec<Leftover> {
    let procs = resources::processes();
    let list = r.lock().unwrap().extra_procs(&procs);
    to_leftovers(&procs, &list)
}

/// Processos que o usuário escolheu manter rodando (aparecem no painel de Recursos e no Painel com
/// "Encerrar"). Só em memória: depois de reiniciar o app eles não são mais filhos de nada do Kabul.
#[derive(Default)]
pub struct Kept(std::sync::Mutex<Vec<Leftover>>);

impl Kept {
    pub fn keep(&self, items: Vec<Leftover>, workspace_id: Option<String>) {
        let mut g = self.0.lock().unwrap();
        for mut it in items {
            if !g.iter().any(|x| x.key() == it.key()) {
                it.workspace_id = it.workspace_id.or_else(|| workspace_id.clone());
                g.push(it);
            }
        }
    }
    /// Os que continuam vivos (com idade e portas atualizadas); os mortos saem da lista.
    pub fn alive(&self) -> Vec<Leftover> {
        let procs = resources::processes();
        let mut g = self.0.lock().unwrap();
        let keys: Vec<Key> = g.iter().map(|x| x.key()).collect();
        let live: HashSet<Key> = alive(&procs, &keys).iter().map(|p| Key { pid: p.pid, start: p.start }).collect();
        g.retain(|x| live.contains(&x.key()));
        let ports = listening_ports(&g.iter().map(|x| x.pid).collect::<Vec<_>>());
        let t = now();
        g.iter().cloned().map(|mut x| ((x.age = t.saturating_sub(x.start)), (x.ports = ports.get(&x.pid).cloned().unwrap_or_default()), x).2).collect()
    }
    pub fn forget(&self, keys: &[Key]) {
        self.0.lock().unwrap().retain(|x| !keys.contains(&x.key()));
    }
}

/// Manda SIGINT a um processo (último recurso para interromper um agente sem protocolo de interrupção).
/// No Windows não existe SIGINT para outro processo sem console compartilhado: devolve `false`.
pub fn interrupt(pid: u32) -> bool {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, Signal, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true, ProcessRefreshKind::nothing());
    sys.process(Pid::from_u32(pid)).and_then(|p| p.kill_with(Signal::Interrupt)).unwrap_or(false)
}

/// Portas TCP em que cada pid escuta (melhor esforço; vazio se a ferramenta não existir).
pub fn listening_ports(pids: &[u32]) -> HashMap<u32, Vec<u16>> {
    let mut out: HashMap<u32, Vec<u16>> = HashMap::new();
    if pids.is_empty() {
        return out;
    }
    let want: HashSet<u32> = pids.iter().copied().collect();
    #[cfg(unix)]
    {
        let list = pids.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(",");
        if let Ok(o) = crate::shell::command("lsof").args(["-nP", "-a", "-p", &list, "-iTCP", "-sTCP:LISTEN", "-F", "pn"]).output() {
            out = parse_lsof(&String::from_utf8_lossy(&o.stdout));
        }
    }
    #[cfg(windows)]
    {
        if let Ok(o) = crate::shell::command("netstat").args(["-ano", "-p", "TCP"]).output() {
            out = parse_netstat(&String::from_utf8_lossy(&o.stdout));
        }
    }
    out.retain(|p, _| want.contains(p));
    out
}

/// Saída de `lsof -F pn`: linhas `p<pid>` seguidas de `n<endereço>:<porta>`.
pub fn parse_lsof(s: &str) -> HashMap<u32, Vec<u16>> {
    let mut out: HashMap<u32, Vec<u16>> = HashMap::new();
    let mut cur = None;
    for l in s.lines() {
        if let Some(p) = l.strip_prefix('p') {
            cur = p.parse().ok();
        } else if let (Some(n), Some(pid)) = (l.strip_prefix('n'), cur) {
            if let Some(port) = n.rsplit(':').next().and_then(|x| x.parse::<u16>().ok()) {
                let v = out.entry(pid).or_default();
                if !v.contains(&port) {
                    v.push(port);
                }
            }
        }
    }
    out
}

/// Saída de `netstat -ano`: `TCP 0.0.0.0:3000 0.0.0.0:0 LISTENING 1234`.
pub fn parse_netstat(s: &str) -> HashMap<u32, Vec<u16>> {
    let mut out: HashMap<u32, Vec<u16>> = HashMap::new();
    for l in s.lines() {
        let f: Vec<&str> = l.split_whitespace().collect();
        if f.len() >= 5 && f[0].eq_ignore_ascii_case("TCP") && f[3].eq_ignore_ascii_case("LISTENING") {
            if let (Some(port), Ok(pid)) = (f[1].rsplit(':').next().and_then(|x| x.parse::<u16>().ok()), f[4].parse::<u32>()) {
                let v = out.entry(pid).or_default();
                if !v.contains(&port) {
                    v.push(port);
                }
            }
        }
    }
    out
}

/// Contêineres criados a partir de `since` (segundos Unix), pelo CLI do Docker. Vazio sem Docker.
pub fn containers_since(since: u64) -> Vec<Container> {
    let Some(docker) = crate::harness::which("docker") else { return vec![] };
    let Ok(o) = crate::shell::command(docker).args(["ps", "--no-trunc", "--format", "{{.ID}}\t{{.Image}}\t{{.Names}}\t{{.CreatedAt}}"]).output() else { return vec![] };
    parse_docker_ps(&String::from_utf8_lossy(&o.stdout), since)
}

/// Linhas `id\timagem\tnome\t2026-10-24 21:57:20 -0300 -03`.
pub fn parse_docker_ps(s: &str, since: u64) -> Vec<Container> {
    s.lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split('\t').collect();
            if f.len() < 4 {
                return None;
            }
            let created = parse_docker_time(f[3])?;
            (created + 1 >= since).then(|| Container { id: f[0].chars().take(12).collect(), image: f[1].into(), name: f[2].into() })
        })
        .collect()
}

/// `2026-10-24 21:57:20 -0300 -03` → segundos Unix.
pub fn parse_docker_time(s: &str) -> Option<u64> {
    let f: Vec<&str> = s.split_whitespace().collect();
    let (d, t, off) = (f.first()?, f.get(1)?, f.get(2).copied().unwrap_or("+0000"));
    let dp: Vec<i64> = d.split('-').map(|x| x.parse().ok()).collect::<Option<_>>()?;
    let tp: Vec<i64> = t.split(':').map(|x| x.split('.').next().unwrap_or(x).parse().ok()).collect::<Option<_>>()?;
    if dp.len() != 3 || tp.len() != 3 {
        return None;
    }
    let (y, m, day) = (dp[0], dp[1], dp[2]);
    // Dias desde 1970-01-01 (algoritmo civil de Howard Hinnant).
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    let sign = if off.starts_with('-') { -1 } else { 1 };
    let o = off.trim_start_matches(['+', '-']);
    let off_s = if o.len() >= 4 { sign * (o[..2].parse::<i64>().ok()? * 3600 + o[2..4].parse::<i64>().ok()? * 60) } else { 0 };
    u64::try_from(days * 86400 + tp[0] * 3600 + tp[1] * 60 + tp[2] - off_s).ok()
}

/// `docker stop <id>`.
pub fn docker_stop(id: &str) -> anyhow::Result<()> {
    let docker = crate::harness::which("docker").ok_or_else(|| anyhow::anyhow!("docker não encontrado"))?;
    let o = crate::shell::command(docker).args(["stop", id]).output()?;
    anyhow::ensure!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr).trim());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, parent: u32, name: &str, start: u64) -> Proc {
        Proc { pid, parent: Some(parent), name: name.into(), cmd: vec![name.into()], start, ..Default::default() }
    }

    #[test]
    fn extra_ignora_a_linha_de_base_e_lista_so_os_topos() {
        let procs = vec![p(10, 1, "claude", 100), p(11, 10, "node", 101), p(12, 10, "bash", 200), p(13, 12, "npm", 201), p(14, 13, "node", 202), p(15, 10, "bash", 210)];
        let base: HashSet<Key> = [Key { pid: 11, start: 101 }].into_iter().collect();
        let e = extra(&procs, 10, &base);
        let mut pids: Vec<u32> = e.iter().map(|p| p.pid).collect();
        pids.sort();
        assert_eq!(pids, vec![12, 15]);
        assert!(e.iter().all(|p| p.pid != 11 && p.pid != 13 && p.pid != 14), "MCP da base e filhos de quem já está na lista ficam de fora");
        // Shell sem filhos (o comando em primeiro plano já morreu) não conta.
        let l = to_leftovers(&procs, &e);
        assert_eq!(l.iter().map(|x| x.pid).collect::<Vec<_>>(), vec![12]);
        // Pid reaproveitado (outro início) não é o mesmo processo.
        assert!(alive(&procs, &[Key { pid: 12, start: 999 }]).is_empty());
    }

    #[test]
    fn portas_e_docker() {
        let l = parse_lsof("p4242\nf12\nn*:3000\nf13\nn127.0.0.1:3000\np77\nn[::1]:5173\n");
        assert_eq!(l[&4242], vec![3000]);
        assert_eq!(l[&77], vec![5173]);
        let n = parse_netstat("  TCP    0.0.0.0:8080   0.0.0.0:0   LISTENING   912\n  TCP 1.2.3.4:5 6.7.8.9:443 ESTABLISHED 912\n");
        assert_eq!(n[&912], vec![8080]);
        assert_eq!(parse_docker_time("1970-01-01 00:01:00 +0000 UTC"), Some(60));
        assert_eq!(parse_docker_time("2026-10-24 21:57:20 -0300 -03"), parse_docker_time("2026-10-25 00:57:20 +0000 UTC"));
        let since = parse_docker_time("2026-10-24 21:57:00 -0300 -03").unwrap();
        let c = parse_docker_ps("abcdef1234567890\tcomposer:2\tsad_hopper\t2026-10-24 21:57:20 -0300 -03\nold\tnginx\tweb\t2026-10-01 10:00:00 -0300 -03\n", since);
        assert_eq!(c, vec![Container { id: "abcdef123456".into(), image: "composer:2".into(), name: "sad_hopper".into() }]);
    }

    /// Processo de verdade: um "agente" (sh) abre um servidor em segundo plano e um comando em primeiro
    /// plano; o servidor aparece como deixado e `terminate` o encerra (TERM, depois KILL).
    #[cfg(unix)]
    #[test]
    fn deixados_e_encerrar_de_verdade() {
        let _g = crate::procs::TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut agent = crate::shell::command("sh").args(["-c", "sleep 30 & sleep 30"]).spawn().unwrap();
        let pid = agent.id();
        std::thread::sleep(Duration::from_millis(300));
        resources::processes();
        let procs = resources::processes();
        let e = extra(&procs, pid, &HashSet::new());
        assert_eq!(e.iter().filter(|p| p.name.contains("sleep")).count(), 2, "{e:?}");
        let keys: Vec<Key> = e.iter().map(|p| Key { pid: p.pid, start: p.start }).collect();
        assert!(terminate(&keys, Duration::from_millis(800)) >= 2);
        std::thread::sleep(Duration::from_millis(200));
        assert!(alive(&resources::processes(), &keys).is_empty(), "os sleeps morreram");
        let _ = agent.kill();
        let _ = agent.wait();
    }
}

/// Parar de ponta a ponta com um agente de mentira que fala o stream-json do Claude: ao receber o
/// `control_request` de interrupção ele mata o comando em primeiro plano (como o CLI faz) e continua vivo;
/// o servidor que ele subiu em segundo plano aparece como deixado e só morre com `terminate`.
#[cfg(all(test, unix))]
mod stop_tests {
    use super::*;
    use crate::harness::{self, claude::ClaudeProtocol, Capabilities, CmdSpec, Harness, HarnessKind, Protocol, SessionOptions, Support};

    struct Fake(String);
    impl Harness for Fake {
        fn kind(&self) -> HarnessKind {
            HarnessKind::Claude
        }
        fn command(&self, _o: &SessionOptions) -> CmdSpec {
            CmdSpec::new("sh", ["-c", self.0.as_str()])
        }
        fn interactive_command(&self, o: &SessionOptions) -> CmdSpec {
            self.command(o)
        }
        fn protocol(&self, _o: &SessionOptions) -> Box<dyn Protocol> {
            Box::new(ClaudeProtocol::default())
        }
        fn capabilities(&self) -> Capabilities {
            Capabilities { remote_control: Support::TmuxMirror, cloud: Support::TmuxMirror, teleport: Support::TmuxMirror, background: Support::TmuxMirror }
        }
    }

    #[test]
    fn parar_interrompe_pelo_protocolo_e_lista_o_servidor() {
        let _g = crate::procs::TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // Durações únicas identificam os dois sleeps deste teste.
        let (srv, fg) = (40000 + std::process::id() % 9000, 50000 + std::process::id() % 9000);
        let is = |p: &Proc, n: u32| p.cmd.len() >= 2 && p.cmd[0].ends_with("sleep") && p.cmd[1] == n.to_string();
        // Mensagem → init; servidor em segundo plano (sleep 41) e comando em primeiro plano (sleep 31),
        // 2 s depois (a linha de base sai no init e demora com a máquina carregada);
        // interrupção → mata só o de primeiro plano; depois fica esperando a próxima mensagem.
        let script = format!(
            r#"read l; echo '{{"type":"system","subtype":"init","session_id":"s1","tools":[],"mcp_servers":[]}}'
sleep 2; sleep {srv} & sleep {fg} & FG=$!
read l; case "$l" in *interrupt*) kill $FG;; esac
echo '{{"type":"result","subtype":"error_during_execution","session_id":"s1"}}'
read l"#
        );
        let r = harness::spawn(&Fake(script), &SessionOptions::default()).unwrap();
        let r = std::sync::Mutex::new(r);
        r.lock().unwrap().send("suba o servidor").unwrap();
        // Espera a sessão ficar pronta (linha de base) e os dois sleeps nascerem.
        let t0 = std::time::Instant::now();
        while !resources::processes().iter().any(|p| is(p, fg)) && t0.elapsed() < Duration::from_secs(6) {
            std::thread::sleep(Duration::from_millis(50));
        }
        std::thread::sleep(Duration::from_millis(200));
        let rep = stop_turn(&r, Duration::from_millis(1500));
        assert!(rep.alive, "a sessão continua (interrupção pelo protocolo, não kill)");
        let procs = resources::processes();
        assert!(!procs.iter().any(|p| is(p, fg)), "o comando em primeiro plano morreu com a interrupção");
        assert_eq!(rep.leftovers.len(), 1, "{:?}", rep.leftovers);
        assert!(rep.leftovers[0].cmd.ends_with(&srv.to_string()), "{:?}", rep.leftovers);
        // Nada foi encerrado sozinho: o servidor continua até o usuário pedir.
        assert!(procs.iter().any(|p| is(p, srv)));
        terminate(&[rep.leftovers[0].key()], Duration::from_millis(800));
        std::thread::sleep(Duration::from_millis(200));
        assert!(!resources::processes().iter().any(|p| is(p, srv)));
        let _ = r.lock().unwrap().kill();
    }
}
