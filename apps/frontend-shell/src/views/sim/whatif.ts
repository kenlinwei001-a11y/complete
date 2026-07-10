import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { BASE_REGISTRY, type SandboxViewConfig, type TickState } from "@platform/contracts";

/**
 * WO-E2（沙盘 what-if 进决策日常）：决策入口一键「开 what-if」→ 带 presetContext 进推演沙盘。
 *
 * 复用既有沙盘链（`/v/sim-sandbox` · `POST /a/v1/sim/sessions` baseSnapshot+scope · propagateTick），
 * **不新建推演引擎**——本模块只做「决策上下文 → 沙盘入参」的确定性搬运（R6：纯 URL 编码，无随机/时钟）。
 *
 * 传参走 URL query（?whatif=1&source=<视图>&subject=<对象>&factor=<因素>&label=<人读>），
 * 沙盘读之注入 SimSession.scope 并展示「what-if 上下文」条——决策完即弃（新会话）或采纳（R4 Action 正门）。
 */
export interface WhatIfPreset {
  /** 发起决策视图（risk-board / plan-audit / order-chain …），供沙盘展示上下文来源。 */
  source: string;
  /** 推演主体（基地 / 订单 / 型号 等业务对象标识）。 */
  subject?: string;
  /** 关注因素（瓶颈因素 / 良率 / 齐套 等），决策入口传入以聚焦推演。 */
  factor?: string;
  /** 人读标题（如「常州 · 物料齐套」），沙盘上下文条直接展示。 */
  label?: string;
  /** WO-SIM-PRESET-INJECT（推演 I 层入参对口·additive·向后兼容）：型号/需求(万套)/交付周数——
   * 决策入口/场景卡带入 → 项目推演视图注入为求解器入参初值（问句与视图对口·R14 由消费方按白名单/裁剪守）。 */
  model?: string;
  demand?: number;
  weeks?: number;
}

/** 决策上下文 → 沙盘 URL query（确定性编码；沙盘侧 parseWhatIfPreset 逆解）。 */
export function whatIfQuery(preset: WhatIfPreset): string {
  const q = new URLSearchParams({ whatif: "1", source: preset.source });
  if (preset.subject) q.set("subject", preset.subject);
  if (preset.factor) q.set("factor", preset.factor);
  if (preset.label) q.set("label", preset.label);
  if (preset.model) q.set("model", preset.model);
  if (preset.demand != null && Number.isFinite(preset.demand)) q.set("demand", String(preset.demand));
  if (preset.weeks != null && Number.isFinite(preset.weeks)) q.set("weeks", String(preset.weeks));
  return q.toString();
}

/** 沙盘侧：URL query → presetContext（无 whatif 标记则返回 null，走常态沙盘 init）。 */
export function parseWhatIfPreset(params: URLSearchParams): WhatIfPreset | null {
  if (params.get("whatif") !== "1") return null;
  const source = params.get("source") ?? "decision";
  const num = (k: string): number | undefined => {
    const v = params.get(k);
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined; // R6 确定性·非法→忽略（不注入·消费方默认）
  };
  const demand = num("demand"), weeks = num("weeks");
  return {
    source,
    ...(params.get("subject") ? { subject: params.get("subject") as string } : {}),
    ...(params.get("factor") ? { factor: params.get("factor") as string } : {}),
    ...(params.get("label") ? { label: params.get("label") as string } : {}),
    ...(params.get("model") ? { model: params.get("model") as string } : {}),
    ...(demand != null ? { demand } : {}),
    ...(weeks != null ? { weeks } : {}),
  };
}

// ── WO-CAP-06-WHATIF-SCOPE（闭 G-3）：跳沙盘时真按基地裁剪世界（原 init 用全量 cfg·基地徽章只是摆设）。 ──
// 决策入口传入的 subject 是基地**中文名/拼音 id**（RiskBoard card.base / ProjectSim r.base 皆中文名）；
// 对象 id 内嵌基地拼音 token（obj_base_<id> / LINE-<id> / MP-<id> / em_<id>…，见 view-config nodeObjectIds）。
// 裁剪 = subject → 规范 baseId（BASE_REGISTRY 单一来源·R6 确定性·无网络/随机）→ 只纳入 id 命中该 baseId 的对象
// （该基地本体 + 其上下游产线/工序/设备/检修/在途/认证/能耗/财务/人力）。守 R3：其他基地对象一律不入本会话世界。

/** subject（基地中文名或拼音 baseId）→ 规范 baseId；无匹配返回 null（退全量·不裁剪）。BASE_REGISTRY 单一来源。 */
export function resolveBaseId(subject: string | undefined): string | null {
  if (!subject) return null;
  const s = subject.trim();
  if (!s) return null;
  for (const b of BASE_REGISTRY) {
    if (b.baseId === s || b.name === s) return b.baseId;
  }
  return null;
}

/** 对象 id 是否归属给定基地：baseId token 以分隔符（`_`/`-`）或串首/尾定界，防 `hefei` 误配 `hefeixxx`。 */
export function objectBelongsToBase(objectId: string, baseId: string): boolean {
  if (!baseId) return false;
  return new RegExp(`(^|[_-])${baseId}([_-]|$)`).test(objectId);
}

/** tick0 世界态（baseSnapshot）按基地裁剪：只留归属该基地的对象键（去占位/去他基地对象）。 */
export function cropWorldToBase(world: TickState, baseId: string): TickState {
  const out: TickState = {};
  for (const [oid, row] of Object.entries(world)) {
    if (objectBelongsToBase(oid, baseId)) out[oid] = row;
  }
  return out;
}

/**
 * 沙盘视图配置按基地裁剪：nodeObjectIds/nodeObjectState 只留该基地对象（DAG/KPI 真聚焦本基地·非全网稀释）。
 * nodeTypes/linkTypes/stateVars（拓扑结构）保留不动。**无任何对象命中 → 原样返回（诚实退全量·不空世界·R3）。**
 */
export function cropConfigToBase(cfg: SandboxViewConfig, baseId: string): SandboxViewConfig {
  const ids = cfg.nodeObjectIds;
  if (!ids) return cfg;
  const nodeObjectIds: Record<string, string[]> = {};
  let total = 0;
  for (const [t, arr] of Object.entries(ids)) {
    const kept = arr.filter((oid) => objectBelongsToBase(oid, baseId));
    nodeObjectIds[t] = kept;
    total += kept.length;
  }
  if (total === 0) return cfg; // 该基地无物化对象 → 不裁剪（防空世界）
  const keep = new Set(Object.values(nodeObjectIds).flat());
  const nodeObjectState = cfg.nodeObjectState
    ? Object.fromEntries(Object.entries(cfg.nodeObjectState).filter(([oid]) => keep.has(oid)))
    : cfg.nodeObjectState;
  return { ...cfg, nodeObjectIds, nodeObjectState };
}

/**
 * 决策视图用：返回 `openWhatIf(preset)` —— 一键跳沙盘（带 presetContext）。
 * 复用 react-router navigate，不刷新页面（SPA 内跳），沙盘同源守 sim.sandbox entitlement（关 → 404）。
 */
export function useOpenWhatIf(): (preset: WhatIfPreset) => void {
  const navigate = useNavigate();
  return useCallback(
    (preset: WhatIfPreset) => {
      navigate(`/v/sim-sandbox?${whatIfQuery(preset)}`);
    },
    [navigate],
  );
}
