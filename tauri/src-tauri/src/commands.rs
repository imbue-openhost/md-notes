use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

// ── Config types ─────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct VaultConfig {
    pub id: String,
    pub name: String,
    pub path: String,
    pub sync: bool,
}

#[derive(Serialize, Deserialize, Default)]
pub struct SavedConfig {
    #[serde(default)]
    pub server_url: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub vaults: Vec<VaultConfig>,
    #[serde(default)]
    pub last_vault_id: Option<String>,
    /// Legacy field — migrated to vaults on first read.
    #[serde(default, skip_serializing)]
    pub vault_path: Option<String>,
}

#[derive(Serialize)]
pub struct AppConfig {
    pub server_url: String,
    pub api_key: String,
    pub vaults: Vec<VaultConfig>,
    pub last_vault_id: Option<String>,
}

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub r#type: String, // "file" or "dir"
    pub children: Option<Vec<FileEntry>>,
}

// ── Helpers ──────────────────────────────────────────────────────────────

fn config_file_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".md_notes")
        .join("config.json")
}

fn load_saved_config() -> SavedConfig {
    let path = config_file_path();
    if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        SavedConfig::default()
    }
}

fn write_saved_config(config: &SavedConfig) -> Result<(), String> {
    let path = config_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {}", e))?;
    }
    let json =
        serde_json::to_string_pretty(config).map_err(|e| format!("Serialize error: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Write error: {}", e))
}

fn generate_vault_id(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    SystemTime::now().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn md_notes_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".md_notes")
}

fn vimrc_path() -> PathBuf {
    md_notes_dir().join(".vimrc")
}

const DEFAULT_VIMRC: &str = include_str!("../../../frontend/src/default.vimrc");

fn validate_path(vault_root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let full_path = vault_root.join(rel_path);
    let canonical = full_path
        .canonicalize()
        .map_err(|e| format!("Path error: {}", e))?;
    let vault_canonical = vault_root
        .canonicalize()
        .map_err(|e| format!("Vault error: {}", e))?;
    if !canonical.starts_with(&vault_canonical) {
        return Err("Path traversal denied".to_string());
    }
    Ok(canonical)
}

// ── Config commands ──────────────────────────────────────────────────────

#[tauri::command]
pub fn get_config() -> AppConfig {
    let mut saved = load_saved_config();

    // Migrate legacy vault_path → vaults list
    if saved.vaults.is_empty() {
        if let Some(ref vp) = saved.vault_path {
            if !vp.is_empty() {
                let vault = VaultConfig {
                    id: generate_vault_id(vp),
                    name: "Notes".to_string(),
                    path: vp.clone(),
                    sync: true,
                };
                saved.last_vault_id = Some(vault.id.clone());
                saved.vaults.push(vault);
                let _ = write_saved_config(&saved);
            }
        }
    }

    AppConfig {
        server_url: saved.server_url.unwrap_or_default(),
        api_key: saved.api_key.unwrap_or_default(),
        vaults: saved.vaults,
        last_vault_id: saved.last_vault_id,
    }
}

#[tauri::command]
pub fn get_vimrc() -> Result<String, String> {
    let path = vimrc_path();
    if !path.exists() {
        // Write default vimrc on first startup
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Dir error: {}", e))?;
        }
        fs::write(&path, DEFAULT_VIMRC).map_err(|e| format!("Write error: {}", e))?;
    }
    fs::read_to_string(&path).map_err(|e| format!("Read error: {}", e))
}

#[tauri::command]
pub fn save_config(server_url: Option<String>, api_key: Option<String>) -> Result<(), String> {
    let mut saved = load_saved_config();
    saved.server_url = server_url;
    saved.api_key = api_key;
    write_saved_config(&saved)
}

// ── Vault management commands ────────────────────────────────────────────

#[tauri::command]
pub fn add_vault(name: String, path: String, sync: bool) -> Result<VaultConfig, String> {
    let mut saved = load_saved_config();
    let vault = VaultConfig {
        id: generate_vault_id(&path),
        name,
        path,
        sync,
    };
    saved.vaults.push(vault.clone());
    saved.last_vault_id = Some(vault.id.clone());
    write_saved_config(&saved)?;
    Ok(vault)
}

#[tauri::command]
pub fn remove_vault(id: String) -> Result<(), String> {
    let mut saved = load_saved_config();
    saved.vaults.retain(|v| v.id != id);
    if saved.last_vault_id.as_deref() == Some(&id) {
        saved.last_vault_id = saved.vaults.first().map(|v| v.id.clone());
    }
    write_saved_config(&saved)
}

#[tauri::command]
pub fn set_last_vault(id: String) -> Result<(), String> {
    let mut saved = load_saved_config();
    saved.last_vault_id = Some(id);
    write_saved_config(&saved)
}

// ── Local file commands ──────────────────────────────────────────────────

#[tauri::command]
pub fn list_local_files(vault_path: String) -> Result<Vec<FileEntry>, String> {
    let vault = PathBuf::from(&vault_path);
    if !vault.exists() {
        fs::create_dir_all(&vault).map_err(|e| format!("Create vault error: {}", e))?;
    }
    walk_dir(&vault, &vault)
}

#[tauri::command]
pub fn read_local_file(vault_path: String, path: String) -> Result<String, String> {
    let vault = PathBuf::from(&vault_path);
    let canonical = validate_path(&vault, &path)?;
    fs::read_to_string(&canonical).map_err(|e| format!("Read error: {}", e))
}

#[tauri::command]
pub fn write_local_file(vault_path: String, path: String, content: String) -> Result<(), String> {
    let vault = PathBuf::from(&vault_path);
    let full_path = vault.join(&path);
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Dir error: {}", e))?;
    }
    fs::write(&full_path, &content).map_err(|e| format!("Write error: {}", e))
}

#[tauri::command]
pub fn create_local_file(
    vault_path: String,
    path: String,
    content: String,
    file_type: String,
) -> Result<(), String> {
    let vault = PathBuf::from(&vault_path);
    let full_path = vault.join(&path);
    if file_type == "dir" {
        fs::create_dir_all(&full_path).map_err(|e| format!("Dir error: {}", e))
    } else {
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Dir error: {}", e))?;
        }
        fs::write(&full_path, &content).map_err(|e| format!("Write error: {}", e))
    }
}

#[tauri::command]
pub fn rename_local_file(
    vault_path: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let vault = PathBuf::from(&vault_path);
    let src = vault.join(&old_path);
    let dst = vault.join(&new_path);
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Dir error: {}", e))?;
    }
    fs::rename(&src, &dst).map_err(|e| format!("Rename error: {}", e))
}

#[tauri::command]
pub fn delete_local_file(vault_path: String, path: String) -> Result<(), String> {
    let vault = PathBuf::from(&vault_path);
    let canonical = validate_path(&vault, &path)?;
    if canonical.is_dir() {
        fs::remove_dir(&canonical).map_err(|e| format!("Delete error: {}", e))
    } else {
        fs::remove_file(&canonical).map_err(|e| format!("Delete error: {}", e))
    }
}

// ── Directory walker ─────────────────────────────────────────────────────

fn walk_dir(dir: &Path, root: &Path) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    let items = fs::read_dir(dir).map_err(|e| format!("Read dir error: {}", e))?;

    let mut items: Vec<_> = items
        .filter_map(|e| e.ok())
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .collect();
    items.sort_by(|a, b| {
        let a_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        b_dir.cmp(&a_dir).then(a.file_name().cmp(&b.file_name()))
    });

    for item in items {
        let name = item.file_name().to_string_lossy().to_string();
        let rel_path = item
            .path()
            .strip_prefix(root)
            .unwrap_or(&item.path())
            .to_string_lossy()
            .to_string();
        let ft = item.file_type().map_err(|e| format!("Type error: {}", e))?;

        if ft.is_dir() {
            let children = walk_dir(&item.path(), root)?;
            entries.push(FileEntry {
                name,
                path: rel_path,
                r#type: "dir".to_string(),
                children: Some(children),
            });
        } else if name.ends_with(".md") {
            entries.push(FileEntry {
                name,
                path: rel_path,
                r#type: "file".to_string(),
                children: None,
            });
        }
    }

    Ok(entries)
}
