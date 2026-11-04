//! Postglow's native side is small on purpose: it keeps the window and a menu-bar icon alive so the
//! hourly read can go on, stores the one state file in the app's data folder, and opens links in the
//! default browser. Reading X (through FxTwitter) and every number on the page happen in the page.

use std::fs;
use std::path::PathBuf;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

const STATE_FILE: &str = "state.json";
const MAX_STATE_BYTES: usize = 16 * 1024 * 1024;

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(STATE_FILE))
}

/// The stored state as JSON text, or an empty string before the first save.
#[tauri::command]
fn load_state(app: AppHandle) -> Result<String, String> {
    let path = state_path(&app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Write the state through a temporary file, so a crash never leaves half a file.
#[tauri::command]
fn save_state(app: AppHandle, json: String) -> Result<(), String> {
    if json.len() > MAX_STATE_BYTES {
        return Err("state too large".into());
    }
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?;
    let path = state_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())
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

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![load_state, save_state, open_url])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "显示 Postglow", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(false)
                .tooltip("Postglow")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps the app in the menu bar, so the hourly read goes on.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Postglow")
        .run(|app, event| {
            // Clicking the Dock icon brings the window back.
            if let RunEvent::Reopen { .. } = event {
                show_main(app);
            }
        });
}
