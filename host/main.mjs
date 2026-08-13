#!/usr/bin/env node
/**
 * dsh-desktop host entry.
 *
 * Boots the DeepSeek Harness web profile inside THIS process, exactly like
 * `dsh web --port 0`, and stays alive with it. The Rust shell spawns this file
 * with the bundled Node runtime, watches stdout for the `dsh web: <url>` line
 * the web-app bundle prints after the loader tree settles, and points the
 * WebView at that URL.
 *
 * The dsh bin is self-executing: importing `lib/bin.js` parses `process.argv`
 * and runs the resolved profile. We re-point argv at the bin so commander sees
 * only our web arguments.
 *
 * Env knobs:
 *   DSH_DESKTOP_PORT            listen port (default 0 = OS-assigned)
 *   DSH_DESKTOP_TRUSTED_HOSTS   comma-separated extra --trusted-host entries
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const bin = require.resolve('@deepseek-ai/dsh/lib/bin.js')

const args = ['web', '--port', process.env.DSH_DESKTOP_PORT ?? '0']
if (process.env.DSH_DESKTOP_TRUSTED_HOSTS !== undefined) {
  for (const entry of process.env.DSH_DESKTOP_TRUSTED_HOSTS.split(',')) {
    if (entry.trim() !== '') args.push('--trusted-host', entry.trim())
  }
}

process.argv = [process.argv[0] ?? 'node', bin, ...args]
// Dynamic import requires a file:// URL on Windows (bare drive paths are not
// accepted by the ESM loader).
await import(pathToFileURL(bin).href)
