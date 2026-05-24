use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::{command, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

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

fn is_allowed_server_url(raw: &str) -> bool {
    let Ok(url) = Url::parse(raw) else {
        return false;
    };
    let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };
    match url.scheme() {
        "http" => {
            let port = url.port_or_known_default();
            (host == "10.0.7.62" || host == "localhost" || host == "127.0.0.1") && port == Some(3000)
        }
        "https" => host.ends_with(".ngrok-free.dev"),
        _ => false,
    }
}

fn get_url() -> String {
    read_config()
        .url
        .filter(|url| is_allowed_server_url(url))
        .unwrap_or_else(|| DEFAULT_NGROK_URL.to_string())
}

// Inject the Electron-compatible API directly into the top-level remote page.
// Keeping the app top-level preserves normal SameSite session-cookie behavior.
fn build_shim(current_url: &str, ngrok_url: &str) -> String {
    let default_js = serde_json::to_string(LAN_URL).unwrap_or_default();
    let current_js = serde_json::to_string(current_url).unwrap_or_default();
    let ngrok_js = serde_json::to_string(ngrok_url).unwrap_or_default();
    format!(
        r#"
(function () {{
  if (window.electronAPI) return;

  function inv() {{
    return window.__TAURI__?.core?.invoke
        ?? window.__TAURI_INTERNALS__?.invoke
        ?? null;
  }}

  function invokeOrReject(cmd, args) {{
    var fn = inv();
    return fn ? fn(cmd, args || {{}}) : Promise.reject(new Error('Tauri IPC unavailable'));
  }}

  var api = {{
    getServerInfo: function () {{
      return Promise.resolve({{ defaultUrl: {default_js}, currentUrl: {current_js}, ngrokUrl: {ngrok_js} }});
    }},
    setServerUrl: function (url) {{
      return invokeOrReject('set_server_url', {{ url: url }}).then(function () {{
        window.location.replace(url);
      }});
    }},
  }};

  Object.defineProperty(api, 'pickFolder', {{
    get: function () {{
      return inv() ? function (label, defaultPath) {{
        return invokeOrReject('pick_folder', {{ label: label, defaultPath: defaultPath }});
      }} : undefined;
    }}
  }});
  Object.defineProperty(api, 'createFolder', {{
    get: function () {{
      return inv() ? function (parentPath, folderName, subfolders) {{
        return invokeOrReject('create_folder', {{ parentPath: parentPath, folderName: folderName, subfolders: subfolders }});
      }} : undefined;
    }}
  }});

  window.electronAPI = api;
}})();
"#
    )
}

#[command]
fn get_server_info() -> serde_json::Value {
    let cfg = read_config();
    let current_url = cfg
        .url
        .as_deref()
        .filter(|url| is_allowed_server_url(url))
        .unwrap_or(DEFAULT_NGROK_URL);
    serde_json::json!({
        "defaultUrl":  LAN_URL,
        "currentUrl":  current_url,
        "ngrokUrl":    cfg.ngrok_url.as_deref().unwrap_or(DEFAULT_NGROK_URL),
    })
}

#[command]
fn set_server_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !is_allowed_server_url(&url) {
        return Err("Server URL is not allowed".to_string());
    }
    let mut cfg = read_config();
    if url != LAN_URL {
        cfg.ngrok_url = Some(url.clone());
    }
    cfg.url = Some(url);
    write_config(&cfg);

    if let Some(win) = app.get_webview_window("main") {
        let target_url = cfg.url.as_deref().unwrap_or(DEFAULT_NGROK_URL);
        let js_url = serde_json::to_string(target_url).map_err(|e| e.to_string())?;
        win.eval(&format!("window.location.replace({})", js_url))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
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

fn is_safe_relative_path(s: &str) -> bool {
    if s.is_empty() || s.contains('\0') {
        return false;
    }

    let path = Path::new(s);
    if path.is_absolute() {
        return false;
    }

    let mut has_normal_component = false;
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                if part.is_empty() {
                    return false;
                }
                has_normal_component = true;
            }
            _ => return false,
        }
    }
    has_normal_component
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
        if !is_safe_relative_path(sub) {
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
            let cfg = read_config();
            let current_url = get_url();
            let ngrok_url = cfg.ngrok_url.as_deref().unwrap_or(DEFAULT_NGROK_URL);
            let shim = build_shim(&current_url, ngrok_url);

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
