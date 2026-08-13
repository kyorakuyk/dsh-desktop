fn main() {
    // Fail fast (instead of shipping an empty resource dir) when the bundled
    // host was not assembled: `npm run host:bundle` first.
    let candidates = [
        std::path::Path::new("resources/host/main.mjs"),
        std::path::Path::new("../host/main.mjs"),
    ];
    if !candidates.iter().any(|p| p.exists()) {
        panic!(
            "host bundle missing at resources/host/main.mjs — run `npm run host:bundle` \
             (assemble Node runtime + @deepseek-ai/dsh) before building"
        );
    }
    tauri_build::build()
}
