# DSH-P1A · E-dsh 毕业测量基线（2026-09-30）

**工单**：#16 P1a（DSH 迁移队列，#15 P0b Harness 升级之后）
**用途**：这是 #17 P1b「S4 开流 `DSH_HARNESS=1` 灰度 + 双跑对比」的**对照锚**。开流后必须用**同一棵树、同一条命令、同一口径**复跑，逐项对比。

## 0 · 测量面定位（先把「E-dsh 套件」钉死，避免各人各跑一套）

| 项 | 出处 | 说明 |
|---|---|---|
| E-dsh 判据本体 | `apps/agentcore/test/dsh-poc-acceptance.test.ts`（231 行，文件头注释即判据清单） | 覆盖 **E1 配置驱动 · E2 规则闸 · E3/E3′ 租户凭据路由 · E4 MCP 工具名逐字节 · E6 SSE 三档 verdict** |
| **E5** | 同文件头注释：`E5 = flag off 跑既有套件全绿，单独执行不进本文件` | 即「`DSH_HARNESS=0` 下 agentcore 既有套件全绿」，载体是整包 `vitest run`，不在这一个文件里 |
| 双跑载体（#17 用） | `apps/agentcore/test/dsh-e2e-dualrun50.test.ts`（65 任务 L1 双臂字节比对） | 臂选择 **2026-10-01 起 = per-agent `kernel`**（原「dsh 臂置 `DSH_HARNESS=1` / 原生臂删该变量」已于 §4.3 根因修复中废除） |
| 休眠门 | `scripts/check-dsh-dormancy.mjs`（`pnpm dsh-dormancy:check`） | D1 部署面不许开 flag · D2 白名单外静态 import · D3 入口唯一且带判断 |

## 1 · 环境（复跑须一致）

- 树：`/Users/apple/deploy/complete`　分支：`claude/handoff-wo-dsh-p1a`　基线提交：`eef63cf70`（开分支时的父提交）
- `DSH_HARNESS=0` **显式**传入（源码默认值亦为 `"0"`：`apps/agentcore/src/config.ts:74`）
- 本机 load average **416**（共享机，不等待安静窗口；`--maxWorkers=2` 限并发）
- 跑法：`cd apps/agentcore && DSH_HARNESS=0 pnpm exec vitest run --maxWorkers=2 --reporter=verbose`

## 2 · 判据 A · E-dsh 套件本体（E1/E2/E3/E3′/E4/E6）

**读数：6 passed / 6，Duration 105.02s。** 无失败、无跳过。

| 用例 | 耗时 |
|---|---|
| E1 配置驱动行为（persona/finalAnswer 改动 ⇒ request/header 随之变，还原即复原） | 46141ms |
| E2 规则闸（PRE_CHECK deny ⇒ echo 计数 0 + 拦截入流；基线计数 1） | 35634ms |
| E3 本租户 ref 解析并注入 Bearer | 1ms |
| E3′ 租户 t2 持 t1 的 ref ⇒ undefined ⇒ MISSING_CREDENTIAL（fail-closed） | 2ms |
| E4 全语料逐字节相等（含规整/截断/压线边界） | 2ms |
| E6 tier1 帧可映射；tier2/tier3 帧 `createSseMapper` 返回 undefined | 1ms |

证据：`docs/evidence/DSH-P1A-suiteA-20260930.txt`（原文日志）

## 3 · 判据 B · 现状确为休眠（原生 loop）

`pnpm dsh-dormancy:check` → **RC=0**

```
✅ 金丝雀 28/28 全中（必咬 17 + 必不咬 11 · D1 8 + D2/D3 15 + 归类器 5）
· 扫描面：部署面 9 文件 · 源码面 732 文件（下界 5 / 200，均已过 ⇒ 下面的「零处」是真的零，不是没扫到）
· D1 部署面开 flag 0 处 · D2 白名单外静态 import 0 处 · D3 入口 动态 1（其中裸 0）/ 静态 0
✓ dsh-dormancy:check 通过
```

扫描面下界自证是这条读数的关键：它排除「因为没扫到所以报零」这个假绿形态。

证据：`docs/evidence/DSH-P1A-dormancy-20260930.txt` + 同名 `.rc`（RC=0）

## 3.5 · 「开流前后对比」的**锚子集**（#17 用这一组做逐项对比）

全量 209 文件在本机跑不完（见 §4 量化），而 #17 需要的是一条**两边都跑得起、口径完全相同**的对照。锚 = **`apps/agentcore/test/dsh-*.test.ts` 全部 19 个文件**（DSH 域全覆盖，含 E-dsh 套件本体）：

```
dsh-degraded-seams · dsh-deny-budget.seam · dsh-dualrun-reconcile · dsh-e2e-degradation-screen
dsh-e2e-dualrun50 · dsh-e2e-honesty · dsh-e2e-real-triad · dsh-e2e-tenant-collision
dsh-engine-mcp-forward.seam · dsh-engine-tool-bridge.seam · dsh-fault-injection.seam
dsh-gov-datacore-credential.seam · dsh-gov-production.seam · dsh-poc-acceptance
dsh-postcheck.seam · dsh-provider-seam · dsh-runtime-map · dsh-runtime-reassemble · dsh-watchdog
```

跑法（与 #17 必须逐字相同）：

```bash
cd apps/agentcore && DSH_HARNESS=0 pnpm exec vitest run "test/dsh-*.test.ts" --maxWorkers=2
```

锚的价值：19 个文件里既有单元（runtime-map / reassemble / watchdog / dualrun-reconcile），也有真缝集成（e2e 系列、seam 系列），**开流改的是 dsh 分叉**，这一组正是它的全部直接受面。

## 4 · 判据 C · E5（`DSH_HARNESS=0` flag-off 全量回归）

**终读：209 个文件跑完 208（1 个 skip）· 用例 1476 通过 / 5 红 / 7 跳过 · RC=1 · 4464.72s。**
**5 条红逐条归因后：本树 flag-off 态的确定性缺陷 = 0 条。**

| 用例 | 表面读数 | 定性 | 孤立复跑 |
|---|---|---|---|
| `dr50-cd` | Test timed out in 180000ms | 负载型超时 | ✓ 8159ms |
| `dr50-cg` | Test timed out in 180000ms | 负载型超时 | ✓ 7359ms |
| `L4.A2` | Test timed out in 90000ms | 负载型超时 | ✓ 16844ms |
| `dr50-ce` | `DataCore provider directory not configured` | **超时的级联假红**（§4.1） | ✓ 7325ms |
| `dr50-ch` | 同上 | **超时的级联假红** | ✓ 6993ms |

复跑：`DSH-P1A-e5-rerun-dualrun4-20261001.txt`（RC=0）· `DSH-P1A-e5-rerun-tenantA2-20261001.txt`（RC=0）
全量原文：`DSH-P1A-e5-full-20260930.txt`（RC=1）· 环境：`DSH-P1A-e5-meta-20260930.txt`

### 4.1 那 2 条 `DataCore provider directory…` 的根因（连续追问五层）

失败栈尾 `test:820:21` 的列号指向 `await` ⇒ **抛错的是 `off`（原生）臂**，不是 dsh 臂。

| # | 为什么 | 答 |
|---|---|---|
| 1 | 原生臂为什么抛 dsh 路的错？ | 它走进了 dsh 分叉（`engine.ts:633`） |
| 2 | 分叉为什么开着？ | 分叉 = `kernel === "EXTERNAL" \|\| (kernel === undefined && process.env.DSH_HARNESS === "1")`；语料不设 kernel ⇒ 那一刻进程里 `DSH_HARNESS === "1"` |
| 3 | 那一刻谁把它设成 1？ | 上一条测试「on 臂」的**孤儿体**：`runArm` 只在 `finally` 里 delete，而那条测试**已超时** —— `@vitest/runner` `withTimeout`（`chunk-hooks.js:1852`）在超时瞬间 reject 且**不再 await 测试体**，测试体继续在后台跑 |
| 4 | 上一条的残留为什么打得中下一条？ | 臂选择用的是**进程级可变状态**（`process.env`），任何孤儿写者都污染后来的读者 |
| 5 | 为什么当初这么建？ | 仪器建在 POC 期的 `DSH_HARNESS` 进程开关上，而 `ROLLOUT-dsh-external-kernel.md` §0 指定的杠杆是 **per-agent `kernel`** —— 仪器比杠杆老，此后又住在测试树里，**没有任何门扫它** |

**金丝雀（机制自证，非推断）**：把 `DSH_HARNESS=1` 放进环境跑同一条用例 ⇒
`× dr50-cf 1925ms → DataCore provider directory not configured`，四层栈逐帧相同
（`providers.ts:437 ← engine.ts:698 ← runArm:277 ← test:820:21`）；对照（env=0）它在同一次全量里 ✓ 33118ms。
证据：`DSH-P1A-e5-canary-env1-20261001.txt`（RC=1 为**预期红**）。

⚠ 这条文案读起来像「生产缺 DataCore 用途绑定」，真相恰好相反 —— **它出现在根本没有 dsh 内核的那一臂上**。
⚠ 连带订正一次本仓老坑：验证「写者已删」时 `grep -c 'process.env.DSH_HARNESS = "1"'` 报 1，命中的是**我注释里引用的那一串** —— 按语法位置（`^\s*process\.env\.… =`）重查才归零。

### 4.2 最终根因（两条链落到同一处）

- **链 A（级联假红）**：进程级可变状态选臂 ⇒ 超时孤儿体污染下一条测试。
- **链 B（超时）**：判决载体是**墙钟预算**，墙钟度量的是机器 —— 同批用例孤立 7–17s、负载下爆到 20 倍以上；仪器**没有能力把「两臂对不上」与「机器慢」分开**。

**同一个根 = 这套仪器的判决不可归因**：三种不同的东西（两臂真不一致 / 自身全局态被污染 / 机器慢）压成同一个屏上读数 `× … 双臂四面对账`。而 #17 的裁决全押在它上面 ⇒ 它现在**两个方向都不可证伪**（绿了不敢开、红了不知是真红）。

**这一根还解释了它为什么长期没被发现**：仪器住在测试树里，D1/D2/D3 与既有各道门扫的是部署面/源码面，**没有一道门看它**；它验证的杠杆（kernel）与本仓「截断/残留一律降 NOT-MEASURED」的既定纪律，都晚于它诞生。

### 4.3 已做的根因修复（修全局态，不是调阈值）

臂选择从进程级 env 换成 **per-agent `kernel`**（`AgentRunKernelSchema = ["NATIVE","EXTERNAL"]`，正是 ROLLOUT §0 的生产杠杆）：

- on 臂 `kernel: "EXTERNAL"` ⇒ 不依赖 env 照常分叉；
- **off 臂显式钉 `kernel: "NATIVE"` = 免疫位** —— 契约注释明文「显式值优先于 env」，故任何残留的 `DSH_HARNESS=1` 都翻不动它；
- 删掉 `process.env.DSH_HARNESS = "1"` **这个写者本身**（全仓读点只有引擎分叉两处，已由 kernel 承担）。

**为什么这不是补丁**：调大 timeout、或 `beforeEach` 重置 env，都挡不住「孤儿体**在下一条测试运行期间**写入」这一形态（beforeEach 只在测试开始前生效）。换 kernel 是让**这一整类全局态不存在**。

**双向验证（2026-10-01 · 同一棵树 `eef63cf70` · load ≈75）**

| 半边 | 修前 | 修后 |
|---|---|---|
| **免疫位**：环境带 `DSH_HARNESS=1` 跑 `dr50-cf` | × 1925ms `DataCore provider directory not configured` | **✓ 9270ms** |
| **on 臂未伤**：全文件 76 用例（A0 + 65 任务 + A5 确定性块） | —— | **76 ✓ / 0 × · RC=0 · 469.20s** |

证据：`DSH-P1A-e5-canary-env1-AFTER-fix-20261001.txt`（RC=0）· `DSH-P1A-e5-dualrun50-after-fix-20261001.txt`（RC=0）· `DSH-P1A-e5-fix-verify-meta-20261001.txt`

**这不是发明修法，是对齐既有约定**：多个 dsh 测试文件早已写着「per-agent kernel 驱动，**进程 env 恒关——分叉来源无歧义**」，
`dualrun50` 是没跟上约定的那一个，偏偏又是 #17 要骑的那一件。

**同类残余（普查所得，交 #17 开局清扫）**：`process.env.DSH_HARNESS = "1"` 的写者另有 7 个测试文件
（`dsh-e2e-honesty` · `dsh-degraded-seams` · `deploy-governance-seam` · `dsh-e2e-real-triad` ·
`dsh-engine-mcp-forward` · `dsh-provider-seam` · `dsh-dualrun-reconcile`），与双跑同源同险；
`agent-run-attribution` 里那两处是**故意**留的免疫位反向用例，不算残余。
`PLATFORM_GOV_DENY` / `DSH_HARNESS_DIR` 仍是进程级写者（前者经子进程 env 继承被消费），同类形态对它仍成立，只是不再影响臂选择。

### 4.4 对 #17 的口径后果

1. 对比锚 = §3.5 的 **19 文件子集**，不是 209 全量（全量本机 75 分钟且受负载污染）。
2. 基线口径重述：**flag-off 态 = 0 条确定性缺陷**（原先若记「5 红」，等于把仪器的病记成了产品的病）。
3. **⛔ 不许把「调大 timeout」当修法** —— 阈值总能被更慢的机器击穿。

## 5 · 诚实边界（不许越读）

1. 判据 A 是**真缝集成**（E1/E2 spawn `packages/dsh-harness` 子进程，走 `src/dsh-runtime/runner.ts`），但它验的是 dsh 臂自身；**不等于**产品面已完成迁移。
2. 「现状=休眠」只是**静态面**读数：本门不解析 TypeScript（词法近似），不覆盖运行时注入（`docker exec -e` / k8s / systemd / CI secret），也不覆盖 `packages/dsh-harness/`（今天无 `src/`，闭包以 `plugins/*.mjs` + `cordis.yml` 存在）。
3. 本基线在**本机**取得，load 416；耗时数字不可跨机比较，**判据只认绿/红与条数**。
4. 未做的事：产品面开流、任何灰度、任何部署面改动。**本单有一处代码改动**：双跑仪器的臂选择（测试文件，§4.3）——那是**测量装置自身**的根因修复，不改产品行为、不碰部署面；产品源码零改动。

## 6 · 回写计划（铁律 0）

- 基线读数 → 本文件
- 与 #15 的联动：workdsh 侧 Harness 已升 `0.1.7-alpha.2`（见该仓部署台账），本单不动 workdsh
