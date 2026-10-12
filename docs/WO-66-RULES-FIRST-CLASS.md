# WO-66-RULES-FIRST-CLASS · 规则一等可编辑引用（闭 §8 G-10）

> **验收判据（用户定义）**：业务规则变了 3 次后，Rule **自动跟上了吗**？
>
> **当前答案是 No**，但病灶不在"规则没法编辑"——`RuleEntry` 早就是一等实体、还带 `params` 命名阈值。真病灶有两条，都在**引用侧**：谁引用规则、规则的阈值被谁读，这两件事**都是编译期硬编码**。

---

## 一、现状取证（**已核实**，dev 需自行复核）

### 事实 1 · 规则本体已经是一等实体，且已支持命名阈值

`packages/contracts/src/datacore.ts:101-115` `RuleEntrySchema`：

```ts
{ id, key /* 如 C03 */, name, expression, scopeObjectTypes, severity,
  params?: Record<string, number|string|string[]>,   // 命名阈值
  category?: string }
```

`params` 的原注释**自己写着**：

> 命名阈值（求解器读 rule.params 而非硬编码）。改 param 即改推演（**P2 求解器接入后**，全 7 入口随之变）。

→ **"P2 求解器接入"这件事没做**。字段在，没人读。

### 事实 2 · 求解器 ↔ 规则的绑定是**编译期常量**

`packages/contracts/src/datacore.ts:127` —— `SOLVER_RULE_REFS` 是一个硬编码 `Record<string, string[]>`：

```ts
export const SOLVER_RULE_REFS: Record<string, string[]> = {
  capacity_forecast: ["C01", "C02", "C03", "C09"],
  affected_orders: ["C05"],
  risk_timeline: ["C06", "C11"],
  ...
};
```

消费点：`apps/datacore/src/solvers/service.ts:4027` `const refs = SOLVER_RULE_REFS[solverKey] ?? [];`

→ 想让 `capacity_forecast` 多校验一条 `C31`，**必须改代码、重新发版**。这就是 §8 `G-10`「规则被引用、被写死，但非一等可编辑引用」的本体。

### 事实 3 · 阈值仍散在求解器代码里

求解器内部的业务阈值（如产能上限比例、齐套天数）目前直接写在算法里，而不是读 `rule.params`。**dev 第一步就要把这些位置全部找出来并列成台账**（见 P0）。

---

## 二、《本体引用与影响》

- **对象类型**（§2）：`RuleEntry`（规则）· `SolverDef`（求解器）· `OntologyType`（规则作用域）
- **链路**（§3）：`规则库 → SOLVER_RULE_REFS → 求解器评估 → EvaluatedRule[] → 答案的规则闸`
- **不变量**（§5）：**R14 应用层无业务常数**（本单是它的主战场——阈值必须来自规则不是代码）· **R6 确定性**（同规则版本同输入同输出）· **R13 结论可溯源**（答案要能说出"依据哪条规则的哪个版本的哪个阈值"）· **R-一致**
- **门禁**（§7）：既有 `rule-closure:check`（⋃ 引用 ⊆ 已发布规则定义）· `debattery:check`（无内联业务常数）
- **断点**（§8）：**本单目标 = 闭 `G-10`**。交付时必须回写 §8 该行状态与 §3 链路。

---

## 三、🚦 范围边界

**允许改**：
- `packages/contracts/src/datacore.ts`（`RuleEntrySchema` additive；`SOLVER_RULE_REFS` 的**降级路径**见下）
- `apps/datacore/src/rules.ts`、`ruledsl.ts`、`apps/datacore/src/solvers/**`（阈值改读 `rule.params`）
- `apps/datacore/src/synthetic/battery.ts`（规则种子补 `params` 与绑定）
- `apps/datacore/src/repo/**` + `migrations/*.sql`（若绑定需落库，**四方同步**：`repo.ts` 接口 + `pg.ts` + `memory.ts` + 迁移 SQL，缺一即返工）
- `scripts/check-rule-closure.mjs`（若存在）或新增门
- 相应测试

**禁止**：`apps/agentcore/**`、`apps/frontend-shell/**`（规则编辑 UI 另开单）。

---

## 四、分阶段实施

### P0 · 阈值台账（**先普查，禁止边查边改**）

产出 `docs/rule-threshold-ledger.md`，穷举列出：

| 求解器 | 阈值出现位置 `file:line` | 当前值 | 业务含义 | 应归属哪条规则 | 规则里的 param 名 | 现在能否改（不改代码） |
|---|---|---|---|---|---|---|

**普查手法**：在 `apps/datacore/src/solvers/**` 找数值字面量与比较运算，逐个判断"这是算法常数（如 `1/7` 换算）还是业务阈值（如产能上限 0.85）"。
- **算法常数**（单位换算、数学常数、数组下标）→ 标注"非业务常数，不迁移"并说明理由。
- **业务阈值** → 必须迁移到规则 `params`。

> 台账**必须先交审核方过目再进 P1**。不允许"边查边改"——本仓的经验是那样会漏掉一半且没人知道漏了。

### P1 · 求解器读 `rule.params`（把 `params` 从死字段变活）

1. 在求解器上下文里提供 `ruleParam(ruleKey, paramName, fallback)` **单一读取入口**（不许各求解器各自 `rules.find(...)`——那是新一轮"多套实现各自维护"）。
2. 台账里的每个业务阈值改为 `ruleParam("C03", "capacityCeilingPct", <原值>)`。
3. **fallback 语义必须诚实**：规则里没有该 param 时用原值兜底，但**必须在输出里标注"该阈值来自代码兜底，非规则定义"**（不许静默兜底——静默降级是本仓反复吃亏的病灶族）。
4. `R6` 保持：同规则版本 + 同输入 → 字节级同输出。**迁移后既有回归锚不得变**（若变了，说明迁移改变了语义，必须查清楚而不是改锚）。

### P2 · 绑定一等化（`SOLVER_RULE_REFS` 从常量变数据）

**目标**：改"哪条规则管哪个求解器"不需要改代码。

设计要点（dev 自行定形状，但必须满足下列约束）：

1. **绑定成为可编辑数据**：可以是 `RuleEntry` 上加 `appliesToSolvers: string[]`（规则声明自己管谁），也可以是独立的绑定表。**二选一，理由写进报告**。
   - 推荐前者：规则是业务方维护的对象，让业务方在规则上声明它管哪些推演，比维护一张独立映射表更符合心智。
2. **`SOLVER_RULE_REFS` 保留为出厂缺省 + 兼容层**，**不删**（删了会断现有闭包门）。运行时优先读数据，数据为空回落常量，并在输出标注来源。
3. **闭包门必须跟着升级**：现有 `rule-closure:check` 校验的是"⋃ 引用 ⊆ 已发布规则"。P2 后要**同时**校验数据侧绑定的闭包，否则业务方绑一个不存在的规则键，门不会红。
4. **仓储四方同步**（若落库）：`repo.ts` 接口 + `repo/pg.ts` + `repo/memory.ts` + `migrations/*.sql`。**只改 memory 不改 pg = 测试全绿生产炸**，这是本仓明令的返工项。

---

## 五、SEAM 红咬（**效果层**，每条可变异反证）

| # | 断言 | 变异（必须变红） |
|---|---|---|
| **S1**（头号） | **改规则 `params` 的一个阈值 → 求解器输出真的跟着变**（不改一行代码） | 把求解器改回读硬编码常量 → S1 红 |
| S2 | 规则里没有该 param 时，输出标注"来自代码兜底" | 把兜底标注去掉（静默兜底）→ S2 红 |
| S3 | **改规则的求解器绑定 → 该求解器评估的规则集真的变**（不改代码） | 把绑定读取改回只读 `SOLVER_RULE_REFS` → S3 红 |
| S4 | 绑定到不存在的规则键 → 闭包门红 | 把门的数据侧校验删掉 → S4 红 |
| S5 | R6：同规则版本同输入两跑字节一致 | 引入 `Date.now()`/随机 → S5 红 |
| S6 | R13：答案能说出"依据规则 C03@v2 的 capacityCeilingPct=0.85" | 去掉版本或 param 名 → S6 红 |
| S7 | 迁移不改变既有语义：P0 台账里每个阈值迁移后，**既有回归锚逐字节不变** | 迁移时改了某阈值的语义 → 既有测试红 |

> **S1 与 S3 是本单的头号判据**。二者任一不通 → 退单，无论其它多绿。「规则变了 Rule 自动跟上」这句话，只有这两条能证明。

---

## 六、验收清单

- [ ] P0 台账已交审核方过目，且区分了"算法常数"与"业务阈值"并各有理由
- [ ] 台账中所有业务阈值已迁移到规则 `params`，`debattery:check` 通过
- [ ] S1–S7 各有**变异反证的两次实际输出**
- [ ] 仓储四方同步（若落库）：接口 / pg / memory / 迁移 SQL 齐
- [ ] 闭包门覆盖**数据侧绑定**，不只是常量表
- [ ] `npx tsc -p apps/datacore/tsconfig.json --noEmit` 真退出码 0
- [ ] 本体 §8 `G-10` 行状态回写；§3 链路更新
- [ ] **诚实边界**：哪些阈值没能迁移、为什么（例如与算法耦合无法拆）

---

## 七、反假绿纪律

1. **退出码显式捕获**：`out="$(cmd 2>&1)"; rc=$?`。禁止 `cmd | tail; echo $?`。
2. **vitest 不做类型检查**，必须另跑 `tsc --noEmit` 看真退出码。
3. **变异反证**：每条断言改坏→红、还原→绿，两次输出都贴。
4. **禁止静默兜底**：规则缺失时兜底可以，但**必须在输出里标注**，否则就是把"没配规则"伪装成"配了规则"。
5. **禁止另起一套读取入口**：`ruleParam` 只此一处。本会话已抓到三次"同一概念多套实现各自维护"，其中一次导致判定分支永远不触发而测试全绿。
6. **"规则可编辑了"这句话**，除非 S1 与 S3 都有变异反证输出，否则不许写。

---

## 八、交付方式

- 分支 `claude/handoff-wo-66-rules-first-class`，**不碰正线**。
- P0 台账先单独 push 待审，过了再进 P1/P2。
- 审核方复验：五包 gate + 闭包门 + **亲手改一个规则阈值看推演结果变不变**（绿测试≠能用）。
