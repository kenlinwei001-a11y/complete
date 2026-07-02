import { useMemo } from "react";
import { useSessionStore } from "@/store/sessionStore";
import { normalizeViewKey } from "../registry";

/**
 * WO-SIM-PRESET-INJECT（命门·C4 单一通道·治 G-3 视图侧注入）：落点推演视图读场景启动器带入的
 * scenarioPreset（sessionStore）——当其 targetView 规范化后等于本视图键时，返回 slotPresets + label 供注入
 * 求解器入参初值（问句与视图对口·R17）。两侧视图键归一（VIEW_ALIAS）→ 修「project≠project-sim 不注入」。
 *
 * 消费语义：返回 `nonce`（每次点卡唯一），视图用它作 useMemo/useState 初值 key，导航后不重复注入；
 * 不在此清 store（清了会导致视图重挂载丢初值），由下一次点卡覆盖或 reset 清。
 * 无匹配 preset → 返回 null（视图走默认入参·诚实不硬塞·向后兼容直接进视图路径）。
 */
export interface ScenarioPresetMatch {
  slots: Record<string, unknown>;
  label?: string;
  nonce: string;
}

export function useScenarioPreset(viewKey: string): ScenarioPresetMatch | null {
  const preset = useSessionStore((s) => s.scenarioPreset);
  return useMemo(() => {
    if (!preset) return null;
    if (normalizeViewKey(preset.targetView) !== viewKey) return null;
    return { slots: preset.slotPresets, label: preset.label, nonce: preset.nonce };
  }, [preset, viewKey]);
}

/** slotPresets 里取 number（非有限→undefined·R6 确定性·防脏值注入）。 */
export function presetNum(slots: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!slots) return undefined;
  const v = slots[key];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** slotPresets 里取 string（空/非串→undefined）。 */
export function presetStr(slots: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!slots) return undefined;
  const v = slots[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
