# 裁决 · 外部 agent 运行时（dsh）融合

> **状态**：已裁决 · 护栏已落地
> **日期**：2026-08-16
> **对象**：POC 分支 `claude/handoff-wo-dsh-poc-s1` @ `6b9a7558`（S1→S4 四个提交）
> **本单**：`WO-DSH-FUSE-GUARDS`（门单 + 文档单；不碰 `apps/**` / `packages/**` / `pnpm-lock.yaml`。
> `package.json` 原在禁改之列，审核方复核时判定那是派单范围划错并当场放开，仅用于把本门接进 `gates` 串）
> **相关**：`docs/REPORT-dsh-poc-s0.md`（POC 自述）· `docs/REPORT-harness-migration-feasibility.md`（可行性）·
> `scripts/check-dsh-dormancy.mjs`（本裁决的机器执行体）· `docs/SYSTEM-ONTOLOGY.md` §7 / §8 `G-DSH-DORMANT-UNGUARDED`
>
> ⚠️ **POC 的交付面有两半，引用时必须分清**：**分支面**（`claude/handoff-wo-dsh-poc-s1` 上的代码与
> `docs/REPORT-*.md`）⊕ **报告面**（POC 测试结果报告 `dshpoctestresults.md`，**只在对话里流转、
> 从没提交进分支**）。**在分支上 grep 不到，不等于 POC 没说过** —— 本文件 §3 前置 B 末尾
> 记着我因此写反过一条结论。全文引用一律标注「POC **分支** `file:line`」或「POC **报告** §N」。

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

`scripts/check-dsh-dormancy.mjs` 守三条，任一破即 **RC=1**。
**已并入 `pnpm gates`**（55→56 条治理门，别名 `dsh-dormancy:check`，门账 `binding=GATES_CHAIN`）⇒ **每次 gate/CI 真跑**，
不靠人记得手动跑。（第一版交付时是「已建未接线」，见 §6 与 §7 遗留 1 的处置记录。）


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

> **📌 销账进度（2026-09-08 · WO-DSH-UNFREEZE 实测）→ 见 §13。**
> 三条**判据面均已销账**（A 判据 1/2/3 · B 判据 1/2 · C 判据 1/2/3），
> 证据为亲手跑出的对照实验，非台账转述。**但 §13 同时登记了 3 条剩余风险**
> （含一条**真实外部供应商一跳仍未跑过**）——**裁决结论不变，翻不翻由仓主看证据后定。**
> ⚠️ 本节 §3 前置 A/B/C 的**正文一个字未改**（含那些已被实测推翻的 `file:line` 描述），
> 改的只有本指针 + 新增 §13。要引用现状请读 §13，**别直接引用 §3 正文的行号与代码片段**。

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
   > 订正（2026-08-21，W3 审计 A-d1 字面偏差裁决登记）：落地形态不是 `@platform/llm-adapters`，
   > 而是 harness 侧 `plugins/platform-llm.mjs` 委托 `@deepseek-ai/dsh-llm-pi-ai` 出线；我方所有的
   > 是连接事实单源（绑定矩阵 `resolveConnectionFacts` + 凭据解密注入）。判据按意图已销
   > （非剧本、生产取值明确、凭据从我方矩阵出、key 零上帧，真跳实证见 W3 审计）。
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
- dsh 侧（**分支面**）：`apps/agentcore/src/dsh-runtime/reassemble.ts:10` 逐字写着
  「**`STALL_LOOP` 不可重建（dsh 无环检测——E6 三档 verdict 的「放弃或外壳保留」项），不出**」；
  `apps/agentcore/test/dsh-poc-acceptance.test.ts:192` 同口径称其为「**文档化放弃项**」；
  `docs/REPORT-dsh-poc-s0.md` §6 写「环检测是我方 `loop.ts` 自有机制，dsh 无此概念，
  **重建不了**，须外壳保留或放弃该观测位」。
- dsh 侧（**报告面**）：POC 测试结果报告 `dshpoctestresults.md` §7「已知限制（文档化放弃项，
  不粉饰）」第 1 条明写「**进生产需在 runner 侧补 watchdog**」。
  ⚠️ 该报告**不在分支上**（只作为对话交付物存在）—— 见本节末尾的方法论记账。

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

**「进生产需在 runner 侧补 watchdog」的出处**：POC 测试结果报告
`dshpoctestresults.md` §7「已知限制（文档化放弃项，不粉饰）」第 1 条，原文：

> **`STALL_LOOP` 不可重建**：dsh 无环检测，我方 `STALL_LOOP` 降级理由在 dsh 路无法重组装
> （E6 已列入「外壳保留/放弃」档）。**进生产需在 runner 侧补 watchdog。**

⇒ 这句话**是 POC 的原话**，不是审核方事后开的药方。上面「销账判据」第 1 条
（`dsh-runtime` 侧补环检测/看门狗）正是对它的落地，两者同源。

> ### ⚠️ 方法论记账 · 这一条我第一版写反了，形态是本仓的老病
>
> **第一版原文**（已删）：我据 `git grep -in watchdog` 在 POC **分支**上零命中，
> 判「那是审核方/派单方开的药方，不是 POC 的原话」。
> **grep 没错，结论错了。** 那句话在 `dshpoctestresults.md` 里白纸黑字写着，
> 而**那份报告只作为对话交付物存在、从没提交进分支**，所以分支上必然零命中。
>
> **形态**（`CLAUDE.md` 铁律 0.6 句式）：
> > **「我用『它不在这个分支上』当作『它不是 POC 说的』的证据，而前者并不度量后者。」**
>
> 而且这次连金丝雀都救不了我 —— 我确实跑了金丝雀（同一搜法数 `STALL_LOOP` 得 68 条，
> 证明 `git grep` 是好的），于是「工具没坏 ⇒ 零命中是真的零」这一步是对的，
> **错在下一步**：把「在这个扫描面里是真的零」直接读成「在世界上不存在」。
> **金丝雀证明的是工具没瞎，不是扫描面选对了。** 扫描面选错时，
> 金丝雀会陪着你一起给出一个自信的错误答案。
>
> **判据（以后引用 POC 结论一律照此）**：
> 1. **出处判定不能只查分支** —— POC 的交付面 = 分支代码 ⊕ **分支外的报告**
>    （`dshpoctestresults.md` 这类只在对话里流转的独立交付物）。
>    分支不是 POC 产出的全集。
> 2. **引用时必须标明来自哪一面**：写「（POC **报告** §7）」或「（POC **分支** `x.ts:NN`）」，
>    不许只写「POC 说」。本文件已按此改：§3 前置 B 的三处分支内引用保留 `file:line`，
>    报告内引用标注为「POC 报告 §7 已知限制第 1 条」。
> 3. **报「某话不存在」之前，先问「我扫的这个面，是它该在的面吗？」**
>    ——「工具没瞎」和「面选对了」是两个命题，前者不蕴含后者。

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
- ✅ ~~没有把门接进 `pnpm gates` 串~~ —— **第一版确实没接，现已补接**。
  第一版交付时门账是 `binding=NONE` / `disposition=WIRE`，理由是本单范围边界禁改 `package.json`
  与 `scripts/gate.sh`。**审核方复核时判定那是派单范围划错**（「造出的正是本仓有门在防的那个状态：
  已建未接线」），当场放开这两处，本单随即补接：`package.json` 加别名 + 追加进 `gates` 串尾。
  **`scripts/gate.sh` 一个字没改** —— 它把门数 `GATES_N` 从 `package.json` **现算**
  （自陈「出处唯一 = package.json 的 gates 脚本，这里只做投影」），接 `gates` 串即自动进 `gate.sh`；
  改它反而会造出第二处真值。**验收证据**：`pendingWireCount` 棘轮余量**退回来了**
  （接线前现算 14 = 基线 14 压线，接线后现算 **13**），`binding` 现算 `GATES_CHAIN`
  （`callers=package.json:gates`），`ontology-writeback:check` 打印「pnpm gates 含 **56** 个 check 门 · §7 漏登 0」。
- ❌ **没有修事实一那条**（`packages/dsh-harness` 无 `build`/`test` ⇒ 常设门看不见整包）。
  修它要动 `packages/**`，超出本单范围边界。已登记为遗留。

---

## 7 · 遗留（下一张单）

| # | 遗留 | 为什么本单不做 | 建议处置 |
|---|---|---|---|
| 1 | ~~`dsh-dormancy:check` 未接进 `pnpm gates` 串~~ | ~~范围边界禁改 `package.json` / `scripts/gate.sh`~~ | ✅ **已闭**（审核方放开范围后同单补接）：`binding` 转 `GATES_CHAIN`，`pendingWireCount` 由 14 回落 **13**，`pnpm gates` 门数 55→**56** |
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
> 锁是 `scripts/check-dsh-dormancy.mjs`（**已接进 `pnpm gates`，每次 gate/CI 真跑**），
> 钥匙是 §3 的三条前置条件。

---

## 10 · 补遗（2026-08-20）· WO-AGENT-KERNEL-SELECT：per-agent 激活路径开通

**变化**：`AgentDefinition.kernel`（additive 可选字段）把「走不走 DSH」从进程级 env 单源升级为
**agent 显式配置优先、缺省回落 env**。分叉守卫（`engine.ts`）改为
`agent.kernel === "EXTERNAL" || (agent.kernel === undefined && process.env.DSH_HARNESS === "1")`，
D3 词法判据不受影响（守卫仍字面直读 `process.env.DSH_HARNESS`，门 + selftest 全绿）。

**诚实登记（门的新盲区，不许当成「仍被门全包住」）**：
- D1/D3 守的是**仓内部署面与源码面**；`agent.kernel` 住在 **DB 里的 agent 定义**，
  任何 catalog admin 经管理台 PUT 即可开通单 agent 的 DSH——**此路径两门都看不见**。
- 因此 §3 三条前置条件的约束面**自动延展**：在任何真实租户把某 agent 置 `kernel=EXTERNAL`，
  等同于对该 agent 翻 flag，前置 A/B/C 须逐条销账（缺省 ≡ NATIVE，seed 12 agent 零改动即全原生）。
- 缓冲事实（不是豁免）：① PUT/PUBLISH 走 `requireCatalogAdmin` 且 PUBLISHED 版本不可变
  （改动必留新版本轨迹）；② run 归因 `run.kernel` 逐条落库，事后可审计「哪些运行真走了外部运行时」；
  ③ 前端选择器词表与归因同词（NATIVE/EXTERNAL），不给「配置了但没生效」留歧义。

## 11 · 补遗（2026-08-20）· WO-DSH-PROD-READY W1：POST_CHECK 后验挂 DSH 路径（最大语义差销账）

**变化**：`PRD-agentcore-dsh-upgrade.md:129` 登记的 ⛔ 缺口「ruleBindings POST_CHECK / BOTH
POC 未接」销账——但**落法不是**原计划的 WO-DSH-P1-MAP（harness `tools/post-execute` 瀑布 +
裁决网桥）。实际落法更保守：`engine.ts` 把两段 postcheck 后验（Skill 规则引用后验 +
ruleBindings POST_CHECK）提为 `runRegisteredAgent` 内共享闭包 `applyPostChecks`，DSH 成功出口
与原生出口**逐字节同码**过同一份后验。理由：后验语义单源优于桥进子进程瀑布（桥 = 在子进程里
再实现一份裁决，两份实现必漂；这正是本仓「不许另抄一份」铁律的同族病）。

**语义钉**：
- 只判 `outcome === "ANSWERED"`；reassemble 拒绝（FAILED 早退）无答案可验，不过后验。
- stats 回声（N2·D-2）与治理替换**正交**：后验 BLOCK 换掉的是答案内容，token/轮次等运行
  观测回声不随答案消失——stats 在闭包之后重挂（对拍驱动 A4 锚「dsh 臂必带 stats」不按
  后验结果分支）。
- fail-open 语义双臂一致：rules 引擎抛错 ⇒ 放行（不把后验故障变成答案故障）。

**机器证据**：`dsh-postcheck.seam.test.ts` 4 臂（POST_CHECK BLOCK 替换 / 通过放行且后验真跑 /
skill postcheck 引用 BLOCK / fail-open）+ mutation 反证（DSH 出口绕过后验 ⇒ ①②③ 红）+
dualrun50 58/58（deny_pre/mid/all 12 条此前靠白名单容忍的语料现双臂逐字节收敛，
RECONCILIATION evidence 2b 作废）+ D3 门/selftest 绿。

**对 §3 前置条件的意义**：本项不等于「flag 可翻」——W3 审计（`/tmp/dsh-prod-ready-evidence/
w3-precondition-audit.md`）另发现 F-1：生产档 cordis.yml 的 platform-governance 仍 mock
allow-all，DSH 路径 PRE_CHECK 静默失效，建议升为第四条前置，处置另案。

**F-1 已接线（2026-08-21，WO-DSH-PROD-READY F-1 线）**：生产档 `cordis.yml` platform-governance
切 `mode: 'http'`（删 `deny: []`），engine DSH 分叉逐 run 经 env 缝注入 `PLATFORM_GOV_URL`
（缺省推导本进程 `/b/v1/governance/adjudicate`，`DSH_GOV_URL` 可覆盖）与 `PLATFORM_GOV_TOKEN`
（= `SERVICE_TOKEN`，不落盘）；fail-closed 链三段（无 url 初始化抛错 / 401 / 不可达皆转 deny）
未削弱。机器证据：新缝 `dsh-gov-production.seam.test.ts` 五臂（真端点 BLOCK deny 理由逐字回灌 ∧
零执行 / 放行真执行 / 不可达 fail-closed / 401 fail-closed / 不钉 DSH_GOV_URL 缺省推导真打到）
+ mutation 反证三招红（含缺省推导路径段写错 ⇒ ⑤ 红）+ 既有 DSH
套件全绿（证据指针：`/tmp/dsh-prod-ready-evidence/f1-gov-*.txt`，分支 `claude/wo-dsh-prod-f1-gov`）。
PRD §6 已同步增列第四条前置并标已销。

## 12 · 补遗（2026-08-21）· WO-DSH-PROD-READY W7：灰度方案与推广/回退判据

见 `docs/ROLLOUT-dsh-external-kernel.md`——W9-lite 计费口径翻转的阻塞性前置观察面、G0→G3 三档推广/回退判据（初值）、灰度期已知差异白名单与观测面边界登记。本文 §3 前置条件仍是闸，灰度文档一个字不放宽。

## 13 · 三条前置条件 · 销账记录（2026-09-08 · WO-DSH-UNFREEZE）

> **取证头**：base commit `1ca9c729`（= canonical `origin/claude/inspiring-gates-aqczjg`）·
> 取证时刻 2026-09-08 04:03–04:20 UTC · `dsh-dormancy:check` **RC=0**（金丝雀 28/28）·
> 产品源码改动 **0 行**（`git diff --stat canonical...HEAD` 只有一个临时取证测试件，交付前已删）。
>
> ⚠️ **本节只加销账证据，不改 §1 裁决结论**。「代码可以并，flag 不能翻」仍然成立；
> 本节回答的是「三把钥匙现在在不在手里」，**不是**「现在就该翻」。

### 13.1 派单前提被实测推翻的部分（照铁律 0.6 第 5 条，先记这一条）

本单派单书把三条前置一律描述为**待做**。实测：**三条的判据面在 2026-08-17 → 08-25 之间
已由 `WO-DSH-N1-PROVIDER` / `N3` / `N4` / `PROD-READY W1·W3·W8` / `F-1` / `GOV-CREDENTIAL`
陆续落地，只是没有任何人回写 §3。** 形态与本仓记过的第 5 条同构：

> **「我用『§3 那三条还写着待销账』当作『这活还没做』的证据，而前者并不度量后者。」**

§3 正文里**已过期、照着读会得出相反结论**的具体行（正文保留原样，此处点名）：

| §3 原文 | 今天实测 |
|---|---|
| 前置 A「`engine.ts:509` 写的是 `provider: … ?? "mock"` ⇒ 只翻 `DSH_HARNESS=1` 走的仍是 mock」 | **该回落已根除**。`config.ts:7` `PRODUCTION_DSH_HARNESS_PROVIDER = "platform"`，`config.ts:80` `DSH_HARNESS_PROVIDER` **缺省即 `platform`**；`dsh-provider-seam.test.ts` A1 用 grep 钉死 engine 分叉段不得复活 `?? "mock"` |
| 前置 A「`cordis.yml` 尾部应答的是本地 `plugins/mock-llm.mjs` 写死剧本」 | **生产档已摘除 mock-llm**，挂 `plugins/platform-llm.mjs`；mock-llm 迁至测试专档 `cordis.poc.yml`（A2 双向锚定：生产档不含 ∧ poc 档必含） |
| 前置 B「dsh 没有环检测，POC 已文档化放弃」 | **已补**：`packages/dsh-harness/plugins/platform-watchdog.mjs`（2026-08-17 `WO-DSH-N3`），cumulative-per-signature，cap 同 env 源 `QOS_AGENT_LOOP_REPEAT_CAP` |
| 前置 C「`platform-world.mjs:85-88` `activeServerNames` 按 `ctx.root` 键控 ⇒ root 级」 | **已下沉**：`plugins/mcp-client-tenant.mjs`（vendor fork）池键 = `` `${tenantId}\0${serverName}` ``；无 tenantId 退化为原语义 |
| §7 遗留 2「`packages/dsh-harness` 无 `test` 脚本 ⇒ 常设门整包看不见」 | **已闭**：`package.json` 的 `scripts.test` = `node test/run.mjs`（今日实测 13/13 通过 + drift-check PASS） |

### 13.2 逐条销账结论

| 前置 | §3 的销账判据 | 今天的证据 | 结论 |
|---|---|---|---|
| **A** 真 provider | ①`cordis.yml` 换我方适配器 + `DSH_HARNESS_PROVIDER` 有生产取值 | 生产档挂 `platform-llm.mjs`；缺省 = `platform`（`dsh-provider-seam` A2/A1） | ✅ |
| | ②接缝驱动的组合测试，断言**生产实际传的那个 provider 值**端到端跑通 | `dsh-provider-seam` **A3**：engine 分叉 → `resolveConnectionFacts` 剥 `dcp:` → env 注入子进程 → 真 HTTP OpenAI-completions 端点 ⇒ `ANSWERED` ∧ stub 见 `model` 无前缀 ∧ `Authorization=Bearer <key>` | ✅ |
| | ③该测试实参**就是生产实参**，且被机器核 | A1 断言 `PRODUCTION_DSH_HARNESS_PROVIDER==='platform'` ∧ `loadConfig({}).DSH_HARNESS_PROVIDER` 与之同值；A3/A4/A5 传的是**该常量本身**（非字面量） | ✅ |
| **B** STALL_LOOP | ①runner 侧补环检测/看门狗，语义对齐 `loopRepeatCap` | `platform-watchdog.mjs`：同签名累计（**刻意不采 stock 的 consecutive-chain**，否则 A-B-A-B 交替逃逸）· meta 工具不计数（对位 `loop.ts:1171`）· opt-in 缺省禁用（对位 `loop.ts:533`） | ✅ |
| | ②`deploy-governance-seam` 那条断言存在 `DSH_HARNESS=1` 下的**对位副本** | 同文件 **③′**（出货 env + `DSH_HARNESS=1` ⇒ 病态同签名循环在 cap 处被 watchdog 打断、`STALL_LOOP`、`agentLoopRepeat` 计 1）+ **④′ 归因臂**（仅去掉 cap ⇒ 无降级、烧满 8 轮） | ✅ |
| | ③若选「外壳保留」须说清在哪层拦 | **不适用**——选的是「补」不是「保留」 | — |
| **C** MCP 命名空间 | ①命名空间宿主下沉到至少携带 `tenantId` | 池键 `` `${tenantId}\0${serverName}` ``（`mcp-client-tenant.mjs`）；走的是 README 给的「根级共享连接池 + scoped 可见性过滤」路，**未改公开名** ⇒ `mcp__<serverName>__<tool>` 审计名逐字节不变 | ✅ |
| | ②负向接缝测试：双租户同名 ⇒ 两边都起得来 ∧ A 看不见 B ∧ 审计仍可归因 | `dsh-e2e-tenant-collision` **L4.A1**（各回各 `whoami:` 标记 / 事件流零跨租户串字 / 工具表各只见各 / pidFile 恰 2 异 pid）· **L4.A2**（allow-list 误配异租户工具名仍 `isError` fail-closed）· **L4.A3**（跨租户凭据解析 fail-closed ∧ 凭据零上帧）· harness 侧 **P1/P2** | ✅ |
| | ③必须在 dsh 路跑，原生路绿不算 | 全部经 `runDshAgent`（真子进程 + JSON-RPC wire + 生产档 `cordis.yml`）；harness 侧套件以 `DSH_HARNESS=1` 为**断言前置**（不满足即抛） | ✅ |

### 13.3 六格对照实验（亲手跑，非引用）

| # | 实验 | 观测 |
|---|---|---|
| **A** | mock 路 vs 生产 provider 路的**回答原文** | mock 路：`structured answer via dsh final_answer`（`mock-llm.mjs` 写死串，与提问无关）<br>生产路（`provider=platform` + 生产档 `cordis.yml` + http 治理）：`真 provider 应答 X：常州基地 9 月缺口 1200 台` |
| **E** | 判别力金丝雀 | 同一条生产路，把上游应答换成 Y ⇒ 回答变成 `真 provider 应答 Y：完全不同的另一句结论`。**换输入回答就变 ⇒ 观测有鉴别力**，不是写死剧本 |
| **B1** | 病态同签名循环 | 关 watchdog（不给 cap）：**烧满剧本 8 轮**（`tool/call`×8，`ANSWERED`，无降级）<br>开 watchdog（cap=3）：**第 3 轮停**，`turn/end` 落 `{kind:'stall-loop', tool:'echo_tool', count:3, cap:3}` ⇒ `BUDGET_EXHAUSTED` + `STALL_LOOP`；cap=4 ⇒ 停在 4（**cap 由 env 驱动非硬编码**） |
| **B2** | 反向对照（不误杀） | 异参多轮（`stall_loop_varying`）cap=3：**8 轮全跑完 ∧ `ANSWERED` ∧ 零降级 ∧ 连 advisory 档都没触及**；同参 `final_answer` 8 轮（meta 守卫）同样不误杀 |
| **C** | 双租户同名 MCP server | **撞车前**（把池键改回 root 级 `` `\0${serverName}` ``，真变异）：harness 套件 **7/13 红** —— `P1` 两租户**只起 1 只**子进程（期望 2）；`A4` 租户 B 调自己的 `whoami` **拿回 `whoami:tA`** = **跨租户数据串**；`A3` B 连自己的独有工具都看不见<br>**撞车后**（现行池键）：**13/13 全绿**，pidFile 恰 2 异 pid，各回各标记 |
| **D** | 休眠不变 | 产品源码 **0 行改动** ⇒ `DSH_HARNESS=0` 全链逐字节相同（非推断：`git diff --stat canonical...HEAD` 仅一个临时测试件）；`dsh-dormancy:check` **RC=0**，金丝雀 28/28，扫描面 部署面 8 / 源码面 705（下界 5/200 均过） |

⚠️ **C 的「撞车前」是真变异实测，不是引用测试注释**：改的是 `mcp-client-tenant.mjs` 的池键那一行，
跑完即按备份逐字节还原（`git diff` 空 + 还原后复跑 13/13）。

### 13.4 剩余风险（**翻 flag 前仓主需要看的就是这一段**）

| # | 风险 | 性质 | 定性 |
|---|---|---|---|
| **R1** | **真实外部供应商一跳从未跑过。** 判据面已销账，但 A3/L4 等全部打在**本地 stub OpenAI-completions 端点**上。真供应商臂 `dsh-e2e-real-triad.test.ts` L2.A1/L2.A4 **存在但由 env 门控**（`KIMI_API_KEY`/`KIMI_BASE_URL`），本机无凭据 ⇒ **skip**（实测 `api.anthropic.com` 可达但 401 无 key） | **验证面缺口** | §3 前置 A 判据 1/2/3 的字面要求**不含**「必须打真供应商」，故判据已销；但派单书那句「真的用生产 provider 路跑通一次」在**外部供应商**这一层**未兑现**。翻 flag 前建议在有凭据的环境跑一次 L2.A1/A4 |
| **R2** | **`sliceSolverKeys` 规划自检不过 dsh 路。** `engine.ts:539` 算出、`:844` **只传给 `runAgentLoop`**；dsh 分叉段（`:630–800`）**零引用** | **观测面缩小**（非阻断——该自检本身就「不阻断真工具」，只记 `planFellBackToReAct`） | 翻 flag 后这条指标在 EXTERNAL 运行上恒不产出。不是安全护栏净减少，但**是「翻了之后有个指标会静默变空」**，别当成指标下降 |
| **R3** | **数字红线是「标注」不是「阻断」，两路皆然。** `unverifiedNumerics` 由 `scanBlocks`（`util/numerics.js` 单源）在 dsh 路照算（`reassemble.ts:544/573/660`），`provenancePolicy=required` 也照拒（`:633-635`）；但裸数只被**标记**，不被拦下 | **平台级属性，非 dsh 退化** | 见 §13.5 |

**不构成风险、但必须说清的两条**（防被读成「dsh 把它弄坏了」）：
`QOS_AGENT_PER_TOOL_CALL_CAP` 在**注册 agent 路上原生也没接**（只在 `router/orchestrator.ts:2083` 的自由问答路），
故 dsh 分叉在此**无 delta**；`agent.kernel=EXTERNAL` 绕过两道门这件事 **§10 已登记**，本单未改变。

### 13.5 架构定位补注（仓主 2026-09-08 定）· 以及一条**第 4 条前置候选**

> 仓主原话：「**所有计算原则上使用求解器而不是 agent(LLM) 来计算，agent 只负责调动工具、本体、规则等等输出结果，
> 然后基于结果推演，形成多个方案和方案比对。**」

⇒ **dsh 在本平台的定位是编排层 / ReAct 指挥层，不是计算层。** 与该定位对表的实测：

- ✅ **能调到求解器，且不是第二份实现**：dsh 路的工具执行走**反向通道** `/b/v1/dsh/tool-execute`，
  执行体是 engine 逐 run 铸进 `dshToolExecuteRuns` 的**同一个 `executor`** ⇒ `invoke_solver`
  与原生路**同一条执行路径**（`tools/executor.ts:418`），无重写、无第二真值。
- ✅ **「不许自己算」的纪律真的送达了 dsh 路**：`AGENT_SYSTEM_CORE`（含【数字红线】「禁止估算、推断或从记忆中给出数字」
  与【求解纪律】「禁止你自己心算或估算，必须调对口 solver」）经 `engine.ts:667` → `setup-spec.ts:265`
  拼进 dsh 的 `persona`。**不是只写在原生路的 prompt 里。**
- ⚠️ **但「阻止」这件事，两条路都只做到「检测 + 标注」**：裸数触发 `unverifiedNumerics=true`（诚实标），
  `provenancePolicy=required` 时缺 provenance 会**拒**收尾——除此之外，**没有任何机制阻止模型把一个编出来的数字写进答案**。

> **⇒ 建议登记为第 4 条前置（候选）**：「dsh 路上有没有机制阻止 agent 自行产出数值」——
> 答案是**有检测、有标注、required 档有拒绝，但没有无条件阻断**。
> ⚠️ **它不是 dsh 引入的退化**（原生路同款），所以**按 §3 的体例它不该挡 dsh 的闸**；
> 但既然 dsh 的价值定位就是「调工具不算数」，**翻 flag 会把这条平台级弱点放到更显眼的位置**，
> 故照仓主要求在此点名，由仓主裁决要不要升为正式前置。
