import { useQuery } from "@tanstack/react-query";
import { fetchWorkspace } from "@/api/endpoints";
import { tokenStore } from "@/api/tokenStore";
import type { Workspace } from "@/api/types";

export const workspaceQueryKey = ["a", "workspace"] as const;

export function useWorkspace() {
  return useQuery<Workspace>({
    queryKey: workspaceQueryKey,
    queryFn: fetchWorkspace,
    enabled: tokenStore.get() != null,
    staleTime: 5 * 60_000,
  });
}

/**
 * 取首个场景包 id（QOS submit 的 packageId 单一提取点）。
 * VM 经 `WorkspaceSchema.transform`（api/types.ts）已把 `scenarioPackages` 归一为 id 字符串数组，
 * 此处再防御契约 `{ id, name }` 对象形态漂移（@platform/contracts）——string→原样、{id}→.id、否则 ""。
 * 零回归（当前 VM 路径即 string）。统一全平台 quickLaunch/QueryDock/管理页提取，
 * 杜绝"把 {id,name} 对象误当 packageId 传给 QOS → 404 PACKAGE_NOT_FOUND"（评审复核坐实的脆弱点）。
 */
export function firstPackageId(workspace?: Workspace): string {
  const raw = workspace?.scenarioPackages?.[0] as unknown;
  return (typeof raw === "string" ? raw : (raw as { id?: string } | undefined)?.id) ?? "";
}
