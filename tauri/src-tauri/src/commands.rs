use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct AppConfig {
    pub server_url: String,
    pub vault_path: String,
    pub vimrc_path: String,
}

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub r#type: String, // "file" or "dir"
    pub children: Option<Vec<FileEntry>>,
}

fn get_vault_path() -> PathBuf {
    // Default to ~/notes, configurable later
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("notes")
}

fn get_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("md-notes")
}

#[tauri::command]
pub fn get_config() -> AppConfig {
    let vault = get_vault_path();
    let config_dir = get_config_dir();
    AppConfig {
        server_url: "http://localhost:8080".to_string(),
        vault_path: vault.to_string_lossy().to_string(),
        vimrc_path: config_dir.join("vimrc").to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub fn read_local_file(path: String) -> Result<String, String> {
    let vault = get_vault_path();
    let full_path = vault.join(&path);
    // Validate path stays within vault
    let canonical = full_path
        .canonicalize()
        .map_err(|e| format!("Path error: {}", e))?;
    let vault_canonical = vault
        .canonicalize()
        .map_err(|e| format!("Vault error: {}", e))?;
    if !canonical.starts_with(&vault_canonical) {
        return Err("Path traversal denied".to_string());
    }
    fs::read_to_string(&canonical).map_err(|e| format!("Read error: {}", e))
}

#[tauri::command]
pub fn write_local_file(path: String, content: String) -> Result<(), String> {
    let vault = get_vault_path();
    let full_path = vault.join(&path);
    // Create parent dirs
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Dir error: {}", e))?;
    }
    fs::write(&full_path, &content).map_err(|e| format!("Write error: {}", e))
}

#[tauri::command]
pub fn list_local_files() -> Result<Vec<FileEntry>, String> {
    let vault = get_vault_path();
    if !vault.exists() {
        fs::create_dir_all(&vault).map_err(|e| format!("Create vault error: {}", e))?;
    }
    walk_dir(&vault, &vault)
}

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
