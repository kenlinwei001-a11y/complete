# WO-D6 交付 · `upsertType` 吞字段（欠账 #69「本体七要素缺口」根因）

- **分支**：`claude/handoff-wo-d6-upserttype`（从 `origin/claude/inspiring-gates-aqczjg` 重开）
- **分支判据**：用祖先关系，非文件存在性。`git merge-base --is-ancestor HEAD $CANON` → `EXITCODE=0`
  ⇒ 原 HEAD（`778cc589`）是 canonical（`69804185`）的祖先 ⇒ 落后 ⇒ 已 `git checkout -B` 重开。

---

## 1 · 实测字段 diff（原文）

**做法**：造一个带全部调用方可传字段的 `ObjectTypeDef` → upsert → 读回 → 逐字段 `JSON.stringify` 比对
（`SERVER_ASSIGNED = id/tenantId/version/status/published/deprecation` 由服务端自管，不参与比对）。

### 1.1 修复前（RED 基线原文，`test/upsert-type-roundtrip.test.ts`）

```
[D6 diff] 服务层 upsertType→getType: 7 个字段被吞 →
  - storageMode: 传入 "ONTOLOGY" / 读回 undefined
  - stateVariables: 传入 [{"propKey":"risk","fromField":"event.risk","fn":"MAX","dataType":"number"}] / 读回 undefined
  - functions: 传入 [{"name":"adjustCapacity","returns":"number","builtin":"scale","expr":"risk * 1.1"}] / 读回 undefined
  - actions: 传入 [{"actionTypeKey":"AT_D6_ADJUST"}] / 读回 undefined
  - security: 传入 [{"prop":"secret","strategy":"HASH","scopeRoles":["admin"]}] / 读回 undefined
  - entityCategory: 传入 "设备" / 读回 undefined
  - description: 传入 "D6 探针：七字段落库验证" / 读回 undefined

[D6 diff] REST POST→GET: 8 个字段被吞 →
  - properties: 传入 [{"propKey":"probeId",...,"displayName":"探针主键","description":"属性级中文名/描述也走同一条窄门"},...]
              / 读回 [{"propKey":"probeId","dataType":"string","isPrimaryKey":true,"required":true,"searchable":true},...]
  - storageMode: 传入 "ONTOLOGY" / 读回 undefined
  - stateVariables: 传入 [{"propKey":"risk","fromField":"event.risk","fn":"MAX","dataType":"number"}] / 读回 undefined
  - functions: 传入 [{"name":"adjustCapacity","returns":"number","builtin":"scale","expr":"risk * 1.1"}] / 读回 undefined
  - actions: 传入 [{"actionTypeKey":"AT_D6_ADJUST"}] / 读回 undefined
  - security: 传入 [{"prop":"secret","strategy":"HASH","scopeRoles":["admin"]}] / 读回 undefined
  - entityCategory: 传入 "设备" / 读回 undefined
  - description: 传入 "D6 探针：七字段落库验证" / 读回 undefined

[D6 diff] 二次 upsert→getType: 7 个字段被吞 →   （同上 7 个；entityCategory 传入 "传感器" / 读回 undefined）

[D6 diff] memory 仓储 put→get: 0 个字段被吞（逐字段相等）
[D6 diff] pg 仓储 put→get: 0 个字段被吞（逐字段相等）
```

### 1.2 与派单描述的两处出入（**以实测为准**，按要求明确说出）

| # | 派单说法 | 实测 | 差在哪 |
|---|---|---|---|
| ① | 「`upsertType` 吞掉**七个**字段」 | **服务层确是 7 个，一字不差** | 无出入。7 个 = `storageMode` / `stateVariables` / `functions` / `actions` / `security` / `entityCategory` / `description` |
| ② | 「本包唯一的真 bug＝`upsertType`」 | **吞点有两个，彼此独立** | REST 路 `POST /a/v1/ontology/object-types` 的 **zod body schema 未声明这 7 个键**，zod 默认 `strip` ⇒ 它们**在进 service 之前**就没了。**只修 `upsertType`，REST 路照吞**（下方变异反证 M2 实测证明） |
| ③ | —— | REST 路还**多吞 1 项**：`properties[].displayName` / `properties[].description` | 同病的属性级形态：`PropertyDef` 契约里早有这两个键，route schema 漏声明 ⇒ 被 strip。后果是 `getTypeSemantics`（`ontology.ts:177-178` 明明会读）下发给 B 的口径恒缺中文名/描述 |

> **所以 REST 链路的实测是 8 项而不是 7 项**（7 个类型级 + 1 个 `properties` 项内含 2 个属性级键）。
> 派单里「七个」只覆盖了服务层那一半。

---

## 2 · 根因定位（file:line）

### 吞点 ①（服务层）· `apps/datacore/src/ontology.ts:194 upsertType`，构造 `def` 处（修前 `:199-212`）

不是 zod strip，不是仓储不一致，是**手写字段白名单**：`def` 逐字段列举，`ObjectTypeDef`
（`apps/datacore/src/domain.ts:262-293`）后加的 7 个 OntoFlow 扩展字段一个都没抄进去。

### 吞点 ②（传输层）· `apps/datacore/src/app.ts:2252 POST /a/v1/ontology/object-types` 的 `parseBody(z.object({...}))`

`parseBody`（`app.ts:288`）走 `schema.safeParse` → **zod 4 默认 strip 未声明键**。
schema 里没有这 7 个键，也没有 `PropertyDef` 的 `displayName`/`description`。

### 这不是「没接线」，是「接了线数据被吞」——生产链真在填

追第二层调用（不止 grep）：

```
OntoFlow 工作流发布
  → apps/datacore/src/pipeline/subgraph.ts:45-59 buildTypeDefs
      :52 storageMode  :53 stateVariables  :54 functions
      :55 actions      :56 security        :57 entityCategory  :58 description   ← 七个全在填
  → apps/datacore/src/pipeline/service.ts:141  for (const t of typeDefs) await this.ontology.upsertType(ctx, t)
  → ontology.ts upsertType 手写白名单 → 七个字段静默丢弃
  → 读出侧（getType / listTypes / GET /a/v1/ontology/object-types）恒空
```

这正是欠账 #69 表现出来的样子：**Interface 恒零 / Security 列级恒零 / Action 无回写声明 /
Function 无本体签名** —— 契约在、写入代码在、UI 契约在，看起来"这个能力有"，
实际从头到尾没有一个字节走完全程。

### 两个仓储实现：**都查了，都没问题**

| 实现 | 位置 | 结论 |
|---|---|---|
| memory | `repo/memory.ts:119 MemStore` + `:425 ontologyTypes: new MemStore()` | 整体 `clone(item)` 存取，**不逐字段列举** ⇒ 不吞 |
| pg | `repo/pg.ts:145 PgStore` + `:726 new PgStore(pool, "ontology_types")` | `doc` JSONB 列，put 是 `JSON.stringify(item)`、get 是 `r.rows[0].doc`，**不逐字段列举** ⇒ 不吞 |
| 表结构 | `migrations/001_init.sql:95-101` | `ontology_types(id, tenant_id, doc JSONB, updated_at)` —— doc-blob 表 |

⇒ **不需要改表 / 不需要动 `migrations/*.sql` / `repo/pg.ts` 存取逻辑 / `repo/memory.ts` / `repo.ts` 接口**。
派单里"若确需改表则四处齐"的前提不成立，故未改（见 §5）。

并且这句话没有停在注释里：测试 ④ 拿**真** `PgStore` 类跑了一遍 `put→get`
（用 Map 背板替掉网络，如实复现 JSONB「写 JSON 文本、读已解析值」的语义），把它钉成断言。
为此把 `PgStore` 从 `class` 改为 `export class`（`repo/pg.ts:145`），无行为改动。
**它证明的是「PgStore 不逐字段列举、doc 列全量往返」，不是「连过一台真 postgres」** —— 如实标注。

---

## 3 · 修法：修根因，不在调用点打补丁

### ① `ontology.ts upsertType` —— 摊开 input + 覆写服务端自管字段

```ts
const def: ObjectTypeDef = {
  ...input,                                    // ← 契约新增字段默认过得去
  id: existing?.id ?? newId("otype"),
  tenantId: ctx.tenantId,
  domain: input.domain ?? existing?.domain,
  derivedProperties: input.derivedProperties ?? [],
  sourceBindings: input.sourceBindings ?? [],
  version: (existing?.version ?? 0) + 1,
  status: "ACTIVE",
  published: existing?.published,              // 治理增量 §2.1 锚点，不许调用方指定
  deprecation: existing?.deprecation,
};
```

**为什么是摊开而不是补 7 行**：病根是"手抄白名单"这个写法本身 —— 补 7 行只是把今天的 7 个补上，
下次契约加第 8 个字段照样漏。摊开让"漏抄"这个失效模式消失。
`published`/`deprecation` 必须留在覆写位（它们在 `Omit` 之外、调用方能传），
否则 API 名不可变纪律会被调用方绕过 —— 这是摊开写法唯一要小心的地方，已处理。

### ② `app.ts` route schema —— 补齐 7 个类型级键 + 2 个属性级键

`storageMode` / `stateVariables` / `functions` / `actions` / `security` / `entityCategory` / `description`，
以及 `properties[].displayName` / `properties[].description`。

---

## 4 · 变异反证（红/绿两次输出）· **两个吞点各自独立反证**

只做「全部回退→红」不够：那证明不了两个吞点各有断言。故做了两次**独立**变异。

### 4.1 修复后（绿）

```
[D6 diff] 服务层 upsertType→getType: 0 个字段被吞（逐字段相等）
[D6 diff] REST POST→GET: 0 个字段被吞（逐字段相等）
[D6 diff] 二次 upsert→getType: 0 个字段被吞（逐字段相等）
[D6 diff] 二次 upsert 返回值: 0 个字段被吞（逐字段相等）
[D6 diff] memory 仓储 put→get: 0 个字段被吞（逐字段相等）
[D6 diff] pg 仓储 put→get: 0 个字段被吞（逐字段相等）
 Test Files  1 passed (1)      Tests  4 passed (4)      RC=0
```

### 4.2 变异 M1 · **只**回退 `upsertType`（route 修复保留）→ 红

```
MUT1_RC=1
 × ① 服务层：upsertType → getType 逐字段相等
     → expected [ 'storageMode', …(6) ] to deeply equal []
 × ② REST 链路：POST → GET 逐字段相等
     → expected [ 'storageMode', …(6) ] to deeply equal []
 × ③ 二次 upsert（update 路径）不得丢字段
     → expected [ 'storageMode', …(6) ] to deeply equal []
 ✓ ④ 仓储双实现（memory + 真 PgStore）都是 doc-blob，不吞字段
      Tests  3 failed | 1 passed (4)
```
注意 ② 此时报 **7** 个而非 8 个 —— `properties` 已被 route 修复接住，说明断言分辨得出是哪一层在吞。

### 4.3 变异 M2 · **只**回退 route schema 的一个键（`storageMode` 改名）→ 红，且只红该键

```
MUT2_RC=1
 ✓ ① 服务层：upsertType → getType 逐字段相等
 × ② REST 链路：POST → GET 逐字段相等
     → expected [ 'storageMode' ] to deeply equal []
     [D6 diff] REST POST→GET: - storageMode: 传入 "ONTOLOGY" / 读回 undefined
 ✓ ③ 二次 upsert（update 路径）不得丢字段
 ✓ ④ 仓储双实现
      Tests  1 failed | 3 passed (4)
```
**单字段粒度的精确击杀**：只有走 REST 的那条断言变红，其余不受影响
⇒ 断言咬的是**链路上的具体那一层**，不是笼统"某个函数被调过"。

### 4.4 恢复后复绿

```
RESTORE_RC=0      Tests  4 passed (4)
```

---

## 5 · 回归与门（**全部显式捕获退出码，无管道吞码**）

| 批次 | 范围 | 结果 |
|---|---|---|
| 本单门 | `test/upsert-type-roundtrip.test.ts` | `RC=0` · 4 passed |
| 本体族 | `ontology` / `ontology-core` / `ontology-governance` / `ontology-validate` / `ontology-validate-semantics` / `ontology-query-engine` / `type-semantics` / `meta-ontology` / 本单 | `Tests 2 failed | 65 passed (67)` —— 2 红**均为既有红**，见 §5.1 |
| 目录/建模 | `catalog` / `catalog-search` / `modeling` / `modeling-wire` / `entity-catalog` / `prototype-intake` / `action-type-evolution` / `concurrency` / `type-semantics` | `RC=0` · 9 files · 51 passed |
| 发布链 | `workflow`（SUBGRAPH_ENTITY 发布链＝本 bug 的生产调用方）/ `execution-semantics-pipeline` / `execution-semantics` / `databuilder` / `databuilder-slice-register` / `global-sim-business-type-seam` | `RC=0` · 6 files · 62 passed |
| 确定性种子 | `demo-chain-provenance` / `synthetic` / `synthetic-field-alignment` / `seed-demo-propagation` / `readyz-seeding-gate` | `RC=0` · 5 files · 25 passed（**确定性种子铁律未破**） |
| 金值 | `adversary-r6-golden-probe` / `meta-ontology` / `a3-refbase` / `data-template-fk` | `RC=0` · 4 files · 20 passed |
| typecheck | `tsc -p apps/datacore/tsconfig.json --noEmit` | `TYPECHECK_RC=0` |
| build | `pnpm --filter datacore build` | `BUILD_RC=0` |
| lint | `eslint apps/datacore/src apps/datacore/test` | 32 errors 全在**我未触碰的文件**里；我触碰的 4 个文件命中数 = 0（金丝雀 `synthetic.test.ts` 命中 1，证明 grep 是好的） |

### 5.1 两处未修的红 —— 已证**既有**，与本单无关

**判据不是"看起来无关"，是同一条命令在 canonical 源码上重跑一遍。**
做法：`git checkout $CANON -- apps/datacore/src/{ontology,app}.ts` → 跑 → 结果对比 → `git checkout HEAD --` 还原。

`test/ontology-query-engine.test.ts` 2 条（linkPath 方向后缀），canonical 基线原文：

```
BASELINE_RC=1   （canonical 源码，与本单同一条命令、同一 cwd）
 × ① 前向跨类型遍历 → expected [ 'model_producible_at', …(1) ] to deeply equal [ 'model_producible_at', …(1) ]
 × ② 反向遍历        → expected [ …(2) ] to deeply equal [ 'order_for_model:forward', …(1) ]
      Tests  2 failed | 5 passed (7)
```
带本单修复时**逐字一致**的 2 条 ⇒ 既有红，非本单引入。

### 5.2 我自己踩到并纠正的一个工具坑（照铁律 0.6 记账）

第一轮回归里 `test/meta-ontology.test.ts` 报 5 红：
`ENOENT: no such file or directory, open '/home/user/complete/.claude/docs/SYSTEM-ONTOLOGY.md'`。

差点当成"既有红"放过去。实际是**我的调用方式造成的**：该测试
（`test/meta-ontology.test.ts:7`）用 `join(process.cwd(), "..", "..", "docs")` 定位 docs，
而我用 `npx vitest run --root apps/datacore` 启动 —— `--root` 只改 vitest 的 root，
**不改 `process.cwd()`**，cwd 仍停在 worktree 根 ⇒ `../../docs` 解析到 `/home/user/complete/.claude/docs`（不存在）。

改用 `env -C apps/datacore npx vitest run test/meta-ontology.test.ts` 后：

```
RC=0     Test Files  1 passed (1)     Tests  7 passed (7)
```

**形态**（照 0.6 句式）：「我用『测试报红』当作『代码有问题』的证据，而前者并不度量后者 ——
它这次度量的是我的 cwd。」§5 表里所有结论均已改用 `env -C` 固定 cwd 重跑。
这也是为什么 §5.1 的既有红判定坚持"同一条命令、同一 cwd 跑两次"而不是凭外观。

---

## 6 · 没做的与原因

| 没做 | 原因 |
|---|---|
| 改 `migrations/*.sql` / `repo/pg.ts` 存取逻辑 / `repo/memory.ts` / `repo.ts` 接口 | **不需要**：`ontology_types` 本就是 `doc JSONB` doc-blob 表，两个仓储都全量往返、不逐字段列举（§2 已实测钉成断言）。改表属于无意义扰动 |
| 修 `ontology-query-engine.test.ts` 的 2 条既有红 | 超出 🚦 范围边界，且已证与本单无关（§5.1）。**未改既有测试去迁就本单** |
| 修 lint 里其余 32 个 error | 全在我未触碰的文件（`synthetic.test.ts` / `vle-acceptance.test.ts` 等），属既有欠账，不在本单边界 |
| 回写 `docs/SYSTEM-ONTOLOGY.md` | 派单明令不许碰。**但需上游注意**：本修复让「本体七要素」中 Interface/Security/Action/Function 四个残片字段**从此真能落库**，本体 §2.B 与 `docs/PRD-ontology-7elements.md` 关于"被 `upsertType` 吞"的描述已过期，需由有权改本体的人回写 |
| 跑 `scripts/gate.sh` / `pnpm -r test` | 派单明令禁止（datacore vitest 重，会与审核方抢 CPU）。只跑了定向单文件/小批量 |
| 前端/agentcore 侧消费这些字段 | 超出范围边界。本单只保证"写进去读得回来"；**读出侧 UI 是否展示是另一件事** |

### 6.1 交接提醒（不是本单缺口，但会影响下一个人的判断）

修复只保证**写入路径不再吞**。`security` 字段现在**存得进也读得回**，但
「列级脱敏是否真的在读出层被执行」是**另一个独立问题**，本单未验、也不在范围内 ——
别因为本单绿了就认为列级脱敏已生效（那正是 `docs/ONTOLOGY-7ELEM-AUDIT.md` 警告过的
"留着最危险：下一个人会以为列级已经有了"）。

---

## 7 · 落盘确认

```
$ git ls-remote origin claude/handoff-wo-d6-upserttype
```
见交付末尾实测输出（分支已存在且有 sha）。

**改动文件**（严守 🚦 范围边界，未碰 `apps/agentcore/**`、`apps/frontend-shell/**`、
`docs/SYSTEM-ONTOLOGY.md`、`scripts/**`）：

| 文件 | 改动 |
|---|---|
| `apps/datacore/src/ontology.ts` | `upsertType` 摊开 input + 覆写服务端自管字段（吞点 ①） |
| `apps/datacore/src/app.ts` | `POST /a/v1/ontology/object-types` zod schema 补 7 类型级键 + 2 属性级键（吞点 ②） |
| `apps/datacore/src/repo/pg.ts` | `PgStore` 改为 `export`（供测试驱动真实现；无行为改动） |
| `apps/datacore/test/upsert-type-roundtrip.test.ts` | 新增 round-trip 门（4 用例，含双仓储与二次 upsert） |
| `docs/WO-D6-delivery.md` | 本文件 |
