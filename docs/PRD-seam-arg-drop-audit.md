# PRD/WO · 接缝丢参彻查（SEAM-ARG-DROP · 路由解析→计划构建→求解器 静默丢参）

> 状态：草案 v0.1 · 2026-07-28 · 缘起：ceo_bottleneck「信阳→全12基地」bug（WO-Q2 正修）暴露一个**系统性 bug 类**。
> 遵铁律0：本 PRD 触及 `sys.scenario.launch` 链路（路由→计划→求解器接缝）+ 不变量。

## 1. Bug 类（危险级：静默给错答案·非崩溃）

```
问句 → 路由解析实体 X（baseIds/customerId/segment/…）
        ↓  capability.slotNames 漏声明 X（或 solverArgs 映射不带 X）
计划构建 → solverArgs 丢掉 X
        ↓
求解器缺过滤 → 静默默认「全部/qty=0/空」（risk.ts:106 baseIds??全部）
        ↓
返回 plausible-but-WRONG 答案（信阳→全12基地·CEO 信以为真）
```

**两放大器相交才成灾**：(a) 路由解析了但 slotNames 漏 → 静默丢参 · (b) 求解器缺参默认全部/trivial 而非报错。**(a)×(b) 相交处 = Q2 类 bug**。这是本系统反复栽的「断在接缝·绿测试≠能用」——各半 unit 绿、接缝静默丢参。

## 2. 已知/疑似（预览）

| capability | solver | slotNames | 风险 |
|---|---|---|---|
| ceo_bottleneck | bottleneck_matrix | `[]`→`["baseIds"]` | **已确认·WO-Q2 修中** |
| ceo_credit_exposure | credit_exposure | `[]` | 疑似（路由若解析客户/敞口维 → 丢） |
| ceo_finance_pnl | finance_pnl | `[]` | 疑似（路由若解析基地/型号/期 → 丢） |
| 其余 ceoCaps / sim-planner plans / intent catalog | — | — | **待 Phase 1 审计** |

## 3. 三相位交付

### Phase 1 · AUDIT（只读·本 PRD 派只读 agent 出台账·不改码）
交叉扫描两半：
- **(a) 丢参接缝**：每 intent/capability——路由能解析的实体（`ceo-route.ts resolveCeoRoute` / `sim-planner.ts` / `*-route.ts` / `resolve*`）∖ slotNames 声明 = 被静默丢的实体集。
- **(b) 求解器静默默认**：`apps/datacore/src/solvers/*.ts` 里 `args.X ?? 全部/[] / qty=0 / 缺参→trivial` 的兜底。
- **交叉**：(a) 的 intent 其 solver 在 (b) → CONFIRMED 候选。
产出台账：`intent | solver | 路由解析 | slotNames | 丢的实体 | 求解器缺参默认 | 判定(CONFIRMED/SAFE/NEEDS-CHECK)`。

### Phase 2 · FIX（每确认项·数据/引擎两半一单）
- **数据半**：补 slotNames + 专门 solverArgs 映射（同 WO-Q2：json/array 槽走专门映射·非通用单字段）。
- **引擎半·诚实化默认**：求解器缺过滤时**不静默返全部**——要么显式标 `scope:"ALL"`（前端可见"未指定→全域"），要么在有解析上下文却收不到过滤时**报 `AMBIGUOUS_SCOPE` 警**。把"静默错答"降级成"诚实标全域/报错"（KILL-MOCK-RED 同理：宁可标清楚也不假装精确）。

### Phase 3 · GATE（真正的修·堵死整类·防回归）
加一道**接缝门** `scripts/check-arg-drop-seam.mjs`（并入 `pnpm gates`）：
- 断言：**每 intent 的"路由可解析实体集" ⊆ slotNames ∪ 显式豁免表**（漏声明即红）。
- 断言：**每吃过滤维的求解器·缺该维时或报错或显式标 scope（无静默全部）**。
- SEAM 测：造一条"带基地名的深问"→ 端到端断言答案只含该基地（跨 router×plan×solver 接缝驱动·非各半 unit）。

## 4. 本体引用与影响

- **链路**：`sys.scenario.launch`（ScenarioCard→Intent→presetContext→Query→plan→solver）——本 bug 落在 **plan→solverArgs** 接缝。
- **不变量（新增）**：**R-ARG-FIDELITY**「路由解析出的过滤实体必达求解器，或被显式声明/豁免；求解器缺过滤维不得静默返全域」。
- **断点（新增）**：**G-ARG-DROP-SEAM**（路由解析→计划构建静默丢参 + 求解器全部默认 → 静默错答）。Phase 3 门落地即闭。
- **回写**：Phase 3 门落地 → `SYSTEM-ONTOLOGY.md` §5 加 R-ARG-FIDELITY · §7 加门 · §8 记 G-ARG-DROP-SEAM。

## 5. 验收（SEAM-GATE 头号判据）
- Phase 1 台账覆盖全 ceoCaps + sim-planner plans + intent catalog（无遗漏声明）。
- 每 CONFIRMED 项：端到端 SEAM 测（带实体深问 → 答案只含该实体）通过。
- Phase 3 门有牙：故意把某 intent 的 slot 删掉 → 门变红（证门真拦）。
- 四包全绿 + `pnpm gates`（含新门）。

## 6. 派发建议
- **Phase 1**：1 只读审计 agent（本轮即派·出台账）。
- **Phase 2**：按台账每 CONFIRMED 项一单（数据+引擎两半一个 dev 整单·避 metric-aware 老坑）。
- **Phase 3**：1 单（门 + SEAM 测 + 本体回写）——**最高价值·先于逐项修也行**（门先立，逐项修 PR 自然被门验）。
