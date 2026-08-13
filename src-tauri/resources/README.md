# resources/host

This directory is **assembled at build time** and gitignored:

- `main.mjs` — the Node host entry (source of truth: `../../host/main.mjs`)
- `node/` — the official Node.js runtime (`npm run host:fetch-node`)
- `node_modules/` — `@deepseek-ai/dsh` and its transitive dependencies
  (`npm run host:install`, then copied here by `npm run host:bundle`)

Run `npm run host:bundle` before `tauri build`/`tauri dev`; `build.rs` fails
with a clear message when this directory is missing.
