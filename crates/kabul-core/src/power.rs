//! Impede o computador de dormir enquanto um agente roda ("caffeinate" das configurações).
//! macOS: `caffeinate -i -w <pid do Kabul>`. Windows: `SetThreadExecutionState(ES_CONTINUOUS |
//! ES_SYSTEM_REQUIRED)` na thread que acompanha o agente (o estado é por thread: criar e soltar o guarda
//! na mesma thread). Linux: `systemd-inhibit` quando existir.

/// Enquanto viver, o sistema não dorme por inatividade.
pub struct KeepAwake {
    #[cfg(not(windows))]
    child: Option<std::process::Child>,
    // Preso à thread que chamou (o estado de energia do Windows é por thread).
    _thread: std::marker::PhantomData<*const ()>,
}

impl KeepAwake {
    #[cfg(windows)]
    pub fn start() -> Option<KeepAwake> {
        use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED};
        let prev = unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
        (prev != 0).then_some(KeepAwake { _thread: std::marker::PhantomData })
    }

    #[cfg(not(windows))]
    pub fn start() -> Option<KeepAwake> {
        let pid = std::process::id().to_string();
        let child = if cfg!(target_os = "macos") {
            crate::shell::command("caffeinate").args(["-i", "-w", &pid]).spawn().ok()
        } else {
            let bin = crate::harness::which("systemd-inhibit")?;
            crate::shell::command(bin).args(["--what=idle:sleep", "--who=Kabul", "--why=agente rodando", "--mode=block", "sleep", "infinity"]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().ok()
        };
        child.map(|c| KeepAwake { child: Some(c), _thread: std::marker::PhantomData })
    }
}

impl Drop for KeepAwake {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS};
            SetThreadExecutionState(ES_CONTINUOUS);
        }
        #[cfg(not(windows))]
        if let Some(mut c) = self.child.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}
