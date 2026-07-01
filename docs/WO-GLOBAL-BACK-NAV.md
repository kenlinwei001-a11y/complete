# WO-DrillBackAffordance · 全局二级/下钻页统一回退

> 由来：REQ-LEDGER R17「二级页普遍缺回退(1650/6229/6337)」现状 ◐——`docs/REQ-LEDGER.md:43`「OrderChain有回退(R7 U3)·**全局其他二级页未普查**」；本体 R17 决策单页宪法 `docs/SYSTEM-ONTOLOGY.md:391`（就地下钻不跳页，跳页则必可回）。依赖：`react-router-dom`（`useNavigate`/`useLocation`，已在用）、`zh.common.back`（`apps/frontend-shell/src/locales/zh.ts:18` 已存在=「返回」）。范式已落地页 `OrderChainView.tsx:62,141-147`。

## §0 目标 + DoD-as-experience

**目标**：凡「整页下钻」（`navigate("/...")` 推入新路由、脱离来源上下文）落地的页，都有一致的「‹ 返回」回退，让用户「进得去也回得来」，不再走进死路。抽出一个统一 `<DrillBack>` 组件替代各页手搓，逐页补齐死路页。

**DoD（用户亲手走一遍·非测试绿）**：
1. demo/admin 登录 → 经营驾驶舱台账点某订单行 → 进「订单全链聚合」→ 左上「‹ 返回」→ **回到驾驶舱原滚动位**（此页已有，作回归基线）。
2. 全局搜索（顶栏）搜任一对象 → 进「对象 360」→ 左上出现「‹ 返回」→ 点击**回到搜索前的页**（本次新增，当前是死路）。
3. 顶栏 🕐 历史 → 点某条 → 进「任务详情 `/tasks/:id`」→ 左上「‹ 返回」→ **回到历史面板所在页**（本次新增，当前是死路）。
4. 地理地图/季度滚动 → 「查看风险」下钻进「风险看板 `/v/risk?focus=`」→ 「‹ 返回」→ 回到地图（本次新增）。
5. 连接器上传 → 进「字段核对 `/:connId/schema`」→ 回退（此页有 hardcode 父级链接，**改成真历史回退**，保持一致）。
6. 浏览器**物理后退键**行为不被破坏（`navigate(-1)` 与浏览器后退语义一致）。

## §1 现状盘点（钉真实 file:line，grep/read 核实）

唯一真回退范式（`OrderChainView.tsx:142-147`，可直接抄）：
```tsx
<div data-testid="order-chain-breadcrumb" style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, fontSize:12, color:"var(--muted)" }}>
  <button className="badge" data-testid="order-chain-back" style={{ cursor:"pointer" }} onClick={() => navigate(-1)}>‹ 返回</button>
  <span style={{ cursor:"pointer" }} onClick={() => navigate("/v/dash")}>经营驾驶舱</span>
  <span style={{ color:"var(--muted2)" }}>›</span>
  <b>订单全链聚合</b>
</div>
```

| 页 / 路由 | 落地文件:line | 从何下钻（来源实证） | 回退状态 |
|---|---|---|---|
| 订单全链 `/v/order-chain` | `views/plan/OrderChainView.tsx:143` | `DashboardView.tsx:165,241`、`ProvenanceDag.tsx:102` | ✅ 已有 `navigate(-1)`（范式） |
| 逐日拆因（页内 level 切换，非路由） | `DashboardView.tsx:568,582,595` | 页内 `setView` | ✅ 页内回退（不涉路由，非本次对象） |
| 字段核对 `/admin/connections/:connId/schema` | `pages/admin/FieldProfilePage.tsx:172` | `ConnectionsPage.tsx:64`、`DataCategoriesPanel.tsx:58` | ◐ 硬编码 `<Link to="/admin/connections">` 固定父级，非历史回退 |
| **对象 360 `/o/:typeKey/:objectKey`** | `pages/Object360Page.tsx:66-79`（header 无 back） | `GlobalSearch.tsx:35`、`ProvenanceDag.tsx`、`Object360Page.tsx:115` 自跳 | 🔴 缺（**溯源链终点·最该有**；已 import useNavigate 仅用于外跳） |
| **任务详情 `/tasks/:taskId`** | `pages/TaskDetailPage.tsx:38-43`（header 无 back） | `HistoryPanel.tsx:22,71`、`QueryHistoryPage.tsx:23,70` | 🔴 缺（连 `useNavigate` 都未 import） |
| **风险看板 `/v/risk?focus=`** | `views/RiskBoardView.tsx`（无 `navigate(-1)`/返回） | `GeoMapView.tsx:227`、`QuarterlyRollingView.tsx:42`、`OntologyGraphView.tsx`… | 🔴 缺（`?focus=` 下钻态无回退；无 focus 时从左导航进=不需要） |
| **地理地图 `/v/geo-map`（drill 去向）** | `views/plan/GeoMapView.tsx`（无 back） | 自身是 drill 源，但也可被别页跳入 | 🔴 缺 |
| **季度滚动 `/v/quarterly*`** | `views/plan/QuarterlyRollingView.tsx`（无 back） | drill 源；`navigate(/v/risk…)` | 🔴 缺 |
| **本体图谱 `/v/graph?focus=`** | `views/OntologyGraphView.tsx`（无 `navigate(-1)`） | `GeoMapView.tsx:230` `?focus=n-base` | 🔴 缺（focus 下钻态） |
| **来源系统总览 `/admin/source-overview`** | `pages/admin/SourceSystemOverviewPage.tsx`（`grep 返回/navigate(-1)=0`） | `BoardHeader.tsx:80` 域下钻、健康徽章链 | 🔴 缺 |
| **发育驾驶舱 `/admin/growth`** | `pages/admin/GrowthCockpitPage.tsx`（=0） | 从别页/徽章跳入 | 🔴 缺 |

核实要点（防编）：
- 全仓 `navigate(-1)` **仅 1 处**：`OrderChainView.tsx:143`（`grep -rn "navigate(-1)"`）。
- **无共享回退组件**：`components/` 下无 `Back*`/`*Breadcrumb*`/`*Crumb*`（`ls`/`find` 空）；OrderChain 是手搓 inline。
- `DataBuilderPage.tsx:880,883` 的「返回」是异步按钮 **tooltip 文案**（`title=…立即返回…`），非回退，排除。
- ShellLayout 有 `<header className={styles.topbar}>`（`ShellLayout.tsx:259`）与 `<Outlet/>`（:306），`useLocation` 已在用（:216）——但下钻回退是**页级上下文**，放页内比塞进全局 topbar 更准（topbar 是跨页固定 chrome）。

## §2 施工范围（dev 直接照做）

### 2.1 新建统一组件 `apps/frontend-shell/src/components/DrillBack.tsx`
契约（props）与行为：
```tsx
import { useNavigate } from "react-router-dom";
import zh from "@/locales/zh";

export interface Crumb { label: string; to?: string } // to 省略=纯文本当前页

/**
 * 统一下钻回退（R17：整页下钻必可回）。范式承 OrderChainView.tsx:142-147。
 * back 默认 navigate(-1)（真历史回退，与浏览器后退一致）；无历史时 fallbackTo 兜底。
 */
export function DrillBack({ trail = [], fallbackTo, testId = "drill-back" }: {
  trail?: Crumb[];        // 面包屑（末项通常为当前页，无 to）
  fallbackTo?: string;    // 直达/刷新落地（history 无前一页）时的兜底目的地
  testId?: string;
}) {
  const navigate = useNavigate();
  const onBack = () => {
    // window.history.state.idx==0 → 本页是历史栈首（直链进入），navigate(-1) 会退出应用，故走 fallback
    const idx = (window.history.state && (window.history.state as { idx?: number }).idx) ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallbackTo ?? "/");
  };
  return (
    <div data-testid={`${testId}-bar`} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, fontSize:12, color:"var(--muted)" }}>
      <button className="badge" data-testid={testId} style={{ cursor:"pointer" }} onClick={onBack}>‹ {zh.common.back}</button>
      {trail.map((c, i) => (
        <span key={i} style={{ display:"contents" }}>
          {c.to
            ? <span style={{ cursor:"pointer" }} onClick={() => navigate(c.to!)}>{c.label}</span>
            : <b>{c.label}</b>}
          {i < trail.length - 1 && <span style={{ color:"var(--muted2)" }}>›</span>}
        </span>
      ))}
    </div>
  );
}
```
关键：`window.history.state.idx`（react-router 维护）判是否直链落地，避免 `navigate(-1)` 退出站点——比 OrderChain 裸 `navigate(-1)` 更稳（可顺带把 OrderChain 迁到此组件，行为不变）。

### 2.2 逐页补齐清单（每页在渲染树最顶插一行 `<DrillBack .../>`）
- `pages/Object360Page.tsx`：`header`（:68）**上方**插 `<DrillBack fallbackTo="/scenarios" testId="o360-back" trail={[{label: display}]} />`（已 import `useNavigate`，可删自建改用组件）。
- `pages/TaskDetailPage.tsx`：`<div style={{maxWidth:920}}>`（:39）内、`<h2>`（:40）前插 `<DrillBack fallbackTo="/" testId="task-back" trail={[{label: zh.task.title}]} />`（本文件新引组件即可，无需自 import useNavigate）。
- `views/RiskBoardView.tsx`：仅当 `searchParams.get("focus")` 存在时渲染 `<DrillBack testId="risk-back" trail={[{label:"风险看板"}]} />`（无 focus=从左导航进，不显，避免污染顶层视图）。
- `views/plan/GeoMapView.tsx`、`views/plan/QuarterlyRollingView.tsx`、`views/OntologyGraphView.tsx`：同 RiskBoard 策略——**下钻上下文（有 `?focus=`/来源参数）才显**；纯顶层入口不显。
- `pages/admin/SourceSystemOverviewPage.tsx`、`pages/admin/GrowthCockpitPage.tsx`：页顶插 `<DrillBack fallbackTo="/admin/catalog" />`（admin 域二级页，兜底回目录）。
- `pages/admin/FieldProfilePage.tsx:172`：把 `<Link to="/admin/connections">← {zh.common.back}</Link>` 换成 `<DrillBack fallbackTo="/admin/connections" testId="fieldprofile-back" />`（保留 connections 作兜底，但优先真历史回退，行为更一致）。

### 2.3 locale
`zh.common.back` 已存在（`locales/zh.ts:18`=「返回」），无需新增 key。面包屑各页 label 复用现有 `zh.*.title`。

### 2.4 决策：为何不放全局 topbar
下钻回退是**从哪来回哪去**的页级语义；`ShellLayout` topbar（:259）是所有页共享 chrome，塞进去需反推来源、易误显（顶层视图不该有返回）。故按 R17「就地」原则放**页内顶行**，与既有 OrderChain 范式一致。

## §3 验收（FDE 亲手·curl + 真浏览器 + 门）

**门（先绿）**：
```bash
pnpm --filter frontend-shell typecheck
pnpm --filter frontend-shell lint
pnpm --filter frontend-shell build
pnpm --filter frontend-shell test   # 基线 25+ 不掉；新增组件加 1 用例（idx>0→navigate(-1)、idx=0→fallbackTo）
```

**真浏览器（VITE_MOCK=1 或 docker 起全套，登录 demo/admin/demo1234）**：
1. 顶栏搜索 → 对象 360：断言 `[data-testid="o360-back"]` 可见，点后 URL 退回搜索前路径。
2. 顶栏 🕐 → 任务详情：断言 `[data-testid="task-back"]` 可见且返回。
3. 地图 → geo-goto-risk（`GeoMapView.tsx:227`）→ 风险看板：`[data-testid="risk-back"]` 可见；直接访问 `/v/risk`（无 focus）时**不显**返回。
4. 连接器上传 → 字段核对 → `[data-testid="fieldprofile-back"]` 回退到 connections。
5. 物理浏览器后退键在以上每页与「‹ 返回」结果一致。
6. 直链粘贴 `/o/<type>/<key>` 到地址栏刷新 → 点返回**不退出站点**（走 `fallbackTo=/scenarios`）——验 idx 兜底。

**curl（后端不涉本 WO，仅确认下钻数据源在，页非空）**：
```bash
# 对象 360 数据（OBO/X-Debug-User）
curl -s -H 'X-Debug-User: demo:admin:admin' \
  'http://127.0.0.1:4001/a/v1/objects/<typeKey>/by-key/<objectKey>' | head
# 任务详情
curl -s -H 'X-Debug-User: demo:admin:admin' \
  'http://127.0.0.1:4002/api/v1/tasks/<taskId>' | head
```

## §4 不在本次范围（诚实边界）

- **页内状态回退**（`DashboardView.tsx:568/582/595` 的 level `setView`）：非路由跳转，已自带页内「← 返回逐日拆因」，不动。
- **admin 顶层管理页**（从左导航 UnifiedNav 直达的 CRUD 页，如 Rules/Users/Features…）：非「下钻落地」，R17「非决策 CRUD 页从宽」，本次不铺回退。
- **登录/首页/场景启动器**：入口页非二级页。
- 不改任何路由表（`App.tsx:114` routes 对外不可变更）、不改后端、不改 nav 结构。
- 不做面包屑「多级完整路径」重建（仅当前页 + 返回；深多级留后续）。

## 本体引用与影响（链路/对象类型/不变量/断点/回写）

- **不变量**：R17 决策单页（`SYSTEM-ONTOLOGY.md:391`）「就地下钻不跳页；跳页则须可回」——本 WO 是 R17 在「已跳页场景」的兜底补全（17.4 就地下钻的回程保障）。不违 R14（零业务常数：组件无行业常量）、不触 R1–R16。
- **链路/对象类型/事件**：纯前端导航 chrome，**不新增/不改**任何链路、对象类型、`sim.*`/`*.updated` 事件、契约、门禁——故**无需回写本体 §2/§3/§4/§7**。
- **断点**：不涉 G-1…G-11 接缝。
- **回写**：本 WO 不改链路/事件/对象/不变量/门 → **不回写 `SYSTEM-ONTOLOGY.md`**；仅落地后把 `docs/REQ-LEDGER.md:43` R17 从 ◐ 更新为覆盖清单已闭（普查已做、死路页已补）。

*审核方自包含施工单(design+review·铁律0.5·钉真实file:line)· 仅推 claude/vigilant-knuth-b1nmxn · 模型标识不入任何提交物*
```
