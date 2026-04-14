// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let settings = MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;
            let switch_vault = MenuItemBuilder::with_id("switch_vault", "Switch Vault...")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, "md-notes")
                .about(None)
                .separator()
                .item(&settings)
                .item(&switch_vault)
                .separator()
                .quit()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&edit_menu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app, event| {
                let id = event.id().0.as_str();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit(id, ());
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::get_vimrc,
            commands::add_vault,
            commands::remove_vault,
            commands::set_last_vault,
            commands::list_local_files,
            commands::read_local_file,
            commands::write_local_file,
            commands::create_local_file,
            commands::rename_local_file,
            commands::delete_local_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
