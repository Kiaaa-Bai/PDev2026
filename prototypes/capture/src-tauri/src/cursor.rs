//! Fallback input: the global cursor, reported as one synthetic finger (id 0)
//! that is down while the cursor moves and lifts after it rests.

use crate::record::Contact;

const STATE_MAKE_TOUCH: i32 = 3;
const STATE_TOUCHING: i32 = 4;
const REST_MS: u64 = 300;
const MIN_MOVE: f64 = 0.0005;

pub struct CursorStroker {
    down: bool,
    last: Option<(f64, f64)>,
    last_move_ms: u64,
}

impl CursorStroker {
    pub fn new() -> Self {
        Self { down: false, last: None, last_move_ms: 0 }
    }

    /// Feed one cursor sample (origin top-left, 0–1). Returns a frame to send, if any.
    pub fn step(&mut self, now_ms: u64, x: f64, y: f64) -> Option<Vec<Contact>> {
        let moved = match self.last {
            Some((lx, ly)) => (x - lx).abs() > MIN_MOVE || (y - ly).abs() > MIN_MOVE,
            None => false,
        };
        self.last = Some((x, y));
        if moved {
            self.last_move_ms = now_ms;
            let state = if self.down { STATE_TOUCHING } else { STATE_MAKE_TOUCH };
            self.down = true;
            // The sampler flips y for the trackpad's bottom-left origin, so pre-flip.
            return Some(vec![Contact { id: 0, state, x: x as f32, y: (1.0 - y) as f32 }]);
        }
        if self.down && now_ms.saturating_sub(self.last_move_ms) >= REST_MS {
            self.down = false;
            return Some(Vec::new()); // an empty frame makes the sampler lift finger 0
        }
        None
    }
}

use std::ffi::c_void;
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CGSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventCreate(source: *const c_void) -> *mut c_void;
    fn CGEventGetLocation(event: *mut c_void) -> CGPoint;
    fn CGMainDisplayID() -> u32;
    fn CGDisplayBounds(display: u32) -> CGRect;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(cf: *const c_void);
}

/// Cursor position on the main display, origin top-left, 0–1. Needs no permission.
fn cursor_normalized() -> Option<(f64, f64)> {
    unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            return None;
        }
        let p = CGEventGetLocation(event);
        CFRelease(event);
        let b = CGDisplayBounds(CGMainDisplayID());
        if b.size.width <= 0.0 || b.size.height <= 0.0 {
            return None;
        }
        Some((
            ((p.x - b.origin.x) / b.size.width).clamp(0.0, 1.0),
            ((p.y - b.origin.y) / b.size.height).clamp(0.0, 1.0),
        ))
    }
}

pub fn start() -> Result<Receiver<Vec<Contact>>, String> {
    if cursor_normalized().is_none() {
        return Err("cannot read the cursor position".into());
    }
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut stroker = CursorStroker::new();
        loop {
            std::thread::sleep(Duration::from_millis(16));
            let Some((x, y)) = cursor_normalized() else { continue };
            if let Some(frame) = stroker.step(crate::capture::now_ms(), x, y) {
                if tx.send(frame).is_err() {
                    break;
                }
            }
        }
    });
    Ok(rx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_sample_only_sets_a_baseline() {
        let mut s = CursorStroker::new();
        assert_eq!(s.step(0, 0.5, 0.5), None);
    }

    #[test]
    fn moving_makes_a_touch_then_keeps_touching() {
        let mut s = CursorStroker::new();
        s.step(0, 0.5, 0.5);
        let first = s.step(16, 0.6, 0.5).unwrap();
        assert_eq!(first[0].state, 3);
        let second = s.step(32, 0.7, 0.5).unwrap();
        assert_eq!(second[0].state, 4);
    }

    #[test]
    fn y_is_flipped_to_the_trackpad_origin() {
        let mut s = CursorStroker::new();
        s.step(0, 0.5, 0.5);
        let frame = s.step(16, 0.6, 0.25).unwrap();
        assert_eq!(frame[0].y, 0.75);
    }

    #[test]
    fn resting_lifts_the_finger_once() {
        let mut s = CursorStroker::new();
        s.step(0, 0.5, 0.5);
        s.step(16, 0.6, 0.5);
        assert_eq!(s.step(200, 0.6, 0.5), None);
        assert_eq!(s.step(316, 0.6, 0.5), Some(Vec::new()));
        assert_eq!(s.step(400, 0.6, 0.5), None);
    }
}
