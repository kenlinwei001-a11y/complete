/**
 * WO-SANDBOX-PROCESS-MODE · 推演沙盘主画布**第五档「业务流程」**的纯派生层。
 *
 * ── 这个文件解决的问题 ────────────────────────────────────────────────────────
 * 仓主原话：「点击每个 node 后展示与其他 node ＋ node 内部 sub-node 的**完整本体关系**」
 * 「右侧节点要**完整**」。65 条业务流程此前只在「流程等待态」那一页出现，沙盘主画布看不见；
 * 上一轮把它判成「两层不能合并 ⇒ 只能放在别的页」——**那个判断是错的**。
 *
 * ── ⛔ 本档必须守住的那条约束（它没有被放宽，只是被读对了）─────────────────────
 * `packages/contracts/src/process.ts` 文件头原文：链路节拍层（24 条 `CHAIN_NODE_REGISTRY`）
 * 与业务流程层（65 条 `ProcessDefinition`）「两层粒度不同，**不能互相替代，也不能合并**」。
 * 那句话约束的是**两个数据模型**：不许互相顶替、不许揉成一张表。
 * 它**没有**约束「不能同屏」—— 同屏 ≠ 同模型。
 *
 * 故本档是**另一个图层**：自己的取数（`GET /a/v1/process-definitions`）、自己的检视面板
 * （`ProcessInspectPanel`）、自己的选中态（`processKey`，不是 `nodeId`），
 * 只是共用同一块画布区域与同一套档位按钮。本文件**不 import** `sandboxConsoleModel` 的任何
 * 节点视图模型，也**不写**任何 `nodeId`。
 *
 * ── 结构红线：两层的键集合必须**交集为空**（机器先说话，不靠人记得）───────────
 * `disjointFromChainLayer()` 现算「本档要渲染的流程键」∩「24 个冻结 nodeId」。
 * **2026-08-14 实测**：真后端 65 条 / mock 11 条，交集均为空（屏上 `spc-disjoint[data-overlap]="0"`）。
 * 复验：`pnpm --filter frontend-shell exec vitest run sandbox-process-mode`（§A1 先证该函数**能说「有」**，
 * 否则它说「没有」一文不值；§C1 才咬交集为空）。⚠ 有保质期：两层任一侧改键空间即须重测。
 * 非空 = 有人把两层揉了（例如把 `ProcessDefinition` 塞进 `CHAIN_NODE_REGISTRY`，
 * 或给流程编了个 `capacity.*` 形状的键）。这个数**画在屏上**（`spc-disjoint`），
 * 并被 `sandbox-process-mode.seam.test.tsx` 咬死 —— 揉了当场红。
 * ⚠ 这里 import `CHAIN_NODE_REGISTRY` 是为了**证明两层不相交**，不是为了合并它们：
 *   本文件除这一处集合运算外，一个 nodeId 都不读、不显示、不映射。
 *
 * ── 条数不写死 ────────────────────────────────────────────────────────────────
 * 全档不出现 `65`。总数一律来自端点下发的 `definitions.length`；
 * 「一条不少」的判据是**现算的恒等式**：`total === Σ 各泳道条数`（`lanesCoverAll`），
 * 而不是把某个金值抄进前端（种子一变就假红/假绿，本仓 #99 的老坑）。
 *
 * R6 确定性：纯函数，无 `Date.now`、无随机；排序全序（域按 `order` 再按 `key`，
 * 流程按 `key` 升序），同输入两次渲染字节级一致。
 */
import { CHAIN_NODE_REGISTRY, type ProcessDefinition, type ProcessWaitKind } from "@platform/contracts";
import type { ProcessDefinitionsResponse } from "@/views/process/processWait";

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 视图模型
// ══════════════════════════════════════════════════════════════════════════════

/** 画布上的一张流程卡。字段全部是响应的**投影**，不新增口径、不派生任何数字。 */
export interface ProcessCardVM {
  readonly key: string;
  readonly name: string;
  readonly waitKind: ProcessWaitKind;
  readonly ownerFunctionKey: string;
  /** 责任职能展示名；登记册里查不到 ⇒ 回退原 key（**不静默留空**，空白会把断线伪装成"没有"）。 */
  readonly ownerName: string;
  readonly stdDurationDays: number;
  /** 承载物类型键 —— 这是「node 内部 sub-node 的完整本体关系」那条链的入口。 */
  readonly carrierTypeKey: string;
  readonly domainKey: string;
}

/** 一条泳道 = 一个一级业务域（域是流程的天然分组，与节拍层的 stage **不是**一回事）。 */
export interface ProcessLaneVM {
  readonly domainKey: string;
  readonly domainName: string;
  /** 该域在登记册里有没有登记。`false` ⇒ 域名回退为裸 key，并在屏上标出来。 */
  readonly registered: boolean;
  readonly cards: readonly ProcessCardVM[];
  /** 该域累计标准工期（天，一位小数）。**标准工期不是实测滞留**，措辞由调用方负责。 */
  readonly totalStdDays: number;
}

export interface ProcessCanvasModel {
  /** 端点下发的流程条数（唯一真值源，**前端不写死**）。 */
  readonly total: number;
  /** 各泳道条数之和。与 `total` 不等即为渲染层漏画（见 `lanesCoverAll`）。 */
  readonly laid: number;
  readonly lanes: readonly ProcessLaneVM[];
  /** 端点下发但域登记册里没有的 domainKey（非空 ⇒ 接缝漂移，屏上明写，不静默并进"其它"）。 */
  readonly unregisteredDomainKeys: readonly string[];
  /** 四态各几条（等待类型词表来自契约，本文件不另抄一份）。 */
  readonly byWaitKind: readonly { readonly kind: ProcessWaitKind; readonly count: number }[];
  /** 结构红线：与链路节拍层 24 个冻结 nodeId 的键交集。**恒须为空**。 */
  readonly chainLayerOverlap: readonly string[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 结构红线：两层键集合不相交
// ══════════════════════════════════════════════════════════════════════════════

/** 24 个冻结 nodeId 的集合。**只用于求交集**（证明不相交），不用于渲染、不用于映射。 */
const CHAIN_NODE_IDS: ReadonlySet<string> = new Set(CHAIN_NODE_REGISTRY.map((n) => n.nodeId));

/**
 * 现算「这批流程键」∩「链路节拍层 nodeId」。
 *
 * 返回空数组 = 两层没被揉在一起（今天的事实）。返回非空 = **本档把两层合并了**，
 * 那正是 `contracts/src/process.ts` 文件头禁止的事。判据放在这里而不是只放在测试里，
 * 是因为「写在注释里的纪律不是机制」—— 这个数会被画到屏上，也会被 SEAM 门咬。
 */
export function chainLayerOverlap(processKeys: readonly string[]): string[] {
  return processKeys.filter((k) => CHAIN_NODE_IDS.has(k)).sort();
}

/** 金丝雀：喂一个**已知必中**的 nodeId 进去，它必须被判为重叠。 */
export function chainLayerOverlapCanaryKey(): string {
  const first = CHAIN_NODE_REGISTRY[0];
  if (first === undefined) throw new Error("[processCanvas] CHAIN_NODE_REGISTRY 为空 —— 契约坏了，不是两层不相交");
  return first.nodeId;
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 组装
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 把 `GET /a/v1/process-definitions` 的响应折成第五档要用的视图模型。
 *
 * 判据①：**一条都不许掉**。域登记册里查不到的 `domainKey` 不丢弃，单开一条泳道并标
 *        `registered:false` —— 静默丢弃会让「后端漏发了这个域」与「前端漏画了这个域」
 *        在屏幕上长得一模一样。
 * 判据②：**排序确定性**（R6）。域按 `order` 升序、同序按 `key`；未登记域排最后按 key；
 *        泳道内流程按 `key` 升序。不依赖响应序、不依赖 `Map` 迭代序。
 * 判据③：**不写死条数**。`total` 取 `definitions.length`；四态计数按契约词表全列（含 0 条的态）。
 */
export function buildProcessCanvasModel(res: ProcessDefinitionsResponse, waitKindOrder: readonly ProcessWaitKind[]): ProcessCanvasModel {
  const domainName = new Map(res.domains.map((d) => [d.key, d.name] as const));
  const domainOrder = new Map(res.domains.map((d) => [d.key, d.order] as const));
  const ownerName = new Map(res.ownerFunctions.map((f) => [f.key, f.displayName] as const));

  const cards: ProcessCardVM[] = [...res.definitions]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((p: ProcessDefinition) => ({
      key: p.key,
      name: p.name,
      waitKind: p.waitKind,
      ownerFunctionKey: p.ownerFunctionKey,
      ownerName: ownerName.get(p.ownerFunctionKey) ?? p.ownerFunctionKey,
      stdDurationDays: p.stdDurationDays,
      carrierTypeKey: p.carrierTypeKey,
      domainKey: p.domainKey,
    }));

  const byDomain = new Map<string, ProcessCardVM[]>();
  for (const c of cards) {
    const bucket = byDomain.get(c.domainKey);
    if (bucket === undefined) byDomain.set(c.domainKey, [c]);
    else bucket.push(c);
  }

  const unregisteredDomainKeys = [...byDomain.keys()].filter((k) => !domainName.has(k)).sort();

  const lanes: ProcessLaneVM[] = [...byDomain.entries()]
    .map(([domainKey, laneCards]) => ({
      domainKey,
      domainName: domainName.get(domainKey) ?? domainKey,
      registered: domainName.has(domainKey),
      cards: laneCards,
      totalStdDays: round1(laneCards.reduce((s, c) => s + c.stdDurationDays, 0)),
    }))
    .sort((a, b) => {
      // 已登记域排在未登记域之前；组内按 order，再按 key —— 全序，无并列歧义。
      if (a.registered !== b.registered) return a.registered ? -1 : 1;
      const oa = domainOrder.get(a.domainKey) ?? Number.MAX_SAFE_INTEGER;
      const ob = domainOrder.get(b.domainKey) ?? Number.MAX_SAFE_INTEGER;
      return oa - ob || a.domainKey.localeCompare(b.domainKey);
    });

  const byWaitKind = waitKindOrder.map((kind) => ({ kind, count: cards.filter((c) => c.waitKind === kind).length }));

  return {
    total: res.definitions.length,
    laid: lanes.reduce((s, l) => s + l.cards.length, 0),
    lanes,
    unregisteredDomainKeys,
    byWaitKind,
    chainLayerOverlap: chainLayerOverlap(cards.map((c) => c.key)),
  };
}

/**
 * 「一条不少」的**现算判据**（不写死条数）：泳道铺开的条数 == 端点下发的条数。
 * 屏上把两个数都印出来，不合等号即为漏画 —— 判据是恒等式，不是某个金值。
 */
export function lanesCoverAll(m: ProcessCanvasModel): boolean {
  return m.total === m.laid;
}
