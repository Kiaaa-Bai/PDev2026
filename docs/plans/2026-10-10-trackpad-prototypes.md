# Trackpad Prototypes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two prototypes for PDev Class 6: Capture, a small Tauri app that records every trackpad finger to a daily `.jsonl`, and Form study, a browser page that draws the same data as a city, a farm and a monster field.

**Architecture:** Capture is a Tauri v2 app. Rust loads Apple's private MultitouchSupport framework with `dlopen`, turns each contact frame into `{t,id,x,y,state}` records through a throttling sampler, appends them to `prototypes/data/touches-YYYY-MM-DD.jsonl` and emits them to a canvas window. If the framework is unavailable it falls back to the global cursor. Form study is a Vite + PixiJS page: pure TypeScript simulations (city, farm, monster) consume strokes from a dropped file or from live mouse drags, and thin Pixi views draw their state with Kenney pixel tiles.

**Tech Stack:** Rust (stable) · Tauri 2 (`create-tauri-app@4.7.5`, vanilla-ts template) · chrono 0.4 · tempfile 3 (tests) · Vite 8.3.4 · TypeScript 5.9.3 · PixiJS 8.22.0 · Vitest 5.0.3 · pnpm 10

**Spec:** `docs/specs/2026-10-10-trackpad-prototypes-design.md`

## Global Constraints

- macOS only. Capture targets the built-in trackpad of Kia's MacBook (macOS 27.0).
- Record format, exactly: `{"t":<ms since epoch>,"id":<int>,"x":<0–1>,"y":<0–1>,"state":"down"|"move"|"up"}`, one per line, origin top-left, positions rounded to 3 decimals.
- `down` and `up` are always written; `move` at most once per 33 ms per finger.
- Data files live in `prototypes/data/` and are gitignored, except `prototypes/data/sample.jsonl`, which is committed only after Kia says yes (the repo is a public blog).
- Pitch fields are locked: `Involuntary` · `Metaphor` · `Quiet` · `Wear as a record`. Nothing rewards deliberate input: the farm harvests itself, monsters are defeated only by ordinary strokes, no buttons in the forms.
- Art is Kenney CC0 pixel tiles (Tiny Town, Tiny Farm, Tiny Dungeon), always scaled nearest-neighbour.
- Grid sizes (a deliberate refinement of the spec's "about" numbers, to keep 16 px tiles at integer scale in a 512×320 panel that matches the pad's 1.6 aspect ratio): City 32×20 cells of 16 px; Farm and Monster 16×10 cells of 32 px.
- Ask Kia before: installing Rust, downloading the Kenney zips, committing `sample.jsonl`. Tasks 2 and 6 need Kia's finger on the trackpad.
- Commit after every task, locally. Never `git push`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A finger that vanishes with no later frame from the framework must get its `up` at the time it was last seen, not at the time of the next touch (test in Task 4).
- Recording across midnight must start a new file for the new local date (test in Task 5).
- A truncated last line, left by an app killed mid-write, must be skipped by both the Rust heat loader and the TypeScript parser (tests in Tasks 5 and 7).
- A sample cut out of a day with `head` starts mid-stroke and ends with fingers down; it must still produce strokes (test in Task 7).
- Dropping an empty or non-touch file on the page must leave the current world untouched and say so in the status line (parse test in Task 7, behaviour in Task 13).

---

## File Structure

```
.gitignore                                   + data, build output, .claude/
.claude/launch.json                          dev-server config for the browser pane (gitignored)
prototypes/
  data/.gitkeep
  capture/                                   Tauri app (scaffolded)
    index.html                               replaced: canvas + HUD
    src/main.ts                              replaced: live dots + heat map
    src/styles.css                           replaced
    src-tauri/
      Cargo.toml                             + chrono, tempfile
      tauri.conf.json                        window: 320×200, always on top
      src/lib.rs                             replaced: modules, commands, setup
      src/record.rs                          TouchRecord, TouchState, Contact, map_state
      src/multitouch.rs                      dlopen MultitouchSupport, contact frames
      src/cursor.rs                          fallback: global cursor as one finger
      src/sampler.rs                         contacts → records (throttle, flip, up synthesis)
      src/store.rs                           daily .jsonl writer, today's heat
      src/capture.rs                         glue thread: source → sampler → file + emit
      examples/probe.rs                      spike: print contacts for 10 s
  form-study/
    package.json  tsconfig.json  vite.config.ts  index.html
    src/main.ts                              page wiring, modes, file drop
    src/style.css
    src/data.ts                              parseJsonl, toStrokes
    src/grid.ts                              cellOf, segmentCells, StrokeCells
    src/rng.ts                               mulberry32
    src/config.ts                            CITY, FARM, MONSTER, MONSTER_LIVE_SPAWN_MS
    src/sims/types.ts                        Sim interface
    src/sims/city.ts  farm.ts  monster.ts    pure simulations
    src/drive.ts                             replay(), attachLive()
    src/tiles.ts                             tile roles → textures
    src/render/panel.ts  city.ts  farm.ts  monster.ts
    src/assets/tiles/                        Kenney PNGs + licences
    test/*.test.ts
```

---

### Task 1: Toolchain and Capture scaffold

**Files:**
- Modify: `.gitignore`
- Create: `prototypes/data/.gitkeep`, `prototypes/capture/` (scaffolded)
- Modify: `prototypes/capture/src-tauri/tauri.conf.json`

**Interfaces:**
- Produces: a Tauri crate at `prototypes/capture/src-tauri` whose library is named `capture_lib` (check `[lib] name` in `Cargo.toml`; later tasks assume it).

- [ ] **Step 1: Ask Kia, then install Rust**

Ask: "Install Rust with the official rustup installer (sh.rustup.rs)?" Only after a yes:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc --version
```

Expected: `rustc 1.x.y (...)`. Later shells need `source "$HOME/.cargo/env"` until a new terminal is opened.

- [ ] **Step 2: Scaffold the app**

```bash
mkdir -p /Users/kiabai/Documents/PDev2026/prototypes/data
touch /Users/kiabai/Documents/PDev2026/prototypes/data/.gitkeep
cd /Users/kiabai/Documents/PDev2026/prototypes
pnpm dlx create-tauri-app@4.7.5 capture --manager pnpm --template vanilla-ts --identifier edu.nyu.kiabai.trackpad --yes
cd capture && pnpm install
grep -A2 '^\[lib\]' src-tauri/Cargo.toml
```

Expected: the `[lib]` block shows `name = "capture_lib"`. If it differs, use that name wherever this plan says `capture_lib`.

- [ ] **Step 3: Configure the window**

In `prototypes/capture/src-tauri/tauri.conf.json`, replace the object inside `app.windows` with:

```json
{
  "title": "Trackpad",
  "width": 320,
  "height": 200,
  "resizable": false,
  "alwaysOnTop": true
}
```

- [ ] **Step 4: Ignore data and build output**

Replace `/Users/kiabai/Documents/PDev2026/.gitignore` with:

```
.DS_Store
node_modules/
dist/
target/
.claude/
prototypes/data/*.jsonl
!prototypes/data/sample.jsonl
```

- [ ] **Step 5: Build once**

```bash
cd /Users/kiabai/Documents/PDev2026/prototypes/capture
pnpm build
cd src-tauri && cargo build
```

Expected: both finish without errors (the first `cargo build` takes a few minutes).

- [ ] **Step 6: Commit**

```bash
cd /Users/kiabai/Documents/PDev2026
git add .gitignore prototypes/data/.gitkeep prototypes/capture
git commit -m "Scaffold Capture Tauri app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Record types and the multitouch spike

The spec's first risk: does MultitouchSupport still deliver frames on macOS 27? This task answers it.

**Files:**
- Create: `prototypes/capture/src-tauri/src/record.rs`
- Create: `prototypes/capture/src-tauri/src/multitouch.rs`
- Create: `prototypes/capture/src-tauri/examples/probe.rs`
- Modify: `prototypes/capture/src-tauri/src/lib.rs` (add module lines only)

**Interfaces:**
- Produces:
  - `record::Contact { id: i32, state: i32, x: f32, y: f32 }` — raw framework values, origin bottom-left.
  - `record::TouchState { Down, Move, Up }` (serde lowercase), `record::TouchRecord { t: u64, id: i32, x: f64, y: f64, state: TouchState }`.
  - `record::Phase { Down, Move, Up }`, `record::map_state(i32) -> Option<Phase>`.
  - `multitouch::start() -> Result<std::sync::mpsc::Receiver<Vec<Contact>>, String>`.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/record.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TouchState {
    Down,
    Move,
    Up,
}

/// One line of the daily .jsonl file. x and y are 0–1 with the origin at the top-left.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TouchRecord {
    pub t: u64,
    pub id: i32,
    pub x: f64,
    pub y: f64,
    pub state: TouchState,
}

/// One contact as a capture source reports it: framework state code and
/// position, origin at the pad's bottom-left.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Contact {
    pub id: i32,
    pub state: i32,
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Down,
    Move,
    Up,
}

/// MultitouchSupport state codes: 1–2 hover, 3 make touch, 4 touching,
/// 5 break touch, 6 linger, 7 out of range.
pub fn map_state(code: i32) -> Option<Phase> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_serializes_to_the_spec_shape() {
        let r = TouchRecord { t: 1760112000123, id: 3, x: 0.412, y: 0.287, state: TouchState::Move };
        assert_eq!(
            serde_json::to_string(&r).unwrap(),
            r#"{"t":1760112000123,"id":3,"x":0.412,"y":0.287,"state":"move"}"#
        );
    }

    #[test]
    fn framework_states_map_to_phases() {
        assert_eq!(map_state(3), Some(Phase::Down));
        assert_eq!(map_state(4), Some(Phase::Move));
        assert_eq!(map_state(5), Some(Phase::Up));
        assert_eq!(map_state(6), Some(Phase::Up));
        assert_eq!(map_state(7), Some(Phase::Up));
        assert_eq!(map_state(0), None);
        assert_eq!(map_state(1), None);
        assert_eq!(map_state(2), None);
    }
}
```

Create `src-tauri/src/multitouch.rs` with only the struct layout and its test for now:

```rust
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
```

Add to the top of `src-tauri/src/lib.rs` (leave the template's `run()` as it is for now):

```rust
pub mod multitouch;
pub mod record;
```

- [ ] **Step 2: Run the tests to see the failure**

Run: `cd prototypes/capture/src-tauri && cargo test --lib`
Expected: `touch_layout_matches_the_framework` and `record_serializes_to_the_spec_shape` pass; `framework_states_map_to_phases` panics with `not yet implemented`.

- [ ] **Step 3: Implement `map_state`**

```rust
pub fn map_state(code: i32) -> Option<Phase> {
    match code {
        3 => Some(Phase::Down),
        4 => Some(Phase::Move),
        5 | 6 | 7 => Some(Phase::Up),
        _ => None,
    }
}
```

- [ ] **Step 4: Add the framework loader**

Append to `src-tauri/src/multitouch.rs` (above the `tests` module):

```rust
use crate::record::Contact;
use std::ffi::{c_char, c_int, c_void, CStr};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::OnceLock;

const FRAMEWORK: &CStr =
    c"/System/Library/PrivateFrameworks/MultitouchSupport.framework/MultitouchSupport";
const RTLD_NOW: c_int = 0x2;

type MTDeviceRef = *mut c_void;
type ContactCallback =
    unsafe extern "C" fn(MTDeviceRef, *const MTTouch, c_int, f64, c_int) -> c_int;
type CreateDefaultFn = unsafe extern "C" fn() -> MTDeviceRef;
type RegisterFn = unsafe extern "C" fn(MTDeviceRef, ContactCallback);
type StartFn = unsafe extern "C" fn(MTDeviceRef, c_int) -> c_int;

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

/// Starts the default multitouch device. Each frame arrives on the returned
/// channel as the contacts in that frame (possibly none). Call once per process.
pub fn start() -> Result<Receiver<Vec<Contact>>, String> {
    let (tx, rx) = mpsc::channel();
    FRAMES
        .set(tx)
        .map_err(|_| "multitouch capture already started".to_string())?;
    unsafe {
        let lib = dlopen(FRAMEWORK.as_ptr(), RTLD_NOW);
        if lib.is_null() {
            return Err("could not load MultitouchSupport.framework".into());
        }
        let create: CreateDefaultFn =
            std::mem::transmute(symbol(lib, c"MTDeviceCreateDefault")?);
        let register: RegisterFn =
            std::mem::transmute(symbol(lib, c"MTRegisterContactFrameCallback")?);
        let start_device: StartFn = std::mem::transmute(symbol(lib, c"MTDeviceStart")?);
        let device = create();
        if device.is_null() {
            return Err("no multitouch device found".into());
        }
        register(device, on_frame);
        let status = start_device(device, 0);
        if status != 0 {
            return Err(format!("MTDeviceStart failed with status {status}"));
        }
    }
    Ok(rx)
}
```

- [ ] **Step 5: Write the probe**

Create `src-tauri/examples/probe.rs`:

```rust
//! Spike: does MultitouchSupport deliver frames on this Mac?
//! Run, then swipe and two-finger scroll on the trackpad for 10 seconds.

use std::time::{Duration, Instant};

fn main() {
    let rx = capture_lib::multitouch::start().expect("multitouch start failed");
    println!("listening for 10 s — touch the trackpad");
    let deadline = Instant::now() + Duration::from_secs(10);
    let (mut frames, mut contacts, mut max_fingers) = (0usize, 0usize, 0usize);
    while Instant::now() < deadline {
        let Ok(frame) = rx.recv_timeout(Duration::from_millis(200)) else { continue };
        frames += 1;
        contacts += frame.len();
        max_fingers = max_fingers.max(frame.len());
        if frames % 25 == 0 {
            for c in &frame {
                println!("id={} state={} x={:.3} y={:.3}", c.id, c.state, c.x, c.y);
            }
        }
    }
    println!("frames={frames} contacts={contacts} max_fingers={max_fingers}");
}
```

- [ ] **Step 6: Run the tests**

Run: `cargo test --lib`
Expected: 3 passed.

- [ ] **Step 7: Run the spike with Kia**

Tell Kia: "Running the probe now. For 10 seconds, swipe with one finger, then two-finger scroll." Then:

Run: `cargo run --example probe`
Expected: `frames=` in the hundreds or more, `max_fingers=2`, sample lines with x and y between 0 and 1 and states 3, 4, 5.

**Gate:** if it prints `multitouch start failed`, or `frames=0` while Kia touched the pad, record the error and tell Kia the trackpad route is closed on macOS 27; Capture will run on the cursor fallback from Task 3 and later tasks still apply unchanged.

- [ ] **Step 8: Commit**

```bash
cd /Users/kiabai/Documents/PDev2026
git add prototypes/capture/src-tauri/src prototypes/capture/src-tauri/examples
git commit -m "Read trackpad contacts through MultitouchSupport

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cursor fallback

For Macs where the framework fails and for mouse users (the pitch says "a trackpad or a mouse"). The spec's fallback also lists scroll events; those need an event tap and the Input Monitoring permission, so this fallback reads the cursor only. Tell Kia about this gap when reporting the task.

**Files:**
- Create: `prototypes/capture/src-tauri/src/cursor.rs`
- Modify: `prototypes/capture/src-tauri/src/lib.rs` (add `mod cursor;`)

**Interfaces:**
- Consumes: `record::Contact`.
- Produces: `cursor::CursorStroker::new()`, `CursorStroker::step(&mut self, now_ms: u64, x: f64, y: f64) -> Option<Vec<Contact>>` (x, y top-left 0–1), `cursor::start() -> Result<Receiver<Vec<Contact>>, String>`. Frames use framework state codes 3 and 4 and y flipped to bottom-left, so the sampler treats them like trackpad frames.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/cursor.rs`:

```rust
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
        todo!()
    }
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
```

Add `mod cursor;` to `lib.rs`.

- [ ] **Step 2: Run to see the failures**

Run: `cargo test --lib cursor`
Expected: the three tests that reach `todo!()` panic with `not yet implemented`.

- [ ] **Step 3: Implement `step`**

```rust
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
```

- [ ] **Step 4: Add the cursor source**

Append to `cursor.rs` above the tests:

```rust
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
```

`crate::capture::now_ms` arrives in Task 6. To compile now, add this temporary file `src-tauri/src/capture.rs`, which Task 6 replaces:

```rust
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
```

and `mod capture;` in `lib.rs`.

- [ ] **Step 5: Run the tests**

Run: `cargo test --lib`
Expected: all tests pass (7 so far).

- [ ] **Step 6: Commit**

```bash
git add prototypes/capture/src-tauri/src
git commit -m "Add cursor fallback for Capture

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Sampler

**Files:**
- Create: `prototypes/capture/src-tauri/src/sampler.rs`
- Modify: `prototypes/capture/src-tauri/src/lib.rs` (add `mod sampler;`)

**Interfaces:**
- Consumes: `record::{Contact, TouchRecord, TouchState, map_state, Phase}`.
- Produces: `sampler::Sampler::new(min_move_ms: u64)`, `Sampler::process(&mut self, now_ms: u64, contacts: &[Contact]) -> Vec<TouchRecord>`.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/sampler.rs`:

```rust
//! Turns raw contact frames into records: flips y to a top-left origin,
//! clamps and rounds positions, writes down/up always and moves at most
//! once per `min_move_ms`, and lifts fingers that vanish without an up.

use crate::record::{map_state, Contact, Phase, TouchRecord, TouchState};
use std::collections::{HashMap, HashSet};

struct Track {
    last_written_t: u64,
    last_seen_t: u64,
    x: f64,
    y: f64,
}

pub struct Sampler {
    min_move_ms: u64,
    active: HashMap<i32, Track>,
}

impl Sampler {
    pub fn new(min_move_ms: u64) -> Self {
        Self { min_move_ms, active: HashMap::new() }
    }

    pub fn process(&mut self, now_ms: u64, contacts: &[Contact]) -> Vec<TouchRecord> {
        todo!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(id: i32, state: i32, x: f32, y: f32) -> Contact {
        Contact { id, state, x, y }
    }

    fn rec(t: u64, id: i32, x: f64, y: f64, state: TouchState) -> TouchRecord {
        TouchRecord { t, id, x, y, state }
    }

    #[test]
    fn first_touch_is_a_down_with_y_flipped() {
        let mut s = Sampler::new(33);
        let out = s.process(1000, &[c(1, 3, 0.25, 0.25)]);
        assert_eq!(out, vec![rec(1000, 1, 0.25, 0.75, TouchState::Down)]);
    }

    #[test]
    fn moves_are_throttled_to_the_interval() {
        let mut s = Sampler::new(33);
        s.process(1000, &[c(1, 3, 0.1, 0.5)]);
        assert!(s.process(1010, &[c(1, 4, 0.2, 0.5)]).is_empty());
        assert!(s.process(1032, &[c(1, 4, 0.3, 0.5)]).is_empty());
        assert_eq!(s.process(1033, &[c(1, 4, 0.4, 0.5)]), vec![rec(1033, 1, 0.4, 0.5, TouchState::Move)]);
    }

    #[test]
    fn break_touch_writes_an_up_at_the_last_known_position() {
        let mut s = Sampler::new(33);
        s.process(1000, &[c(1, 3, 0.1, 0.5)]);
        s.process(1010, &[c(1, 4, 0.2, 0.5)]);
        assert_eq!(s.process(1020, &[c(1, 5, 0.9, 0.9)]), vec![rec(1020, 1, 0.2, 0.5, TouchState::Up)]);
    }

    #[test]
    fn touching_without_a_down_starts_with_a_down() {
        let mut s = Sampler::new(33);
        assert_eq!(s.process(1000, &[c(4, 4, 0.5, 0.5)]), vec![rec(1000, 4, 0.5, 0.5, TouchState::Down)]);
    }

    #[test]
    fn hover_states_are_ignored() {
        let mut s = Sampler::new(33);
        assert!(s.process(1000, &[c(1, 1, 0.5, 0.5), c(2, 2, 0.5, 0.5)]).is_empty());
    }

    #[test]
    fn an_up_for_an_unknown_finger_writes_nothing() {
        let mut s = Sampler::new(33);
        assert!(s.process(1000, &[c(9, 5, 0.5, 0.5)]).is_empty());
    }

    #[test]
    fn a_finger_missing_from_a_frame_is_lifted_at_its_last_seen_time() {
        let mut s = Sampler::new(33);
        s.process(1000, &[c(1, 3, 0.1, 0.5), c(2, 3, 0.6, 0.5)]);
        s.process(1020, &[c(1, 4, 0.2, 0.5), c(2, 4, 0.7, 0.5)]);
        let out = s.process(9000, &[c(2, 4, 0.8, 0.5)]);
        assert!(out.contains(&rec(1020, 1, 0.2, 0.5, TouchState::Up)));
    }

    #[test]
    fn an_empty_frame_lifts_every_finger() {
        let mut s = Sampler::new(33);
        s.process(1000, &[c(0, 3, 0.5, 0.5)]);
        assert_eq!(s.process(1300, &[]), vec![rec(1000, 0, 0.5, 0.5, TouchState::Up)]);
    }

    #[test]
    fn positions_are_clamped_and_rounded() {
        let mut s = Sampler::new(33);
        let out = s.process(1000, &[c(1, 3, 1.02, 0.12345)]);
        assert_eq!((out[0].x, out[0].y), (1.0, 0.877));
    }
}
```

Add `mod sampler;` to `lib.rs`.

- [ ] **Step 2: Run to see the failures**

Run: `cargo test --lib sampler`
Expected: 9 tests panic with `not yet implemented`.

- [ ] **Step 3: Implement**

```rust
fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

/// Framework position (origin bottom-left) → record position (origin top-left).
fn to_record_xy(c: &Contact) -> (f64, f64) {
    let x = (c.x as f64).clamp(0.0, 1.0);
    let y = (1.0 - c.y as f64).clamp(0.0, 1.0);
    (round3(x), round3(y))
}

impl Sampler {
    pub fn process(&mut self, now_ms: u64, contacts: &[Contact]) -> Vec<TouchRecord> {
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        for c in contacts {
            let Some(phase) = map_state(c.state) else { continue };
            let (x, y) = to_record_xy(c);
            match phase {
                Phase::Down | Phase::Move => {
                    seen.insert(c.id);
                    match self.active.get_mut(&c.id) {
                        None => {
                            self.active.insert(
                                c.id,
                                Track { last_written_t: now_ms, last_seen_t: now_ms, x, y },
                            );
                            out.push(TouchRecord { t: now_ms, id: c.id, x, y, state: TouchState::Down });
                        }
                        Some(track) => {
                            track.last_seen_t = now_ms;
                            track.x = x;
                            track.y = y;
                            if now_ms.saturating_sub(track.last_written_t) >= self.min_move_ms {
                                track.last_written_t = now_ms;
                                out.push(TouchRecord { t: now_ms, id: c.id, x, y, state: TouchState::Move });
                            }
                        }
                    }
                }
                Phase::Up => {
                    if let Some(track) = self.active.remove(&c.id) {
                        out.push(TouchRecord {
                            t: now_ms,
                            id: c.id,
                            x: track.x,
                            y: track.y,
                            state: TouchState::Up,
                        });
                    }
                }
            }
        }
        let gone: Vec<i32> = self.active.keys().filter(|id| !seen.contains(id)).copied().collect();
        for id in gone {
            if let Some(track) = self.active.remove(&id) {
                out.push(TouchRecord {
                    t: track.last_seen_t,
                    id,
                    x: track.x,
                    y: track.y,
                    state: TouchState::Up,
                });
            }
        }
        out
    }
}
```

Delete the `todo!()` version of `process` left from Step 1.

- [ ] **Step 4: Run the tests**

Run: `cargo test --lib`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add prototypes/capture/src-tauri/src
git commit -m "Add touch sampler

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Daily store and today's heat

**Files:**
- Create: `prototypes/capture/src-tauri/src/store.rs`
- Modify: `prototypes/capture/src-tauri/src/lib.rs` (add `mod store;`), `prototypes/capture/src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: `record::{TouchRecord, TouchState}`.
- Produces: `store::data_dir() -> PathBuf`, `store::file_name_for(NaiveDate) -> String`, `store::DailyWriter::new(PathBuf)`, `DailyWriter::write(&mut self, NaiveDate, &[TouchRecord]) -> std::io::Result<()>`, `store::heat_from_lines(&str, usize, usize) -> Vec<u32>`, `store::today_heat(&Path, usize, usize) -> Vec<u32>`. Heat is row-major, `cols × rows`, counting `down` and `move` records.

- [ ] **Step 1: Add dependencies**

```bash
cd prototypes/capture/src-tauri
cargo add chrono@0.4
cargo add --dev tempfile@3
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/store.rs`:

```rust
//! One append-only .jsonl file per local day in prototypes/data/.

use crate::record::{TouchRecord, TouchState};
use chrono::{Local, NaiveDate};
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

/// prototypes/data, resolved from the source tree (fine for a prototype).
pub fn data_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../data"))
}

pub fn file_name_for(date: NaiveDate) -> String {
    todo!()
}

pub struct DailyWriter {
    dir: PathBuf,
    open: Option<(NaiveDate, BufWriter<File>)>,
}

impl DailyWriter {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, open: None }
    }

    pub fn write(&mut self, date: NaiveDate, records: &[TouchRecord]) -> std::io::Result<()> {
        todo!()
    }
}

pub fn heat_from_lines(text: &str, cols: usize, rows: usize) -> Vec<u32> {
    todo!()
}

pub fn today_heat(dir: &Path, cols: usize, rows: usize) -> Vec<u32> {
    let path = dir.join(file_name_for(Local::now().date_naive()));
    let text = std::fs::read_to_string(path).unwrap_or_default();
    heat_from_lines(&text, cols, rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn day(d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, d).unwrap()
    }

    fn rec(t: u64) -> TouchRecord {
        TouchRecord { t, id: 1, x: 0.5, y: 0.5, state: TouchState::Move }
    }

    #[test]
    fn file_name_uses_the_date() {
        assert_eq!(file_name_for(day(11)), "touches-2026-10-11.jsonl");
    }

    #[test]
    fn writer_rolls_over_to_a_new_file_at_midnight() {
        let dir = tempdir().unwrap();
        let mut w = DailyWriter::new(dir.path().to_path_buf());
        w.write(day(11), &[rec(1), rec(2)]).unwrap();
        w.write(day(12), &[rec(3)]).unwrap();
        let a = fs::read_to_string(dir.path().join("touches-2026-10-11.jsonl")).unwrap();
        let b = fs::read_to_string(dir.path().join("touches-2026-10-12.jsonl")).unwrap();
        assert_eq!(a.lines().count(), 2);
        assert_eq!(b.lines().count(), 1);
        assert!(b.starts_with(r#"{"t":3,"#));
    }

    #[test]
    fn writer_appends_to_an_existing_file() {
        let dir = tempdir().unwrap();
        DailyWriter::new(dir.path().to_path_buf()).write(day(11), &[rec(1)]).unwrap();
        DailyWriter::new(dir.path().to_path_buf()).write(day(11), &[rec(2)]).unwrap();
        let a = fs::read_to_string(dir.path().join("touches-2026-10-11.jsonl")).unwrap();
        assert_eq!(a.lines().count(), 2);
    }

    #[test]
    fn heat_counts_downs_and_moves_and_skips_ups_and_broken_lines() {
        let text = concat!(
            r#"{"t":1,"id":1,"x":0.0,"y":0.0,"state":"down"}"#, "\n",
            r#"{"t":2,"id":1,"x":1.0,"y":1.0,"state":"move"}"#, "\n",
            r#"{"t":3,"id":1,"x":1.0,"y":1.0,"state":"up"}"#, "\n",
            r#"{"t":4,"id":1,"x":0.5,"#, "\n",
        );
        assert_eq!(heat_from_lines(text, 2, 2), vec![1, 0, 0, 1]);
    }
}
```

Add `mod store;` to `lib.rs`.

- [ ] **Step 3: Run to see the failures**

Run: `cargo test --lib store`
Expected: 4 tests panic with `not yet implemented`.

- [ ] **Step 4: Implement**

```rust
pub fn file_name_for(date: NaiveDate) -> String {
    format!("touches-{}.jsonl", date.format("%Y-%m-%d"))
}

impl DailyWriter {
    pub fn write(&mut self, date: NaiveDate, records: &[TouchRecord]) -> std::io::Result<()> {
        if self.open.as_ref().map(|(d, _)| *d) != Some(date) {
            std::fs::create_dir_all(&self.dir)?;
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(self.dir.join(file_name_for(date)))?;
            self.open = Some((date, BufWriter::new(file)));
        }
        let (_, w) = self.open.as_mut().expect("opened above");
        for r in records {
            serde_json::to_writer(&mut *w, r)?;
            w.write_all(b"\n")?;
        }
        w.flush()
    }
}

pub fn heat_from_lines(text: &str, cols: usize, rows: usize) -> Vec<u32> {
    let mut heat = vec![0u32; cols * rows];
    if cols == 0 || rows == 0 {
        return heat;
    }
    for line in text.lines() {
        let Ok(r) = serde_json::from_str::<TouchRecord>(line) else { continue };
        if r.state == TouchState::Up {
            continue;
        }
        let c = ((r.x * cols as f64) as usize).min(cols - 1);
        let row = ((r.y * rows as f64) as usize).min(rows - 1);
        heat[row * cols + c] += 1;
    }
    heat
}
```

Delete the `todo!()` versions from Step 2.

- [ ] **Step 5: Run the tests**

Run: `cargo test --lib`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add prototypes/capture/src-tauri
git commit -m "Add daily touch store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wire Capture together

**Files:**
- Replace: `prototypes/capture/src-tauri/src/capture.rs`, `prototypes/capture/src-tauri/src/lib.rs`
- Replace: `prototypes/capture/index.html`, `prototypes/capture/src/main.ts`, `prototypes/capture/src/styles.css`

**Interfaces:**
- Consumes: `multitouch::start`, `cursor::start`, `Sampler`, `DailyWriter`, `store::{data_dir, today_heat}`.
- Produces: Tauri event `touches` with payload `TouchRecord[]`; commands `today_heat({cols, rows}) -> number[]` and `capture_source() -> "trackpad" | "cursor" | "none"`.

- [ ] **Step 1: Replace `capture.rs`**

```rust
//! Glue: a capture source feeds the sampler; records go to today's file and
//! to the window.

use crate::record::TouchRecord;
use crate::sampler::Sampler;
use crate::store::{self, DailyWriter};
use crate::{cursor, multitouch};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Starts capture on a background thread and returns which source is in use.
pub fn start<F>(on_records: F) -> Result<&'static str, String>
where
    F: Fn(&[TouchRecord]) + Send + 'static,
{
    let (rx, source) = match multitouch::start() {
        Ok(rx) => (rx, "trackpad"),
        Err(e) => {
            eprintln!("multitouch unavailable ({e}); falling back to the cursor");
            (cursor::start()?, "cursor")
        }
    };
    std::thread::spawn(move || {
        let mut sampler = Sampler::new(33);
        let mut writer = DailyWriter::new(store::data_dir());
        for frame in rx {
            let records = sampler.process(now_ms(), &frame);
            if records.is_empty() {
                continue;
            }
            if let Err(e) = writer.write(chrono::Local::now().date_naive(), &records) {
                eprintln!("could not write touches: {e}");
            }
            on_records(&records);
        }
    });
    Ok(source)
}
```

- [ ] **Step 2: Replace `lib.rs`**

```rust
mod capture;
mod cursor;
pub mod multitouch;
pub mod record;
mod sampler;
mod store;

use tauri::{Emitter, Manager};

struct CaptureSource(&'static str);

/// async so reading a large day file stays off the main thread.
#[tauri::command]
async fn today_heat(cols: usize, rows: usize) -> Vec<u32> {
    store::today_heat(&store::data_dir(), cols, rows)
}

#[tauri::command]
fn capture_source(source: tauri::State<'_, CaptureSource>) -> String {
    source.0.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![today_heat, capture_source])
        .setup(|app| {
            let handle = app.handle().clone();
            let source = capture::start(move |records| {
                let _ = handle.emit("touches", records);
            })
            .unwrap_or_else(|e| {
                eprintln!("capture failed to start: {e}");
                "none"
            });
            app.manage(CaptureSource(source));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

If the template's `Cargo.toml` has no `tauri-plugin-opener` dependency, drop the `.plugin(...)` line.

- [ ] **Step 3: Replace the window page**

`prototypes/capture/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Trackpad</title>
    <link rel="stylesheet" href="/src/styles.css" />
    <script type="module" src="/src/main.ts" defer></script>
  </head>
  <body>
    <canvas id="pad"></canvas>
    <div id="hud"><span id="count">0</span> points today · <span id="source">…</span></div>
  </body>
</html>
```

`prototypes/capture/src/styles.css`:

```css
html,
body {
  margin: 0;
  height: 100%;
  overflow: hidden;
  background: #111;
}

#pad {
  display: block;
  width: 100vw;
  height: 100vh;
}

#hud {
  position: fixed;
  left: 8px;
  bottom: 6px;
  font: 11px/1 -apple-system, BlinkMacSystemFont, sans-serif;
  color: #888;
  pointer-events: none;
}
```

`prototypes/capture/src/main.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type TouchRecord = { t: number; id: number; x: number; y: number; state: "down" | "move" | "up" };

const COLS = 64;
const ROWS = 40;

const canvas = document.querySelector<HTMLCanvasElement>("#pad")!;
const countEl = document.querySelector<HTMLElement>("#count")!;
const sourceEl = document.querySelector<HTMLElement>("#source")!;
const ctx = canvas.getContext("2d")!;

const heat = new Uint32Array(COLS * ROWS);
const fingers = new Map<number, { x: number; y: number }>();
let total = 0;
let maxHeat = 1;

function fit() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}

function addHeat(x: number, y: number) {
  const c = Math.min(COLS - 1, Math.floor(x * COLS));
  const r = Math.min(ROWS - 1, Math.floor(y * ROWS));
  const i = r * COLS + c;
  heat[i] += 1;
  if (heat[i] > maxHeat) maxHeat = heat[i];
  total += 1;
}

function draw() {
  const w = canvas.width;
  const h = canvas.height;
  const dpr = window.devicePixelRatio || 1;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, w, h);
  const cw = w / COLS;
  const ch = h / ROWS;
  for (let i = 0; i < heat.length; i++) {
    if (!heat[i]) continue;
    // sqrt so light use still shows next to the busiest cell
    const a = Math.sqrt(heat[i] / maxHeat);
    ctx.fillStyle = `rgba(255, 170, 80, ${a.toFixed(3)})`;
    ctx.fillRect((i % COLS) * cw, Math.floor(i / COLS) * ch, Math.ceil(cw), Math.ceil(ch));
  }
  ctx.fillStyle = "#fff";
  for (const f of fingers.values()) {
    ctx.beginPath();
    ctx.arc(f.x * w, f.y * h, 5 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
  countEl.textContent = total.toLocaleString();
  requestAnimationFrame(draw);
}

async function main() {
  fit();
  window.addEventListener("resize", fit);
  sourceEl.textContent = await invoke<string>("capture_source");
  const saved = await invoke<number[]>("today_heat", { cols: COLS, rows: ROWS });
  saved.forEach((v, i) => {
    heat[i] = v;
    total += v;
    if (v > maxHeat) maxHeat = v;
  });
  await listen<TouchRecord[]>("touches", (event) => {
    for (const r of event.payload) {
      if (r.state === "up") {
        fingers.delete(r.id);
      } else {
        fingers.set(r.id, { x: r.x, y: r.y });
        addHeat(r.x, r.y);
      }
    }
  });
  requestAnimationFrame(draw);
}

main();
```

- [ ] **Step 4: Type-check and test**

```bash
cd /Users/kiabai/Documents/PDev2026/prototypes/capture
pnpm build
cd src-tauri && cargo test --lib
```

Expected: build succeeds, all Rust tests pass.

- [ ] **Step 5: Run it with Kia**

Start in the background: `cd prototypes/capture && pnpm tauri dev`. Tell Kia: "The Trackpad window is open. Click into another app and use the trackpad normally for a minute: swipe, two-finger scroll."

Then check, in order:
1. Screenshot (`screencapture -x <scratchpad>/capture.png`, read it): the 320×200 window is on top, shows white dots while a finger is down, a growing orange heat map, and `trackpad` in the HUD (or `cursor` if Task 2's gate failed).
2. The file grows: `wc -l prototypes/data/touches-$(date +%F).jsonl` twice, a few seconds apart, while Kia is touching.
3. Values are sane:

```bash
python3 -I - "prototypes/data/touches-$(date +%F).jsonl" <<'EOF'
import json, sys
downs = ups = bad = 0
open_ids = set()
for line in open(sys.argv[1]):
    try:
        r = json.loads(line)
    except ValueError:
        bad += 1
        continue
    if not (0 <= r["x"] <= 1 and 0 <= r["y"] <= 1):
        bad += 1
    if r["state"] == "down":
        downs += 1
        open_ids.add(r["id"])
    elif r["state"] == "up":
        ups += 1
        open_ids.discard(r["id"])
print(f"downs={downs} ups={ups} still_down={len(open_ids)} bad={bad}")
EOF
```

Expected: `bad=0`, `downs` and `ups` within a couple of each other, `still_down` 0–2.
4. Restart the app: the heat map comes back from today's file.

- [ ] **Step 6: Commit**

```bash
cd /Users/kiabai/Documents/PDev2026
git add prototypes/capture
git commit -m "Wire Capture: record to daily file and show live heat

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Form study scaffold, data and grid

**Files:**
- Create: `prototypes/form-study/package.json`, `tsconfig.json`, `vite.config.ts`
- Create: `prototypes/form-study/src/data.ts`, `src/grid.ts`, `src/rng.ts`
- Test: `prototypes/form-study/test/data.test.ts`, `test/grid.test.ts`, `test/rng.test.ts`

**Interfaces:**
- Produces:
  - `data.ts`: `type TouchState = "down" | "move" | "up"`, `interface TouchRecord { t: number; id: number; x: number; y: number; state: TouchState }`, `interface Point { t: number; x: number; y: number }`, `interface Stroke { id: number; points: Point[] }`, `parseJsonl(text: string): TouchRecord[]`, `toStrokes(records: TouchRecord[]): Stroke[]`.
  - `grid.ts`: `cellOf(x, y, cols, rows): number` (row-major index), `segmentCells(ax, ay, bx, by, cols, rows): number[]`, `class StrokeCells { constructor(cols, rows); begin(): void; push(points: Point[]): number[] }`.
  - `rng.ts`: `mulberry32(seed: number): () => number` in [0, 1).

- [ ] **Step 1: Project files**

`prototypes/form-study/package.json`:

```json
{
  "name": "form-study",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "pixi.js": "8.22.0"
  },
  "devDependencies": {
    "typescript": "5.9.3",
    "vite": "8.3.4",
    "vitest": "5.0.3"
  }
}
```

`prototypes/form-study/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "test"]
}
```

`prototypes/form-study/vite.config.ts` (the data folder is the public folder, so `/sample.jsonl` is served as-is):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  publicDir: "../data",
  server: { port: 5174, strictPort: true },
  test: { environment: "node" },
});
```

```bash
cd /Users/kiabai/Documents/PDev2026/prototypes/form-study && pnpm install
```

- [ ] **Step 2: Write the failing tests**

`test/data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseJsonl, toStrokes, type TouchRecord, type TouchState } from "../src/data";

const rec = (t: number, id: number, state: TouchState, x = 0.5): TouchRecord => ({ t, id, x, y: 0.5, state });

describe("parseJsonl", () => {
  it("reads records, skips blank and truncated lines, sorts by time", () => {
    const text = [
      '{"t":20,"id":1,"x":0.5,"y":0.5,"state":"move"}',
      "",
      '{"t":10,"id":1,"x":0.1,"y":0.2,"state":"down"}',
      '{"t":30,"id":1,"x":0.6,"y":0.5,"st',
    ].join("\n");
    expect(parseJsonl(text)).toEqual([
      { t: 10, id: 1, x: 0.1, y: 0.2, state: "down" },
      { t: 20, id: 1, x: 0.5, y: 0.5, state: "move" },
    ]);
  });

  it("drops unknown states and clamps positions", () => {
    const text = '{"t":1,"id":1,"x":1.4,"y":-0.2,"state":"down"}\n{"t":2,"id":1,"x":0.5,"y":0.5,"state":"hover"}';
    expect(parseJsonl(text)).toEqual([{ t: 1, id: 1, x: 1, y: 0, state: "down" }]);
  });

  it("returns nothing for empty or non-touch text", () => {
    expect(parseJsonl("")).toEqual([]);
    expect(parseJsonl("hello\n{\"a\":1}")).toEqual([]);
  });
});

describe("toStrokes", () => {
  it("groups interleaved fingers into strokes ordered by start time", () => {
    const strokes = toStrokes([rec(1, 1, "down"), rec(2, 2, "down"), rec(3, 1, "move"), rec(4, 2, "up"), rec(5, 1, "up")]);
    expect(strokes.map((s) => [s.id, s.points.map((p) => p.t)])).toEqual([
      [1, [1, 3, 5]],
      [2, [2, 4]],
    ]);
  });

  it("starts a stroke on a move with no down and closes open strokes at the end", () => {
    const strokes = toStrokes([rec(1, 7, "move", 0.1), rec(2, 7, "move", 0.2)]);
    expect(strokes).toEqual([{ id: 7, points: [{ t: 1, x: 0.1, y: 0.5 }, { t: 2, x: 0.2, y: 0.5 }] }]);
  });

  it("starts a new stroke when the same finger id goes down again", () => {
    const strokes = toStrokes([rec(1, 1, "down"), rec(2, 1, "down"), rec(3, 1, "up")]);
    expect(strokes.map((s) => s.points.length)).toEqual([1, 2]);
  });

  it("ignores an up for a finger that is not down", () => {
    expect(toStrokes([rec(1, 1, "up")])).toEqual([]);
  });
});
```

`test/grid.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cellOf, segmentCells, StrokeCells } from "../src/grid";

describe("cellOf", () => {
  it("maps 0–1 to row-major cells and clamps the far edge", () => {
    expect(cellOf(0, 0, 4, 2)).toBe(0);
    expect(cellOf(0.5, 0.25, 4, 2)).toBe(2);
    expect(cellOf(1, 1, 4, 2)).toBe(7);
  });
});

describe("segmentCells", () => {
  it("lists each cell along a line once, in order", () => {
    expect(segmentCells(0.05, 0.1, 0.95, 0.1, 4, 2)).toEqual([0, 1, 2, 3]);
  });
});

describe("StrokeCells", () => {
  it("reports a cell once per stroke, even when the stroke comes back", () => {
    const sc = new StrokeCells(4, 2);
    sc.begin();
    expect(sc.push([{ t: 0, x: 0.05, y: 0.1 }, { t: 1, x: 0.6, y: 0.1 }])).toEqual([0, 1, 2]);
    expect(sc.push([{ t: 2, x: 0.05, y: 0.1 }])).toEqual([]);
    sc.begin();
    expect(sc.push([{ t: 3, x: 0.05, y: 0.1 }])).toEqual([0]);
  });

  it("joins points across push calls", () => {
    const sc = new StrokeCells(4, 2);
    sc.begin();
    sc.push([{ t: 0, x: 0.05, y: 0.1 }]);
    expect(sc.push([{ t: 1, x: 0.95, y: 0.1 }])).toEqual([1, 2, 3]);
  });
});
```

`test/rng.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/rng";

describe("mulberry32", () => {
  it("repeats for the same seed and stays in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 100 }, () => a());
    expect(Array.from({ length: 100 }, () => b())).toEqual(xs);
    expect(xs.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it("differs for different seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});
```

- [ ] **Step 3: Run to see the failures**

Run: `pnpm test`
Expected: FAIL, the three source modules cannot be resolved.

- [ ] **Step 4: Implement**

`src/data.ts`:

```ts
export type TouchState = "down" | "move" | "up";

export interface TouchRecord {
  t: number;
  id: number;
  x: number;
  y: number;
  state: TouchState;
}

export interface Point {
  t: number;
  x: number;
  y: number;
}

export interface Stroke {
  id: number;
  points: Point[];
}

const STATES = new Set<string>(["down", "move", "up"]);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function toRecord(value: unknown): TouchRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.t !== "number" || typeof r.id !== "number") return null;
  if (typeof r.x !== "number" || typeof r.y !== "number") return null;
  if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) return null;
  if (typeof r.state !== "string" || !STATES.has(r.state)) return null;
  return { t: r.t, id: r.id, x: clamp01(r.x), y: clamp01(r.y), state: r.state as TouchState };
}

/** One record per line; broken or foreign lines are skipped. Sorted by time. */
export function parseJsonl(text: string): TouchRecord[] {
  const out: TouchRecord[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let value: unknown;
    try {
      value = JSON.parse(s);
    } catch {
      continue;
    }
    const r = toRecord(value);
    if (r) out.push(r);
  }
  return out.sort((a, b) => a.t - b.t);
}

/** A stroke is one finger from down to up. Ordered by start time. */
export function toStrokes(records: TouchRecord[]): Stroke[] {
  const open = new Map<number, Stroke>();
  const done: Stroke[] = [];
  for (const r of records) {
    const p: Point = { t: r.t, x: r.x, y: r.y };
    const s = open.get(r.id);
    if (r.state === "down") {
      if (s) done.push(s);
      open.set(r.id, { id: r.id, points: [p] });
    } else if (r.state === "move") {
      if (s) s.points.push(p);
      else open.set(r.id, { id: r.id, points: [p] });
    } else if (s) {
      s.points.push(p);
      done.push(s);
      open.delete(r.id);
    }
  }
  done.push(...open.values());
  return done.sort((a, b) => a.points[0].t - b.points[0].t);
}
```

`src/grid.ts`:

```ts
import type { Point } from "./data";

export function cellOf(x: number, y: number, cols: number, rows: number): number {
  const c = Math.min(cols - 1, Math.max(0, Math.floor(x * cols)));
  const r = Math.min(rows - 1, Math.max(0, Math.floor(y * rows)));
  return r * cols + c;
}

/** Cells a segment passes through, in order, sampled every quarter cell. */
export function segmentCells(ax: number, ay: number, bx: number, by: number, cols: number, rows: number): number[] {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax) * cols, Math.abs(by - ay) * rows) * 4));
  const out: number[] = [];
  let last = -1;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const c = cellOf(ax + (bx - ax) * f, ay + (by - ay) * f, cols, rows);
    if (c !== last) {
      out.push(c);
      last = c;
    }
  }
  return out;
}

/** Tracks one stroke at a time and reports the cells it enters for the first time. */
export class StrokeCells {
  private visited = new Set<number>();
  private last: Point | null = null;

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {}

  begin(): void {
    this.visited.clear();
    this.last = null;
  }

  push(points: Point[]): number[] {
    const fresh: number[] = [];
    for (const p of points) {
      const cells = this.last
        ? segmentCells(this.last.x, this.last.y, p.x, p.y, this.cols, this.rows)
        : [cellOf(p.x, p.y, this.cols, this.rows)];
      for (const c of cells) {
        if (!this.visited.has(c)) {
          this.visited.add(c);
          fresh.push(c);
        }
      }
      this.last = p;
    }
    return fresh;
  }
}
```

`src/rng.ts`:

```ts
/** Small seeded PRNG so the same file always grows the same world. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 5: Run the tests and the type check**

Run: `pnpm test && pnpm typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/kiabai/Documents/PDev2026
git add prototypes/form-study
git commit -m "Form study: parse touch files into strokes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: City simulation

**Files:**
- Create: `prototypes/form-study/src/sims/types.ts`, `src/sims/city.ts`, `src/config.ts`
- Test: `prototypes/form-study/test/city.test.ts`

**Interfaces:**
- Consumes: `Point` (data.ts), `StrokeCells` (grid.ts), `mulberry32` (rng.ts).
- Produces:
  - `sims/types.ts`: `interface Sim { beginStroke(t: number): void; addPoints(points: Point[]): void; endStroke(): void; advanceTo(t: number): void }`. Points passed to successive `addPoints` calls within one stroke are joined.
  - `sims/city.ts`: `interface CityConfig { cols; rows; roadThreshold; wideRoadAt; buildChance; tierThresholds: [number, number, number]; seed }`, `class CitySim implements Sim { readonly cfg; readonly traffic: Uint32Array; readonly road: Uint8Array; readonly building: Uint8Array /* 0 none, 1–3 tier */; version: number }`, `tierFor(traffic, thresholds): 0|1|2|3`, `neighbors4(i, cols, rows): number[]` (N, E, S, W order), `roadMask(road, cols, rows, i): number` (N=1, E=2, S=4, W=8).
  - `config.ts`: `CITY: CityConfig` (FARM and MONSTER are added in Tasks 9 and 10).

- [ ] **Step 1: Write the failing tests**

`test/city.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Point } from "../src/data";
import { CitySim, roadMask, tierFor, type CityConfig } from "../src/sims/city";

const cfg: CityConfig = {
  cols: 4,
  rows: 2,
  roadThreshold: 2,
  wideRoadAt: 99,
  buildChance: 1,
  tierThresholds: [2, 3, 4],
  seed: 1,
};

// Left to right along row 0.
const across: Point[] = [
  { t: 0, x: 0.05, y: 0.25 },
  { t: 1, x: 0.95, y: 0.25 },
];

function stroke(sim: CitySim, points: Point[]) {
  sim.beginStroke(points[0].t);
  sim.addPoints(points);
  sim.endStroke();
}

describe("CitySim", () => {
  it("adds one traffic per stroke and paves a road at the threshold", () => {
    const sim = new CitySim(cfg);
    stroke(sim, across);
    expect([...sim.traffic]).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    expect([...sim.road]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    stroke(sim, across);
    expect([...sim.road]).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it("counts a cell once when one stroke crosses it twice", () => {
    const sim = new CitySim(cfg);
    stroke(sim, [...across, { t: 2, x: 0.05, y: 0.25 }]);
    expect([...sim.traffic]).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it("builds next to roads and never on them", () => {
    const sim = new CitySim(cfg);
    stroke(sim, across);
    stroke(sim, across);
    expect([...sim.building]).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it("upgrades buildings as the road gets busier", () => {
    const sim = new CitySim(cfg);
    for (let i = 0; i < 4; i++) stroke(sim, across);
    expect([...sim.building.slice(4)]).toEqual([3, 3, 3, 3]);
  });

  it("grows the same city from the same strokes and seed", () => {
    const loose = { ...cfg, buildChance: 0.3, seed: 5 };
    const a = new CitySim(loose);
    const b = new CitySim(loose);
    for (let i = 0; i < 6; i++) {
      stroke(a, across);
      stroke(b, across);
    }
    expect([...a.building]).toEqual([...b.building]);
  });

  it("bumps version only when something changes", () => {
    const sim = new CitySim(cfg);
    const v = sim.version;
    sim.advanceTo(1000);
    expect(sim.version).toBe(v);
    stroke(sim, across);
    expect(sim.version).toBeGreaterThan(v);
  });
});

describe("tierFor", () => {
  it("steps through the thresholds", () => {
    expect([1, 2, 3, 4, 9].map((t) => tierFor(t, [2, 3, 4]))).toEqual([0, 1, 2, 3, 3]);
  });
});

describe("roadMask", () => {
  it("encodes road neighbours as N=1 E=2 S=4 W=8", () => {
    // 3×3 plus sign
    const road = Uint8Array.from([0, 1, 0, 1, 1, 1, 0, 1, 0]);
    expect(roadMask(road, 3, 3, 4)).toBe(15);
    expect(roadMask(road, 3, 3, 1)).toBe(4);
    expect(roadMask(Uint8Array.from([1, 0, 0, 0]), 2, 2, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to see the failure**

Run: `pnpm test city`
Expected: FAIL, `../src/sims/city` cannot be resolved.

- [ ] **Step 3: Implement**

`src/sims/types.ts`:

```ts
import type { Point } from "../data";

/** A form that grows from strokes. Pure state; views read it. */
export interface Sim {
  beginStroke(t: number): void;
  /** Points of the current stroke; successive calls are joined. */
  addPoints(points: Point[]): void;
  endStroke(): void;
  /** Time passes without input. */
  advanceTo(t: number): void;
}
```

`src/sims/city.ts`:

```ts
import type { Point } from "../data";
import { StrokeCells } from "../grid";
import { mulberry32 } from "../rng";
import type { Sim } from "./types";

export interface CityConfig {
  cols: number;
  rows: number;
  /** Strokes through a cell before it becomes road. */
  roadThreshold: number;
  /** Traffic at which a road is drawn wide. */
  wideRoadAt: number;
  /** Build chance per crossing = min(1, buildChance × road traffic). */
  buildChance: number;
  /** Road traffic for building tiers 1, 2, 3. */
  tierThresholds: [number, number, number];
  seed: number;
}

export function tierFor(traffic: number, [a, b, c]: [number, number, number]): 0 | 1 | 2 | 3 {
  if (traffic >= c) return 3;
  if (traffic >= b) return 2;
  if (traffic >= a) return 1;
  return 0;
}

export function neighbors4(i: number, cols: number, rows: number): number[] {
  const c = i % cols;
  const r = Math.floor(i / cols);
  const out: number[] = [];
  if (r > 0) out.push(i - cols);
  if (c < cols - 1) out.push(i + 1);
  if (r < rows - 1) out.push(i + cols);
  if (c > 0) out.push(i - 1);
  return out;
}

export function roadMask(road: Uint8Array, cols: number, rows: number, i: number): number {
  const c = i % cols;
  const r = Math.floor(i / cols);
  let m = 0;
  if (r > 0 && road[i - cols]) m |= 1;
  if (c < cols - 1 && road[i + 1]) m |= 2;
  if (r < rows - 1 && road[i + cols]) m |= 4;
  if (c > 0 && road[i - 1]) m |= 8;
  return m;
}

export class CitySim implements Sim {
  readonly traffic: Uint32Array;
  readonly road: Uint8Array;
  readonly building: Uint8Array;
  version = 0;
  private cells: StrokeCells;
  private rand: () => number;

  constructor(readonly cfg: CityConfig) {
    const n = cfg.cols * cfg.rows;
    this.traffic = new Uint32Array(n);
    this.road = new Uint8Array(n);
    this.building = new Uint8Array(n);
    this.cells = new StrokeCells(cfg.cols, cfg.rows);
    this.rand = mulberry32(cfg.seed);
  }

  beginStroke(_t: number): void {
    this.cells.begin();
  }

  addPoints(points: Point[]): void {
    for (const i of this.cells.push(points)) {
      this.traffic[i] += 1;
      if (!this.road[i] && this.traffic[i] >= this.cfg.roadThreshold) {
        this.road[i] = 1;
        this.building[i] = 0;
      }
      if (this.road[i]) this.growAround(i);
      this.version++;
    }
  }

  endStroke(): void {}

  advanceTo(_t: number): void {}

  private growAround(i: number): void {
    const tier = tierFor(this.traffic[i], this.cfg.tierThresholds);
    const chance = Math.min(1, this.cfg.buildChance * this.traffic[i]);
    for (const n of neighbors4(i, this.cfg.cols, this.cfg.rows)) {
      if (this.road[n]) continue;
      if (tier > this.building[n] && this.rand() < chance) this.building[n] = tier;
    }
  }
}
```

`src/config.ts`:

```ts
import type { CityConfig } from "./sims/city";

export const CITY: CityConfig = {
  cols: 32,
  rows: 20,
  roadThreshold: 3,
  wideRoadAt: 12,
  buildChance: 0.05,
  tierThresholds: [3, 10, 25],
  seed: 42,
};
```

- [ ] **Step 4: Run the tests and the type check**

Run: `pnpm test && pnpm typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add prototypes/form-study
git commit -m "Form study: city simulation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Farm simulation

**Files:**
- Create: `prototypes/form-study/src/sims/farm.ts`
- Modify: `prototypes/form-study/src/config.ts`
- Test: `prototypes/form-study/test/farm.test.ts`

**Interfaces:**
- Consumes: `Sim`, `StrokeCells`, `Point`.
- Produces: `interface FarmConfig { cols; rows; waterPerStage }`, `const RIPE = 3`, `class FarmSim implements Sim { readonly cfg; readonly water: Uint16Array; readonly stage: Uint8Array /* 0 seed … 3 ripe */; harvested: number; version: number }`; `config.ts` gains `FARM: FarmConfig`.

Rule: a stroke waters each plot it crosses once. Every `waterPerStage` waterings the crop grows a stage. Reaching `RIPE` counts as a harvest at once (no button). The next watering of a ripe plot replants it (stage 0, water 0).

- [ ] **Step 1: Write the failing tests**

`test/farm.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Point } from "../src/data";
import { FarmSim, RIPE, type FarmConfig } from "../src/sims/farm";

const cfg: FarmConfig = { cols: 4, rows: 2, waterPerStage: 2 };
const across: Point[] = [
  { t: 0, x: 0.05, y: 0.25 },
  { t: 1, x: 0.95, y: 0.25 },
];

function strokes(sim: FarmSim, n: number, points = across) {
  for (let i = 0; i < n; i++) {
    sim.beginStroke(points[0].t);
    sim.addPoints(points);
    sim.endStroke();
  }
}

describe("FarmSim", () => {
  it("grows a stage every waterPerStage strokes", () => {
    const sim = new FarmSim(cfg);
    strokes(sim, 1);
    expect([...sim.stage.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...sim.water.slice(0, 4)]).toEqual([1, 1, 1, 1]);
    strokes(sim, 1);
    expect([...sim.stage.slice(0, 4)]).toEqual([1, 1, 1, 1]);
  });

  it("harvests by itself on ripening and replants on the next watering", () => {
    const sim = new FarmSim(cfg);
    strokes(sim, 6);
    expect([...sim.stage.slice(0, 4)]).toEqual([RIPE, RIPE, RIPE, RIPE]);
    expect(sim.harvested).toBe(4);
    strokes(sim, 1);
    expect([...sim.stage.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...sim.water.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect(sim.harvested).toBe(4);
  });

  it("waters a plot once per stroke", () => {
    const sim = new FarmSim(cfg);
    strokes(sim, 1, [...across, { t: 2, x: 0.05, y: 0.25 }]);
    expect([...sim.water.slice(0, 4)]).toEqual([1, 1, 1, 1]);
  });

  it("leaves untouched plots alone", () => {
    const sim = new FarmSim(cfg);
    strokes(sim, 6);
    expect([...sim.stage.slice(4)]).toEqual([0, 0, 0, 0]);
    expect([...sim.water.slice(4)]).toEqual([0, 0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run to see the failure**

Run: `pnpm test farm`
Expected: FAIL, `../src/sims/farm` cannot be resolved.

- [ ] **Step 3: Implement**

`src/sims/farm.ts`:

```ts
import type { Point } from "../data";
import { StrokeCells } from "../grid";
import type { Sim } from "./types";

export interface FarmConfig {
  cols: number;
  rows: number;
  /** Waterings per growth stage. */
  waterPerStage: number;
}

/** Stages: 0 seed, 1 sprout, 2 growing, 3 ripe. */
export const RIPE = 3;

export class FarmSim implements Sim {
  readonly water: Uint16Array;
  readonly stage: Uint8Array;
  harvested = 0;
  version = 0;
  private cells: StrokeCells;

  constructor(readonly cfg: FarmConfig) {
    const n = cfg.cols * cfg.rows;
    this.water = new Uint16Array(n);
    this.stage = new Uint8Array(n);
    this.cells = new StrokeCells(cfg.cols, cfg.rows);
  }

  beginStroke(_t: number): void {
    this.cells.begin();
  }

  addPoints(points: Point[]): void {
    for (const i of this.cells.push(points)) this.waterPlot(i);
  }

  endStroke(): void {}

  advanceTo(_t: number): void {}

  private waterPlot(i: number): void {
    this.version++;
    if (this.stage[i] === RIPE) {
      this.stage[i] = 0;
      this.water[i] = 0;
      return;
    }
    this.water[i] += 1;
    if (this.water[i] >= this.cfg.waterPerStage) {
      this.water[i] = 0;
      this.stage[i] += 1;
      if (this.stage[i] === RIPE) this.harvested += 1;
    }
  }
}
```

Append to `src/config.ts`:

```ts
import type { FarmConfig } from "./sims/farm";

export const FARM: FarmConfig = { cols: 16, rows: 10, waterPerStage: 3 };
```

(Move the import to the top of the file with the other import.)

- [ ] **Step 4: Run the tests and the type check**

Run: `pnpm test && pnpm typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add prototypes/form-study
git commit -m "Form study: farm simulation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Monster simulation

**Files:**
- Create: `prototypes/form-study/src/sims/monster.ts`
- Modify: `prototypes/form-study/src/config.ts`
- Test: `prototypes/form-study/test/monster.test.ts`

**Interfaces:**
- Consumes: `Sim`, `StrokeCells`, `mulberry32`, `Point`.
- Produces: `interface MonsterConfig { cols; rows; spawnIntervalMs; cap; kinds; seed }`, `interface Poof { cell: number; t: number }`, `class MonsterSim implements Sim { readonly cfg; readonly monster: Uint8Array /* 0 none, 1..kinds */; loot: number; alive: number; version: number; readonly poofs: Poof[] }`; `config.ts` gains `MONSTER: MonsterConfig` and `MONSTER_LIVE_SPAWN_MS`.

Rule: the first `advanceTo(t)` starts the clock; then one monster spawns every `spawnIntervalMs` in a random empty cell, up to `cap` alive. A stroke crossing a monster's cell defeats it: the cell clears, `loot` goes up, a `Poof` is recorded. Time never runs backwards.

- [ ] **Step 1: Write the failing tests**

`test/monster.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MonsterSim, type MonsterConfig } from "../src/sims/monster";

const cfg: MonsterConfig = { cols: 4, rows: 2, spawnIntervalMs: 1000, cap: 3, kinds: 2, seed: 3 };

const occupied = (sim: MonsterSim) => [...sim.monster].map((k, i) => (k ? i : -1)).filter((i) => i >= 0);

describe("MonsterSim", () => {
  it("spawns one monster per interval after the clock starts", () => {
    const sim = new MonsterSim(cfg);
    sim.advanceTo(0);
    sim.advanceTo(999);
    expect(sim.alive).toBe(0);
    sim.advanceTo(1000);
    expect(sim.alive).toBe(1);
    const [cell] = occupied(sim);
    expect(sim.monster[cell]).toBeGreaterThanOrEqual(1);
    expect(sim.monster[cell]).toBeLessThanOrEqual(2);
  });

  it("stops at the cap, even after a huge gap", () => {
    const sim = new MonsterSim(cfg);
    sim.advanceTo(0);
    sim.advanceTo(1e12);
    expect(sim.alive).toBe(3);
    expect(occupied(sim)).toHaveLength(3);
  });

  it("ignores time going backwards", () => {
    const sim = new MonsterSim(cfg);
    sim.advanceTo(0);
    sim.advanceTo(2000);
    const before = [...sim.monster];
    sim.advanceTo(100);
    sim.advanceTo(2500);
    expect([...sim.monster]).toEqual(before);
  });

  it("a stroke through a monster defeats it", () => {
    const sim = new MonsterSim(cfg);
    sim.advanceTo(0);
    sim.advanceTo(1000);
    const [cell] = occupied(sim);
    const x = ((cell % cfg.cols) + 0.5) / cfg.cols;
    const y = (Math.floor(cell / cfg.cols) + 0.5) / cfg.rows;
    sim.beginStroke(1100);
    sim.addPoints([{ t: 1100, x, y }]);
    sim.endStroke();
    expect(sim.monster[cell]).toBe(0);
    expect(sim.loot).toBe(1);
    expect(sim.alive).toBe(0);
    expect(sim.poofs).toEqual([{ cell, t: 1100 }]);
  });

  it("is deterministic for a seed", () => {
    const a = new MonsterSim(cfg);
    const b = new MonsterSim(cfg);
    for (const t of [0, 1000, 2000, 3000]) {
      a.advanceTo(t);
      b.advanceTo(t);
    }
    expect([...a.monster]).toEqual([...b.monster]);
  });
});
```

- [ ] **Step 2: Run to see the failure**

Run: `pnpm test monster`
Expected: FAIL, `../src/sims/monster` cannot be resolved.

- [ ] **Step 3: Implement**

`src/sims/monster.ts`:

```ts
import type { Point } from "../data";
import { StrokeCells } from "../grid";
import { mulberry32 } from "../rng";
import type { Sim } from "./types";

export interface MonsterConfig {
  cols: number;
  rows: number;
  spawnIntervalMs: number;
  /** Most monsters alive at once. */
  cap: number;
  /** Number of monster sprites. */
  kinds: number;
  seed: number;
}

export interface Poof {
  cell: number;
  t: number;
}

export class MonsterSim implements Sim {
  readonly monster: Uint8Array;
  readonly poofs: Poof[] = [];
  loot = 0;
  alive = 0;
  version = 0;
  private cells: StrokeCells;
  private rand: () => number;
  private clock: number | null = null;
  private nextSpawn = 0;

  constructor(readonly cfg: MonsterConfig) {
    this.monster = new Uint8Array(cfg.cols * cfg.rows);
    this.cells = new StrokeCells(cfg.cols, cfg.rows);
    this.rand = mulberry32(cfg.seed);
  }

  advanceTo(t: number): void {
    if (this.clock === null) {
      this.clock = t;
      this.nextSpawn = t + this.cfg.spawnIntervalMs;
      return;
    }
    if (t <= this.clock) return;
    this.clock = t;
    if (t < this.nextSpawn) return;
    const due = Math.floor((t - this.nextSpawn) / this.cfg.spawnIntervalMs) + 1;
    this.nextSpawn += due * this.cfg.spawnIntervalMs;
    for (let k = 0; k < Math.min(due, this.cfg.cap); k++) this.spawnOne();
  }

  beginStroke(t: number): void {
    this.advanceTo(t);
    this.cells.begin();
  }

  addPoints(points: Point[]): void {
    if (points.length === 0) return;
    this.advanceTo(points[points.length - 1].t);
    for (const i of this.cells.push(points)) {
      if (!this.monster[i]) continue;
      this.monster[i] = 0;
      this.alive -= 1;
      this.loot += 1;
      this.poofs.push({ cell: i, t: this.clock ?? points[0].t });
      this.version++;
    }
  }

  endStroke(): void {}

  private spawnOne(): void {
    if (this.alive >= this.cfg.cap) return;
    const empty: number[] = [];
    for (let i = 0; i < this.monster.length; i++) if (!this.monster[i]) empty.push(i);
    if (empty.length === 0) return;
    const cell = empty[Math.floor(this.rand() * empty.length)];
    this.monster[cell] = 1 + Math.floor(this.rand() * this.cfg.kinds);
    this.alive += 1;
    this.version++;
  }
}
```

Append to `src/config.ts` (import at the top):

```ts
import type { MonsterConfig } from "./sims/monster";

/** One monster per minute of recorded time when replaying a file. */
export const MONSTER: MonsterConfig = { cols: 16, rows: 10, spawnIntervalMs: 60_000, cap: 24, kinds: 4, seed: 7 };

/** Faster spawning in live mouse mode, so the panel moves while you watch. */
export const MONSTER_LIVE_SPAWN_MS = 2_000;
```

- [ ] **Step 4: Run the tests and the type check**

Run: `pnpm test && pnpm typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add prototypes/form-study
git commit -m "Form study: monster simulation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Driving sims from files and from the mouse

**Files:**
- Create: `prototypes/form-study/src/drive.ts`
- Test: `prototypes/form-study/test/drive.test.ts`

**Interfaces:**
- Consumes: `Sim`, `Stroke`, `Point`.
- Produces: `replay(strokes: Stroke[], sims: Sim[]): void`, `attachLive(targets: HTMLElement[], getSims: () => Sim[], now?: () => number): void`.

- [ ] **Step 1: Write the failing test**

`test/drive.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Point, Stroke } from "../src/data";
import { replay } from "../src/drive";
import type { Sim } from "../src/sims/types";

class Spy implements Sim {
  log: string[] = [];
  beginStroke(t: number) {
    this.log.push(`begin ${t}`);
  }
  addPoints(points: Point[]) {
    this.log.push(`add ${points.length}`);
  }
  endStroke() {
    this.log.push("end");
  }
  advanceTo(t: number) {
    this.log.push(`advance ${t}`);
  }
}

const p = (t: number): Point => ({ t, x: 0.5, y: 0.5 });

describe("replay", () => {
  it("advances time, then feeds each whole stroke, then advances to the last point", () => {
    const spy = new Spy();
    const strokes: Stroke[] = [
      { id: 1, points: [p(5), p(9)] },
      { id: 2, points: [p(7)] },
    ];
    replay(strokes, [spy]);
    expect(spy.log).toEqual(["advance 5", "begin 5", "add 2", "end", "advance 7", "begin 7", "add 1", "end", "advance 9"]);
  });

  it("does nothing for no strokes", () => {
    const spy = new Spy();
    replay([], [spy]);
    expect(spy.log).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see the failure**

Run: `pnpm test drive`
Expected: FAIL, `../src/drive` cannot be resolved.

- [ ] **Step 3: Implement**

`src/drive.ts`:

```ts
import type { Point, Stroke } from "./data";
import type { Sim } from "./sims/types";

/** Feed a recorded day to the sims in time order. */
export function replay(strokes: Stroke[], sims: Sim[]): void {
  if (strokes.length === 0) return;
  let end = -Infinity;
  for (const s of strokes) {
    const t0 = s.points[0].t;
    for (const sim of sims) {
      sim.advanceTo(t0);
      sim.beginStroke(t0);
      sim.addPoints(s.points);
      sim.endStroke();
    }
    end = Math.max(end, s.points[s.points.length - 1].t);
  }
  for (const sim of sims) sim.advanceTo(end);
}

function toPoint(e: PointerEvent, el: HTMLElement, t: number): Point {
  const rect = el.getBoundingClientRect();
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { t, x: clamp((e.clientX - rect.left) / rect.width), y: clamp((e.clientY - rect.top) / rect.height) };
}

/** Mouse drags on any target become live strokes for every sim. */
export function attachLive(targets: HTMLElement[], getSims: () => Sim[], now: () => number = Date.now): void {
  let down = false;
  for (const el of targets) {
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      down = true;
      const p = toPoint(e, el, now());
      for (const sim of getSims()) {
        sim.advanceTo(p.t);
        sim.beginStroke(p.t);
        sim.addPoints([p]);
      }
    });
    el.addEventListener("pointermove", (e) => {
      if (!down) return;
      const p = toPoint(e, el, now());
      for (const sim of getSims()) sim.addPoints([p]);
    });
    const end = () => {
      if (!down) return;
      down = false;
      for (const sim of getSims()) sim.endStroke();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `pnpm test && pnpm typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add prototypes/form-study
git commit -m "Form study: replay files and live mouse strokes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Kenney tiles

**Files:**
- Create: `prototypes/form-study/src/assets/tiles/*.png`, `LICENSE-*.txt`
- Create: `prototypes/form-study/src/tiles.ts`

**Interfaces:**
- Produces: `TILES` (role → tile name), `loadTiles(): Promise<void>`, `tex(name: string): Texture`. Tile names are `town_NNNN`, `farm_NNNN`, `dungeon_NNNN`.

- [ ] **Step 1: Ask Kia, then download**

Ask: "Download three Kenney packs (CC0, a few hundred KB each) from kenney.nl: Tiny Town, Tiny Farm, Tiny Dungeon?" Only after a yes. The links were read off the asset pages on 2026-10-10; if one 404s, open the asset page and use its "Continue without donating" link.

```bash
K=/private/tmp/claude-501/-Users-kiabai-Documents-PDev2026/4716c04a-899b-40f8-8b06-d4b522dc30ee/scratchpad/kenney
mkdir -p "$K"/town "$K"/farm "$K"/dungeon
curl -L -o "$K/town.zip" https://kenney.nl/media/pages/assets/tiny-town/a415fbeb49-1735736916/kenney_tiny-town.zip
curl -L -o "$K/farm.zip" https://kenney.nl/media/pages/assets/tiny-farm/dfded1ae3e-1782913588/kenney_tiny-farm.zip
curl -L -o "$K/dungeon.zip" https://kenney.nl/media/pages/assets/tiny-dungeon/f8422efb44-1674742415/kenney_tiny-dungeon.zip
for p in town farm dungeon; do unzip -q -o "$K/$p.zip" -d "$K/$p"; done
ls "$K"/town "$K"/farm "$K"/dungeon
```

Expected: each folder has a `Tiles/` folder of `tile_NNNN.png`, a `Tilemap/` folder, and a `License.txt`. If the layout differs, find the 16×16 single-tile PNGs with `find "$K/<pack>" -name '*.png' | head`.

- [ ] **Step 2: Copy tiles into the project**

```bash
D=/Users/kiabai/Documents/PDev2026/prototypes/form-study/src/assets/tiles
mkdir -p "$D"
for p in town farm dungeon; do
  for f in "$K/$p"/Tiles/tile_*.png; do cp "$f" "$D/${p}_${f##*tile_}"; done
  cp "$K/$p/License.txt" "$D/LICENSE-$p.txt"
done
ls "$D" | head
```

Expected: names like `town_0000.png`, `farm_0042.png`, `dungeon_0110.png`.

- [ ] **Step 3: Pick a tile for each role**

For each pack, make a large copy of the packed tilemap and look at it with the Read tool:

```bash
for p in town farm dungeon; do
  m=$(find "$K/$p/Tilemap" -name '*packed*.png' | head -1)
  w=$(sips -g pixelWidth "$m" | awk '/pixelWidth/{print $2}')
  h=$(sips -g pixelHeight "$m" | awk '/pixelHeight/{print $2}')
  echo "$p: $m ${w}x${h}, $((w / 16)) tiles per row"
  sips -z $((h * 4)) $((w * 4)) "$m" --out "$K/$p-sheet.png" >/dev/null
done
```

Tile number = row × (tiles per row) + column, counting from 0, zero-padded to 4 digits. Choose:
- `city.grass`: plain grass, from town.
- `city.buildings`: three tiles from town that read as a building on their own at 16 px, small → large (tier 1, 2, 3).
- `farm.soil`: tilled earth, from farm.
- `farm.stages`: four tiles from farm for seeds, sprout, growing plant, ripe crop.
- `monster.floor`: plain floor, from dungeon.
- `monster.kinds`: four different monsters, from dungeon.

Open each chosen `src/assets/tiles/<name>.png` with the Read tool to confirm it.

- [ ] **Step 4: Write `src/tiles.ts` with the chosen names**

The names below are the shape only; replace every `NNNN` with the number chosen in Step 3 before saving.

```ts
import { Assets, type Texture } from "pixi.js";

const urls = import.meta.glob("./assets/tiles/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export const TILES = {
  city: {
    grass: "town_NNNN",
    buildings: ["town_NNNN", "town_NNNN", "town_NNNN"],
  },
  farm: {
    soil: "farm_NNNN",
    stages: ["farm_NNNN", "farm_NNNN", "farm_NNNN", "farm_NNNN"],
  },
  monster: {
    floor: "dungeon_NNNN",
    kinds: ["dungeon_NNNN", "dungeon_NNNN", "dungeon_NNNN", "dungeon_NNNN"],
  },
} as const;

const cache = new Map<string, Texture>();

export async function loadTiles(): Promise<void> {
  const names = new Set<string>([
    TILES.city.grass,
    ...TILES.city.buildings,
    TILES.farm.soil,
    ...TILES.farm.stages,
    TILES.monster.floor,
    ...TILES.monster.kinds,
  ]);
  for (const name of names) {
    const url = urls[`./assets/tiles/${name}.png`];
    if (!url) throw new Error(`Tile ${name}.png is missing from src/assets/tiles`);
    const texture = await Assets.load<Texture>(url);
    texture.source.scaleMode = "nearest";
    cache.set(name, texture);
  }
}

export function tex(name: string): Texture {
  const t = cache.get(name);
  if (!t) throw new Error(`Tile ${name} is not loaded`);
  return t;
}
```

Check: `grep -c NNNN src/tiles.ts` prints `0`.

- [ ] **Step 5: Type check**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/kiabai/Documents/PDev2026
git add prototypes/form-study/src/assets prototypes/form-study/src/tiles.ts
git commit -m "Form study: Kenney pixel tiles (CC0)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Views and the page

**Files:**
- Create: `prototypes/form-study/index.html`, `src/style.css`, `src/main.ts`
- Create: `prototypes/form-study/src/render/panel.ts`, `render/city.ts`, `render/farm.ts`, `render/monster.ts`
- Create: `.claude/launch.json` (gitignored)

**Interfaces:**
- Consumes: everything above.
- Produces: `createPanel(host, title): Promise<Panel>` with `Panel { app: Application; canvas: HTMLCanvasElement; stat: HTMLElement }`; views `CityView`, `FarmView`, `MonsterView`, each `{ root: Container; update(now: number): void; stat(): string; destroy(): void }`.

- [ ] **Step 1: Panel**

`src/render/panel.ts`:

```ts
import { Application } from "pixi.js";

/** Every panel is 512×320, the pad's 1.6 aspect ratio. */
export const PANEL_W = 512;
export const PANEL_H = 320;

export interface Panel {
  app: Application;
  /** app.canvas typed as a DOM canvas (Pixi types it as its own ICanvas). */
  canvas: HTMLCanvasElement;
  stat: HTMLElement;
}

export async function createPanel(host: HTMLElement, title: string): Promise<Panel> {
  const section = document.createElement("section");
  section.className = "panel";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const stat = document.createElement("p");
  stat.className = "stat";
  const app = new Application();
  await app.init({ width: PANEL_W, height: PANEL_H, background: "#1d1d1b", antialias: false, roundPixels: true });
  const canvas = app.canvas as HTMLCanvasElement;
  section.append(heading, canvas, stat);
  host.append(section);
  return { app, canvas, stat };
}
```

- [ ] **Step 2: City view**

`src/render/city.ts` (32×20 cells of 16 px; roads are drawn, not tiled, so any neighbour combination joins up):

```ts
import { Container, Graphics, Sprite } from "pixi.js";
import { roadMask, type CitySim } from "../sims/city";
import { TILES, tex } from "../tiles";

const T = 16;
const ROAD = 0x8b8579;

export class CityView {
  readonly root = new Container();
  private roads = new Graphics();
  private buildings: Sprite[] = [];
  private seen = -1;

  constructor(private sim: CitySim) {
    const { cols, rows } = sim.cfg;
    for (let i = 0; i < cols * rows; i++) {
      const grass = new Sprite(tex(TILES.city.grass));
      grass.position.set((i % cols) * T, Math.floor(i / cols) * T);
      this.root.addChild(grass);
    }
    this.root.addChild(this.roads);
    for (let i = 0; i < cols * rows; i++) {
      const b = new Sprite(tex(TILES.city.buildings[0]));
      b.position.set((i % cols) * T, Math.floor(i / cols) * T);
      b.visible = false;
      this.root.addChild(b);
      this.buildings.push(b);
    }
  }

  update(_now: number): void {
    if (this.sim.version === this.seen) return;
    this.seen = this.sim.version;
    const { cols, rows, wideRoadAt } = this.sim.cfg;
    this.roads.clear();
    for (let i = 0; i < cols * rows; i++) {
      if (!this.sim.road[i]) continue;
      const x = (i % cols) * T;
      const y = Math.floor(i / cols) * T;
      const w = this.sim.traffic[i] >= wideRoadAt ? 10 : 6;
      const o = (T - w) / 2;
      const m = roadMask(this.sim.road, cols, rows, i);
      this.roads.rect(x + o, y + o, w, w).fill(ROAD);
      if (m & 1) this.roads.rect(x + o, y, w, o).fill(ROAD);
      if (m & 2) this.roads.rect(x + o + w, y + o, o, w).fill(ROAD);
      if (m & 4) this.roads.rect(x + o, y + o + w, w, o).fill(ROAD);
      if (m & 8) this.roads.rect(x, y + o, o, w).fill(ROAD);
    }
    for (let i = 0; i < cols * rows; i++) {
      const tier = this.sim.building[i];
      const sprite = this.buildings[i];
      sprite.visible = tier > 0;
      if (tier > 0) sprite.texture = tex(TILES.city.buildings[tier - 1]);
    }
  }

  stat(): string {
    let roads = 0;
    let buildings = 0;
    for (let i = 0; i < this.sim.road.length; i++) {
      if (this.sim.road[i]) roads++;
      if (this.sim.building[i]) buildings++;
    }
    return `${roads} road tiles · ${buildings} buildings`;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
```

- [ ] **Step 3: Farm view**

`src/render/farm.ts` (16×10 cells of 32 px; 16 px tiles at scale 2):

```ts
import { Container, Sprite } from "pixi.js";
import type { FarmSim } from "../sims/farm";
import { TILES, tex } from "../tiles";

const CELL = 32;

export class FarmView {
  readonly root = new Container();
  private crops: Sprite[] = [];
  private seen = -1;

  constructor(private sim: FarmSim) {
    const { cols, rows } = sim.cfg;
    for (let i = 0; i < cols * rows; i++) {
      const x = (i % cols) * CELL;
      const y = Math.floor(i / cols) * CELL;
      const soil = new Sprite(tex(TILES.farm.soil));
      soil.position.set(x, y);
      soil.scale.set(2);
      this.root.addChild(soil);
      const crop = new Sprite(tex(TILES.farm.stages[0]));
      crop.position.set(x, y);
      crop.scale.set(2);
      crop.visible = false;
      this.root.addChild(crop);
      this.crops.push(crop);
    }
  }

  update(_now: number): void {
    if (this.sim.version === this.seen) return;
    this.seen = this.sim.version;
    for (let i = 0; i < this.crops.length; i++) {
      const stage = this.sim.stage[i];
      const planted = stage > 0 || this.sim.water[i] > 0;
      this.crops[i].visible = planted;
      if (planted) this.crops[i].texture = tex(TILES.farm.stages[stage]);
    }
  }

  stat(): string {
    return `${this.sim.harvested.toLocaleString()} harvested`;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
```

- [ ] **Step 4: Monster view**

`src/render/monster.ts`:

```ts
import { Container, Graphics, Sprite } from "pixi.js";
import type { MonsterSim } from "../sims/monster";
import { TILES, tex } from "../tiles";

const CELL = 32;
const POOF_MS = 300;

export class MonsterView {
  readonly root = new Container();
  private monsters: Sprite[] = [];
  private effects = new Graphics();
  private live: { cell: number; born: number }[] = [];
  private seen = -1;

  constructor(private sim: MonsterSim) {
    const { cols, rows } = sim.cfg;
    for (let i = 0; i < cols * rows; i++) {
      const x = (i % cols) * CELL;
      const y = Math.floor(i / cols) * CELL;
      const floor = new Sprite(tex(TILES.monster.floor));
      floor.position.set(x, y);
      floor.scale.set(2);
      this.root.addChild(floor);
      const m = new Sprite(tex(TILES.monster.kinds[0]));
      m.position.set(x, y);
      m.scale.set(2);
      m.visible = false;
      this.root.addChild(m);
      this.monsters.push(m);
    }
    this.root.addChild(this.effects);
  }

  update(now: number): void {
    for (const p of this.sim.poofs.splice(0)) this.live.push({ cell: p.cell, born: now });
    this.live = this.live.filter((p) => now - p.born < POOF_MS);
    this.effects.clear();
    const { cols } = this.sim.cfg;
    for (const p of this.live) {
      const k = (now - p.born) / POOF_MS;
      const size = 8 + 24 * k;
      const cx = (p.cell % cols) * CELL + CELL / 2;
      const cy = Math.floor(p.cell / cols) * CELL + CELL / 2;
      this.effects.rect(cx - size / 2, cy - size / 2, size, size).fill({ color: 0xffffff, alpha: 1 - k });
    }
    if (this.sim.version === this.seen) return;
    this.seen = this.sim.version;
    for (let i = 0; i < this.monsters.length; i++) {
      const kind = this.sim.monster[i];
      this.monsters[i].visible = kind > 0;
      if (kind > 0) this.monsters[i].texture = tex(TILES.monster.kinds[kind - 1]);
    }
  }

  stat(): string {
    return `${this.sim.loot.toLocaleString()} defeated · ${this.sim.alive} around`;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
```

- [ ] **Step 5: Page**

`prototypes/form-study/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Form study</title>
  </head>
  <body>
    <header>
      <h1>Form study</h1>
      <p id="status">Live: drag on any panel</p>
      <button id="sample" type="button">Load sample</button>
      <button id="reset" type="button">Reset</button>
      <span class="hint">or drop a .jsonl anywhere</span>
    </header>
    <main id="panels"></main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/style.css`:

```css
:root {
  color-scheme: dark;
  --bg: #121211;
  --fg: #e8e6e1;
  --muted: #8d8a83;
}

body {
  margin: 0;
  padding: 16px;
  background: var(--bg);
  color: var(--fg);
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, sans-serif;
}

header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
}

h1 {
  margin: 0;
  font-size: 16px;
}

#status {
  margin: 0;
  color: var(--muted);
}

.hint {
  color: var(--muted);
  font-size: 12px;
}

button {
  font: inherit;
  padding: 4px 10px;
}

#panels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
}

.panel h2 {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
}

.panel canvas {
  display: block;
  width: 100%;
  height: auto;
  image-rendering: pixelated;
  touch-action: none;
  cursor: crosshair;
}

.stat {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
```

`src/main.ts`:

```ts
import "./style.css";
import type { Container } from "pixi.js";
import { CITY, FARM, MONSTER, MONSTER_LIVE_SPAWN_MS } from "./config";
import { parseJsonl, toStrokes } from "./data";
import { attachLive, replay } from "./drive";
import { CityView } from "./render/city";
import { FarmView } from "./render/farm";
import { MonsterView } from "./render/monster";
import { createPanel, type Panel } from "./render/panel";
import { CitySim } from "./sims/city";
import { FarmSim } from "./sims/farm";
import { MonsterSim } from "./sims/monster";
import type { Sim } from "./sims/types";
import { loadTiles } from "./tiles";

interface View {
  root: Container;
  update(now: number): void;
  stat(): string;
  destroy(): void;
}

interface World {
  mode: "live" | "file";
  sims: Sim[];
  views: View[];
  monster: MonsterSim;
}

const statusEl = document.querySelector<HTMLElement>("#status")!;
const host = document.querySelector<HTMLElement>("#panels")!;

function makeWorld(mode: World["mode"], panels: Panel[]): World {
  const city = new CitySim(CITY);
  const farm = new FarmSim(FARM);
  const monster = new MonsterSim(mode === "live" ? { ...MONSTER, spawnIntervalMs: MONSTER_LIVE_SPAWN_MS } : MONSTER);
  const views: View[] = [new CityView(city), new FarmView(farm), new MonsterView(monster)];
  views.forEach((v, i) => panels[i].app.stage.addChild(v.root));
  return { mode, sims: [city, farm, monster], views, monster };
}

async function boot() {
  await loadTiles();
  const panels: Panel[] = [];
  for (const title of ["City", "Farm", "Monster"]) panels.push(await createPanel(host, title));

  let world = makeWorld("live", panels);
  attachLive(
    panels.map((p) => p.canvas),
    () => world.sims,
  );

  function swap(next: World) {
    world.views.forEach((v) => v.destroy());
    world = next;
  }

  function loadText(text: string, name: string) {
    const strokes = toStrokes(parseJsonl(text));
    if (strokes.length === 0) {
      statusEl.textContent = `No touch records in ${name}`;
      return;
    }
    swap(makeWorld("file", panels));
    replay(strokes, world.sims);
    world.monster.poofs.length = 0;
    statusEl.textContent = `${name}: ${strokes.length.toLocaleString()} strokes`;
  }

  document.querySelector("#reset")!.addEventListener("click", () => {
    swap(makeWorld("live", panels));
    statusEl.textContent = "Live: drag on any panel";
  });

  document.querySelector("#sample")!.addEventListener("click", async () => {
    const res = await fetch("/sample.jsonl");
    loadText(res.ok ? await res.text() : "", "sample.jsonl");
  });

  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file) loadText(await file.text(), file.name);
  });

  function frame() {
    const now = Date.now();
    if (world.mode === "live") for (const sim of world.sims) sim.advanceTo(now);
    world.views.forEach((v, i) => {
      v.update(performance.now());
      panels[i].stat.textContent = v.stat();
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot();
```

- [ ] **Step 6: Type check and tests**

Run: `pnpm typecheck && pnpm test`
Expected: no errors, all tests pass.

- [ ] **Step 7: Dev-server config for the browser pane**

`/Users/kiabai/Documents/PDev2026/.claude/launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "form-study",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--dir", "prototypes/form-study", "dev"],
      "port": 5174
    }
  ]
}
```

- [ ] **Step 8: Verify in the browser pane**

Start with `preview_start` name `form-study`. Then:
1. Screenshot: three panels (City, Farm, Monster) with grass, soil and floor tiles, crisp pixels; the console has no errors (`read_console_messages`, errors only).
2. Drag the same horizontal line across the City panel three times (`left_click_drag`), screenshot: a road appears on the third pass, buildings start next to it; Farm and Monster show watered plots and the same line.
3. Wait 10 s, screenshot the Monster panel: about five monsters have appeared; drag through one: it disappears with a white flash and `1 defeated` shows.
4. Click **Load sample** with no sample yet: the status line says `No touch records in sample.jsonl` and the panels keep their state.

If a tile reads wrong at this size (a building that looks like a fence, a crop that looks like a rock), go back to Task 12 Step 3, pick another number, and re-check.

- [ ] **Step 9: Commit**

```bash
cd /Users/kiabai/Documents/PDev2026
git add prototypes/form-study
git commit -m "Form study: city, farm and monster panels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Real data and final check

**Files:**
- Create: `prototypes/data/sample.jsonl` (committed only with Kia's OK)

- [ ] **Step 1: Record**

Kia leaves Capture (`pnpm tauri dev` in `prototypes/capture`) running while he works, for at least an hour.

- [ ] **Step 2: Cut a sample**

```bash
cd /Users/kiabai/Documents/PDev2026/prototypes/data
wc -l "touches-$(date +%F).jsonl"
head -n 20000 "touches-$(date +%F).jsonl" > sample.jsonl
```

- [ ] **Step 3: Check the forms on real input**

In the browser pane: **Load sample**, screenshot all three panels; then drop the full day's file (or, if dropping is not possible from the pane, copy it to `sample.jsonl` temporarily and load it), screenshot again. Expected: the city's roads follow the paths Kia's fingers actually take, the farm shows ripe and harvested plots where he scrolls, and monsters crowd the corners he never touches. Show Kia the screenshots.

- [ ] **Step 4: Tune if needed**

If a form is empty or saturated on a real day, change only the numbers in `src/config.ts` (road threshold, waterings per stage, spawn interval, cap), re-run `pnpm test`, re-check, and commit:

```bash
git add prototypes/form-study/src/config.ts
git commit -m "Form study: tune thresholds on a real day

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Ask before committing the sample**

Ask: "Commit `prototypes/data/sample.jsonl` (your first 20,000 touch records, positions only) to the public repo?" Only after a yes:

```bash
git add prototypes/data/sample.jsonl
git commit -m "Add a sample of recorded trackpad touches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
