//! One append-only cursor-YYYY-MM-DD.jsonl file per local day, plus the city
//! snapshot beside them. Every function takes the directory; the app passes
//! its per-user app data folder, so each Mac keeps its own files.

use crate::record::TouchRecord;
use chrono::{Local, NaiveDate};
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

const SNAPSHOT_FILE: &str = "city-snapshot.json";
/// The world's seed for this data folder (where its rivers run), made on first use and kept beside the records.
const WORLD_SEED_FILE: &str = "world-seed.txt";

pub fn file_name_for(date: NaiveDate) -> String {
    format!("cursor-{}.jsonl", date.format("%Y-%m-%d"))
}

/// The date in a `cursor-YYYY-MM-DD.jsonl` file name; `None` for any other name.
fn date_of_file_name(name: &str) -> Option<NaiveDate> {
    let stem = name.strip_prefix("cursor-")?.strip_suffix(".jsonl")?;
    NaiveDate::parse_from_str(stem, "%Y-%m-%d").ok()
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

/// That day's records as raw .jsonl text; empty if nothing was recorded.
pub fn text_for(dir: &Path, date: NaiveDate) -> String {
    std::fs::read_to_string(dir.join(file_name_for(date))).unwrap_or_default()
}

pub fn today_text(dir: &Path) -> String {
    text_for(dir, Local::now().date_naive())
}

/// Every cursor day file dated `from` or later, concatenated in date order.
/// Other files in the directory (old trackpad files, the snapshot) are ignored.
pub fn days_text(dir: &Path, from: NaiveDate) -> String {
    let Ok(entries) = std::fs::read_dir(dir) else { return String::new() };
    let mut days: Vec<(NaiveDate, PathBuf)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let date = date_of_file_name(e.file_name().to_str()?)?;
            (date >= from).then(|| (date, e.path()))
        })
        .collect();
    days.sort();
    days.iter().filter_map(|(_, path)| std::fs::read_to_string(path).ok()).collect()
}

/// The saved city snapshot as raw JSON text; empty if there is none.
pub fn load_snapshot(dir: &Path) -> String {
    std::fs::read_to_string(dir.join(SNAPSHOT_FILE)).unwrap_or_default()
}

/// Replaces the saved snapshot. Writes a temp file first and renames it over
/// the old one, so a crash mid-write never leaves a half-written snapshot.
pub fn save_snapshot(dir: &Path, json: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{SNAPSHOT_FILE}.tmp"));
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, dir.join(SNAPSHOT_FILE))
}

/// The world seed of this data folder: read from its file, or made from the clock (any number will do) and
/// written there first, temp file then rename, so every later launch grows the same rivers.
pub fn world_seed(dir: &Path) -> std::io::Result<u32> {
    if let Some(seed) = std::fs::read_to_string(dir.join(WORLD_SEED_FILE)).ok().and_then(|t| t.trim().parse().ok()) {
        return Ok(seed);
    }
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let seed = (nanos % u128::from(u32::MAX)) as u32;
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{WORLD_SEED_FILE}.tmp"));
    std::fs::write(&tmp, format!("{seed}\n"))?;
    std::fs::rename(&tmp, dir.join(WORLD_SEED_FILE))?;
    Ok(seed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::record::TouchState;
    use std::fs;
    use tempfile::tempdir;

    fn day(d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, d).unwrap()
    }

    fn rec(t: u64) -> TouchRecord {
        TouchRecord { t, id: 1, x: 0.5, y: 0.5, state: TouchState::Move }
    }

    #[test]
    fn the_world_seed_is_made_once_per_folder_and_kept() {
        let dir = tempdir().unwrap();
        let first = world_seed(dir.path()).unwrap();
        assert_eq!(world_seed(dir.path()).unwrap(), first);
        assert_eq!(fs::read_to_string(dir.path().join(WORLD_SEED_FILE)).unwrap().trim(), first.to_string());
        // a folder with a seed already written keeps it
        let other = tempdir().unwrap();
        fs::write(other.path().join(WORLD_SEED_FILE), "12345\n").unwrap();
        assert_eq!(world_seed(other.path()).unwrap(), 12345);
    }

    #[test]
    fn file_name_is_cursor_per_day() {
        let d = NaiveDate::from_ymd_opt(2026, 11, 3).unwrap();
        assert_eq!(file_name_for(d), "cursor-2026-11-03.jsonl");
    }

    #[test]
    fn writer_rolls_over_to_a_new_file_at_midnight() {
        let dir = tempdir().unwrap();
        let mut w = DailyWriter::new(dir.path().to_path_buf());
        w.write(day(11), &[rec(1), rec(2)]).unwrap();
        w.write(day(12), &[rec(3)]).unwrap();
        let a = fs::read_to_string(dir.path().join("cursor-2026-10-11.jsonl")).unwrap();
        let b = fs::read_to_string(dir.path().join("cursor-2026-10-12.jsonl")).unwrap();
        assert_eq!(a.lines().count(), 2);
        assert_eq!(b.lines().count(), 1);
        assert!(b.starts_with(r#"{"t":3,"#));
    }

    #[test]
    fn writer_appends_to_an_existing_file() {
        let dir = tempdir().unwrap();
        DailyWriter::new(dir.path().to_path_buf()).write(day(11), &[rec(1)]).unwrap();
        DailyWriter::new(dir.path().to_path_buf()).write(day(11), &[rec(2)]).unwrap();
        let a = fs::read_to_string(dir.path().join("cursor-2026-10-11.jsonl")).unwrap();
        assert_eq!(a.lines().count(), 2);
    }

    #[test]
    fn text_for_reads_that_days_file_or_returns_empty() {
        let dir = tempdir().unwrap();
        assert_eq!(text_for(dir.path(), day(11)), "");
        DailyWriter::new(dir.path().to_path_buf()).write(day(11), &[rec(1)]).unwrap();
        assert!(text_for(dir.path(), day(11)).starts_with(r#"{"t":1,"#));
        assert_eq!(text_for(dir.path(), day(12)), "");
    }

    #[test]
    fn days_text_reads_only_cursor_files() {
        let dir = tempdir().unwrap();
        for name in [
            "touches-2026-11-03.jsonl",
            "cursor-2026-11-02.jsonl",
            "cursor-2026-11-03.jsonl",
            "cursor-2026-11-01.jsonl",
        ] {
            fs::write(dir.path().join(name), format!("{name}\n")).unwrap();
        }
        let from = NaiveDate::from_ymd_opt(2026, 11, 2).unwrap();
        assert_eq!(
            days_text(dir.path(), from),
            "cursor-2026-11-02.jsonl\ncursor-2026-11-03.jsonl\n"
        );
    }

    #[test]
    fn a_directory_that_does_not_exist_yet_is_created_on_first_write() {
        let root = tempdir().unwrap();
        let fresh = root.path().join("never").join("made");

        // Nothing there: reads are empty, not errors.
        assert_eq!(text_for(&fresh, day(11)), "");
        assert_eq!(days_text(&fresh, day(1)), "");
        assert_eq!(load_snapshot(&fresh), "");

        DailyWriter::new(fresh.clone()).write(day(11), &[rec(1), rec(2)]).unwrap();
        assert_eq!(text_for(&fresh, day(11)).lines().count(), 2);
        assert_eq!(days_text(&fresh, day(1)).lines().count(), 2);

        let other = root.path().join("also").join("new");
        save_snapshot(&other, "{\"a\":1}").unwrap();
        assert_eq!(load_snapshot(&other), "{\"a\":1}");
    }

    #[test]
    fn snapshot_round_trips() {
        let dir = tempdir().unwrap();
        assert_eq!(load_snapshot(dir.path()), "");
        save_snapshot(dir.path(), "{\"a\":1}").unwrap();
        assert_eq!(load_snapshot(dir.path()), "{\"a\":1}");
        assert!(dir.path().join("city-snapshot.json").exists());
    }
}
