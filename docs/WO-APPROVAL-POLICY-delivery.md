# WO-APPROVAL-POLICY 交付说明 · 批复策略引擎

> **一句话**：批复链不再是写死的 Workflow，而是 `ApprovalPolicy.condition`（业务规则，复用 A5 规则 DSL）
> × `ApprovalAuthority`（组织权限）在求值时**动态生成**；批复流程与业务流程正交，业务流程定义零改动。
>
> 分支 `claude/handoff-wo-approval-policy` · 自 canonical `origin/claude/inspiring-gates-aqczjg` 开出。

---

## ① 盘点：今天到底有什么（含金丝雀）

**先自证工具**（铁律 0.6：报否定结论前必须跑金丝雀，不中就报「工具坏了」而不是「代码干净」）：

```
$ grep -rn "ruledsl" apps/datacore/src --include=*.ts | head
apps/datacore/src/authz.ts:4:      import { evaluateExpression, parseExpression } from "./ruledsl.js";
apps/datacore/src/rules.ts:6:      import { DslError, collectParamRefs, evaluateExpression, parseExpression } from "./ruledsl.js";
apps/datacore/src/scheduler.ts:9:  import { evaluateAst, parseExpression, sustainField, ... } from "./ruledsl.js";
… 共 10 处真实消费方（金丝雀命中 ⇒ grep 工具正常）

$ grep -rn "approvalChain" packages/contracts/src apps/datacore/src | wc -l
16   （金丝雀命中）
```

### 1.1 规则 DSL：在哪、怎么表达、能不能引用 params

| 项 | 实测 |
|---|---|
| 位置 | `apps/datacore/src/ruledsl.ts`（560 行），10 个 src 消费方（authz / rules / solvers / scheduler / planviews / synthetic / ontology-validate / chain-impediment / impediment-options） |
| 入口 | `parseExpression(src) → AstNode`、`evaluateExpression(src, ctx) → boolean`、`evaluateAst`、`collectFieldPaths`、`collectParamRefs` |
| 上下文 | `EvalContext = { payload, params?, user?, sustain? }` |
| **`params.<名>` 一等操作数** | ✅ **已支持**（`ruledsl.ts:39` `Operand kind:"param"`）。取不到**抛错**（`ruledsl.ts:492-500`「诚实缺席，不兜底」），刻意不回落 payload —— 否则阈值解不出会静默变 `undefined` ⇒ 比较恒 false ⇒ 哑弹规则 |
| 闭包校验 | `rules.ts:19 assertValidExpression(expression, declaredParams)` —— 语法（带字符位）+「表达式引用的阈值 ⊆ 声明的阈值」 |

⇒ **本引擎直接复用这三件**，一个字的表达式语言都没另造（红线 2）。`assertValidExpression` 是**同一份实现**被 import，不是抄一份。

### 1.2 现有的 Action 审批链是什么形态

`apps/datacore/src/actions.ts`（S2）：

- 链条来源 `actions.ts:562`：`const chain = type?.approvalChain ?? [{ role: "admin" }]` —— **静态注册在 ActionType 上**，`registerType` 限制 1–3 步（`actions.ts:460`），契约 `contracts/src/actions.ts:145` `z.array(z.object({role})).min(1).max(3)`。
- 种子里 10 条 ActionType 全是写死的 `[{role:"admin"}]` / `[{role:"planner"},{role:"admin"}]`（`synthetic/battery.ts:2711-2811`）。
- 状态机 `DRAFT → PENDING_APPROVAL → APPROVED → EXECUTING → EXECUTED`，含自审守卫（`selfApproveAllowedFor`）、`notifyRole`、`action.*` 事件。

⇒ **这正是工单要否定的形态**：链条与「谁触发」绑定，与「当时的业务事实」无关。产能缺口 8% 与 12% 走同一条链。
⇒ 本单**没有改动 S2 的既有行为**（不动 R4 真值写入路径）；两者并存，收敛口径列在 §7 交给审核方裁决。

### 1.3 角色体系今天有什么

| 层 | 实测 |
|---|---|
| JWT claim | `roles`（`tid`/`sub`/`roles`） |
| 开发链路 | `X-Debug-User: tenantId:userId:role1\|role2`（角色可含 CJK 与限定后缀） |
| 限定角色 | `base_manager:常州` —— 基名比对散在三处同口径实现：`authz.ts:19 roleMatches`、`actions.ts:356 baseRole`、`notifications.ts:6 baseRole` |
| demo 租户实有账号 | `seed.ts:21-33` —— `admin`[admin,planner,catalog_admin,tenant_admin] / `planner`[planner] / `base_manager`[base_manager:常州] / `approver`[approver,admin] |

### 1.4 组织权限（Person / Role / Authority / ApprovalLimit）—— **实测后端 0**

```
$ grep -rn "ApprovalLimit\|approvalLimit\|ApprovalAuthority\|approvalAuthority\|OrgUnit\|orgUnit" \
    packages/contracts/src apps/datacore/src apps/agentcore/src
（0 命中）
```

**这是「不存在」而不是「我没找到」**：同一条命令在同一次执行里对 `approvalChain` 命中 16 条（§1 开头的金丝雀）。工具正常，结论成立。

### 1.5 顺带查实的一条关键前情（决定了本单的做法）

`packages/contracts/src/process.ts` §1 的原文写着：`PROCESS_WAIT_KINDS` **刻意只有四种**、没有 `WAITING_APPROVAL`，理由是

> 「流程级审批既无承载物、也无状态机、也无消费方 …… 真要做审批，**先有承载物再回来加这一项**」

⇒ 本单建的正是那个承载物。但**没有**顺手去流程层补第五个 waitKind —— 补了就是把审批焊回业务流程定义（详见 §2）。

---

## ② 正交性怎么保证的（本单的灵魂）

不是靠"我记得要分开"，而是靠**四道各自独立的机制**，任一道被拆掉都有测试当场红：

| # | 机制 | 落点 | 拆掉它会红在哪 |
|---|---|---|---|
| 1 | **形状即纪律**：`ApprovalRequest` 只有 `{subjectKind, subjectKey, facts}`，**没有 chain/approvers/policyKeys 字段** —— 业务侧想指定批复链也没处填 | `contracts/approval-policy.ts` §3（`z.strictObject`） | `§2 形状即纪律`（塞 `chain` → 400，不是"被忽略"） |
| 2 | **存储层无外键**：三张新表没有一个字段指向业务流程（无 `process_key`）；`process_definitions`（029）一个字段都没改 | `migrations/030_approval_policy.sql` | — |
| 3 | **物理隔离**：引擎源码**不 import 任何业务流程层符号**，正文也不出现 `processDefinitions` | `apps/datacore/src/approval-policy.ts` | `§7 红线1 的物理形式`（剥注释后扫源码） |
| 4 | **效果层双向断言**：只改 policy → 链变；只改 ProcessDefinition → 链**逐字节不变** | `test/approval-policy.test.ts` §2 | `§2` 两条 |

**关于第 4 条要说一句诚实的话**（§5 的变异反证抖出来的）：
「只改业务流程 → 链不变」这**一条**断言，在退化实现（恒返回固定链）下**仍然是绿的** ——
因为一条写死的链当然不随业务流程变。所以它单独**不能**证明正交性，
必须与「只改 policy → 链变」**成对**才钉得住。两条各管一半：前者管"没有多余耦合"，后者管"确实在动态求值"。
把这一对拆开只留一条，正交性就只剩一半证据 —— 这条写在这里，是防止下一个人"精简测试"时误删。

---

## ③ 多 policy 同时命中的合并口径

**`UNION_BY_LEVEL` = 并集 + 去重 + 按 `(level, minPriority, 首现序)` 三段升序。**（契约 §5 有完整论证，此处摘要）

- **为什么是并集，不是"取最严的那一条"**：两条策略各自代表一个**独立的把关诉求**（产能缺口要计划+制造把关；毛利过低要财务+销售把关）。取其一丢其一 ⇒ 被丢那条的诉求**无人把关**，而界面上审批还照走 —— 「看着在跑其实没在管」。
- **"最严"没有丢，它是并集的效果**：合并后终审人 = 命中策略中层级最高者。任一条策略要求上到经营负责人，合并链就一定上到经营负责人。这比"取最严"更严。
- **去重的判据是权限位**（不是人、不是角色）：两条策略都要 `gm` ⇒ `gm` 只出现一次，但 `viaPolicyKeys` 记两条 —— 谁要求的这一级不因去重而丢失。
- **三段排序键都是必需的**：`level` 定逐级上报；同 level 用贡献策略的最小 `priority`；再同用**首现序**。第三段是确定性兜底（R6）——没有它，同 level 同 priority 的两个权限位次序会随存储迭代序漂，重跑就不字节一致。
- **声明序与层级序冲突时**：以 `level` 为准（逐级上报是组织事实），但 `trace[].reordered = true` **显式报出来** —— 静默改写作者写下的顺序比报错危险，因为没人会来查。

实测（两条都命中，`capacity_gap=0.12` ∧ `gross_margin=0.072`）：

```
capacity-gap : [planning_director(20), manufacturing_director(25), gm(40)]  priority 10
thin-margin  : [finance_director(20),  sales_director(25),         gm(40)]  priority 20
──────────────────────────────────────────────────────────────────────────
合并 → planning_director → finance_director → manufacturing_director → sales_director → gm
       (20,p10)           (20,p20)           (25,p10)                  (25,p20)         (40, via 两条)
```

---

## ④ 四条效果层判据的实测输出原文

`npx vitest run apps/datacore/test/approval-policy.test.ts` → **28 passed (28)**

```
 ✓ §0 金丝雀：先证明这套夹具真的在动 > 已知必中：策略注册后 /resolve 至少能报出两条策略的痕迹  1791ms
 ✓ §1 判据①：… > 产能缺口 8% → 无需批复；12% → 计划总监→制造总监→经营负责人  1209ms
 ✓ §1 判据①：… > 同一事件换另一个数（毛利 7.2%）→ 换成**另一条链**（销售/财务口，不是产能口）  1312ms
 ✓ §2 判据②：批复流程 ⟂ 业务流程 > 不改任何业务流程定义，只改 policy 的一个阈值 → 批复链变  1077ms
 ✓ §2 判据②：批复流程 ⟂ 业务流程 > 反向：只改业务流程定义（名字/职能/工期）→ 批复链**逐字节不变**  1305ms
 ✓ §2 判据②：批复流程 ⟂ 业务流程 > 形状即纪律：业务侧无从指定批复链（ApprovalRequest 里塞 chain 会被 strictObject 拒）  1219ms
 ✓ §3 判据③：变异反证 > 真引擎：动态判据全部通过  933ms
 ✓ §3 判据③：变异反证 > 退化实现（恒返回写死的链）：同一组判据必须抛 —— 还绿就说明测的不是这件事  6ms
 ✓ §3 判据③：变异反证 > 退化实现之二（只看主体不看事实·「按业务节点写死」的经典形态）：同样必须抛  1ms
 ✓ §3 判据③：变异反证 > 正交性判据同样受变异反证保护：链随业务流程变的实现必须抛  825ms
 ✓ §4 判据④：… > 权限位未登记 → AUTHORITY_UNDEFINED，链不静默补齐、不兜底给 gm  857ms
 ✓ §4 判据④：… > 权限位登记了但**没人**持有那个角色 → NO_ELIGIBLE_APPROVER（与上一种分开报，修法不同）  798ms
 ✓ §4 判据④：… > 降级态**拒绝开批复实例**（409）—— 缺把关人的链跑起来就是拿它冒充完整的链  866ms
 ✓ §4 判据④：… > 策略表达式求值出错 ≠ 未命中：显式报 error 且计入 degraded（不 fail-open 成「通过」）  882ms
 ✓ §4 判据④：… > 发布期就挡住哑弹策略：condition 引用未声明阈值 → 400（不是运行期才炸）  983ms
 ✓ §5 UNION_BY_LEVEL > 两条都命中：并集去重，按 level 逐级上报，gm 只出现一次且溯源记两条  864ms
 ✓ §5 UNION_BY_LEVEL > 合并结果是确定的：同输入连跑三次逐字节一致（R6，不靠 Map 迭代序）  924ms
 ✓ §5 UNION_BY_LEVEL > 声明序与组织层级序冲突 → 以 level 为准，但 trace 标 reordered（不静默改写）  1033ms
 ✓ §5 UNION_BY_LEVEL > DRAFT 策略不参与求值；subjectKinds 不匹配也不参与（两种 skip 分开报）  1027ms
 ✓ §6 实例状态机 > 开单 → planner 签第一步 → admin 签后两步 → APPROVED，事实快照留档  1085ms
 ✓ §6 实例状态机 > 任一环节 REJECT → 实例 REJECTED，后续环节不再可签  995ms
 ✓ §6 实例状态机 > 零命中不开空实例（400），跨租户读一律 404（R2）  1051ms
 ✓ §7 结构守门 > 暗发门：默认关 → 全部端点 404 FEATURE_NOT_FOUND（R3 先于 authz）  1164ms
 ✓ §7 结构守门 > 暗发门 defaultOn:false，且不随 battery「all on」模板顺带开  1366ms
 ✓ §7 结构守门 > 红线 1 的物理形式：引擎源码不 import 任何业务流程层符号
 ✓ §7 结构守门 > 组织权限最小面：functionKey 锚到既有 15 条职能登记册（防第二套组织词表）
 ✓ §7 结构守门 > R9 三处同改：migration 的表名与 pg.ts 的字面量逐字一致（memory 单测证明不了这一行）
 ✓ §7 结构守门 > 业务流程契约零改动：PROCESS_WAIT_KINDS 仍是四种，没有 WAITING_APPROVAL

 Test Files  1 passed (1)
      Tests  28 passed (28)
```

**判据逐条对账**

| 工单判据 | 断言原文（指名道姓，不是"返回了一个数组"） |
|---|---|
| ① 改一个数 → 链真的变 | `capacity_gap 0.08` ⇒ `required=false, chain=[]`；`0.12` ⇒ `chain=["planning_director","manufacturing_director","gm"]`；`gross_margin 0.072` ⇒ `chain=["finance_director","sales_director","gm"]`，且 `not.toContain("planning_director")` |
| ② 正交性（正向） | 只 PUT policy 的 `params.gapThreshold` 0.10→0.05，`capacity_gap=0.09` 的链从 `[]` 变成 3 人链 |
| ② 正交性（反向） | 改 `ProcessDefinition` P40 的 name/ownerFunctionKey/stdDurationDays/waitKind + 新增一条 P99 ⇒ `JSON.stringify(after) === JSON.stringify(before)`（逐字节，连 trace 都不变） |
| ③ 变异反证 | 见 §5 |
| ④ 诚实降级 | `missing=[{gm:AUTHORITY_UNDEFINED},{manufacturing_director:AUTHORITY_UNDEFINED}]`，`chain=["planning_director"]`（**没有**被静默补全，也**没有**兜底给 gm），`degraded=true`，开单 409 |

---

## ⑤ 变异反证：红 / 绿

做了**两层**，两层都在仓库里可复现：

### 5.1 测试内机器化的变异（永久生效，不需要人记得）

`test/approval-policy.test.ts` §3 把①的判据抽成只依赖 resolver 的断言体 `assertChainIsDynamic()`，再拿两个退化 resolver 各跑一遍，**断言它们必须抛**：

- 退化一「恒返回写死的链」（= 把批复链做成写死的 Workflow）→ ✅ 抛，且咬住是 `toEqual` 那条红的（不是"抛了就算过"）。
- 退化二「一律上 gm」（= 兜底给 gm 那种做法）→ ✅ 抛。
- 退化三「链随 `ProcessDefinition.ownerFunctionKey` 变」（= 把链焊进业务流程）→ ✅ 正交性判据当场红。

> 为什么要这么写：铁律 0.6 的原文——「机制的判据：下次同样的错发生时，**是机器先说话**，不是人先想起来」。
> 只在报告里写「我手动改坏跑了一次看到红」不是机制。

### 5.2 真源码变异（本次亲手做，已还原）

把 `apps/datacore/src/approval-policy.ts` 的 `resolveChain` 开头插入「恒返回 `[planning_director, manufacturing_director, gm]`」的 early return，重跑判据类测试：

```
   × §1 判据①… > 产能缺口 8% → 无需批复；12% → …
       AssertionError: expected true to be false // Object.is equality
   × §1 判据①… > 同一事件换另一个数（毛利 7.2%）→ 换成**另一条链**…
       AssertionError: expected [ 'planning_director', …(2) ] to deeply equal [ 'finance_director', …(2) ]
   × §2 判据②… > 不改任何业务流程定义，只改 policy 的一个阈值 → 批复链变
       AssertionError: expected [ 'planning_director', …(2) ] to deeply equal []
   × §3 判据③… > 真引擎：动态判据全部通过
       AssertionError: expected [ 'planning_director', …(2) ] to not deeply equal [ 'planning_director', …(2) ]
   × §4 判据④… > 权限位未登记 → AUTHORITY_UNDEFINED…      expected false to be true
   × §4 判据④… > 权限位登记了但没人持有那个角色…            expected false to be true
   × §4 判据④… > 降级态拒绝开批复实例（409）…               expected 201 to be 409
   × §4 判据④… > 策略表达式求值出错 ≠ 未命中…               expected undefined to be false
      Tests  8 failed | 6 passed | 14 skipped (28)

   ✓ §2 判据②… > 反向：只改业务流程定义 → 批复链**逐字节不变**   ← 仍然绿（见 §2 那段诚实说明）
```

还原后复跑：`Test Files 1 passed (1) / Tests 28 passed (28)`，`git status --porcelain` 为空（变异无残留）。

### 5.3 顺带记两个**本次真被骗到**的坑（照铁律 0.6 记账）

| # | 形态（「我用 X 当作 Y 的证据，而 X 并不度量 Y」） | 实况 | 处置 |
|---|---|---|---|
| 1 | 「源码文本里出现 `processDefinitions`」当作「引擎耦合了业务流程层」 | 第一版守门测试**当场红**，红在引擎文件头那句**说明**「本文件不 import `processDefinitions`」上 —— 「提及 ≠ 读取」的原样复现 | 改成**先剥注释再查** + 剥完加金丝雀（剥空了要报"剥离器坏了"，不许读成"干净"） |
| 2 | 「vitest 报 FAIL」当作「我的改动打破了既有测试」 | `dark-feature-default-off` / `memory-mode-views` / `process-layer` 共 8 条红 —— 全是 `Test timed out in 5000ms`，`load average 15.15`（4 核机 5 个 dev 并行）。加 `--testTimeout` 后 **25/25 全绿** | 报「环境超时」而不是「回归」；判据是**错误类型**（timeout vs AssertionError），不是红绿本身 |

---

## ⑥ 组织权限：做了什么，还缺什么

### 6.1 本单做的最小面（只建引擎必需的一层）

`ApprovalAuthority` = **权限位**（组织里"有权签这一级"的那个位置）：

```ts
{ key: "planning_director", displayName: "计划总监",
  functionKey: "production_planning",   // 🔴 锚到既有 PROCESS_OWNER_FUNCTIONS（15 条职能登记册）
  roleKey: "planner",                    // 解析具体批复人时用的平台角色（users.roles）
  level: 20 }                            // 组织层级：合并口径的骨架，不是装饰排序键
```

两个刻意的设计：

- **权限位 ≠ 平台角色**。`roleKey` 回答"谁能操作"（鉴权，粒度粗）；`key` 回答"这一级由哪个岗位把关"（组织，随企业层级走）。同一个 `roleKey` 可承载多个层级的权限位（计划经理与计划总监都是 `planner`，但不是同一级，签字先后不同）。混用会把组织结构焊死在鉴权词表上。
- **`functionKey` 必须锚到 `PROCESS_OWNER_FUNCTION_KEYS`**（`contracts/src/process.ts` §2 的 15 条）。不锚就是**第二套组织词表** —— 与 `process.ts` §3 极力避免的那次事故（「两个 dev 各发明一套词表、交集为 0」）同形态，只是升了一层。由 §7 测试守。

### 6.2 还缺什么 —— **需另立单**（本单刻意不做，不是漏做）

| 缺口 | 为什么本单不做 | 影响面 |
|---|---|---|
| **`Person` / 任职关系（人 ↔ 权限位）** | 今天靠 `roleKey` → `users.roles` 反查候选人，**只能判"有没有人"，不能判"具体是谁该签"**。真做要引入任职表 + 生效期 + 代理/委托 | 现状：同角色多人时，谁都能签（先到先得）。审批留痕有 `approverId`，可追溯但不可指派 |
| **`ApprovalLimit`（金额/额度上限）** | 仓主的 YAML 里没有额度维度；凭空加会造出没有消费方的字段（本仓「建了没接线」的生产方式） | 需要"5 万以下总监批、以上上总经理"这类规则时必须补 |
| **`OrgUnit`（组织单元树）/ 基地维度** | 本引擎按 `level` 排序即可满足工单判据；组织树是**另一个问题**（跨基地/跨事业部的链路裁剪） | `base_manager:常州` 这类限定角色目前按**基名**匹配，未按基地裁剪 |
| **代理 / 会签 / 或签 / 超时自动升级** | 均属批复语义扩展，与"动态生成链条"这件事正交，塞进本单会淹没主线 | `ApprovalTask.status` 已留 `SKIPPED` 值位 |
| **与 S2 `ActionType.approvalChain` 的收敛** | 改 S2 会动到 R4 真值写入路径，风险与本单不成比例 | 见 §7 |
| **前端** | 工单明写另立单（🚦范围边界） | `/a/v1/approval-*` 已可用，暗发门默认关 |

### 6.3 种子

**没有播任何 demo 批复策略/权限位**。理由：暗发门默认关，播了也不可见；且策略内容是**租户组织数据**（R14 行业无关），属产品决策。测试用例自带夹具。

---

## ⑦ 需审核方回写 `docs/SYSTEM-ONTOLOGY.md` 的清单

（本单按范围边界**未改**本体文件；以下为需回写内容）

### 7.1 新增对象类型（3）

| 对象类型 | 载体 | 说明 |
|---|---|---|
| `ApprovalPolicy` | `approval_policies` 表 · `contracts/src/approval-policy.ts` §2 | 业务规则 → 权限位序列。`condition` 是规则 DSL 表达式（与 `Rule.expression` 同一套语言、同一个求值器） |
| `ApprovalAuthority` | `approval_authorities` 表 · §1 | 组织权限最小面（权限位）。`functionKey` 指向 `PROCESS_OWNER_FUNCTIONS` |
| `ApprovalInstance`（含内嵌 `ApprovalTask`） | `approval_instances` 表 · §6 | 批复实例 + 状态机；存事实快照作为永久解释坐标 |

### 7.2 新增链路（1 条，需在本体 §3 建条目）

```
业务节点发出 ApprovalRequest{subjectKind, subjectKey, facts}
  → ApprovalPolicyService.resolveChain
      → 逐条 PUBLISHED ApprovalPolicy 求值 condition（ruledsl.evaluateExpression + params）
      → 命中集 approval 序列 UNION_BY_LEVEL 合并
      → 落 ApprovalAuthority 登记（缺 → missing/degraded，不兜底）
  → ApprovalChainResolution
  → createInstance → ApprovalInstance(PENDING) → decide×N → APPROVED / REJECTED
```

⚠ 链路的**入口是事实不是流程**：`ProcessDefinition` 不在这条链路上，且**不应**被画成上游节点。

### 7.3 新增事件（4，需进事件表）

`approval.instance_created` · `approval.step_advanced` · `approval.instance_approved` · `approval.instance_rejected`
（均经 C-2 outbox，payload 含 `instanceId`；`instance_created` 另含 `matchedPolicyKeys` 与 `chain`）

### 7.4 新增不变量（建议编号，供审核方定号）

| 建议 | 内容 | 机器化落点 |
|---|---|---|
| **R-A1 · 批复正交** | 批复链不得由业务流程定义决定；`ProcessDefinition` 不得出现审批字段，引擎不得依赖流程层符号 | `test/approval-policy.test.ts` §2 两条（成对）+ §7「红线1 的物理形式」 |
| **R-A2 · 单一表达式语言** | 批复条件必须复用规则 DSL 求值器，禁止第二套表达式语言 | 引擎 import `./ruledsl.js` + `assertValidExpression`；§4「发布期挡哑弹策略」 |
| **R-A3 · 诚实降级** | 组织权限缺失必须逐条报出（缺谁/为何/哪条策略要的），禁止静默空链与兜底人；降级链禁止开实例 | §4 四条 |
| **R-A4 · 合并确定性** | 多策略命中的合并结果必须全序确定（level, priority, 首现序），同输入字节级一致 | §5「连跑三次逐字节一致」 |

### 7.5 需登记的断点 / 已知缺口（建议进 G-* 表）

| 建议编号 | 形态 | 说明 |
|---|---|---|
| `G-APPROVAL-TWO-ENGINES` | **两套审批并存** | S2 `ActionType.approvalChain`（静态 1–3 步，`actions.ts:562`）与本引擎（动态）**当前互不知情**：走 Action 的审批不经策略引擎，走策略引擎的批复不落 ActionDraft。今天没有消费方同时用两者，所以不是断链；但**这是一个真实的二真相源**，需产品裁决收敛方向（建议：ActionService.submit 的 chain 来源改为可选地委托本引擎，`approvalChain` 降为 fallback） |
| `G-APPROVAL-NO-BUSINESS-CALLER` | **接了线没数据 / 没有生产调用方** | 本单交付的是**引擎 + API**，`resolveChain` 今天**只有测试与 HTTP 端点**两个调用方，没有任何业务节点（产能分析 / S&OP / 决策内核）在真发 `ApprovalRequest`。按本仓判据这是「接了线没数据」而**不是**「已接线」——诚实标注，需下一单把业务节点接上 |
| `G-APPROVAL-NO-PERSON-MODEL` | **组织权限只到权限位** | 见 §6.2：无任职关系，同角色多人时"谁该签"未定 |

---

## ⑧ 改动清单与远端核对

| 文件 | 动作 |
|---|---|
| `packages/contracts/src/approval-policy.ts` | 新增（契约 + 全部设计判据） |
| `packages/contracts/src/index.ts` | +1 行 re-export |
| `apps/datacore/src/approval-policy.ts` | 新增（引擎） |
| `apps/datacore/migrations/030_approval_policy.sql` | 新增（3 表） |
| `apps/datacore/src/repo/repo.ts` · `repo/memory.ts` · `repo/pg.ts` | R9 三处同改 |
| `apps/datacore/src/app.ts` | import + 服务构造 + `services.approvalPolicy` + 10 条路由 |
| `apps/datacore/src/features.ts` | `approval.policy-engine`（`defaultOn:false`）+ `GOVERNANCE_DARK_LAUNCH_FEATURES` + 模板过滤 |
| `apps/datacore/test/approval-policy.test.ts` | 新增（28 条） |
| `docs/WO-APPROVAL-POLICY-delivery.md` | 本文 |

**未碰**（范围边界）：`apps/agentcore/**` · `apps/frontend-shell/**` · `docs/SYSTEM-ONTOLOGY.md` · `scripts/**` · `CHAIN_NODE_REGISTRY` 的 24 个 id · `contracts/src/process.ts`（含 `PROCESS_WAIT_KINDS` 四值）。

**门与验证**（按工单纪律，未跑 `scripts/gate.sh`、未跑全量套件）：

- `pnpm --filter @platform/contracts build` → RC 0
- `pnpm --filter datacore typecheck` → 无输出（通过）
- `pnpm --filter datacore build` → 通过
- `npx eslint`（三个新文件）→ 无输出
- `npx vitest run apps/datacore/test/approval-policy.test.ts` → **28/28**
- 受影响的既有测试（features/流程层/视图）`dark-feature-default-off` + `memory-mode-views` + `process-layer` → **25/25**（须加 `--testTimeout`，原因见 §5.3 第 2 条）
