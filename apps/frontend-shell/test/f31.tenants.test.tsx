import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

describe("F31 · 租户管理（管理平台 §2，仅 platform_admin）", () => {
  it("platform_admin：租户列表 + 创建租户 + 创建首个 tenant_admin（初始密码一次性展示）", async () => {
    const user = userEvent.setup();
    loginAs("padmin");
    renderApp("/admin/tenants");

    // 列表渲染
    expect(await screen.findByTestId("tenant-tenant-battery")).toBeInTheDocument();

    // 创建租户
    await user.click(screen.getByTestId("tenant-create"));
    await user.type(screen.getByTestId("tenant-key-input"), "acme");
    await user.type(screen.getByTestId("tenant-name-input"), "Acme 制造");
    await user.click(screen.getByTestId("tenant-save"));
    expect(await screen.findByTestId("tenant-acme")).toBeInTheDocument();
    await waitFor(() => expect(db.tenants.some((t) => t.id === "acme")).toBe(true));

    // 首管理员创建 → 初始密码一次性展示
    await user.click(screen.getByTestId("tenant-first-admin-acme"));
    await user.type(screen.getByTestId("first-admin-email"), "boss@acme.io");
    await user.click(screen.getByTestId("first-admin-save"));
    const pw = await screen.findByTestId("first-admin-password");
    expect(pw).toHaveTextContent("init-pass-9x");
    expect(db.adminUsers.some((u) => u.email === "boss@acme.io" && u.roles.includes("tenant_admin"))).toBe(true);
  });

  it("非 platform_admin 直输 /admin/tenants → 403", async () => {
    loginAs("planner");
    renderApp("/admin/tenants");
    expect(await screen.findByTestId("page-403")).toBeInTheDocument();
  });
});
