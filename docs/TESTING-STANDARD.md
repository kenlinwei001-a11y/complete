# 测试标准 SOP（TESTING-STANDARD）· 反"丢三落四"的强制清单

> 立此标准的由来：测试覆盖一直**凭手感、层次不齐**——后端 inject 真测、前端却只 jsdom+MSW 假后端、
> 真浏览器只手动截图、A8 代理与真 Python 分开测从不连。汇报时"T12 截图"听起来像全链真测，其实只到
> "真浏览器+假后端的手动截图"。本 SOP 把"每类功能必测哪几层 + 每条覆盖必须诚实标注 mock 边界"做成
> 强制清单，接进 DEV-SOP 的 T1–T12，**填不满即未完成**。
>
> 北极星：**绿测试 ≠ 能用。** 任何"已测/已验"的话都必须带**层级 + mock 边界**（见 §4）。

## 1. 测试分层法（每层测什么、不测什么）

| 层 | 名称 | 跑什么 | 真在哪 / mock 在哪 |
|---|---|---|---|
| **L0** | 纯函数单测 | 确定性纯函数（规划器/角色解析/值域/别名…） | 全真，无 IO；R6 字节一致在此锁 |
| **L1** | 后端集成（inject） | `makeApp()` → 真 Fastify app + 真 service + 真路由 | **真**后端逻辑；**mock**：memory 仓储(非 pg)、LLM(ScriptedLlmClient)、optimizer(注入 mock) |
| **L2** | 跨服务冒烟 | 真 AgentCore HTTP ↔ 真 DataCore（`xservice-smoke`） | 两服务真连；仍 memory 仓储 |
| **L3** | 前端组件 | jsdom + RTL + **MSW(假后端)** | 真组件渲染/交互；**后端是假的**——绝不算"打真后端" |
| **L4** | 真浏览器 E2E | Playwright（Chromium） | 真浏览器像素+交互；**必须标**跑的是 `VITE_MOCK=1`(假后端) 还是真后端(datacore:4001+agentcore:4002) |
| **L5** | 外部引擎 | Python `pytest`（真 ortools CP-SAT） | 真求解数学；**与 L1 代理分开**——除非加 L2 端到端，否则两头不连 |
| **L6** | 确定性 R6 | 同输入(+seed)重跑字节一致 | 合成/求解器/规划器/倒推必有 |
| **L7** | 隔离 R2 | 跨租户取不到/不泄漏 | 凡读写带 tenantId 的必有 |
| **L8** | VLE 闭环 | 七段断言 + 三覆盖率 | 涉合成/派生/求解器时 |
| **门** | gates | `pnpm gates` + 各 `*:check` | ontology/chain/debattery/prd/coverage/meta + 功能专属门 |

## 2. 每类功能的**必测层矩阵**（开发前对照，缺哪层补哪层）

| 功能类型 | 必测层（缺即未完成） | 备注 |
|---|---|---|
| 纯算法/确定性函数 | L0 + L6（+ L7 若带租户） | 规划器/角色解析/值域/别名收敛 |
| 后端端点/service | **L1** + L7（若隔离）+ 门 | inject 真打；新表加 R9 双实现说明 |
| 求解器（datacore 纯函数） | L1 + L6 + L7 | 走对象图的通用求解器 |
| 求解器（CP-SAT sidecar） | L1(mock optimizer) + **L5(真 ortools)** + **L2(代理→真 Python 冒烟)** | ⚠ 当前缺 L2——两头分测，必须补端到端冒烟 |
| 跨系统（A→B / B→A） | L1 + **L2 跨服务冒烟** + 门(chain:check) | scaffold/MCP/OBO 必走 L2 |
| 前端页面/交互 | **L3** + **L4(真浏览器)** ，且 L4 必须**两模式**：`VITE_MOCK=1` ⊕ **真后端** | ⚠ 当前只做到 L3 + L4(mock 手动)；**缺 L4 真后端 + 自动化** |
| 事件/数据流(D-29) | L1(发事件) + 门(ontology:check §4) + L3(下游订阅失效) | |
| 合成/派生 | L1 + L6 + **L8 VLE** | |
| 规模/性能 | **L9 压测**(scale-baseline/stress 范式，10⁴ 量级 + 性能预算) | ⚠ 新工作流/provisioner/规划器**未压测**(DEBT A15) |

## 3. 单 PRD 测试登记表（每个 PRD/PR 必填，贴进提交信息或 PR 描述）

```
功能：<PRD 编号 + 名>
L0 纯函数：[✅/—] <测试文件:用例>
L1 后端 inject：[✅/—] <文件> （mock 边界：memory 仓储 + <LLM/optimizer mock?>）
L2 跨服务冒烟：[✅/N/A/⬜欠] <说明>
L3 前端组件(jsdom+MSW)：[✅/N/A] <文件>
L4 真浏览器 E2E：[✅mock手动 / ✅自动化 / ⬜欠] 模式：<VITE_MOCK / 真后端>
L5 外部引擎(pytest)：[✅/N/A] <文件>
L6 R6 确定性：[✅/N/A]   L7 R2 隔离：[✅/N/A]   L8 VLE：[✅/N/A]
门：[✅] pnpm gates + <专属 *:check>
诚实边界：<本功能哪几层是 mock、哪些没测、为何>
```

> **规则**：任一"必测层矩阵"要求的层是 `⬜欠`，PRD **不得标 ✅**，标 ◐ 并把欠的层写进 DEBT-ledger。

## 4. 诚实标注规则（违反即"拿绿测试冒充能用"）

- 说"已测/已验"必带**层级**：例 "L1 inject 真测（mock LLM）" / "L4 真浏览器但 mock 后端、手动"。
- **绝不**把 L3(jsdom+MSW) 或 L4(mock) 说成"打通真后端"。
- **绝不**把"手动截图"说成"自动化 E2E"。
- CP-SAT 类：L5 真求解 ≠ 全链真测；必须点明 L1 代理是 mock optimizer、缺 L2 端到端。

## 5. 当前真实覆盖快照（2026-06-22 刷新）

- 数据量（真实）：**datacore 540 · agentcore 278(+1 skip) · frontend 189 · contracts 3 · llm-adapters 10 · optimizer(Python) 14**。
  （上轮 2026-06-21 为 505/265/183；本会话 +A1/A5/A7/A10/A14/A12/A15/prototype-intake/A18.1/nav-reorg 各层测试见 §8 登记。）
- 强的地方：L1 后端 inject 覆盖广；L0/L6/L7 在新功能上到位；L2 跨服务冒烟在 A1(MCP 注册表 31)/A12(真起双服务 curl) 真连；L5 CP-SAT 真 ortools 跑通；门齐全（+ `cli-parity:check`/`provisional-honesty:check`）。
- **已知缺口（= DEBT-ledger，必须排期）**：
  - **A16/L4（2026-06-22 已补实）**：`scripts/e2e-realbackend.mjs` 扩到 **9 项**覆盖本会话新组件（A5 FDE 8 节点 / A7 scaffold 清单 / A10 重跑验证→徽章 / A14 parity 列 / nav-reorg 分组），`scripts/run-l4-realbackend.sh` 一键编排 + 真 Chromium **9/9 通过**（playwright-core 1.61 装好、ms-playwright chromium 缓存）→ 5 项回 ✅。**余**：未进 CI `pnpm test`（起三进程 + chromium，重；`pnpm e2e:realbackend` 本地/夜间跑）；A14 真 Kimi parity 实跑仍 env-gated 未执行。
  - **A8/L2**：CP-SAT 代理(L1 mock) 与真 Python(L5) **未端到端连**（缺跨服务冒烟）。
  - **A15/L9（本会话扩大）**：新工作流/provisioner/规划器/异步执行 + 本会话新增（FDE 投影/intake 解析/双模闭包/operation-classify）**无规模压测**。
  - pg 仓储仅靠 R9 双实现约定，未逐功能 L1 跑 pg 路径。
  - **§3 登记纪律**：本会话补登记见 §8（此前各 PR 未填 §3 表，已追溯补齐）。

## 6. 反"丢三落四" checklist（开工 ③DEV 前 + 收尾前各过一遍）

- [ ] 对照 §2 矩阵：本功能类型该测哪几层？逐层有/无？
- [ ] 每层有对应测试文件，且断言的是行为不是存在性？
- [ ] L6 R6 / L7 R2 该有的有没有？
- [ ] 前端：除 L3，**L4 真浏览器跑没跑？哪个后端模式？**
- [ ] 跨系统：L2 冒烟跑没跑？
- [ ] 外部引擎：L5 真跑 + L2 端到端？
- [ ] §3 登记表填满，§4 诚实边界写清？
- [ ] 任一必测层欠 → 标 ◐ + 写进 DEBT-ledger，不标 ✅？

## 7. 命令

```
pnpm -r build && pnpm -r test          # L0/L1/L3 + L2 冒烟
cd services/optimizer && pytest -q     # L5 CP-SAT 真求解
pnpm gates                             # 全门
pnpm <feature>:check                   # 功能专属门（value-domain/slice-planner/floor-semantics…）
# L4 真浏览器（手动，待自动化 A16）：
VITE_MOCK=1 pnpm --filter frontend-shell dev   # mock 模式
# 真后端模式：起 datacore:4001 + agentcore:4002(SEED_DEMO,SERVICE_TOKEN,AGENTCORE_BASE_URL) 再起前端
```

> 本标准接进 `DEV-SOP-and-LOOP.md` 的 T1–T12：T2 = L0/L1/L3，T11 = L2，T12 = L4（含真后端模式），新增 T13 = L5/L9 按矩阵。
> 关联：`docs/DEBT-ledger.md`（A15 压测 / A16 真 E2E / A17 本标准）· `fde-delivery` skill（亲手用一遍）。

---

## 8. 本会话测试登记表（2026-06-22 追溯补齐 · §3 履行）

> 此前各 PR 未填 §3 表，现按实际跑过的层追溯登记。`✅`=真跑该层，`—`=该类型不需要该层，`⬜欠`=矩阵要求但未跑（→ 该项 TODO 标 ◐）。
> 北极星：绿测试≠能用；下表 mock 边界一律点明。

| 功能 | L0 纯函数 | L1 后端inject | L2 跨服务 | L3 前端(jsdom+MSW) | L4 真浏览器 | L6 R6 | L7 R2 | 门 | 状态 |
|---|---|---|---|---|---|---|---|---|---|
| **A1** 求解器→MCP | parse helpers | ✅ a1-solvers-mcp×3 | ✅ xservice-smoke(真AC↔真DC,31) | — | — | ✅ registry===SOLVER_KEYS | — | ✅ | ✅ |
| **A5** FDE 节点图 | ✅ a5(投影×6) | ✅ a5(真服务+端点+事件) | — | ✅ f58 | ✅ **真后端**(e2e 8节点) | ✅ | ✅ | ✅ | ✅ |
| **A7** scaffold 单机可见 | ✅ a7(buildRecord) | ✅ a7(单机+reconcile+事件) | — | ✅ f59 | ✅ **真后端**(e2e 清单) | ✅(R6 结构) | ✅ | ✅ | ✅ |
| **A10** 终态闭环验证 | — | ✅ a10×5 | — | ✅ f60 | ✅ **真后端**(e2e 重跑验证→徽章) | — | ✅ | ✅ | ✅ |
| **A14** evals parity | ✅ classifyFailKind | ✅ a14×3 | — | ✅ f43(parity列) | ✅ **真后端**(e2e parity 列) | — | — | ✅ | ✅(真Kimi env-gated 未跑→DEBT) |
| **A12** 模块 hand-run | — | — | ✅ **真起双服务 curl**(非browser) + xservice +1 | — | ◐(curl 非 Playwright) | — | — | ✅ | ✅(审计) |
| **A15** operation-classify | ✅ a15×7 | ✅ a15(端点) | — | — | — | ✅ 确定性 | — | ✅ cli-parity | ◐(handlers A15.2-4 未做) |
| **prototype-intake** | ✅ ×5(解析/对账/R6) | ✅ ×2(端点+事件) | — | — (P3 未做) | — | ✅ 字节锁 | ✅ | ✅ | ◐(P2-HITL/P3) |
| **A18.1** 双模闭包 | ✅ ×3(STRICT/PROV/诚实门) | ✅ ×1(真服务) | — | — | — | ◐(冻结语义,sandbox 未做) | ✅ | ✅ provisional-honesty | ◐(A18.2-4) |
| **nav-reorg** 导航分组 | groupAdminPages(在 f61) | — (纯前端) | — | ✅ f61×3 | ✅ **真后端**(e2e 分组头) | — | — | ✅ debattery | ✅ |

> **L4 真后端补实（2026-06-22）**：A5/A7/A10/A14/nav-reorg 经 `scripts/run-l4-realbackend.sh`（真 datacore:4001 + agentcore:4002 + vite 真后端模式 + Playwright 真 Chromium）**9/9 通过** → 由 ◐ 回 ✅。这是 L4 **真后端**模式（非 VITE_MOCK）；access token 仅内存(PRD §4.1)故脚本用 SPA 导航不硬刷。`pnpm e2e:realbackend` 可重跑（本地/夜间；未进 CI——需 chromium 缓存 + 起三进程，重）。

**诚实边界（逐项）**：
- 全部 L1 = `makeApp()` 真 Fastify+service+路由，**mock 边界 = memory 仓储 + ScriptedLlmClient(LLM) + 注入 mock optimizer**；非 pg、非真 LLM。
- A1/A12 的 L2 是真跨服务连接但仍 memory 仓储；A12 的"真后端"是 **curl 驱动**，**非 Playwright 真浏览器**（像素/交互未验）。
- A5/A7/A10/A14/nav-reorg 的前端**只到 L3（假后端 MSW）**，**L4 真浏览器（mock 或真后端两模式）一律未跑** → 这些项 TODO 已由 ✅ 降 ◐。
- A14 的"真 Kimi parity"是 **env-gated 未执行**，当前仅 mock 证框架（不等于 agent 质量达标）。
- A18.1 的 R6 仅覆盖双模闭包纯函数；**LLM 临时求解器的"生成冻结+锁死沙箱确定性"(A18.2) 尚未实现/未测**。
- **L9 压测**：本会话所有新代码（FDE 投影/intake 解析/双模闭包/operation-classify/工作流引擎）**均未做规模压测**（DEBT A15）。
