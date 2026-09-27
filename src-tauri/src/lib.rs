use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};

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

/// The file Windows passed on launch ("Open with", double-click, drag onto exe).
#[tauri::command]
fn initial_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(&a);
            fs::canonicalize(&p)
                .map(|c| c.to_string_lossy().trim_start_matches(r"\\?\").to_string())
                .unwrap_or(a)
        })
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

#[tauri::command]
fn load_settings(app: AppHandle) -> Value {
    let candidates = [portable_settings_path(), fallback_settings_path(&app)];
    for p in candidates.into_iter().flatten() {
        if let Ok(text) = fs::read_to_string(&p) {
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                return v;
            }
        }
    }
    Value::Object(Default::default())
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Value) -> Result<String, String> {
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    if let Some(p) = portable_settings_path() {
        if fs::write(&p, &text).is_ok() {
            return Ok(p.to_string_lossy().to_string());
        }
    }
    let p = fallback_settings_path(&app).ok_or("No writable settings location")?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&p, &text).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            initial_file,
            read_markdown,
            file_modified,
            load_settings,
            save_settings,
            detect_editors,
            open_in_editor
        ])
        .run(tauri::generate_context!())
        .expect("error while running Files.md");
}
