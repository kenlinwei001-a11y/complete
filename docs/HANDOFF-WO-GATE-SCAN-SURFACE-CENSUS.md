# HANDOFF · WO-GATE-SCAN-SURFACE-CENSUS（扫描面普查 + 逐门分母下界）

- 基线：`eaa10b9ffe19d02a112f2e85f0872ad559521a9d`（WO-GATE-ROSTER-SWEEP-3 戳收 tip）
- 断点：G-GATE-SCOPE-MISSES-SUBJECT 残留 ——「接了线接错地方（射程无自证）」
- 形态：照 `check-dev-jargon-onscreen.mjs` 的 `MIN_LOCALE_LITERALS` 范式 —— 扫描面抽出的总量 < 下界 ⇒ 报「工具坏了」**RC=2**，不是 RC=0。下界取现算值的 ~55-65%（防正常波动误报），取值依据写进各门注释。
- 环境：本 worktree `pnpm install --prefer-offline` + `pnpm --filter @platform/contracts build` + `pnpm --filter datacore... build` + `pnpm --filter agentcore... build`（gate-ledger / object-interface / solver-arg-key-drift 有 dist 新鲜度早退，缺 dist 时 RC=2 是「我没查」，不构成无回归证据）。

## 一、普查方法与口径

- 全集：`scripts/check-*.mjs` 共 99 道门。
- 普查对象 = **带扫描面的门**：用 `readdirSync`/walk 等枚举文件集合作判据输入的门，共 **41 道**（grep `readdirSync|globSync|execSync(find|rg|grep)|walkFiles|listFiles|collectFiles` 命中后逐门人工核对）。
- 逐门记两件事：① 扫描面是什么（常量还是现算）；② 有无「总量 < 下界 ⇒ RC=2」的自证。

## 二、普查清单（41 道）

### A. 已有分母下界自证且 RC=2（25 道，本单不动）

| 门 | 扫描面 | 下界自证 |
|---|---|---|
| check-baseline-writer-honesty | scripts/*.mjs 枚举 | `MIN_SCRIPTS=60` + `MIN_WRITERS=12` → exit(2) |
| check-boundary-singlesource | SCAN_ROOTS 递归 .ts/.tsx | `MIN_SCAN_FILES=400` → exit(2) |
| check-chain-scan-honesty | SCAN_TARGETS + 构造区锚点 | `MIN_REGIONS=3`（selftest bad→blind）→ exit(2) |
| check-claim-strength | SCAN_TSX_DIRS/FILES/TS_COPY | `MIN_FILES=25` → exit(2) |
| check-dbui-flow-order | SCAN_DIR 族文件（FAMILY_RE） | `MIN_FAMILY=3` → exit(2) |
| check-deploy-governance | 现算配置源 APPS | `MIN_APPS=2` → exit(2) |
| check-dev-jargon-onscreen | SCAN（jsx 面 + locale 面） | `MIN_FILES=80` + `MIN_LOCALE_LITERALS=1200` → exit(2)（范式出处） |
| check-factlock-anchor | 测试文件枚举 | `MIN_TEST_FILES=300` → exit(2) |
| check-gate-exit-discipline | scripts/check-*.mjs | `MIN_GATES` → exit(2) |
| check-merge-conflict-markers | 全仓扫描面 | `MIN_FILES=300`（枚举+实读双口径）→ exit(2) |
| check-screen-value-provenance | SCAN_ROOT 前端 src | `MIN_FILES=100` → exit(2) |
| check-text-legibility | css + tsx 双面 | `MIN_CSS_FILES=30` / `MIN_TSX_FILES=120` → exit(2) |
| check-typecheck-coverage | workspace 包现算 | `MIN_PACKAGES=5` → exit(2) |
| check-ui-first-layer | SCAN_ROOT 前端 src | `MIN_FILES=150` → exit(2) |
| check-css-token-defined | 前端 src 全递归 | 字面量下界 `files.length < 50` → exit(2)（未命名常量，已够用） |
| check-dsh-dormancy | 部署面 + 源码面 | `DEPLOY_FLOOR=5` / `SOURCE_FLOOR=200` → exit(2) |
| check-fact-usage | 前端 src + 端点图 + 页名册 | 三条下界（50/20/20）→ exit(2) |
| check-harness-ux-splitaccount | PRD §4.1 面板文件现算 | panelFiles 0-check + 全找不到 check → toolBroken exit(2) |
| check-name-consistency | 视图真相源解析 | `rows.length < 20` → toolBroken exit(2) |
| check-prd-coverage | 测试目录现算 | `TEST_DIRS.length < 3` → exit(2) |
| check-prd-data-grounding | 本体类型宇宙现算 | `types.size < 60` 等 → blind → toolBroken exit(2) |
| check-req-coverage | 需求台账解析 | items 0-check + **声明总数 vs 解析数一致性**（独立口径）→ exit(2) |
| check-solver-arg-key-drift | solver 目录 + CATALOG 三段 | CATALOG 0-check + 三段和一致性 → exit(2) |
| check-stale-claims | 多层真值源 | materializedTypes<20 / registry<20 / decls<1 → blind → exit(2) |
| check-verdict-rollup | docs/CHECK-*.md 现算 | `FILES.length < 4` → exit(2) |

### B. 自证机制等价充分（3 道，本单不动）

| 门 | 自证形态 |
|---|---|
| check-backend-frontend-seam | 常驻金丝雀 C12：`prodFiles.length > 50 且 0 混入 mocks/测试`，金丝雀不中 → exit(2) |
| check-gate-ledger | 账↔盘**双向**核对（无遗漏+无幽灵）+ 顶层兜底 exit(2)；扫描面塌成 0 ⇒ 全账幽灵 ⇒ 红，不静默 |
| check-object-interface | migHits 0 命中 ⇒ 「缺 migration 维」判红（塌陷方向 = 红，非绿）；dist 未构建 ⇒ env exit(2) |

### C. 本单新加下界（11 道，下界 = 2026-08-19 现算值的 ~55-65%）

| 门 | 扫描面 | 现算 | 新下界 | 改前 RC | 改后 RC |
|---|---|---|---|---|---|
| check-debattery | ROOTS(views+pages/admin) 递归 .ts/.tsx ＋ DATA_ROOTS(frontend/src 剔 mocks/test) | 154 ＋ 241 | `MIN_SCAN_FILES=90` ＋ `MIN_DATA_SCAN_FILES=145` | 1（存量红） | 1 |
| check-migration-numbering | apps/*/migrations 下 .sql | 52（2 目录） | `MIN_SQL_FILES=30` | 0 | 0 |
| check-ontology-anchors | SRC_ROOTS(7 根） 全文件索引 byBase | 1803 | `MIN_INDEX_FILES=1080` | 1（存量红） | 1 |
| check-outsource-redline | SCAN_ROOTS(4 src 根） 递归 .ts/.tsx | 634 | `MIN_SCAN_FILES=380` | 0 | 0 |
| check-prd-ontology | docs/PRD-*.md | 138 | `MIN_PRD_FILES=85` | 0 | 0 |
| check-propagation | SIM_DIR=apps/datacore/src/sim 递归 .ts | 5 | `MIN_SIM_TS_FILES=3` | 1（存量红） | 1 |
| check-quantile-field-naming | packages/contracts/src 递归 .ts | 86 | `MIN_SOURCE_FILES=50` | 0 | 0 |
| check-solver-license | CODE_DIRS(4 根） 递归代码文件 | 1588 | `MIN_CODE_FILES=950` | 0 | 0 |
| check-system-ontology | EMIT_SRC_DIRS(datacore+agentcore src) .ts | 291 | `MIN_TS_FILES=175` | 0 | 0 |
| check-unit-value-provenance | SCAN_ROOTS(4 src 根） 递归 .ts/.tsx | 634 | `MIN_SOURCE_FILES=380` | 1（存量红） | 1 |
| check-view-reachable | apps/frontend-shell/src 递归 .ts/.tsx（剔测试） | 257 | `MIN_SRC_FILES=155` | 0 | 0 |

注：改前 RC=1 的 4 道是**基线存量红**（内容判负，与本单无关）：debattery（SandboxConsole diagSections）、ontology-anchors（锚点维修指引）、propagation（Temporal Trust + R14）、unit-value-provenance（松弛/新增）。加下界后 RC 保持 1 = 下界自证通过、内容红照旧 —— 下界检查放在主判据之前，塌陷时会抢先以 RC=2 报工具坏。

### D. 普查副产物：RC 分类异常（只记录，本单不动语义）

以下门把「门自己瞎了」报成 **exit(1)**（与屋约「2=工具坏 / 1=主判据判负」三分不一致，但不构成静默绿，留后续单收口）：

- check-chain-node-singlesource（blind → exit(1)，:835）
- check-redline-wired（blind → exit(1)，:370）
- check-outsource-redline（scanned 0-check 走 fails → exit(1)，:275；本单新加的 `MIN_SCAN_FILES` 下界走 exit(2)）
- check-system-ontology（emitted 0-金丝雀走 fail → exit(1)，:443；本单新加的 `MIN_TS_FILES` 走 exit(2)）
- check-migration-numbering（dirs 0-check → exit(1)，:139；本单新加的 `MIN_SQL_FILES` 走 exit(2)）
- check-prd-ontology（R/G 表 0-check → exit(1)，:57；本单新加的 `MIN_PRD_FILES` 走 exit(2)）

## 三、变异反证（验收判据：扫描面改窄 ⇒ RC=2 报工具坏，不是变绿）

每处变异做完即还原（`git checkout --`），还原后 `git status --porcelain` 净。三处不同门：

### 变异 1 · check-solver-license（CODE_DIRS 4 根砍成 1 根）

- 手法：`CODE_DIRS = ["apps","packages","services","scripts"]` → `["services"]`
- 结果：**RC=2**（非绿）——`⛔ 门自己瞎了：代码面只枚举到 2 个文件（下界 950）—— walk 静默 return 了…不是「违规清零」`
- 还原后复跑 RC=0（1588 文件，下界 950 已过）

### 变异 2 · check-view-reachable（ROOT 砍成子目录）

- 手法：`ROOT = "apps/frontend-shell/src"` → `"apps/frontend-shell/src/views/sim"`
- 结果：**RC=2**（非绿）——`⛔ 门自己瞎了：扫描面只枚举到 56 个源文件（下界 155）—— walk 断了…`
- 还原后复跑 RC=0（257 文件，下界 155 已过）

### 变异 3 · check-propagation（SIM_DIR 改成不存在的目录名）

- 手法：`SIM_DIR = "apps/datacore/src/sim"` → `"apps/datacore/src/sim-renamed"`
- 结果：**RC=2**（非绿）——`⛔ 门自己瞎了：R14 扫描面 …只扫到 0 个 .ts（下界 3）—— 目录改名/枚举断了…`
- 此变异直接钉死本单要治的形态：旧代码 `scanDir` 对不存在目录**静默 return**，R14 会真空变绿；且在 vitest 块**之前**退出（秒回，不跑测试套件）
- 还原后复跑 RC=1（存量红照旧：Temporal Trust + R14 两条内容判负，与本单无关）

## 四、铁纪律遵守声明

- `scripts/gate-ledger.json` 零字节改动；各门 baseline json 未碰（下界写在门脚本里，不当基线账）。
- 只动门脚本 + 必要注释 + 本文档。
