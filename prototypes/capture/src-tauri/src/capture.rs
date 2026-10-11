//! Glue: a capture source feeds the sampler; records go to today's file and
//! to the window.

use crate::record::TouchRecord;
use crate::sampler::Sampler;
use crate::store::{self, DailyWriter};
use crate::{cursor, multitouch, wake};
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
        Ok(rx) => {
            wake::watch(|| {
                eprintln!("Mac woke from sleep; reopening the trackpad");
                if let Err(e) = multitouch::restart() {
                    eprintln!("could not reopen the trackpad: {e}");
                }
            });
            (rx, "trackpad")
        }
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
