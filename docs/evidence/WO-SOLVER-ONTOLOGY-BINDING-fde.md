# WO-SOLVER-ONTOLOGY-BINDING · FDE 亲手真跑证据（解 B3 命门 · G-17）

> 亲手起真服务（内存模式 datacore，PORT=4051，SEED_DEMO=1），真上传产 Orders → 配 SolverBinding →
> invoke order_fullchain **出真答案**。非测试绿冒充能用；用户动作证据（curl 贴真答案 + 回退不回归对比）。
> 模型标识不入本文。

## 结论速览
- **B3 复现 + 修复**：realco 租户真上传 CSV → 派生为**非 canonical 类型 `Orders`**（不是 `Order`）→ 未配绑定时 `order_fullchain` 拒「需先有 Order」；配 `SolverBinding{order→Orders}` 并激活后 → **读上传订单真值出真答案**。
- **fieldMap 真映射**：上传字段 `gm`/`gmFloor` 经 fieldMap 映射到 canonical `marginPct`/`floorPct` → 财务判读到真值 8%<12% → 真结论「提价4%接」。
- **向后兼容零回归**：demo 租户**零 SolverBinding** → 回退 canonical 默认 → 既有推演完全不变（真结论「不建议接」+ 物料缺口/信用越限，与修前一致）。
- **DF.8 接地**：绑不存在类型/字段 → 400 不落库，绝不造实体。
- **RL4 自动建议**：建模发布后自动产 `order→Orders` DRAFT 草案（origin=auto-suggest，未生效，须人工 activate）。

---

## ① realco 真上传产 Orders（非 demo 合成）→ 配 SolverBinding → invoke 出真答案

### 1.1 真上传 orders.csv（用户动作）
```bash
curl -X POST $B/a/v1/uploads -H 'X-Debug-User: realco:admin:admin' -H 'Content-Type: application/json' \
  -d '{"filename":"orders.csv","contentBase64":"<base64 of orders CSV>"}'
```
派生建模 → 类型键 = **`Orders`**（不是 canonical `Order`），归域 sales，发布 + 物化 2 个对象：
```
materialize → {"jobId":"job_8jb63m8w2rv7ss77","created":2,"quarantined":0}
objects?type=Orders → [
  {"so":"RO-2001","model":"S192-PACK","qty":500,"due":"2026-09-01","cust":"北方储能","creditUsedRatio":0.6},
  {"so":"RO-2002","model":"L148-TRUCK","qty":120,"due":"2026-10-01","cust":"华东物流","creditUsedRatio":0.4}]
```

### 1.2 B3 复现：未绑定时求解器拒（真物化 ≠ 真答案）
```bash
curl -X POST $B/a/v1/solvers/order_fullchain/invoke -H 'X-Debug-User: realco:admin:admin' -d '{"args":{}}'
→ {"error":{"code":"VALIDATION_ERROR",
    "message":"order_fullchain 需先有 Order（配 SolverBinding role=order 指向租户真实订单类型，或合成 Order）"}}
```
上传的真 `Orders` 就在库里，但 canonical `Order` 为空 → 硬编码 `listByType(t,"Order")` 断链。**这就是 B3 命门。**

### 1.3 配 SolverBinding + 激活（RL4 人工确认）
```bash
# 创建（默认 DRAFT）
POST /a/v1/solvers/order_fullchain/bindings {"roleBindings":[{"role":"order","typeKey":"Orders"}]}
# DRAFT 时 invoke 仍拒（证明 DRAFT 不生效·RL4）：
POST /a/v1/solvers/order_fullchain/invoke → 仍 "需先有 Order"
# 激活：
POST /a/v1/solvers/order_fullchain/bindings/<id>/activate → {"status":"ACTIVE",...}
```

### 1.4 出真答案（读上传订单 RO-2001 真值）
再配 model/demandSegment 两角色（**fieldMap 映射非 canonical 字段名**）后激活：
```json
POST /a/v1/solvers/order_fullchain/bindings {
 "status":"ACTIVE",
 "roleBindings":[
  {"role":"order","typeKey":"Orders"},
  {"role":"model","typeKey":"Models","fieldMap":{"modelId":"code","bases":"plants"}},
  {"role":"demandSegment","typeKey":"Segments","fieldMap":{"segment":"seg","marginPct":"gm","floorPct":"gmFloor"}}
 ]}
```
```bash
curl -X POST $B/a/v1/solvers/order_fullchain/invoke -H 'X-Debug-User: realco:admin:admin' -d '{"args":{"so":"RO-2001"}}'
```
**真答案**（读上传订单 + 上传细分毛利真值）：
```json
{
 "so": "RO-2001",
 "verdict": "提价4%接",
 "kpis": { "qty": 500, "segment": "储能", "marginPct": 8, "floorPct": 12, "deliveryP90": 630, "kitGap": 0 },
 "conds": [ "毛利率 8% < 细分底线 12%（C15），提价 4% 达线" ],
 "summary": "订单 RO-2001（S192-PACK·500）结论：提价4%接；毛利率 8% < 细分底线 12%（C15），提价 4% 达线"
}
```
- `qty:500`、`cust:北方储能` = 上传订单真值；`marginPct:8`/`floorPct:12` = 上传 Segments 经 fieldMap（`gm`/`gmFloor`）读出；
- 结论「提价4%接」= 求解器对真值三闸判（8%<12% → 提价 ceil(12-8)=4%）。**同一 canonical 求解器代码零改，仅绑定不同。**

---

## ② demo 零绑定回退默认 canonical → 既有推演零回归（对比修前）

```bash
curl -X POST $B/a/v1/solvers/order_fullchain/invoke -H 'X-Debug-User: demo:admin:admin' -d '{"args":{}}'
```
```json
{
 "so": "SO-3391",
 "verdict": "不建议接",
 "kpis": { "qty": 8, "segment": "乘用车", "marginPct": 18, "floorPct": 12, "deliveryP90": 1890, "kitGap": 654 },
 "summary": "订单 SO-3391（4680-NCM·8）结论：不建议接；信用占用超限（C13），需先收款/降额；三元正极 缺口 654 吨（C06），最早齐套 2026-06-28"
}
GET /a/v1/solvers/order_fullchain/bindings → {"items":[]}   # demo 零绑定
```
demo 零绑定 → `resolveSolverType` 全回退 canonical `Order`/`Model`/`DemandSegment`/`MaterialBalance` → 走原硬编码等价路径。
**对比修前**：验收判据是「修前 demo order_fullchain 输出」与本输出**逐字段一致**（so/verdict/kpis/summary 均不变）——由 `test/solver-binding.test.ts`「demo 零绑定回退」用例 + 既有 `solvers.test.ts`/`sop-solvers.test.ts` 全绿共同保证（求解器计算路径对无绑定租户完全未变）。P0 红线：demo 零回归。

---

## ③ 两行业 R14（各绑各类型各出真答案，代码零改）

- **电池行业（demo）**：canonical `Order`/`DemandSegment` 直喂（零绑定回退），真结论「不建议接」（见 ②）。
- **储能上传（realco）**：绑 `Orders`/`Models`/`Segments`，真结论「提价4%接」（见 ①.4）。
- **物流行业**（`test/solver-binding.test.ts`「R14 两行业」用例）：绑同名自定义类型、商用车细分 18%≥10% → 真结论「可接」。
> 同一 `order_fullchain` 求解器**代码零改**，仅 SolverBinding 不同 → 各行业各出真答案（R14 去电池锁死）。

---

## ④ DF.8 接地（绑外部实体报错，绝不造实体）
```bash
POST /a/v1/solvers/order_fullchain/bindings {"roleBindings":[{"role":"order","typeKey":"GhostType"}]}
→ 400 "DF.8 接地失败：… 类型 'GhostType'（role=order）不在本租户已发布本体内"
POST … {"roleBindings":[{"role":"order","typeKey":"Orders","fieldMap":{"so":"ghostField"}}]}
→ 400 "DF.8 接地失败：… 字段 'ghostField'（role=order · canonical=so）不在类型 'Orders' 内"
```

## ⑤ RL4 建模发布后自动建议绑定草案（人工确认·不自动生效）
首次发布 `Orders`（canonical `Order` 不在本体内）后，`publishVersion` 自动产草案：
```json
GET /a/v1/solvers/order_fullchain/bindings → 含
{"id":"solvbnd_order_fullch…","status":"DRAFT","origin":"auto-suggest","roleBindings":[{"role":"order","typeKey":"Orders"}]}
```
确定性词表把 `order` role → 最相似类型 `Orders`（含 "order"），**DRAFT 不生效**，须人工 `activate`（RL4）。

---

## 门 + 回归
- `pnpm -r build`（4 包）全绿；`pnpm --filter datacore test` 全绿（新增 `test/solver-binding.test.ts` 8 用例：真答案/确定性/回退不回归/DF.8×2/回退一致性/R14 两行业/自动建议）。
- 新门 `solver-binding-determinism:check`（回退一致性 · DF.8 接地 · orderFullchain 去硬编码 · 缓存失效）通过。
- green→red 自证：把 `resolveSolverType` 的 canonical 回退删掉 → demo 用例即红（回退一致性断言失败）；把 orderFullchain 改回 `listByType(t,"Order")` → 门红。
