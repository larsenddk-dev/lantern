use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, RunEvent, State};

/// PIDs of all spawned sidecars so we can kill them cleanly on exit.
/// On Windows we use taskkill; on Unix we send SIGTERM via libc::kill().
#[derive(Default)]
struct Sidecars {
    lantern_api: Mutex<Option<u32>>,
    ollama: Mutex<Option<u32>>,
}

const OLLAMA_PORT: u16 = 11434;

// Windows: spawn child processes without flashing a console window. The
// PyInstaller sidecar (and Ollama) are console-subsystem binaries, so without
// this flag a black terminal pops up next to the app on every launch.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Apply the no-console-window creation flag on Windows; no-op elsewhere.
fn hide_console(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecars::default())
        .setup(|app| {
            let resource_dir = app
                .path()
                .resource_dir()
                .expect("failed to resolve resource_dir");
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app_data_dir");

            // 1. Local models run through Ollama. We do NOT bundle Ollama in
            //    the installer (it's ~3.5 GB and bloats download/build), so the
            //    common case is: the user has installed Ollama themselves and
            //    it's already serving on :11434 — we just talk to it. If a build
            //    *did* ship an Ollama binary as a resource (opt-in), spawn that.
            //    Either way this is best-effort: with no Ollama, cloud providers
            //    still work and Cookbook shows a "Download Ollama" prompt.
            if !is_port_in_use(OLLAMA_PORT) {
                match spawn_ollama(&resource_dir, &app_data_dir) {
                    Ok(Some(pid)) => {
                        let state: State<Sidecars> = app.state();
                        *state.ollama.lock().unwrap() = Some(pid);
                    }
                    Ok(None) => {
                        // No bundled Ollama binary present — expected. The user
                        // installs Ollama separately for local models.
                        eprintln!("No bundled Ollama; relying on a user-installed one");
                    }
                    Err(e) => {
                        // Present but failed to launch — non-fatal.
                        eprintln!("Failed to spawn bundled Ollama: {}", e);
                    }
                }
            } else {
                eprintln!("Port {} already in use; using existing Ollama", OLLAMA_PORT);
            }

            // 2. Spawn the FastAPI sidecar. Without this the UI has no
            //    backend, so a failure here is fatal.
            let api_pid = spawn_lantern_api(&resource_dir, &app_data_dir).unwrap_or_else(|e| {
                panic!("Failed to spawn lantern-api sidecar: {}", e)
            });
            let state: State<Sidecars> = app.state();
            *state.lantern_api.lock().unwrap() = Some(api_pid);

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                let state: State<Sidecars> = app_handle.state();
                let api_pid = state.lantern_api.lock().unwrap().take();
                let ollama_pid = state.ollama.lock().unwrap().take();
                if let Some(pid) = api_pid {
                    kill_pid(pid);
                }
                if let Some(pid) = ollama_pid {
                    kill_pid(pid);
                }
            }
        });
}

fn spawn_lantern_api(resource_dir: &PathBuf, app_data_dir: &PathBuf) -> std::io::Result<u32> {
    #[cfg(target_os = "windows")]
    let exe_name = "lantern-api.exe";
    #[cfg(not(target_os = "windows"))]
    let exe_name = "lantern-api";

    let exe_path = resource_dir.join("sidecar/lantern-api").join(exe_name);

    // Keep the user's database OUTSIDE the bundled resources. The sidecar binary
    // and its _internal/ dir get overwritten on every install/update, so a DB
    // stored next to it would be wiped. Point LANTERN_DB_PATH at the stable
    // per-user app data dir instead (uploads land next to it automatically).
    let db_dir = app_data_dir.join("data");
    std::fs::create_dir_all(&db_dir).ok();
    let db_path = db_dir.join("lantern.db");

    let mut cmd = Command::new(&exe_path);
    cmd.env("LANTERN_DB_PATH", &db_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = hide_console(&mut cmd).spawn()?;
    Ok(child.id())
}

/// Spawn a bundled Ollama if one was shipped as a resource. Returns Ok(None)
/// when no bundled binary exists (the default — Ollama isn't bundled), so the
/// caller can distinguish "nothing to start" from "tried and failed".
fn spawn_ollama(resource_dir: &PathBuf, app_data_dir: &PathBuf) -> std::io::Result<Option<u32>> {
    #[cfg(target_os = "windows")]
    let exe_name = "ollama.exe";
    #[cfg(not(target_os = "windows"))]
    let exe_name = "ollama";

    let exe_path = resource_dir.join("sidecar/ollama").join(exe_name);

    // Not bundled in standard builds — bail out quietly so we don't log a
    // spurious "file not found" on every launch.
    if !exe_path.exists() {
        return Ok(None);
    }

    // Store models inside Lantern's app data dir so we don't conflict with
    // any user-managed Ollama install at ~/.ollama, and so uninstalling
    // Lantern can clean up its own state cleanly.
    let models_dir = app_data_dir.join("ollama-models");
    std::fs::create_dir_all(&models_dir).ok();

    let mut cmd = Command::new(&exe_path);
    cmd.arg("serve")
        .env("OLLAMA_HOST", format!("127.0.0.1:{}", OLLAMA_PORT))
        .env("OLLAMA_MODELS", &models_dir)
        // Headless. Ollama otherwise tries to register a tray icon, etc.
        .env("OLLAMA_NEW_ENGINE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = hide_console(&mut cmd).spawn()?;
    Ok(Some(child.id()))
}

/// Best-effort check that a port is already taken. We use this to decide
/// whether to spawn our bundled Ollama or step aside for an existing one.
fn is_port_in_use(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_millis(200),
    )
    .is_ok()
}

#[cfg(unix)]
fn kill_pid(pid: u32) {
    unsafe {
        libc::kill(pid as i32, libc::SIGTERM);
    }
}

#[cfg(windows)]
fn kill_pid(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}
