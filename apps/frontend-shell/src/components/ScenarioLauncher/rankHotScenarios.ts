import type { ScenarioCardVM } from "@/api/endpoints";
import { resolveViewKey } from "@/views/registry";

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
   * ⛔ **改前这里判的是「原始名」，而跳转判的是「换算后的名」——两个名字，两套判断。**
   *
   * `useScenarioLaunch.ts:30` 跳转前先 `resolveViewKey(targetView) ?? targetView`
   * （场景卡的 `targetView` 可能是短键别名），本函数却直接拿未换算的名去查可达集。
   * 于是「短名在可达集里、换算后的规范名不在」的卡被判为**可达并排到最前**，
   * 点下去落在一个用户没权限/不存在的视图上。
   *
   * 实测（2026-08-27，playwright 真点）：首屏 6 张高频卡**全部**落到错误页 ——
   * 4 张 `/v/risk-board`、2 张 `/v/dashboard`，body 里带「无权访问」/「页面不存在」。
   * 也就是说系统给新用户准备的 6 个「从这里开始」，**一个都推不开**。
   * 这正是仓主那句「我看不懂怎么使用他们」最直接的一条原因。
   *
   * 修法：**与跳转走同一条换算**（`resolveViewKey`），判可达与真跳转用同一个名字。
   * 不在这里另写一份别名表 —— 那就是第二份真相源，两边一漂又回到今天这个状态。
   */
  const canon = (k: string | undefined): string | undefined => (k === undefined ? undefined : (resolveViewKey(k) ?? k));
  const reachable = (c: ScenarioCardVM) => {
    const target = canon(c.presetContext?.targetView ?? c.view);
    return (target !== undefined && accessible.has(target)) || accessible.has(canon(c.view) ?? c.view);
  };
  return [...cards]
    .sort((a, b) => {
      const ra = reachable(a) ? 0 : 1;
      const rb = reachable(b) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return a.sNo.localeCompare(b.sNo);
    })
    .slice(0, limit);
}
