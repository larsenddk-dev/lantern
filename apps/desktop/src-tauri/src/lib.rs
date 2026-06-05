use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Spawn the Lantern API sidecar on startup.
            // Tauri will manage its lifecycle and kill it when the app exits.
            let sidecar_command = app.shell().sidecar("lantern-api").unwrap();
            let (_rx, _child) = sidecar_command.spawn().expect("Failed to spawn lantern-api sidecar");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
