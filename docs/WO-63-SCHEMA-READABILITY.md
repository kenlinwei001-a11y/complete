# WO-63-SCHEMA-READABILITY · 本体可读性达标（"业务专家能看懂"）

> **验收判据（用户定义）**：找 1 个**完全没参与建模**的业务专家，1 小时读完 Schema → 能讲出 **80%**。
>
> **本单不是"翻译一遍字段名"**。查证后结论是：**承载可读性的字段大多已存在，但是空的、或者前端没消费**。所以本单 = 填数据 + 接消费 + 加门锁住，不是造机制。

---

## 一、现状取证（**已核实**，dev 需自行复核一遍再动手）

| 事实 | 位置 | 状态 |
|---|---|---|
| 属性口径字段 `description`（"这字段是什么"）**已存在** | `packages/contracts/src/ontology-semantics.ts:22-23` | ✅ 字段在，`.optional()` |
| 属性单位 `unit` **已存在** | `packages/contracts/src/ontology-semantics.ts:24-25` | ✅ 字段在，`.optional()` |
| 派生公式 `formula` **已存在** | `packages/contracts/src/ontology-semantics.ts:34-35` | ✅ 字段在 |
| 单位单源消费（范式级三处）**已落** | `contracts/solvers.ts` `TIGHTNESS_METRIC`/`formatTightness`；`contracts/global-sim.ts` `OBJECTIVE_UNITS`/`objectiveHeader`/`KPI_DIM_UNITS`；generic_inference 逐行取 `PropertyDef.unit` | ✅ 已做 |
| 管理页计数/得分补量纲 | commit `8d347c66`（MergePage/ModelingPage/ObjectTypesBrowserPage） | ✅ 已做 |
| **"这个概念在业务里指什么"没有落点** | 全本体无字段承载"业务定义 + 谁定的 + 为什么这么定" | ❌ **真缺** |

**结论**：`description`/`unit` 是**有字段没数据**（或有数据没被前端消费）；唯一真缺的是**概念级业务定义**（统一语言载体）。

---

## 二、《本体引用与影响》

- **对象类型**（§2）：`OntologyType` · `PropertyDef` · `DerivedPropertyDef`
- **链路**（§3）：`半自动建模(A3) → PropertyDef → 已发布本体 → ontology-semantics 投影 → 前端渲染 / Agent 上下文`
- **不变量**（§5）：**R13 结论可溯源**（本单扩展其含义：不止数值可溯源，**概念定义也须可溯源**）· **R14 应用层无业务常数**（单位/口径不得在前端硬编码）· **R-一致**（一个事实一个出处）
- **断点**（§8）：`G-UNIT-NORMALIZE`（本单收尾）· `G-5 应用层电池锁死`（可读性差是其下游症状）
- **本单新增字段 → 必须回写本体 §2 对象类型章节。**

---

## 三、🚦 范围边界

**允许改**：
- `packages/contracts/src/ontology-semantics.ts`、`packages/contracts/src/datacore.ts`（**仅 additive optional**）
- `apps/datacore/src/synthetic/battery.ts`（出厂 51 个类型的属性口径数据）
- `apps/datacore/src/ontology-core.ts` / `modeling.ts`（投影与发布路径）
- `apps/frontend-shell/src/pages/admin/ObjectTypesBrowserPage.tsx`、`ModelingPage.tsx`（消费展示）
- 新增门脚本 `scripts/check-schema-readability.mjs` + 注册进 `package.json` 的 `gates`
- 相应测试

**禁止**：`apps/agentcore/**`；contracts 的破坏性改动（新字段一律 `.optional()`）。

---

## 四、分阶段实施（P0 → P2，每阶段独立可交付、可验收）

### P0 · 建立**基线度量**（先量化，再动手；不量化就无法证明改进）

新增门脚本 `scripts/check-schema-readability.mjs`，读 datacore dist 的出厂本体，输出并断言四项覆盖率：

```
属性口径覆盖率  = 有非空 description 的 PropertyDef 数 / 总 PropertyDef 数
单位覆盖率      = 数值型(number) PropertyDef 中有非空 unit 的比例
中文名覆盖率    = 有 displayName（非等于 key）的 PropertyDef 比例
概念定义覆盖率  = 有 businessDefinition 的 ObjectType 比例（P1 引入后生效）
```

**P0 交付即报出四个真实数字**（这就是"当前得几分"）。门此阶段设为**基线不倒退**（当前值即门槛），后续阶段逐级抬高。

> ⚠️ 门必须显式捕获退出码。**禁止** `cmd | tail; echo $?`——`$?` 取的是管道末端 `tail` 的（恒 0），本仓曾据此把编译失败判为通过。

### P1 · 概念级业务定义（统一语言载体·**本单唯一的真新机制**）

`OntologyType` 加 additive optional 字段：

```ts
/**
 * 业务定义（Ubiquitous Language 载体）：这个概念**在本企业业务里**指什么。
 * 与 name/displayName 不同——那是"叫什么"，这是"是什么、边界在哪、谁不算"。
 * R13 扩展：不止数值可溯源，概念定义也须可溯源（decidedBy/decidedAt/rationale）。
 */
businessDefinition: z.object({
  /** 一句话定义，必须能回答"谁算/谁不算"。禁空泛词（见门的禁用词表）。 */
  statement: z.string().min(10).max(500),
  /** 排除边界："不包括…"——这一条比正面定义更能防歧义。 */
  excludes: z.string().max(300).optional(),
  /** 决策来源：哪位业务专家/哪次评审定的（岗位或姓名，租户内可追）。 */
  decidedBy: z.string().optional(),
  decidedAt: z.string().optional(),
  /** 为什么这么定（存在多种合理定义时，记录取舍理由）。 */
  rationale: z.string().max(1000).optional(),
}).optional(),
```

**为什么需要这个**：同一个"客户"，可以是买产品的人 / 付钱的人 / 用服务的人 / 影响决策的人——**四个答案对应四套数据模型**。现在这个决定做完就丢了，只剩一个字段名。

**至少为这 8 个核心类型填上**（其余可 P2 补）：`Order` · `Base` · `Model` · `Customer`（若存在）· `Equipment` · `Material` · `Process` · `Metric`。

**门**：核心类型 `businessDefinition.statement` 必填；`statement` 命中禁用词表（`有用`/`强大`/`全面`/`各种`/`相关的`/`等等`）即红——照抄 `apps/agentcore/src/skill-lint.ts` 的 `FORBIDDEN_WORDS` 思路，**词表单一来源，不许再抄一份**（本仓刚因"同一词表多处手抄"吃过亏）。

### P2 · 口径与单位填满 + 前端真消费

1. **填数据**：为出厂 51 个类型的 PropertyDef 补 `description` 与 `unit`。
   - `unit` **只填有量纲的**。无量纲的（比率、序号、ID、布尔）**不许硬凑**——诚实的"不填"优于编造。门只对 `dataType === "number"` 且不在无量纲白名单里的属性要求 `unit`。
2. **中文显示名**：`Material.leadTime` 这类英文键，**不改 key**（改 key 是破坏性的，会断所有引用），而是补 `displayName: "到货周期"` 并让前端**优先渲染 displayName**。
   - 若 `PropertyDef` 当前没有 `displayName` 字段 → additive 加上。**dev 需先查证是否已存在**（本单不预设）。
3. **前端接消费**：`ObjectTypesBrowserPage` / `ModelingPage` 的属性列渲染改为 `displayName ?? key`，并在旁显示 `unit`；hover 显示 `description`。
   - **禁止在前端硬编码任何中文名或单位**（R14）——一律来自后端字段。

---

## 五、SEAM 红咬（**效果层断言**，每条都要能变异反证）

| # | 断言 | 变异（改坏后必须变红） |
|---|---|---|
| S1 | 门对四项覆盖率的实际值与门槛做比较，低于门槛即非零退出 | 把某核心类型的 `description` 置空 → 门红 |
| S2 | 8 个核心类型的 `businessDefinition.statement` 存在且长度 ≥10 | 删一条 → 门红 |
| S3 | `statement` 含禁用词即红，且**词表与 skill-lint 同源** | 把 `FORBIDDEN_WORDS` 在本门里另抄一份 → 应有测试断言二者同源，改一处不同步即红 |
| S4 | 前端属性列渲染 `displayName` 而非 `key`；单位来自后端字段 | 把后端某属性的 `unit` 改掉 → 前端显示**跟着变**（证明不是硬编码） |
| S5 | 无量纲属性**不得**被强行标单位 | 给一个 ratio 属性填 `unit: "个"` → 门红（白名单校验） |
| S6 | R13：`businessDefinition` 带 `decidedBy` 的类型，其定义可溯源到具体来源 | 抹掉 `decidedBy` → 该类型进"未溯源"清单并被门统计 |

---

## 六、验收清单

- [ ] P0 门跑通并**报出四个真实覆盖率数字**（这是"当前得几分"的答案）
- [ ] 8 个核心类型有 `businessDefinition`，且每条都能回答"谁不算"
- [ ] 数值型属性单位覆盖率 ≥ 95%（无量纲白名单外）
- [ ] 前端属性展示走 `displayName`/`unit`/`description`，**全仓 grep 前端无硬编码中文属性名或单位字符串**
- [ ] S1–S6 六条断言各有变异反证的**两次实际输出**（红 / 绿）
- [ ] `npx tsc -p <各包>/tsconfig.json --noEmit` 真退出码 0
- [ ] 本体 §2 已回写新增字段语义
- [ ] **诚实边界**章节：哪些类型/属性没填、为什么

---

## 七、反假绿纪律

1. **退出码显式捕获**：`out="$(cmd 2>&1)"; rc=$?`。禁止管道后取 `$?`。
2. **vitest 不做类型检查**：TEST 绿 ≠ 能编译，必须另跑 `tsc --noEmit`。
3. **变异反证**：每条断言改坏→红、还原→绿，两次输出都贴。
4. **fixture 不许自造契约没有的字段**（`as SomeType` 强转 + 自造字段 = 测试自产自销）。
5. **覆盖率数字不许估算**，必须由门脚本从真实 dist 数据算出。
6. **"填满了"这三个字**，除非门报出的覆盖率达标，否则不许写。

---

## 八、交付方式

- 分支 `claude/handoff-wo-63-schema-readability`，**不碰正线**。
- 每个 P 阶段可独立 push，便于审核方分段复验。
- 审核方复验：五包 gate + 新门 + **亲手翻一遍管理页看属性展示**（绿测试≠能用）。
