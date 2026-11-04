//! Pointer input: the global cursor, reported as one synthetic finger (id 0)
//! that is down while the cursor moves and lifts after it rests. Positions are
//! global screen points, origin top-left of the main display.

use crate::record::Contact;

const STATE_MAKE_TOUCH: i32 = 3;
const STATE_TOUCHING: i32 = 4;
const REST_MS: u64 = 300;
/// Smallest move, in points, that counts as the pointer moving.
const MIN_MOVE: f64 = 0.5;

pub struct CursorStroker {
    down: bool,
    last: Option<(f64, f64)>,
    last_move_ms: u64,
}

impl CursorStroker {
    pub fn new() -> Self {
        Self { down: false, last: None, last_move_ms: 0 }
    }

    /// Feed one cursor sample (global points, origin top-left). Returns a frame to send, if any.
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
            return Some(vec![Contact { id: 0, state, x: x as f32, y: y as f32 }]);
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
    fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
    fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
}

/// kCGEventSourceStateCombinedSessionState: every input source of this login session.
const COMBINED_SESSION_STATE: i32 = 0;
/// kCGMouseButtonLeft: the primary button (a trackpad click counts as it).
const LEFT_BUTTON: u32 = 0;

/// Whether the primary mouse button is held down now, wherever the pointer is and whichever app is in front.
pub fn left_button_down() -> bool {
    unsafe { CGEventSourceButtonState(COMBINED_SESSION_STATE, LEFT_BUTTON) }
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(cf: *const c_void);
}

/// Cursor position in global screen points, origin top-left of the main
/// display, as the system reports it (can be negative or past the main
/// display's size on other displays). Needs no permission.
fn cursor_global() -> Option<(f64, f64)> {
    unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            return None;
        }
        let p = CGEventGetLocation(event);
        CFRelease(event);
        Some((p.x, p.y))
    }
}

/// `[x, y, w, h]` covering every rect, or `None` when there are none.
fn union_of(rects: &[[f64; 4]]) -> Option<[f64; 4]> {
    let (first, rest) = rects.split_first()?;
    let (mut x0, mut y0) = (first[0], first[1]);
    let (mut x1, mut y1) = (first[0] + first[2], first[1] + first[3]);
    for r in rest {
        x0 = x0.min(r[0]);
        y0 = y0.min(r[1]);
        x1 = x1.max(r[0] + r[2]);
        y1 = y1.max(r[1] + r[3]);
    }
    Some([x0, y0, x1 - x0, y1 - y0])
}

/// `[x, y, w, h]` of one display, in global points.
fn bounds_of(display: u32) -> [f64; 4] {
    let b = unsafe { CGDisplayBounds(display) };
    [b.origin.x, b.origin.y, b.size.width, b.size.height]
}

/// `[x, y, w, h]` of the union of the active displays, in the same global
/// points as the cursor. Falls back to the main display if the list is empty.
pub fn display_bounds() -> [f64; 4] {
    const MAX_DISPLAYS: usize = 32;
    let mut ids = [0u32; MAX_DISPLAYS];
    let mut count = 0u32;
    let ok = unsafe { CGGetActiveDisplayList(MAX_DISPLAYS as u32, ids.as_mut_ptr(), &mut count) } == 0;
    let n = if ok { (count as usize).min(MAX_DISPLAYS) } else { 0 };
    let rects: Vec<[f64; 4]> = ids[..n].iter().map(|&id| bounds_of(id)).collect();
    union_of(&rects).unwrap_or_else(|| bounds_of(unsafe { CGMainDisplayID() }))
}

pub fn start() -> Result<Receiver<Vec<Contact>>, String> {
    if cursor_global().is_none() {
        return Err("cannot read the cursor position".into());
    }
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut stroker = CursorStroker::new();
        loop {
            std::thread::sleep(Duration::from_millis(16));
            let Some((x, y)) = cursor_global() else { continue };
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
        assert_eq!(s.step(0, 500.0, 500.0), None);
    }

    #[test]
    fn moving_makes_a_touch_then_keeps_touching() {
        let mut s = CursorStroker::new();
        s.step(0, 500.0, 500.0);
        let first = s.step(16, 600.0, 500.0).unwrap();
        assert_eq!(first[0].state, 3);
        let second = s.step(32, 700.0, 500.0).unwrap();
        assert_eq!(second[0].state, 4);
    }

    #[test]
    fn y_is_kept_top_left() {
        let mut s = CursorStroker::new();
        s.step(0, 500.0, 500.0);
        let frame = s.step(16, 600.0, 250.0).unwrap();
        assert_eq!(frame[0].y, 250.0);
    }

    #[test]
    fn points_pass_through_unclamped() {
        let mut s = CursorStroker::new();
        s.step(0, 100.0, 50.0);
        let frame = s.step(16, -300.5, 1200.0).unwrap();
        assert_eq!(frame[0].x, -300.5);
        assert_eq!(frame[0].y, 1200.0);
    }

    #[test]
    fn moves_under_half_a_point_are_rest() {
        let mut s = CursorStroker::new();
        s.step(0, 100.0, 50.0);
        assert_eq!(s.step(16, 100.3, 50.0), None);
    }

    #[test]
    fn resting_lifts_the_finger_once() {
        let mut s = CursorStroker::new();
        s.step(0, 500.0, 500.0);
        s.step(16, 600.0, 500.0);
        assert_eq!(s.step(200, 600.0, 500.0), None);
        assert_eq!(s.step(316, 600.0, 500.0), Some(Vec::new()));
        assert_eq!(s.step(400, 600.0, 500.0), None);
    }

    #[test]
    fn the_display_union_spans_every_screen() {
        assert_eq!(union_of(&[]), None);
        let main = [0.0, 0.0, 1440.0, 900.0];
        let left_above = [-1920.0, -300.0, 1920.0, 1080.0];
        assert_eq!(union_of(&[main, left_above]), Some([-1920.0, -300.0, 3360.0, 1200.0]));
    }
}
