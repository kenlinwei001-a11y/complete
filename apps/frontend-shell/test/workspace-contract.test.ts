/**
 * 真连回归：用「真实 DataCore /a/v1/me/workspace 响应形状」直接过前端 WorkspaceSchema，
 * 堵住「Mock 形态与契约形态漂移」的验证盲区（v0.4.1 修复的 P0：scenarioPackages 对象数组
 * 曾使严格 parse 抛错 → 真连模式登录后 Shell 无法加载）。
 */
import { describe, expect, it } from "vitest";
import { WorkspaceSchema } from "../src/api/types";

const REAL_BACKEND_SHAPE = {
  tenant: { id: "demo", name: "全域数字化智能决策支撑系统", industry: "battery-manufacturing" },
  user: { id: "u_admin", username: "admin", roles: ["admin", "planner", "catalog_admin"], attributes: {} },
  theme: { "--accent": "#4C90F0" },
  navigation: [
    { key: "dash", label: "经营驾驶舱", viewKey: "dash", group: "business" },
    { key: "risk", label: "风险推演", viewKey: "risk", group: "business" },
    { key: "admin-connections", label: "连接器", group: "admin" },
    { key: "admin-modeling", label: "本体建模", group: "admin" },
  ],
  views: [
    // 契约字段 viewKey/name + 后端兼容别名 key/title 双发
    { viewKey: "dash", name: "经营驾驶舱", renderer: "dashboard", layout: {}, options: {}, key: "dash", title: "经营驾驶舱" },
    // 仅契约字段（无别名）也必须可解析
    { viewKey: "graph-loop", name: "图谱·学习闭环", renderer: "ontology-graph", options: { graphOptions: { colorBy: "domain" } } },
  ],
  scenarioPackages: [{ id: "pkg_battery_manufacturing", name: "电池制造场景包" }],
  features: ["view.dash", "view.risk-board", "shell.query-dock"],
  configVersion: 3,
};

describe("workspace VM ↔ 真实后端契约对齐（回归）", () => {
  it("契约形态完整解析并归一化", () => {
    const ws = WorkspaceSchema.parse(REAL_BACKEND_SHAPE);
    // scenarioPackages 对象数组 → id 字符串数组（QueryDock/Catalog 等以 [0] 作 packageId）
    expect(ws.scenarioPackages).toEqual(["pkg_battery_manufacturing"]);
    // views：仅契约字段（无 key/title 别名）也归一化出 key/title
    const loop = ws.views.find((v) => v.key === "graph-loop");
    expect(loop?.title).toBe("图谱·学习闭环");
    expect(ws.views.find((v) => v.key === "dash")?.renderer).toBe("dashboard");
    // navigation 保留 group，业务区可过滤掉 admin 组（ShellLayout 行为）
    expect(ws.navigation.filter((n) => n.group !== "admin").map((n) => n.key)).toEqual(["dash", "risk"]);
  });

  it("旧 mock 形态（string 包 id / key+title）同样兼容", () => {
    const ws = WorkspaceSchema.parse({
      tenant: { id: "demo" },
      navigation: [{ key: "dash", label: "驾驶舱" }],
      views: [{ key: "dash", title: "驾驶舱", renderer: "dashboard" }],
      scenarioPackages: ["pkg_battery_manufacturing"],
    });
    expect(ws.scenarioPackages).toEqual(["pkg_battery_manufacturing"]);
    expect(ws.views[0]?.key).toBe("dash");
    expect(ws.views[0]?.title).toBe("驾驶舱");
  });
});
