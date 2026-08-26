# TEST PLAYBOOK · 全量测试执行手册

> **给谁用**：接手执行测试的 agent / 工程师。
> **怎么用**：从 §1 环境准备开始**逐节执行**，把每节的「实测输出」填进 §9 的回报模板。
> **最重要的一句**：本手册里所有「基线数字」都是**本会话真跑测出来的**，不是估的。
> 你跑出来的数与基线不符 → **先怀疑环境，再怀疑代码**（§2 列了五个会让你误判的坑）。

---

## §0 · 五条纪律（违反即结果作废）

1. **禁止 `cmd | tail -n; echo "EXIT=$?"`** —— `$?` 取的是管道末端 `tail` 的退出码，**恒为 0**。
   本仓真实事故：曾据此把一个 **编译失败**的 commit 判为「BUILD 通过」并入正线。
   **正确写法**：
   ```bash
   cmd > /tmp/x.log 2>&1; RC=$?; echo "REAL_RC=$RC"
   grep -nE "error TS|FAIL|AssertionError" /tmp/x.log | head -20   # 失败必须打印原文
   ```
2. **datacore 的 vitest 全局只能有一个实例**。开跑前先查：
   ```bash
   ps -eo pid,etimes,args | grep "[v]itest" | head
   ```
   有别人在跑 datacore → **等**，不要并发。（agentcore / frontend 可与 datacore 错开并行。）
3. **后台任务通知说的 "exit code 0" 不可信** —— 它是包装脚本的退出码，不是 gate 的。
   必须从日志里 grep 真退出码（见 §5）。本仓真实事故：通知报 0，日志里 `GATE_RC=1`。
4. **门（测试）自己也要先被验一遍**：一道从没红过的门不算门。
   报「X 全绿」之前，先让它在**已知坏的输入**上红一次（§7 给了每道门的红法）。
5. **不确定就写「未核实」**，不要推测后当结论报。

---

## §1 · 环境准备（新 worktree 必做·跳过会得到"假红"）

```bash
# 1) 建 worktree
git fetch origin <目标分支>
git worktree add /tmp/verify --detach origin/<目标分支>
cd /tmp/verify

# 2) 装依赖（必做）
pnpm install --frozen-lockfile > /tmp/i.log 2>&1; echo "INSTALL_RC=$?"

# 3) 构建工作区共享包（必做·否则 agentcore 测试全部无法收集）
pnpm --filter @platform/contracts --filter @platform/llm-adapters build > /tmp/b.log 2>&1
echo "BUILD_RC=$?"
```

> ⚠ **跳过第 3 步的表现**：`Failed to resolve entry for package "@platform/contracts"`，
> `Test Files 1 failed / Tests no tests`，**RC=1**。
> **这个 RC=1 和"测试真红"长得一模一样** —— 本会话已被它骗过两次。
> 凡见 `Tests no tests` 或 `MODULE_NOT_FOUND`/`UNRESOLVED_IMPORT`，先回来补第 2、3 步。

---

## §2 · 五个会让你误判的坑（本会话全部真踩过）

| # | 现象 | 真因 | 怎么识别 |
|---|---|---|---|
| 1 | 新 worktree 跑测试 `RC=1` | 没装依赖 / 没建共享包 | 日志有 `Cannot find package 'vitest'` 或 `Failed to resolve entry for package "@platform/contracts"` |
| 2 | 某能力"0 次触发" → 判为"没接线" | **那条路径根本没跑起来** | 先断言前置条件（如 `agentRoundTrips > 0`）。测试基座 `createTestApp` **默认不种 agent 注册表**，不补种则 `invoke_agent` 无 agent 可调 → 角色 agent 一轮不跑 |
| 3 | agent 循环烧到 `maxDiscoverCalls exceeded` | **脚本里 `final_answer` 的 provenance 形状非法** → 被拒 → 循环不收尾 | 契约要 `{toolCallId, outputPath}`（`tools/registry.ts` final_answer schema）。`toolCallId` 是运行时生成的，须用函数式 turn 从 `req.messages` 取 |
| 4 | 门"全绿"但其实没牙 | 判据与被测实现完美相关（如 `elapsed ≥ 阈值` 在占位实现下恒真） | 见 §7：每道门先做一次已知坏输入的红法 |
| 5 | 后台 gate 通知 exit 0，实际未过 | 包装脚本吞了退出码 | 从日志 grep `REAL_GATE_RC` / `GATE 结果` |

---

## §3 · 测试全景（五层，从快到慢）

| 层 | 命令 | 时长 | 基线（本会话实测） |
|---|---|---|---|
| L1 类型 | `npx tsc --noEmit -p apps/<pkg>/tsconfig.json` | 秒级 | RC=0 |
| L2 单包 vitest | `npx vitest run --root apps/<pkg>` | 3–8 分 | 见 §4 |
| L3 治理门 | `pnpm gates` | 分钟级 | **17 道门** 全过 |
| L4 四包 gate | `bash scripts/gate.sh` | **约 60 分** | 全绿可并线 |
| L5 前端 flaky 统计 | frontend 全量连跑 12 次 | 约 60 分 | 12/12 绿（**未复现**已知 flaky） |

---

## §4 · 各包基线（本会话实测·填表用）

| 包 | Test Files | Tests | RC | 备注 |
|---|---|---|---|---|
| **agentcore** | 141 passed / 1 skipped (142) | 803 passed / 1 skipped | 0 | 含本会话新增三类接缝门 |
| **agentcore**（含 D2+D3） | 144 (143 passed / 1 skipped) | 814 (813 passed / 1 skipped) | 0 | dev 自述·**待复验** |
| **frontend-shell** | 158 passed | 457 passed | 0 | canonical 基线 |
| **frontend-shell**（含 D5+D4） | 159 passed | 462 passed | 0 | 审核方已复验 |
| **datacore** | 1199 passed / 16 skipped | — | 0 | 含 1 条 `it.skip`（#82 已知缺陷挂档） |
| **pnpm gates** | 17 道门 | — | 0 | WO-76 接线后由 16 → 17 |

> `1 skipped` 是**有意挂档**（`adversary-adopt-mitigation.test.ts` 的 #82），不是漏跑。
> 跑出 `0 skipped` 反而要查是不是被谁删了。

---

## §5 · 四包 gate 正确跑法（L4）

```bash
cd /tmp/verify
LOG=/tmp/gate.log
: > "$LOG"
bash scripts/gate.sh > "$LOG" 2>&1; RC=$?
echo "===== REAL_GATE_RC=$RC ====="

# 判定（三者必须一致，任一不符即未过）
grep -nE "REAL_GATE_RC|GATE 结果|全绿|未通过" "$LOG"
grep -cE "error TS|FAIL|AssertionError" "$LOG"      # 应为 0
```

**gate 的五个阶段**（缺任一段说明中途挂了）：
`BUILD` → `genuine-sim:check` → `pnpm gates（17 条治理门）` → `ontology-writeback:check` → `TEST（五包·串行）`

> ⚠ **不要把日志写进正在被 grep 的同一个文件**（会得到 `input file is also the output`）。

---

## §6 · 本会话新增的三类接缝门（重点复跑对象）

文件：`apps/agentcore/test/scenario-phrasing-seam.test.ts`
金标集：`apps/agentcore/test/fixtures/scenario-phrasing-goldset.ts`

```bash
npx vitest run apps/agentcore/test/scenario-phrasing-seam.test.ts --root apps/agentcore \
  > /tmp/seam.log 2>&1; echo "REAL_RC=$?"
sed -n '/措辞鲁棒性基线/,/^$/p' /tmp/seam.log
sed -n '/探索型基线/,/^$/p'   /tmp/seam.log
```

| 门 | 内容 | 基线 |
|---|---|---|
| **① 金标集完备** | 每个出厂场景须配齐 3 条变体（新增场景漏配即红） | 80 条 |
| **② 意图命中型** | 20 场景 ×(原句 + 加实体词 + 实体词变形 + 句式动词变形) | **原句 20/20 · V1 20/20 · V2 20/20 · V3 20/20 · 合计 80/80** |
| **③ 探索型** | 4 道真开放题 ×4 变体；判据四条同时成立：进得去探索 / 出得来不降级 / 非占位 / provenance 非空 | **16/16** |
| **④⑤ 过程可见** | 旁白须在**每条** agent 路径上都到达（path-B 与 Coordinator 多角色） | **2/2** |

---

## §7 · 每道门的「先让它红一次」验法（§0 纪律 4）

> 变异后必须先证 `npx tsc --noEmit` **RC=0**，否则红的是编译不是断言。**每次验完立即还原。**

| 门 | 变异（打掉什么） | 期望红法 |
|---|---|---|
| 措辞门 | `git checkout <base> -- apps/agentcore/src/router/coordinator.ts` | 合计 **80/80 → 74/80**，红的恰是 S12/S13 的 6 条，全 `model=coordinator` |
| 探索型门 | 删掉脚本里"先取证"那一轮（agent 零工具直接作答） | **16/16 → 12/16**，红的恰是 E01 那 4 条（④ 的牙**只对 agent-loop 有效**；E02–E04 走零 LLM 组合路径、provenance 由引擎自建，恒真） |
| 过程可见门 | 打掉 `emitNarration` 沿 `runCoordinator→runWorkflowSteps→runAgentStep` 的透传 | 用例 ② 红：`多角色路径上旁白一条都没发` |
| 求解取消门 | 去掉 `/b/v1/solvers/:key/run` 的 `signal` 透传 | 新测 3/3 红（`sawSignal false`、`abortedByClient 0`） |
| boundary-singlesource | `git checkout <base> -- apps/frontend-shell/src/mocks/fixtures.ts` 后跑 `node scripts/check-boundary-singlesource.mjs` | **RC=1**，报「检出 N 处内联 baseId」 |

---

## §8 · 待复验清单（尚未由审核方亲手验完·优先做）

| 分支 / commit | 内容 | 已验 | 待验 |
|---|---|---|---|
| `claude/handoff-wo-d2d3-diag` `08ba6093`+`b409a2ce` | 超时先回 incumbent + 超时诊断载荷 | — | 四包 gate（后台跑中）· 独立变异 |
| `claude/handoff-wo-76` `c0a1bcda` | boundary 死门接线 + 9 处内联修 | gates 17 道含它 · 门有牙 · 前端 158/457 | **datacore 半**（它改了 `synthetic/battery.ts`） |
| `claude/handoff-wo-79` `6dd0b0c0` | 前端定时器泄漏守卫（toastStore 100 个 6s 裸 setTimeout） | — | 全部。**注意**：dev 自报变异 B **没红**（该处修法属预防性），复验时要如实区分 |
| WO-80 本体锚点门 | 五包 gate 未过 | — | **失败文件名未知**（日志被 `tail` 挤掉），须重跑定位 |

---

## §9 · 回报模板（照填·不要只写"通过"）

```
## 环境
分支 / commit：
INSTALL_RC=   BUILD_RC=

## L1 类型
agentcore TSC_RC=    datacore TSC_RC=    frontend TSC_RC=

## L2 单包
agentcore : Test Files ___ / Tests ___ / RC=___   （基线 141+1skip / 803+1skip / 0）
frontend  : Test Files ___ / Tests ___ / RC=___   （基线 158 / 457 / 0）
datacore  : Test Files ___ / Tests ___ / RC=___   （基线 — / 1199+16skip / 0）

## L3 治理门
pnpm gates：___ 道门 / RC=___                     （基线 17 / 0）

## L4 四包 gate
REAL_GATE_RC=___    GATE 结果：___
错误行计数（grep -cE "error TS|FAIL|AssertionError"）：___

## 三类接缝门
措辞：原句 __/20 · V1 __/20 · V2 __/20 · V3 __/20 · 合计 __/80
探索型：__/16
过程可见：__/2

## 门自证（§7）
逐门填：变异内容 / TSC_RC / 是否变红 / 是否已还原

## 与基线不符的项
逐条给：现象 + 日志原文（`error TS|FAIL|AssertionError` 那几行）+ 你判断是环境还是代码

## 未核实
（明写你没跑到的部分，不要留白让人以为跑过了）
```

---

## §10 · 判定口径

- **「通过」** = L1–L4 全 RC=0 **且** 各包数字与基线一致（或差额能逐条解释）**且** §7 门自证做过。
- **「不通过」** = 任一 RC≠0，或数字对不上且解释不了。**必须附错误原文**，不许只写"有个测试挂了"。
- **「未核实」** ≠ 「通过」。跑不到的部分明写，不要省略。
