import type { ScenarioCardVM } from "@/api/endpoints";

/**
 * 首页高频区排序（场景启动器 §3.5-C）：按"角色可达落点视图"把场景卡分层——
 * 落点视图在用户可达导航内的排前（该角色真能用），其余沉底；同层按 sNo 稳定排序（R6 确定性）。
 *
 * "按角色"完全派生自服务端按角色计算的 workspace.navigation（R14：不在前端硬编码
 * 角色→业务域表），故 planner（全视图）与 base_manager（受限视图）天然得到不同高频卡。
 */
export function rankHotScenarios(
  cards: ScenarioCardVM[],
  accessibleViewKeys: Iterable<string>,
  limit = 6,
): ScenarioCardVM[] {
  const accessible = new Set(accessibleViewKeys);
  /**
   * ⚠️ **这里刻意不做别名换算，与路由口径保持一致。**
   * 我 2026-08-27 先改错过一次：以为要跟 `useScenarioLaunch` 一样先 `resolveViewKey()`
   * 再查可达集。实测方向是反的 —— **能打开的是短名，规范名反而打不开**：
   *   /v/risk ✅ 正常    /v/risk-board ❌ 无权访问
   *   /v/dash ✅ 正常    /v/dashboard  ❌ 页面不存在
   * 因为 `workspace.navigation` 下发的就是短名（`risk` / `dash`），可达集里装的也是短名。
   * 那一刀的净效果只是把坏卡**排到后面**（屏上 6 张看着好了），**一张都没修好** ——
   * 「排到后面」≠「能点开」，去「全部场景」照样撞。病根在跳转那一侧的换算，已在
   * `useScenarioLaunch.ts` 修掉。
   */
  const reachable = (c: ScenarioCardVM) => accessible.has(c.view) || accessible.has(c.presetContext?.targetView ?? c.view);
  return [...cards]
    .sort((a, b) => {
      const ra = reachable(a) ? 0 : 1;
      const rb = reachable(b) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return a.sNo.localeCompare(b.sNo);
    })
    .slice(0, limit);
}
