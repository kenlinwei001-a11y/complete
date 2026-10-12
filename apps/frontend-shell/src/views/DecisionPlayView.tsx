import { useSearchParams } from "react-router-dom";
import type { ViewConfigVM } from "@/api/types";
import { DecisionPlayPanel, readImpedimentEntry } from "./DecisionPlayPanel";
import EdgeActivePanel from "./sim/EdgeActivePanel";
// WO-U7-U9-REST · 判据 U7：本页走 App.tsx 专用 route（`v/decision-play`），不经 ViewPage
// ⇒ 必须自己报到（机制详见 sim/shared.tsx 的 usePageView 头注）。
// 挂在**壳**上而不是面板里：面板还被 OrderChainView / ChainImpedimentView 嵌入复用，
// 嵌入态的「本页」是宿主页，不该由它把宿主的 view 键改成 decision-play。
import { usePageView } from "./sim/shared";

/**
 * 决策推演**页面壳**（renderer=decision-play）。
 *
 * ── 本文件从 664 行缩到这几十行，是 WO-ORDER-JOURNEY 的要点之一 ──────────────
 * 仓主原话：「导航栏里面的『决策推演』不应该在这个位置，而是嵌入到每个需要决策推演的位置，
 * 每个需要决策的点都需要这个页面」。于是 5 区推演的**唯一实现**搬到了
 * `views/DecisionPlayPanel.tsx`，本文件只剩三件事：
 *   ① 读 URL 参数（`metricKey` / `factorId` / `imp*` 一串）；
 *   ② 把它们翻成面板的 props（含**落点锚** —— 从阻滞点跳进来时 URL 里本来就带着
 *      `impLocusType` / `impLocusId`，此前只用来显示，现在真喂给引擎去要 `locusPlay`）；
 *   ③ 页级挂件 `EdgeActivePanel`（嵌入态不重复挂 —— 那是"这一页"的挂件，不是面板的一部分）。
 *
 * **壳与嵌入用的是同一份实现**，这不是口号：两边都渲染 `DecisionPlayPanel`，
 * 面板里那行 `dp-impl-stamp` 文案改一处、两处同时变（接缝测试两处一起断言）。
 * 深链（`/v/decision-play?...`）与既有 `imp*` query 契约**一个键都没动** —— 老链接照常能用。
 */
export default function DecisionPlayView({ view }: { view?: ViewConfigVM }) {
  const [params] = useSearchParams();
  usePageView("decision-play");
  const metricKey = params.get("metricKey") ?? ((view?.layout as { metricKey?: string } | undefined)?.metricKey ?? "");
  const factorId = params.get("factorId") ?? "";
  const impEntry = readImpedimentEntry(params);
  // 落点锚：URL 里 `impLocusType`+`impLocusId` 同时在才算锚（缺一 = 没锚，引擎侧同一条判据）。
  const locus =
    impEntry !== null && impEntry.locusType !== "" && impEntry.locusId !== ""
      ? { objectType: impEntry.locusType, objectId: impEntry.locusId, label: impEntry.locusLabel }
      : null;

  return (
    <>
      <DecisionPlayPanel metricKey={metricKey} factorId={factorId} locus={locus} entry={impEntry} />
      {/* WO-ACTIVE-EDGE-UX 挂载点（横向要求：所有推演页都要能"关掉一条传导边看结果怎么变"）。 */}
      <EdgeActivePanel pageKey="decision-play" />
    </>
  );
}
