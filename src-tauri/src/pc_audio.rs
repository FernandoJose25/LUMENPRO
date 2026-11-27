//! "Lo que suena en esta PC": copia lo que sale por los parlantes de Windows
//! (Spotify, YouTube, VirtualDJ…) y se lo pasa a la ventana, que lo escucha
//! igual que a un micrófono (src/lib/pcAudio.ts). Sin cable, sin micrófono y
//! sin guardar canciones.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use tauri::ipc::{Channel, InvokeResponseBody};
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED};

/// Cada `pc_audio_start` o `pc_audio_stop` pasa el turno: la copia que ya no
/// tiene el turno termina sola.
static TURNO: AtomicU64 = AtomicU64::new(0);

/// Empieza a copiar el sonido de la PC y devuelve las muestras por segundo.
/// Después `on_audio` recibe bloques de f32 mono (unos 20 ms cada uno) y
/// `"ended"` si Windows corta la copia.
#[tauri::command(async)]
pub fn pc_audio_start(on_audio: Channel<InvokeResponseBody>) -> Result<u32, String> {
    let turno = TURNO.fetch_add(1, Ordering::SeqCst) + 1;
    let (listo, esperar) = mpsc::channel();
    thread::spawn(move || {
        let mut empezo = false;
        let fin = copiar(
            turno,
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

fn texto(e: windows::core::Error) -> String {
    e.message()
}

/// Copia hasta perder el turno o hasta que `bloque` devuelva false.
fn copiar(turno: u64, empezo: impl FnOnce(u32), mut bloque: impl FnMut(&[f32]) -> bool) -> Result<(), String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let parlantes = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .and_then(|lista| lista.GetDefaultAudioEndpoint(eRender, eConsole))
            .map_err(|_| "Windows no tiene una salida de sonido activa".to_string())?;
        let cliente: IAudioClient = parlantes.Activate(CLSCTX_ALL, None).map_err(texto)?;
        let formato = cliente.GetMixFormat().map_err(texto)?;
        let f = formato.read_unaligned();
        // 200 ms de colchón; la copia se lee cada 10 ms.
        let iniciado = cliente.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 2_000_000, 0, formato, None);
        CoTaskMemFree(Some(formato as *const _));
        iniciado.map_err(texto)?;
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
            thread::sleep(Duration::from_millis(10));
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
        resultado
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    /// Necesita parlantes o audífonos: `cargo test oye_lo_que_suena -- --ignored`.
    /// Toca un pitido corto y comprueba que la copia lo oye.
    #[test]
    #[ignore]
    fn oye_lo_que_suena() {
        let turno = TURNO.fetch_add(1, Ordering::SeqCst) + 1;
        let mut pitido = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", "Start-Sleep -Milliseconds 400; [console]::beep(440, 600)"])
            .spawn()
            .unwrap();
        let inicio = Instant::now();
        let (mut maximo, mut tasa) = (0f32, 0);
        copiar(turno, |t| tasa = t, |b| {
            maximo = b.iter().fold(maximo, |m, v| m.max(v.abs()));
            inicio.elapsed() < Duration::from_millis(1800)
        })
        .unwrap();
        pitido.wait().unwrap();
        assert!(tasa >= 8000, "muestras por segundo: {tasa}");
        assert!(maximo > 0.01, "no se oyó el pitido (máximo {maximo})");
    }
}
