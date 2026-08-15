import { describe, expect, it } from "vitest";
import { BuildNeedsReportSchema, MODULE_KINDS, MODULE_KIND_REGISTRY, type BuildNeedsReport } from "@platform/contracts";
import { makeApp, ADMIN } from "./helpers.js";

/**
 * WO-DBUI-13-NEEDS · 建**之前**的 13 类缺口清单 —— 接缝驱动测试（后端半）。
 *
 * ══ 这条测试要钉死的那个错 ═══════════════════════════════════════════════════
 * 仓主要的第 ② 步是「显示目前缺少的信息（数据字段，求解器，约束，规则，本体…）」。
 * 改前干跑回执只有 5 类，分诊写的是「`BuildPlan` 没有按 id 取的只读端点」。
 * **那个分诊是错的**，本文件第一条用例就是它的证伪：`/a/v1/data-builders/plans/:id`
 * 早就在，干跑之后立刻 200 且 13 个需求数组全在。真缺口是**干跑那条路上没去比对现状**。
 *
 * ══ 要害在「查不到」和「不缺」必须分得开 ═════════════════════════════════════
 * 13 类里有 7 类的实物在另一个系统，两系统之间今天只有一条**下发即创建**的通道、
 * 没有只读探针 ⇒ 建之前**真的查不到**它们在不在。
 * 老的 `analyzeGap` 在没有回执时把这几类**一律默认成 TO_CREATE** —— 建完之后有回执，
 * 这个默认是对的；建**之前**它就是**拿猜当测**：屏上会写「本次新建 2 个工作流」，
 * 而真相是「这一刻根本不知道那边有没有」。
 *
 * 故本文件最要害的一条断言是 §3：跨系统类**必须**是 `UNKNOWN`，
 * **不许**是 `TO_CREATE`，更**不许**把 `unknown` 写成 0（0 会被读成「不缺」）。
 */

const SCRIPT = "常州基地产能紧张，影响订单交期与客户信用，请做风险推演";

/** 本系统这一侧能直查现状的那几类（其余为跨系统类，建之前查不到）。 */
const LOCAL_KINDS = ["dataset", "kb_doc", "ontology_type", "rule", "slice", "solver"] as const;
const CROSS_KINDS = ["intent", "plan", "workflow", "skill", "agent", "scene", "mcp"] as const;

async function dryRun(): Promise<{ job: Record<string, unknown>; app: Awaited<ReturnType<typeof makeApp>> }> {
  const app = await makeApp();
  const res = await app.app.inject({
    method: "POST",
    url: "/a/v1/data-builders/run",
    headers: ADMIN,
    payload: { script: SCRIPT, seed: 42, dryRun: true, builderKey: "foundry-grade-data-builder" },
  });
  expect(res.statusCode).toBe(202);
  return { job: res.json() as Record<string, unknown>, app };
}

describe("WO-DBUI-13-NEEDS · 干跑回执的 13 类缺口清单（接缝：倒推计划 × 现状比对 → 前端第 ② 步）", () => {
  it("§0 证伪旧分诊：BuildPlan 的按 id 读端点**早就有**，干跑后立刻 200 且 13 个需求数组全在", async () => {
    const { job, app } = await dryRun();
    const planId = job.planId as string;
    expect(planId).toBeTruthy(); // 金丝雀：真拿到了 planId，不是 undefined 恒真

    const p = await app.app.inject({ method: "GET", url: `/a/v1/data-builders/plans/${planId}`, headers: ADMIN });
    expect(p.statusCode).toBe(200);
    const plan = p.json() as Record<string, unknown>;
    const arrayFields = Object.entries(plan).filter(([, v]) => Array.isArray(v)).map(([k]) => k);
    // 13 个 need 数组 —— 也就是说「那一刻拿不到 13 类」这个说法本身不成立
    expect(arrayFields.length).toBe(MODULE_KINDS.length);
    await app.app.close();
  });

  it("§1 干跑回执带逐类清单：13 类一个不少（新增模块没接线即红），且形状合契约", async () => {
    const { job, app } = await dryRun();
    const needs = BuildNeedsReportSchema.parse(job.needs) as BuildNeedsReport;

    // 顺序与全集都咬死：新增一个 MODULE_KIND 而没在 provisioner 注册表里接线 → 这条当场红
    expect(needs.groups.map((g) => g.kind)).toEqual([...MODULE_KINDS]);
    // 每一类都要有人话名字（前端靠它上屏；漏登记 → 屏上会露出内部键名）
    for (const g of needs.groups) {
      expect(MODULE_KIND_REGISTRY.find((m) => m.kind === g.kind)?.label, `${g.kind} 缺人话名字`).toBeTruthy();
    }
    // 比差那一步不再是「跳过」——干跑也真比了一遍
    const phaseByName = Object.fromEntries((job.phases as { name: string; status: string }[]).map((p) => [p.name, p.status]));
    expect(phaseByName.gap).toBe("DONE");
    // 但仍然不落库（干跑的承诺没被这次改动破坏）
    expect(phaseByName.publish).toBe("SKIPPED");
    expect(phaseByName.rawin).toBe("SKIPPED");
    await app.app.close();
  });

  it("§2 每一类的数都自洽：四态之和 == 需要数 == 条目数（数对不上 = 有一态被吞了）", async () => {
    const { job, app } = await dryRun();
    const needs = job.needs as BuildNeedsReport;
    for (const g of needs.groups) {
      expect(g.existing + g.toCreate + g.missing + g.unknown, `${g.kind} 四态之和对不上 needed`).toBe(g.needed);
      expect(g.items.length, `${g.kind} 条目数对不上 needed`).toBe(g.needed);
    }
    const t = needs.totals;
    expect(t.needed).toBe(needs.groups.reduce((a, g) => a + g.needed, 0));
    expect(t.needed).toBeGreaterThan(0); // 金丝雀：真跑出了需求，不是空清单恒真
    await app.app.close();
  });

  it("§3 【要害】查不到的那几类如实报 UNKNOWN —— 不许默认成 TO_CREATE，也不许把 unknown 写成 0", async () => {
    const { job, app } = await dryRun();
    const needs = job.needs as BuildNeedsReport;
    const byKind = new Map(needs.groups.map((g) => [g.kind, g]));

    // 金丝雀：跨系统类这次真的有需求，否则下面整段是空转恒真
    const crossWithNeeds = CROSS_KINDS.map((k) => byKind.get(k)!).filter((g) => g.needed > 0);
    expect(crossWithNeeds.length).toBeGreaterThan(0);

    for (const g of crossWithNeeds) {
      expect(g.evidence, `${g.kind} 建之前不可能查得到现状，却报了 PROBED`).toBe("NOT_PROBED");
      // 「查不到」必须落在 unknown 上，而不是被摊进 existing/toCreate/missing
      expect(g.unknown, `${g.kind} 查不到的条数被写成了别的态`).toBe(g.needed);
      expect(g.existing + g.toCreate + g.missing, `${g.kind} 把猜出来的状态当成了测出来的`).toBe(0);
      expect(g.items.every((i) => i.status === "UNKNOWN"), `${g.kind} 有条目被判成了确定状态`).toBe(true);
    }
    // 点名清单要与逐类结论一致（屏上那句「这几类现在还查不出」就读它）
    expect([...needs.unprobedKinds].sort()).toEqual(crossWithNeeds.map((g) => g.kind).sort());
    // 而且只有跨系统类才允许进这份点名清单
    for (const k of needs.unprobedKinds) expect(CROSS_KINDS as readonly string[]).toContain(k);
    await app.app.close();
  });

  it("§4 本系统这一侧的 6 类是**真查过**的：evidence=PROBED、零 UNKNOWN，且求解器缺了报「建不出来」不报「待建」", async () => {
    const { job, app } = await dryRun();
    const needs = job.needs as BuildNeedsReport;
    const byKind = new Map(needs.groups.map((g) => [g.kind, g]));

    for (const k of LOCAL_KINDS) {
      const g = byKind.get(k)!;
      expect(g.evidence, `${k} 明明查得到，却报了查不到`).toBe("PROBED");
      expect(g.unknown, `${k} 不该有查不到的条目`).toBe(0);
    }
    // 真查过的证据：本次故事确实倒推出了对象类型，而它们在空库里都还不存在 ⇒ 待建
    const types = byKind.get("ontology_type")!;
    expect(types.needed).toBeGreaterThan(0);
    expect(types.toCreate).toBe(types.needed);
    // 求解器是代码、不能自动建 —— 这次的两个都已注册，故复用数 = 需要数（缺了会落 missing 而非 toCreate）
    const solver = byKind.get("solver")!;
    expect(solver.needed).toBeGreaterThan(0);
    expect(solver.toCreate).toBe(0);
    await app.app.close();
  });
});
