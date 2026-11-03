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

/// The environment variable that points the app at another data folder, so a test run can
/// use a generated city and never touch the one this Mac's own window uses.
const DATA_DIR_ENV: &str = "TRACKPAD_DATA_DIR";

/// The folder the day files and the snapshot live in: the override when one is set (an empty one
/// counts as not set), else this Mac's app data folder.
fn resolve_data_dir(env: Option<String>, app_dir: PathBuf) -> PathBuf {
    match env {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => app_dir,
    }
}

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
            // (var_os, not var: a path that is not valid UTF-8 must still count as an override,
            // never fall back to the real folder.)
            let env = std::env::var_os(DATA_DIR_ENV).map(|v| v.to_string_lossy().into_owned());
            let app_dir = app.path().app_data_dir()?;
            let dir = resolve_data_dir(env, app_dir.clone());
            if dir != app_dir {
                eprintln!("{DATA_DIR_ENV} set: using {}", dir.display());
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_override_wins_over_the_app_data_folder() {
        let app = PathBuf::from("/Users/someone/Library/Application Support/app");
        assert_eq!(resolve_data_dir(Some("/tmp/x".into()), app), PathBuf::from("/tmp/x"));
    }

    #[test]
    fn without_an_override_the_app_data_folder_is_used() {
        let app = PathBuf::from("/Users/someone/Library/Application Support/app");
        assert_eq!(resolve_data_dir(None, app.clone()), app);
    }

    #[test]
    fn an_empty_override_counts_as_none() {
        let app = PathBuf::from("/Users/someone/Library/Application Support/app");
        assert_eq!(resolve_data_dir(Some(String::new()), app.clone()), app);
    }
}
