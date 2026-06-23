# PRD · 生成接地层 GenerationBoundary（v1.0 落档 + 勘误注）

> 来源：用户上传 v1.0 DRAFT（`1a342de1-PRDgenerationboundarygrounding_2.md`，2026-06-23）。本档 = **勘误注（grep-verified，3 处同类锚点错）+ v1.0 全文**。
> 关系：本档**取代** `PRD-self-driving-qos-data-foundation.md` 的 Part A 接地范围（后者保留为更宽的 self-driving-QOS 分析底稿）。落地以本档 + 勘误为准。
> 评审人：实现 agent（claude）。状态：**核心论点 grep-verified 站得住；勘误 3 处锚点后即可作 DF.0 起手的施工级文档**。

---

## 勘误注（治理铁律：锚点必须逐条 grep；v1.0 仍残留 3 处同类错）

> v1.0 已大幅修好 v0.2（机制vs接地 framing 对、5 缺口对、llm-gen 实证逐字对、ModuleProvisioner 13-need 对、删掉 growth.ts 重建错）。**但 §5 锚点表仍有 3 处「锚点未逐条 grep」的同类错**——落地前必须按下表改：

| # | v1.0 原文 | grep 实测（证据） | 勘误 |
|---|---|---|---|
| 🔴1 | §171 `migration024_boundary.sql` | `ls apps/datacore/migrations/` → `022_data_category_settings` `023_build_workflow_runs` **`024_solver_artifacts`** `025_reconcile_candidates` 已占 | **改 `026_boundary.sql`**（024 = A18 solver_artifacts，撞车；下一个空号 026）。与 v0.2 的 014 撞车**同款错**。 |
| 🔴2 | §170 `apps/datacore/src/growth/loop.ts`（HARD/SOFT 分流锚点） | `apps/datacore/src/growth/` **不存在**；`loop.ts/probe.ts/scaffold.ts` **在 `apps/agentcore/src/growth/`**；`/api/v1/growth/{probe,run}` 在 `agentcore/server.ts:204/219`；datacore 侧仅 `app.ts:1036 /a/v1/growth/fill-data` | **分流是跨服务接缝**：HARD→DataRequest 改 **agentcore `growth/loop.ts`**；SOFT→合成 改 **datacore `app.ts:1036 fill-data`**。非单 datacore。 |
| 🟠3 | §3.7 / 附录B / DF.13 BP-4 当缺口 | `orchestrator.ts:295/438` 已传 `classification.extractedSlots`；`slots.ts:123` objectRef 已从 context(`getObject`)+裸串("常州"/"4680-NCM")跨类型解析 | **BP-4 已建** → 从 DF.13 移除；仅当能复现 §EV-S01「永久澄清」具体 case 才查残留，不预先开发。 |

**附加（§5 锚点表其余条目）**：落地前逐条 grep；附录 A 复用声明偏薄——`FactoryCalendar`（OC9）仅 `repo.ts` 一处、`ExternalSignal`（§51）须复核存在性后再写"接 X"。

**v1.0 grep-verified 站得住的核心（可直接信）**：
- 实证 `llm-gen.ts:12/26/31`（只注入类型 `{typeKey,props}` schemaText，无实例词表/列目录/越界拒绝 → 能引真类型仍可造业务事实）——**逐字对**，这是 PRD 第一论点的硬证据。
- `ModuleProvisioner`（`provisioners.ts:3` 从 BuildPlan 13 need 反推、不从 outputFields）——拉取靶 keystone(③) 是真缺口、与它互补，确认。
- `SOLVER_OUTPUT_SHAPES`/`renderBindings`/`validateClosure`（G-8 SHAPE）锚点真。
- 5 缺口（①生成接地 ②语义目录 ③outputFields 拉取靶 ④精确数据请求正门 ⑤A/B归一+需求可溯）全 grep-verified 为真缺。

**起手不变**：P0 = DF.0 对账 + DF.1 单一来源 keystone（`battery.ts`→`synthetic/boundary.ts`，值字节不变 R6）+ DF.2/3（提升 BASES/SEG，灭漂移）→ 紧接 DF.5/6/8（生成不造假）。**migration 用 026、growth 分流认 agentcore、不做 BP-4。**

---

# 附：PRD v1.0 全文（原始上传，未改；落地以上方勘误为准）

> 版本 v1.0 · 状态 DRAFT · 落地分支 `claude/vigilant-knuth-b1nmxn`。一句话：本体 R16「发育闭环」+ A18/自成长生成机制**已落**，但是**"无业务接地的生成"**（能 scaffold 跑通、却可编造业务事实）；本 PRD = 加 **GenerationBoundary 接地层**（业务词表硬/软 + 语义目录 + 拉取靶），把生成框成"只引用边界内实体、不造业务事实"，同一份边界作单一来源根治 `battery.ts` 硬编码（闭 G-5/R14）。**不重建 R16/A18 机制。**

## 本体引用与影响（铁律0）
- **不变量**：R14（应用层无业务常数，battery.ts 现违反/守 G-5）· R16（发育闭环——本 PRD 是其"倒序发育生成接地"缺件）· R6（boundary seed+version 字节一致）· R13（临时件/合成标 origin）· R12（拉取靶=输出侧反向-data）· R4（boundary DRAFT→PUBLISH 经审批）· R2/R3/R9/R10。
- **断点**：G-5（电池锁死 8b 业务数据写死 = 主修）· G-8（闭包跨栈——拉取靶 outputFields 补 SHAPE 维）。
- **对象**：新增 `GenerationBoundary`/`BoundaryItem`/`ImportPort`；扩 `FieldProfile`/`PropertyDef` += description；复用 `SyntheticJob.valueDomain`/`DataCategory`/`Connection.category`/`SolverArtifact`/`llm-gen`/`SOLVER_OUTPUT_SHAPES`；改 `ScenarioPackage` 去 `pkg_battery_manufacturing` 写死。
- **回写承诺**：实现后回写 §2.A（GenerationBoundary）+ §8 G-5（断点收窄）+ §4（新事件 boundary.published / data_request.*）+ §5 R16（接地环补全）。

## 核心论点
R16 倒序发育的"生成"机制（A18 + 自成长 + ModuleProvisioner）已落，但 prompt 只注入类型级 schema（typeKey{props}）——无实例词表/列目录/越界拒绝 → 能引真类型却可编造基地名/型号/数值。本 PRD 装【生成接地层】：业务词表(硬只能引用/软可提议) + 语义目录(列描述) + 拉取靶(视图声明要的字段) → 生成"只取边界内实体、不造业务事实" ⊕ 同一份边界=单一来源根治 battery.ts。**两条正交价值**：①生成不造假（接地 R16 生成端）②改数据不崩别处（单一来源根治 G-5）。

## 设计（10 类边界硬/软 · 语义目录 · 拉取靶 keystone · 生成接地 hook · 真人正门 HARD/SOFT 分流 · 单一来源+影响图+版本化 · Part B 补缺+BP-7+前端可见+需求可溯）
详见原上传 §3.1–3.7；契约（boundary.ts：GenerationBoundary/BoundaryItem/ImportPort/DataRequestTicket + FieldProfile/PropertyDef/SolverGenSpec/VIEW_DEFS 扩展）见原上传 §4。

## 开发顺序 DF.0–DF.16（依赖排序 · 复用机制不重建 · 接地为脊柱）
- **P0**：DF.0 对账 · DF.1 boundary 单一来源 keystone（字节一致 + `boundary-singlesource:check` 门）· DF.2/3/4 提升 BASES/SEG/ROOT_LIB。
- **P1（接地地基）**：DF.5 语义目录(description+catalog/search) · DF.6 拉取靶 `VIEW_DEFS.outputFields`（喂 BuildPlan-need，与 ModuleProvisioner 接缝前置）· DF.7 影响图。
- **P2（接地核心）**：DF.8 生成接地 hook（扩 llm-gen 注入词表+目录+越界拒绝）· DF.9 真人正门 HARD/SOFT 分流（**勘误：agentcore growth/loop.ts + datacore fill-data**）。
- **P3**：DF.10 boundary 版本化 · DF.11 A5 自动抽。
- **P4**：DF.12 绑定面板 · ~~DF.13 BP-4~~（**勘误：已建，删**）· DF.13b BP-7 意图 scaffold · DF.13c 前端文件↔表可见。
- **P5**：DF.14 需求可溯(§EV→GrowthLedger) · DF.15 A/B 归一评估 · DF.16 C/D 真缺 delta。
- **依赖**：`DF.1→{2,3,4}` · `{2–5}→DF.8` · `DF.5+6→DF.7` · `DF.1→DF.9/10`。**DF.6 拉取靶 + DF.8 接地 hook 不可后置。**

## 验收（关键）
- A1 boundary 发布、battery 主数据全出边界、`debattery:check` 基线 0、同 seed 字节一致。
- A3 **接地核心**：注入虚构基地名→拒绝/标红；边界内实体→通过；同 seed 确定。
- A4 HARD 缺→终态 BOUNDARY+精确列 DataRequest（非静默合成）；fulfill→重跑可答。
- A5 拉取靶 outputFields 喂 ModuleProvisioner，缺求解器输出字段→TO_CREATE。
- A7 回写本体 §2.A/§8/§4/§5。

> 附录 A（10 类边界详表）· 附录 B（§EV 10 卡断点账本，BP-1 sop_balance 是工作流非求解器）见原始上传全文。
