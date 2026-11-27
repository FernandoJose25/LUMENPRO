//! "Lo que suena en esta PC": copia lo que sale por los parlantes de Windows
//! (Spotify, YouTube, VirtualDJ…) y se lo pasa a la ventana, que lo escucha
//! igual que a un micrófono (src/lib/pcAudio.ts). Sin cable, sin micrófono y
//! sin guardar canciones. También puede copiar un solo programa (por ejemplo
//! solo Brave): así un juego u otro video no mueven las luces.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::ipc::{Channel, InvokeResponseBody};
use windows::core::{implement, Interface, Ref, HRESULT};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    eConsole, eRender, ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl, IAudioCaptureClient,
    IAudioClient, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK, AUDIOCLIENT_ACTIVATION_PARAMS,
    AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, WAVEFORMATEX,
    WAVE_FORMAT_PCM,
};
use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, IAgileObject, BLOB, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows::Win32::System::Threading::{CreateEventW, OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};
use windows::Win32::System::Variant::VT_BLOB;

/// Cada `pc_audio_start` o `pc_audio_stop` pasa el turno: la copia que ya no
/// tiene el turno termina sola.
static TURNO: AtomicU64 = AtomicU64::new(0);

/// Empieza a copiar el sonido de la PC (o solo el de `app`, como "brave.exe")
/// y devuelve las muestras por segundo. Después `on_audio` recibe bloques de
/// f32 mono (unos 20 ms cada uno) y `"ended"` si se corta (por ejemplo, si se
/// cierra ese programa).
#[tauri::command(async)]
pub fn pc_audio_start(on_audio: Channel<InvokeResponseBody>, app: Option<String>) -> Result<u32, String> {
    let fuente = match app {
        None => Fuente::Todo,
        Some(exe) => {
            let exe = exe.to_lowercase();
            let pid = raiz_del_programa(&exe).ok_or_else(|| format!("{} no está abierto", nombre_visible(&exe)))?;
            Fuente::Programa(pid)
        }
    };
    let turno = TURNO.fetch_add(1, Ordering::SeqCst) + 1;
    let (listo, esperar) = mpsc::channel();
    thread::spawn(move || {
        let mut empezo = false;
        let fin = copiar(
            turno,
            fuente,
            |muestras_por_segundo| {
                empezo = true;
                let _ = listo.send(Ok(muestras_por_segundo));
            },
            |bloque| {
                let bytes = bloque.iter().flat_map(|m| m.to_le_bytes()).collect();
                on_audio.send(InvokeResponseBody::Raw(bytes)).is_ok()
            },
        );
        if let Err(e) = fin {
            if empezo {
                let _ = on_audio.send(InvokeResponseBody::Json("\"ended\"".into()));
            } else {
                let _ = listo.send(Err(e));
            }
        }
    });
    esperar.recv().map_err(|_| "Windows no respondió".to_string())?
}

#[tauri::command]
pub fn pc_audio_stop() {
    TURNO.fetch_add(1, Ordering::SeqCst);
}

/// Los programas que tienen sonido ahora (y Brave si está instalado), para
/// elegir "solo ese" en Audio Reactive. Nombres de exe en minúsculas.
#[tauri::command(async)]
pub fn pc_audio_apps() -> Vec<String> {
    let mut apps: Vec<String> = programas_con_sonido().unwrap_or_default();
    if crate::links::brave().is_some() && !apps.iter().any(|a| a == "brave.exe") {
        apps.insert(0, "brave.exe".into());
    }
    apps
}

fn texto(e: windows::core::Error) -> String {
    e.message()
}

fn nombre_visible(exe: &str) -> String {
    let base = exe.trim_end_matches(".exe");
    let mut letras = base.chars();
    letras.next().map(|c| c.to_uppercase().chain(letras).collect()).unwrap_or_default()
}

enum Fuente {
    Todo,
    /// El proceso principal de un programa: entra también lo de sus hijos
    /// (Brave hace sonar todas sus pestañas desde un proceso hijo).
    Programa(u32),
}

/// (pid, pid del padre, exe en minúsculas) de todos los procesos.
fn procesos() -> Vec<(u32, u32, String)> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    let mut lista = Vec::new();
    unsafe {
        let foto = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if foto == INVALID_HANDLE_VALUE {
            return lista;
        }
        let mut p: PROCESSENTRY32W = std::mem::zeroed();
        p.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut hay = Process32FirstW(foto, &mut p) != 0;
        while hay {
            let largo = p.szExeFile.iter().position(|&c| c == 0).unwrap_or(p.szExeFile.len());
            let exe = String::from_utf16_lossy(&p.szExeFile[..largo]).to_lowercase();
            lista.push((p.th32ProcessID, p.th32ParentProcessID, exe));
            hay = Process32NextW(foto, &mut p) != 0;
        }
        CloseHandle(foto);
    }
    lista
}

/// El proceso principal de un programa: el que no nació de otro igual. Si hay
/// varios (al abrir una ventana, Brave lanza uno que dura un instante), el que
/// tiene más procesos hijos.
fn raiz_del_programa(exe: &str) -> Option<u32> {
    let todos = procesos();
    let exe_de: HashMap<u32, &str> = todos.iter().map(|(pid, _, e)| (*pid, e.as_str())).collect();
    todos
        .iter()
        .filter(|(_, padre, e)| e == exe && exe_de.get(padre) != Some(&exe))
        .max_by_key(|(pid, _, _)| todos.iter().filter(|(_, padre, _)| padre == pid).count())
        .map(|(pid, _, _)| *pid)
}

fn programas_con_sonido() -> windows::core::Result<Vec<String>> {
    let exe_de: HashMap<u32, String> = procesos().into_iter().map(|(pid, _, e)| (pid, e)).collect();
    let mut apps = Vec::new();
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let lista: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let parlantes = lista.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let sesiones: IAudioSessionManager2 = parlantes.Activate(CLSCTX_ALL, None)?;
        let todas = sesiones.GetSessionEnumerator()?;
        for i in 0..todas.GetCount()? {
            let Ok(sesion) = todas.GetSession(i).and_then(|s| s.cast::<IAudioSessionControl2>()) else { continue };
            if sesion.IsSystemSoundsSession() == HRESULT(0) {
                continue;
            }
            let Some(exe) = sesion.GetProcessId().ok().and_then(|pid| exe_de.get(&pid)) else { continue };
            // El navegador interno de LUMEN y LUMEN mismo no sirven para esto.
            if exe == "msedgewebview2.exe" || exe.starts_with("lumen") || apps.contains(exe) {
                continue;
            }
            apps.push(exe.clone());
        }
    }
    Ok(apps)
}

/// Avisa cuando Windows terminó de preparar la copia de un programa.
#[implement(IActivateAudioInterfaceCompletionHandler, IAgileObject)]
struct Preparada(Mutex<Option<mpsc::Sender<()>>>);

/// Sin métodos: dice que se le puede avisar desde cualquier hilo.
impl windows::Win32::System::Com::IAgileObject_Impl for Preparada_Impl {}

impl IActivateAudioInterfaceCompletionHandler_Impl for Preparada_Impl {
    fn ActivateCompleted(&self, _: Ref<IActivateAudioInterfaceAsyncOperation>) -> windows::core::Result<()> {
        if let Some(aviso) = self.0.lock().unwrap().take() {
            let _ = aviso.send(());
        }
        Ok(())
    }
}

/// Un cliente de audio que copia solo lo que suena en `pid` y sus hijos.
fn cliente_de_programa(pid: u32) -> Result<IAudioClient, String> {
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };
    // ManuallyDrop: al soltarse, PROPVARIANT liberaría `params`, que no es
    // memoria de Windows (rompía el programa).
    let prop = std::mem::ManuallyDrop::new(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                        pBlobData: &mut params as *mut _ as *mut u8,
                    },
                },
            }),
        },
    });
    let (aviso, esperar) = mpsc::channel();
    let preparada: IActivateAudioInterfaceCompletionHandler = Preparada(Mutex::new(Some(aviso))).into();
    unsafe {
        let pedido =
            ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, &IAudioClient::IID, Some(&*prop), &preparada)
                .map_err(texto)?;
        esperar.recv_timeout(Duration::from_secs(5)).map_err(|_| "Windows no respondió".to_string())?;
        let (mut resultado, mut cliente) = (HRESULT(0), None);
        pedido.GetActivateResult(&mut resultado, &mut cliente).map_err(texto)?;
        resultado.ok().map_err(texto)?;
        cliente.ok_or("Windows no dio el audio del programa")?.cast().map_err(texto)
    }
}

/// Copia hasta perder el turno o hasta que `bloque` devuelva false.
fn copiar(
    turno: u64,
    fuente: Fuente,
    empezo: impl FnOnce(u32),
    mut bloque: impl FnMut(&[f32]) -> bool,
) -> Result<(), String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        // Con un programa: aviso de Windows cuando hay sonido, y saber si se cerró.
        let mut aviso: Option<HANDLE> = None;
        let mut proceso: Option<HANDLE> = None;
        let (cliente, f) = match fuente {
            Fuente::Todo => {
                let parlantes = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .and_then(|lista| lista.GetDefaultAudioEndpoint(eRender, eConsole))
                    .map_err(|_| "Windows no tiene una salida de sonido activa".to_string())?;
                let cliente: IAudioClient = parlantes.Activate(CLSCTX_ALL, None).map_err(texto)?;
                let formato = cliente.GetMixFormat().map_err(texto)?;
                let f = formato.read_unaligned();
                // 200 ms de colchón; la copia se lee cada 10 ms.
                let iniciado =
                    cliente.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 2_000_000, 0, formato, None);
                CoTaskMemFree(Some(formato as *const _));
                iniciado.map_err(texto)?;
                (cliente, f)
            }
            Fuente::Programa(pid) => {
                let cliente = cliente_de_programa(pid)?;
                // La copia de un programa no dice su formato: se le pide uno.
                let f = WAVEFORMATEX {
                    wFormatTag: WAVE_FORMAT_PCM as u16,
                    nChannels: 2,
                    nSamplesPerSec: 48_000,
                    nAvgBytesPerSec: 48_000 * 4,
                    nBlockAlign: 4,
                    wBitsPerSample: 16,
                    cbSize: 0,
                };
                let banderas = AUDCLNT_STREAMFLAGS_LOOPBACK
                    | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                    | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM;
                cliente.Initialize(AUDCLNT_SHAREMODE_SHARED, banderas, 2_000_000, 0, &f, None).map_err(texto)?;
                let evento = CreateEventW(None, false, false, None).map_err(texto)?;
                cliente.SetEventHandle(evento).map_err(texto)?;
                aviso = Some(evento);
                proceso = OpenProcess(PROCESS_SYNCHRONIZE, false, pid).ok();
                (cliente, f)
            }
        };
        let bits = f.wBitsPerSample;
        if bits != 32 && bits != 16 {
            return Err(format!("Windows mezcla el sonido en {bits} bits y solo sé leer 16 o 32"));
        }
        let canales = usize::from(f.nChannels.max(1));
        let por_bloque = (f.nSamplesPerSec / 50) as usize;
        let captura: IAudioCaptureClient = cliente.GetService().map_err(texto)?;
        cliente.Start().map_err(texto)?;
        empezo(f.nSamplesPerSec);

        let mut mono: Vec<f32> = Vec::with_capacity(por_bloque * 2);
        let resultado = loop {
            if TURNO.load(Ordering::SeqCst) != turno {
                break Ok(());
            }
            match aviso {
                Some(evento) => {
                    WaitForSingleObject(evento, 100);
                }
                None => thread::sleep(Duration::from_millis(10)),
            }
            if proceso.is_some_and(|p| WaitForSingleObject(p, 0) == WAIT_OBJECT_0) {
                break Err("Se cerró el programa".to_string());
            }
            let leido = (|| -> windows::core::Result<()> {
                while captura.GetNextPacketSize()? > 0 {
                    let mut datos = std::ptr::null_mut();
                    let (mut cuadros, mut banderas) = (0u32, 0u32);
                    captura.GetBuffer(&mut datos, &mut cuadros, &mut banderas, None, None)?;
                    let n = cuadros as usize;
                    if banderas & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || datos.is_null() {
                        mono.extend(std::iter::repeat_n(0.0, n));
                    } else if bits == 32 {
                        let s = std::slice::from_raw_parts(datos as *const f32, n * canales);
                        mono.extend(s.chunks_exact(canales).map(|c| c.iter().sum::<f32>() / canales as f32));
                    } else {
                        let s = std::slice::from_raw_parts(datos as *const i16, n * canales);
                        let escala = canales as f32 * 32768.0;
                        mono.extend(s.chunks_exact(canales).map(|c| c.iter().map(|&v| f32::from(v)).sum::<f32>() / escala));
                    }
                    captura.ReleaseBuffer(cuadros)?;
                }
                Ok(())
            })();
            if let Err(e) = leido {
                break Err(texto(e));
            }
            if mono.len() >= por_bloque {
                if !bloque(&mono) {
                    break Ok(());
                }
                mono.clear();
            }
        };
        let _ = cliente.Stop();
        for h in [aviso, proceso].into_iter().flatten() {
            let _ = CloseHandle(h);
        }
        resultado
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn oye(fuente: Fuente, pitido: &str) -> (u32, f32) {
        let turno = TURNO.fetch_add(1, Ordering::SeqCst) + 1;
        let mut sonido = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &format!("Start-Sleep -Milliseconds 400; {pitido}")])
            .spawn()
            .unwrap();
        let inicio = Instant::now();
        let (mut maximo, mut tasa) = (0f32, 0);
        copiar(turno, fuente, |t| tasa = t, |b| {
            maximo = b.iter().fold(maximo, |m, v| m.max(v.abs()));
            inicio.elapsed() < Duration::from_millis(1800)
        })
        .unwrap();
        sonido.wait().unwrap();
        (tasa, maximo)
    }

    /// Necesita parlantes o audífonos: `cargo test oye_lo_que_suena -- --ignored`.
    /// Toca un pitido corto y comprueba que la copia lo oye.
    #[test]
    #[ignore]
    fn oye_lo_que_suena() {
        let (tasa, maximo) = oye(Fuente::Todo, "[console]::beep(440, 600)");
        assert!(tasa >= 8000, "muestras por segundo: {tasa}");
        assert!(maximo > 0.01, "no se oyó el pitido (máximo {maximo})");
    }

    /// `cargo test oye_solo_un_programa -- --ignored`: un sonido de este
    /// PowerShell se oye copiando ese programa, y no copiando otro.
    #[test]
    #[ignore]
    fn oye_solo_un_programa() {
        let wav = r"(New-Object Media.SoundPlayer 'C:\Windows\Media\Windows Notify System Generic.wav').PlaySync()";
        let yo = std::process::id();
        let (_, de_mis_hijos) = oye(Fuente::Programa(yo), wav);
        assert!(de_mis_hijos > 0.01, "no se oyó el sonido del programa (máximo {de_mis_hijos})");
        let explorer = raiz_del_programa("explorer.exe").expect("explorer abierto");
        let (_, de_otro) = oye(Fuente::Programa(explorer), wav);
        assert!(de_otro < 0.005, "se oyó un programa que no era el elegido (máximo {de_otro})");
    }
}
