import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { fetchScenarioCards } from "@/api/endpoints";
import { useWorkspace } from "@/workspace/useWorkspace";
import { featureOn } from "@/workspace/featureGate";
import { NAV_GROUPS, isRouteRefHidden, isViewConsolidatedAway } from "@/pages/ShellLayout";
import { EVENT_GUIDES } from "@/config/eventGuidance";
import { useScenarioLaunch } from "./useScenarioLaunch";
import { rankHotScenarios } from "./rankHotScenarios";
import zh from "@/locales/zh";

/**
 * 首页（场景启动器 §3.5-C）：高频场景区（一键启动）+ 遇事指引区 + 业务视图快捷入口。
 * 高频场景 = 按角色可达落点视图分层排序的前 6 张（落点在本角色可达导航内的优先；
 * "按角色"派生自服务端按角色计算的 navigation，故不同角色得到不同高频卡，R14 无硬编码）。
 */

/**
 * WO-HOME-ENTRY-FLOW · **首页把 `kind:"route"` 的导航项也铺出来**。
 *
 * ══ 病因（真浏览器实测 · 真后端 SEED_DEMO=1 · 禁 VITE_MOCK · 2026-09-07）═══════════════
 *
 * **今天的行为（X）**：首页只渲染 `workspace.navigation`（本文件下面那句 `views` 过滤），
 *   而 `workspace.navigation` **只装得下 `kind:"view"` 的项** —— 后端下发什么就有什么。
 *   左导航（`ShellLayout.UnifiedNav`）却认**三种** kind，其中 `kind:"route"` 的设计意图
 *   **恰恰是不依赖后端下发**（`App.tsx` 静态段先于 `:viewKey` 匹配，免下发即可达，
 *   见 `NavItemRef` 定义处那段长注）。两边的集合从根上就不同 ⇒ 实测：
 *   首页 **33** 项、侧栏业务类 **18** 项，而**侧栏有、首页没有**的正好是三个 route 项：
 *   **统一推演控制台 / 推演沙盘 / 事件影响与对策**。
 *   金丝雀（证明这把尺子是活的、不是我数错）：同一段代码量「经营驾驶舱」= **命中**。
 *   代价是实的：统一推演控制台是主流程起点，用户在首页**找不到它**，必须把视线切到侧栏
 *   （取证方那次动线就卡在这一步）。
 * **应该的行为（Y）**：凡左导航给了入口的业务屏，首页一定也有 —— 首页 ⊇ 侧栏业务项。
 *
 * ══ 为什么读 `NAV_GROUPS` 而不是在首页再写一份三个键的清单 ═════════════════════════
 *
 * 再写一份 = **第二份真相源**，本仓最恨这个：下次谁在 `NAV_GROUPS` 里加/删一个 route 项，
 * 首页这份不会跟着变，于是「侧栏有、首页没有」这个病**换个键再犯一次**，而且没有任何东西会说话。
 * 读同一张表则天然同步：`NAV_GROUPS` 里加一个 route，首页下次渲染就有。
 *
 * ⚠ **显隐规则必须与 `UnifiedNav` 逐字相同**，两条语义正好相反、不许混（见 `NavItemRef` 定义处）：
 *   · `feature`（暗发键）**关** → 隐藏 —— R3「功能关闭 = 不存在」，连入口都不许泄露存在性；
 *   · `consolidatedWhen`（收编键）**开** → 隐藏 —— 功能还在，入口搬进那个控制台里了，单列 = 重复入口。
 *   抄反任何一条，首页就会出现「侧栏没有、首页有」的反向不一致，比现在这个病更难查。
 *
 * ✅ **WO-HOME-CONSOLIDATE-PARITY 已把「逐字相同」升级成「同一个函数」**：上一版这一段是
 *   靠人守的纪律（本文件自己抄了一份 filter 链），而**这条反向不一致当时就真的存在**
 *   —— 只是发生在 `kind:"view"` 那一半（见下面 `HomePage` 里 `views` 那行的长注）。
 *   判定本体现在只有一份：`isRouteRefHidden` / `isViewConsolidatedAway`，两面都调它。
 *
 * ⚠ testid 沿用 `home-view-<key>` **不另起一套**：判据 3（反向对照·一项都不许丢）与
 *   判据 4（金丝雀）用的都是 `[data-testid^="home-view-"]` 这把尺子。route 项换个前缀
 *   就会**量不到**，于是「加上了」和「没加」在屏上一模一样 —— 那正是本单要修的病的形态。
 *   route 的键与 33 个 view 键无交集（实测），不会撞。
 */
type HomeRouteEntry = { key: string; label: string };
export function routeEntriesForHome(workspace: Parameters<typeof featureOn>[0]): HomeRouteEntry[] {
  return NAV_GROUPS.flatMap((g) => g.items)
    .filter((it): it is Extract<(typeof NAV_GROUPS)[number]["items"][number], { kind: "route" }> => it.kind === "route")
    .filter((it) => !isRouteRefHidden(it, workspace))
    .map((it) => ({ key: it.key, label: it.label }));
}

/**
 * WO-HOME-CONSOLIDATE-PARITY · **首页的 `kind:"view"` 项也必须跑收编过滤**。
 *
 * ══ 病因（实测 · 2026-09-08）══════════════════════════════════════════════════════
 * **今天的行为（X）**：首页对后端下发项只做了 `n.group !== "admin"`，
 * 而侧栏（`UnifiedNav`）在**同一份** `workspace.navigation` 上还多跑了一层收编过滤。
 * 两处的输入逐字相同（都是 `workspace.navigation.filter(group !== "admin")`），
 * 差别**只在这一层** ⇒ 侧栏主动藏起来的项，首页照列：实测首页独有 **11** 项。
 * 用户看到的是：同一条业务判断，两个面给出相反的答案 —— 侧栏说「这已经在统一推演控制台里了，
 * 单列 = 重复入口」，首页说「来，这里还有一个入口」。
 * **应该的行为（Y）**：收编是业务判断不是组件私事，凡铺入口的面都跑同一条过滤。
 *
 * ⚠ **11 不是 4**：`consolidatedWhen` 只是收编的**一半**。另一半是
 * `CONSOLIDATED_INTO_SANDBOX` 的**无条件收编**（那五个沙盘子视图，entitlement 本就
 * `requires: ["sim.sandbox"]`）。只修带 `consolidatedWhen` 的那 4+2 项 ⇒ 另外 5 项照漏，
 * 而且漏得**看不出来**（首页少了 6 个、还剩 5 个不一致，屏上看起来「修好了」）。
 * 故这里调的是 `isViewConsolidatedAway` 整条判定，不是只挑其中一个字段。
 *
 * ⚠ **不许在这里写死键清单**：写死了下次谁往 `CONSOLIDATED_INTO_SANDBOX` 或
 * `NAV_GROUPS` 加一项，首页这份不会跟着变 —— 本病换个键再犯一次，且没有任何东西会说话。
 */
function businessViewsForHome(
  navigation: { key: string; label?: string; viewKey?: string; group?: string }[],
  workspace: Parameters<typeof featureOn>[0],
) {
  return navigation.filter((n) => n.group !== "admin" && !isViewConsolidatedAway(n.viewKey ?? n.key, workspace));
}

export default function HomePage() {
  const { data: workspace } = useWorkspace();
  const { data } = useQuery({ queryKey: ["b", "scenarios", "cards"], queryFn: () => fetchScenarioCards() });
  const launch = useScenarioLaunch();
  if (!workspace) return <div className="empty-state">{zh.common.loading}</div>;

  // 铺入口用**收编过滤后**的集合（与侧栏同源，见 businessViewsForHome 的长注）。
  const views = businessViewsForHome(workspace.navigation, workspace);
  /**
   * ⚠ 高频场景排序用的是**未过滤**的可达集，刻意与上面那行不同 ——
   * 两个集合度量的是**两件事**：`views` 是「该不该在首页单列一个入口」，
   * 而 `accessibleViewKeys` 是「这张卡的落点这个角色**到不到得了**」。
   * 被收编的页**照样到得了**（换了个入口，在那个控制台里），只是不单列。
   * 若这里也跟着过滤，落在 `sim-console` 等页上的场景卡会被判成「本角色不可达」而降权 ——
   * 那是把「入口收编」错算成「功能没有」，比首页多几个重复入口严重得多。
   */
  const accessibleViewKeys = workspace.navigation.filter((n) => n.group !== "admin").map((n) => n.viewKey ?? n.key);
  const hot = rankHotScenarios(data?.items ?? [], accessibleViewKeys, 6);
  const routeEntries = routeEntriesForHome(workspace);

  // 遇事指引：只留**卡片真的在册**的那几条 —— 卡没下发就别在屏上留一个点了没反应的钩子。
  const cardBySNo = new Map((data?.items ?? []).map((c) => [c.sNo, c]));
  const guides = EVENT_GUIDES.map((g) => ({ g, card: cardBySNo.get(g.sNo) })).filter((x) => x.card !== undefined);

  return (
    <div data-testid="home-page" style={{ maxWidth: 1100 }}>
      <h2 style={{ fontSize: 17, marginBottom: 4 }}>{workspace.tenant?.name ?? zh.home.fallbackTenant}</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 16 }}>{zh.home.hint}</div>

      {hot.length > 0 && (
        <>
          <div className="section-title">{zh.home.hotScenarios}</div>
          <div data-testid="home-hot-scenarios" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10, marginBottom: 20 }}>
            {hot.map((c) => (
              <button key={c.sNo} className="panel" data-testid={`home-scenario-${c.sNo}`} style={{ textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4 }} onClick={() => void launch(c)}>
                <span style={{ fontWeight: 600 }}>
                  {c.name}
                  {c.willProduceDraft && <span className="badge amber" style={{ marginLeft: 6 }}>{zh.home.writebackBadge}</span>}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{c.triggerQuestion}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/*
        遇事指引区（WO-HOME-ENTRY-FLOW）：回答「我遇到 X，该点哪个」。
        放在高频场景**之后**、业务视图**之前** —— 用户是带着一件事来的，
        先给「这件事点哪个」，再给「按名字自己找」，顺序不许倒过来。
      */}
      {guides.length > 0 && (
        <>
          <div className="section-title">{zh.home.eventGuidance}</div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{zh.home.eventGuidanceHint}</div>
          <div
            data-testid="home-event-guidance"
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10, marginBottom: 20 }}
          >
            {guides.map(({ g, card }) => (
              <button
                key={g.key}
                className="panel"
                data-testid={`home-event-${g.key}`}
                style={{ textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4 }}
                onClick={() => void launch(card!)}
              >
                <span style={{ fontWeight: 600 }}>{g.event}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{g.answer}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="section-title">{zh.home.businessViews}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
        {/*
          route 项排在最前：统一推演控制台是主流程起点（仓主裁决它是「推演」组主入口），
          排在 33 项之后等于让用户滚到底才看得见 —— 那是把「找不到」改成「找得慢」。
        */}
        {routeEntries.map((r) => (
          <NavLink key={`r:${r.key}`} to={`/v/${r.key}`} className="panel" data-testid={`home-view-${r.key}`} style={{ textDecoration: "none", fontWeight: 600 }}>
            {r.label}
          </NavLink>
        ))}
        {views.map((v) => (
          <NavLink key={v.key} to={`/v/${v.viewKey ?? v.key}`} className="panel" data-testid={`home-view-${v.viewKey ?? v.key}`} style={{ textDecoration: "none", fontWeight: 600 }}>
            {v.label ?? v.key}
          </NavLink>
        ))}
        <NavLink to="/scenarios" className="panel" data-testid="home-all-scenarios" style={{ textDecoration: "none", fontWeight: 600, color: "var(--c-capacity-txt)" }}>
          {zh.home.allScenarios}
        </NavLink>
      </div>
    </div>
  );
}
