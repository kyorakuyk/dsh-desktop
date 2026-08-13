/**
 * Assemble the bundled host under `src-tauri/resources/host/` (gitignored):
 *
 *   host/main.mjs        the host entry (copied from ./host)
 *   host/node/           the official Node runtime (see fetch-node.mjs)
 *   host/node_modules/   @deepseek-ai/dsh + transitive deps (npm-installed)
 *
 * Run `npm run host:install` first so `host/node_modules` exists.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const srcHost = join(root, 'host')
const outHost = join(root, 'src-tauri', 'resources', 'host')
const nodeExe = process.platform === 'win32' ? 'node.exe' : 'node'

function sizeMb(dir) {
  let total = 0
  const walk = (p) => {
    for (const entry of readdirSync(p)) {
      const full = join(p, entry)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else total += st.size
    }
  }
  walk(dir)
  return (total / 1024 / 1024).toFixed(1)
}

function fail(message) {
  console.error(`[bundle-host] ${message}`)
  process.exit(1)
}

if (!existsSync(join(srcHost, 'node_modules'))) {
  fail('host/node_modules missing — run `npm run host:install` first')
}

mkdirSync(outHost, { recursive: true })

// 1. Host entry.
cpSync(join(srcHost, 'main.mjs'), join(outHost, 'main.mjs'))

// 2. Node runtime.
if (process.env.DSH_DESKTOP_SKIP_NODE !== undefined && process.env.DSH_DESKTOP_SKIP_NODE !== '') {
  if (!existsSync(join(outHost, 'node', nodeExe))) {
    fail('node runtime missing and DSH_DESKTOP_SKIP_NODE is set — run `npm run host:fetch-node` or unset the env')
  }
} else {
  const { execFileSync } = await import('node:child_process')
  execFileSync(process.execPath, [join(root, 'scripts', 'fetch-node.mjs')], { stdio: 'inherit' })
  if (!existsSync(join(outHost, 'node', nodeExe))) {
    fail('node runtime still missing after fetch-node — check scripts/fetch-node.mjs')
  }
}

// 3. Dependencies (copy, never symlink: pnpm's hoisted layout is real dirs +
// hardlinks, which copy to real files). .pnpm is pnpm's internal store — node
// resolution never enters it under the hoisted linker, so it is dropped to
// halve the bundle. Top-level dotfiles (.bin shims, metadata) go too.
const SKIP_SEGMENTS = ['.pnpm', '.bin', '.modules.yaml', '.package-map.json', '.pnpm-workspace-state-v1.json']
if (existsSync(join(outHost, 'node_modules'))) {
  // Fresh copy every run so removed packages never linger in the bundle.
  const { rmSync } = await import('node:fs')
  rmSync(join(outHost, 'node_modules'), { recursive: true, force: true })
}
cpSync(join(srcHost, 'node_modules'), join(outHost, 'node_modules'), {
  recursive: true,
  filter: (src) => !SKIP_SEGMENTS.some((segment) => src.split(/[\\/]/).includes(segment)),
})

console.log(`[bundle-host] assembled ${outHost}`)
console.log(`[bundle-host]   node runtime : ${sizeMb(join(outHost, 'node'))} MB`)
console.log(`[bundle-host]   node_modules : ${sizeMb(join(outHost, 'node_modules'))} MB`)
