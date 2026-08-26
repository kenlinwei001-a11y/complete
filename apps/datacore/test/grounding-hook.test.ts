import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import { checkGrounding } from "../src/solvers/llm-gen.js";

/**
 * DF.8 生成接地 hook（PRD 生成接地层 §3.4，核心论点：生成不造业务事实）：
 * LLM 临时求解器生成时注入已发布业务词表（BASE_REGISTRY/SEG_REGISTRY），注册前确定性越界校验——
 * computeSource 引用边界外业务实体（编造的基地名）→ UNREGISTERED + 接地 rejectReason（非静默注册）。
 * 与 A18 沙箱正交：沙箱隔副作用，接地防造假。
 */
describe("DF.8 · 生成接地校验（grounding hook）", () => {
  it("checkGrounding 纯函数：编造基地名越界 / 真实基地 + 单位文案放行（窄规则，无误伤）", () => {
    const vocab = ["常州", "厦门", "乘用车", "储能"];
    // 编造的 深圳基地（不在词表）→ 越界
    expect(checkGrounding(`(c,a)=>({ b: "深圳基地" })`, vocab)).toEqual(["深圳基地"]);
    // 真实基地（常州/常州基地）→ 放行
    expect(checkGrounding(`(c,a)=>({ b: "常州基地", c: "常州" })`, vocab)).toEqual([]);
    // 单位/状态/工序文案（无实体后缀）→ 不误伤
    expect(checkGrounding(`(c,a)=>({ u: "万套", s: "认证中", p: "化成柜" })`, vocab)).toEqual([]);
    // 纯字段引用、无 CJK 字面量 → 放行
    expect(checkGrounding(`(ctx,args)=>{ const o=ctx.objectsByType.Base||[]; return {n:o.length}; }`, vocab)).toEqual([]);
  });

  it("生成路径：computeSource 编造「深圳基地」→ UNREGISTERED + 接地校验失败（不注册可调用）", async () => {
    const t: TestApp = await makeApp();
    t.llm.enqueue({
      computeSource: `(ctx, args) => ({ chosen: "深圳基地" })`,
      outputShape: ["chosen"],
      argHints: {},
      rationale: "编造一个不存在的基地（应被接地拒）",
    });
    const art = (await (await t.app.inject({ method: "POST", url: "/a/v1/solvers/generate", headers: ADMIN, payload: { key: "bad_base_pick", intent: "挑一个基地" } })).json()) as {
      status: string; rejectReason?: string; trustLevel: string;
    };
    expect(art.status).toBe("UNREGISTERED");
    expect(art.rejectReason).toContain("接地校验失败");
    expect(art.rejectReason).toContain("深圳基地");
    // 未注册为可调用 → invoke 不命中临时件（落 NOT_FOUND/通用兜底，绝不冒充）
    const reg = await t.repos.solverArtifacts.list("demo", (a) => a.key === "bad_base_pick");
    expect(reg.every((a) => a.status === "UNREGISTERED")).toBe(true);
  });

  it("生成路径：引用真实基地「常州基地」→ 过接地 → 沙箱跑通 → PROVISIONAL", async () => {
    const t: TestApp = await makeApp();
    t.llm.enqueue({
      computeSource: `(ctx, args) => ({ chosen: "常州基地", n: (ctx.objectsByType.Base || []).length })`,
      outputShape: ["chosen", "n"],
      argHints: {},
      rationale: "引用边界内真实基地",
    });
    const art = (await (await t.app.inject({ method: "POST", url: "/a/v1/solvers/generate", headers: ADMIN, payload: { key: "good_base_pick", intent: "挑常州" } })).json()) as {
      status: string; trustLevel: string;
    };
    expect(art.status).toBe("PROVISIONAL");
    expect(art.trustLevel).toBe("UNVERIFIED");
  });
});
