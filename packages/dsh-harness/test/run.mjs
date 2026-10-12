// WO-DSH-P0-CI (N0) · harness 包内测试 runner：三段式，任一红则整段红。
//
// ① smoke.mjs（治理/基线/允许表/final_answer 四例，stdio 直透，env 透传）
// ② test/**/*.test.mjs 单元面：fs 显式列文件（不依赖 node --test 目录发现的跨 minor 语义），
//    spawn `node --test <files...>` 时注入 DSH_HARNESS=1（N4 A0 门硬断言此变量）。
//    空发现**不许静默**：打印 HARNESS_UNIT_DISCOVERED=0 明示（N0 单落期即此形态，合流 N4 后应 ≥1）。
// ③ test/drift-check.mjs（N4 资产，rc=1 语义）：存在即跑，不存在打印 SKIP 明示。
//
// 全绿打印单行哨兵（gate.sh run_test 点名正则的机器核靶）：
//   HARNESS_TESTS_OK smoke=PASS unit_files=<n> drift=<PASS|SKIP>
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url)) // packages/dsh-harness/test
const pkgRoot = dirname(here)

function run(label, args, { env = {} } = {}) {
  const r = spawnSync(process.execPath, args, {
    cwd: pkgRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  if (r.error) {
    console.error(`HARNESS_SEGMENT_ERROR ${label}: ${r.error.message}`)
    return 1
  }
  return r.status ?? 1
}

// 递归收集 test/**/*.test.mjs，排除 fixtures/（显式文件列表，不依赖目录扫描语义）
function discoverUnitFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      if (entry === 'fixtures') continue
      out.push(...discoverUnitFiles(p))
    } else if (entry.endsWith('.test.mjs')) {
      out.push(p)
    }
  }
  return out.sort()
}

let fail = 0

// ① smoke
if (run('smoke', [join(pkgRoot, 'smoke.mjs')]) !== 0) fail = 1

// ② 单元面（node --test，注入 DSH_HARNESS=1）
let unitFiles = []
if (existsSync(here)) unitFiles = discoverUnitFiles(here)
if (unitFiles.length === 0) {
  console.log('HARNESS_UNIT_DISCOVERED=0 (test/**/*.test.mjs 空发现，明示跳过 node --test 段)')
} else {
  console.log(`HARNESS_UNIT_DISCOVERED=${unitFiles.length}: ${unitFiles.map((f) => relative(pkgRoot, f)).join(', ')}`)
  if (run('unit', ['--test', ...unitFiles], { env: { DSH_HARNESS: '1' } }) !== 0) fail = 1
}

// ③ drift-check（N4 合流后自动纳入）
const drift = join(here, 'drift-check.mjs')
let driftResult = 'SKIP'
if (existsSync(drift)) {
  if (run('drift-check', [drift]) !== 0) fail = 1
  else driftResult = 'PASS'
} else {
  console.log('HARNESS_DRIFT_CHECK=SKIP (test/drift-check.mjs 不存在，明示跳过)')
}

if (fail) {
  console.log('HARNESS_TESTS_FAIL')
  process.exit(1)
}
console.log(`HARNESS_TESTS_OK smoke=PASS unit_files=${unitFiles.length} drift=${driftResult}`)
process.exit(0)
