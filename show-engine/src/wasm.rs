//! Puerta de entrada desde JavaScript (`src/lib/wasmEngine.ts`). Los textos
//! viajan como (puntero, largo) y las respuestas, empaquetadas en un u64.

use crate::show::{Message, Show};

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()).cast()
}

/// # Safety
/// `ptr` y `len` tienen que venir de `alloc` o de una respuesta.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}

fn reply(text: String) -> u64 {
    let bytes = text.into_bytes().into_boxed_slice();
    let len = bytes.len() as u64;
    let ptr = Box::into_raw(bytes).cast::<u8>() as u64;
    ptr << 32 | len
}

#[no_mangle]
pub extern "C" fn show_new() -> *mut Show {
    Box::into_raw(Box::new(Show::new()))
}

/// Aplica una orden en JSON. Responde vacío, o el error.
///
/// # Safety
/// `show` viene de `show_new`; `ptr` y `len`, de `alloc`.
#[no_mangle]
pub unsafe extern "C" fn show_send(show: *mut Show, ptr: *const u8, len: usize, now: f64) -> u64 {
    let result = serde_json::from_slice::<Message>(std::slice::from_raw_parts(ptr, len))
        .map_err(|e| e.to_string())
        .and_then(|message| (*show).apply(message, now));
    reply(result.err().unwrap_or_default())
}

/// # Safety
/// `show` viene de `show_new`.
#[no_mangle]
pub unsafe extern "C" fn show_tick(show: *mut Show, now: f64) {
    (*show).tick(now);
}

/// # Safety
/// `show` viene de `show_new`.
#[no_mangle]
pub unsafe extern "C" fn show_changes(show: *const Show, since: f64) -> u64 {
    let show = &*show;
    if show.rev() == since as u64 {
        return reply(String::new());
    }
    reply(show.changes(since as u64).to_string())
}

/// Los 512 canales.
///
/// # Safety
/// `show` viene de `show_new`.
#[no_mangle]
pub unsafe extern "C" fn show_frame(show: *const Show, universe: i32) -> *mut u8 {
    Box::into_raw(Box::new((*show).frame(universe))).cast()
}
