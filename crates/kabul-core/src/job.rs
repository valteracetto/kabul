//! Grupo de processos para encerrar de uma vez. No Windows é um Job Object: tudo que o processo
//! abrir entra no job (mesmo os netos cujo pai já saiu, que a árvore por ppid perde) e
//! `TerminateJobObject` encerra todos. No macOS/Linux o grupo é a subárvore por ppid (via `sysinfo`),
//! como no `procs::terminate`.
//!
//! O job não usa `KILL_ON_JOB_CLOSE`: fechar o Kabul não derruba o que o usuário escolheu manter.

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW, TerminateJobObject};
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    pub struct Job(HANDLE);

    // O HANDLE de um job pode ser usado de qualquer thread.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn new() -> Option<Job> {
            let h = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            (!h.is_null()).then_some(Job(h))
        }
        pub fn assign(&self, pid: u32) -> bool {
            unsafe {
                let p = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
                if p.is_null() {
                    return false;
                }
                let ok = AssignProcessToJobObject(self.0, p) != 0;
                CloseHandle(p);
                ok
            }
        }
        pub fn terminate(&self) -> bool {
            unsafe { TerminateJobObject(self.0, 1) != 0 }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    /// Fora do Windows: lembra o pid e encerra a subárvore dele.
    pub struct Job(std::sync::Mutex<Vec<u32>>);

    impl Job {
        pub fn new() -> Option<Job> {
            Some(Job(Default::default()))
        }
        pub fn assign(&self, pid: u32) -> bool {
            self.0.lock().unwrap().push(pid);
            true
        }
        pub fn terminate(&self) -> bool {
            let pids = self.0.lock().unwrap().clone();
            pids.iter().map(|p| super::kill_tree(*p)).sum::<usize>() > 0
        }
    }
}

pub use imp::Job;

/// Encerra `pid` e todos os descendentes (filhos primeiro), sem espera. Devolve quantos recebeu o sinal.
pub fn kill_tree(pid: u32) -> usize {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
    let procs = crate::resources::processes();
    let mut targets: Vec<u32> = crate::procs::descendants(&procs, pid).into_iter().rev().map(|p| p.pid).collect();
    targets.push(pid);
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    targets.iter().filter(|p| sys.process(Pid::from_u32(**p)).is_some_and(|x| x.kill())).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// O job encerra o processo e o filho dele.
    #[test]
    fn encerra_o_grupo() {
        let _g = crate::procs::TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut child = if cfg!(windows) { std::process::Command::new("cmd").args(["/C", "ping -n 30 127.0.0.1 > nul"]).spawn().unwrap() } else { std::process::Command::new("sh").args(["-c", "sleep 30 & sleep 30"]).spawn().unwrap() };
        std::thread::sleep(std::time::Duration::from_millis(300));
        let job = Job::new().unwrap();
        assert!(job.assign(child.id()));
        let kids: Vec<u32> = crate::procs::descendants(&crate::resources::processes(), child.id()).iter().map(|p| p.pid).collect();
        assert!(!kids.is_empty(), "o filho existe");
        assert!(job.terminate());
        let status = child.wait().unwrap();
        assert!(!status.success());
        std::thread::sleep(std::time::Duration::from_millis(300));
        let procs = crate::resources::processes();
        // No Windows só entra no job o que nasce depois do assign (o ping já existia): lá conferimos o pai.
        if cfg!(not(windows)) {
            assert!(kids.iter().all(|k| !procs.iter().any(|p| p.pid == *k)), "filhos encerrados");
        }
    }
}
