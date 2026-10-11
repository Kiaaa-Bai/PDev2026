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
    match code {
        3 => Some(Phase::Down),
        4 => Some(Phase::Move),
        5 | 6 | 7 => Some(Phase::Up),
        _ => None,
    }
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
