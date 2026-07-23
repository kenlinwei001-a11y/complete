import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { TENANT } from "./helpers.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { resolveDomainFocus, resolveOntologyContext } from "../src/router/ontology-context.js";
import type { ToolAuthCtx } from "../src/tools/clients.js";

/**
 * WO-QOS-ONTOLOGY-CONTEXT · 问句语义解析器（agentcore 引擎半·SEAM 接缝）。
 *
 * 数据半（mock typeSemantics·忠实镜像真 datacore 投影·真投影另由 datacore type-semantics.test 守）
 * × 引擎半（resolveDomainFocus 复用 ceo-route + contracts assembleContextBundle 打分选型）一测通。
 */

const ctx: ToolAuthCtx = { tenantId: TENANT, userId: "admin", roles: ["admin"], debugUser: `${TENANT}:admin:admin` };
const onto = () => createMockDataCore().ontology;

describe("WO-QOS-ONTOLOGY-CONTEXT · resolveOntologyContext 接缝", () => {
  it("SEAM-1 储能份额没达标逐层拆根因 → gap_attribution matchScore 最高 + relevantTypes 含 Metric/CausalFactor/Base/MaterialBalance", async () => {
    const question = "储能份额没达标·逐层拆根因";
    const bundle = await resolveOntologyContext(ctx, question, undefined, onto());

    expect(bundle.domain).toBe("decision");
    expect(bundle.relevantSolvers[0]!.key).toBe("gap_attribution");
    const top = bundle.relevantSolvers[0]!.matchScore;
    for (const s of bundle.relevantSolvers.slice(1)) expect(s.matchScore).toBeLessThan(top);

    const typeKeys = bundle.relevantTypes.map((x) => x.typeKey);
    for (const k of ["Metric", "CausalFactor", "Base", "MaterialBalance"]) expect(typeKeys).toContain(k);

    // 口径来自本体投影（非内联）——Metric 派生公式随相关类型带出。
    expect(bundle.calibers.Metric?.gapPct).toBe("(actual - target) / target * 100");
    expect(bundle.fieldMappings.Base?.baseId).toBe("BASE_ID");
  });

  it("SEAM-2 无对口 solver 的分组问句 → relevantTypes+分组维度+口径齐·无首选求解器霸占（证无 solver 也能定位数据）", async () => {
    const question = "各省份分别有多少个交付地点";
    const resolved = resolveDomainFocus(question);
    expect(resolved.domain).toBe("commercial");
    expect(resolved.primarySolver).toBeUndefined(); // 非 CEO 问句·无首选求解器

    const bundle = await resolveOntologyContext(ctx, question, undefined, onto());
    // 无求解器被"设计成"回答本题（无首选加权·全部 < 加权阈）。
    for (const s of bundle.relevantSolvers) expect(s.matchScore).toBeLessThan(1000);

    const custLoc = bundle.relevantTypes.find((x) => x.typeKey === "CustomerLocation");
    expect(custLoc).toBeTruthy();
    expect(custLoc!.keyProps).toContain("province"); // 可分组维度
    expect(custLoc!.keyProps).toContain("city");
    // 决策域因果证据不越界进商务域问句。
    expect(bundle.relevantTypes.map((x) => x.typeKey)).not.toContain("CausalFactor");
  });

  it("domain 解析：CEO 深问复用 ceo-route 得首选求解器；PageContext.focus 回显", async () => {
    const pc: PageContext = { view: "decision", focus: { metric: "seg_attain_ess", base: "changzhou" }, entities: [], selection: [], drillPath: [], actions: [] };
    const r = resolveDomainFocus("储能份额为什么没达标", pc);
    expect(r.domain).toBe("decision");
    expect(r.primarySolver).toBe("gap_attribution");
    expect(r.focus?.metric).toBe("seg_attain_ess");
    expect(r.focus?.base).toBe("changzhou");
    expect(r.focus?.domain).toBe("decision");

    // 信用类深问 → commercial 域 + credit_exposure 首选。
    const c = resolveDomainFocus("这个客户的信用敞口和逾期多少");
    expect(c.domain).toBe("commercial");
    expect(c.primarySolver).toBe("credit_exposure");
  });

  it("R6 确定性 + 不劫持：同问句两跑 bundle 字节一致·非 CEO 问句无首选求解器（不动确定性默认路径）", async () => {
    const q = "储能份额没达标·逐层拆根因";
    const b1 = await resolveOntologyContext(ctx, q, undefined, onto());
    const b2 = await resolveOntologyContext(ctx, q, undefined, onto());
    expect(JSON.stringify(b1)).toBe(JSON.stringify(b2));

    // 纯分组统计问句不被 CEO 路由劫持（无 primarySolver·无 gap_attribution 加权置顶）。
    const plain = resolveDomainFocus("各城市有多少交付地点");
    expect(plain.primarySolver).toBeUndefined();
  });
});
