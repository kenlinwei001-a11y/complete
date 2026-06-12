import { render } from "@testing-library/react";
import { RouterProvider } from "react-router-dom";
import { AppProviders, createAppRouter } from "@/App";
import { ACCOUNTS } from "@/mocks/fixtures";
import { tokenFor } from "@/mocks/db";
import { tokenStore } from "@/api/tokenStore";

export function loginAs(username: "planner" | "base_manager"): void {
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
