//! Postglow's native side is small on purpose: it keeps the window and a menu-bar icon alive so the
//! hourly read can go on, stores one file per account (plus prefs.json) in the app's data folder, and opens links in the
//! default browser. Reading X (through FxTwitter) and every number on the page happen in the page.
//! Updates come from the GitHub release's latest.json, signed with Postglow's own updater key.

use std::fs;
use std::path::PathBuf;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_updater::UpdaterExt;

/// Passed by the login item, so a start at login stays in the menu bar.
const HIDDEN_ARG: &str = "--hidden";

const LEGACY_STATE: &str = "state.json";
const LEGACY_BACKUP: &str = "state.v1.backup.json";
const ACCOUNTS_DIR: &str = "accounts";
const PREFS_FILE: &str = "prefs.json";
const MAX_STATE_BYTES: usize = 16 * 1024 * 1024;

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join(ACCOUNTS_DIR)).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// An X handle is 1–15 letters, digits or underscores; its file name is the lowercase handle.
fn account_path(app: &AppHandle, handle: &str) -> Result<PathBuf, String> {
    let valid = !handle.is_empty() && handle.len() <= 15 && handle.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !valid {
        return Err("invalid account".into());
    }
    Ok(data_dir(app)?.join(ACCOUNTS_DIR).join(format!("{}.json", handle.to_ascii_lowercase())))
}

fn read_or_empty(path: PathBuf) -> Result<String, String> {
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Write JSON through a temporary file, so a crash never leaves half a file.
fn write_json(path: PathBuf, json: &str) -> Result<(), String> {
    if json.len() > MAX_STATE_BYTES {
        return Err("state too large".into());
    }
    serde_json::from_str::<serde_json::Value>(json).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())
}

/// 0.1.x kept one account in state.json; move it to accounts/<handle>.json once and keep the original as a backup.
fn migrate_legacy(app: &AppHandle) -> Result<(), String> {
    let dir = data_dir(app)?;
    let legacy = dir.join(LEGACY_STATE);
    if !legacy.exists() {
        return Ok(());
    }
    let text = fs::read_to_string(&legacy).map_err(|e| e.to_string())?;
    let state: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if let Some(account) = state.get("account").and_then(|a| a.as_str()).filter(|a| !a.is_empty()) {
        let target = account_path(app, account)?;
        if !target.exists() {
            write_json(target, &text)?;
        }
        let prefs = dir.join(PREFS_FILE);
        if !prefs.exists() {
            let look = state.pointer("/settings/look").cloned().unwrap_or(serde_json::Value::Null);
            write_json(prefs, &serde_json::json!({ "current": account, "look": look }).to_string())?;
        }
    }
    fs::rename(&legacy, dir.join(LEGACY_BACKUP)).map_err(|e| e.to_string())
}

/// Every saved account (lowercase handles).
#[tauri::command]
fn list_accounts(app: AppHandle) -> Result<Vec<String>, String> {
    let mut handles: Vec<String> = fs::read_dir(data_dir(&app)?.join(ACCOUNTS_DIR))
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok()?.strip_suffix(".json").map(str::to_string))
        .collect();
    handles.sort();
    Ok(handles)
}

/// One account's stored state as JSON text, or an empty string if there is none.
#[tauri::command]
fn load_account(app: AppHandle, handle: String) -> Result<String, String> {
    read_or_empty(account_path(&app, &handle)?)
}

#[tauri::command]
fn save_account(app: AppHandle, handle: String, json: String) -> Result<(), String> {
    write_json(account_path(&app, &handle)?, &json)
}

#[tauri::command]
fn delete_account(app: AppHandle, handle: String) -> Result<(), String> {
    let path = account_path(&app, &handle)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// App-wide choices (current account, look) as JSON text, or an empty string.
#[tauri::command]
fn load_prefs(app: AppHandle) -> Result<String, String> {
    read_or_empty(data_dir(&app)?.join(PREFS_FILE))
}

#[tauri::command]
fn save_prefs(app: AppHandle, json: String) -> Result<(), String> {
    write_json(data_dir(&app)?.join(PREFS_FILE), &json)
}

/// Open an https link (a post on X) in the default browser.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("only https links".into());
    }
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let program = "xdg-open";
    std::process::Command::new(program).arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct UpdateInfo {
    current: String,
    latest: Option<String>,
    notes: Option<String>,
}

/// Ask the release feed whether a newer version exists.
#[tauri::command]
async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(UpdateInfo {
        current,
        latest: update.as_ref().map(|u| u.version.clone()),
        notes: update.and_then(|u| u.body),
    })
}

/// Download the newer version, check its signature, replace this app and start it again.
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "已经是最新版本".to_string())?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart()
}

/// Hide the window and the Dock icon; the menu-bar icon stays and the hourly read goes on.
#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

/// Quit for real: no window, no menu-bar icon, no reading until Postglow is opened again.
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Whether Postglow starts (in the menu bar) when the user logs in.
#[tauri::command]
fn autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    result.map_err(|e| e.to_string())
}

fn show_main(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![HIDDEN_ARG])))
        .invoke_handler(tauri::generate_handler![
            list_accounts, load_account, save_account, delete_account, load_prefs, save_prefs, open_url, check_update, install_update, hide_window, quit_app, autostart_enabled, set_autostart])
        .setup(|app| {
            if let Err(error) = migrate_legacy(app.handle()) {
                eprintln!("Postglow: could not move state.json into accounts/: {error}");
            }
            // The window starts hidden; show it unless this is the quiet start at login.
            if std::env::args().any(|arg| arg == HIDDEN_ARG) {
                #[cfg(target_os = "macos")]
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            } else {
                show_main(app.handle());
            }
            let show = MenuItem::with_id(app, "show", "显示 Postglow", true, None::<&str>)?;
            let update = MenuItem::with_id(app, "update", "检查更新…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &update, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(false)
                .tooltip("Postglow")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "update" => {
                        show_main(app);
                        let _ = app.emit("check-update", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // The page decides what closing means (stay in the menu bar, or quit), asking the first time.
            // ⌘Q still quits right away.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Postglow")
        .run(|app, event| {
            // Clicking the Dock icon, or opening Postglow again from Finder, brings the window back.
            if let RunEvent::Reopen { .. } = event {
                show_main(app);
            }
        });
}
