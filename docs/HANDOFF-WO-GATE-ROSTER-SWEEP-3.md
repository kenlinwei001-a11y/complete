# HANDOFF · WO-GATE-ROSTER-SWEEP-3（轻画像·门脚本+基线）

分支：`claude/handoff-wo-roster-sweep-3`（基于集成线 `claude/verify-reclaim-6` tip 7c52b9b42）
范围：7 个 `roster` 债键的最终定性收口 + `scripts/gate-roster-baseline.json` + 本文档。
轻画像纪律：未跑 vitest / 未跑 pnpm build；只跑门脚本本体（RC 逐条在下表）。

## 一、开工复核（债表）

`node scripts/check-gate-roster-handcopied.mjs` 开工时实报：**roster 债 7 条**（SEG_CONSUMERS · PLAN_GOAL_CONSUMERS · SCAN_TARGETS · APPS · PAGES · SCAN · PACKAGES），候选 76 / 在账 74。除本单 7 键外仅有的失败是 roster-reg-2 待 merge 的两条未定性候选（EXCLUDE_DIRS · PROTECTED_PATTERNS）——按工单**不碰**。

## 二、7 键逐条处置（全部只降不升）

| # | 键 | 处置 | 一句话 why |
|---|----|------|-----------|
| 1 | boundary-singlesource:**SEG_CONSUMERS** | roster→**criteria** | 名册扩到精确现算集 16 个（差集 12 全收编），门内新增判据②b：任何引用 token 却不在名册的文件 RC=1 带 file:line —— 名单由机器盯着 ⇒ 判据本体化 |
| 2 | boundary-singlesource:**PLAN_GOAL_CONSUMERS** | roster→**criteria** | 同上双向锁；实测差集 0（名册 3 个恰是现算集），同样加②b 断言，防的是未来而不是现在 |
| 3 | chain-scan-honesty:**SCAN_TARGETS** | roster→**criteria** | 新增 H9：含生产锚点（`ChainImpedimentSchema.parse(` / `detectChainImpediments(`）的文件必须在名册，否则 RC=1 带 file:line；旧 why 里「差什么才能修」（按是否写入 schema 字段判）即此 |
| 4 | deploy-governance:**APPS** | **删账**（现算化） | 改为 IIFE 现算：`apps/<name>/src/config.ts` 存在即进面，service=目录名；`MIN_APPS=2` 下界自证（枚举塌陷⇒RC=2 不许恒绿） |
| 5 | layout-legibility:**PAGES** | roster→**criteria** | 纯定性收口（零代码改动）：门内已有 PAGES⊆现算名册断言（alien⇒RC=2）+ 每次运行打印未进棘轮的 11 页；PAGES 剩下的语义是「棘轮守哪几页」的范围判据 |
| 6 | dev-jargon-onscreen:**SCAN** | roster→**computed** | 两处扫描根现算语义明确（frontend-shell/src 全递归 + locales 单列，locale 与非 locale 词法不同必须分开）；新增 `SCAN_SKIP_DIRS`（node_modules/dist/build）记 computed；遍历深度上限取消 |
| 7 | typecheck-coverage:**PACKAGES** | **删账**（现算化） | 改为从 pnpm-workspace.yaml 的 packages globs 现算（只认 `<dir>/*` 形态，否则 RC=2 不许猜）；无 package.json 目录如实跳过打印；`MIN_PACKAGES=5` 下界自证；llm-adapters 的 buildConfig=null 由「build 与 typecheck 同配置」机械推出而非手抄 |

新增账 2 条（均为现算输入常量，verdict=computed）：`chain-scan-honesty:PRODUCER_SCAN_ROOTS`（H9 扫描面·五包 src 全递归）、`dev-jargon-onscreen:SCAN_SKIP_DIRS`。

**计数器定稿**：`rosterCount` 7→**0**；`ratchetHigh` 7→**0**（按 `--tighten` 语义 min(prev, rosterCount)，此后任何新 roster 定性当场红）；`candidateCount` = **74**（= 条目实数；live 候选 76 减去 roster-reg-2 待 merge 的 2 条 = 74，三方追加点以此为准）。

## 三、变异反证（4 处，超过工单 ≥2 要求）

| # | 门 | 注入 | 结果 | 还原 |
|---|----|------|------|------|
| ① | boundary-singlesource | 名单外文件引用 SEG token | RC=1，点名 `file:line 引用了 token 但不在名册里` | 还原后 RC=0，porcelain 净 |
| ② | deploy-governance | 新 app 有 config.ts 无 compose service | RC=1，点名「现算配置面里有 … compose 却没有同名服务」 | 还原后 RC=0 |
| ③ | dev-jargon-onscreen | src 深层（原深度上限外）埋行话 | RC=1，点名 file:line | 还原后 RC=0 |
| ④ | typecheck-coverage | 新包 `packages/zz-mutation`：typecheck 配置不含 test/ | RC=1，点名包名+样例 `test/blind.test.ts`（0/1 在面内） | `git reset`+删除后 RC=0 |
| ⑤ | chain-scan-honesty（H9） | 新产数处 `zz-h9-mutation.ts` 含 `ChainImpedimentSchema.parse(` 不进名册 | RC=1，点名 `zz-h9-mutation.ts:2` 带锚点（复验修单后真跑实测） | 删除后 RC=0 |

每处变异前先跑已知命中样例（金丝雀纪律）；④ 是真实落盘包+`git add`（git ls-files 只读索引）。

## 四、门 RC 前后对照

| 门 | 改前 | 改后 | 备注 |
|----|------|------|------|
| boundary-singlesource:check | 0 | 0 | 变异 ① RC=1 已还原 |
| deploy-governance:check | 0 | 0 | 变异 ② RC=1 已还原 |
| dev-jargon-onscreen:check | 0 | 0 | 见「范围自裁」条 |
| typecheck-coverage:check | 0 | 0 | 6 包全绿（dsh-harness 无 typecheck 脚本+无测试如实跳过）；反向金丝雀 4/4 |
| chain-scan-honesty:check | **RC=2（环境）** | **0（真跑）** | 初交时 worktree 无 contracts dist 且 :165 块注释被 `**/` 提前终结（模块加载 ReferenceError 回归，复验坐实）；已修注释 + `pnpm --filter @platform/contracts build` 后真跑 RC=0（金丝雀 9/9·9/9·R1–R7 全过），H9 实测咬变异（未登记产数处 ⇒ RC=1 点名 file:line，还原复绿） |
| layout-legibility:check | —（本单未改代码） | RC=2（环境） | worktree 无 Chromium；本键零代码改动，纯 baseline 定性 |
| gate-roster:check | 1（roster 7 + reg-2 两条） | 1（**仅** reg-2 两条 EXCLUDE_DIRS/PROTECTED_PATTERNS） | roster 债 7→0 |

## 五、范围自裁（审校必看）

1. **`scripts/dev-jargon-baseline.json` 0→1**：SCAN 现算化后全递归第一次照到存量命中 `apps/frontend-shell/src/components/QueryDock/QueryDock.tsx:111`（环境变量名 `VITE_MOCK` 出现在 mock-honesty 横幅文案里）。改文案是产品判断、超出本单范围；按该门自有的 `--update` 棘轮收编登记（总量 0→1）。**这不是买来绿**：是门自己的存量收编机制，收编后该文件该行被棘轮咬住、只许减少。
2. **chain-scan-honesty 初交未能真跑（复验退回后已补齐）**：初交时 worktree 无 contracts dist，门在 :142 `assertDistFresh` 退 RC=2 —— 这个早退恰好**屏蔽了 :165 的回归**（块注释内 `` `**/mocks/**` `` 的 `*/` 提前终结注释，模块加载即 ReferenceError），我把「RC=2 是环境」当成了「没有回归」的证据，复验方 build 后当场证伪。已按修单补齐：注释改写（一字级）→ build contracts dist → **真跑 RC=0**（金丝雀 9/9·9/9·R1–R7 7/7）→ H9 变异实测（注入未登记产数处 ⇒ RC=1 点名 `file:line`，还原复绿 RC=0）。教训即工单那句话：语法检查不构成门能跑的证据，只有真跑算数。
3. **未碰清单（工单禁止项）**：baseline 的 LOGIN 条目、roster-reg-2 的两条待 merge 候选（EXCLUDE_DIRS/PROTECTED_PATTERNS，故 roster 门仍红 2 条 = 预期）、`gate-ledger.json`（零改动）、未跑 build-gate-ledger.mjs、layout-legibility 只碰定性未碰探针逻辑。
4. **本体写回**：`docs/SYSTEM-ONTOLOGY.md` §8 gate-roster 段句末最小一句追加（铁律 0：扫描面改动=门改动）；该段是 anchor-recal2 已知碰撞区，若合并冲突取双方句末追加并存。

## 六、提交序列

1. `479df18ce` unit1 boundary-singlesource（SEG/PLAN_GOAL 双向锁 + baseline 2 条升 criteria）
2. `d55976da6` unit2 deploy-governance（APPS 现算 + 删账）
3. `240d86cb6` unit3 dev-jargon（SCAN 现算 + 深度上限取消 + baseline 收编 1 条）
4. 本批 unit4 typecheck-coverage（PACKAGES 现算）/ unit5 chain-scan-honesty（H9）/ unit6 PAGES 定性 / 计数器定稿 / 本体一句 / 本文档
5. 复验修单（退回件）：:165 块注释 `*/` 提前终结修复 + contracts dist 构建后真跑 RC=0 + H9 变异实测 + 本文档两处订正
