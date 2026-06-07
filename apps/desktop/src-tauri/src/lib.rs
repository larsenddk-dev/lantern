use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, RunEvent, State};

/// Holds the PID of the spawned sidecar so we can kill it cleanly on exit.
/// On Windows, killing the process tree requires the PID; on Unix we send
/// SIGTERM via libc::kill().
struct SidecarPid(Mutex<Option<u32>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarPid(Mutex::new(None)))
        .setup(|app| {
            // Resolve the sidecar resource path. With --onedir, PyInstaller
            // emits a directory containing the launcher exe + an _internal/
            // sibling holding all dependencies. The whole directory is bundled
            // as a Tauri resource (see tauri.conf.json -> bundle.resources).
            let resource_dir = app
                .path()
                .resource_dir()
                .expect("failed to resolve resource_dir");

            // Per-platform exe name. PyInstaller writes `lantern-api` on
            // macOS/Linux and `lantern-api.exe` on Windows.
            #[cfg(target_os = "windows")]
            let exe_name = "lantern-api.exe";
            #[cfg(not(target_os = "windows"))]
            let exe_name = "lantern-api";

            let exe_path = resource_dir.join("sidecar/lantern-api").join(exe_name);

            // Spawn the sidecar. We detach stdio so the parent app's stdout
            // isn't polluted, and stash the PID so the exit handler can clean
            // up. If the spawn fails (missing resources), surface it loudly
            // so the user gets a real error rather than a silent backend.
            let child = Command::new(&exe_path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap_or_else(|e| {
                    panic!(
                        "Failed to spawn lantern-api sidecar at {}: {}",
                        exe_path.display(),
                        e
                    )
                });

            let state: State<SidecarPid> = app.state();
            *state.0.lock().unwrap() = Some(child.id());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Make sure the sidecar dies with the app — otherwise a stray
            // lantern-api keeps holding port 8000 and the next launch fails.
            if let RunEvent::ExitRequested { .. } = event {
                let state: State<SidecarPid> = app_handle.state();
                let pid = state.0.lock().unwrap().take();
                if let Some(pid) = pid {
                    kill_pid(pid);
                }
            }
        });
}

#[cfg(unix)]
fn kill_pid(pid: u32) {
    // SIGTERM gives uvicorn a chance to flush; the OS reaps it shortly after.
    unsafe {
        libc::kill(pid as i32, libc::SIGTERM);
    }
}

#[cfg(windows)]
fn kill_pid(pid: u32) {
    // taskkill is the most reliable cross-Windows-version way to end a
    // process tree. /T includes children, /F forces if needed.
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}
