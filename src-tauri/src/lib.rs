//! dsh-desktop shell: create the window (splash), spawn the Node host sidecar,
//! navigate the WebView to the `dsh web:` loopback URL once the host reports
//! readiness, and terminate the host when the app exits.

mod host;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main webview window from tauri.conf.json");
            let manager = host::HostManager::spawn(app.handle().clone(), window);
            app.manage(manager);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building dsh-desktop")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(manager) = app_handle.try_state::<host::HostManager>() {
                    manager.stop();
                }
            }
        });
}
