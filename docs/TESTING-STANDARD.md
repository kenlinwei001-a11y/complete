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

## 5. 当前真实覆盖快照（2026-06-21，本会话末）

- 数据量（真实，纠正 CLAUDE.md 过期的 69/66/25+）：**datacore 505 · agentcore 265(+1 skip) · frontend 183 · contracts 3 · llm-adapters 10 · optimizer(Python) 14**。
- 强的地方：L1 后端 inject 覆盖广；L0/L6/L7 在新功能上到位；L5 CP-SAT 真 ortools 跑通；门齐全。
- **已知缺口（= DEBT-ledger，必须排期）**：
  - **A16/L4**：前端**无真浏览器自动化 E2E**、**无打真后端**模式（只 jsdom+MSW + 手动 mock 截图）。
  - **A8/L2**：CP-SAT 代理(L1 mock) 与真 Python(L5) **未端到端连**（缺跨服务冒烟）。
  - **A15/L9**：新工作流/provisioner/规划器/异步执行**无规模压测**。
  - pg 仓储仅靠 R9 双实现约定，未逐功能 L1 跑 pg 路径。

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
