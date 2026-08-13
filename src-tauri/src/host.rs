//! Node host sidecar lifecycle.
//!
//! The bundled host lives under `resources/host/` inside the app resource
//! directory (`main.mjs` + a Node runtime + `node_modules` with
//! `@deepseek-ai/dsh`). We spawn `node main.mjs`, watch stdout for the
//! `dsh web: http://127.0.0.1:<port>` line the web-app bundle prints after the
//! loader tree settles, and navigate the WebView there. Logs from both streams
//! are forwarded through the `log` facade (tauri-plugin-log).

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::{AppHandle, Manager, Url, WebviewWindow};

/// Owns the host child process; `stop()` is called on app exit.
pub struct HostManager {
    child: Mutex<Option<Child>>,
}

impl HostManager {
    /// Locate the bundled host and spawn it. Returns a manager even when the
    /// spawn failed (the window stays on the splash; logs explain why).
    pub fn spawn(app: AppHandle, window: WebviewWindow) -> Self {
        let host_dirs = resolve_host_dirs(&app);
        let Some(host_dir) = host_dirs.iter().find(|dir| dir.join("main.mjs").exists()) else {
            log::error!(
                "[host] bundled host missing under any of: {}",
                host_dirs.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", ")
            );
            return Self { child: Mutex::new(None) };
        };
        let node = strip_verbatim_prefix(host_node_binary(host_dir));
        let entry = strip_verbatim_prefix(host_dir.join("main.mjs"));
        let workspace = ensure_workspace_dir();
        log::info!(
            "[host] spawn node={} entry={} cwd={}",
            node.display(),
            entry.display(),
            workspace.display()
        );

        let mut cmd = Command::new(&node);
        cmd.arg(entry)
            .current_dir(&workspace)
            .env("DSH_DESKTOP_PORT", "0")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // No console window on Windows (WebView2 app shell).
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(error) => {
                log::error!("[host] failed to spawn {node:?} main.mjs: {error}");
                return Self { child: Mutex::new(None) };
            }
        };
        let stdout = child.stdout.take().expect("piped host stdout");
        let stderr = child.stderr.take().expect("piped host stderr");
        let manager = Self { child: Mutex::new(Some(child)) };

        // stderr reader: forward everything (harness logs, boot errors).
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                log::info!("[host] {line}");
            }
        });

        // stdout reader: forward, and navigate the WebView on the URL line.
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                log::info!("[host] {line}");
                if let Some(url) = parse_url_line(&line) {
                    match Url::parse(&url) {
                        Ok(url) => {
                            log::info!("[host] navigating to {url}");
                            if let Err(error) = window.navigate(url) {
                                log::error!("[host] navigate failed: {error}");
                            }
                        }
                        Err(error) => log::error!("[host] malformed URL line: {error}"),
                    }
                }
            }
        });

        manager
    }

    /// Terminate the host process (hard kill; the harness persists its own
    /// state on disk, so no graceful shutdown is required).
    pub fn stop(&self) {
        if let Some(mut child) = self.child.lock().expect("host child lock").take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Candidate host roots: bundled resource layouts (prod + dev) and the source tree.
fn resolve_host_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        dirs.push(resource_dir.join("host"));
        dirs.push(resource_dir.join("resources").join("host"));
    }
    // Dev fallback: the checkout's assembled resources (npm run host:bundle).
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("host"));
    dirs
}

/// The bundled Node binary, or a fallback to `node` on PATH (dev convenience).
fn host_node_binary(host_dir: &Path) -> PathBuf {
    let bundled = if cfg!(windows) {
        host_dir.join("node").join("node.exe")
    } else {
        host_dir.join("node").join("bin").join("node")
    };
    if bundled.exists() {
        bundled
    } else {
        PathBuf::from("node")
    }
}

/// Tauri returns resource paths with the Windows extended-length prefix
/// (`\\?\C:\...`). Node's module loader does not understand that prefix and
/// mangles it down to the bare drive letter, so child-process paths must be
/// plain `C:\...` form.
fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    if cfg!(windows) {
        if let Some(rest) = path.to_string_lossy().strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path
}

/// The dsh working directory for desktop sessions: `$DSH_HOME/workspace`
/// (harness default home is `~/.dsh`). Created when missing.
fn ensure_workspace_dir() -> PathBuf {
    let home = std::env::var_os("DSH_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".dsh")))
        .unwrap_or_else(|| PathBuf::from("."));
    let workspace = home.join("workspace");
    if let Err(error) = std::fs::create_dir_all(&workspace) {
        log::warn!("[host] cannot create workspace dir {workspace:?}: {error}");
    }
    workspace
}

/// Extract `http://127.0.0.1:<port>` from the host's `dsh web: <url>` line.
fn parse_url_line(line: &str) -> Option<String> {
    const PREFIX: &str = "dsh web: http://127.0.0.1:";
    let trimmed = line.trim();
    let start = trimmed.find(PREFIX)?;
    let rest = &trimmed[start + PREFIX.len()..];
    let port: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if port.is_empty() {
        return None;
    }
    Some(format!("http://127.0.0.1:{port}"))
}

#[cfg(test)]
mod tests {
    use super::parse_url_line;

    #[test]
    fn parses_the_url_line() {
        assert_eq!(
            parse_url_line("dsh web: http://127.0.0.1:3080"),
            Some("http://127.0.0.1:3080".to_string())
        );
        assert_eq!(
            parse_url_line("dsh web: http://127.0.0.1:41237 (LAN: http://192.168.1.2:41237)"),
            Some("http://127.0.0.1:41237".to_string())
        );
    }

    #[test]
    fn ignores_other_lines() {
        assert_eq!(parse_url_line("some other log line"), None);
        assert_eq!(parse_url_line("dsh web: http://0.0.0.0:3080"), None);
        assert_eq!(parse_url_line(""), None);
    }
}
