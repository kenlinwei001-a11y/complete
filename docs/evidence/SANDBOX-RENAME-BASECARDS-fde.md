# SANDBOX-RENAME-BASECARDS — 真浏览器双页 FDE 实证

工单（P2·目标已纠偏·2026-07-05 转录#227）：
- ①『预判推演看板』(/v/risk) 视图标题 + nav 标签 改为『产能推演』（名实相符·闭用户两次追问）。
- ② 推演沙盘 /v/sim-sandbox 各基地状态卡默认可见（闭 SANDBOX-LAYOUT-REWORK 折叠致首屏零基地名回归）。

铁律 0.4：真起后端 + 真 Chromium 真渲染首屏 + 逐值对照后端真值·不作假。

## 环境（真实·非 mock）
- datacore `:4001` 内存模式 `SEED_DEMO=1`（seed 42·合成电池制造租户 demo）。
- 前端 `vite build`（`VITE_DATACORE_URL=http://127.0.0.1:4001`）+ `vite preview :5301`（真 SPA·跨域直连 datacore·CORS origin:true·登录 token 存内存 Bearer）。
- 真 Chromium `/opt/pw-browsers/chromium-1194`·真登录 admin/demo1234。**非 VITE_MOCK**：所有数据来自真 datacore REST。
- 复现脚本：`scripts/fde-sandbox-rename-basecards.mjs`（产出下列截图 + `SANDBOX-RENAME-BASECARDS-fde.json`）。

## ① `/v/risk` 改名『产能推演』（名实相符）
真值源：`VIEW_DEFS.risk.title`（datacore `synthetic/service.ts:1304` + 前端 `mocks/fixtures.ts:373` 同步）；nav 标签由 `title` 派生（workspace `navigation.map(v => ({key, label: v.title}))`）。

后端真值（真 datacore `GET /a/v1/me/workspace`·admin）：
- `views[risk].title = "产能推演"`
- `navigation[risk].label = "产能推演"`

真浏览器（`SANDBOX-RENAME-BASECARDS-risk.png`·fde.json.risk）：
- 左导 `nav-business` innerText 含「产能推演」= **true**；含「预判推演看板」= **false**。
- 页 body innerText 含「预判推演看板」= **false**（旧名全仓绝迹）。
- 左导「产能推演」项高亮（active）——点进 /v/risk 名实相符。
- 驾驶舱磁贴（/v/dash）含「产能推演」= **true** → 磁贴↔页面同名（`DashboardView.tsx:60` 早已叫产能推演，本单让页面追平）。
- 「推演沙盘」nav 标签**未动**（仍『推演沙盘』），项目沙盘推演未动。
- 诚实边界：本 seed 下 risk 板 `risk_timeline` 求解器返空（合成 demo 无真实测越线数据·KILL-MOCK-RED 诚实空态），故页面无风险卡——与改名无关（本单只做名实相符，红色接真数据是独立 #10 后端单）。

## ② 推演沙盘 `/v/sim-sandbox` 各基地卡默认可见
根因：SANDBOX-LAYOUT-REWORK(§5) 把状态卡收进右栏折叠卡栈（默认折叠）→ 整页首屏 body.innerText 零基地名。
修：各基地状态卡回**主区**（hero DAG 下方一行·`sandbox-base-cards`·**默认可见**·非右栏折叠卡）；数据源 `searchObjects("Base","")`（与 GeoMapView 同源·真 Base 对象）。util/oeeIndex 为分数（值域 0.62–0.97）→ ×100 显百分。

真浏览器（`SANDBOX-RENAME-BASECARDS-sandbox.png`·**不点任何折叠**·fde.json.sandbox）：
- 首屏 body.innerText 命中基地名 **12/12**：常州·成都·邯郸·合肥·江门·洛阳·眉山·武汉·厦门·信阳·枣庄·自贡。
- `sandbox-base-cards` 在 `sandbox-main-zone`（inMain=true）·不在 `sandbox-side-stack`（inSide=false）——主视觉不折叠。
- 逐值对照后端真值（`GET /a/v1/objects?type=Base` · 常州）：
  - 后端 `util=0.83` → 卡显「利用率 **83%**」✓；`oeeIndex=0.76429` → 「OEE **76%**」✓；`bottleneck=模组` → 「瓶颈 **模组**」✓；`gwh=36.7` → 「GWh **36.7**」✓。UI 卡文本 = `"常州 / 360→ / 利用率 83% / OEE 76% / 瓶颈 模组 / GWh 36.7"`，逐值 = 后端真值。
  - 「360→」链接 href = `/o/Base/changzhou`（对象 360 页·`href360Ok=true`）。
- 折叠记忆不受损：`sandbox-runstate-card` data-open = **0**（仍默认折叠·§5 渐进披露密度不破·基地卡走独立主区渠道不回潮）。

### 诚实边界（不作假·KILL-MOCK-RED 同源）
- 各基地卡真值来自真 Base 对象 props（util/oeeIndex/bottleneck/gwh·真合成租户对象库），非哈希/兜底。无 Base 对象的租户 → 诚实空态（`sandbox-base-cards-empty`）。
- 百分显示只做「分数(≤1)×100 / 百分数(>1)原样」两种真实表示口径归一，不造数。

## 牙齿（revert→red·亲验 EXIT=1）
- ① `test/risk-rename-capacity.test.tsx`（2）：ViewDef/nav 标签==『产能推演』+ 真渲染左导。revert `fixtures.risk.title`→旧名 → 2 红（EXIT=1 亲验）。
- ② `test/sandbox-basecards-rename.test.tsx`（2）：首屏 innerText 含常州/武汉 + 卡在主区带真值(83%)/360链接。revert（注掉主区 `<BaseStatusCards />`）→ 2 红（EXIT=1 亲验）。
- `test/sandbox-layout.test.tsx`（4·§5 折叠密度）仍绿（runstate 卡仍默认折叠·基地卡走独立主区渠道·未破渐进披露齿）。

## 截图
- `SANDBOX-RENAME-BASECARDS-risk.png` — /v/risk 页 + 左导『产能推演』高亮（旧名绝迹）。
- `SANDBOX-RENAME-BASECARDS-sandbox.png` — 推演沙盘首屏（主区「各基地状态 · 真 Base 对象」12 卡默认可见·真值 + 360→）。
- `SANDBOX-RENAME-BASECARDS-fde.json` — 机读断言全集。
