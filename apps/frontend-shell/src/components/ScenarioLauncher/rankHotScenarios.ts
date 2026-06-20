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
