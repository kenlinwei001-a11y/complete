// WO-DSH-N4 · vendor fork 漂移检查：比对 node_modules 实解上游 lib/index.js 的 sha256
// 与 plugins/mcp-client-tenant.mjs 头部钉值；不一致即 rc=1 —— 上游升级必须重贴 D1/D2/D3
// 三处 diff 并更新钉值，禁止静默漂移。
// 跑法：node packages/dsh-harness/test/drift-check.mjs（包内 cwd 无关，createRequire 锚本文件）。
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const pkgJsonPath = require.resolve('@deepseek-ai/dsh-mcp-client/package.json')
const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
const upstreamFile = join(dirname(pkgJsonPath), 'lib', 'index.js')
const actualSha = createHash('sha256').update(readFileSync(upstreamFile)).digest('hex')

const forkPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'mcp-client-tenant.mjs')
const forkHead = readFileSync(forkPath, 'utf8').slice(0, 2000)
const pinnedVersion = forkHead.match(/上游版本: (\S+)/)?.[1]
const pinnedSha = forkHead.match(/上游 sha256: ([0-9a-f]{64})/)?.[1]

let failed = false
if (pinnedVersion !== pkg.version) {
  console.error(`DRIFT: upstream version ${pkg.version} != fork pin ${pinnedVersion}`)
  failed = true
}
if (pinnedSha !== actualSha) {
  console.error(`DRIFT: upstream lib/index.js sha256 ${actualSha} != fork pin ${pinnedSha}`)
  failed = true
}
if (failed) {
  console.error('mcp-client-tenant vendor fork drift detected — re-apply D1/D2/D3 onto the new upstream and update the pins')
  process.exit(1)
}
console.log(`drift-check OK: upstream ${pkg.version} sha256 ${actualSha} matches fork pins`)
