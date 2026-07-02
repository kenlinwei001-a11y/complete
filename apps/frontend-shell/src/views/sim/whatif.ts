import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

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
