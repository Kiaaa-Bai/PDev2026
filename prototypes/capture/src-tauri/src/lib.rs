mod capture;
mod cursor;
pub mod multitouch;
pub mod record;
mod sampler;
mod store;
mod wake;

use tauri::{Emitter, Manager};

struct CaptureSource(&'static str);

/// async so reading a large day file stays off the main thread.
#[tauri::command]
async fn today_heat(cols: usize, rows: usize) -> Vec<u32> {
    store::today_heat(&store::data_dir(), cols, rows)
}

#[tauri::command]
fn capture_source(source: tauri::State<'_, CaptureSource>) -> String {
    source.0.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![today_heat, capture_source])
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
