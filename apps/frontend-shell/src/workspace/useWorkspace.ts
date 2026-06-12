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
