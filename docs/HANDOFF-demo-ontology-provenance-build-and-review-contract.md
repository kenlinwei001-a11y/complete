# HANDOFF · demo 本体经真建模链种 + 对象身份统一（provenance 真实化 · 施工/评审合同）

> **一句话目标**：让 demo 的本体**真正从它的原始数据源经建模链长出来**（rawDataset → 确定性建模 → 发布 → 对象化），使 provenance（R13）因果真实——而**不是**直接注入已发布类型后再补文案/补戳（A/B 补丁已被否决）。硬约束：**下游产物字节级不变**（同样 34 个 type key + 同样 obj id + 同 seed 重跑一致），沙盘/QOS/求解器/全测试零回归。
>
> **为什么做**：复审发现 ModelingPage 中心喊"暂无本体"、34 数据集全"未建模"，根因是 demo 种子**短路了建模链**——`synthetic.runJob` 直接发已发布类型+对象，从不经 `deriveModeling`，类型与数据集无 provenance（违平台第一性原则"数据→建模→本体→对象化是一条可溯源因果链"）。这条 HANDOFF 把短路接回真链路。

---

## 0. 先读什么（动手前）

1. **铁律0**：`docs/SYSTEM-ONTOLOGY.md`——本合同改的是"数据源→建模→本体→对象化"链路 + R13 溯源 + R6 确定性 + 对象身份约定，**改完必回写本体**（§4《本体引用与影响》列了触点）。
2. **本 §1 追溯表**：标「真实/已建」的**只接不重写**（真代码普遍比文档多）。
3. **增量0 永远先做**：起真系统、跑现状种子、**取下游基线**（type key 全集 + obj id 全集 + 沙盘 view-config nodeObjectIds），只看不改。这是后面证"字节不变"的标尺。
4. 交付纪律 `.claude/skills/fde-delivery`：完成=亲手用一遍能用 + 证据，不是测试绿。

---

## 1.《源 ↔ 现状 ↔ 设计》追溯表（评审 oracle · 全栈逐元素）

> 评审对的是这张表，不是 dev 的 claims。每行=一个元素的"水下全栈"：数据源 / 各态 / provenance / 真值判据（FDE oracle，钉 demo 真实态）。

### 1.A 两条 materialize 路径的真相（裁决点）

| 维度 | 现状 A 路（synthetic·直接种） | 现状 B 路（建模链） | 设计（统一后） |
|---|---|---|---|
| type key 来源 | `batteryObjectTypes()` 硬编码 "Base"… (`synthetic/battery.ts:659-694`) | `toPascal(dataset.name)` (`modeling.ts:87`) | **一致**："Base"→"Base"，零变 ✓ |
| **obj id 规则** | `obj_${type}_${pk}` → `obj_base_changzhou` (`synthetic/service.ts:541`) | `obj_${type}_${ds.id}_${pk}` → `obj_base_rds_xxx_changzhou` (`modeling.ts:526`) | **统一为 `obj_${type}_${pk}`**（身份=业务主键，非来源行；B 路去掉 ds.id 段） |
| RawDataset | ✅ 已产，`name=typeKey` (`service.ts:522-536`) | ✅ 作输入前置 | **复用 A 已产的 rawDataset 喂建模** |
| type→数据集 provenance | ❌ 无真链接（`sourceBindings` 是硬编码模板，非真 rawDataset） | ✅ publish 真填 `sourceBindings`/`sourceDataset` (`modeling.ts:104/407-410/446`) | **走 B 路 → provenance 因果真实** |
| 本体链路类型 | `batteryLinkTypes()` order_for_model/model_producible_at/line_belongs_to_base… (`battery.ts:696-732`) | —（建模链按 FK 候选生成） | **保留 A 路链路种法**（沙盘传导规则依赖这些 key，不动） |

### 1.B 受影响 UI 元素 · 全栈 6 项（ModelingPage `/admin/modeling`）

| 元素 | ①视觉 | ②数据源 | ③各态 | ④provenance/不变量 | ⑤交互→后端 | ⑥真值判据（FDE oracle·钉 demo 态） |
|---|---|---|---|---|---|---|
| **左·数据源面板** | 34 数据源（名/行数/未建模徽章） | `/raw-datasets` + coverage | 已建模(绿)/未建模(琥珀) | 徽章=被对象类型消费数；现 `coverageByDatasetName` 只数**草案** (`DataSourcePanel.tsx:30`) | 点「建模为新类型」→ deriveModeling | **demo 34 数据集必显「已建模」**（经建模链种后 provenance 真在），不得全琥珀 |
| **中心·本体画布** | 本体/草案工作台 或 空态 | 现 `draft ? 工作台 : 空态`，只看 `/modeling/drafts` (`ModelingPage.tsx:35,58`) | 现：草案空→喊"暂无本体" | 中心须能反映**已发布本体存在**（非只草案） | 选草案/编辑/发布/对象化 | **demo 打开中心必显真实本体内容**（34 类，可溯到 sourceDataset），**绝不显"暂无本体"** |
| **未建模徽章 copy** | "未建模"/"N 个对象类型" | coverage map | consumers=0→"未建模" | "未建模"语义=真没被任何类型消费 | — | **本体已存在的数据集不得显"未建模"**（语义=真相，不是只数草案） |

### 1.C 已建为真（只接不重写 · RL 守）

- `deriveModelingSuggestion`（`modeling.ts:82`，确定性 toPascal + sourceDataset）、`publish`（`:342-464`，真填 sourceBindings）、`materialize`（`:467`）——**建模链主体已真，只统一 id 规则，勿重写管线**。
- `synthetic.runJob` 产 rawDataset + 链路类型（`service.ts:522-536`/`battery.ts:696-732`）——**复用，勿删**。
- `seedDemoPropagationRules`（`seed.ts:131`，3 条传导规则依赖 Order/Model/Base/Line 真 key）——**type key 不变即不破，勿动**。
- `确定性建模（全字段）`前端入口（`ModelingPage.tsx:132-140`，R12 100% 覆盖）——已在，**复用**。

---

## 2. 增量（串行 · 每增量一 PR · 先证基线再动）

- **增量0（零代码·取基线·必先）**：起真 datacore（`SEED_DEMO=1` seed 42）。导出**下游基线三件**：①全 type key 集 ②全 obj id 集（`GET /a/v1/sim/view-config` 的 `nodeObjectIds` + 对象浏览器逐类型）③同 seed 重跑两次比字节。存 `docs/evidence/demo-provenance-baseline.md`。**这是"字节不变"红线的标尺。**
- **增量1（对象身份统一）**：把建模链 `materialize`（`modeling.ts:524-526`）的 obj id 由 `obj_${type}_${ds.id}_${pk}` 改为 **`obj_${type}_${pk}`**（身份=业务主键）。**必须**：①保留幂等（同 type+pk 重物化→覆盖非重复）②审查无其它租户/测试依赖旧含 ds.id 的 id（全仓 grep `_${ds.id}_` 式引用 + 跑全测试）③多数据集映射同 type+pk 的合并语义=同业务键即同对象（正确语义，但 commit 描述显式声明这是行为变更）。门：现有 modeling 测试全绿 + 新增"同 pk 重物化幂等"用例。
- **增量2（demo 改走真建模链）**：把 `seedDemoSynthetic`（`seed.ts:53`）的本体产出从"`runJob` 直接 upsertType+objects.put"改为：`runJob` 仍产 rawDataset + 链路类型 → **种子接 `deriveModeling(rawDatasets) → 草案 → 发布 → materialize`**。要点：①确定性（无 LLM，走 derive 全字段路径，R6/R12）②发布出的类型带真 sourceDataset/sourceBindings ③对象化复用增量1 的统一 id → **obj id 与增量0 基线逐字节一致** ④链路类型（order_for_model…）保留 A 路种法（沙盘依赖）。
- **增量3（UI 真值闭合·按 §1.B 真值判据）**：①中心区分"无草案"vs"无本体"——本体已存在则显已发布本体（非喊"暂无本体"）②数据源徽章/coverage 认**已发布类型的 sourceDataset**（非仅草案）→ demo 34 数据集显"已建模"。真浏览器逐元素验（jsdom 测不出语义）。

> **若增量1 发现旧 obj id 被跨系统硬引用（AgentCore/QOS 种子/快照）牵动面超预期 → 停手报审核方**，别硬改。

---

## 3. 红线（破一条即打回）

1. **下游字节不变（最高红线）**：增量2 后 type key 集 + obj id 集 + 沙盘 nodeObjectIds **与增量0 基线逐字节相等**；沙盘/QOS/求解器/全测试零回归（含我刚验过的 tick 传导：节点 Σ 仍真变）。
2. **R6 确定性**：同 (battery, S, seed 42) 重跑字节级一致；建模链走确定性 derive，**无 LLM、无时钟/随机**。
3. **provenance 因果真实**：类型的 sourceDataset 是**真经建模链产生**的，不是事后盖戳（B 补丁已否决）。
4. **R2 tenant_id**：全部落 demo；跨租户读不到。
5. **单一身份约定**：统一后全平台只有一条 obj id 规则（`obj_${type}_${pk}`），不留两套。
6. **不重写已真主体**（§1.C）：deriveModeling/publish/runJob 主体只接不改。

---

## 4.《本体引用与影响》（铁律0 · 改完回写本体）

- **对象类型**：RawDataset / OntologyType / ModelingDraft / Object(materialized)。
- **链路**：`数据源(Connection)→RawDataset→建模(ModelingDraft·deriveModeling)→发布(OntologyType+sourceDataset)→对象化(Object)`——本合同把 demo 从"跳过中间两段"接回全链。
- **不变量**：R6（确定性种子）/ R2（租户隔离）/ R12（字段全建模 100% 覆盖）/ **R13（结论可溯源——本合同正是修 R13 在建模层的断点）**。
- **断点**：G-6（FK 驱动建模 / 数据模版）、G-8（数据构建闭包仅部分闭合）——demo 走真链后应推进这两点状态，**回写 §8 对应行**。
- **事件**：dev 核实建模发布/对象化是否发事件（如 `modeling.published`/`object.materialized`），若新增/改变**回写 §4**。
- **身份约定**：obj id = `obj_${typeKey}_${pk}` 写进本体对象身份说明（§2）。

---

## 5. 评审协议（我怎么验 · 不认口头）

- **两轴**：轴1 对 §1 追溯表逐元素；轴2 对 demo 真实态逐元素（§1.B ⑥真值判据）。
- **FDE 真跑**：我亲手起真系统 → ①`diff` 增量0 基线 vs 增量2 后的 type key/obj id 集（必须空 diff）②真浏览器开 ModelingPage：中心显真本体、34 数据集显"已建模"、点一个数据集能溯到它的类型 ③重跑沙盘 tick 看节点仍真变色（身份统一没破传导）。
- **判定**：任一红线破 / 任一真值判据不达 = 打回。**不认"测试绿/已改"**。

---

## 6. 完成判据（FDE · 用户视角）

打开 demo 的 ModelingPage：**中心显示真实本体（34 类，可溯到各自 sourceDataset）**、左侧 **34 数据源全标"已建模"**、点任一数据源能看到它建出的对象类型；且 `obj_base_changzhou` 等 id **一字未变**、沙盘照常 tick 传导。**provenance 链真实可走通**——这才算"最正确",不是补丁。

---

## 7. 禁止清单

❌ 事后给类型盖 sourceDataset 戳（B 补丁）❌ 只改 UI 文案掩盖（A 补丁）❌ 改 obj id 规则却不证下游字节不变 ❌ 留两套 obj id 约定 ❌ 建模链引入 LLM/随机破确定性 ❌ 删/重写 deriveModeling/publish/runJob 主体 ❌ 动 type key 害沙盘传导规则 ❌ 代码先行本体不回写 ❌ 拿测试绿冒充能用。

> 契约生效：从增量0 起逐增量提 PR，我逐 PR 按 §5 评审。**有疑义先问，越红线先停。**
