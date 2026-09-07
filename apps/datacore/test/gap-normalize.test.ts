import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

type Root = { rootMetric: { key: string; name: string; gap: number; unit: string; target: number; actual: number } };

/** 直接改对象库里某条 Metric 的属性（反事实实验用·不碰种子）。 */
async function patchMetric(t: TestApp, metricId: string, patch: Record<string, unknown>): Promise<void> {
  const rows = await t.repos.objects.listByType(ADMIN.tenantId, "Metric");
  const row = rows.find((o) => String(o.props.metricId) === metricId)!;
  await t.repos.objects.put({ ...row, props: { ...row.props, ...patch } });
}

async function defaultRoot(t: TestApp): Promise<Root["rootMetric"]> {
  return ((await t.services.solvers.invoke(ADMIN, "gap_attribution", {})) as unknown as Root).rootMetric;
}

/**
 * **修前**那把尺子的一比一复刻（`(target−actual)` 裸差降序 + reverse 的并列次序）。
 * 留在这里是为了让「修前 / 修后」两列能在**同一份数据、同一次运行**里并排打出来——
 * 否则「修后是这个数」只是一句孤证，读者没法自己判断修法有没有改变什么。
 */
async function legacyRootKey(t: TestApp): Promise<string> {
  const rows = (await t.repos.objects.listByType(ADMIN.tenantId, "Metric")).map((o) => o.props);
  const breached = rows.filter((p) => Number(p.actual) < Number(p.floorVal));
  const absGap = (p: Record<string, unknown>) => Number(p.target) - Number(p.actual);
  return String(
    [...(breached.length ? breached : rows)]
      .sort((a, b) => absGap(a) - absGap(b) || String(a.metricId).localeCompare(String(b.metricId)))
      .reverse()[0]!.key,
  );
}

describe("PROBE · WO-GAP-NORMALIZE 五格对照实验", () => {
  it("EXP1 · 相对缺口排序：给出越线集的相对缺口表 + 新第一名", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const rows = (await t.repos.objects.listByType(ADMIN.tenantId, "Metric")).map((o) => o.props);
    const tbl = rows
      .filter((p) => Number(p.actual) < Number(p.floorVal))
      .map((p) => ({
        metricId: String(p.metricId), unit: String(p.unit),
        absGap: Number(p.target) - Number(p.actual),
        relGap: (Number(p.target) - Number(p.actual)) / Math.abs(Number(p.target)),
      }))
      .sort((a, b) => b.relGap - a.relGap);
    // eslint-disable-next-line no-console
    console.log("=== EXP1 越线集 ===");
    for (const r of tbl) {
      // eslint-disable-next-line no-console
      console.log(`  ${r.metricId.padEnd(16)} 裸差=${r.absGap.toFixed(4)} ${r.unit.padEnd(3)} 相对缺口=${r.relGap.toFixed(4)}`);
    }
    const root = await defaultRoot(t);
    // eslint-disable-next-line no-console
    console.log("=== EXP1 修后缺省根 ===", JSON.stringify(root), "相对缺口=", (root.gap / root.target).toFixed(4));
    expect(root.key).toBe("revenue");
  });

  it("EXP2 · 反向对照：营收 actual 还原成 700（不越线）⇒ 缺省根必须回到 kpi-seg-ess", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await defaultRoot(t);
    await patchMetric(t, "kpi-revenue", { actual: 700 });
    const after = await defaultRoot(t);
    // eslint-disable-next-line no-console
    console.log(`=== EXP2 === 营收 actual 415.6 ⇒ 根=${before.key} ；营收 actual 700 ⇒ 根=${after.key}`);
    expect(before.key).toBe("revenue");
    expect(after.key).toBe("seg_attain_ess");
  });

  it("EXP3 · 量纲不变性：营收改记「万元」(×1e4) / 「万亿」(÷1e4) ⇒ 缺省根必须不变", async () => {
    const base = await (async () => { const t = await makeApp(); await seedBattery(t); return (await defaultRoot(t)).key; })();

    // ×1e4：亿 → 万元（业务含义一字未变，只换记账单位）
    const tUp = await makeApp(); await seedBattery(tUp);
    await patchMetric(tUp, "kpi-revenue", { unit: "万元", target: 700 * 1e4, actual: 415.6 * 1e4, floorVal: 686 * 1e4 });
    const up = await defaultRoot(tUp); const upLegacy = await legacyRootKey(tUp);

    // ÷1e4：亿 → 万亿
    const tDn = await makeApp(); await seedBattery(tDn);
    await patchMetric(tDn, "kpi-revenue", { unit: "万亿", target: 700 / 1e4, actual: 415.6 / 1e4, floorVal: 686 / 1e4 });
    const dn = await defaultRoot(tDn); const dnLegacy = await legacyRootKey(tDn);

    const tBase = await makeApp(); await seedBattery(tBase); const baseLegacy = await legacyRootKey(tBase);
    // eslint-disable-next-line no-console
    console.log(`=== EXP3 量纲不变性 ===`);
    // eslint-disable-next-line no-console
    console.log(`  修前（裸差）  亿:${baseLegacy} | 万元(×1e4):${upLegacy} | 万亿(÷1e4):${dnLegacy}`);
    // eslint-disable-next-line no-console
    console.log(`  修后（相对）  亿:${base} | 万元(×1e4):${up.key} | 万亿(÷1e4):${dn.key}`);
    expect(up.key, "换成万元后根指标不许变").toBe(base);
    expect(dn.key, "换成万亿后根指标不许变").toBe(base);
    // 判据自证有鉴别力：修前那把尺子在同一组数据上**必须**被单位换算掀翻，否则这格实验什么都没验。
    expect(new Set([baseLegacy, upLegacy, dnLegacy]).size, "修前的裸差尺子必须随单位而变（否则本实验无鉴别力）").toBeGreaterThan(1);
  });

  it("EXP5 · 金丝雀：拿一个确定会变的输入跑一遍，缺省根必须变（证明量法有鉴别力）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await defaultRoot(t);
    // 把储能达成率压到相对缺口 0.90（远超营收 0.4063）⇒ 缺省根必须变成它
    await patchMetric(t, "kpi-seg-ess", { actual: 10 });
    const after = await defaultRoot(t);
    // eslint-disable-next-line no-console
    console.log(`=== EXP5 金丝雀 === 改前根=${before.key} ；储能 actual 72.2→10 后根=${after.key}`);
    expect(after.key, "金丝雀必须变；不变 ⇒ 量法坏了").not.toBe(before.key);
    expect(after.key).toBe("seg_attain_ess");
  });

  it("病② · scope.baseId 不再被专属域吞掉（5 个 metricKey 全回显 + 出 base 树）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    for (const mk of ["revenue", "cash", "demand_attain", "seg_attain_ess", "market_share"]) {
      const g = (await t.services.solvers.invoke(ADMIN, "gap_attribution", {
        metricKey: mk, scope: { baseId: "jiangmen" },
      })) as unknown as { scope?: { baseId?: string }; levels: { depth: number; nodes: { id: string }[] }[] };
      const l1 = g.levels.find((L) => L.depth === 1);
      // eslint-disable-next-line no-console
      console.log(`  metricKey=${mk.padEnd(16)} scope.baseId=${String(g.scope?.baseId)} L1=[${(l1?.nodes ?? []).map((n) => n.id).join(",")}]`);
      expect(g.scope?.baseId, `${mk} 应回显 scope.baseId`).toBe("jiangmen");
    }
  });

  it("病② 回归护栏 · 不给 scope.baseId 时域路由逐字节不变（R6）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    for (const mk of ["revenue", "cash", "demand_attain", "market_share"]) {
      const g = (await t.services.solvers.invoke(ADMIN, "gap_attribution", { metricKey: mk })) as unknown as {
        scope?: unknown; levels: { depth: number; nodes: { id: string }[] }[];
      };
      const l1 = g.levels.find((L) => L.depth === 1);
      const ids = (l1?.nodes ?? []).map((n) => n.id);
      // eslint-disable-next-line no-console
      console.log(`  metricKey=${mk.padEnd(16)} (无 scope) L1=[${ids.join(",")}] scope=${String(g.scope)}`);
      expect(g.scope, "无 scope 时不回显 scope").toBeUndefined();
      expect(ids.some((i) => i.startsWith("metricgap:") || i.startsWith("share:")), `${mk} 应仍走专属域`).toBe(true);
    }
  });
});
