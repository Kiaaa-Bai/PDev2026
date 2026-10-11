//! Notices that the Mac slept. Wall-clock time keeps running during sleep;
//! the monotonic clock behind `Instant` (uptime on macOS) does not.

use std::time::{Duration, Instant, SystemTime};

const TICK: Duration = Duration::from_secs(2);
/// Scheduling jitter allowed before a gap counts as sleep.
const SLACK_MS: u64 = 1500;

pub fn slept(wall_elapsed_ms: u64, mono_elapsed_ms: u64) -> bool {
    wall_elapsed_ms > mono_elapsed_ms + SLACK_MS
}

/// Calls `on_wake` on a background thread each time the Mac wakes from sleep.
pub fn watch<F: Fn() + Send + 'static>(on_wake: F) {
    std::thread::spawn(move || {
        loop {
            let wall0 = SystemTime::now();
            let mono0 = Instant::now();
            std::thread::sleep(TICK);
            let wall = wall0.elapsed().map(|d| d.as_millis() as u64).unwrap_or(0);
            let mono = mono0.elapsed().as_millis() as u64;
            if slept(wall, mono) {
                on_wake();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_ordinary_tick_is_not_sleep() {
        assert!(!slept(2000, 2000));
        assert!(!slept(3400, 2000));
    }

    #[test]
    fn wall_time_running_ahead_of_uptime_is_sleep() {
        assert!(slept(5000, 2000));
    }

    #[test]
    fn the_clock_being_set_back_is_not_sleep() {
        assert!(!slept(0, 2000));
    }
}
