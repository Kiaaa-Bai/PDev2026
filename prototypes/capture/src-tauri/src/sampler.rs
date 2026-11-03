//! Turns raw contact frames into records: maps positions to record
//! coordinates (see `Coords`), writes down/up always and moves at most
//! once per `min_move_ms`, and lifts fingers that vanish without an up.

use crate::record::{map_state, Contact, Phase, TouchRecord, TouchState};
use std::collections::{HashMap, HashSet};

/// Inside one touch, real frames never pause this long (largest seen: ~200 ms).
const NEW_TOUCH_GAP_MS: u64 = 1000;

struct Track {
    last_written_t: u64,
    last_seen_t: u64,
    x: f64,
    y: f64,
}

/// How contact positions become record positions.
#[derive(Clone, Copy)]
enum Coords {
    /// Trackpad: 0–1 with the origin at the bottom-left. Flipped to a top-left
    /// origin, clamped, rounded to 0.001.
    Unit,
    /// Pointer: global screen points, origin top-left. Rounded to 0.1,
    /// no flip, no clamp.
    Points,
}

pub struct Sampler {
    min_move_ms: u64,
    coords: Coords,
    active: HashMap<i32, Track>,
}

impl Sampler {
    /// Trackpad contacts (0–1, bottom-left origin). Unused now that the cursor
    /// is the only source; kept for the multitouch code that stays in the repo.
    #[allow(dead_code)]
    pub fn new(min_move_ms: u64) -> Self {
        Self { min_move_ms, coords: Coords::Unit, active: HashMap::new() }
    }

    /// Pointer contacts in global screen points.
    pub fn new_points(min_move_ms: u64) -> Self {
        Self { min_move_ms, coords: Coords::Points, active: HashMap::new() }
    }

    pub fn process(&mut self, now_ms: u64, contacts: &[Contact]) -> Vec<TouchRecord> {
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        for c in contacts {
            let Some(phase) = map_state(c.state) else { continue };
            let (x, y) = self.coords.to_record_xy(c);
            match phase {
                Phase::Down | Phase::Move => {
                    seen.insert(c.id);
                    // The framework reuses ids. If frames stopped and this id comes back
                    // much later, it is a new touch: lift the old one where it was last seen.
                    let stale = self
                        .active
                        .get(&c.id)
                        .is_some_and(|t| now_ms.saturating_sub(t.last_seen_t) >= NEW_TOUCH_GAP_MS);
                    if stale {
                        let old = self.active.remove(&c.id).expect("checked above");
                        out.push(TouchRecord {
                            t: old.last_seen_t,
                            id: c.id,
                            x: old.x,
                            y: old.y,
                            state: TouchState::Up,
                        });
                    }
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

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

impl Coords {
    fn to_record_xy(self, c: &Contact) -> (f64, f64) {
        match self {
            // Framework position (origin bottom-left) → record position (origin top-left).
            Coords::Unit => {
                let x = (c.x as f64).clamp(0.0, 1.0);
                let y = (1.0 - c.y as f64).clamp(0.0, 1.0);
                (round3(x), round3(y))
            }
            Coords::Points => (round1(c.x as f64), round1(c.y as f64)),
        }
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
    fn a_reused_id_after_a_long_gap_closes_the_old_stroke_first() {
        let mut s = Sampler::new(33);
        s.process(1000, &[c(1, 3, 0.1, 0.5)]);
        s.process(1020, &[c(1, 4, 0.2, 0.5)]);
        assert_eq!(
            s.process(9000, &[c(1, 3, 0.9, 0.9)]),
            vec![rec(1020, 1, 0.2, 0.5, TouchState::Up), rec(9000, 1, 0.9, 0.1, TouchState::Down)]
        );
    }

    #[test]
    fn repeated_make_touch_frames_do_not_split_a_stroke() {
        let mut s = Sampler::new(33);
        s.process(1000, &[c(1, 3, 0.1, 0.5)]);
        assert!(s.process(1010, &[c(1, 3, 0.1, 0.5)]).is_empty());
    }

    #[test]
    fn positions_are_clamped_and_rounded() {
        let mut s = Sampler::new(33);
        let out = s.process(1000, &[c(1, 3, 1.02, 0.12345)]);
        assert_eq!((out[0].x, out[0].y), (1.0, 0.877));
    }

    #[test]
    fn points_mode_keeps_coordinates() {
        let mut s = Sampler::new_points(33);
        let out = s.process(1000, &[c(1, 3, 2560.25, -40.0)]);
        assert_eq!((out[0].x, out[0].y), (2560.3, -40.0));
    }
}
