# WO-RISK-FIX · FDE 亲手真跑证据（旗舰预判失真 + 采纳CTA 400 + object-types 死按钮）

> 真起三服务（datacore4101 / agentcore4102 / 前端4103·登录 demo/admin）+ Playwright chromium 真浏览器逐面验证。

## bug①（/v/risk 旗舰预判看板失真·修 KILL-MOCK-RED 顶层门对 LIVE 卡的过度抑制回归）

**根因（curl 坐实）**：`risk_timeline`（LIVE 请求）返 **顶层 dataMode=SYNTHETIC**（demo 对象合成）但**每卡 dataMode=LIVE / hasData=true / crossDay=3,3,4,5,13,14…**（后端由真实测 OEE `liveTightness` 算）。`cardDecisionMode = topLive && …` 因 topLive=false（顶层 SYNTHETIC）把**所有 LIVE 卡强制 MUTED** → "未越线"+火柴图平+"估算·无实测"。

**修**：`cardDecisionMode` 改**逐卡**——`hasData===false`→MUTED；`dataMode==="LIVE"`→LIVE（真实测·顶层合成不能抹）；`dataMode==null`→随 topLive（兼容旧 fixture）；显式 MOCK/SYNTHETIC→MUTED。crossDay/火柴图/实测徽标皆 key off `live`，一并复真。planRows 仍 topLive 门（不动 不作假红线）。

**真浏览器实证**（`docs/evidence/screens/rf-risk.png`）：`hasCrossDay=true`（D+N 出）· `hasEstimate=false`（无"估算·无实测"）· `实测` 徽标在 · **11 处 var(--danger) 真红越线**渲染。对照 `risk-board-kill-mock-red.test.tsx` 4 用例仍绿（MOCK/hasData=false 卡仍不出红·不作假守住）+ 新 `risk-live-under-synthetic.test.tsx` 2 用例（顶层 SYNTHETIC+卡 LIVE→D+4 红；MOCK 卡→MUTED）。

## bug②（/v/order-chain 采纳结论CTA 必 400·唯一决策落地按钮）

**根因（curl 坐实）**：`ofc-adopt` 提 `plan_change` 漏必填 `versionId` → `POST /a/v1/action-drafts` 返 `VALIDATION_ERROR: payload.versionId is required`（400·不落库）。

**修**：查 `/a/v1/plan-versions/current` 携 `versionId ?? "plan-baseline"`（复用 PlanAuditView/Generate 既有 fallback·demo current 为 BASELINE·versionId=null）入 payload。curl 证 `versionId="plan-baseline"` → 200 draftId 建成（PENDING_APPROVAL）。

**真浏览器实证**（`rf-order-chain.png`）：采纳 CTA 可点（非 disabled）→ 点击 → 监听 POST `/action-drafts` 返 **201**（真落库·非 400）。

## bug③（/admin/object-types「看实例」死按钮×35）→ 查实 **stale/误报**（非缺陷）

**真浏览器实证**（`rf-object-types.png`）：35 个 `ot-instances-*` 按钮**全 enabled**（demo 各类型有真实例·Base count=12）→ 点击 → **实例弹窗开**（`ot-instance-close` 在）+ **12 条 `ot-inst-link-*` 真链接**（→ `/o/:typeKey/:objectKey`）。按钮 `onClick={setSelected}` 本就接线、仅 `count===0` 空类型 disabled（合理·非死按钮）。scan 所述"onClick 未接线·no-op×35"与现码不符——**判定 stale**（早前构建已修/scan 环境差异），本轮不改代码、如实记录（不擅自当非 bug·已真浏览器证伪）。

## 门 + 一致性

- 四包 build+test+gates 见提交贴绿；frontend +risk-live-under-synthetic（2）+ 既有 risk-board-kill-mock-red（4 绿·不作假守住）。
- 前后端逐值对照：risk crossDay(D+3/4/5…)==后端 card.crossDay·采纳 CTA 201==后端 draft 落库·object-types 12 实例链接==后端 Base count=12。

## 本体回写

`docs/SYSTEM-ONTOLOGY.md` §8 G-DM-1：追加 RISK-FIX bug①（逐卡 dataMode 门·顶层合成不抹真实测卡·与 planRows topLive 门并存）。

## 诚实边界

- bug① 逐卡门：仅**卡自报 LIVE** 才出红（真 OEE 派生）；顶层合成披露横幅（risk-confidence-banner）仍在——诚实标"本推演置信度"。
- bug③ 未改代码（stale）——若审核方真浏览器复验仍见死按钮，请回帖具体点法/类型，我再定位（当前 35/35 enabled + 弹窗 + 12 链接 均真跑通过）。
