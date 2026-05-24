use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{command, Manager, WebviewUrl, WebviewWindowBuilder};

const DEFAULT_URL: &str = "http://10.0.7.62:3000";
const DEFAULT_NGROK_URL: &str = "https://deluxe-clasp-rosy.ngrok-free.dev";

#[derive(Serialize, Deserialize, Default, Clone)]
struct Config {
    url: Option<String>,
    #[serde(rename = "ngrokUrl")]
    ngrok_url: Option<String>,
}

// Store config next to the exe (matches Electron behaviour)
fn config_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("sena-tracker.json")))
        .unwrap_or_else(|| PathBuf::from("sena-tracker.json"))
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

fn get_url() -> String {
    read_config()
        .url
        .unwrap_or_else(|| DEFAULT_URL.to_string())
}

// Build the shim with server-info values injected directly so getServerInfo
// never needs a round-trip IPC call (avoids timing / capability issues).
// pickFolder / createFolder are only exposed when Tauri invoke is reachable.
fn build_shim(current_url: &str, ngrok_url: &str) -> String {
    let default_js  = serde_json::to_string(DEFAULT_URL).unwrap_or_default();
    let current_js  = serde_json::to_string(current_url).unwrap_or_default();
    let ngrok_js    = serde_json::to_string(ngrok_url).unwrap_or_default();
    format!(r#"
(function () {{
  if (window.electronAPI) return;

  function inv() {{
    return window.__TAURI__?.core?.invoke
        ?? window.__TAURI_INTERNALS__?.invoke
        ?? null;
  }}

  var hasTauri = !!inv();

  window.electronAPI = {{
    getServerInfo: function () {{
      return Promise.resolve({{ defaultUrl: {default_js}, currentUrl: {current_js}, ngrokUrl: {ngrok_js} }});
    }},
    setServerUrl: function (url) {{
      var fn = inv();
      if (fn) fn('set_server_url', {{ url: url }});
      window.location.replace(url);
      return Promise.resolve();
    }},
    pickFolder:   hasTauri ? function (label, defaultPath) {{ return inv()('pick_folder',   {{ label: label, defaultPath: defaultPath }}); }} : undefined,
    createFolder: hasTauri ? function (parentPath, folderName, subfolders) {{ return inv()('create_folder', {{ parentPath: parentPath, folderName: folderName, subfolders: subfolders }}); }} : undefined,
  }};
}})();
"#)
}

#[command]
fn get_server_info() -> serde_json::Value {
    let cfg = read_config();
    serde_json::json!({
        "defaultUrl":  DEFAULT_URL,
        "currentUrl":  cfg.url.as_deref().unwrap_or(DEFAULT_URL),
        "ngrokUrl":    cfg.ngrok_url.as_deref().unwrap_or(DEFAULT_NGROK_URL),
    })
}

#[command]
fn set_server_url(app: tauri::AppHandle, url: String) {
    let mut cfg = read_config();
    if url != DEFAULT_URL {
        cfg.ngrok_url = Some(url.clone());
    }
    cfg.url = Some(url.clone());
    write_config(&cfg);

    if let Some(win) = app.get_webview_window("main") {
        // Use JS navigation so the initialization_script re-runs on the new page
        let js_url = serde_json::to_string(&url).unwrap_or_default();
        let _ = win.eval(&format!("window.location.replace({})", js_url));
    }
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

#[command]
fn create_folder(
    parent_path: String,
    folder_name: String,
    subfolders: Vec<String>,
) -> Result<String, String> {
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
            let cfg = read_config();
            let current_url = get_url();
            let ngrok_url = cfg.ngrok_url.as_deref().unwrap_or(DEFAULT_NGROK_URL);
            let shim = build_shim(&current_url, ngrok_url);

            // Mirror Electron: 60% of primary monitor (logical pixels)
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

            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(current_url.parse()?),
            )
            .title("Sena Job Tracker")
            .inner_size(win_w, win_h)
            .initialization_script(&shim)
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
