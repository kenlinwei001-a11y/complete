# CAPABILITY-OBJECT · FDE 真实测试证据（不作假）

WO-2（可信自我账 PRD-trustworthy-self-accounting §3.1）：`Capability` 一等对象 + `verifiedStatus` 现实派生器 + 代表问 **NL 路径** E2E harness。核心红线：**verifiedStatus 由现实派生·禁手写路径**；代表问 E2E 必须走**用户真实 NL 路径**（QueryDock 打字→QOS 分类→场景/求解器→答案），**非**手搓 args 直调 `/a/v1/solvers/{key}/invoke`。

真实测试口径：agentcore 侧用 `createTestApp` = **真 `buildServer(deps)`**（真 Fastify + 真 `Orchestrator` + 真 workflow executor + 真 seeded 对象库），仅 LLM 分类步按仓约（"测试不依赖网络随机性·LLM 一律 mock"）注入确定性分类响应；**工作流执行 / 求解器 / dataBearing 投影 / classifyGap 全部真跑**。这是 NL 路径的真 in-process E2E，非纯 unit-mock。

## 0. 亲跑退出码（只信 EXIT=0）

```
npx vitest run apps/agentcore/test/capability-verify.test.ts apps/datacore/test/capability-object.test.ts --reporter=verbose
EXIT=0 · Test Files 2 passed (2) · Tests 8 passed (8)
```
包 build：`@platform/contracts` / `datacore` / `agentcore` build EXIT=0（0 err）。

## 1. 真竖井：代表问经 NL 路由答出 dataBearing → VERIFIED（齿②+齿③A）

`verifyCapability({orchestrator,repos}, auth, {key:"affected_orders", kind:"scenario_answer", representativeQuery:"影响哪些订单？", …}, {artifactExists:true, context:{view:"risk", selectedObjects:[常州Base]}})`：
- 探针经 `orchestrator.submitQuery(问句)`（**NL 路径**）真跑 → 终态 `task.status=COMPLETED` · `task.path=WORKFLOW` · `task.matchedIntent.intentKey=affected_orders`（**经分类→意图路由的真凭据**）。
- 答案含 `table` 块（真 seeded 订单库投影）→ `classifyGap` verdict=**ANSWERABLE**（其 ANSWERABLE 已内含 dataBearing 诚实门 probe.ts:98）。
- `deriveVerifiedStatus` → **VERIFIED** · `evidence.kind=RUNTIME_PROBE` · detail 含 `ANSWERABLE`。
- **齿②证据**：`vi.spyOn(orchestrator,"submitQuery")` 被调用 1 次、`calls[0][1].query==="影响哪些订单？"`、`calls[0][3].internal===true`；harness 模块**无任何 solver-invoke 依赖**（结构上不 import DataCore solver invoke 客户端）——与现存 4 个手搓 args 直调 `/a/v1/solvers/{key}/invoke` 的假 E2E 对立。

## 2. 诚实空态：无意图覆盖 → 代表问答不出 → UNVERIFIED（齿③B·非假 VERIFIED）

分类 `outOfCatalog:true`（模拟"无 LLM 真路由 / 缺该能力"）+ 路径 B agent 兜底给非 dataBearing 文本：
- `probe.answered===false`（NL 路由未答出 ANSWERABLE+dataBearing）。
- `deriveVerifiedStatus` → **UNVERIFIED**（`verifiedStatus !== "VERIFIED"` · `evidence.kind !== "ACCEPTANCE_PASS"`）——**诚实空态，绝不假 VERIFIED**。
- 对齐 WO 约定：**无 LLM key 环境下代表问经 NL 路径重跑 → 诚实 UNVERIFIED；真 Kimi 下能否转 VERIFIED 属审核方复验**（本环境无真 LLM，故不自宣 VERIFIED）。

## 3. verifiedStatus 禁手写（齿①）

- 契约层：`CapabilitySpec` 类型上**无 verifiedStatus 字段**；唯一构造路径 `buildCapability(spec, deriveInput)` 恒经 `deriveVerifiedStatus` 产出——手打无编译期/运行期入口。
- 仓储层：`CapabilityStore` **无 setVerifiedStatus**（`(store as any).setVerifiedStatus===undefined`）；只 `upsert(完整 Capability)` 持久化派生态；读路径经 `CapabilitySchema.parse` 拦截脏投影（塞非法 `verifiedStatus:"HAND_WRITTEN"` → `store.get` **rejects**）。
- 派生真值表（`deriveVerifiedStatus`）：三真=VERIFIED 是唯一为真路径；缺任一现实信号 → 非 VERIFIED；曾 VERIFIED + 现重跑失败 → STALE。

## 4. revert 派生逻辑 → 红（teeth 真咬·非装饰）

把 `deriveVerifiedStatus` 的 `answered` 强改为 `true`（伪造 fake-done），重 build contracts 后重跑：
```
EXIT=1 · Test Files 2 failed (2) · Tests 4 failed | 4 passed (8)
  × 齿③(B) 诚实 UNVERIFIED           （伪造后变 VERIFIED → 红）
  × 齿① 派生唯一 VERIFIED 路径        （缺信号仍 VERIFIED → 红）
  × datacore 派生真值表              （同上 → 红）
  × datacore CapabilitySpec 无手打路径 （UNVERIFIED 被伪造成 VERIFIED → 红）
```
已 revert 复绿（EXIT=0, 8/8）。证明：删/放水派生逻辑必红——verifiedStatus 与"制品在+代表问 NL 答出"结构上焊死，无法两张皮。

## 5. 复用现成仓储·不新建表（R9）

`Capability` 落 `repos.objects`（`type=Capability` · tenant=`__platform__` · origin `META`），与 Dogfooding 元层同库同租户。datacore 测试实证：`repos.objects.get("__platform__", cap_…)` 命中 · `listByType` 命中 · **业务租户 `demo` 经 objects 仓储天然见 0 条**（R2）· remove 后 get=undefined。零新迁移、零新表。

## 6. 诚实边界（分期·非 fake-done）

**本单打穿（真竖井闭环）**：Capability 契约 + 现实派生器 `deriveVerifiedStatus`（禁手写）+ 代表问 NL harness（复用 `GrowthTicket.verify` 同机制·非直调 solver）+ 持久化（复用 objects 仓储）+ **一条真竖井**（`affected_orders` 代表问经 NL 真跑答出 dataBearing→VERIFIED；无覆盖→诚实 UNVERIFIED）。

**诚实列后续（未在本单·不冒充完成）**：
- 逐一给 39 个求解器 / SCENARIO_CATALOG S01–S20 建 Capability 实例并全验（PRD §6 回炉 · 每个用"代表问经 NL 真跑答出"验收）——属随后需求拉动批，非本骨架单。
- Capability 读写 REST 端点 + 前端能力清单页（本单只交付契约/仓储/派生器/harness 库层；无端点，故未 curl HTTP 面）。
- 真 Kimi provider 下代表问转 VERIFIED 的复验（本环境无真 LLM key）。
- pg 双实现路径：objects 仓储 pg 侧已存在（R9），Capability 复用之未加新表，pg 下 CapabilityStore 走同一 `repos.objects` 接口——未在真 pg 起库实证（属 objects 仓储既有覆盖面）。
