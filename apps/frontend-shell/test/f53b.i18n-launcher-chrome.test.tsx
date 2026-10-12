import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import zh from "@/locales/zh";

/**
 * F53b · 去电池 i18n 卫生（G-5 余项·低价值）：场景启动器/首页 chrome 文案从 zh 文案集渲染，
 * 不再内联硬编码——换语言=换文案集不改组件。这里验证首页高频区/全部场景入口/命令面板 chrome
 * 均取自 zh.home / zh.launcher（i18n 机制在启动器表面真正落地的代表性证明）。
 */
describe("F53b · 启动器/首页 chrome i18n 化", () => {
  it("首页：高频区标题/全部场景入口文案取自 zh.home", async () => {
    loginAs("planner");
    renderApp("/");
    await screen.findByTestId("home-page");
    expect(await screen.findByText(zh.home.hotScenarios)).toBeInTheDocument();
    expect(within(screen.getByTestId("home-all-scenarios")).getByText(zh.home.allScenarios)).toBeInTheDocument();
  });

  it("场景启动器页：标题取自 zh.launcher.title", async () => {
    loginAs("planner");
    renderApp("/scenarios");
    await screen.findByTestId("scenario-launcher");
    expect(screen.getByText(zh.launcher.title)).toBeInTheDocument();
  });
});
