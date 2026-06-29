# A6 两尾巴收口 FDE 证据（电池收编 + 全服务 e2e）

> 来源：`docs/TODO-prd-pack.md` A6（拟真值域合成数据）的两个余项 → 补成 ✅。
> 红线：电池字节不变（R6 baseline 门守）；e2e 须真服务（非仅 vitest app.inject）。

## 尾巴① 电池收编（A6.3）✅ — generateBattery/generateExtended 走共享 sampleValueDomain，字节不变

**改动**：电池路连续值域字段从内联 `round(lo+rng()*range,p)` 改为调用与通用路同一个 `sampleValueDomain`
（显式 `shape:"uniform"` + `band:[lo, lo+range]` + 同 precision；uniform 分支公式 `round(lo+rng()*(hi-lo),p)` 与原式逐位一致·单次 rng 抽样）。
- `synthetic/battery.ts`：`util`（[0.62,0.97] p2）、`gwh`（[6,42] p1）。
- `synthetic/battery-extended.ts`：`carbonFactor/bomUnit/dailyUse/onHand/qty/creditLimit×2/amount/energyPerUnit/gridFactor`（10 字段）。
- **乘性 `unitPrice`=base×factor 因浮点运算次序不同会改字节 → 保留内联**（诚实边界，不强行收编）。

**字节不变验证（oracle）**：`pnpm --filter datacore test` → **144 passed | 1 skipped (145) · Tests 770 passed | 3 skipped**。
含 R6 字节标尺：`scale-baseline`（XL 同 seed 重跑订单/首单一致）、`synthetic`、`synthetic-field-alignment`、`a6-value-domains` 全绿
——即电池路收编**未改任何字节**（DoD「电池字节不变」满足），且电池路与通用路现共享单一值生成入口。

## 尾巴② 全服务 e2e ✅ — 真 HTTP socket（live datacore process，非 vitest app.inject）

**复跑**：
```bash
SEED_DEMO=1 SEED_A6_DEMO=1 CREDENTIAL_KEY=<64hex> JWT_SECRET=dev node apps/datacore/dist/server.js &
H='X-Debug-User: a6demo:u1:admin'
curl -H "$H" -X POST :4001/a/v1/synthetic/jobs -d '{"industry":"a6-reference","scale":"S","seed":42}'  # → 202
curl -H "$H" ':4001/a/v1/objects?type=Order&pageSize=100'   # 读 util
```
`SEED_A6_DEMO=1` 注册 `a6-reference` 参考行业模板（`Order.util` 走 `valueDomain domainKey=util shape=normal` + `autoPlant` 从 BLOCK 规则 `Order.util>0.95` 反推）到独立租户 `a6demo`（不污染 demo/内置下拉）。

**实测（真 curl 响应）**：
```
run1 POST /a/v1/synthetic/jobs → HTTP=202
GET objects: count=12 · in-band[0.62,0.95]=10 (≥8 ✓) · autoPlant crossings(>0.95)=2 (≥2 ✓)
  util: 0.70,0.73,0.75,0.77,0.79,0.81,0.84,0.84,0.9025,0.9025,0.9975,0.9975
run2（同 seed 重跑）→ 逐位一致 → ✓ R6 字节一致
```
判据全过：值落业务区间 ✓ · autoPlant 越线 ≥2 ✓ · R6 重跑一致 ✓ —— 全部在 **live datacore 进程 + curl 真 HTTP** 上达成（非 vitest）。

## 本体回写
§2.A `SyntheticJob`：「电池路 generateBattery 未改/收编为后续」→ 已收编（字节不变）+ 全服务 e2e ✅。
