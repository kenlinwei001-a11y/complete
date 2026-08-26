import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { RouterProvider } from "react-router-dom";
import { AppProviders, createAppRouter } from "@/App";
import { ACCOUNTS } from "@/mocks/fixtures";
import { tokenFor } from "@/mocks/db";
import { tokenStore } from "@/api/tokenStore";

export function loginAs(username: "planner" | "base_manager" | "padmin"): void {
  const account = ACCOUNTS.find((a) => a.username === username)!;
  tokenStore.set(tokenFor(account));
}

export function renderApp(initialPath: string) {
  const router = createAppRouter([initialPath]);
  const utils = render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { router, ...utils };
}

/**
 * 隔离渲染带 QueryClient（子面板如 BaseOutlookPanel / CapacityDerivationDag / CapacityRampEnvelope 内嵌
 * <Provenance> 结论溯源，其懒加载 lineage 依赖 react-query；应用内由 AppProviders 提供，隔离单测需补此上下文）。
 * 溯源查询默认 disabled（仅传 src/formula 作者标注·不下钻对象），故不触发真实网络。
 */
export function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}
