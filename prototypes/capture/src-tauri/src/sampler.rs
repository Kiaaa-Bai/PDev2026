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

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

/// Framework position (origin bottom-left) → record position (origin top-left).
fn to_record_xy(c: &Contact) -> (f64, f64) {
    let x = (c.x as f64).clamp(0.0, 1.0);
    let y = (1.0 - c.y as f64).clamp(0.0, 1.0);
    (round3(x), round3(y))
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
