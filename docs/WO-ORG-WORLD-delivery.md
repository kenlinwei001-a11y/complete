# WO-ORG-WORLD 交付说明 · 组织世界（七世界之②）

> 仓主原话：「**真实企业最重要的不是机器，而是人。**」
> 本单的目的只有一个 —— 让系统能回答「**为什么这个流程现在卡住了**」。
> 卡住的答案十有八九不在机器侧，而在人侧：**没人有那么大的额度** / **有额度的那个人不在岗** /
> **跨基地这件事谁都批不了**。

分支：`claude/handoff-wo-org-world`（自 canonical `f6c6186` 重开 —— 原 worktree HEAD 经
`git merge-base --is-ancestor` 判定为 canonical 的**祖先**，即落后，故按铁律 0.6 的机制重开，
未用「文件是否存在」当判据）。

---

## 1 · 既有身份体系盘点（先盘、没新造）

**金丝雀先行**：`grep -rn "Principal" packages/contracts/src apps/datacore/src` → **20 处命中 / 7 个文件**
（工具有效，故下面的否定结论才成立）。

| 承载物 | 位置 | 今天是什么 |
|---|---|---|
| **`PrincipalSchema`** | `packages/contracts/src/spine.ts:23` | `{ principalId, name, kind, parentRef, tenantId }`，`PRINCIPAL_KINDS = ["org","role","person"]` |
| Principal 对象型 | `apps/datacore/src/synthetic/battery.ts:2267` + `principalProps:1128` | 4 个 propKey，域 `people`（`battery.ts:1723`） |
| Principal 实例 | `battery.ts:4006` | **7 条**：`prin-coo`(role) / `prin-plan`·`prin-supply`·`prin-fin`(org) + 3 条业务线 —— **全是部门与角色，一个「人」都没有，一条职权/额度都没有** |
| 角色词表**单源** | `packages/contracts/src/admin.ts:43 BUILT_IN_ROLES` | `platform_admin / tenant_admin / catalog_admin / approver / planner / viewer` + 参数化角色（`base_manager:常州`） |
| 角色匹配 | `apps/datacore/src/authz.ts:19 roleMatches` | 全等 ∨ 基角色（`split(":")[0]`）∨ `*` |
| demo 三账号 | `apps/datacore/src/seed.ts:22` | `admin`[admin,planner,catalog_admin,tenant_admin] · `planner`[planner] · `base_manager`[base_manager:常州]（另有 `approver`[approver,admin]） |

### 我扩的是哪个、为什么不是新造

**扩 `spine.ts` 的 `PrincipalSchema`**，`packages/contracts/src/org-world.ts:94`：

```ts
export const OrgPrincipalSchema = PrincipalSchema.extend({ ... });
```

理由：`PRINCIPAL_KINDS` **三值本来就含 `person`**。组织世界要的
Person / Role / Department 在既有模型里分别就是 `kind="person"` / `"role"` / `"org"` ——
**一个字段就够，不需要第二个身份类型**。新造 `Person` = 制造第二个身份真值源（本仓炸过多次）。

**单源证据（机器化，非口头）** —— `apps/datacore/test/org-world.test.ts` 描述块③ 四条：
1. `Object.keys(OrgPrincipalSchema.shape).slice(0,5)` **逐字等于** `Object.keys(PrincipalSchema.shape)`
   —— `.extend()` 保留基 schema 的**键序前缀**，手抄一个平行 `z.object` 复现不了；这条把「扩」与「抄」分开。
2. `OrgPrincipalSchema.shape.kind.options` **=== `PRINCIPAL_KINDS`**（没抄第二份三值表）。
3. 契约包里不存在 `PersonSchema / EmployeeSchema / StaffSchema / UserSchema / HeadcountSchema`
   —— **带金丝雀**：先证明 `/export const (\w+)Schema/` 在该文件真能咬到东西（且必含 `OrgPrincipal`），
   再报否定结论；且源码级断言 `PrincipalSchema.extend(` 确实存在。
4. 组织种子**复用**既有 synthetic 的部门 id（`prin-fin` 就是财务部，不另造 `dept_finance`），
   **带金丝雀**：先从 `battery.ts` 咬出 ≥7 条 `principalId` 字面量，再断言复用的每个 id 都真在其中，
   且组织种子没为它们另播一行。

### 存储分层的诚实说明（为什么不是塞进 ObjectInstance）

既有 synthetic `Principal` 的实例数被 `demo-chain-provenance.test.ts:102` 的金值（**11320**）逐条咬死。
组织世界加的是**治理数据**（人/职权/额度/代理），不是合成业务对象；混进去既踩金值，
也会让通用图求解器把审批额度当业务指标去推断角色。故：
**同一个契约类型（`PrincipalSchema.extend`）、不同承载层** —— 这不是第二个身份类型。

---

## 2 · 种子内容（`apps/datacore/src/org/seed.ts`）

**R6 确定性**：全字面量常量，**无 `Date.now()` / 无 `Math.random()` / 无自增计数器**；
id 由 `orgKey` 派生（`orgp_<tenant>_<orgKey>`）⇒ 同 tenant 重跑**字节级一致**（测试⑥ 断言 `JSON.stringify` 相等）。

- **部门/委员会**（新增 2，另复用 4 条既有）：销售部 `prin-sales`、经营委员会 `prin-exec`；
  复用 `prin-coo`/`prin-plan`/`prin-supply`/`prin-fin`。
- **角色 4**：销售经理 `role_sales_manager`→`planner`、财务负责人 `role_finance_head`→`approver`、
  总经理 `role_general_manager`→`admin`、基地负责人 `role_base_manager`→`base_manager:常州`。
- **人 6**：张明（销售经理）、赵敏（销售副经理·代理人）、李芳（财务负责人）、王强（总经理）、
  陈立（常州基地负责人）、孙伟（经营委员会主任委员）。
- **职权 6 + 额度 6** —— 需求原文四条的可执行形式：

| 需求原文 | authorityKey / rank | 额度 |
|---|---|---|
| 销售经理 → 可审批 ≤ 500万订单 | `auth_sales_order` / 10 | `maxOrderValue = 5_000_000` |
| 财务负责人 → 可审批利润率 ≥ 5% | `auth_finance_order` / 20 | `minMarginPct = 5`（+ 2000万上限） |
| 总经理 → 可审批重大客户订单 | `auth_gm_order` / 30 | `maxCustomerImportance = "strategic"`（+ 5000万上限） |
| 经营委员会 → 跨基地 / 大额资本投入 | `auth_exec_order`·`auth_exec_investment` / 40 | `allowCrossBase = true` · `maxInvestmentValue = 10亿` |

- **代理 1**：`dlg_sales_zhang_to_zhao`，张明 → 赵敏，`scope=order`，窗口 `2026-01-01..2026-12-31`。

**缺省语义（两类维度方向相反，刻意如此）**：黑名单维度（金额/利润率/客户重要度）`null` = **不设限**；
白名单维度（跨基地/资本投入）**缺省不可批**，必须显式授予。且**零额度 = 无权**（不是不设限）——
否则忘配额度会退化成「谁都能批」这种最坏的静默失败（测试④ 有专条咬死）。

---

## 3 · 给 `WO-APPROVAL-POLICY` 的接口形状（🔌 接缝）

**本单只回答「谁有权」这一半，不做批复链编排**（会签/或签/超时升级/发起人不得自批 全部留给那一单）。

```
POST /a/v1/org/approvers/resolve        # 主端点（本接缝）
GET  /a/v1/org/chart                    # 部门/角色/人三层
GET  /a/v1/org/authorities              # { authorities[], limits[] }
GET  /a/v1/org/delegations
PATCH /a/v1/org/principals/:id/availability   # 在岗状态（代理链的唯一触发源，admin/tenant_admin）
```

**请求** `ApprovalMatter`（`contracts/org-world.ts`）：
```ts
{ scope: "order"|"investment"|"pricing"|"procurement"|"production",
  amount: number, marginPct: number|null, customerImportance: "normal"|"key"|"strategic"|null,
  crossBase: boolean, capitalExpenditure: boolean, asOf: string|null }   // asOf 不传则不做窗口判定（R6）
```

**响应** `ApproverResolution`：
```ts
{ matter,
  eligible: [{ principalId, orgKey, name, title, authorityKey, authorityName, scope,
               escalationRank, via:"direct"|"delegated", delegatedFrom, available, workload, platformRoles }],
  blockers: [{ authorityKey, authorityName, principalId, name, escalationRank, reasons: string[] }],
  stuck: boolean, diagnosis: string }
```

对接要点（省得你踩）：
- `eligible` **确定性排序** `escalationRank ↑ → workload ↑ → orgKey 字典序`，同一人去重后保留 rank 最低那条
  （= 最小够用的权限）⇒ 你要「最小审批人」直接取 `eligible[0]`，要「升级阶梯」按 `escalationRank` 分档。
- `blockers` **指名到人**（不是「销售经理这个角色批不了」而是「张明批不了、因为超了 500 万」），
  含 `reasons[]`，可直接做「为什么卡住」的 UI。
- `platformRoles` 是与平台 authz 词表（`BUILT_IN_ROLES` + 参数化角色）的**唯一接缝**，
  你要把审批人映射回 JWT `roles` 时读它，**不要读中文 `name`**（见 §6）。
- 纯函数 `evaluateLimit(limit, matter) → string[]` 与 `delegationActive(d, scope, asOf) → boolean` 已导出，
  无 IO 无时钟，你那边要做「预演」可直接复用同一份口径。

---

## 4 · 四条效果层判据实测输出

判据一律写在效果层：断言「**返回的人变了**」，不是「返回了一个数组」。
下列输出来自**真跑的服务进程**（`SEED_DEMO=1 node apps/datacore/dist/server.js`，非单测）。

### ① 额度真的起作用（指名道姓）
```
── 400万订单 ──
  有权批: 张明(销售经理·订单审批权) , 李芳(财务负责人·订单审批权) , 王强(总经理·订单审批权) , 孙伟(经营委员会·订单审批权)
── 600万订单（只改金额）──
  有权批: 李芳(财务负责人·订单审批权) , 王强(总经理·订单审批权) , 孙伟(经营委员会·订单审批权)
  ✗ 张明 — 金额 6000000 超过可批上限 5000000
⇒ 返回的人确实变了: ["张明","李芳","王强","孙伟"] → ["李芳","王强","孙伟"]
```
另两条同源：
```
── 400万 + 跨基地 ──   有权批: 孙伟   ✗ 张明/李芳/王强 — 无跨基地审批权
── 1.2亿资本投入 ──    有权批: 孙伟   ✗ 王强 — 资本投入 120000000 超过可批上限 10000000
```

### ② 代理真的生效（**真 HTTP 全链**，不是手改仓储）
```
── 张明在岗时 ──     有权批: 张明 , 李芳 , 王强 , 孙伟
  PATCH /a/v1/org/principals/prin-p-zhangming/availability → HTTP 200 {"available":false,...}
── 张明不在岗后 ──   有权批: 赵敏（代 prin-p-zhangming） , 李芳 , 王强 , 孙伟
⇒ ["张明","李芳","王强","孙伟"] → ["赵敏","李芳","王强","孙伟"]
```

### ③ 单源断言
见 §1「单源证据」四条（全部机器化，含两处金丝雀）。

### ④ 「为什么卡住」诊断
```
20亿资本投入 → eligible=[] · stuck=true
diagnosis: 无人有权审批：最高职权「经营委员会·资本投入审批权」亦被挡 —— 资本投入 2000000000 超过可批上限 1000000000
```
诊断刻意取 `escalationRank` **最高**那个 blocker 的首条原因 —— 最高职权都过不去，那才是真天花板；
低职权的落选原因是噪音，报出来会误导。

### 单测总账
`npx vitest run apps/datacore/test/org-world.test.ts` → **28 passed (28)**。
（未跑 `pnpm -r test` / `scripts/gate.sh`：工单纪律，5 dev 并行下不压 4 核机。）

---

## 5 · 变异反证（红/绿）

**变异体**：`evaluateLimit()` 首行插 `return []`（额度判定退化成恒真）。

| 阶段 | 结果 |
|---|---|
| 变异 + **只改 `src`** | **28 全绿 —— 假绿！** |
| 变异 + `pnpm --filter @platform/contracts build`（变异真进 `dist`） | **8 failed / 28**，判据① 当场红：`expected [ '张明','李芳','王强','孙伟' ] to not include '张明'` |
| 还原 + rebuild | 28 全绿，且 `grep -c` 确认变异已从 `dist` 消失 |

> ⚠️ **这次变异反证自己差点变成假绿，值得记一笔**（形态 = 铁律 0.6 那句「我用 X 当作 Y 的证据，而 X 并不度量 Y」）：
> datacore 经 `@platform/contracts` 的 **`dist/`** 解析，不读 `src/`。
> 只改 `src` 就跑测试 ⇒ **变异根本没进运行时**，「还绿」度量的是「我忘了 build」，不是「断言不咬」。
> **机制**：变异反证必须先自证变异已落地（`grep` 变异标记进 `dist`），再看红绿 —— 变异体本身也需要金丝雀。

---

## 6 · 我怎么避开欠账 #139 的坑

**#139 原文**：角色词库只认 `propKey` **原文**，挂中文 `displayName` 无效。
**证据链（追了一层，不是只 grep）**：`field-role-lexicon.ts:25 lexiconHit(name, role)` →
被 `field-roles.ts:91/93/95/102` 以 `numFields(t).propKey` 调用，`solvers/service.ts:3754/3773/3790/3811` 同理。
**该坑的一般形态**：**匹配面读机器键，人读中文名，两者错位。**

### 坑在本单的两个落点，两处都堵了

**落点 A（要命的那个）**：需求原文写的是「销售经理 / 财务负责人 / 总经理 / 经营委员会」**四个中文名**，
而 JWT claim `roles` 与 `X-Debug-User` 里流的是 `planner` / `base_manager:常州` 这类**机器键**。
若把额度挂在中文名上去跟 `roles` 匹配 → **永远匹配不上，且静默**：
「谁都没权批」会被读成「这单确实没人能批」。

处置（三条，都可机器验证）：
1. 一切匹配只认 `orgKey` / `authorityKey` / `limitKey` / `delegationKey`（`^[a-z][a-z0-9_]*$` 强校验）；
   中文只进 `name` / `title`，**判定路径一个字都不读**，只在装配返回值时复制出去给人看。
2. **不另造角色词表**：`platformRoles` 显式映射到既有 `BUILT_IN_ROLES` + 参数化角色。
3. 断言（测试⑤ 末条）：**把全部中文 `name`/`title` 改掉，命中的 `principalId` 与 `authorityKey` 必须逐字不变**
   —— 改名后结果若变，说明判定读了中文名，当场红。

**落点 B**：数值 `propKey` 若撞 `ROLE_LEXICON` 的五个**字段级**词库
（capacity/demand/priority/revenue/cost），通用图求解器会把组织记录误推成资源/需求/营收类型。
实测撞车并**刻意改名**：

| 本来会写成 | 撞哪个词库 | 实际写成 |
|---|---|---|
| `maxCapexValue` | `cap` ⇄ `capacity` | **`maxInvestmentValue`** |
| `maxCustomerTier` | `tier` ⇄ `priority` | **`maxCustomerImportance`** |
| `level` | `level` ⇄ `priority` | **`escalationRank`** |

处置：测试⑤ 用**真的 `lexiconHit`**（与主逻辑**共用同一份实现，不抄正则** —— 抄了就是装饰品，
改主正则时门拿旧的去测照样绿）逐个数值 propKey 跑一遍；**并先跑金丝雀**证明
`lexiconHit("maxCapexValue","capacity") === true`、`lexiconHit("level","priority") === true`，
再报「零撞车」这个否定结论。另有一条反向断言：`maxCapexValue`/`maxCustomerTier` **不许**出现在契约里，
谁改回去当场红。

---

## 7 · 实测发现的两个缺陷（已修，值得审核方注意）

### 🔴 (1) `defaultOn:false` **并不足以**让功能暗发 —— 会被 battery「all on」模板覆盖

工单要求「加 flag `defaultOn:false` 暗发」。我照做后**实测 404 没出现，路由 200 通了**。
追一层查明：`features.ts templateFeatures()` 对 `industry === "battery-manufacturing"`
返回 `ALL_FEATURE_KEYS` 减去各暗发集合，而 `layeredSet()` 的 **L2 无条件 `on.add`** ⇒ **L2 覆盖 L1**。
`seedDemo` 恰恰把 demo 的 industry 设成 battery ⇒

> **只写 `defaultOn:false` 而不进暗发集合 = 该功能对 demo 租户其实是「开」的。**

这是「开关看起来关着、实际被上层无条件打开」的又一形态，且**静默**：
只断言「注册表里 `defaultOn` 是 false」的测试会全绿，却证明不了「它对真实租户是关的」。

**处置**：新增 `WORLD_DARK_LAUNCH_FEATURES = { "org.world" }`（照既有两集合的先例单列，
不污染 `QOS_/PERF_` 的原意）并接进 `templateFeatures()`。
断言改成**走真 HTTP + demo 租户**，实测 `404 FEATURE_NOT_FOUND` + 统一错误信封：
```
{"error":{"code":"FEATURE_NOT_FOUND","message":"feature not found","requestId":"req_1frnxw2s2y9r13xb"}}
```
**开关默认值仍是产品决策，我没自己开** —— 恰恰相反，我是把「本以为关着其实开着」改回真关。

### 🟠 (2) `available` 原本没有写面 ⇒ 代理链**生产零触发**（「接了线没数据」）

初版只做了读面。`available` 只能由种子给 `true`，生产里**没有任何路径能改**，
于是 `resolveApprovers` 的整条代理分支**一次都不会进** —— 实现有、单测绿（靠手改仓储驱动）、生产零触发。
这正是本仓的「接了线没数据」形态，与「没接线」修法不同。

**处置**：补 `PATCH /a/v1/org/principals/:principalId/availability`（admin/tenant_admin，R2 隔离，
非 person 主体 400 `VALIDATION_ERROR`，不存在 404），并把判据② 的测试改成**真 HTTP 全链**
（改在岗状态 → 同一端点返回的人变化），不再手改仓储。

---

## 8 · 需审核方回写本体的清单（我未碰 `docs/SYSTEM-ONTOLOGY.md`）

| 章节 | 内容 |
|---|---|
| **对象类型** | 新增 `OrgPrincipal`（= `Principal` 的组织世界扩展，**非新身份类型**）、`Authority`、`ApprovalLimit`、`Delegation`。四者走**专用表**非 ObjectInstance（理由见 §1 末），故不进合成对象金值（`demo-chain-provenance` 11320 **不变**，已核） |
| **链路** | 新增「待批事项 → 职权筛选 → 额度判定 → 展开到人 → 代理兜底 → 有权人清单」；接缝在 `resolveApprovers` 返回形状，下游 `WO-APPROVAL-POLICY` 消费 |
| **七世界总账** | `docs/AUDIT-decision-twin-gap-2026-08-09.md` §5 第②行「Organization World 后端 0 / 前端 0 ❌ 全缺」→ **后端已落（前端仍 0，另立单）**；§6.1 第 5 项「Organization World 待派」→ 已交付 |
| **不变量** | R2 tenant 隔离（4 表 + 查询面全覆盖）· R6 确定性（种子字面量 + 排序三级 tie-break + 代理窗口只认显式 `asOf`）· R9 仓储双实现四处齐（migration + repo.ts + memory.ts + pg.ts） |
| **门禁/断点** | 建议登记新断点 **`G-DARKFLAG-OVERRIDDEN-BY-TEMPLATE`**：`defaultOn:false` 被行业模板 L2 无条件覆盖 ⇒ 「注册表断言绿、真实租户是开的」。**判据必须是对租户 resolve 后的结果，不是注册表字面量**。此坑对**任何**未来暗发功能通用，建议加一道通用门：凡 `defaultOn:false` 的键，必须同时出现在三个暗发集合之一，否则红 |
| **迁移** | `apps/datacore/migrations/030_org_world.sql`（4 表 + 索引建在**机器键**上，含 down） |
| **Entitlement** | 新增 `org.world`（VIEW·`defaultOn:false`·`apiTags:["org-world"]`）+ `WORLD_DARK_LAUNCH_FEATURES` 集合 |

---

## 9 · 范围边界自查

✅ 只碰：`packages/contracts/src/{org-world.ts,index.ts}` · `apps/datacore/src/{org/*,repo/*,features.ts,seed.ts,seed-cli.ts,server.ts,app.ts}` ·
`apps/datacore/migrations/030_org_world.sql` · `apps/datacore/test/org-world.test.ts` · 本文档。
✅ **未碰**：`apps/agentcore/**` · `apps/frontend-shell/**` · `apps/datacore/src/sim/**` ·
`docs/SYSTEM-ONTOLOGY.md`（回写清单见 §8）· `scripts/**` · 任何认证/鉴权中间件本身
（`authz.ts`/`auth.ts` 一字未改；组织世界只**读** `BUILT_IN_ROLES` 词表，不改角色链路）。
✅ 未跑 `scripts/gate.sh` / `pnpm -r test`；只跑自己新增的单文件 + 4 个受影响的邻近文件。
