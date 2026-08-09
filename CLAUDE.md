# CLAUDE.md — 全域数字化智能决策支撑系统

类 Palantir Foundry/AIP 的双系统决策平台 monorepo（pnpm workspace, Node ≥20, TS strict, zod 4）。

## ⛔ 铁律 0 · 先读系统本体（违反即返工）

**产出任何 PRD / 架构变更 / 跨模块改动，或回答"改 X 会影响什么 / 为什么这里断了"之前，必须先完整阅读 `docs/SYSTEM-ONTOLOGY.md`（平台自我元模型 = 系统接线单一来源），或调用 `/ontology` skill。**

- 分析必须**沿链路走**（本体 §3），断点常在接缝而非模块内部；牢记"**绿测试 ≠ 能用**"。
- 任何 PRD / 架构文档**必须含《本体引用与影响》一节**：列出触及的对象类型 / 链路 / 事件 / 不变量(R1–R12) / 断点(G-1…G-8)。
- 若改动**新增或改变了链路 / 事件 / 对象类型 / 不变量 / 门禁 → 必须回写 `docs/SYSTEM-ONTOLOGY.md` 对应章节**（本体不回写即过期失效）。
- 命名**禁用外部产品名**（如 某参考的产品，是参考产品），用平台自有术语。

## ⛔ 铁律 0.5 · grep 的结果不是结论——**必须再追一层调用**（违反即返工·已真实发生 4 次）

**凡要下「X 没有消费方 / X 是死代码 / X 没接线 / 这道门今天做不了」这类判断，`grep` 只是线索，不是证据。
必须沿调用链再追至少一层，追到「真正被谁调用、在什么条件下触发」为止，才允许下结论。**

> **来历**：2026-08-03 一天之内，我（审核方）对 dev 与自己的产出连下四个错误结论，**其中三个是同一个病**——
> 拿 grep 的直接命中数当结论，少追一层间接调用：
> ① 判「`dependsOn` 无消费方」→ 实有 `skill-lint.ts:212/302` + `resource-projector.ts:334`，
>    真相是**接了线但数据为空所以从没触发**（"接了线没数据" ≠ "没接线"，修法完全不同）。
>    ⚠️**本条自身于 2026-08-09 部分过期，照 0.6 回写**：原文写「7/7 数据为空」，
>    把 `dependsOn` 与 `references` **两个不同字段合成了一句** —— 亲手实测
>    （`apps/agentcore/src/mocks/seed.ts`）：`dependsOn` 当时 **0 条**（确为「接了线没数据」），
>    而 `references` **已有 7 条种子、其中 6 条非空**（已是「接了线有数据、会触发」）。
>    两者定性不同、修法不同，**必须拆开说**。这条戒律自己犯了它警告的病：
>    拿一个笼统数字盖住两个不同事实。
>    ✅ **2026-08-09 晚已闭**：收编 `WO-SKILL-PARTIAL-A` 后 `dependsOn` 从 **0 → 1 条**
>    （`mocks/seed.ts:1350` `sop_meeting --dependsOn--> capacity_analysis`），
>    「接了线没数据」这一态在该字段上**已消除**。
>    ⚠️ 这个数是被 `skill-compiler.seam.test.ts` 的金丝雀**当场报红逼出来的**，不是人想起来的——
>    该断言原写死 `toBe(0)`，合并后变红，逐层追到提交 `0b49b75a` 确认是有意补种子、不是回归，才改的数。
>    **这就是 0.6 要的那种机制：机器先说话。** 复验命令：
>    `grep -c "dependsOn\|references:" apps/agentcore/src/mocks/seed.ts`（今日实测 3 / 7）；
> ② 判「生长回路只报不写」→ 写链真实存在
>    （`scenario-grow.ts:98 → scaffoldDraftIntent → catalog.createIntent → intents.insert`），
>    只因 grep 了 `intents.insert` 的**直接**调用方就收工；
> ③ 判「引用可校验门今天做不了」→ `probeMissingRefs`（`resources.ts:11`）**已存在且已接两处**
>    （workflow 发布 `server.ts:1008` / agent 发布 `server.ts:690`），真实缺口只是**skill 发布路没接 + fail-open**。
>    这一条把工作量从「接一条线」错报成「造一道门」，直接歪掉排期。

**执行判据（写进每次分析）**

1. **区分三种"不工作"，不许混为一谈**——修法完全不同，混了必修错地方：
   | 形态 | 判据 | 修法 |
   |---|---|---|
   | **没接线** | 符号的调用方集合里**只有 test**（`grep -rn <sym> apps/*/src packages/*/src` = 0） | 接线 |
   | **接了线没数据** | 有 src 调用方，但输入恒空/恒假，分支从未进入 | 补数据或删死分支 |
   | **接了线接错地方** | 有 src 调用方，但挂在错误的路径上（如只接 workflow 发布、没接 skill 发布） | 补挂载点 |
2. **只有 test 引用 = 已排练，不是已实现**（假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`：
   实现有、测试有、且是绿的，零生产调用方——测试咬的是**函数**不是**链路**）。
3. **下结论前先自问：这个符号有没有可能被间接调用？**（re-export / 高阶函数 / 依赖注入 / 字符串键分发 /
   事件订阅）。这些 grep 一次都看不见。
4. **"我 grep 了" 不是复验**。复验 = 亲手把那条链跑一遍，或至少读到调用点的**条件**。
   （同源戒律见下文「门必须显式捕获退出码」——那次也是"日志里就写着，却被假绿盖过去"。）
5. **grep 命令本身会骗你 —— 报 0 命中前先自证工具是对的**（2026-08-06 实测，一天内两例）：
   - `git grep -- "apps/*/src"` **恒匹配 0 个文件**：pathspec 里的 `*` **不跨 `/`**。
     于是每个符号都读作"零命中"，整份清单会得出"全是死代码"这个恰好相反的结论。
     判据：**先拿一个你确定存在的符号跑一遍**，它若也报 0，那是工具坏了不是代码死了。
   - `git rev-parse <rev>:<path>` 不带 `--verify -q` 时，路径不存在会**把输入串原样打到 stdout**
     且退出码为 0 → "文件不存在"被误判成"存在但内容不同"。同日一个 dev 全表 `ABSENT=0`，
     加参数后结论完全改写（40 条分支实际带着 canonical 缺失的文件）。
6. **「路径开关」类的假绿：生产实参与测试实参交集为空**（2026-08-06 实测，`G-SEED-PROVENANCE-BACKFILL-UNASSERTED`）。
   `synthetic/service.ts` 的 provenance 回填由 `viaModelingChain` 二选一；生产 `seed.ts:92` 传 `false`，
   而**两个相关测试用例都传 `true`**，被 `if (!chainMode)` 跳过 ⇒ **测试三周来验的是生产已经放弃的那条路**，
   而且全绿。判据：**凡带布尔/枚举开关的分支，必须核对"生产传的那个值"是否真的被某个测试覆盖** ——
   「这个函数有测试」证明不了「生产走的那个分支有测试」。

## ⛔ 铁律 0.6 · 同一个错第二次必须建机制，第三次必须进本文件（违反即复发·2026-08-08 一天连犯 5 次）

**来历**：2026-08-08 一天之内，同一种病犯了 **5 次**，每次都被「这次不一样」骗过去，
直到仓主问「为何不在第二次就建立解决的机制」才动手。5 次分别是：

| # | 工具 | 骗法 | 若信了会得出 |
|---|---|---|---|
| 1 | `git grep -- "apps/*/src"` | pathspec 的 `*` **不跨 `/`**，恒 0 命中 | 「全仓都是死代码」 |
| 2 | import 图解析器 | 不认 ESM `./x.js` 说明符，barrel 边全丢 | 「contracts 整包是死代码」 |
| 3 | `BUILTIN_VIEWS` 抽取 | 抽出 0 条，且扫的是停在旧分支的工作目录 | 「6 个专用 route 后端全不下发」 |
| 4 | 悬空引用复核脚本 | 120 字窗口把 `G-NO-FREIGHT-COST` 截成 `-CO` | 「多一个悬空引用」 |
| 5 | `grep 'outbox.emit("sim.'` | 事件名是**第二个**实参，不是第一个 | 「sim.* 一处都没 emit」 |

**5 次同一个根因**：拿一个**看起来相关的数字**当判据，而没验证「这个数字真的在度量我要度量的东西」。
同源的还有分支审计那次：拿 `git log C..b | wc -l`（提交数）当「有无未合并内容」的判据——
rebase 过 canonical 之后该数字彻底失去意义，换成「它新增的文件 canonical 里到底有没有」结论当场反转。

### 判据：怎么认定「同一个错」
不看「感觉像不像」，看**形态**。把两次错误各写成一句：
> **「我用 X 当作 Y 的证据，而 X 并不度量 Y。」**

两句的 X/Y **结构相同即同错**，哪怕工具、语言、模块完全不同。

### 三级处置（不许跳级、不许降级）
- **第 1 次**：修 + 记账。
- **第 2 次**：**必须当场建机制** —— 门 / 封装 / 检查清单，三选一。
  **「下次注意」不是机制**；只在报告里写一句「已知此坑」也不是机制。
  机制的判据：**下次同样的错发生时，是机器先说话，不是人先想起来。**
- **第 3 次**：**必须写进本文件**，并注明前两次的日期与原文（像本条这样）。

### 已达第 3 次、现予落地的机制 —— 扫描类结论一律先自证工具
**任何 `grep` / 解析器 / 差集统计 / 计数，在报出结论之前，必须先跑一个「已知必中」的样例（金丝雀）。**

- 金丝雀不中 ⇒ 报「**工具坏了**」，**不许**报「代码干净 / 没有命中 / 无此内容」。
- 门脚本里的金丝雀**必须与主逻辑共用同一份实现**，不许各抄一份正则 ——
  抄了就是装饰品：改主正则时金丝雀拿旧的去测、照样绿。（2026-08-08 实测，变异反证当场抖出。）
- 报「0 命中」「不存在」「零调用方」这类**否定结论**时，报告里必须同时给出金丝雀的命中证据。

**这两句话的区别，就是本仓一整天的教训**：
> **「我没找到」和「它不存在」是两个不同的命题。**

### 第 2 条已达第 3 次的机制 —— **派单里判断「分支对不对」，判据是祖先关系不是文件存在性**

**2026-08-09 一天之内，同一个错骗到 4 个 dev**（全部由 dev 自己发现并顶回来，不是我发现的）：
我在六张工单里写「先 `git rev-parse --verify -q HEAD:<某文件>`，ABSENT 就从 canonical 重开分支」。
四次全部误判：

| dev | 我给的探针文件 | 实际 |
|---|---|---|
| skill-compiler | `apps/agentcore/src/skill-lint.ts` | 两版都在（blob 不同），落后 canonical **1310 提交** |
| skill-orchestrator | `apps/agentcore/src/workflow/executor.ts` | 两版都在，同样落后 1310 |
| skill-partial-a | `apps/agentcore/src/skill-lint.ts` | PRESENT，但 worktree 是 canonical 的**祖先** |
| skill-partial-b | `apps/agentcore/src/features/registry.ts` | 两版都在，而三份**目标文档**全 ABSENT |

**形态**（照 0.6 的句式）：**「我用『某文件存在』当作『分支是新的』的证据，而前者并不度量后者。」**
文件在老支线上恰好也存在时，探针恒真 —— 于是 dev 在一个落后 1310 个提交的树上开工，
把已实现的读成「不存在」，得出**与事实相反**的结论。

**机制（写进每张派单模板，不许再用文件存在性）**：
```bash
CANON=origin/claude/inspiring-gates-aqczjg
git fetch origin && git merge-base --is-ancestor HEAD $CANON \
  && { echo "HEAD 是 canonical 的祖先 ⇒ 落后，必须重开"; git checkout -B <wo-branch> $CANON; } \
  || echo "HEAD 不落后于 canonical，可原地开工"
```
判据是**祖先关系**：`HEAD` 若是 canonical 的祖先，就是落后，无论哪个文件在不在。
派单模板同时必须写明两条环境前置（同样被 dev 顶回来过）：
**worktree 可能没有 `node_modules`**（先 `pnpm install --prefer-offline`）、
**`@platform/contracts` 可能未 build**（先 `pnpm --filter @platform/contracts build`）——
不装就会报 `Failed to resolve entry for package "@platform/contracts"` 这种**与本单无关的假红**，
极易被误判成契约包坏了。

## ⛔ 铁律 1 · 长任务必须**主动探针**，不许干等也不许凭时长猜（违反即事故·已真实发生 5 次）

**任何后台任务（gate / 派出去的 dev / 长跑脚本）静默超过 30 分钟，必须跑 `bash scripts/task-probe.sh` 实测健康态，
再据结果处置。禁止「它应该还在跑吧」这类无证据判断，更禁止等用户来问。**

> **来历**：2026-08-06 一天之内容器重启 **4 次**，每次把正在跑的 gate 与全部后台 dev 一起杀掉；
> 而每一次都是**仓主问「任务是否被卡死了」我才去查**——这句话一天被问了 6 次。
> 有一次代价是实的：一个 dev 的产出**从未 push，随重启全部丢失**。
> 反向误判也真实发生过：一个 QueryTask 停在 `EXECUTING_AGENT`，我几乎要报「还在算」，
> 实测 token 计数 20 秒一个数没变、进程 CPU 0.5% —— **它早就不动了，只是没人宣告终态**。
>
> **2026-08-08 第 5 次复发**（照铁律 0.6 三级处置回写此账）：容器又重启，把正在跑的四包 gate 杀在
> `INSTALL_RC=0` 之后。这次判据 #2 起了作用（`uptime` 9 分钟 < 静默时长 ⇒ 判「机器重启」不是「卡死」），
> 但**判据 #5 的老病复发了**：集成 worktree 上 12 个提交、3397 行（A2 门 + A10 事件 + S3 枚举器）
> **零远端分支**，全靠磁盘没被清才幸存 —— 抢救推到 `claude/handoff-sandbox-batch-a2s3` 才落袋。
> 复发的直接原因是把 push 当成了「gate 之后的动作」。**改正：每完成一个可命名单元立刻推旁支，
> 起 gate 之前先确认被验的那个 commit 已有远端分支**——「gate 跑着」不是「工作已落盘」。

**执行判据（写进每次判断）**

1. **判据是「还在不在动」，不是「跑了多久」。** 跑 40 分钟但输出一直在长 = 正常；跑 8 分钟但输出 8 分钟没动 = 卡死。
   两种情形的"时长"完全相反，**只看时长必然误判**。所以探针必须**二次采样**（隔 ~20s 再看一次字节数），
   凭一次快照下结论 = 上面那个误判的复现。
2. **先判机器，再判任务。** `uptime` 小于静默时长 → 容器刚重启 → 全体**阵亡**而非卡死，处置方向完全不同：
   先 `git ls-remote` 查各 handoff 分支**推了没有**（推了的还在，没推的已丢），再重派。
3. **四种态各有处置，不许混为一谈**：

   | 态 | 判据 | 处置 |
   |---|---|---|
   | **在动** | 二次采样字节数在涨 | 继续等，别打断 |
   | **真卡死** | 静默超阈值 + 进程仍在 + 字节数不涨 | 人工介入；取确切 pid 再 kill |
   | **已被杀** | 静默超阈值 + 进程已不在 | 查产物与远端分支定性，决定重派还是收编 |
   | **机器重启** | `uptime` < 静默时长 | 全体阵亡；先抢救未推工作，再重派 |

4. **杀进程别用会自匹的模式。** `pkill -f "scripts/gate.sh"` 会把**探针自己这条命令**也匹进去
   （命令行里含该字串）→ 自杀，exit 144。本会话已因此自杀 **3 次**。
   正确姿势：`ps -eo pid,args --no-headers | grep -F '<key>' | grep -v grep` 取到确切 pid 再 kill。
5. **push 与「过 gate」是两回事**（这条是上面那次真丢工作的直接对策）：推旁支零风险、零成本，
   gate 只决定"能不能进 canonical"，**不决定"要不要落盘"**。每完成一个可命名单元就 commit + push，
   派单时也必须把这条写进工单纪律。

## ⛔ 铁律 2 · 「推正线」需要 gate，「继续干活」不需要（违反即空转·已真实发生）

**gate 只是并入 canonical 的准入条件，不是开工的前置条件。等 gate 期间必须继续派活、继续复验、继续出文档 —— 唯一被 gate 挡住的动作是「推正线」这一个。**

> **来历**：2026-08-06 我写下「下一步：gate 跑完推正线，然后接着啃引擎层剩下那批」——
> 这句话把两件互不相干的事串成了顺序执行。仓主当场反问「为何一定要等 gate 跑完，不能先做其他的？」
> 反问是对的：那批引擎层欠账与 gate 正在验的那个 commit **没有任何依赖关系**，
> 完全可以同时开工。gate 一跑 40 分钟，白等就是白等。

**执行判据**

1. **被 gate 挡住的只有一个动作**：`git push` 到 canonical。除此之外——派 dev、复验 handoff、
   写 PRD/工单、加门、改前端、跑非 datacore 的测试——**一律照常**。
2. **并发上限的真实约束不是「agent 数量」，是「同时跑 datacore vitest 的数量」**（4 核机）。
   按 CPU 画像分层派，10 个 agent 可以同时在跑：
   | 画像 | 例子 | 同时上限 |
   |---|---|---|
   | **重**（跑 datacore vitest） | 引擎侧修复 + 全量回归 | **≤1，且 gate 跑着时为 0** |
   | **中**（跑 agentcore / frontend vitest） | 前端接线、路由改动 | 2–3 |
   | **轻**（只读+写文档/门脚本，不跑测试套件） | 取证、对账、PRD、加门 | 不设限（实测 5+ 无压力） |
   反面教材：曾 6 个 agent **全部**跑 vitest → 负载 35，自伤（欠账 #102）。
   错的不是「6 个 agent」，是「6 个都是重画像」。
3. **gate 跑着时唯一的额外禁忌**：别动主工作目录（见上「派 dev 必须 worktree 隔离」）。
   worktree 隔离的 agent 不受此限 —— 这正是要求隔离的原因之一。
4. **要动主工作目录里的非代码文件（如本文件）时**，先证明它不被任何测试/门**读取**
   （`grep -rl` 到的可能只是注释里提了一嘴，**提及 ≠ 读取**，必须点开看），再动。

## 架构地图

```
packages/contracts      共享契约（zod schema）。禁止跨 app import 源码
packages/llm-adapters   共享 LLM 适配器层（增量 §1.2：Anthropic/OpenAI-compat/custom_http 留接口 + JSON-mode 降级）
apps/datacore           System A（Fastify, 端口 4001, 路由前缀 /a/v1）
                        A0 IAM(JWT RS256+JWKS) · A1 连接器 · A2 规则文档抽取 · A3 半自动建模
                        A4 本体/对象/求解器/派生 · A5 规则 DSL · A6 权限(行级过滤) · A7 合成数据
                        A8 时序+模拟时钟 · S1 求解器 · S1.8 S&OP · S2 Action 审批 · S4 知识库
apps/agentcore          System B（Fastify, 端口 4002, 路由 /api/v1 原生 + /b/v1 重写别名）
                        QOS 查询编排(分类→路径A工作流/路径B Agent→SSE) · B1 Agent · B2 Workflow
                        B3 MCP · B4 Skill · B5 场景入口 · 多 LLM 供应商路由
apps/frontend-shell     React 18 SPA（Vite, TanStack Query, zustand, MSW mock 模式）
docker-compose.yml      pg×2 + minio + datacore + agentcore + frontend + gateway(nginx:80)
deploy/nginx.conf       网关：/ →frontend, /a/v1→datacore, /b|api/v1→agentcore(SSE 不缓冲)
docs/                   PRD 全集（平台总纲 / QOS / 前端 / 增量 addendum），冲突时以总纲为准
DEPLOY.md               中文部署指南（docker compose + 域名 + 账号 + 模块导览 + 排查）
```

两系统松耦合：AgentCore 只经 DataCore 公开 REST（OBO 透传用户 JWT 或 X-Debug-User）访问数据；前端是两系统的汇合点（dual baseURL，部署态经网关同源）。

## 常用命令

```bash
pnpm install
pnpm -r build && pnpm -r test    # 4 包全绿是交付底线（datacore 69 / agentcore 66 / frontend 25+）
pnpm -r lint / typecheck

# 内存模式本地双服务（无需数据库）
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js
PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 node apps/agentcore/dist/main.js

# pg 模式：设 DATABASE_URL 即自动选 pg 仓储并在启动时幂等迁移；手动迁移：
pnpm --filter datacore migrate && pnpm --filter agentcore migrate

# 容器整套（含前端+网关）
docker compose up --build        # 见 DEPLOY.md；登录 demo / admin / demo1234

# 前端 mock 模式（无后端）
VITE_MOCK=1 pnpm --filter frontend-shell dev
```

## 关键约定（违反即返工）

- **并行优先 · 不逼用户单选（违反即返工）**：多条**相互独立**的工作线（复审 A ＋ 派 dev 做 B ＋ 出文档 C）能并行就**全部并行推进**——审核方自己就是并行调度器（派后台 dev ⊕ 自己开工 ⊕ 发产物同时进行），边做边报、不等许可。**绝不**把独立工作摆成"选一个"逼用户单选：用户的时间不该花在裁剪我本可同时做的事上，默认答案永远是"都做"而非"选一个"。**只有**当选项真互斥（同一文件冲突改法 / 二者取一的架构决策）、或用户优先级真会改变"做什么"时，才用 `AskUserQuestion`。（唯一并发红线：`datacore` 勿并发多 vitest gate，见下 LOOP 纪律——串行化 gate，但派活/复审/出文档等其余工作线照并行。）
- **contracts-only-shared**：跨包只允许依赖 `@platform/contracts`；前端不得重定义契约已有类型。
- **tenant_id everywhere**：所有仓储读写、事件、缓存键都带 tenantId；跨租户访问一律 403/404。
- **Entitlement 先于 authz**：功能关闭 = 不存在 → 404 `FEATURE_NOT_FOUND`（见 datacore features.ts / agentcore features/gate.ts）。
- **no-secrets-echo**：凭据（连接器/MCP/LLM provider）AES-GCM 加密落库（CREDENTIAL_KEY），任何响应不回显明文，仅 credentialRef。
- **确定性种子**：合成数据同 (industry, scale, seed) 重跑字节级一致（seed 默认 42）；求解器同输入同参数版本同输出。测试不依赖网络/时钟随机性，LLM 一律 mock。
- **错误信封**：`{ error: { code, message, requestId } }` 两系统统一。
- **认证**：生产链路 Bearer JWT（DataCore 签发，AgentCore 经 JWKS 验签，claim `tid`/`sub`/`roles`）；开发链路 `X-Debug-User: tenantId:userId:role1|role2`（可 URI 编码，角色含 CJK）。refresh token 走 httpOnly cookie（Path=/a/v1/auth），body 透传向后兼容。
- **服务间凭证**：env `SERVICE_TOKEN`（两服务同值）→ A 的服务间路由（/a/v1/llm-providers/{id}/credential、/a/v1/references/report、provider/binding 读取）；用户 JWT 一律 403。B 对 A 资源缓存 TTL 60s + `{kind}.updated` 事件失效（钩子 POST /b/v1/internal/invalidate），传播 SLO ≤60s。
- **演示账号**：tenant `demo`，admin（admin+planner+catalog_admin）/ planner / base_manager:常州，密码均 demo1234；workspace 按角色返回不同导航/视图/主题。
- **仓储双实现**：memory（测试默认）与 pg（DATABASE_URL 触发，启动自动迁移）。新增表需同时改 migrations/*.sql + repo/pg.ts + repo/memory.ts + repo.ts 接口。
- **接缝门 SEAM-GATE**：凡「数据+引擎两半」或「A+B 两系统」拆开做的特性，交付必须含一条**驱动接缝的组合测试**——在 merge/集成态断言端到端行为，而非只测各半 unit。例：metric-aware 须测 `gap_attribution(market_share)→cf-competitor-price`（数据种绑定 × 引擎路由，任一半漏即红）。**审核方复验头号判据 = 接缝驱动通，非各半绿**；「绿测试≠能用·断在接缝」的老坑靠此门堵死。
- **门必须显式捕获退出码（违反即事故·已真实发生）**：交付门一律走 `bash scripts/gate.sh`。**禁止** `cmd | tail -n; echo "EXIT=$?"` —— `$?` 取的是管道末端 `tail` 的退出码（恒 0），曾据此把一个 **agentcore 编译失败**的 commit 判为"BUILD 通过"并入正线，直到部署方 build 失败才暴露（错误原文当时就在日志里，被假绿盖过）。失败时须打印 `error TS|FAIL|AssertionError` 原文，不许只 tail 几行把错误挤掉。
- **派 dev 必须 worktree 隔离（违反即污染 gate·已真实发生）**：派后台 dev 时**必须**显式传 `isolation: "worktree"`。不传 → dev 直接在**主工作目录**里 checkout 分支、改文件，而我正在同一个目录跑 gate。2026-08-06 实测：WO-112 的 dev 在 12:08–12:22 改 `apps/agentcore/src/mocks/seed.ts`，而 gate 的 TEST 阶段跑到 12:15:47 —— 重叠了 7 分钟。那次 gate 报「✅ 全绿」，但**它证明的是某个中间态通过了，不是我要并线的那个 commit 通过了**。这是假绿的又一形态：信号本身是真的，只是它不指向我要断言的那个对象。判据：起 gate 前先 `git rev-parse HEAD` 记下来，gate 完再确认 `git status --porcelain` 为空且 HEAD 未变；两者任一不成立 → 结果作废重跑。
- **LOOP 派发/复验纪律**：功能拆成 WO（工单）派 dev。① **每张 WO = 一条 handoff 分支**（dev 建 → push `claude/handoff-<wo>`，不碰正线）。② **审核方隔离复验**：worktree 独立 checkout → **组合四包 gate**（`pnpm -r build && pnpm -r --workspace-concurrency=1 test`·datacore 勿并发多 vitest）→ cherry-pick 上 canonical → push。**头号判据 = 接缝驱动通（SEAM-GATE）+ 四包全绿 + 亲手真跑（绿测试≠能用）**，退则给精确 file:line + 最小修路径。③ **一 WO 一 fresh dedicated dev·靠文件边界不靠身份**：每张 WO 顶部写 **🚦范围边界**（只碰哪些文件/包）——这就是该 dev 本单的"身份"，无需追问"哪个 dev 是哪个"。**跨数据/引擎两半的特性必须一个 dev 整单做（拆两半用不同机制不对接 = metric-aware 反复炸的根）。** ④ 金值/注册即更（新增 solver/对象类型 → 同步 golden 计数·demo-chain/catalog/ontology-core），漏金值即退。

## 文档索引

- `docs/PRD-platform-foundry-aip.md` — 平台总纲（系统边界、A0–A8/B1–B7、验收 §12）
- `docs/PRD-query-orchestration-service.md` — QOS 详细规格（事件名 §8.2 一字不差）
- `docs/PRD-frontend.md` — 前端（路由表 §3、启动序列 §4.1、renderer 分发 §7、验收 §11）
- `docs/PRD-addendum-*.md` — 时序 A8 / Entitlement / 求解器增量
- `packages/contracts/src/workspace.ts` — `GET /a/v1/me/workspace` 响应契约（部署批次新增）
