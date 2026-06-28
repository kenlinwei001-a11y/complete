# FDE 实拍：G-9 发育闭环招牌「缺件卡→自动补→GOVERNED 活体」真发生

**日期**：2026-06-28 · **分支**：`claude/vigilant-knuth-b1nmxn` · **真双服务**（datacore 4001 + agentcore 4002，SEED_DEMO，LLM mock）

## 解决的根本问题（铁律0·仿真实际业务·非省非快）

此前 G-9 招牌「缺件卡→自动补→GOVERNED」**活体从不发生**（本体 §8 自述 + 2026-07 评审打回）。真双服务诊断坐实**多根**：
- demo 卡预播数据 → 首验即 GOVERNED（不走 grow，非招牌路径）；
- **缺件卡（空租户）无对象世界** → 卡的预设对象/槽位填不上 → 路由落 path-B、gapCode OTHER（不在 auto-derive 集）→ grow 不触发；
- 即便触发，**单类型 `fillData`（通用 6 行）无法重构 solver 级一致世界** → 重验仍空。

根因 = **租户无一致对象世界**。根因解（非省/快）：发育 fill 探测"世界全空"→ 经 **datacore 真合成正门** `synthetic.runJob` 一次性 provision **确定性、FK 一致、可溯源（SYNTHETIC origin）** 的起步世界（industry 由 datacore 据租户配置派生 → agentcore 零行业常数 R14；**仅入空租户、非空拒执行不 clobber 真数据**）。世界 ready 后：槽位可填 → 确定性绑定 → path-A 工作流 → 求解器真投影 → 重验 dataOk → GOVERNED。

## 改动
- `probe.ts classifyGap`：对齐 verifyScenario 诚实门（dataBearing）——空投影 → EMPTY_DATA，消除"零补齐假收敛"。
- datacore `POST /a/v1/growth/provision-world`：空租户经合成正门 provision 一致世界（guard：existingObjects>20 拒绝）。
- agentcore `provisionWorld` 客户端 + `scenario-grow.ts` fill：世界全空 → 自动 provision（任一可补缺口首轮先过此门）。
- `server.ts growScenario`：首验未过且租户世界全空 → 触发 runGrowthLoop（fill 首轮 provision → 重跑路由归位 → 收敛 → 重验 → GOVERNED）。

## 亲手用一遍（真双服务实测）

| 检查 | 命令 | 结果 |
|---|---|---|
| **招牌活体**：全新空租户 grow capacity_feasibility | `POST /b/v1/scenarios/capacity_feasibility/grow`（X-Debug-User: g9world…） | ✅ **maturity=GOVERNED**·path=WORKFLOW·VERIFIED·answer「主要瓶颈…P50 产能=5.1836GWh ⟦ref:0⟧」 |
| 同租户 2nd 卡（世界共享） | grow risk_root_cause | ✅ GOVERNED·path WORKFLOW |
| **无回归**：demo 预播卡 | grow risk_root_cause（demo） | ✅ 仍 GOVERNED |
| **安全门**：非空租户拒 provision | `POST /a/v1/growth/provision-world`（demo，469 对象） | ✅ provisioned=false·reason=TENANT_NOT_EMPTY（不 clobber 真数据） |

闭环：空租户首验 path-B/OTHER → 检测世界全空 → 触发 grow → fill 经正门 provision 一致世界（SYNTHETIC·R6）→ 重跑确定性绑定 path-A → capacity_forecast 真投影（P50 5.18GWh，⟦ref⟧ 溯源）→ 重验 dataOk → **GOVERNED**。

## 诚实边界（不夸大）
- 招牌对**空/新租户**（SYNTHETIC 可合成场景）真发生：自动 provision 一致起步世界。
- **HARD 真实业务数据缺口**（真人正门导入的真数据）仍走 `decideDataGap` HARD → DataRequest 人工导入，**不自动合成真业务数据**（守诚实门）；非空租户 provision 拒执行。
- 即"新租户开箱自助 onboarding 自动补可达 GOVERNED；真数据补齐仍需人工正门"——符合真实业务边界。

## 前端接线：场景管理台「一键长出此卡」（真后端真浏览器实拍）

`ScenesPage`（`/admin/scenes` 场景入口配置）每张卡一颗 **「一键长出此卡」** 按钮 → 调 `growScenario`
（即上述发育闭环：空租户自动 provision → 验证 → GOVERNED）。结果落 **发育留痕**（三环✓/验证状态/路径/
答案预览·看完整溯源链）+ **发育闭环行**（触发自动补齐·终态·轮次·`经合成正门 provision N 对象起步世界` 当 provisionedObjects>0）。
契约 `ScenarioOntogenesisRun += growth{triggered,terminalState,rounds,provisionedObjects}`，前端据此渲染"长出"故事。

实拍 `docs/evidence/g9-grow-ui-fde.png`（真后端 demo）：20 卡均显「一键长出此卡」；点 S01 →
徽章「已验证·可用」+ 留痕三环全✓·VERIFIED·WORKFLOW·答案预览「P50 产能=5.1836GWh ⟦ref:0⟧⟦ref:1⟧⟦ref:2⟧」+ toast「已长出：发育验证通过·可用」。
（demo 预播租户 provisionedObjects=0 故走标准"已长出"；provision N 对象留痕行在**空租户**长出时渲染。）

## 真·空租户端到端浏览器实拍（招牌全链·非 curl）

为浏览器端到端坐实招牌，加 env 门 `SEED_EMPTY_TENANT=1`（dev/demo）：建**可登录但对象世界全空**的租户
`fresh`（admin/demo1234·industry=battery·**不跑合成**），镜像"新租户刚开通还没数据"开箱态。

实拍 `docs/evidence/g9-grow-empty-tenant-fde.png`（真双服务 + 真浏览器，登录 **fresh** 租户）：
- 顶栏「新租户 (fresh·空世界开箱)」· 登录前 `GET /objects?type=Line` = **0**（世界全空）。
- 场景管理台点 S01「一键长出此卡」→ 徽章 **「已验证·可用」**（GOVERNED）。
- 发育留痕：三环全✓ · **VERIFIED·路径 WORKFLOW** · 答案预览「P50 产能=5.1836GWh ⟦ref:0⟧⟦ref:1⟧⟦ref:2⟧」·
  **发育闭环：触发自动补齐（CONVERGED·2 轮）· 经合成正门 provision 469 对象起步世界（SYNTHETIC·可溯）**。
- toast「已长出：自动 provision 469 对象起步世界 → 已验证可用」。

即：空租户 → 一键长出 → 后端探测世界全空 → 合成正门 provision 469 对象一致世界 → 路由归位 path-A →
求解器真投影 → 重验 dataOk → GOVERNED，**全链浏览器可见**（招牌不再只 curl 证）。
