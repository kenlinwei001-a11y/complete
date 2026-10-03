# HANDOFF · WO-INTERFACE-ACTIONTYPE-DEEPVAL（G-NO-INTERFACE 残口②）

- 分支：`claude/handoff-wo-interface-actiontype-deepval`
- 基线：`origin/claude/verify-reclaim-6` @ `8925bbd417af9fe759941f9e052c844be12e8938`（2026-08-20 14:46 核）
- 日期：2026-08-20

## 残口②取证结论（先取证后动手，三行）

1. 发布门 `assertInterfaceConformance`（`apps/datacore/src/ontology.ts` :295 定义、:333 由 `publishVersion` 调用）今天校验：接口引用解析/退役、属性缺失/类型不符/跨接口冲突、**行动是否被类型绑定**（`INTERFACE_ACTION_MISSING`）、函数可兑现性；但纯核 `checkInterfaceConformance` **从不消费 `ConformanceInput.actionTypeKeys`**——「接口声明的 ActionType 是否注册」只在接口 upsert/publish 时由 `checkInterfaceIntegrity`（`ontology-governance.ts` :1016/:1037）把守，发布门自身不查（注册表漂移 / 绕过 service 直写仓储即可带病进快照）。
2. 签名深校验全线缺失：`InterfaceActionRequirement` 只有 `{actionTypeKey, required}`；WO-ACTIONTYPE-TARGET 刚落线的 `ActionType.targetTypeKey` 归因键在接口门里**零消费方**——类型绑一个归因目标不是自己的 ActionType（假绑定，执行后写的是别的类型）发布门照放。
3. 参数形状无任何机器判据：接口无法声明「这个行动至少要有哪些参数」，`ActionType.paramsSchema.properties` 键集从未与接口要求对表。

## 改动点（文件：行 · 全部加性）

- `packages/contracts/src/object-interface.ts`
  - `InterfaceActionRequirementSchema`（:86 附近）：新增可选 `paramKeys: string[]`（接口语义对行动参数的最低要求；省略 = 不声明，零回归）。
  - `InterfaceViolationCode`（:149 附近）：新增 `INTERFACE_ACTION_TARGET_MISMATCH` / `INTERFACE_ACTION_PARAM_MISMATCH`（加性联合成员；全仓无对该联合的穷尽 switch，/usr/bin/grep 金丝雀已自证）。
  - 新增 `ConformanceActionTypeView { key, targetTypeKey?, paramKeys? }`；`ConformanceInput` 新增可选 `actionTypes?: ConformanceActionTypeView[]`（提供时优先于 `actionTypeKeys`）。
  - `checkInterfaceConformance` 行动循环重写为三层：① 注册性（不论 required 与否，`INTERFACE_ACTION_UNKNOWN`，点名类型/接口@版本/行动）→ ② 未绑定（原 `INTERFACE_ACTION_MISSING`，不变）→ ③ 已绑定则深校验：`targetTypeKey` 声明且 ≠ 实现者类型 ⇒ `INTERFACE_ACTION_TARGET_MISMATCH`（`undefined` = 不可静态归因 → 跳过，不许冒充相符/不符）；接口 `paramKeys` ⊄ 视图 `paramKeys` ⇒ `INTERFACE_ACTION_PARAM_MISMATCH`（视图缺 `paramKeys` = 形状未知 → 跳过）。
- `apps/datacore/src/ontology.ts` `interfaceViolations`（:307 起）：向纯核传 `actionTypes` 深校验视图——`targetTypeKey` 直取 ActionTypeRecord；`paramKeys` 从 `paramsSchema.properties` 键集投影（形状不可读 → 省略，诚实缺省）。`actionTypeKeys` 保留（向后兼容）。
- `apps/datacore/test/interface-actiontype-deepval.seam.test.ts`（新增）：4 条接缝用例，全部走真 `POST /a/v1/ontology/publish` → `publishVersion` → `assertInterfaceConformance` 链路。
- `docs/SYSTEM-ONTOLOGY.md` §8 G-NO-INTERFACE 行：残口②标闭（原文划线保留 + 闭合注记 + 新错误码清单 + 实证指针）；行首摘要「前端管理台与 ActionType 深校验为明确残口」→「前端管理台为明确残口；ActionType 深校验已闭」。

禁区自查：未动 ActionType 注册表语义；未碰 battery.ts 求解逻辑；contracts 只加新错误码 + 新可选字段/可选输入，未改既有字段。

## 验收证据（测试名 + 命令 + RC）

命令（worktree 根 / apps/datacore，每次均先探 vitest 进程 = 0）：

```
cd apps/datacore && npx vitest run test/interface-actiontype-deepval.seam.test.ts   # RC=0 · Tests 4 passed (4)
npx vitest run test/object-interface.seam.test.ts                                   # RC=0 · Tests 16 passed (16)（WO-69 既有门全绿）
npx vitest run test/ontology.test.ts test/ontology-invariants.seam.test.ts          # RC=0 · Tests 21 passed (21)
pnpm object-interface:check                                                          # RC=0（接缝实跑 16 条 + R9 四方同步 + 发布门在链路上 + 扁平无继承）
pnpm --filter @platform/contracts typecheck                                          # RC=0
pnpm --filter datacore typecheck                                                     # RC=0
pnpm --filter datacore build                                                         # RC=0（门读 dist 的前置）
```

四条新用例（均带正对照，证明门不是"一律拒"；断言期望值钉字面量/独立租户构造，非从被测映射表读出）：

1. **A：接口声明的 ActionType 未注册**——独立租户 `dvdeep` 直写 `repos.objectInterfaces` 造带病接口 `__Ghost`（声明 `未注册的行动XYZ`；走 service 会被写入期门拦，故直写模拟注册表漂移/绕写），类型 `__GhostType` 绑定该 key ⇒ 真发布链 400，body 含 `INTERFACE_ACTION_UNKNOWN` + `__Ghost` + `未注册的行动XYZ` + `__GhostType`。
2. **B：targetTypeKey 归因不符（假绑定）**——接口 `__Mitigatable` 要求 `adopt_mitigation`（电池种子真注册，归因 `AdoptedMitigation`）。正对照：`AdoptedMitigation` 绑定 ⇒ 发布 200；负例：`__FakeMitigationTarget` 绑定同一行动 ⇒ 400，含 `INTERFACE_ACTION_TARGET_MISMATCH` + 类型 + 接口 + 行动 + 实际归因目标 `AdoptedMitigation`。
3. **C：参数形状不符**——接口 `__PlanKeyed` v1 `paramKeys:["base","factor","planKey"]`（全在 paramsSchema 内）⇒ 200；演进 v2 要求 `不存在的参数键` ⇒ 400，含 `INTERFACE_ACTION_PARAM_MISMATCH` + `不存在的参数键`。
4. **零回归**——电池种子既有绑定（`对象数据变更`：不可静态归因 + 无 paramKeys）⇒ 全量发布 200。

既有红归属：无。测试中发现一例**与本单无关的既有不对称**（未动）：电池种子 `AdoptedMitigation` 某属性 `unit:'点'` 系仓储直写、不在 `UNIT_DICTIONARY`，REST 重 upsert 该类型会被单位字典门 400——测试内以剥 `unit` 绕过并注释交底。

## 变异实录（变异点 → 红的测试名 → 关键输出行）

- **M1（摘掉注册性校验）**：`object-interface.ts` `if (knownActions && !knownActions.has(...))` → `knownActions && false && !knownActions.has(...)` →
  测试 **A** 精确变红（B/C/零回归保持绿）→ 关键行：`AssertionError: expected 200 to be 400`（带病接口被放行）。还原：cp 备份回写 + diff 干净 + `/usr/bin/grep -c "&& false"` = 0。
- **M2（承重断言变异·归因对齐）**：`view.targetTypeKey !== t.key` → `view.targetTypeKey !== t.key && t.key === "__NEVER__"`（恒不满足 = 校验被绕）→ 重建 contracts dist 后测试 **B** 精确变红（A/C/零回归保持绿）→ 关键行：`AssertionError: expected 200 to be 400`（假绑定被放行）。还原：cp 备份回写 + `diff` 无输出 + `/usr/bin/grep -c "__NEVER__"` = 0 + 重建 dist RC=0。
- 还原后复跑：`interface-actiontype-deepval.seam.test.ts` + `object-interface.seam.test.ts` 合计 **20 passed (20) · RC=0**。
- 过程记录：M2 首轮漏重建 contracts dist（vitest 消费 dist 非 src），变异未生效呈假绿，重建后如期变红——教训：contracts 变异必须连 dist 一起换（与"内存模式改代码必须重建 dist"同构）。

## 环境/负载

- 派单时 load 28.87（红灯）；实测执行期 load 50.69（1-min）· vitest 进程探针每次 0 ⇒ 按纪律直接推进，未触 --maxWorkers=1 档。
- `object-interface:check` 首跑 RC=2（工具坏·datacore dist 未构建），补 `pnpm --filter datacore build` 后 RC=0——RC=2 未当红报。

## 遗留

- §8 残口①（历史快照不追溯，刻意）/③（无前端管理台）/④⑤ 未动；`approvalChain` 语义对表仍属 #65（本单禁区，未动 `contracts/actions.ts` 既有字段）。
- 上记 `unit:'点'` 种子/路由不对称建议另立小单（种子补字典或字典补'点'，需裁决）。
