//! Reads every finger on the built-in trackpad through Apple's private
//! MultitouchSupport framework. The framework is loaded with dlopen at
//! runtime, so nothing links against it at build time.

/// A 2D value as the framework stores it.
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct MTPoint {
    pub x: f32,
    pub y: f32,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct MTVector {
    pub position: MTPoint,
    pub velocity: MTPoint,
}

/// One contact, laid out exactly as the framework writes it (96 bytes).
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct MTTouch {
    pub frame: i32,
    pub timestamp: f64,
    pub identifier: i32,
    pub state: i32,
    pub finger_id: i32,
    pub hand_id: i32,
    pub normalized: MTVector,
    pub total: f32,
    pub pressure: f32,
    pub angle: f32,
    pub major_axis: f32,
    pub minor_axis: f32,
    pub absolute: MTVector,
    pub field14: i32,
    pub field15: i32,
    pub density: f32,
}

use crate::record::Contact;
use std::ffi::{CStr, c_char, c_int, c_void};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Mutex, OnceLock};

const FRAMEWORK: &CStr =
    c"/System/Library/PrivateFrameworks/MultitouchSupport.framework/MultitouchSupport";
const RTLD_NOW: c_int = 0x2;

type MTDeviceRef = *mut c_void;
type ContactCallback =
    unsafe extern "C" fn(MTDeviceRef, *const MTTouch, c_int, f64, c_int) -> c_int;
type CreateDefaultFn = unsafe extern "C" fn() -> MTDeviceRef;
type RegisterFn = unsafe extern "C" fn(MTDeviceRef, ContactCallback);
type StartFn = unsafe extern "C" fn(MTDeviceRef, c_int) -> c_int;
type StopFn = unsafe extern "C" fn(MTDeviceRef) -> c_int;

unsafe extern "C" {
    fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

/// The framework callback carries no user data, so frames leave through this.
static FRAMES: OnceLock<Sender<Vec<Contact>>> = OnceLock::new();

unsafe extern "C" fn on_frame(
    _device: MTDeviceRef,
    touches: *const MTTouch,
    count: c_int,
    _timestamp: f64,
    _frame: c_int,
) -> c_int {
    let touches: &[MTTouch] = if touches.is_null() || count <= 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(touches, count as usize) }
    };
    let frame: Vec<Contact> = touches
        .iter()
        .map(|t| Contact {
            id: t.identifier,
            state: t.state,
            x: t.normalized.position.x,
            y: t.normalized.position.y,
        })
        .collect();
    if let Some(tx) = FRAMES.get() {
        let _ = tx.send(frame);
    }
    0
}

unsafe fn symbol(lib: *mut c_void, name: &CStr) -> Result<*mut c_void, String> {
    let ptr = unsafe { dlsym(lib, name.as_ptr()) };
    if ptr.is_null() {
        Err(format!("MultitouchSupport has no symbol {}", name.to_string_lossy()))
    } else {
        Ok(ptr)
    }
}

struct Api {
    create: CreateDefaultFn,
    register: RegisterFn,
    start: StartFn,
    stop: StopFn,
}

static API: OnceLock<Api> = OnceLock::new();

/// The device currently sending frames, kept as an address (raw pointers are not Send).
static DEVICE: Mutex<usize> = Mutex::new(0);

fn api() -> Result<&'static Api, String> {
    if let Some(api) = API.get() {
        return Ok(api);
    }
    let loaded = unsafe {
        let lib = dlopen(FRAMEWORK.as_ptr(), RTLD_NOW);
        if lib.is_null() {
            return Err("could not load MultitouchSupport.framework".into());
        }
        Api {
            create: std::mem::transmute(symbol(lib, c"MTDeviceCreateDefault")?),
            register: std::mem::transmute(symbol(lib, c"MTRegisterContactFrameCallback")?),
            start: std::mem::transmute(symbol(lib, c"MTDeviceStart")?),
            stop: std::mem::transmute(symbol(lib, c"MTDeviceStop")?),
        }
    };
    Ok(API.get_or_init(|| loaded))
}

fn open_device(api: &Api) -> Result<(), String> {
    unsafe {
        let device = (api.create)();
        if device.is_null() {
            return Err("no multitouch device found".into());
        }
        (api.register)(device, on_frame);
        let status = (api.start)(device, 0);
        if status != 0 {
            return Err(format!("MTDeviceStart failed with status {status}"));
        }
        *DEVICE.lock().unwrap_or_else(|e| e.into_inner()) = device as usize;
    }
    Ok(())
}

/// Starts the default multitouch device. Each frame arrives on the returned
/// channel as the contacts in that frame (possibly none). Call once per process.
pub fn start() -> Result<Receiver<Vec<Contact>>, String> {
    let (tx, rx) = mpsc::channel();
    FRAMES
        .set(tx)
        .map_err(|_| "multitouch capture already started".to_string())?;
    open_device(api()?)?;
    Ok(rx)
}

/// After the Mac sleeps, the open device stops sending frames. Stop it and
/// open a fresh one; frames keep arriving on the channel `start` returned.
pub fn restart() -> Result<(), String> {
    let api = api()?;
    let old = std::mem::replace(&mut *DEVICE.lock().unwrap_or_else(|e| e.into_inner()), 0);
    if old != 0 {
        unsafe { (api.stop)(old as MTDeviceRef) };
    }
    open_device(api)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::{offset_of, size_of};

    #[test]
    fn touch_layout_matches_the_framework() {
        assert_eq!(size_of::<MTTouch>(), 96);
        assert_eq!(offset_of!(MTTouch, timestamp), 8);
        assert_eq!(offset_of!(MTTouch, identifier), 16);
        assert_eq!(offset_of!(MTTouch, state), 20);
        assert_eq!(offset_of!(MTTouch, normalized), 32);
        assert_eq!(offset_of!(MTTouch, absolute), 68);
        assert_eq!(offset_of!(MTTouch, density), 92);
    }
}
