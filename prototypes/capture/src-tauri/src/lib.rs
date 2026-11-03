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
use std::path::PathBuf;
use tauri::{Emitter, Manager};

struct CaptureSource(&'static str);

/// This Mac's app data folder (on macOS ~/Library/Application Support/<identifier>/):
/// the day files and the city snapshot live here, so every install starts from empty land.
struct DataDir(PathBuf);

/// Today's records as raw .jsonl text, so the window can regrow today's forms.
/// async so reading a large day file stays off the main thread.
#[tauri::command]
async fn today_text(dir: tauri::State<'_, DataDir>) -> Result<String, String> {
    Ok(store::today_text(&dir.0))
}

/// Every day file from the local date of `from_ms` (epoch milliseconds) on,
/// concatenated in date order, so the window can regrow the whole city.
#[tauri::command]
async fn days_text(from_ms: u64, dir: tauri::State<'_, DataDir>) -> Result<String, String> {
    Ok(i64::try_from(from_ms)
        .ok()
        .and_then(|ms| Local.timestamp_millis_opt(ms).earliest())
        .map(|t| store::days_text(&dir.0, t.date_naive()))
        .unwrap_or_default())
}

/// The saved city snapshot as JSON text; empty if none has been saved.
#[tauri::command]
async fn load_snapshot(dir: tauri::State<'_, DataDir>) -> Result<String, String> {
    Ok(store::load_snapshot(&dir.0))
}

#[tauri::command]
async fn save_snapshot(json: String, dir: tauri::State<'_, DataDir>) -> Result<(), String> {
    store::save_snapshot(&dir.0, &json).map_err(|e| e.to_string())
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
            // First launch on a machine: the folder does not exist yet, and the city starts empty.
            let dir = app.path().app_data_dir()?;
            if let Err(e) = std::fs::create_dir_all(&dir) {
                eprintln!("could not create {}: {e}", dir.display());
            }
            app.manage(DataDir(dir.clone()));
            let handle = app.handle().clone();
            let source = capture::start(dir, move |records| {
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
