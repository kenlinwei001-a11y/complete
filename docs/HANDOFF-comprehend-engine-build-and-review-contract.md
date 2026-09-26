# HANDOFF · 数据构建发动机收尾（comprehend 引擎 + 终态闭环）· 开工与评审合同

> **这是 H3**（见 `HANDOFF-ROADMAP.md`），北极星轨：让"一句故事→倒推全栈→真能推演"可靠闭环。
>
> ⚠️ **这份 HANDOFF 的特殊背景（必读，防你白干）**：`TODO-fde §2` 说 comprehend 引擎"🔴 对新颖故事产空骨架"——**这份说法已过期（stale）**。2026-06 真代码摸底（锚点见 §1）发现：**引擎主体已建**（LLM+确定性地板覆盖新颖故事 / 多跳切片 / 两库 / 8 节点 FDE 流 / 7 步闭包链都在）。**所以 H3 不是"从零建引擎"，是收尾摸底定位的 3 个真断点 + 先 FDE 真跑坐实引擎到底能不能用。照 stale 的 TODO 从零重写 = 砸掉已能用的东西，红线级打回。**

---

## 0. 先读这些（按序）

| 顺序 | 文档/锚点 | 读它干嘛 |
|---|---|---|
| ① | `docs/SYSTEM-ONTOLOGY.md` | 铁律0：对象/链路/不变量 R1–R17/门禁/断点。改了就回写 |
| ② | `docs/START-HERE-dev-agent.md` | 角色边界 + 同分支纪律 + 通用红线 |
| ③ | `docs/TODO-fde-build-engine.md` | 北极星**目标**来源（§2/§3/§5/§6）——但**状态字段已 stale，以本文件 §1 现状表为准** |
| ④ | 本文件 §1《源↔现状↔设计》追溯表 | **核心**：每个目标元素 → 真代码现状（真实/桩/缺+锚点）→ H3 要不要动。**设计绑死到真代码，不照 stale TODO** |
| ⑤ | `.claude/skills/fde-delivery` | 完成=亲手用一遍能用，不是测试绿 |

---

## 1. 《源↔现状↔设计》追溯表（防遗漏的绑定清单 · H3 的宪法）

> 规则：**每个目标元素必须在此表有一行**，标明真代码现状 + H3 处置。**现状=「真实」的不许重建；「桩/缺」的才是 H3 范围。** 评审时对照本表逐行核（任一元素无映射=设计遗漏，打回）。现状锚点为 2026-06 摸底实勘（绝对路径行号）。

| # | 目标元素（源：TODO-fde） | 真代码现状（真实/桩/缺 · 锚点） | H3 处置 |
|---|---|---|---|
| E1 | comprehend：故事→倒推规则/求解器/agent | **真实** `databuilder/service.ts:75-89`（LLM 优先）+ `comprehend.ts:268-387`（确定性地板覆盖新颖故事） | **不建**（只在增量0 FDE 真跑坐实非空） |
| E2 | LLM 容错归一（措辞鲁棒不静默失败） | **真实** `comprehend.ts:14-47` `LlmComprehendSchema` | 不建 |
| E3 | 自造求解器名兜底→自成长工单 | **真实** `comprehend.ts:145-181` `SOLVER_ALIASES`/`normalizeSolverKey`(标 SOLVER_NOT_FOUND) | 不建 |
| E4 | freezePlan 字节一致（R6 封存） | **真实** `contracts/databuilder.ts:39` + `service.ts:496-500`（scriptHash 存了**但未用于重放幂等校验**=桩） | **增量1 顺带补**：scriptHash 接入重放幂等校验 |
| E5 | 富多跳切片（Order→Process→Equipment） | **真实** `slice-planner.ts:69-102` `planSlice` 确定性 BFS 多跳 | 不建 |
| E6 | 切片索引 + 复用 | **真实(部分)** `slice-index.ts:37-42`（按 rootType+覆盖类型复用）；**缺** description/indexEntities 近似问句命中 | **增量4**：补 description+近似问句命中复用 |
| E7 | 域内/跨域两库读模型 | **真实** `slice-library.ts:21-80` deriveIntra/deriveCross | 不建 |
| E8 | 字段役色解析（确定性，不消歧） | **真实** `field-roles.ts:67-112` resolveFieldRoles | 不建 |
| E9 | 终态闭环：DRAFT→闭包→审批→publish | **真实** `service.ts:323-429/753` runStory 7 步 + validateClosure HARD gate | 不建（增量5 整链 FDE 验收） |
| E10 | FDE 编排工作流（可观测 8 节点） | **真实** `fde-graph.ts:19-142` FDE_NODES + projectFdeNodes | 不建 |
| E11 | 能力清单 + 比差 | **真实** `capability-inventory.ts:35-49` diffNeeds（gapCode） | 不建 |
| E12 | 模块同步矩阵 | **真实** `contracts/storybuildrun.ts:179-195` buildModuleSyncMatrix | 不建 |
| **E13** | **用途→provider→model 三元组路由** | **🔴 缺** `service.ts:79` model 硬编码 "comprehend"，无 purpose→provider→model 映射表 | **增量1（P0）** |
| **E14** | **14 域运营本体不变量**（factory 域必含 Base/Line/Equipment 等） | **🔴 缺** 仅 `comprehend.ts:109` 域名枚举，无运营约束→倒推可能产碎片对象树 | **增量2（P1）** |
| **E15** | **B 栈制品入启动器** | **🔴 缺** `fde-graph.ts` node8 launcher 为 NONE 型，无产物/HARD gate；scaffold DRAFT plan/agent/scene 入 QOS 启动器机制不明 | **增量3（P1）** |
| E16 | B 栈 scaffold 单机可见 | **真实(可见)** `scaffold-manifest.ts` 无回执→全 PENDING_BSTACK（DataBuilderPage 可见但不生效） | 不建（可见已达；"生效"属 E15） |
| E17 | 拟真值域合成数据（值落业务区间+越线样本） | **缺/桩**（TODO-fde §2，通用 hash demandDelta=390） | **本 H3 不收**（属合成数据轨，另立或 Pass-2 定级） |
| E18 | 真实数据接入选项（真人工单/真连接器，非只合成兜底） | **缺**（TODO-fde §2） | **本 H3 不收**（属连接器轨，另立） |
| E19 | CP-SAT sidecar（selection/assignment/sequencing/packing） | **真实** `optimizer-client.ts` + `services/optimizer` | 不建（扩模型属 H2 优化融合轨） |

> **明确不建（防重写已能用）**：E1/E2/E3/E5/E7/E8/E9/E10/E11/E12/E16/E19。**H3 范围 = E13/E14/E15（3 断点）+ E4/E6（两小补）+ 增量0/5（FDE 坐实与验收）。**

---

## 2. 建什么（范围）

**建**：用途→provider→model 路由表（E13）· 域运营本体不变量（E14）· B栈制品入启动器闭环（E15）· 切片近似问句复用（E6）· freezePlan 重放幂等校验（E4）。
**先验后建**：增量0 起真服务对**新颖故事**跑 runStory，坐实/推翻"引擎产非空骨架"——**这一步先于一切建设**（L5 现实对位；坐实 stale TODO 真假）。
**不建**：§1 标「真实」的 13 项引擎主体。**动它们=红线打回。**

---

## 3. 怎么建（增量顺序 · 每增量 DoD）

| 增量 | 标题 | 做什么 | DoD（亲手验 + 门绿） |
|---|---|---|---|
| **0** | **FDE 真跑定基线**（先于建设） | 起内存态 datacore（SEED_DEMO）→ 用一个**新颖故事**（非内置 demo，如"某工序共享一台瓶颈设备，故障时下游降级、影响交付"）调 `runStory` → 抓 BuildPlan/ClosureReport/ModuleSyncMatrix | **贴真输出**：comprehend 产出非空（objectTypes/rules/solverNeeds 各≥1，**坐实或推翻 TODO §2 的"空骨架"**）；FDE 8 节点状态；**诚实记 baseline**（哪几节点 NONE/失败）。**这步只看不改** |
| **1** | E13 · 用途→provider→model 路由（P0） | 去 `service.ts:79` 硬编码 model="comprehend"；建 `purpose→provider→model` 解析（复用 `llmproviders.ts` 租户路由 + LLM 用途绑定矩阵）；E4 顺带：freezePlan 用 scriptHash 做重放幂等校验 | 租户绑不同 provider→comprehend 自动解析到真模型 id（贴证据）；同 (script,seed) 重放字节一致（R6）；`debattery:check` 绿（无业务常数） |
| **2** | E14 · 域运营本体不变量（P1） | 编码 14 域运营约束为**数据**（`ONTOLOGY_DOMAIN_INVARIANTS`，如 factory 域必含 Base/Line/Equipment）；comprehend/closure 增"跨域完整性"校验，碎片树→GapReport 诚实标 | 倒推出孤儿 Process（无 factory 根）→ closure 报 `DOMAIN_INVARIANT_VIOLATION`（非静默）；新颖故事倒推的对象树域完整；零业务常数（约束是数据非代码） |
| **3** | E15 · B栈制品入启动器闭环（P1） | `fde-graph.ts` node8 launcher 从 NONE 升为**有产物+判据**：scaffold 的 DRAFT plan/agent/scene → 显式注册进 QOS 场景启动器 → 末步**重跑触发问句验证真出答案**（复用 inferenceProbe/grow 诚实门） | 新颖故事 build→publish 后，**场景启动器真出现该卡**，点击**真推演出非空可溯源结果**（贴截图/输出）；验证失败→PROVISIONAL+gapCode 不静默 |
| **4** | E6 · 切片按近似问句复用（P2） | `slice-index` 扩 description+indexEntities；近似问句→检索命中既有切片复用，不重规划 | 问一句→生成切片入库（带描述）；再问近似句→**命中复用**（贴证据，命中 sliceKey 一致）；确定性 R6 |
| **5** | 终态闭环 FDE 验收 | 用增量0 那条新颖故事跑完整链：倒推→闭包→R4 审批→publish→进启动器→重跑验证 | **以用户身份亲手走通一遍**（截图：构建驾驶舱节点全绿→启动器出卡→推演出结果可溯源）；对照增量0 baseline 标"还差什么/哪些 happy-path" |

---

## 4. 红线（越线即停）

- **十红线**（本体 §5）：尤其 **RL3 单一来源**（comprehend/切片/闭包已有实现，**只接不重写**）· **RL4 走正门**（生成全 DRAFT，R4 审批才落真值）· **RL5 零业务常数**（域不变量/路由表是**数据/配置**，不写死，`debattery:check` 守）· **RL6 确定性**（freezePlan 字节一致，无 Date.now/random）· **RL9 additive 可回退**。
- **不重写已建引擎**（§1 标「真实」13 项）——动它们=打回。
- **stale-source 红线**：任何改动以 **§1 现状锚点**为准，**不照 `TODO-fde` 的状态字段建**（它已过期）。发现现状与 §1 表不符 → 先回写本表 + 报告，别闷头建。
- **R11/R12 闭包**：新校验（域不变量）走 `validateClosure`/closure 维，缺件诚实进 GapReport，不静默不阻断成 0。
- **提交物洁净**：模型标识符不进任何提交物。

---

## 5. 评审协议（审核方按此 review · 含防遗漏双轴）

每增量逐项核，全过才"可合"：
1. **十红线** 不违反（尤其 RL3 没重写已建引擎 / RL5 零业务常数）。
2. **门全绿**：`pnpm -r build && pnpm -r test && pnpm gates` + `chain:check`/`debattery:check`/相关命名门。
3. **本体回写**：新对象（域不变量/路由表）/链路/门 → 回写 §2/§3/§4/§7/§8，`ontology:check` 绿。
4. **§1 追溯表逐行核（防遗漏轴1）**：每个目标元素有映射；标「真实」的没被重写；标「缺」的真建了。
5. **FDE 亲手证据（防遗漏轴2 + L5 现实对位）**：增量0/3/5 必附**起真系统、以用户身份跑新颖故事**的截图/输出——**不认"代码在"，要"真跑出非空可溯源结果"**。
6. **CLI 对等**（R15）+ **可回退**（flag/迁移 down）+ **北极星距离**（PR 描述列"还差什么/哪些 happy-path"）。
7. **stale-source 核**：改动是否对照 §1 真代码锚点，而非照 stale TODO。

> 评审产物：✅可合 / 🔴打回（列项+红线+建议）。**审核方不替实现，只评审 + 守纪律。**

---

## 6. 提交规范

每 commit 按 `START-HERE-dev-agent §6` 模板（做了什么对照增量N/§1 哪个 E · 复用什么证不分叉 · 本体回写 · 高冲突文件点名 · CLI · 测试贴绿 · **FDE 亲手证据** · 北极星距离 · 回退）。只 commit+push 到 `claude/vigilant-knuth-b1nmxn`，push 前先 rebase。co-author `Claude <noreply@anthropic.com>`，模型标识不进提交物。

---

## 7. 起步第一步（建议立刻做）

**增量 0（只看不改、立得住）**：读 §0①②③ + §1 追溯表 → `pnpm install && pnpm -r build && pnpm -r test`（4 包应绿）→ 起内存态 datacore（`SEED_DEMO=1`）→ 用一个**新颖故事**（非内置 demo）调 `runStory`/`POST /a/v1/databuilder/...` → **贴真输出**：comprehend 产出是否非空、FDE 8 节点状态、闭包报告。**坐实"引擎到底能不能用"是这份 HANDOFF 一切建设的地基**（先证伪 stale TODO，再动 E13/E14/E15）。有歧义先问。
