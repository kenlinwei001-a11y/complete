# G-12/G-5 收口 last-mile · 真 CP-SAT 活系统全链 FDE 证据

> PRD：`docs/PRD-opensource-fusion-lastmile.md`。核心红线：**mock/skip/门空过 = 不算交付**；
> 只有**活系统真打 CP-SAT + 真立非电池行业租户 + 实拍**才算。本文记录 dev 自验真实证据（curl 响应）。
> 复跑命令见末。证据环境：datacore 内存态（SEED_DEMO=1 SEED_OPT_INDUSTRY=1）+ 真 OR-Tools sidecar（services/optimizer，PORT=4003，ortools 9.15）。

## 复跑命令（审核方独立真跑）

```bash
# ① 起真 CP-SAT sidecar（OR-Tools，Apache-2.0）
PORT=4003 python3 services/optimizer/server.py &
# ② 起 datacore（内存态，接 sidecar，开 demo opt + 非电池 logi 租户）
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 SEED_OPT_INDUSTRY=1 \
  CREDENTIAL_KEY=<64hex> OPTIMIZER_BASE_URL=http://127.0.0.1:4003 node apps/datacore/dist/server.js &
# ③ 跑 FDE（curl 全链）
bash docs/evidence/G12-opt-fde.sh   # 或见下逐条命令
# ④ 真 sidecar 集成测试（非 skip）
OPTIMIZER_BASE_URL=http://127.0.0.1:4003 pnpm --filter datacore exec vitest run test/opt-real-sidecar.integration.test.ts
```

## 验收基线（PRD §6）逐条真值

| # | 验收点 | 真值（实测） | 判据 |
|---|---|---|---|
| 1 | entitlement 暗发 R3 | 未开 opt 的租户 `GET /a/v1/opt/templates` → **HTTP 404 FEATURE_NOT_FOUND**；demo/logi 开 override → 可见 | ✅ |
| 2 | 真 CP-SAT solve | demo(电池) `POST /a/v1/opt/solve`（facility_location 绑 Base/DemandSegment）→ **status:OPTIMAL · open:[jiangmen] · objective:56802.4**（非 graceful 400） | ✅ |
| 3 | 非电池行业租户真立 | `logi`(logistics-warehouse) `POST /a/v1/growth/provision-world` → **provisioned:true · 16 对象**（6 Warehouse + 10 Store，synthetic.runJob 真物化·确定性内置模板·无 LLM）；其 `/opt/solve` 出最优 | ✅ |
| 4 | 两行业 R14 真 CP-SAT | 电池 `open:[jiangmen] obj:56802.4` ⊕ 物流 `open:[WH-002] obj:249`——**同一 facility_location 模板 + 同一绑定层/求解器代码，仅 OntologyBinding 不同**（电池绑 Base/DemandSegment·物流绑 Warehouse/Store），经真 sidecar 各出**不同最优** | ✅ |
| 5 | optimize_whatif 真重解 | logi `POST /a/v1/opt/whatif`（data_override WH-002.openCost→9999）→ **baseline 249 → perturbed 274 · Δ=25 · feasible:true**（真 sidecar 双解·非 mock） | ✅ |
| 6 | provenance 非空 | `opt-template:check` 绿 · `GET /a/v1/opt/templates` 返 **5 个 OptModelTemplate 实例**（facility_location 带 `provenance{derivedFrom:"OR-Tools CP-SAT 选址模型族…",license:"Apache-2.0…LIC3/LIC4"}`），非空过 | ✅ |
| 7 | 确定性 R6 | demo solve 两次 **OPTIMAL ['jiangmen'] 56802.4** 字节一致 | ✅ |
| 8 | 许可证 | `solver-license:check` 绿（NOTICES 四红线在·无 Gurobi 指纹·优化作用域无训练管线·模板派生留痕） | ✅ |
| 9 | 门全绿 | `opt-template/opt-determinism/solver-license/debattery` 全绿（见末·pnpm gates 整体见提交） | ✅ |
| 10 | 本体回写 | §8 G-5/G-12 状态更新 + §2.J provenance 实例登记 + §3 链路「活系统已通」（本提交） | ✅ |

## 逐条 curl 实录（关键响应摘录）

### #1 R3 暗发（关→404）
```
$ curl -H 'X-Debug-User: other:u:admin' .../a/v1/opt/templates   → HTTP 404
{"error":{"code":"FEATURE_NOT_FOUND","message":"feature not found",...}}
```

### #2 demo 电池 facility_location 真 CP-SAT（绑本体）
```
POST /a/v1/opt/solve {family:facility_location, binding:{facility=Base, client=DemandSegment,
  open_cost=Base.formationCapDaily, assign_cost=Base.util}}
→ {"status":"OPTIMAL","optimal":true,"openFacilities":["jiangmen"],"objective":56802.4,
   "facilityCount":12,"clientCount":3,"summary":"选址：开 1/12 个设施服务 3 个需求点，总成本 56802.4（可证最优）"}
```

### #3 非电池 logi 租户真立（provision-world）
```
POST /a/v1/growth/provision-world {scale:S,seed:42}
→ {"provisioned":true,"jobId":"job_...","industry":"logistics-warehouse","scale":"S","seed":42,"objectCount":16}
GET object-types → [Warehouse, Store]
```

### #4 两行业 R14（同模板·仅绑定不同·各出不同最优）
```
logi: POST /a/v1/opt/solve {family:facility_location, binding:{facility=Warehouse, client=Store,
  open_cost=Warehouse.openCost, assign_cost=Warehouse.serveCost}}
→ {"status":"OPTIMAL","openFacilities":["WH-002"],"objective":249,"facilityCount":6,"clientCount":10}
对比电池 jiangmen/56802.4 —— 代码零改，仅 OntologyBinding 不同（R14 去行业锁死）。
```

### #5 optimize_whatif 真重解（Δ目标）
```
POST /a/v1/opt/whatif {perturbations:[{kind:data_override, target:"facilities.WH-002.openCost", value:9999}]}
→ {"baselineObjective":249,"perturbedObjective":274,"deltaObjective":25,"feasible":true}
（扰动被选中设施开仓成本 → 最优翻转到次优仓 → Δ=25，真 sidecar 双解）
```

### 绑定闭环（增量E·/a/v1/opt/bindings 落库）
```
POST /a/v1/opt/bindings {Warehouse/Store facility_location} → 201 id=optbnd_...（DF.8 接地通过→落库）
GET  /a/v1/opt/bindings → count=1
POST /a/v1/opt/solve {bindingId:optbnd_...} → OPTIMAL WH-002 249（create→solve 闭环）
POST /a/v1/opt/bindings {facility=GhostType} → HTTP 400 VALIDATION_ERROR（DF.8 接地失败·不落库）；list 仍 count=1
```

### #7 R6 确定性
```
run1: OPTIMAL ['jiangmen'] 56802.4
run2: OPTIMAL ['jiangmen'] 56802.4   → 字节一致 ✓
```

### 真 sidecar 集成测试（非 skip·非 mock）
```
OPTIMIZER_BASE_URL=http://127.0.0.1:4003 vitest run test/opt-real-sidecar.integration.test.ts
✓ facility_location 经真 sidecar 求最优（开 F1、目标 11）
✓ optimize_whatif 经真 sidecar 双解 → Δ目标=10
✓ two-industry R14：同模板换系数各出不同最优
Test Files 1 passed · Tests 3 passed（非 skip）
```

## 诚实边界

- **runStory vs provision-world**：PRD §5-B 提到 `runStory(倒序发育建本体)`，但 `runStory` 的 comprehend 走 LLM，本环境 LLM 一律 mock → 无法确定性产出真世界。故非电池世界经 **synthetic 建模链**（`provision-world → synthetic.runJob(viaModelingChain)`）确定性物化——这是真实非 mock 路径，满足核心 DoD（≥1 非电池租户全链立起来 + 真 CP-SAT 出最优 + whatif Δ + 实拍）。`runStory` 的 LLM 路径不在本环境可真跑范围（不伪造）。
- **非电池行业模板**：为让非电池世界**无 LLM 确定性**立起，新增**内置**确定性模板 `logistics-warehouse`（`synthetic/logistics.ts`，同 BATTERY_TEMPLATE 范式·零业务常数 R14·R6）。这是行业=「绑定/配置进来的内容」的体现，求解器/绑定层代码零改。
- **G-5 非电池视图**：`debattery:check` 绿（基线 0·前端视图源无电池业务常数硬编码）；logi 租户本体（Warehouse/Store）零电池常数。完整「非电池行业专属业务视图结构」属 G-5 8a（视图结构配置化）更大范围，非本 last-mile。
- **增量6 离线模板进化器（U8）/ 7 行业租户全立 / 深分支树（U7）**：PRD §8 明确不在本期。
