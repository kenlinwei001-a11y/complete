# 开发 SOP 与 LOOP · PRD 套件施工总规程（其他 agent 照此开工，无需追问）

> 适用：本套件全部 PRD（见 `PRD-A-series-roadmap.md` 开工顺序）。
> 一句话：**每份 PRD 必走「阅读 → 开发 → 工业级检测（含前端 UI 亲手跑通）→ 回写 → 提交」闭环；任一环红 → loop 回上一环；只有 DoD 全绿 + 亲手用过才算 DONE。**
> 核心纪律（来自本仓库铁律）：**"绿测试 ≠ 能用"** —— 单测全绿不等于功能可用，必须亲手在真服务/真 UI 用一遍（FDE 交付纪律）。

---

## 0. 开工前（每个 agent 必读，不可跳）
1. 读根 `CLAUDE.md`（架构地图 + 铁律 + 命令）。
2. 读 `docs/SYSTEM-ONTOLOGY.md`（系统接线单一来源；§2 对象类型 / §3 链路 / §4 事件 / §5 不变量 R1–R15 / §7 门禁 / §8 断点 / §10 域与切片）。**铁律 0：任何跨模块改动前必读本体。**
3. 读 `PRD-A-series-roadmap.md`（依赖 DAG + 4 波次 + 全局裁决）。
4. 读你被分配的那份 PRD 全文，尤其 **§0《本体引用与影响》**（它列出你将触及的对象/链路/事件/不变量/断点/门禁）。
5. 认领基线分支（实现前由负责人定准 `wizardly-gauss` 或 `vigilant-knuth`；**不可在两分支并行写同一文件**）。
6. **避免与审核方撞车（reviewer 偶尔会因用户紧急催、直落某单）**：每轮开工/提交前 `git pull` 后**查你在做的 WO 在 work-queue.json 里是否已被标 DONE**（owner 变 `reviewer` 或 note 含「审核方直落」）。若是 → **弃掉你该 worktree 对相关文件的未推改动**（`git checkout -- <那些文件>`，勿 push，否则撞审核方 commit），按 note 指引改领下一单或做其后续（如决策卡组件 / SANDBOX-LAYOUT-REWORK）。**push 前务必先 `git pull --no-rebase` 合并、有冲突先解再推。**

## 1. 开工顺序（按依赖，不可乱序）
- 严格按 `PRD-A-series-roadmap.md` 的**波次**：Wave1 基座 → Wave2 引擎 → Wave3 编排 → Wave4 验证 →（Wave5 CLI/intake）。
- **同波内**可并行（各 PRD 互不依赖）；**跨波**必须前波 DoD 全绿才进下一波。
- 依赖未就绪时：可先做该 PRD 中**不依赖**的分期（如 A4 先用现有 9 域，A3 就绪再切 14 域；A15 先做 import/model/rule）。

---

## 2. 单 PRD 开发闭环（LOOP · 七步，红则回退）

```
        ┌────────────────────────── loop 回退 ──────────────────────────┐
        ▼                                                               │
① READ ─► ② PLAN ─► ③ DEV(后端→前端) ─► ④ TEST(工业级,含UI) ─► ⑤ VERIFY(亲手跑) ─► ⑥ 回写本体 ─► ⑦ COMMIT/PR
                                            │ 红                │ 不满足DoD/不能用
                                            └──────回 ③─────────┘
```

**① READ**：读本体相关章节 + PRD §0/§2（带 file:line 的现状锚点）→ 把"复用/绿地/门禁"理清。
**② PLAN**：按 PRD §3 列任务；**契约先行**（先定 `@platform/contracts` schema，R1）；列将发的事件（§4，D-29）与将过的门禁（§7）。
**③ DEV**（顺序固定）：
  - 后端：`contracts` schema → 仓储**双实现四处同改**（migrations + repo/pg + repo/memory + repo 接口，R9）→ service → 端点 → **发领域事件**（D-29）。
  - 前端：**声明式**渲染（widget/page 由后端 layout/契约驱动，**零内联业务常数 R14**）→ 订阅事件失效（R10）→ 结论数字包 `<Provenance>`（R13）。
  - CLI（R15）：新对外能力**同 PR 在 `OPERATION_CATALOG` 注册 CLI 命令或 `uiDeepLink`**，否则 `cli-parity:check` 红。
**④ TEST（工业级）**：见 §3 清单（构建/测试/门禁/前端 UI/parity），任一红 → 回 ③。
**⑤ VERIFY（亲手跑，不可省）**：起真服务，按 PRD §7 验收项**亲手用一遍**（含前端 UI 点到/输到、CLI 跑到），确认"真能用"非"测试绿"。命中"绿测试≠能用"即回 ③。
**⑥ 回写本体**：若新增/改了对象类型/链路/事件/不变量/门禁 → **同步 `SYSTEM-ONTOLOGY.md` 对应章节**（PRD §回写承诺已列）。不回写即视为未完成。
**⑦ COMMIT/PR**：每份 PRD 一个分支 + 一个 PR；提交信息含 PRD 编号 + DoD 勾验；PR 描述贴《工业级检测清单》结果。

---

## 3. 工业级检测清单（④ 步逐条过，全绿才进 ⑤）

| # | 检测项 | 命令 / 方式 | 通过标准 |
|---|---|---|---|
| T1 | 构建 | `pnpm -r build` | 4 包全绿 |
| T2 | 单元/集成测试 | `pnpm -r test` | 全绿（agentcore 维持先存 2 失败基线不恶化）；新功能**必须带新测试** |
| T3 | 类型/规范 | `pnpm -r lint && pnpm -r typecheck` | 0 错 |
| T4 | 本体漂移门 | `pnpm ontology:check` | 事件/求解器/锚点/钩子不漂 |
| T5 | 全链闭包门 | `pnpm chain:check` | 场景↔求解器注册 + SHAPE 输出形状 |
| T6 | 去电池锁死门 | `pnpm debattery:check` | 无超基线的内联业务常数（R14） |
| T7 | CLI 对等门 | `pnpm cli-parity:check`（A15 落地后） | 新对外能力有 CLI 命令或 `uiDeepLink`（R15） |
| T8 | PRD 结构门 | `pnpm prd:check` | §0 引用的 R/G 真实存在、无悬空 |
| T9 | 字段全建模覆盖 | `GET /a/v1/field-coverage` / `coverage` | 新类型非派生字段 100% ∈ ≥1 切片（R12） |
| T10 | VLE 闭环（涉合成/派生/求解器时） | VLE 七段 | 行数守恒 / 聚合==明细差分 / 规则查全查准 / 求解器非退化 |
| T11 | 跨服务联调冒烟 | `apps/datacore/test/xservice-smoke.test.ts`（扩本功能关键路径） | 真 AgentCore ↔ 真 DataCore 端到端绿 |
| **T12** | **前端 UI 验收（见 §4）** | 起前端真跑 + 亲手操作 + 截图 | UI 渲染正确、交互可用、数字可溯、事件实时刷新 |

> 任一项红 → **回 ③ DEV**，修完重跑全清单（不是只补红的那条）。

## 4. 前端 UI 工业级验收（T12 展开，不可只看单测）
凡 PRD 含前端（驾驶舱/产能推演/合成向导/对象浏览/FDE 节点图/CLI…）：
1. **真跑**：`VITE_MOCK=1 pnpm --filter frontend-shell dev`（mock 模式）**且** 起真后端（datacore:4001 + agentcore:4002，SEED_DEMO，`SERVICE_TOKEN`+`AGENTCORE_BASE_URL` 配齐）跑一遍——两种模式都要过。
2. **亲手操作**：按 PRD §5 关键流程**逐步点/输**一遍（不是看代码推断）；CLI 项在终端真敲命令。
3. **看四件事**：① 渲染与 PRD 描述一致（布局/KPI/图/表）② 交互可用（下钻/筛选/启动器/审批）③ **数字可溯**（悬浮出 `{来源·新鲜度·公式·因子·规则}`，R13）④ **事件实时**（另一端操作后本页 SLO 内自动刷新，R10）。
4. **截图留证**：关键界面截图贴进 PR（"亲手用过"的证据）。
5. **零业务常数自检**：前端无内联基地名/型号/工序/阈值（R14，`debattery:check` 兜底）。
6. 命中"看起来对但点不动 / 数字不可溯 / 不刷新" → 回 ③。

---

## 5. 跨 PRD 波次 LOOP（项目级）
```
for wave in [W1基座, W2引擎, W3编排, W4验证, W5 CLI/intake]:
    并行开发 wave 内各 PRD（各走 §2 单 PRD 闭环）
    汇总：wave 内全部 PRD DoD 全绿 + 亲手跑通 + 本体回写
    门：跑全套门禁（§3 T1–T12）在合并分支上再过一遍（防互相干扰）
    通过 → 进下一 wave；否则 loop 修当前 wave
```
- **每 wave 一个里程碑 PR/标签**；wave 验收即"该波 PRD 全部 DONE 且系统整体仍绿"。
- 收尾 wave（A14/A12）本就是"亲手跑 + parity 比对"，是对前面波次的总复验。

## 6. DONE 的工业级定义（缺一不算完）
一份 PRD DONE ⟺ ：
- [ ] §7 DoD 每条勾验通过；
- [ ] §3 检测清单 T1–T12 全绿（含**前端 UI 亲手跑通 + 截图**）；
- [ ] 新对外能力 **CLI 命令/深链已注册**（R15）；
- [ ] **本体已回写**（§回写承诺逐条）；
- [ ] 命中的断点（G-x）已闭合或诚实降级登记；
- [ ] PR 合入基线分支，提交信息含 PRD 编号。

## 7. 速查
**不变量 R1–R15**（违反即返工）：R1 contracts-only-shared · R2 tenant_id everywhere · R3 entitlement 先于 authz · R4 真值经 Action 审批 · R5 no-secrets-echo · R6 确定性 · R7 错误信封统一 · R8 认证(JWT/JWKS/SERVICE_TOKEN) · R9 仓储双实现四处同改 · R10 D-29 数据流闭环 · R11 全链闭包 · R12 双向闭包(字段全建模) · R13 结论可溯源 · R14 应用层无业务常数 · **R15 CLI 对等**。
**门禁**：ontology:check · chain:check · debattery:check · prd:check · cli-parity:check(新) · field-coverage · VLE 七段 · 跨服务冒烟。
**命令**：`pnpm install` · `pnpm -r build && pnpm -r test` · `pnpm -r lint/typecheck` · 各 `pnpm <gate>:check`。

## 8. 协作约定
- 一份 PRD 一分支一 PR；提交信息尾部带 PRD 编号；PR 描述贴检测清单结果 + UI 截图。
- 改本体/契约/事件/门禁 **必须同步回写** `SYSTEM-ONTOLOGY.md`（否则大脑过期）。
- 新需求/新 PRD **必须按 `_PRD-TEMPLATE.md` 填《本体引用与影响》§0（含 CLI 打通 R15）**，过 `prd:check`。
- 有歧义先查本体/PRD §0，查不到再问负责人——**不擅自绕审批/绕门禁/写死业务常数**。

## 9. LOOP 自动化建议（可选）
- 每 PRD 用一个"循环到绿"脚本/agent：跑 §3 清单 → 红则定位 → 修 → 重跑，直到 T1–T12 全绿，再人工做 §4 亲手验收。
- CI 上把 §3 的 T1–T8 设为合并前必过门；T9–T12（含 UI）作为 PR 评审清单人工勾验。
