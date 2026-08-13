/**
 * Download the official Node.js runtime (a v22.x release, matching the dsh
 * engines range `^22.19.0 || >=24.0.0`) for the current platform into
 * `src-tauri/resources/host/node/`. No-op when the runtime already exists.
 *
 * Env knobs:
 *   DSH_DESKTOP_SKIP_NODE   set to skip (dev: use system node)
 *   DSH_DESKTOP_NODE_ARCH   force arch: x64 | arm64 (macOS cross-target builds)
 */
import { cpSync, createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'

const root = fileURLToPath(new URL('..', import.meta.url))
const NODE_DIR = join(root, 'src-tauri', 'resources', 'host', 'node')
const NODE_INDEX = 'https://nodejs.org/dist/index.json'
const MIN_VERSION = [22, 19, 0]

function versionAtLeast(v, min) {
  const [a, b, c] = v.split('.').map(Number)
  return a > min[0] || (a === min[0] && (b > min[1] || (b === min[1] && c >= min[2])))
}

async function latestV22() {
  const res = await fetch(NODE_INDEX)
  if (!res.ok) throw new Error(`fetch ${NODE_INDEX} failed: ${res.status}`)
  const rows = await res.json()
  for (const row of rows) {
    if (typeof row.version !== 'string' || !row.version.startsWith('v22.')) continue
    const version = row.version.slice(1)
    if (versionAtLeast(version, MIN_VERSION)) return version
  }
  throw new Error(`no v22.x >= 22.19 found in ${NODE_INDEX}`)
}

function platformSpec(version, arch) {
  const base = `node-v${version}`
  switch (process.platform) {
    case 'win32':
      return { file: `${base}-win-x64.zip`, dir: `${base}-win-x64`, exe: 'node.exe', arch: 'x64' }
    case 'darwin': {
      const a = arch ?? (process.arch === 'arm64' ? 'arm64' : 'x64')
      return { file: `${base}-darwin-${a}.tar.gz`, dir: `${base}-darwin-${a}`, exe: 'bin/node', arch: a }
    }
    case 'linux':
      return { file: `${base}-linux-x64.tar.gz`, dir: `${base}-linux-x64`, exe: 'bin/node', arch: 'x64' }
    default:
      throw new Error(`unsupported platform: ${process.platform}`)
  }
}

async function download(url, dest) {
  mkdirSync(dirname(dest), { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download ${url} failed: ${res.status} ${res.statusText}`)
  await pipeline(res.body, createWriteStream(dest))
}

async function extract(archive, dir) {
  mkdirSync(dir, { recursive: true })
  if (process.platform === 'win32') {
    // PowerShell Expand-Archive: the sandbox-safe unzip on Windows.
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${dir}' -Force`,
    ], { stdio: 'inherit' })
  } else {
    execFileSync('tar', ['-xzf', archive, '-C', dir], { stdio: 'inherit' })
  }
}

async function main() {
  if (process.env.DSH_DESKTOP_SKIP_NODE !== undefined && process.env.DSH_DESKTOP_SKIP_NODE !== '') {
    console.log('[fetch-node] skipped (DSH_DESKTOP_SKIP_NODE)')
    return
  }
  const exe = process.platform === 'win32' ? 'node.exe' : 'node'
  if (existsSync(join(NODE_DIR, exe))) {
    console.log(`[fetch-node] runtime already present: ${join(NODE_DIR, exe)}`)
    return
  }
  const version = await latestV22()
  const spec = platformSpec(version, process.env.DSH_DESKTOP_NODE_ARCH)
  const url = `https://nodejs.org/dist/v${version}/${spec.file}`
  console.log(`[fetch-node] ${spec.file} (${spec.arch})`)
  const tmp = join(root, '.tmp-node')
  mkdirSync(tmp, { recursive: true })
  const archive = join(tmp, spec.file)
  await download(url, archive)
  await extract(archive, tmp)
  const extracted = join(tmp, spec.dir)
  mkdirSync(NODE_DIR, { recursive: true })
  cpSync(extracted, NODE_DIR, { recursive: true })
  rmSync(tmp, { recursive: true, force: true })
  const sizeMb = (statSync(join(NODE_DIR, exe)).size / 1024 / 1024).toFixed(1)
  console.log(`[fetch-node] runtime ready: ${join(NODE_DIR, exe)} (${sizeMb} MB)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
