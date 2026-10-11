//! One append-only .jsonl file per local day in prototypes/data/.

use crate::record::TouchRecord;
use chrono::{Local, NaiveDate};
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

/// prototypes/data, resolved from the source tree (fine for a prototype).
pub fn data_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../data"))
}

pub fn file_name_for(date: NaiveDate) -> String {
    format!("touches-{}.jsonl", date.format("%Y-%m-%d"))
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
    fn text_for_reads_that_days_file_or_returns_empty() {
        let dir = tempdir().unwrap();
        assert_eq!(text_for(dir.path(), day(11)), "");
        DailyWriter::new(dir.path().to_path_buf()).write(day(11), &[rec(1)]).unwrap();
        assert!(text_for(dir.path(), day(11)).starts_with(r#"{"t":1,"#));
        assert_eq!(text_for(dir.path(), day(12)), "");
    }
}
