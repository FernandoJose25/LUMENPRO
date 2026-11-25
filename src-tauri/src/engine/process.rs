//! Los procesos: la ventana lanza un guardián que lanza el motor, y lo vuelve
//! a levantar si se cae. El mismo `.exe` hace de los tres, según el argumento.

use super::supervisor::SESSION_FILE;
use super::{ipc, supervisor, Engine, Saved};
use std::fs::{self, File};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub const LAUNCH: &str = "--launch";
pub const GUARD: &str = "--guard";
pub const ENGINE: &str = "--engine";
const RESUME: &str = "--resume";

/// Ya hay un motor: no es una caída.
const ALREADY_RUNNING: i32 = 3;

fn command(args: &[&str], dir: &Path) -> Option<Command> {
    let mut command = Command::new(std::env::current_exe().ok()?);
    command.args(args).arg(dir).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    // Sin esto la carpeta de instalación quedaría en uso.
    if dir.is_dir() {
        command.current_dir(dir);
    }
    Some(command)
}

/// Fuera del grupo de la ventana: cerrarla a la fuerza no se lo lleva.
#[cfg(windows)]
fn spawn_detached(mut command: Command) -> bool {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Threading::{
        CREATE_BREAKAWAY_FROM_JOB, CREATE_NEW_PROCESS_GROUP, DETACHED_PROCESS,
    };
    let flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
    // No todos los jobs dejan salir; en ese caso se queda dentro.
    command.creation_flags(flags | CREATE_BREAKAWAY_FROM_JOB).spawn().is_ok()
        || command.creation_flags(flags).spawn().is_ok()
}

#[cfg(not(windows))]
fn spawn_detached(mut command: Command) -> bool {
    command.spawn().is_ok()
}

/// Desde la ventana: deja un motor en marcha sin ser su padre, para que
/// "Finalizar árbol de procesos" tampoco lo alcance.
pub fn start_engine(dir: &Path) {
    if let Some(mut launcher) = command(&[LAUNCH], dir) {
        let _ = launcher.status();
    }
}

pub fn launch(dir: &Path) {
    if let Some(guard) = command(&[GUARD], dir) {
        spawn_detached(guard);
    }
}

pub fn guard(dir: &Path) {
    let mut resume = false;
    loop {
        let started = Instant::now();
        let args: &[&str] = if resume { &[ENGINE, RESUME] } else { &[ENGINE] };
        let Some(status) = command(args, dir).and_then(|mut engine| engine.status().ok()) else { return };
        if matches!(status.code(), Some(0 | ALREADY_RUNNING)) {
            return;
        }
        resume = true;
        // Si se cae apenas arranca, sin prisa; y siempre un respiro para que
        // el instalador pueda cerrar los dos.
        let pause = if started.elapsed() < Duration::from_secs(5) { 2000 } else { 200 };
        thread::sleep(Duration::from_millis(pause));
    }
}

/// El proceso del motor.
pub fn engine(dir: &Path, args: &[String]) -> ! {
    let resume = args.iter().any(|a| a == RESUME);
    let _ = fs::create_dir_all(dir);
    let Ok(lock) = File::create(dir.join("engine.lock")) else { std::process::exit(1) };
    if lock.try_lock().is_err() {
        std::process::exit(ALREADY_RUNNING);
    }
    exit_on_panic(dir);
    high_priority();
    // Que Windows cargue ahora lo que usan los puertos y la red: con un
    // antivirus de por medio tarda segundos, y mientras no nacen hilos nuevos.
    let _ = lumenpro_dmx::list_ports();
    lumenpro_dmx::network::warm_up();

    let engine = Engine::new(dir);
    engine.play();
    if resume {
        let saved = fs::read_to_string(dir.join(SESSION_FILE)).ok();
        if let Some(saved) = saved.and_then(|json| serde_json::from_str::<Saved>(&json).ok()) {
            let _ = engine.resume(saved);
        }
    }
    if ipc::serve(engine.clone()).is_err() {
        std::process::exit(1);
    }
    supervisor::run(engine, true);
    unreachable!("el supervisor termina el proceso");
}

/// Un hilo que se cae dejaría el motor a medias (por ejemplo, sin mover nada):
/// mejor reiniciarlo entero, que retoma la sesión.
fn exit_on_panic(dir: &Path) {
    let log = dir.join("motor-error.txt");
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        default(info);
        let _ = fs::write(&log, format!("{info}\n{}", std::backtrace::Backtrace::force_capture()));
        std::process::exit(101);
    }));
}

pub fn open_window() {
    if let Ok(exe) = std::env::current_exe() {
        let mut command = Command::new(exe);
        command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        spawn_detached(command);
    }
}

#[cfg(windows)]
mod win {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, SetPriorityClass, TerminateProcess, HIGH_PRIORITY_CLASS, PROCESS_TERMINATE,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow;

    fn terminate(pid: u32) {
        // SAFETY: el handle se comprueba y se cierra; no hay punteros propios.
        unsafe {
            let process = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if !process.is_null() {
                TerminateProcess(process, 1);
                CloseHandle(process);
            }
        }
    }

    /// (pid, pid del padre, ejecutable)
    fn processes() -> Vec<(u32, u32, String)> {
        let mut found = Vec::new();
        // SAFETY: la estructura lleva su tamaño y el handle se cierra.
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                return found;
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut more = Process32FirstW(snapshot, &mut entry);
            while more != 0 {
                let len = entry.szExeFile.iter().position(|c| *c == 0).unwrap_or(entry.szExeFile.len());
                let name = OsString::from_wide(&entry.szExeFile[..len]).to_string_lossy().to_lowercase();
                found.push((entry.th32ProcessID, entry.th32ParentProcessID, name));
                more = Process32NextW(snapshot, &mut entry);
            }
            CloseHandle(snapshot);
        }
        found
    }

    /// Cierra lo que quede de una ventana: su proceso si sigue ahí, y el
    /// navegador que dejó atrás (recuerda quién fue su padre). Solo por su
    /// nombre: ese número de proceso ya puede ser de otro programa.
    pub fn kill_window(pid: u32) {
        let me = std::env::current_exe().ok().and_then(|exe| exe.file_name().map(|n| n.to_string_lossy().to_lowercase()));
        let all = processes();
        if all.iter().any(|(id, _, name)| *id == pid && Some(name) == me.as_ref()) {
            terminate(pid);
        }
        let mut parents = vec![pid];
        while let Some(parent) = parents.pop() {
            for (id, _, _) in all.iter().filter(|(_, p, name)| *p == parent && name == "msedgewebview2.exe") {
                terminate(*id);
                parents.push(*id);
            }
        }
    }

    /// Que la ventana trabada o un programa pesado no le quiten el turno.
    pub fn high_priority() {
        // SAFETY: funciones de Win32 sin punteros ni condiciones previas.
        unsafe { SetPriorityClass(GetCurrentProcess(), HIGH_PRIORITY_CLASS) };
    }

    /// Mientras sale DMX, Windows no suspende ni apaga la pantalla: con el
    /// show manejado desde el celular nadie toca la laptop y se dormiría a
    /// mitad del evento. (Cerrar la tapa la suspende igual.) El pedido dura lo
    /// que viva el hilo que lo hace: por eso el del supervisor.
    pub fn keep_awake(on: bool) {
        let flags = if on { ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED } else { ES_CONTINUOUS };
        // SAFETY: ídem.
        unsafe { SetThreadExecutionState(flags) };
    }

    /// Permite que otra ventana pase al frente en lugar de esta.
    pub fn allow_foreground(pid: u32) {
        // SAFETY: ídem.
        unsafe { AllowSetForegroundWindow(pid) };
    }
}

#[cfg(windows)]
pub use win::{allow_foreground, keep_awake, kill_window};
#[cfg(windows)]
use win::high_priority;

#[cfg(not(windows))]
mod other {
    pub fn kill_window(_: u32) {}
    pub fn high_priority() {}
    pub fn keep_awake(_: bool) {}
    pub fn allow_foreground(_: u32) {}
}

#[cfg(not(windows))]
pub use other::{allow_foreground, keep_awake, kill_window};
#[cfg(not(windows))]
use other::high_priority;
