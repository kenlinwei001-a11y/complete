# WO-FAKE-05 · 堵根门加固 FDE（dataMode 值诚实·扁平合成标 LIVE 须被逮）

> P0·假推演铁律最高优先·审核方交还 dev 建（分权：reviewer 只复验不下场）。
> 源审计：`docs/AUDIT-solver-fake-residues.md`——「三道门都不守 dataMode 值诚实」是残口长期藏身的根。
> 残口本身（R1/R2 OEE/良率、R3 plan_rootcause 季/年、R4 riskHashN 责任人、R5 P90 haircut）已由 WO-FAKE-01/02/03/04（全 DONE）治本；
> 本单**只堵根**——加固两道门的牙齿，使**同类假推演未来自动被逮·防复发**（additive·不改任何求解器逻辑）。

## C1 · `check-no-fake-data.mjs` 扩 SMELL 信号（门盲区①）

**改**：SMELL 从只守全局 `hashString(` → `/\b\w*[Hh]ash\w*\s*\(/`（**任意 hash 命名函数**参与派生业务数值）——逮**本地 hash**（审计 R4 已删的 `riskHashN(base) % N` 造"谁负责"/占用比·FAKE-03 已治→防复发）。
- `createHash/digest`（Node crypto 去重·非业务量）+ id/version/bucket 入 LEGIT 豁免；注释行不算残口（诚实注释常记录"绝不再用 riskHashN(...)"）。
- **内置 gate自证**（门启动即跑）：`mustCatch`（3 类本地/全局 hash 造数）必被 SMELL 逮、`mustPass`（crypto dedup id / AB 分流 bucket）必被 LEGIT 放行——任一失守门自 `exit 2`（牙齿钝即红）。

**牙齿实证（端到端·真跑）**：
```
# 注入 risk.ts： const riskHashN=(x)=>...; function _fakeOwner(base){ return RISK_OWNER_NAMES[riskHashN(base) % 5]; }
$ node scripts/check-no-fake-data.mjs
✗ 新增未登记 LABELED（基线外）: apps/datacore/src/solvers/risk.ts:444   → exit 1（红）
# revert
$ node scripts/check-no-fake-data.mjs
✓ 无基线外的新 SUSPECT/LABELED                                          → exit 0（绿）
```
现状扫描面（solvers + frontend views）0 SUSPECT / 0 新 LABELED（残口已由 FAKE-01..04 清）。

## C2 · `genuine-sim §⑧b` 行为断言（门盲区②·「dataMode 值诚实」无门可守的根）

**改**：新增 §⑧b——真调 dist `riskTimeline`，构造两份**仅业务输入不同**的 SolverContext，断言 measured 因子的峰值张力 `peak` **随真输入变**；出了非空决策峰值却两份相同 = 与真输入零耦合的**扁平冒充**（审计 R1/R2 病）→ 红。补上"声称 measured/LIVE 的值必须随真输入变，否则须读真属性或诚实标 PARTIAL"这道语义门。覆盖 **设备OEE**（改 `Equipment.oee_current`）+ **良率波动**（改 `Process.yield_baseline`）。

**当前 honest-LIVE 通过（FAKE-01 后 OEE/良率读真属性·值随输入变）**——真跑实测：
```
riskTimeline(设备OEE)  oee=[0.90,0.90,0.90] → peak=52    oee=[0.50,0.55,0.52] → peak=98   ✓ 随输入变
```
**牙齿实证（端到端·真跑）**：
```
# 把 dist OEE 分支改成忽略 oee_current 返回常量 78（扁平标 LIVE 回潮）
$ pnpm genuine-sim:check
✗ C2 dataMode值诚实：riskTimeline(设备OEE) 峰值 78 不随真输入 Equipment.oee_current 变（扁平冒充…）  → exit 1（红）
# revert
$ pnpm genuine-sim:check
✓ genuine-sim:check 通过                                                                          → exit 0（绿）
```

## C3 · CI 绿 + 母体 §7 登记

- 两门均已在 `pnpm gates` + 本体 §7 登记（扩既有门·无新增门名）；§7 两条目追加 WO-FAKE-05 C1/C2 堵根说明 + 牙齿实证；`ontology-writeback:check` ✓、`ontology-slices:check` ✓（母体 hash 7f7bed84）。
- `no-fake-data:check` ✓ exit 0 · `genuine-sim:check` ✓ exit 0 · 完整 `pnpm gates` EXIT=0。

## 结论
三门盲区中的两道（hash 信号窄 / dataMode 值诚实无门）已堵：**任意 hash 造业务值** + **声称 measured 却与真输入零耦合的扁平冒充**，未来一出现即被门自动逮红。additive·未改任何求解器逻辑·牙齿双向自证（inject→红 / revert→绿）。
