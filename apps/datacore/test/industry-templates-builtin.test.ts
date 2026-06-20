import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";

/**
 * Q4 · 行业模版下拉空洞修复：内置模版（battery-manufacturing 代码常数 —— 项目沙盘/快速合成的数据
 * 正是它确定性生成）此前不入 industry_templates 表 → GET 端点对新租户返回空 → 下拉无选项。
 * 端点改为「内置 ∪ 库存」并集后，下拉至少能看到内置 battery 模版。
 *
 * 故事脚本（~100 字）：管理员刚开租户、还没绑 LLM、也没跑过任何合成任务，打开"数据构建发动机"的
 * "快速合成"，行业模版下拉本该空空如也；修复后他至少看到 battery-manufacturing（系统现有数据的来源
 * 模版），选它即可一键确定性合成；之后用 LLM 生成了一个 vertical-farming 模版，两者并列出现、不重复。
 */
describe("Q4 · GET /a/v1/industry-templates 并入内置模版", () => {
  it("新租户（未跑合成/未绑 LLM）→ 下拉至少含内置 battery-manufacturing（source=BUILTIN）", async () => {
    const t = await makeApp({ seed: false }); // 干净租户，无任何库存模版
    const res = await t.app.inject({ method: "GET", url: "/a/v1/industry-templates", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const items = res.json() as { industryKey: string; source: string }[];
    const battery = items.find((i) => i.industryKey === "battery-manufacturing");
    expect(battery).toBeDefined();
    expect(battery!.source).toBe("BUILTIN");
  });

  it("内置与库存（LLM 生成）模版并列、不重复", async () => {
    const t = await makeApp({ seed: false });
    // 直接写一条"库存"模版（模拟 LLM 生成/克隆落库），以及一条与内置同 key 的，验证去重
    await t.repos.industryTemplates.put({ id: "tmpl_vf", tenantId: "demo", industryKey: "vertical-farming", template: { industryKey: "vertical-farming", ontology: { objectTypes: [], linkTypes: [] }, generation: [], rules: [] } as never, source: "LLM", createdAt: "2026-06-20T00:00:00.000Z" });
    await t.repos.industryTemplates.put({ id: "tmpl_dup", tenantId: "demo", industryKey: "battery-manufacturing", template: {} as never, source: "LLM", createdAt: "2026-06-20T00:00:00.000Z" });

    const items = (await t.app.inject({ method: "GET", url: "/a/v1/industry-templates", headers: ADMIN }).then((r) => r.json())) as { industryKey: string; source: string }[];
    const keys = items.map((i) => i.industryKey);
    expect(keys).toContain("battery-manufacturing");
    expect(keys).toContain("vertical-farming");
    // battery 只出现一次（内置优先，库存同 key 去重）
    expect(keys.filter((k) => k === "battery-manufacturing").length).toBe(1);
    expect(items.find((i) => i.industryKey === "battery-manufacturing")!.source).toBe("BUILTIN");
    expect(items.find((i) => i.industryKey === "vertical-farming")!.source).toBe("LLM");
  });
});
