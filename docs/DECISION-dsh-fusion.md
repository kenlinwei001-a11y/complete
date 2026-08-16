# 裁决 · 外部 agent 运行时（dsh）融合

> **状态**：已裁决 · 护栏已落地
> **日期**：2026-08-16
> **对象**：POC 分支 `claude/handoff-wo-dsh-poc-s1` @ `6b9a7558`（S1→S4 四个提交）
> **本单**：`WO-DSH-FUSE-GUARDS`（纯门单 + 纯文档单）
> **相关**：`docs/REPORT-dsh-poc-s0.md`（POC 自述）· `docs/REPORT-harness-migration-feasibility.md`（可行性）·
> `scripts/check-dsh-dormancy.mjs`（本裁决的机器执行体）· `docs/SYSTEM-ONTOLOGY.md` §7 / §8 `G-DSH-DORMANT-UNGUARDED`

---

## 1 · 裁决

> ### **代码可以并，flag 不能翻。**

- **并**：POC 的 `packages/dsh-harness`（外部闭包）+ `apps/agentcore/src/dsh-runtime/`（适配层）
  + `engine.ts` 的休眠分叉，作为**已排练、未启用**的能力并入 canonical。
- **不翻**：`DSH_HARNESS=1` 在任何部署面（`docker-compose*.yml` / `deploy/**` / `Dockerfile*` /
  `*.env*` / CI）**一律不许出现**，直到 §3 三条前置条件**逐条销账**。

**被替换的是什么、不是什么**（防止「融合」被读成「换系统」）：dsh 接进来当的是
**agent 执行层**，替掉 `runAgentLoop` 那一层。**AgentCore 本体全部保留** ——
租户/鉴权/entitlement/审计/SSE 外壳、三件套治理面、规则引擎、workflow 引擎一个都不动。
路线是**出进程 JSON-RPC**：外部闭包收在 `packages/dsh-harness`，`apps/agentcore` 只依赖两个协议包。

### 1.1 为什么「可以并」

休眠属实，且**已被机器复核**（见 §4 事实四 与 §5 实测）：全仓对 `@deepseek-ai` 的静态 import
只有 1 处，且在 `apps/agentcore/src/dsh-runtime/` 内；到达它的唯一路径是 `engine.ts:498` 的
`await import("./dsh-runtime/index.js")`，外面包着 `if (process.env.DSH_HARNESS === "1")`。
flag 关时该模块不加载。部署面实测零处设这个 flag。

### 1.2 为什么「不能翻」

因为「休眠分叉」这个安全性论证，**只在它真休眠时成立**，而裁决落地那一刻，
仓里**没有任何机制拦住以后有人把它打开**。

形态（`CLAUDE.md` 铁律 0.6 句式）：

> **「我用『今天它是休眠的』当作『它会一直休眠』的证据，而前者并不度量后者。」**

这正是铁律 0.6 二级处置要的场合 —— **机制的判据只有一条：下次同样的错发生时，
是机器先说话，不是人先想起来。** 写在本文件里的「不能翻」是文档，不是机制；
`scripts/check-dsh-dormancy.mjs` 才是机制。

---

## 2 · 本裁决的机器执行体 · `dsh-dormancy:check`

`scripts/check-dsh-dormancy.mjs` 守三条，任一破即 **RC=1**：

| 判据 | 守什么 | 破了会怎样 |
|---|---|---|
| **D1 · 部署面不许开 flag** | `docker-compose*.yml` / `deploy/**` / `Dockerfile*` / `*.env*` / CI 里 `DSH_HARNESS` 被设成真值（**含 `${DSH_HARNESS:-1}` 这种缺省即开**）即红。显式设 `0`/`false` **不红** —— 那是在加固休眠。 | 未销账就上线：走的是 §3 三条前置条件全部未满足的路径 |
| **D2 · 静态 import 不许扩散** | `apps/<pkg>/src` 与 `packages/<pkg>/src` 里对 `@deepseek-ai/…` 的**静态** import 只许出现在 `apps/agentcore/src/dsh-runtime/` | 静态 import 在**链接期**加载 ⇒ flag 关着也照跑，**休眠当场失效**（论证 §1.1 直接作废） |
| **D3 · 入口只许有一个** | `import("./dsh-runtime/…")` 全仓至多 1 处，且必须被 `process.env.DSH_HARNESS` 的判断包住；从目录外**静态** import 它算裸入口 | 多入口 = 多个必须各自守住的开关，早晚漏一个 |

**退出码三分**：`0` 干净 / `1` 真违规 / `2` 门自己坏了（结论作废）。
1 和 2 不许撞码 —— 撞了，读的人分不出「仓库真有问题」和「门没跑起来」。

**金丝雀 28 条与主逻辑共用同一份实现**（`scanDeployText` / `scanSourceText` / `isDeployPath`），
不另抄正则。抄一份就是装饰品：改主正则时金丝雀拿旧的去测、照样绿。
不中即报「⛔ 门自己瞎了」并 RC=2，**不许**报「仓库很干净」。

**扫描面下界**：部署面枚举不到 `docker-compose.yml`、或源码面文件数低于 200（本仓实测 613）
⇒ 一律 RC=2。报「零处」之前必须先证明**扫到了东西**。

---

## 3 · 翻 flag 的三条前置条件（**逐条销账才允许**）

这三条不是「建议」，是**闸**。任一未销账，`DSH_HARNESS=1` 都不许进部署面。

### 前置 A · 真 provider 从没跑过

**事实**：POC 全程 mock provider。

- 生产侧：`apps/agentcore/src/engine.ts:509` 写的是
  `provider: process.env.DSH_HARNESS_PROVIDER ?? "mock"` ⇒ **只翻 `DSH_HARNESS=1`，走的仍是 mock**。
- 测试侧：`apps/agentcore/test/dsh-poc-acceptance.test.ts` 的**每一处**调用都传
  `{ provider: "mock", model: "mock" }`（L53/57/61/100/121/212）；
  `packages/dsh-harness/smoke.mjs:41` 同样 `provider: 'mock'`。
- harness 侧：`packages/dsh-harness/cordis.yml` 尾部自陈
  「**POC 夹具（生产部署替换为 platform LLM 适配器插件 + 真工具）**」，
  应答的是本地 `plugins/mock-llm.mjs` —— 一份**写死剧本**（第一轮调 `echo_tool`，第二轮文本收尾）。

**为什么这构成闸**：这正是本仓记过的形态 —— **生产实参与测试实参交集为空**
（`G-SEED-PROVENANCE-BACKFILL-UNASSERTED`：`synthetic/service.ts` 的 provenance 回填由
`viaModelingChain` 二选一，生产传 `false`、两个相关测试都传 `true`，
于是**测试三周来验的是生产已经放弃的那条路，而且全绿**）。

判据一句话：

> **「这个函数有测试」证明不了「生产走的那个分支有测试」。**

⚠️ 本条在 dsh 上是**加重形态**，不是等价形态：那次是「测试验的路生产不走」，
这次是「**生产走的那条路，跑的是一份写死剧本**」——
只翻 `DSH_HARNESS=1` 而不同时改 `DSH_HARNESS_PROVIDER` 与 `cordis.yml`，
上线后用户拿到的是 `mock-llm.mjs` 的固定回答。这不是「未充分测试」，是「按当前配置翻开就是错的」。

**销账判据（三条同时成立）**：
1. `cordis.yml` 的 LLM 插件换成我方 `@platform/llm-adapters` 适配器（非 `mock-llm.mjs`），
   且 `DSH_HARNESS_PROVIDER` 有明确的生产取值；
2. 存在一条**接缝驱动**的组合测试（SEAM-GATE 判据），断言「生产实际传的那个 provider 值」
   端到端跑通 —— 不是各半 unit 绿；
3. 该测试的实参**就是生产实参**（不是另一个分支）。这一条必须被机器核，
   否则它自己就是本条要防的那个病。

### 前置 B · `STALL_LOOP` 护栏净减少

**事实**：我方 loop 有环检测，dsh 没有，POC 已**文档化放弃**。

- 我方：`apps/agentcore/src/agent/loop.ts:1153/1180-1182` —— 同签名（工具名 + 稳定序列化入参）
  累计调用 ≥ `loopRepeatCap` ⇒ 判无进度环 ⇒ 优雅降级 `STALL_LOOP`（唯一诚实出口 `degrade`，非 500）。
  出货 compose 已默认设 `LOOP_REPEAT_CAP=3`（`DEPLOY.md` Loop Control 五开关，
  由 `scripts/check-deploy-governance.mjs` 守门，删行即红）。
- dsh 侧：`apps/agentcore/src/dsh-runtime/reassemble.ts:10` 逐字写着
  「**`STALL_LOOP` 不可重建（dsh 无环检测——E6 三档 verdict 的「放弃或外壳保留」项），不出**」；
  `apps/agentcore/test/dsh-poc-acceptance.test.ts:192` 同口径称其为「**文档化放弃项**」；
  `docs/REPORT-dsh-poc-s0.md` §6 写「环检测是我方 `loop.ts` 自有机制，dsh 无此概念，
  **重建不了**，须外壳保留或放弃该观测位」。

**为什么这构成闸**：**翻 flag = 少一道安全护栏**。
这不是功能差异（少个观测位、屏上少一行），是**风险差异** —— 病态同签名循环在我方 loop 下被
出货 cap 早停，在 dsh 路径下会一直烧到超时。已有的回归测试
（`deploy-governance-seam.test.ts:128`「用出货 env 起真 app：病态同签名循环被出货 cap 早停，
不烧满 maxIterations=24」）**咬的是 `runAgentLoop` 那一半**，翻 flag 后它咬不到实际执行路径。

**销账判据**：
1. `dsh-runtime` 侧（`runner.ts` 或等价位置）补上环检测/看门狗，语义与 `loopRepeatCap` 对齐；
2. `deploy-governance-seam.test.ts` 那条断言存在一个 `DSH_HARNESS=1` 下的**对位副本**，
   同样能让「病态循环被早停」变绿 —— 而不是只证明「dsh 路径也会超时」（超时是第一层，
   环检测是第三层，两者不可互相顶账）；
3. 若决定**不补**而是「外壳保留」，必须写清外壳在哪一层拦、并给出对应断言。
   「放弃该观测位」不是本条的合法销账方式。

> ⚠️ **措辞订正（对派单口径）**：派单写「POC 已文档化放弃，说『进生产需在 runner 侧补 watchdog』」。
> 前半属实且有逐字出处（上引三处）；后半的「runner 侧补 watchdog」这句话
> **在 POC 分支上零命中**（`git grep -in watchdog` 在该分支只命中
> `apps/agentcore/src/router/orchestrator.ts` 里既有的 terminal watchdog，与 dsh 无关；
> 金丝雀：同一搜法数 `STALL_LOOP` 得 68 条 ⇒ 搜法正常）。
> 那是**审核方/派单方开的药方，不是 POC 的原话** —— 两者不可混记，否则下一个人会去
> POC 报告里找一段不存在的承诺。

### 前置 C · MCP `serverName` 是 root 级预约

**事实**：dsh 的 mcp-client 把 `serverName` 预约在**根级**，两个 agent 挂同名 server 会撞。

- `packages/dsh-harness/README.md:38`（「已知限制（S2 裁决项）」第 1 条）逐字：
  > 「dsh mcp-client 的 serverName 预留是根级的：两个 agent 挂同名 MCP server 会撞
  > duplicate namespace。S2 在「根级共享连接池 + scoped 可见性过滤」与「会话后缀改名
  > （破坏 `mcp__` 审计名）」之间选。」
- `packages/dsh-harness/plugins/platform-world.mjs:85-88` 给出机制：
  **`activeServerNames` 按 `ctx.root` 键控** —— 即命名空间的宿主是 root，不是会话、不是租户。
  同一行还写着「POC 期同 server 单 agent 先用直通」⇒ **POC 是靠「只有一个 agent」绕开的，不是解决了。**
- 契约侧对照：`docs/REPORT-harness-migration-feasibility.md` §3.3 的 `McpServerConfigSchema` 映射表
  13 个字段里，`serverName` 判「直接映射」，而 **`tenantId` 判「对面没有」**。

**为什么这构成闸**：本仓的铁律是 **tenant_id everywhere** —— 所有仓储读写、事件、缓存键都带
`tenantId`，跨租户访问一律 403/404。**root 级命名空间与它直接冲突**：
两个租户各自配一个 `serverName: "erp"` 的 MCP server，在 root 级预约下会撞
duplicate namespace。撞的结果只有两种，两种都不可接受：
① 后配的起不来（**跨租户互相拒绝服务**）；② 复用同一个连接（**跨租户数据串**）。

⚠️ 这条与前两条**性质不同**：A/B 是「验得不够 / 少一道护栏」，C 是**架构级冲突**，
在真多租户负载下必然触发，不是概率问题。故它排在最后但权重最高。

**销账判据**：
1. `serverName` 的命名空间宿主从 root 下沉到**至少携带 `tenantId`** 的作用域
   （README 给的两条路：「根级共享连接池 + scoped 可见性过滤」或「会话后缀改名」——
   后者破坏 `mcp__<serverName>__<tool>` 审计名，选它必须同批说清审计侧怎么补）；
2. 存在一条**负向**接缝测试：租户 A 与租户 B 各配同名 `serverName`，断言
   **两边都起得来 ∧ A 看不见 B 的工具 ∧ 工具全名在审计里仍可归因**；
3. 该测试必须在 `DSH_HARNESS=1` 下跑 —— 在我方原生 MCP 路径上绿**不构成**本条的销账。

---

## 4 · 审核方复核到、而 POC 报告没写的四条事实

> 这四条是审核方亲手复核的结果；本单**逐条独立复验过**（复验命令与实测数见 §5）。

### 事实一 · `packages/dsh-harness` 没有 `build` 也没有 `test` 脚本

`packages/dsh-harness/package.json` 的 `scripts` 只有两个：`start`（起 JSON-RPC stdio 服务）
与 `smoke`（自证冒烟）。**没有 `build`，没有 `test`。**

⇒ `pnpm -r build` / `pnpm -r test` **对这个包整包跳过**。

- **好处**：四包 gate 不受影响，POC 并入不会把交付底线拖红。
- **代价**：**常设门永远看不见这个包**。它是外部闭包的落脚点、是 `cordis.yml` 与
  四个插件（`platform-sdk-server` / `platform-governance` / `platform-world` / `mock-llm` / `echo-tool`）的家，
  而这些文件里的任何回归，`pnpm -r test` 一次都不会告诉你。
- **这本身是本仓记过的形态**：一个包在制度上属于 workspace、实际不进任何执行路径
  （同族 = 假绿第 5 形态「被制度指定的死门」）。**记在这里，不在本单修** —— 修它要动
  `packages/**`，超出本单范围边界。

### 事实二 · `apps/agentcore` 的 **`dependencies`** 新增了 2 个 developer-preview 包

`apps/agentcore/package.json` 的 **`dependencies`**（不是 `devDependencies`）新增：

```
"@deepseek-ai/dsh-sdk-client":   "0.1.0-rc.6",
"@deepseek-ai/dsh-sdk-protocol": "0.1.0-rc.6"
```

⇒ **flag 关着也照装、照进生产镜像。**

而 `packages/dsh-harness/package.json` 的 `description` 字段自陈
「…**38 包闭包与 cordis.yml 部署面收敛于此，agentcore 零侵入**」，
`README.md:4` 同口径写「agentcore 只经 `@deepseek-ai/dsh-sdk-client` + JSON-RPC stdio 驱动」。

**「零侵入」与这一条对不上。** —— 这不是指责，是**拍板必须算进去的账**：
「零侵入」在**代码加载**这个维度成立（D2/D3 守的就是它），
在**依赖闭包与镜像体积/供应链面**这个维度**不成立**。
两个 `0.1.0-rc.6` 的 developer-preview 包会随每次 `pnpm install` 装进 agentcore，
且 POC 报告 §3.Q1 自己实测过这套包的 **dist-tag 分裂**（多数包 `latest` 停在 `0.0.1-rc.1`，
裸装必 ERESOLVE，必须全量钉 `0.1.0-rc.6`）——「上游说变就变」在 preview 期是已演示过的形态。

### 事实三 · 锁文件里 `@deepseek-ai/*` 唯一包名实测 **43** 个（报告写「38 包闭包」）

POC 报告 §5 对照表写「闭包 | 38 包在独立目录，agentcore 零侵入」；
`packages/dsh-harness/package.json` 的 `description` 也写「38 包闭包」。

**实测 43。** 复验命令与金丝雀见 §5 事实三。

差值本身不改变裁决（43 与 38 都是「一大坨 preview 期外部闭包」），
**但这个数被写进了包描述与报告结论，属于会被下一个人直接引用的数** ——
本仓的账正是从这种「拿一个看起来相关的数字当判据」开始烂的，故照实订正。

### 事实四 · 休眠属实

- 全仓对 `@deepseek-ai` 的**静态** import **只有 1 处**：
  `apps/agentcore/src/dsh-runtime/runner.ts:13`。
- 到达它的唯一路径：`apps/agentcore/src/engine.ts:498` 的
  `await import("./dsh-runtime/index.js")`，外面包着 `engine.ts:497`
  `if (process.env.DSH_HARNESS === "1")`。
- 部署面（`docker-compose.yml` / `deploy/` / `Dockerfile*` / `*.env*`）实测**零处**设这个 flag。

⚠️ **一个必须点名的陷阱**：`runner.ts:60` 有
`join(harnessDir, "node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js")` ——
这是**字符串路径**，不是 import。朴素 `grep '@deepseek-ai'` 会把它算成第 2 处静态 import，
于是「休眠属实」被读成「已经扩散」，**结论正好相反**。
`check-dsh-dormancy.mjs` 有一条常驻金丝雀专门钉住这个形状
（`D2·必不咬·**字符串路径**不是 import（POC runner.ts:60 的真实形状）`）。

---

## 5 · 本单的独立复验（命令 + 实测输出 + 金丝雀）

> 报否定结论（「零处」「不存在」）时必须同时给金丝雀证据 —— 「我没找到」和「它不存在」是两个命题。

| # | 命题 | 复验方式 | 实测 |
|---|---|---|---|
| 事实一 | 无 `build` / 无 `test` 脚本 | `git show origin/claude/handoff-wo-dsh-poc-s1:packages/dsh-harness/package.json` | `scripts` 只有 `start` / `smoke`。**金丝雀**：同一份 JSON 里 `dependencies` 读出 11 条 + `devDependencies` 1 条 ⇒ 解析正常，不是读了个空文件 |
| 事实二 | 2 个包进 `dependencies` | `git diff origin/claude/verify-reclaim-6...origin/claude/handoff-wo-dsh-poc-s1 -- apps/agentcore/package.json` | diff 落在 `"dependencies"` 块内，`+@deepseek-ai/dsh-sdk-client` / `+@deepseek-ai/dsh-sdk-protocol`，`devDependencies` 块未变 |
| 事实三 | 唯一包名 43 个 | 抽 POC 分支 `pnpm-lock.yaml`，`/(@deepseek-ai\/[a-z0-9._-]+)/g` 去重计数 | **43**。**金丝雀**：同一搜法数 `fastify` 得 **45** 条 ⇒ 搜法正常，43 可信 |
| 事实四 · 静态 import | 只 1 处，且在白名单内 | `node scripts/check-dsh-dormancy.mjs --explain apps/agentcore/src/dsh-runtime/runner.ts`（在 POC 树上跑） | `白名单内：true` · `静态 import @deepseek-ai/… 1 处：L13 @deepseek-ai/dsh-sdk-client`。**正面证据**：扫描器**看得见**那一处 ⇒ 全树「白名单外 0 处」是真的 0 |
| 事实四 · 入口 | 只 1 处，且有 flag 判断 | `node scripts/check-dsh-dormancy.mjs --explain apps/agentcore/src/engine.ts`（POC 树） | `dsh-runtime 动态入口 1 处：L498 ./dsh-runtime/index.js（有 flag 判断）` |
| 事实四 · 部署面 | 零处开 flag | `node scripts/check-dsh-dormancy.mjs --census` | 部署面枚举 **8** 个文件（下界 5 且必含 `docker-compose.yml`，均已过）· `D1 部署面开 flag：0 处` |

**门在真 POC 树上的整体结论**：`RC=0`（代码已并、flag 未翻 ⇒ 门放行）。
**这是「代码可以并」这半句裁决的机器证据。**

### 5.1 真变异反证（在**已并入 POC 代码的树**上做，不是在样例上）

| 变异 | 期望 | 实测 |
|---|---|---|
| A · `docker-compose.yml` 给 agentcore 加 `- DSH_HARNESS=1` | RC=1 且**只**红 [D1] | ✅ `[D1] 部署面开了 flag：docker-compose.yml:118  DSH_HARNESS 被设为真值 1` |
| A′ · 改成 `- DSH_HARNESS=${DSH_HARNESS:-1}`（**缺省即开**） | RC=1 且**只**红 [D1] | ✅ `[D1] … ${DSH_HARNESS:-1} 缺省即开` |
| A″ · **反向对照**：`${DSH_HARNESS:-0}`（加固休眠） | RC=**0**（不许误伤） | ✅ RC=0 |
| B · 把 `runner.ts` 的静态 import 复制到白名单外 | RC=1 且**只**红 [D2] | ✅ `[D2] 静态 import 扩散到白名单外：apps/agentcore/src/mutant-spread.ts:1` |
| C · 把 `engine.ts:497` 的判断换成 `if (true)` | RC=1 且**只**红 [D3] | ✅ `[D3] 裸入口（动态 import 没有被 process.env.DSH_HARNESS 的判断包住）：apps/agentcore/src/engine.ts:498` |
| D · 加第二个入口（**哪怕也带判断**） | RC=1 且**只**红 [D3] | ✅ `[D3] dsh-runtime 入口 2 处，只许 1 处` |
| E · 从目录外**静态** import `./dsh-runtime/index.js` | RC=1 且**只**红 [D3] | ✅ `[D3] 裸入口（**静态** import dsh-runtime）` |

七发全部红在**对应那一条**上，**零误伤**（其余两条标签在输出里不出现）；
反向对照 A″ 证明门不是「见 `DSH_HARNESS` 就红」的哑门。

### 5.2 建门过程中被机器当场抖出的两个自伤（照 0.6 记账）

**两个都不是人想起来的，是金丝雀/真文件先说的话** —— 这正是机制该有的样子。

1. **`isDeployPath` 第一版把 `apps/frontend-shell/src/env.ts` 算进了部署面**
   （env 判据写成 `/(^|\.)env(\.|$)/`，`env.ts` 走 `^env` + 后跟 `.` 命中）。
   后果不是漏报，是**范畴错误**：前端源码里任何一处 `DSH_HARNESS` 字样都会被报成
   「部署面开了 flag」。形态：**「我用『文件名里有 env』当作『它是 env 文件』的证据。」**
   已改为「必须有字面的点把 `env` 隔开」，并补 5 条归类器金丝雀（含反向：`src/env.ts` 必不咬）。
   ——**发现方式**：`--census` 打出部署面 9 个文件，而 `git ls-files` 数出来是 8 个。
2. **`RE_STATIC` 的前缀 `(?:^|[\s;}])` 吃掉上一行的换行符 ⇒ 报出来的 `file:line` 整体偏 1 行**。
   POC `runner.ts` 第 **13** 行的 import 被报成 **L12**（门红了按行号点开是空行，
   读的人会以为门在瞎报）。已改为行号落在**关键字**上。
   ——**为什么原来那 22 条金丝雀一条都没抓到**：唯一相关的样例把 import 放在**第 1 行**，
   恰好走 `^` 分支，**永远测不出这个偏移**。已补一条把 import 放在第 4 行的金丝雀。
   **教训与本仓「金丝雀必须与主逻辑共用实现」同源，但更细一层：
   共用实现只保证「测的是同一份逻辑」，不保证「测到了那条分支」。**

### 5.3 顺带发现 · **登记一个「尚未合并」的东西，会被两道本体门当场判红**

本体回写做完第一版后，两道治理门各红一次，**两次都是门对的、我错的**，且暴露了一个
以后每张「先记账、后合并」的单都会撞上的形态：

| 门 | 机制 | 我的第一版为什么红 |
|---|---|---|
| `check-system-ontology.mjs` 判据③ | 把本体正文里反引号包着的 `apps\|packages\|scripts\|deploy/….ext` **一律当成真锚点**校验存在性 | 我写了 3 条只存在于 POC 分支的路径（`…/dsh-runtime/runner.ts`、`…/dsh-harness/plugins/mock-llm.mjs`、`…/dsh-harness/README.md`）—— 它们在 canonical 上**确实不存在** |
| `check-ontology-anchors.mjs` | `file:line` 形态进 `FILE_MISSING` 与 `UNVERIFIED_GROWTH` 棘轮（新锚点必须写成 `path:line (symbol)`） | 我在两块里写了 9 处 `x.ts:NNN`，其中 4 处指向 POC-only 文件、5 处让既有棘轮计数上涨 |

**这不是门做错了**：本体是**接线单一来源**，它有权要求「你写进来的路径必须真的在」。
冲突的真正来源是**本单的性质** —— 登记的是一件**已裁决、待合并**的事。
**处置**（已落地）：本体 §7/§8 里凡指向 POC 侧的路径一律**不写成锚点形态**
（路径不带扩展名、行号写成中文「第 N 行」），并在 §8 正文里**写清为什么这么写、
以及 POC 并入后应改回正规锚点**；精确的 `file:line` 全部留在本文件里
（`docs/` 不在那两道门的扫描面内）。

**A/B 实测**：两道门在「撤掉本单改动」与「带本单改动」两态下的报错**逐条一致**
（`check-system-ontology` 均为 2 条 `dist/` 缺失 —— 这个 worktree 没跑过 build，属环境；
`check-ontology-anchors` 均为 5 条 `LINE_DRIFT` + 2 条 `UNVERIFIED_GROWTH`，
仅行号因插入而 +1）⇒ **本单零新增缺口**。

---

## 6 · 本单**没有**做什么（不许把没做的读成做了）

- ❌ **没有合并**。POC 分支 `claude/handoff-wo-dsh-poc-s1` @ `6b9a7558` **未被 cherry-pick，
  未被 merge**，一个字节都没进 canonical。合并是审核方的动作，本单只出护栏与文档。
- ❌ **没有翻 flag**，也没有在任何部署面文件里写过 `DSH_HARNESS`（本单不碰 `docker-compose.yml`、
  不碰 `deploy/**`、不碰 `Dockerfile*`）。
- ❌ **没有验证 POC 报告里 E1–E6 断言的真伪**。「E3′ 负向租户隔离已绿」「E6 词表三档判定」
  「S2 kill 条件一次绿」这些自述**本单一条都没复核** —— 那是复验方（跑四包 gate + 接缝驱动）的活。
  本单只复核了 §4 那四条**静态可核**的事实。
- ❌ **没有跑 `pnpm -r build` / `pnpm -r test` / `scripts/gate.sh`**（派单纪律：
  审核方此刻正在跑四包 gate，4 核机不许并发重画像）。本单只跑
  `node scripts/check-dsh-dormancy.mjs` 及其自变异样例。
- ❌ **没有把门接进 `pnpm gates` 串**。本单范围边界禁改 `package.json` 与 `scripts/gate.sh`
  ⇒ 门账 `binding=NONE` / `disposition=WIRE`，**接线属治理裁量，由审核方定**。
  ⚠️ 这意味着**门今天不会自动跑** —— 在它被接进链之前，§1 那句「不能翻」仍然靠人记得。
  见 §7 遗留。
- ❌ **没有修事实一那条**（`packages/dsh-harness` 无 `build`/`test` ⇒ 常设门看不见整包）。
  修它要动 `packages/**`，超出本单范围边界。已登记为遗留。

---

## 7 · 遗留（下一张单）

| # | 遗留 | 为什么本单不做 | 建议处置 |
|---|---|---|---|
| 1 | `dsh-dormancy:check` 未接进 `pnpm gates` 串 | 范围边界禁改 `package.json` / `scripts/gate.sh` | 接进 `gates` 串（`binding` 转 `GATES_CHAIN`，`pendingWireCount` 当场回落）。**在此之前本门是「已建未接线」，护栏只在有人手动跑时生效** |
| 2 | `packages/dsh-harness` 无 `build` / 无 `test` ⇒ 常设门整包看不见 | 要动 `packages/**` | 若决定长期保留该包，至少补一个 `test` 脚本把 `smoke.mjs` 挂上去；否则它的任何回归都不会有人知道 |
| 3 | 事实二的「零侵入」文案与 `dependencies` 实况对不上 | 要动 `packages/**` / `apps/**` | 合并时同批把 `package.json` 的 `description` 与 `README.md:4` 改成真话（如「代码加载零侵入；依赖闭包侵入 2 个协议包」），或把两个包挪进 `devDependencies` 并验证生产路径不需要它们 |
| 4 | 事实三的「38 包」写在包描述与报告结论里 | 同上 | 合并时同批订正为 43，或改成不写死数字 |
| 5 | E1–E6 断言真伪未核 | 是复验方的活 | 复验方走「四包 gate + 接缝驱动通」两条判据 |
| 6 | 本体 §7/§8 里指向 POC 侧的路径目前是**非锚点形态**（见 §5.3） | 那些文件在 canonical 上还不存在，写成锚点会红 | **POC 并入的同一批**把它们改回 `path:line (symbol)` 正规锚点；不改的话本体这两块永远享受不到锚点漂移保护 |

---

## 8 · 本体引用与影响

| 维度 | 内容 |
|---|---|
| **新增断点** | `G-DSH-DORMANT-UNGUARDED`（§8）—— 「休眠分叉没有任何机制拦住以后有人打开」 |
| **新增门禁** | `dsh-dormancy:check`（§7）· `scripts/check-dsh-dormancy.mjs` · 门账 `scripts/gate-ledger.json` |
| **触及不变量** | **tenant_id everywhere**（前置 C 与之直接冲突，是该条前置存在的理由）· **Entitlement 先于 authz**（不受影响：dsh 换的是执行层，entitlement 仍在 AgentCore 外壳）· **错误信封**（不受影响：`reassemble.ts` 把 dsh 帧重组装回我方 `Answer`） |
| **触及链路** | agent 执行链 `engine.ts → runAgentLoop`（休眠分叉在此插入第二条支路 `engine.ts:498 → dsh-runtime/index.js`，**flag 关时不存在**） |
| **触及事件** | QOS SSE 事件面 —— POC 自述 15 个事件里 `agent_degraded` 的 `STALL_LOOP` 一态**重建不了**（前置 B 的由来）。**本单未新增/未改任何事件名** |
| **未改动** | 对象类型 · 求解器 · 金值 · 契约 —— 本单是纯门单 + 纯文档单，不碰 `apps/**` / `packages/**` |

---

## 9 · 一句话交底

> **并进来的是一台已经装好、没通电的机器；本单做的是把闸刀锁上，并写清三把钥匙分别在谁手里。**
> 锁是 `scripts/check-dsh-dormancy.mjs`（**待接进 `pnpm gates` 才自动生效**），
> 钥匙是 §3 的三条前置条件。
