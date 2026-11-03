mod capture;
mod cursor;
pub mod multitouch;
pub mod record;
mod sampler;
mod store;
// The sleep watcher belonged to the trackpad source; kept in the repo, unused.
#[allow(dead_code)]
mod wake;

use chrono::{Local, TimeZone};
use tauri::{Emitter, Manager};

struct CaptureSource(&'static str);

/// Today's records as raw .jsonl text, so the window can regrow today's forms.
/// async so reading a large day file stays off the main thread.
#[tauri::command]
async fn today_text() -> String {
    store::today_text(&store::data_dir())
}

/// Every day file from the local date of `from_ms` (epoch milliseconds) on,
/// concatenated in date order, so the window can regrow the whole city.
#[tauri::command]
async fn days_text(from_ms: u64) -> String {
    i64::try_from(from_ms)
        .ok()
        .and_then(|ms| Local.timestamp_millis_opt(ms).earliest())
        .map(|t| store::days_text(&store::data_dir(), t.date_naive()))
        .unwrap_or_default()
}

/// The saved city snapshot as JSON text; empty if none has been saved.
#[tauri::command]
async fn load_snapshot() -> String {
    store::load_snapshot(&store::data_dir())
}

#[tauri::command]
async fn save_snapshot(json: String) -> Result<(), String> {
    store::save_snapshot(&store::data_dir(), &json).map_err(|e| e.to_string())
}

/// `[x, y, w, h]` of the union of the active displays, in the cursor's points.
#[tauri::command]
fn display_bounds() -> [f64; 4] {
    cursor::display_bounds()
}

#[tauri::command]
fn capture_source(source: tauri::State<'_, CaptureSource>) -> String {
    source.0.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            today_text,
            days_text,
            load_snapshot,
            save_snapshot,
            display_bounds,
            capture_source
        ])
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
