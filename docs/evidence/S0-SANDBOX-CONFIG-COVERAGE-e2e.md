# S0 · WO-SANDBOX-CONFIG-COVERAGE 真跑验收证据（2026-07-11 · dev3）

真起双服务（datacore:4001 内存模式 SEED_DEMO=1 + agentcore:4002·SERVICE_TOKEN 同值），脚本
`s0-e2e.mjs` 逐值断言（铁律 0.4：非单测冒充·全部走真 HTTP 正门）。以下为逐条验收 ↔ 真跑输出对照。

## 验收 2 · gap 诊断真跑（改造前对照：这两类根本不存在）

经正门声明配套（`PUT /b/v1/intents/adopt_mitigation` bindings 增 `stateVarKeys:["S0Widget.s0Load","S0Widget.ghostVar"]` +
`propagationRuleKeys:["pr_s0_e2e","pr_s0_ghost"]`，其中 ghost 两项系统里不存在）→ 用该意图 example 原句
「采纳常州的三班制方案」提交真查询 → 后台预分析（feature `growth.pre_analysis` 开）：

```
✓ gapAnalysis 含 propagation_rule entry（改造前该类根本不存在=对照）
✓ gapAnalysis 含 state_var entry
✓ pr_s0_ghost=MISSING            ← 缺的那条（autoCreatable:false 无 scaffolder·诚实 MISSING 非假 TO_CREATE）
✓ S0Widget.ghostVar=MISSING
✓ 幽灵规则 WARNING+MANUAL（咨询信号·非 DEVELOP·§10 永不误红）
```

## 验收 3 · R6 确定性

```
✓ R6：双跑 gapAnalysis.entries 字节一致（同 query 两个 task 的 entries JSON 逐字节相等）
```
（单测另证 analyzeGap 同需求树双跑归一 generatedAt 后字节一致：`provisioners.test.ts` S0 块。）

## 验收 4 · existing 真读（真建→EXISTS）

真建 1 条传导规则（`POST /a/v1/sim/propagation-rules` key=pr_s0_e2e·PUBLISHED）+ 1 个带数值派生属性的
对象类型（`POST /a/v1/ontology/object-types` S0Widget·derivedProperties=[s0Load]）：

```
✓ snapshot.propagation_rule 含 pr_s0_e2e（真读 sim_propagation_rule）:
  ["demo_line_util_to_base_load","demo_model_demand_to_base_load","demo_order_demand_pressure","pr_s0_e2e"]
✓ snapshot.state_var 含 S0Widget.s0Load（真读 derivedProperties）
✓ pr_s0_e2e=EXISTS（gap 里该条 status=EXISTS）
✓ S0Widget.s0Load=EXISTS
```
（registry-snapshot 走服务间凭证 x-service-token·6→8 类 additive。）

## 验收 5 · GrowthTicket 落点（/admin/tickets 数据源）

```
✓ 幽灵传导规则 → GrowthTicket（id=gtk_01KX83912NYEA9B0858MVWMHB9·status=OPEN·gapCode=NO_CAPABILITY）
✓ 幽灵状态变量 → GrowthTicket（id=gtk_01KX83912NDBJT6HZRXJRDV4DJ）
✓ 工单 ontologyRefs.rules 带规则 key（施工定位）
✓ 同配套项 OPEN 工单幂等复用（第二跑 n=1·不重复轰炸）——幂等锚 [sandbox-config:kind:key]
```

## 验收 6 · 回退演练（真跑·双向）

- **feature 关**（真 JWT·PUT overrides growth.pre_analysis:false·等 60s 缓存 TTL）：
  `GET /api/v1/growth/pre-analysis/:taskId` → `{"error":{"code":"FEATURE_NOT_FOUND"…}}` ✓
- **feature 再开**：同端点 → 200 DONE ✓（双向可证）
- **旧 BuildPlan 反序列化零破坏**：无两 need 数组的旧 plan JSON `BuildPlanSchema.parse` OK →
  `propagationRuleNeeds=[] · stateVarNeeds=[]`（default 材料化）✓
- **意图未声明配套 → 两 kind 不出现**：改造前形态查询的预分析 entries kinds =
  `[ontology_type, rule, slice, solver, intent, skill]`（无 propagation_rule/state_var·惰性暗发实拍）✓
- **additive 可摘（stash 全摘 → 基线四包 test 绿）**：见交付说明（本单 git 记录）。

## 附注（诚实边界·派单单二选一裁定）

- WO §3.2 autoCreatable 二选一：**取 false**。理由：S0 无 propagation_rule/state_var scaffolder（系数×延迟/
  formula 需领域判断），标 TO_CREATE=「可自动建」是假承诺（KILL-MOCK-RED）；缺则 MISSING → 骨架工单人工建模正门。
  后续校准/建模 WO 落 scaffold 后可翻 true。
- `analyzeGap` 分支判据从 `side===cross_system` 改为 **existing() 有无**：B 栈 7 类（无 existing）回执路径逐字
  不变（byte 等价门六场景全绿），propagation_rule（side=cross_system 取拓扑序但表在 DataCore）走 existing 真读。
- dev 通道（X-Debug-User 无 JWT）entitlement 解析降级 fail-open 属既有 gate.ts 行为（非本单引入）；
  回退演练用真 JWT 走真 entitlement 链验证。
