use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{command, WebviewUrl, WebviewWindowBuilder};

const LAN_URL: &str = "http://10.0.7.62:3000";
const DEFAULT_NGROK_URL: &str = "https://deluxe-clasp-rosy.ngrok-free.dev";

#[derive(Serialize, Deserialize, Default, Clone)]
struct Config {
    url: Option<String>,
    #[serde(rename = "ngrokUrl")]
    ngrok_url: Option<String>,
}

fn config_path() -> PathBuf {
    let dir = dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("SenaJobTracker");
    let _ = fs::create_dir_all(&dir);
    dir.join("sena-tracker.json")
}

fn read_config() -> Config {
    fs::read_to_string(config_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_config(cfg: &Config) {
    if let Ok(json) = serde_json::to_string_pretty(cfg) {
        let _ = fs::write(config_path(), json);
    }
}

#[command]
fn get_server_info() -> serde_json::Value {
    let cfg = read_config();
    serde_json::json!({
        "defaultUrl":  LAN_URL,
        "currentUrl":  cfg.url.as_deref().unwrap_or(DEFAULT_NGROK_URL),
        "ngrokUrl":    cfg.ngrok_url.as_deref().unwrap_or(DEFAULT_NGROK_URL),
    })
}

#[command]
fn set_server_url(url: String) {
    let mut cfg = read_config();
    if url != LAN_URL {
        cfg.ngrok_url = Some(url.clone());
    }
    cfg.url = Some(url);
    write_config(&cfg);
    // Navigation is handled by the shell: the iframe src is updated via postMessage
}

#[command]
fn pick_folder(label: Option<String>, default_path: Option<String>, app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let mut builder = app.dialog().file();
    if let Some(ref l) = label {
        builder = builder.set_title(l.as_str());
    }
    if let Some(ref dp) = default_path {
        builder = builder.set_directory(dp.as_str());
    }
    builder.blocking_pick_folder().map(|fp| fp.to_string())
}

fn is_safe_name(s: &str) -> bool {
    !s.is_empty()
        && !s.contains("..")
        && !s.contains('/')
        && !s.contains('\\')
        && !s.contains('\0')
}

#[command]
fn create_folder(
    parent_path: String,
    folder_name: String,
    subfolders: Vec<String>,
) -> Result<String, String> {
    if !is_safe_name(&folder_name) {
        return Err(format!("Invalid folder name: {folder_name}"));
    }
    for sub in &subfolders {
        if !is_safe_name(sub) {
            return Err(format!("Invalid subfolder name: {sub}"));
        }
    }
    let target = PathBuf::from(&parent_path).join(&folder_name);
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    for sub in &subfolders {
        fs::create_dir_all(target.join(sub)).map_err(|e| e.to_string())?;
    }
    Ok(target.to_string_lossy().to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let (win_w, win_h) = app
                .primary_monitor()
                .ok()
                .flatten()
                .map(|m| {
                    let sf = m.scale_factor();
                    let w = m.size().width as f64 / sf;
                    let h = m.size().height as f64 / sf;
                    ((w * 0.60).round(), (h * 0.60).round())
                })
                .unwrap_or((1200.0, 800.0));

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("/index.html".into()))
                .title("Sena Job Tracker")
                .inner_size(win_w, win_h)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_server_info,
            set_server_url,
            pick_folder,
            create_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
