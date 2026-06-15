import type { ReactNode } from "react";
import { useWorkspace } from "./useWorkspace";
import type { Workspace } from "@/api/types";

/**
 * Entitlement 增量 §6/§7：useFeature(key) hook 与 <Feature flag> 组件。
 * BLOCK/ACTION 级控制点全部经此（禁止散落 if）。
 * workspace 未下发 features 字段时视为全部开通（向后兼容）。
 */
export function featureOn(workspace: Workspace | undefined, key: string): boolean {
  const features = workspace?.features;
  if (!features) return true;
  return features.includes(key);
}

export function useFeature(key: string): boolean {
  const { data } = useWorkspace();
  return featureOn(data, key);
}

export function Feature({ flag, children, fallback = null }: { flag: string; children: ReactNode; fallback?: ReactNode }) {
  const on = useFeature(flag);
  return <>{on ? children : fallback}</>;
}
