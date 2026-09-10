/**
 * ══ WO-SIM-UNIFIED-WIRE-4 · ② 业务面投影的**取数半** ══
 *
 * 判据与实测证据在 `objectFacts.ts` 头注（那里是模型层）。本文件只管「这一跳怎么发」。
 * **那批实测做于 2026-09-10**（交叉引用不构成本句自己的保质期 —— 这正是 `stale-claims` STALE-1 咬的形态）；
 * 复验：`GET /a/v1/objects?type=Order&page=1&pageSize=1` 读 `total`（当日 500），以及 `apps/frontend-shell/src/views/sim/unified/objectFacts.ts` 头注里的逐条证据。
 *
 * ── ⚠ 为什么是 `fetchAllObjects` 而不是 `searchObjects` ──────────────────────
 * `GET /a/v1/objects` 默认页长 **50**，而 `Order` 真值 **500**（今日实测 `total=500`）。
 * 用不翻页的读法，第 51 张单开始一律查不到业务面，屏上会显示成
 * 「对象层里没有这一条」—— 那是**假的否定结论**，正是 `fetchAllObjects` 头注
 * 记的那个 7.331 倍口径偏差同一个病。故这里认服务端回显的 `hasMore`，翻完为止。
 *
 * ── ⚠ 为什么整跳都包在 `enabled` + `retry:false` 里（这条踩过，别自作主张改）────
 * `PerturbRail.tsx` 头注记着一条硬教训：给共享面板**在渲染期**新增 endpoint 依赖，
 * 会被全仓那批整体替换式 `vi.mock("@/api/endpoints", () => ({…}))` 打成 `undefined`。
 * 本壳的三个接缝测试（`sim-unified-shell` / `sim-rail-forms` / `sim-session-lifecycle`）
 * 用的正是那种整体替换 mock，且它们的 mock 面里**没有** `fetchAllObjects`。
 *
 * 所以这一跳被设计成**失败即诚实缺席**，而不是崩：
 *  · `enabled` 只在「选中了对象 + 反查到类型 + 该类型有投影规格」三条同时成立时才为真；
 *  · `queryFn` 里那个 `fetchAllObjects` 若是 `undefined`（被 mock 掉），调用当场抛 ⇒
 *    React Query 进 `isError` ⇒ 屏上走 `not-fetched` 那一句「不知道（不是没有）」；
 *  · `retry:false` ⇒ 不为一个注定失败的调用重试三次。
 * **屏上永远不会因为这一跳而白屏，也永远不会把「没取到」说成「没有」。**
 *
 * ── 缓存键 ────────────────────────────────────────────────────────────────────
 * `["a","objects",{type,view:"sim-unified"}]` —— 与 `GlobalSimView.tsx:463` 同族写法。
 * 刻意带 `view` 段：那边取的是 `Order` 全量做金额合计，这边取的是同一份数据做业务面，
 * 两者页长纪律相同、失效时机相同，但**用途不同**；带上 view 段让缓存命中与失效都好读。
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAllObjects } from "@/api/endpoints";
import {
  buildObjectFacts,
  hasProjection,
  typeOfObjectId,
  type ObjectFactsView,
} from "./objectFacts";

/**
 * 选中对象的业务面。
 *
 * @param objectId       推演层选中的那一格所在的对象（`null` = 没选中）
 * @param nodeObjectIds  后端下发的实例登记册（`SandboxViewConfig.nodeObjectIds`）
 */
export function useObjectFacts(
  objectId: string | null,
  nodeObjectIds: Readonly<Record<string, readonly string[]>> | undefined,
): ObjectFactsView {
  const typeKey = useMemo(() => typeOfObjectId(nodeObjectIds, objectId), [nodeObjectIds, objectId]);
  const enabled = objectId !== null && objectId !== "" && hasProjection(typeKey);

  const q = useQuery({
    queryKey: ["a", "objects", { type: typeKey ?? "", view: "sim-unified" }],
    // `typeKey` 在 `enabled` 为真时必非空；这里的 `?? ""` 只为满足类型，不会真的发出去。
    queryFn: () => fetchAllObjects(typeKey ?? ""),
    enabled,
    retry: false,
    staleTime: 60_000,
  });

  return useMemo(() => {
    // 没开这一跳：`typeKey===null` ⇒ `unknown-type`；有类型但没规格 ⇒ `no-projection`。
    // 两态都由模型层按 `typeKey` 自己分辨，这里不重复判一遍。
    if (!enabled) return buildObjectFacts(typeKey, undefined);
    // 这一跳还没回来 / 回来失败 ⇒ `undefined` ⇒ 模型层报 `not-fetched`（「不知道」，不是「没有」）。
    if (q.data === undefined) return buildObjectFacts(typeKey, undefined);
    const row = q.data.items.find((o) => o.id === objectId);
    // 回来了但没有这一条 ⇒ `null` ⇒ 模型层报 `not-found`（两层不同步，这是结论）。
    return buildObjectFacts(typeKey, row === undefined ? null : row.props);
  }, [enabled, typeKey, q.data, objectId]);
}
