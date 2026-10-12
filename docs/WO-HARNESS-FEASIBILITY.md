# WO-HARNESS-FEASIBILITY · deepseek-harness 能否替换本平台 Agent 系统 —— 逐字段对照，不许给感想

<!-- wo-anchors: allow-missing: docs/REPORT-harness-migration-feasibility.md -->
<!-- 本单唯一产物，现在当然不存在。 -->

## 🚦 范围边界（本单身份）

**只碰**：`docs/REPORT-harness-migration-feasibility.md`（新建，本单唯一产物）。

**一行代码都不许改。** 本单是**取证单**，不是实施单。
不改 `apps/**` · 不改 `packages/**` · 不改 `scripts/**` · 不改 `docs/SYSTEM-ONTOLOGY.md`。
若你在取证过程中发现本仓的 bug，**写进报告的"顺带发现"段，不要顺手修** —— 修了就越界，
且会与正在跑的 9 个 agent 撞车。

## 0 · 环境前置

```bash
CANON=origin/claude/inspiring-gates-aqczjg
git fetch origin
git checkout -B claude/handoff-wo-harness-feasibility origin/claude/verify-reclaim-6
git merge-base --is-ancestor HEAD $CANON \
  && { echo "HEAD 是 canonical 的祖先 ⇒ 落后，停手回报"; } || echo "ok"
```
本单**不跑测试、不 build**，所以 `pnpm install` 可省。若你要读 TS 类型，
`pnpm install --prefer-offline && pnpm --filter @platform/contracts build` 再读。

## 1 · 需求来源（仓主原话，一字不改）

> 「你看一下 https://github.com/deepseek-ai/deepseek-harness，我期望用他替换掉目前系统的 agent 系统，
>  是否可行，把相关的配置信息迁移到新的 agent 系统」

## 2 · 我已经查到的（一手，你仍要复核）

我用 WebFetch 读了该仓 README，实测结论：

| 项 | 实测 |
|---|---|
| 存在性 | 存在 · MIT 许可 · TypeScript |
| README 自述成熟度 | 「currently in _developer preview_ … **THERE WILL BE COMPATIBILITY-BREAKING CHANGES**」（原文） |
| 启动方式 | `npx @deepseek-ai/dsh web` → `127.0.0.1:3080` |
| 多租户 | README **无任何提及** |
| 认证 / 鉴权 | README **无任何提及** |
| 服务端部署 / 生产就绪 | README **无任何提及** |
| 持久化 | README **无任何提及** |
| **插件 / 扩展 API 规格** | README **无任何提及** ⇒ **这正是本单要去源码里挖的** |

⚠️ 「README 无提及」**只是"我没找到"，不是"它不存在"** —— 这两个是不同的命题（铁律 0.6）。
**本单的核心工作就是去读源码把这七行从"未知"变成"已知"**，每一行都要有 `file:line` 或 commit 落款。

## 3 · 本平台这一侧的规模（我现算的，你要自己复跑一遍并贴命令）

```
apps/agentcore/src/*.ts        109 个文件 · 32,392 行
apps/agentcore/migrations/     12 个迁移
契约：packages/contracts/src/agentcore.ts:24  AgentDefinitionSchema
      packages/contracts/src/agentcore.ts:266 SkillDefinitionSchema
```
你还要自己数清楚（并贴命令与数字）：
- `tenantId` 出现处数 · `SERVICE_TOKEN` 出现处数 · `repos.*` 调用处数 · 路由条数 · 测试文件数
- entitlement 落点（`apps/agentcore/src/features/gate.ts`）
- 凭据加密落点（`apps/agentcore/src/llm/providers.ts` · `apps/agentcore/src/mcp/client.ts`）

## 4 · 要做什么（三件，缺一不可）

### 4.1 读源码，挖出它的扩展模型（**本单最重要的一件**）

README 没写插件 API，**所以必须读源码**。不读就谈迁移是空谈。
你要回答的是：

1. 它的**可扩展单元**叫什么？（tool / plugin / skill / agent / provider …）
   在哪个文件定义？类型签名逐字段抄下来。
2. 它有没有**多 agent 定义**的概念，还是只有"一个 agent + 一堆 tool"？
3. 它的 **MCP 支持**到什么程度？（自己当 MCP client？当 server？还是没有？）
4. 它的**会话/持久化**落在哪（内存？文件？sqlite？）
5. 它的 **HTTP 层**长什么样 —— 是不是只有个本地 web UI，没有可编程 API？
6. **流式输出**：有没有 SSE / WebSocket？事件名是什么？

取证方式随你（WebFetch 读 GitHub 文件 / 读 raw.githubusercontent / npm 包解包看 dist）。
但**每个结论都要有落款**：文件路径 + 行号，或 commit sha。
**「README 没写所以没有」不是结论，会被退单。**

### 4.2 逐字段对照表（本单的可交付物核心）

把本平台的 **AgentDefinition / SkillDefinition / MCP 配置** 三件，逐字段映射到它的模型：

| 我方字段 | 语义 | 对面对应物 | 判定 |
|---|---|---|---|
| （逐条填） | | | 直接映射 / 需转换 / **对面没有** |

判定只许用这三档，**不许写"类似"「大致对应」这种模糊话**。
「对面没有」的每一条，要写清楚**丢了它会怎样**（哪个功能不能用、哪个不变量守不住）。

### 4.3 「必须重建清单」—— 这是仓主真正要的答案

本平台有而它没有的能力，逐条列，每条给**重建工作量**（人日区间 + 依据）：

- 多租户（`tenantId` everywhere · R2 不变量）
- Entitlement 先于 authz（功能关闭 = 404 `FEATURE_NOT_FOUND`）
- JWT RS256 + JWKS 验签 · OBO 透传 · `X-Debug-User` 开发链路
- `SERVICE_TOKEN` 服务间凭证
- 凭据 AES-GCM 加密落库 + **no-secrets-echo**（任何响应不回显明文，仅 credentialRef）
- 迁移 / 持久化 / 仓储双实现（memory + pg）
- 与 DataCore 的 REST 接缝（QOS 查询编排 · 分类→路径A工作流/路径B Agent→SSE）
- 审计 / 事件外发（outbox）
- 现有测试资产

### 4.4 结论：三选一，必须明确选一个并给判据

- **A 直接替换**（我方 agentcore 整体退役）
- **B 当执行运行时**（保留我方租户/鉴权/entitlement/审计/SSE 外壳，把它塞进去当 agent 执行引擎）
- **C 不引入**

**不许写"看情况"「各有优劣」。** 选一个，把反对理由也写出来（即"选 B 的话，A 和 C 各输在哪"）。

## 5 · 铁律（逐条适用）

- **铁律 0.5**：grep 不是结论，再追一层。对**对面那个仓**同样适用 ——
  在它的仓里 grep 到一个符号，要追到「谁调用、什么条件触发」再下结论。
- **铁律 0.6**：报「它没有多租户」「它没有插件 API」这类**否定结论**前，
  必须先跑金丝雀自证工具是好的（例：用同样的方式去搜一个你**确定它有**的符号，
  比如 README 里点名的 `dsh web` 入口 —— 搜得到，才说明你的搜法有效）。
  报告里**必须附上金丝雀的命中证据**。
  ⚠️ 这条在本单尤其容易犯：读别人的仓，工具坏了（分支名错 / 路径错 / raw URL 404 返回 HTML 而不是 404）
  会让**每一个符号都读作"不存在"**，于是得出「这个项目啥都没有」这个恰好相反的结论。
- **区分三种"没有"**（照本仓三分法的精神）：
  | 形态 | 判据 | 对迁移的含义 |
  |---|---|---|
  | **真没有** | 源码里确实无此概念 | 必须重建 |
  | **有但没文档** | 源码里有、README 没写 | 可用，但要自己摸，有版本风险 |
  | **有但形态不同** | 概念在、结构不同 | 需转换层，工作量在映射不在重建 |
  三者工作量差一个数量级，**混为一谈的评估等于没评估**。
- **对面自述 developer preview + 明说会破坏兼容** —— 这条必须原文引进报告，
  且在结论段落里**明确说明它对选型的影响**，不许只放在附录当摆设。
- **每完成一个可命名单元立刻 commit + push**
  （`git push -u origin claude/handoff-wo-harness-feasibility`，失败按 2s/4s/8s/16s 退避重试 4 次）。
  容器会重启，没推的等于没做。

## 6 · ⛔ 资源纪律

本单是**轻画像**（只读 + WebFetch + 写文档），**不跑任何测试套件**。
当前载荷 18.9（已超派），所以本单**尤其**不许碰测试。

**禁止**：`bash scripts/gate.sh` · `pnpm -r test` · `pnpm -r build` · 任何 vitest。
**允许**：WebFetch · `grep` / `git` / `node -e` 只读 · 写 `docs/REPORT-harness-migration-feasibility.md`。

## 7 · 交回报告必须含

1. **§4.1 六问逐问回答**，每问带 `file:line` 或 commit sha 落款；
2. **§4.2 逐字段对照表**（三档判定，无模糊词）；
3. **§4.3 必须重建清单**（每条带人日区间 + 依据）；
4. **§4.4 结论 A/B/C 选一个** + 另两个各输在哪；
5. **金丝雀命中证据**（证明你的取证工具是好的）；
6. 本平台侧规模数字的**复跑命令与输出**（不许照抄我 §3 的数）；
7. **你认为我这张单写错/漏说了什么**（不许空着）；
8. 分支名 + 最终 sha（`git ls-remote` 确认已推）。

不要创建 PR。
