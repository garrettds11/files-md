mod tts;

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

const SETTINGS_FILE: &str = "files-md.settings.json";

#[derive(Serialize)]
struct MarkdownFile {
    path: String,
    name: String,
    dir: String,
    content: String,
    modified: u64,
}

/// Settings live next to the .exe (portable). If that folder isn't writable
/// (e.g. Program Files), fall back to the per-user config folder.
fn portable_settings_path() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.join(SETTINGS_FILE)))
}

fn fallback_settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(SETTINGS_FILE))
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Shared, in-process app state. All windows live in one process, so Rust
/// owns the settings and is the only writer of the settings file.
#[derive(Default)]
struct AppState {
    settings: Mutex<Option<Value>>,
    /// What each newly created window should open, keyed by window label.
    pending: Mutex<HashMap<String, OpenRequest>>,
    /// Label of the window the user used last; OS file opens go there.
    last_focused: Mutex<String>,
    next_window: AtomicU32,
}

#[derive(Serialize, serde::Deserialize, Clone, Default)]
struct OpenRequest {
    paths: Vec<String>,
    /// Scroll position and heading to restore (used when popping out a tab).
    #[serde(default)]
    scroll: f64,
    #[serde(default)]
    heading: Option<String>,
}

#[derive(Serialize, Clone)]
struct SettingsChanged {
    source: String,
    settings: Value,
}

/// Turn command-line arguments into absolute file paths.
fn paths_from_args(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(a);
            let p = if p.is_absolute() { p } else { cwd.join(p) };
            fs::canonicalize(&p)
                .map(|c| c.to_string_lossy().trim_start_matches(r"\\?\").to_string())
                .unwrap_or_else(|_| p.to_string_lossy().to_string())
        })
        .collect()
}

/// What this window should open on startup: the launch arguments for the
/// first window, or the request stored by `open_window` for later ones.
#[tauri::command]
fn initial_open(window: WebviewWindow, state: State<AppState>) -> Option<OpenRequest> {
    if let Some(req) = state.pending.lock().unwrap().remove(window.label()) {
        return Some(req);
    }
    if window.label() == "main" {
        let args: Vec<String> = std::env::args().collect();
        let cwd = std::env::current_dir().unwrap_or_default();
        let paths = paths_from_args(&args, &cwd);
        if !paths.is_empty() {
            return Some(OpenRequest { paths, ..Default::default() });
        }
    }
    None
}

/// Open a new app window, optionally with a file (used by "Move tab to new
/// window" and "New window"). Async: creating windows from a sync command
/// can deadlock on Windows.
#[tauri::command]
async fn open_window(app: AppHandle, state: State<'_, AppState>, request: Option<OpenRequest>) -> Result<String, String> {
    let label = format!("win-{}", state.next_window.fetch_add(1, Ordering::SeqCst) + 1);
    if let Some(req) = request {
        state.pending.lock().unwrap().insert(label.clone(), req);
    }
    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
        .title("Files.md")
        .inner_size(1180.0, 820.0)
        .min_inner_size(520.0, 360.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(label)
}

#[tauri::command]
fn read_markdown(path: String) -> Result<MarkdownFile, String> {
    let p = PathBuf::from(&path);
    let bytes = fs::read(&p).map_err(|e| format!("Couldn't open {path}: {e}"))?;
    let content = String::from_utf8_lossy(&bytes)
        .trim_start_matches('\u{feff}')
        .to_string();
    Ok(MarkdownFile {
        name: p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        dir: p
            .parent()
            .map(|d| d.to_string_lossy().to_string())
            .unwrap_or_default(),
        modified: modified_ms(&p),
        content,
        path,
    })
}

#[tauri::command]
fn file_modified(path: String) -> u64 {
    modified_ms(Path::new(&path))
}

fn read_settings_file(app: &AppHandle) -> Value {
    let candidates = [portable_settings_path(), fallback_settings_path(app)];
    for p in candidates.into_iter().flatten() {
        if let Ok(text) = fs::read_to_string(&p) {
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                if v.is_object() {
                    return v;
                }
            }
        }
    }
    Value::Object(Default::default())
}

fn write_settings_file(app: &AppHandle, settings: &Value) -> Result<String, String> {
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    if let Some(p) = portable_settings_path() {
        if fs::write(&p, &text).is_ok() {
            return Ok(p.to_string_lossy().to_string());
        }
    }
    let p = fallback_settings_path(app).ok_or("No writable settings location")?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&p, &text).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().to_string())
}

#[tauri::command]
fn load_settings(app: AppHandle, state: State<AppState>) -> Value {
    let mut guard = state.settings.lock().unwrap();
    guard.get_or_insert_with(|| read_settings_file(&app)).clone()
}

/// Merge the changed keys from one window into the shared settings, save
/// once, and tell every window about the new settings.
#[tauri::command]
fn update_settings(
    app: AppHandle,
    window: WebviewWindow,
    state: State<AppState>,
    changes: serde_json::Map<String, Value>,
) -> Result<String, String> {
    // The lock is held through the write so saves happen in order.
    let (merged, path) = {
        let mut guard = state.settings.lock().unwrap();
        let current = guard.get_or_insert_with(|| read_settings_file(&app));
        if let Value::Object(map) = current {
            for (k, v) in changes {
                map.insert(k, v);
            }
        }
        let path = write_settings_file(&app, current)?;
        (current.clone(), path)
    };
    let _ = app.emit(
        "settings-changed",
        SettingsChanged { source: window.label().to_string(), settings: merged },
    );
    Ok(path)
}

// ------------------------------------------------------------ external editors

fn env_path(var: &str, rest: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(|v| PathBuf::from(v).join(rest))
}

fn search_path(file: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|d| d.join(file))
        .find(|p| p.is_file())
}

/// Locate a known editor's executable. Returns None if it isn't installed.
fn find_editor(id: &str) -> Option<PathBuf> {
    let candidates: Vec<Option<PathBuf>> = match id {
        "notepad" => vec![
            env_path("SystemRoot", r"System32\notepad.exe"),
            Some(PathBuf::from("notepad.exe")),
        ],
        "vscode" => vec![
            env_path("LOCALAPPDATA", r"Programs\Microsoft VS Code\Code.exe"),
            env_path("ProgramFiles", r"Microsoft VS Code\Code.exe"),
            env_path("ProgramFiles(x86)", r"Microsoft VS Code\Code.exe"),
            // `code` on PATH lives in ...\Microsoft VS Code\bin\code.cmd
            search_path("code.cmd")
                .and_then(|p| p.parent()?.parent().map(|d| d.join("Code.exe"))),
        ],
        "notepadpp" => vec![
            env_path("ProgramFiles", r"Notepad++\notepad++.exe"),
            env_path("ProgramFiles(x86)", r"Notepad++\notepad++.exe"),
            search_path("notepad++.exe"),
        ],
        _ => vec![],
    };
    candidates.into_iter().flatten().find(|p| {
        // Bare names (notepad.exe) are resolved by Windows at launch.
        p.components().count() == 1 || p.is_file()
    })
}

/// Which of the known editors are installed on this PC.
#[tauri::command]
fn detect_editors() -> Vec<String> {
    ["notepad", "vscode", "notepadpp"]
        .iter()
        .filter(|id| find_editor(id).is_some())
        .map(|s| s.to_string())
        .collect()
}

/// Open `path` in the chosen editor. `editor` is notepad | vscode | notepadpp | custom.
#[tauri::command]
fn open_in_editor(path: String, editor: String, custom_path: Option<String>) -> Result<(), String> {
    let exe = if editor == "custom" {
        let c = custom_path.unwrap_or_default();
        if c.trim().is_empty() {
            return Err("No custom editor chosen. Pick one in Preferences.".into());
        }
        PathBuf::from(c.trim())
    } else {
        find_editor(&editor).ok_or_else(|| format!("Couldn't find {editor} on this PC. Choose another editor in Preferences."))?
    };
    std::process::Command::new(&exe)
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Couldn't start {}: {e}", exe.display()))
}

/// Open the system print dialog (includes "Save as PDF" / "Microsoft Print to PDF").
#[tauri::command]
fn print_page(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch (double-clicking another .md file)
        // hands its files to this process and exits.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = paths_from_args(&args, Path::new(&cwd));
            let state = app.state::<AppState>();
            let last = state.last_focused.lock().unwrap().clone();
            let window = app
                .get_webview_window(&last)
                .or_else(|| app.get_webview_window("main"))
                .or_else(|| app.webview_windows().into_values().next());
            if let Some(w) = window {
                let _ = w.unminimize();
                let _ = w.set_focus();
                if !paths.is_empty() {
                    let target = tauri::EventTarget::webview_window(w.label());
                    let _ = app.emit_to(target, "open-files", OpenRequest { paths, ..Default::default() });
                }
            }
        }))
        .manage(AppState { last_focused: Mutex::new("main".into()), ..Default::default() })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(true) = event {
                let state = window.state::<AppState>();
                *state.last_focused.lock().unwrap() = window.label().to_string();
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            initial_open,
            open_window,
            read_markdown,
            file_modified,
            load_settings,
            update_settings,
            detect_editors,
            open_in_editor,
            print_page,
            tts::tts_lookup,
            tts::tts_generate,
            tts::tts_voices,
            tts::tts_cache_info,
            tts::tts_cache_clear
        ])
        .run(tauri::generate_context!())
        .expect("error while running Files.md");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_skip_exe_and_flags_and_resolve_relative() {
        let cwd = std::env::temp_dir();
        let args = vec!["files-md.exe".to_string(), "--flag".to_string(), "notes.md".to_string()];
        let paths = paths_from_args(&args, &cwd);
        assert_eq!(paths.len(), 1);
        assert!(paths[0].ends_with("notes.md"));
        assert!(Path::new(&paths[0]).is_absolute());
    }
}
