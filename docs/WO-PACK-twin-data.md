# WO 派发包 · 企业决策孪生「数据补齐」七单（D 层）

> 出单日期 2026-08-09 · 出单方：审核方 · 上游 PRD：`docs/PRD-enterprise-decision-twin.md`
> **本包七张单相互不阻塞、可同时开工。** 每单一个 dev、一条 handoff 分支、一套互不重叠的文件边界。

---

## 0. 派单前必读（七张单共用 · 全部是本仓踩过坑写下的纪律）

### 0.1 判分支对不对：**用祖先关系，不用文件存在性**

> 来历：2026-08-09 我用「某文件存在」当作「分支是新的」的证据，一天内误导 4 个 dev，其中两个在**落后 canonical 1310 个提交**的树上开工。文件在老支线上恰好也存在，探针恒真。

```bash
CANON=origin/claude/inspiring-gates-aqczjg
git fetch origin
git merge-base --is-ancestor HEAD $CANON \
  && { echo "HEAD 是 canonical 的祖先 ⇒ 落后，必须重开"; git checkout -B <本单分支名> $CANON; } \
  || echo "HEAD 不落后于 canonical，可原地开工"
```

### 0.2 环境前置（不做就会收到与本单无关的假红）

```bash
pnpm install --prefer-offline              # worktree 可能没有 node_modules
pnpm --filter @platform/contracts build    # 不 build 会报 "Failed to resolve entry for package @platform/contracts"
```

### 0.3 禁止事项（违反即退单）

- ❌ **禁止跑 `bash scripts/gate.sh`**、禁止跑 `pnpm -r test`。四包组合门由审核方统一跑（4 核机，datacore vitest 不许并发）。
  你只跑**你这单涉及的那一个包**的定向测试：`pnpm --filter datacore test -- <你的测试文件>`。
- ❌ **禁止碰 canonical 分支**，只推你自己的 `claude/handoff-<单号>`。
- ❌ **禁止越出下面「🚦范围边界」列出的文件**。要越界先回来问，不要自己拍板。
- ❌ **禁止用 `cmd | tail -n; echo "EXIT=$?"` 判成败** —— `$?` 取的是 `tail` 的退出码，恒 0。本仓曾据此把一个编译失败的 commit 判成「BUILD 通过」。正确写法：
  ```bash
  out=$(pnpm --filter datacore test -- <file> 2>&1); rc=$?; echo "RC=$rc"; echo "$out" | tail -40
  ```
- ❌ **禁止改功能开关默认值（`defaultOn`）** —— 那是产品决策，不是 dev 决策。

### 0.4 落盘纪律（这条是真丢过工作才写下的）

**每完成一个可命名单元就立刻 `git commit && git push -u origin <分支>`。**
沙箱会不定期重启，把没推的工作全部带走。推旁支零风险、零成本；「过没过门」和「有没有落盘」是两件事。

### 0.5 报结论的纪律：**grep 命中数不是结论**

- 报「不存在 / 零调用方 / 没有数据」这类**否定结论**前，先跑一个**你确定必中的金丝雀**证明工具是对的；金丝雀不中就报「工具坏了」，不许报「代码干净」。
- `git grep -- "apps/*/src"` **恒 0 命中**（pathspec 的 `*` 不跨 `/`）——改用 `grep -rn <符号> apps/ packages/ --include=*.ts`。
- 说某符号「没人用」之前，**再追一层**：re-export / barrel / 依赖注入 / 字符串键分发 / 事件订阅，grep 一次都看不见。

### 0.6 每单都是**一个完整纵切**，不是「只加数据」

每单从**契约/类型声明 → 数据物化 → 只读 API → 测试**一个 dev 从头做到尾（要建表的单再加 `迁移 + 仓储双实现`）。
**不许把「数据一半」和「表一半」拆给两个人** —— 本仓 metric-aware 反复炸就是这么炸的。
先读 §0.65 判断你这单**到底要不要建表**，别默认要建。

### 0.65 ⚠️ 存储惯例：**业务对象不建表**（这条搞错会造出一套平行存储）

实测前提：`apps/datacore/migrations/*.sql` 27 个文件里 **91 张表全是平台设施表**（`objects` / `links` / `ontology_types` / `users` / `permission_policies` …），**零张业务领域表**。业务对象一律：

```
在 battery.ts / battery-extended.ts 声明类型（def(...)）
        ↓
在 synthetic/service.ts 用 putAll("<TypeKey>", rows, "<idField>") 物化进通用 objects 表
        ↓
solvers / app.ts 用 listByType("<TypeKey>") 读
```

**判据**：
- **业务域对象**（客户/订单/物料/产线/人/部门…）→ **走 `ontology_types` + `putAll`，不建迁移表**。
- **平台运行态制品**（审批策略实例、流程实例、仿真会话、决策…）→ **建真表**（参照 `sim_session` / `decisions` 的做法）。

每张单下面都标了它属于哪一类。**标了「不建表」的单如果交上来带迁移文件，直接退。**

### 0.7 迁移号已预留，不许自选（防三方撞车，欠账 #74）

| 单号 | 要不要建表 | 预留迁移号 |
|---|---|---|
| D0 | ❌ **不建表**（纯物化既有生成器产物） | — |
| D1 | ❌ **不建表**（走 `ontology_types` + `putAll`） | — |
| D2 | ✅ 建表（平台治理制品） | **029** `apps/datacore/migrations/029_approval_policy.sql` |
| D3 | ❌ **不建表**（走 `ontology_types` + `putAll`） | — |
| D4 | ✅ 建表（平台运行态制品） | **031** `apps/datacore/migrations/031_process_definition.sql` |
| D5 | ✅ 建表（平台治理制品） | **032** `apps/datacore/migrations/032_exception_playbook.sql` |

> 028 / 030 **故意留空不用** —— 我原稿给 D1/D3 排了迁移号，实测后判定它们不该建表，号留白以免后续单误以为可复用。

新增表**必须同时改四处**（本仓硬约定）：`migrations/*.sql` + `repo/pg.ts` + `repo/memory.ts` + `repo.ts` 接口。漏一处 = 内存模式或 pg 模式其一必炸。

### 0.8 全单共用的不变量

- **R1 tenant_id everywhere**：所有新表、所有读写、所有事件都带 `tenantId`；跨租户一律 403/404。
- **R6 确定性**：种子必须可复现——同 `(industry, scale, seed)` 重跑**字节级一致**，seed 默认 42。禁止 `Math.random()`、禁止 `Date.now()` 进种子数据。
- **R14 行业无关 / 零业务常数**：阈值、限额、时长一律**进数据**，不许写进代码。锂电只是第一个模板。
- **错误信封**：`{ error: { code, message, requestId } }`。
- **no-secrets-echo**：任何响应不回显凭据明文。

---

## D0 · 七个「生成器已产行、却没人物化」的类型（本包最高性价比）

**分支**：`claude/handoff-twin-d0-materialize`
**一句话**：这 7 个对象类型**已注册、生成器已经把行都造出来了**，但 `synthetic/service.ts` 里**漏了 `putAll`**，于是对象库里恒为 0 条。修法是每个类型一行，收益是 7 个类型当场从「接了线没数据」变「已实装」。

### 实测证据（复核后再动手，别照抄）
- 类型声明与行生成：`apps/datacore/src/synthetic/battery.ts:4072-4086`（数组）+ `:4140`（真 push）
- 物化缺口：`apps/datacore/src/synthetic/service.ts` 中 `putAll("` 共 **83 处**（首行 `:707 putAll("Base", g.bases, "baseId")`），**这 7 个 typeKey 一个都不在其中**
- 已知下游在等它：`ProductionSchedule` 被 `apps/datacore/src/synthetic/cadence.ts:254` 在内存里消费，但对象库零实例

### 涉及的 7 个类型
`ProductionSchedule` · `ShiftPlan` · `WIPMove` · `WIPQualityCheckpoint` · `SparePartConsumption` · `OperatorAttendance` · `OperatorSkillCert`

### 🚦 范围边界（只碰这些）
```
apps/datacore/src/synthetic/service.ts                        (加 putAll，不改生成逻辑)
apps/datacore/src/__tests__/materialize-coverage.test.ts      (新建)
docs/handoff/twin-d0.md                                       (交付说明)
```
> ❌ **不建迁移**（见 §0.65）。❌ **不改 `battery.ts` 的生成逻辑** —— 行已经对了，缺的只是落库。

### 先决判断（这一步不许跳）
`service.ts` 里那句注释写着「**高量低值执行类保持模型态不物化**」。所以**这可能是有意为之，不是遗漏**。
你的第一件事是**判断哪几个是真该物化的**：
- 逐个数出行数（`scale=S`, `seed=42`），写进交付说明；
- 行数过大（比如 >5000）的，**不要物化**，在交付说明里写明理由和实测行数；
- 只物化你能论证「有下游消费方在等」的那几个。**宁可只物化 3 个并说清楚，也不要 7 个全塞进去**。

### 交付判据
1. 每个你物化了的类型，给出 `listByType("<TypeKey>")` 的**实测条数**（跑起服务真查，不是数数组长度）。
2. 每个你**没有**物化的类型，给出实测行数 + 不物化的理由。**诚实不做 > 硬做**。
3. 新增一条测试：对你物化的类型断言 `listByType` 非空——将来生成器坏了，这条会先叫。
4. 种子确定性：连播两次，条数与内容字节级一致（R6）。
5. `pnpm --filter datacore test -- materialize-coverage.test.ts` 全绿，`pnpm --filter datacore build` RC=0。
6. **性能回归自查**：物化后重跑一次 `SEED_DEMO=1` 启动，记录耗时前后对比。变慢超过 30% 就退回去只物化最必要的。

---

## D1 · 组织世界补齐（**扩既有 `Principal`，不许新造 `Person` 类型**）

**分支**：`claude/handoff-twin-d1-org-authority`
**一句话**：平台答不出「谁能批这单」「超限升给谁」「他休假谁代批」。但**组织的骨架已经有了**——`Principal` 一个类型带 `kind: "org"|"role"|"person"` 四合一，本单是**往里补**，不是另起炉灶。

### ⚠️ 实测前提（我原稿在这里错过一次，已改正）
- `Principal` 定义在 `packages/contracts/src/spine.ts:23`，`PRINCIPAL_KINDS` **已经声明了 `"person"`**。
- 但种子 7 条里 **0 条是 person**（`battery.ts:3991-4000`：1 条 `kind="role"` + 6 条 `kind="org"`）⇒ 形态是**「接了线没数据」，不是「未实现」**。
- `users` 表那 4 个账号（`seed.ts:20-33`）是**认证主体**，不是组织世界的人。两者要建立映射，但**不许合并**。
- 全仓 `Department` / `Authority` / `Workload` / `Availability` / `ApprovalLimit` / `Delegation` **各自 0 命中**（同条命令对 `Principal|WorkOrder` 命中 68 行，工具正常）。

**所以：新造一个 `Person` 类型 = 直接退单。** 本仓因「两处各抄一套词表」炸过整条节拍链（欠账 #99），不再犯第二次。

### 🚦 范围边界（只碰这些）
```
packages/contracts/src/organization.ts                  (新建 · 只放 AuthorityLimit/Delegation 契约)
packages/contracts/src/index.ts                         (只加 export 一行)
apps/datacore/src/synthetic/battery.ts                  (只在 Principal 种子区追加 person 行 + 新类型 def)
apps/datacore/src/synthetic/service.ts                  (加 putAll + 链路物化)
apps/datacore/src/organization.ts                       (新建 · 只读 service + 路由)
apps/datacore/src/app.ts                                (只加路由挂载)
apps/datacore/src/__tests__/organization.test.ts        (新建)
```
> ❌ **不建迁移**（见 §0.65）。❌ **不碰 `apps/datacore/src/authz.ts` 与 `permission_policies`** —— 那是鉴权，本单是审批权限，两回事，混了会炸鉴权。

### 要补的东西
| 做什么 | 怎么做 |
|---|---|
| `Principal(kind="person")` | 往既有种子里**追加**，≥12 人，覆盖 6 个职能 |
| 部门层级 | 用既有 `Principal(kind="org")` 的 6 条 + 补 `parentPrincipalId` 属性形成层级，**不新建 `Department` 类型** |
| `AuthorityLimit` | 新对象类型：`principalId` / `dimension`(order_amount/margin_rate/capex/cross_base) / `operator` / `threshold` / `unit` |
| `Delegation` | 新对象类型：`fromPrincipalId` / `toPrincipalId` / `validFrom` / `validTo` / `scope` |
| 人↔账号映射 | `Principal(person).userId` 指向 `users` 表；`admin`/`planner`/`base_manager:常州` 三个既有账号必须能映射上 |

### 种子要求（demo 租户）
- 6 个职能覆盖：销售 / 计划 / 财务 / 制造 / 供应链 / 经营管理层，每职能 ≥2 人含 1 名负责人。
- **至少 1 人 `available=false`**（否则「为什么卡住」这条链永远测不到）。
- `AuthorityLimit` ≥8 条，覆盖 ≥3 个 dimension，且**必须有一条会被 D2 的策略触发**。
- `Delegation` ≥2 条：1 条**当前生效**、1 条**已过期**（边界值）。

### 只读 API
```
GET  /a/v1/org/principals         ?kind= &functionKey= &available=
GET  /a/v1/org/authority-limits   ?principalId= &dimension=
GET  /a/v1/org/delegations        ?asOf=
POST /a/v1/org/resolve-approver   # {functionKey, dimension, value} → 审批人 + 是否升级 + 委托后的实际审批人
```

### 交付判据（缺一不可）
1. `resolve-approver` 传一个**超过某人限额**的值，必须**升级到上一级**，返回 `escalated:true` + 升级原因。
2. 委托生效期内，实际审批人必须是**受托人**且带 `delegatedFrom`；传**已过期**区间必须**回落到原审批人**。
3. **不许出现新的 `Person` 类型** —— 加一条测试断言 `listByType("Person")` 为空、`listByType("Principal")` 里 `kind="person"` 非空。这条是本单的防复发门。
4. 跨租户 403/404（R1 反证）；种子确定性字节级一致（R6）。
5. `pnpm --filter datacore test -- organization.test.ts` 全绿，`pnpm --filter datacore build` RC=0。

---

## D2 · 批复策略种子（条件 → 动态批复链）

**分支**：`claude/handoff-twin-d2-approval-policy`
**一句话**：批复链**不许写死**，必须由 `业务规则条件 + 组织权限` 算出来。同一个扰动，改一条规则阈值，链长就该变。

### 🚦 范围边界（只碰这些）
```
packages/contracts/src/approval-policy.ts                    (新建)
packages/contracts/src/index.ts                              (只加 export 一行)
apps/datacore/migrations/029_approval_policy.sql             (新建)
apps/datacore/src/repo.ts / repo/memory.ts / repo/pg.ts      (加接口与实现)
apps/datacore/src/approval-policy.ts                         (新建 · service + 路由)
apps/datacore/src/app.ts                                     (只加路由挂载)
apps/datacore/src/seed.ts                                    (加种子)
apps/datacore/src/__tests__/approval-policy.test.ts          (新建)
```

> ⚠️ **不许碰 `apps/datacore/src/organization.ts`**（那是 D1 的地盘）。本单如果需要组织数据，**通过接口调用**，不要直接读对方的表实现。两单可能同时在跑。

### 要建的对象
| 对象 | 关键字段 |
|---|---|
| `ApprovalPolicy` | `policyKey` / `name` / `conditionRuleKey`(**指向既有规则表的一条规则**) / `requiredFunctions[]` / `mode`(sequential/parallel) / `timeoutHours` / `escalateTo` / `priority` |
| `ApprovalInstance` | `instanceId` / `policyKey` / `subjectRef`(被批的东西) / `status` / `raisedAt` / `closedAt` |
| `ApprovalTask` | `taskId` / `instanceId` / `seq` / `functionKey` / `assigneePersonId` / `status` / `startedAt` / `endedAt` / `comment` |

### 关键约束（这条最容易做错）
- `conditionRuleKey` **必须指向既有规则表的一条真规则**（`apps/datacore/src/rules.ts` 那套 DSL），**不许在本单另造一套表达式语言**。本仓已经因此吃过亏（`G-C08-EXPR-PARAM-SPLIT`，欠账 #77）。
- **阈值一律从规则读回，引擎内零阈值**。代码里出现 `> 0.10` / `< 0.08` 这类业务数值字面量 = 退单（R14）。
- `ApprovalTask.status` 必须含 `WAITING_APPROVAL`（与 D4 的等待语义共用同一套枚举，见 D4 §枚举单源）。

### 种子要求（demo 租户）
至少 4 条策略，条件必须**互不相同且可被同一个扰动分别命中**：
1. 产能缺口 > 阈值 → 计划 + 制造 + 经营负责人
2. 毛利率 < 阈值 → 财务 + 销售 + 经营负责人
3. 跨基地调拨 → 供应链 + 制造 + 经营负责人
4. 订单金额 > 阈值 → 销售 + 财务（`mode=parallel`，用来验并行链）

### 只读 + 求解 API
```
GET  /a/v1/approval-policies
POST /a/v1/approval-policies/resolve     # {context:{capacityGap, marginRate, crossBase, orderAmount}} → 命中的策略[] + 实例化出来的批复链[]
```

### 交付判据（缺一不可）
1. **动态性反证（本单头号判据）**：只改规则表里那条阈值（**不改一行代码**），同一个 context 必须产生**不同长度**的批复链。链长不变 = 链是写死的 = 退单。
2. 一个 context 同时命中 2 条策略时，返回的链必须**按 priority 合并去重**，不许出现同一职能重复两次。
3. `mode=parallel` 的策略产出的 task 必须 `seq` 相同；`sequential` 的必须 `seq` 递增。
4. 零命中时返回**空链 + 明确的 `reason`**，不许静默返回一条兜底链（诚实空，不伪造）。
5. 跨租户 403/404；种子确定性字节级一致。
6. `pnpm --filter datacore test -- approval-policy.test.ts` 全绿，`pnpm --filter datacore build` RC=0。

---

## D3 · 产销链**尾段**补齐（**不是补主数据 —— 主数据已经有了**）

**分支**：`claude/handoff-twin-d3-chain-tail`
**一句话**：我原稿让你补 BOM/Routing/Supplier/Material —— **那是错的，它们已经全在，而且有数据**。真缺口在链路**尾段**：产能没有一等对象、交付没有验收段、排产结果不落库。

### ⚠️ 实测前提（照抄我原稿 = 造重复数据 = 退单）
已存在且**有数据**，**一律不许重建**：

| 你可能以为要建的 | 本仓已有的 | 实测条数 |
|---|---|---|
| Material | `Material`（`battery-extended.ts:55`） | **8** |
| Supplier | `Supplier`（`battery-extended.ts:61`） | **15** |
| BOM | `BOMHeader` + `BOMDetail`（`battery.ts:2225-2226`） | 已物化 |
| Routing | `Routing` + `Operation`（`battery.ts:2227-2228`） | 已物化 |
| MaterialReceipt | `IncomingInspection` + `CustomsClearance` + `InventoryTxn(RECEIPT)` | 已物化 |
| PurchaseOrder | `PurchaseOrder`（`battery-extended.ts:157`） | **30** |
| Product | **`Model`**（电池型号，不叫 Product） | 已物化 |
| Factory / ProductionLine | **`Base` / `Line`** | 13 / 130 |

**命名映射必须遵守**（本仓术语 ≠ PRD 术语）：`Factory→Base` · `ProductionLine→Line` · `Product→Model` · `SalesOrder→Order` · `ProductionOrder→WorkOrder` · `CustomerDemand→DemandSegment` · `MRP→MaterialBalance`。**自造新名 = 退单。**

### 真正的三个缺口（本单只做这三个）
| # | 缺口 | 实测证据 | 形态 |
|---|---|---|---|
| ① | **`Capacity` 无一等对象** | 能力靠 `Line.weeklyCapacityWan` / `HARD_CAPACITY_UNIT_SPECS`(`risk.ts:14`) 派生 | 接了线没数据 |
| ② | **交付验收段无承载** | 三个 `delivery.*` 链节点在册且 `chain-loss` 真跑，但全仓无 `Delivery`/`DeliveryNote`/`GoodsReceipt` 任何对象（0 命中）；`OrderPromise` 只有 `promiseDate/asOf`，**没有客户收货时刻、没有验收通过时刻** | 未实现 |
| ③ | **`ProductionSchedule` 零实例** | 类型已注册、生成器已产（`battery.ts:4140`）、`cadence.ts:254` 在内存里消费它，但 `service.ts` 无 `putAll` | 接了线没数据 |

> ③ 与 **D0 重叠** —— **由 D0 那个 dev 做，本单不碰**。本单只做 ① 和 ②。这里列出来是让你知道它存在，不是派给你。

### 🚦 范围边界（只碰这些）
```
apps/datacore/src/synthetic/battery.ts            (只追加 Capacity / Delivery 类型 def 与生成)
apps/datacore/src/synthetic/service.ts            (加 putAll + 链路物化)
packages/contracts/src/index.ts                   (若需 export，只加一行)
apps/datacore/src/__tests__/chain-tail.test.ts    (新建)
```
> ❌ **不建迁移**（见 §0.65）。❌ **不碰 `battery-extended.ts`**（那是 D0 与主数据的地盘）。❌ **不碰 `chain-sim.ts`**（S0 冻结）。

### 种子要求
- `Capacity`：按 `(Base, Line, 周)` 粒度，口径**必须与 `Line.weeklyCapacityWan` 对得上**——加一条测试断言两者一致，对不上就是你造了第二套真相。
- `Delivery`：≥20 条，字段含 `shipmentId` / `orderId` / `arrivedAt` / `acceptedAt` / `rejectedQty`；**必须有 ≥2 条 `acceptedAt` 为 null**（在途未验收）和 ≥1 条 `rejectedQty > 0`（验收不合格）。
- 链路：`delivery_for_shipment` / `delivery_for_order` 两条边必须真物化（`putLink`），不能只声明。

### 交付判据（缺一不可）
1. **不许造重复类型** —— 加一条测试断言 `listByType("Product")` / `listByType("Factory")` / `listByType("ProductionLine")` **全为空**（证明你没绕过本仓命名）。
2. `Capacity` 合计与 `Line.weeklyCapacityWan` 合计**误差 0**。
3. `Delivery` 的三种状态（在途 / 已验收 / 部分拒收）各至少 1 条，且能按 `orderId` 反查到。
4. 跨租户 403/404；种子确定性字节级一致（R6）。
5. `pnpm --filter datacore test -- chain-tail.test.ts` 全绿，`pnpm --filter datacore build` RC=0。
6. **性能自查**：同 D0 第 6 条。

---

## D6 · 🔴 `upsertType` 吞掉七个字段（**本包唯一一个真 bug，也是欠账 #69 的根因**）

**分支**：`claude/handoff-twin-d6-upsert-fields`
**一句话**：本体类型上的 `stateVariables` / `functions` / `actions` / `security` 等七个字段，**填了也存不进去**——`upsertType` 构造 `def` 时逐字段列举，把这七个漏掉了。之前一直被当成「没人填数据」，实测是「写入被吞」。

### 实测证据（先自己复核一遍再动手）
- 定义在：`apps/datacore/src/domain.ts:276`（`ObjectTypeDef.stateVariables`）
- 唯一写入方：`apps/datacore/src/pipeline/subgraph.ts:53`
- **吞点**：`apps/datacore/src/ontology.ts:197-212` `upsertType` 逐字段构造 `def`，缺 `stateVariables` / `functions` / `actions` / `security` / `entityCategory` / `storageMode` / `description` **七个**
- 五处 `repos.ontologyTypes.put` 已全部追完：`ontology.ts:213/225/254` + `ontology-governance.ts:177/201`，其余四处都是「读回改一两字段再写回」，**没有一处能把这七个字段带进去**

### 🚦 范围边界（只碰这些）
```
apps/datacore/src/ontology.ts                          (只补 upsertType 的字段拷贝)
apps/datacore/src/__tests__/upsert-type-fields.test.ts (新建)
```
> ❌ **不改 schema**、❌ **不加迁移**、❌ **不碰 `ontology-governance.ts`**。这是一个约 7 行的修复，如果你的 diff 超过 40 行，说明你走偏了，回来问。

### 交付判据（缺一不可）
1. **变异反证（本单头号判据）**：先写测试——`upsertType` 带全七个字段 → 读回必须**逐字段相等**。在**修复前**跑，必须**红**；贴出红的输出。修复后跑，必须**绿**；贴出绿的输出。**只贴绿的不收。**
2. 逐字段单独断言，不许用一个 `toEqual(whole)` 糊过去——七个字段要能分别看出哪个漏了。
3. **回归自查**：`upsertType` 是本体核心路径，改完必须跑 `pnpm --filter datacore test -- ontology` 全族，贴 `RC=`。任何既有测试变红立刻停手回来报，**不要自己改既有测试去迁就**。
4. 在交付说明里写清：这七个字段修好之后，**哪些原本恒空的功能会开始有值**（这决定了它会不会连带影响别的页面）。
5. `pnpm --filter datacore build` RC=0。

---

## D4 · 流程定义与节点耗时种子

**分支**：`claude/handoff-twin-d4-process-def`
**一句话**：今天有 24 个链路节点（`CHAIN_NODE_REGISTRY`），但**没有「每个节点花多久、谁负责、卡在哪种等待上」**。没有这个，时间轴孪生无从谈起。

### 🚦 范围边界（只碰这些）
```
packages/contracts/src/process-def.ts                        (新建)
packages/contracts/src/index.ts                              (只加 export 一行)
apps/datacore/migrations/031_process_definition.sql          (新建)
apps/datacore/src/repo.ts / repo/memory.ts / repo/pg.ts      (加接口与实现)
apps/datacore/src/process-def.ts                             (新建 · service + 路由)
apps/datacore/src/app.ts                                     (只加路由挂载)
apps/datacore/src/seed.ts                                    (加种子)
apps/datacore/src/__tests__/process-def.test.ts              (新建)
```

> ⚠️ **绝对不许改 `packages/contracts/src/chain-sim.ts` 的 `CHAIN_NODE_REGISTRY`** —— 那是 S0 冻结契约，前 12 个节点已冻结，改它会连带炸掉一批单源门。本单**引用**它的 `nodeId`，**不重定义**。

### 要建的对象
| 对象 | 关键字段 |
|---|---|
| `ProcessDefinition` | `processKey` / `name` / `nodeIds[]`(**引用 `CHAIN_NODE_REGISTRY.nodeId`**) / `version` |
| `ProcessNodeSpec` | `processKey` / `nodeId` / `ownerFunctionKey` / `stdDurationHours` / `minDurationHours` / `maxDurationHours` / `waitKindDefault` / `inputRefs[]` / `outputRefs[]` |
| `ProcessEdge` | `processKey` / `fromNodeId` / `toNodeId` / `condition?` / `transferHours` |

### 枚举单源（与 D2 共用，必须只有一份定义）
```ts
export const WAIT_KINDS = [
  "WAITING_USER", "WAITING_APPROVAL", "WAITING_DATA",
  "WAITING_EXTERNAL_SYSTEM", "WAITING_SCHEDULE",
] as const;
```
定义在 `packages/contracts/src/process-def.ts`，**D2 从这里 import**，不许各抄一份。
（本仓因「两处各抄一套词表」炸过整条节拍链，见欠账 #99。）

### 种子要求（demo 租户）
- 覆盖 `CHAIN_NODE_REGISTRY` 的**全部 24 个节点**，一个不落；每个节点给出 owner 职能 + 标准/最短/最长耗时。
- `stdDurationHours` 必须落在 `[min, max]` 内——**加一条测试钉死这个不变量**。
- `ProcessEdge` 必须构成一个**连通有向图**（从入口节点可达全部节点），且**至少含一处分叉 + 一处汇聚**（否则「并行评审」这条推演退化成串行）。
- 至少 3 个节点的 `waitKindDefault` 不是 `WAITING_SCHEDULE`（覆盖多种等待语义）。

### 只读 API
```
GET /a/v1/process-defs
GET /a/v1/process-defs/:processKey            # 含节点 + 边
GET /a/v1/process-defs/:processKey/critical-path   # 按 stdDurationHours + transferHours 算关键路径与总时长
```

### 交付判据（缺一不可）
1. `critical-path` 的总时长 = 路径上各节点 `stdDurationHours` + 各边 `transferHours` 之和，**误差 0**。
2. **连通性反证**：故意删掉一条边，`GET /a/v1/process-defs/:key` 必须报出**不可达节点清单**，不许静默返回一张断图。
3. 24 个节点全覆盖——**加一条测试直接对 `CHAIN_NODE_REGISTRY` 做差集断言**，缺一个即红（这样将来注册表加节点，本单的种子会立刻被门叫住）。
4. `stdDurationHours ∈ [min,max]` 对全部节点成立。
5. 跨租户 403/404；种子确定性字节级一致（R6）。
6. `pnpm --filter datacore test -- process-def.test.ts` 全绿，`pnpm --filter datacore build` RC=0。

---

## D5 · 异常剧本种子（五类异常 · 一等公民）

**分支**：`claude/handoff-twin-d5-exception-playbook`
**一句话**：只做 Happy Path 的孪生没有价值。异常必须是**可枚举、可注入、可复现**的一等数据。

### 🚦 范围边界（只碰这些）
```
packages/contracts/src/exception-playbook.ts                 (新建)
packages/contracts/src/index.ts                              (只加 export 一行)
apps/datacore/migrations/032_exception_playbook.sql          (新建)
apps/datacore/src/repo.ts / repo/memory.ts / repo/pg.ts      (加接口与实现)
apps/datacore/src/exception-playbook.ts                      (新建 · service + 路由)
apps/datacore/src/app.ts                                     (只加路由挂载)
apps/datacore/src/seed.ts                                    (加种子)
apps/datacore/src/__tests__/exception-playbook.test.ts       (新建)
```

> ⚠️ **先查 `packages/contracts/src/exception-event.ts`** —— 契约包里已经有一个同名域的文件。**先读它**，判断本单是补齐它还是另起一族；两者关系写进交付说明。**不许无视它另造一套**（同名不同物是本仓的老坑）。

### 要建的对象
| 对象 | 关键字段 |
|---|---|
| `ExceptionPlaybook` | `playbookKey` / `category` / `name` / `triggerDescription` / `affectedNodeIds[]` / `defaultMagnitude` / `unit` / `durationHours` |
| `ExceptionImpactHint` | `playbookKey` / `targetStateVar` / `direction`(+/-) / `magnitudeRatio` —— **只是提示，不是计算结果**；真值由传导引擎算 |

### 五类种子（每类 ≥3 条，共 ≥15 条）
| 类别 | 必须覆盖 |
|---|---|
| 销售异常 | 客户取消 / 客户提前交付 / 客户加单 / 客户降价 |
| 生产异常 | 设备故障 / 良率下降 / 产能下降 / 换线时间增加 |
| 供应链异常 | 供应商延期 / 关键物料短缺 / 价格上涨 |
| 物流异常 | 运输延迟 / 物流成本增加 |
| 管理异常 | 审批拒绝 / 审批超时 / 重新提交 / 方案修改 |

### 关键约束
- `affectedNodeIds` **必须引用 `CHAIN_NODE_REGISTRY` 的真 nodeId**，引用不存在的节点 = 发布失败（**fail-closed，不许 fail-open**）。本仓已有 `probeMissingRefs`（`apps/datacore/src/resources.ts:11`）可复用——**先读它再决定复用还是新写**。
- **诚实位**：`ExceptionImpactHint` 是**提示**不是**结论**。响应里必须显式标注它不是推演结果，字段名/注释都要说清。本仓因「写死的诚实位在说谎」已经返工过多次（欠账 #132/#135/#136）。
- 零业务常数（R14）：幅度、时长一律进数据。

### 只读 API
```
GET /a/v1/exception-playbooks           ?category= &nodeId=
GET /a/v1/exception-playbooks/:key
```

### 交付判据（缺一不可）
1. **fail-closed 反证**：种子里塞一条引用不存在 nodeId 的剧本，启动/发布必须**失败并指名道姓**，不许静默跳过。（做完这条**记得把这条脏数据删掉**。）
2. 五类各 ≥3 条，`?category=` 过滤准确；`?nodeId=` 能反查出所有影响该节点的剧本。
3. 管理异常类必须能表达「审批超时」——它的 `affectedNodeIds` 指向的是**批复环节**而不是业务环节，这个区分要在数据里体现出来。
4. 跨租户 403/404；种子确定性字节级一致（R6）。
5. `pnpm --filter datacore test -- exception-playbook.test.ts` 全绿，`pnpm --filter datacore build` RC=0。

---

## 1. 交付格式（七单统一）

推分支后，在 `docs/handoff/<单号>.md` 写一份交付说明，必须含：

1. **实测证据**：每条交付判据对应的命令 + 输出片段 + `RC=`。**不许只写「已完成」**。
2. **反证记录**：把你的关键断言**故意改坏一次**，贴出它变红的输出，再改回来贴出变绿的输出。
   （只贴「绿」证明不了门有牙——本仓被假绿咬过 12 次。）
3. **盘点结果**：单里凡写了「先查再建」的地方，写清你查到了什么、金丝雀是什么、为什么这么定。
4. **越界申报**：碰了范围边界之外的任何文件，逐个列出并说明原因。
5. **未做的部分**：做不完的、判断做不了的，明写出来。**不许静默缩范围** —— 缩不缩是仓主的决定，不是 dev 的。

---

## 2. 审核方复验口径（提前告知，免得白做）

- **头号判据 = 接缝驱动通 + 亲手真跑**，不是「测试绿」。绿测试 ≠ 能用。
- 每单会被单独 checkout 到隔离 worktree，跑**组合四包 gate**（`pnpm -r build && pnpm -r --workspace-concurrency=1 test`）。
- 会亲手复跑你交付说明里的每一条命令。对不上就退单，并给出精确 `file:line` + 最小修路径。
- **只有 test 引用 = 已排练，不是已实现。** 新增的 service 若零生产调用方，按「没接线」退，不按「已完成」收。
