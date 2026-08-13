/**
 * Host boot smoke test (keyless): spawn the host entry, wait for the
 * `dsh web: http://127.0.0.1:<port>` URL line the web-app bundle prints once
 * the loader tree settles, GET the URL, assert the shell HTML is served, then
 * terminate the host and exit 0.
 *
 * Prefers the assembled bundle (`src-tauri/resources/host/`, the exact shipped
 * artifact) when present, falling back to the checkout's `host/` directory
 * (fast CI path that skips the Node download).
 *
 * Usage: node scripts/smoke-host.mjs   (from the repo root)
 * Env:   DSH_DESKTOP_SMOKE_TIMEOUT_MS  default 120000
 */
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const timeoutMs = Number(process.env.DSH_DESKTOP_SMOKE_TIMEOUT_MS ?? 120_000)

const bundled = join(root, 'src-tauri', 'resources', 'host')
const useBundled = existsSync(join(bundled, 'node_modules')) && existsSync(join(bundled, 'main.mjs'))
const nodeExe = process.platform === 'win32' ? 'node.exe' : 'node'
const nodeBin = useBundled ? join(bundled, 'node', nodeExe) : process.execPath
const hostEntry = useBundled ? join(bundled, 'main.mjs') : join(root, 'host', 'main.mjs')

const URL_LINE = /dsh web: (https?:\/\/127\.0\.0\.1:\d+)/

console.log(`[smoke] booting ${nodeBin} ${hostEntry} (${useBundled ? 'bundled' : 'checkout'} host, timeout ${timeoutMs} ms)`)
const child = spawn(nodeBin, [hostEntry], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DSH_DESKTOP_PORT: '0' },
  windowsHide: true,
})

let stdout = ''
let stderr = ''
let url
const deadline = Date.now() + timeoutMs

const timer = setTimeout(() => {
  console.error(`[smoke] timed out after ${timeoutMs} ms`)
  child.kill()
  process.exit(1)
}, timeoutMs)

child.stdout.on('data', (chunk) => {
  stdout += chunk.toString()
  process.stdout.write(chunk)
  const match = URL_LINE.exec(stdout)
  if (match !== null && url === undefined) {
    url = match[1]
    console.log(`[smoke] host URL: ${url}`)
  }
})
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString()
  process.stderr.write(chunk)
})
child.on('exit', (code, signal) => {
  if (url === undefined && Date.now() < deadline) {
    console.error(`[smoke] host exited before printing the URL (code=${code} signal=${signal})`)
    process.exit(1)
  }
})

async function waitForUrl() {
  while (url === undefined) {
    if (Date.now() > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return true
}

if (!(await waitForUrl())) {
  console.error('[smoke] never saw the `dsh web:` URL line')
  child.kill()
  process.exit(1)
}

// The URL line prints before every sibling route (the /api owner) has mounted,
// so probe for the index page with retries.
let lastError
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const res = await fetch(url)
    const body = await res.text()
    if (res.ok && body.includes('<div id="root">')) {
      console.log(`[smoke] index served: HTTP ${res.status}, shell HTML present`)
      clearTimeout(timer)
      child.kill()
      await new Promise((resolve) => setTimeout(resolve, 500))
      console.log('[smoke] OK')
      process.exit(0)
    }
    lastError = `HTTP ${res.status}, unexpected body`
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
  }
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
console.error(`[smoke] index probe failed: ${lastError}`)
child.kill()
process.exit(1)
