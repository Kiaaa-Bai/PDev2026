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
