//! Glue: the pointer feeds the sampler; records go to today's file and
//! to the window.

use crate::cursor;
use crate::record::TouchRecord;
use crate::sampler::Sampler;
use crate::store::{self, DailyWriter};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Starts capture on a background thread and returns which source is in use
/// (always the cursor now; the trackpad code stays in the crate, unused).
pub fn start<F>(on_records: F) -> Result<&'static str, String>
where
    F: Fn(&[TouchRecord]) + Send + 'static,
{
    let rx = cursor::start()?;
    std::thread::spawn(move || {
        let mut sampler = Sampler::new_points(33);
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
    Ok("cursor")
}
