import { describe, expect, it } from "vitest";
import { DEMO_TENANT, DEMO_DERIVATION_SPECS, seedDemoDerivationSpecs, seedDemoProcessLayer } from "../src/seed.js";
import { evaluate, parseFormula, type NavNode } from "../src/ontology-dsl.js";
import type { DerivationSpecRecord } from "../src/domain.js";
import type { Repos } from "../src/repo/repo.js";
import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * WO-DERIVSPEC-SEED · DerivationSpec 种子 × 物化值对账 · 接缝测试
 * （闭 §8 `G-DERIVSPEC-EMPTY` + `G-DERIVED-FORMULA-UNVERIFIED` 残口②）。
 *
 * ══ 判据（工单原文）═══════════════════════════════════════════════════════
 * 「`derivationSpecs.list(ACTIVE)` 三处消费点（认证装配 / process-inspect ⑭ /
 *   slices ⑭证据层）拿到**非空**且**与物化值对得上账**」——非空但对不上账不算闭。
 *
 * ══ 对账口径（为什么这样算数）═══════════════════════════════════════════════
 *  · **物化值** = 真跑生产 legacy 管线（synthetic job → `OntologyService.runDerivations`）
 *    写进 `obj.props[targetProp]` 的值 —— 测试 fixture 走 `POST /a/v1/synthetic/jobs` 本尊。
 *  · **规格侧值** = 同一台**生产 §2 DSL 求值器** `evaluate()`（ontology-core `recompute`
 *    第 490 行用的就是它，非复刻）对每条 ACTIVE 规格逐实例求值。
 *  · 两边逐实例比对（容差 1e-9）。9 条种子规格的选取与 5 条不种的诚实边界，
 *    见 seed.ts `DEMO_DERIVATION_SPECS` 头注（除法 4dp/6dp 分叉 · BY-field 聚合无单跳链路）。
 *
 * ══ 变异反证（本文件内真跑，不是另开脚本）══════════════════════════════════
 *  M1 把种子改坏一处（order_value 公式 +1）⇒ 对账扫描**必须**抓到 Order.value 不符；
 *  M2 把种子清空（全部置 RETIRED）⇒ 消费点共享读端**必须**回到空 ——
 *     证明「①非空」度量的是种子本身，不是恒绿哑断言。
 */

const J = <T>(r: { json: () => unknown }) => r.json() as T;

async function bootSeeded(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t); // 真跑生产种子+legacy 派生管线（物化值的唯一来源）
  await seedDemoDerivationSpecs(t.repos); // 本单种子（真编译链 compileSpecs）
  return t;
}

const activeSpecs = (repos: Repos) =>
  repos.derivationSpecs.list(DEMO_TENANT, (s) => s.status === "ACTIVE");

/**
 * 对账扫描（判据的本体，M1 变异复用同一函数 —— 扫不出不符的对账等于没对）。
 * 对每条 ACTIVE 规格：逐实例 evaluate(规格公式) vs obj.props[targetProp]，返回不符清单。
 */
async function reconcile(repos: Repos): Promise<string[]> {
  const specs = await activeSpecs(repos);
  // 与 ontology-core recompute 同语义预建导航索引：out=`${linkKey}|${fromId}` → toId 集。
  const links = await repos.links.list(DEMO_TENANT);
  const objectIndex = new Map<string, Record<string, unknown>>();
  const types = await repos.ontologyTypes.list(DEMO_TENANT, (x) => x.status === "ACTIVE");
  for (const ty of types) {
    for (const o of await repos.objects.listByType(DEMO_TENANT, ty.key)) objectIndex.set(o.id, o.props);
  }
  const mismatches: string[] = [];
  for (const spec of specs) {
    const ast = parseFormula(spec.formula); // 生产解析器本尊
    const targets = await repos.objects.listByType(DEMO_TENANT, spec.targetType);
    for (const obj of targets) {
      const navigate = (nav: NavNode): Record<string, unknown>[] => {
        const out: Record<string, unknown>[] = [];
        for (const l of links) {
          if (l.type !== nav.linkKey) continue;
          const otherId =
            nav.direction === "out" ? (l.fromId === obj.id ? l.toId : null) : (l.toId === obj.id ? l.fromId : null);
          if (!otherId) continue;
          const props = objectIndex.get(otherId);
          if (props) out.push(props);
        }
        return out;
      };
      const value = evaluate(ast, { self: obj.props, navigate, warn: () => {} });
      const stored = obj.props[spec.targetProp];
      const diff = Math.abs(Number(value) - Number(stored));
      if (!(diff <= 1e-9)) {
        mismatches.push(`${spec.specKey} @ ${obj.id}: eval=${String(value)} stored=${String(stored)}`);
      }
    }
  }
  return mismatches;
}

describe("WO-DERIVSPEC-SEED · DerivationSpec 种子对账", () => {
  it("① 消费点共享读端非空：恰 9 条 ACTIVE（金丝雀计数·现算），specKey 集合逐字对、deps 已缓存、id 确定性", async () => {
    const t = await bootSeeded();
    const specs = await activeSpecs(t.repos);
    // 金丝雀计数：9 = 7 自属性算术 + 2 真链路聚合（另 5 条不种的边界见 seed.ts 头注）。
    expect(specs.length).toBe(9);
    expect(specs.map((s) => s.specKey).sort()).toEqual(DEMO_DERIVATION_SPECS.map((d) => d.specKey).sort());
    for (const s of specs) {
      expect(s.id).toBe(`dspec_${s.specKey}`); // R6：确定性 id，重播幂等
      expect(s.deps.length).toBeGreaterThan(0); // 编译期 deps 缓存真的落了（不是空壳记录）
      expect(s.ontologyVersion).toBeGreaterThanOrEqual(0);
    }
    // 幂等：再播一遍，仍恰 9 条（同 id 覆盖，不翻倍）。
    await seedDemoDerivationSpecs(t.repos);
    expect((await activeSpecs(t.repos)).length).toBe(9);
  });

  it("② 逐实例对账：每条 ACTIVE 规格 × 全部目标实例，生产求值器算出的值 == legacy 管线物化的值", async () => {
    const t = await bootSeeded();
    const specs = await activeSpecs(t.repos);
    expect(specs.length).toBe(9);
    // 先证有（防空转）：每条规格至少要覆盖 1 个实例，合计覆盖面上百。
    let total = 0;
    for (const s of specs) {
      const n = (await t.repos.objects.listByType(DEMO_TENANT, s.targetType)).length;
      expect(n, `${s.specKey} 的目标类型 ${s.targetType} 零实例 ⇒ 对账空转`).toBeGreaterThan(0);
      total += n;
    }
    expect(total).toBeGreaterThan(100);
    const mismatches = await reconcile(t.repos);
    expect(mismatches, `对账不符：\n${mismatches.join("\n")}`).toEqual([]);
  });

  it("③ 消费点③端点级：slices ⑭证据层真长出 ds: 条目（order_fulfillment_360 真切片真路由）", async () => {
    const t = await bootSeeded();
    const order = (await t.repos.objects.listByType(DEMO_TENANT, "Order"))[0]!;
    const so = String(order.props.so);
    const res = await t.app.inject({
      method: "GET",
      url: `/a/v1/ontology/slices/order_fulfillment_360/layers?args=${encodeURIComponent(JSON.stringify({ so }))}`,
      headers: ADMIN,
    });
    expect(res.statusCode).toBe(200);
    const body = J<{ layers: { id: string; items: { key: string; group: string }[] }[] }>(res);
    const evidence = body.layers.find((l) => l.id === "evidence");
    expect(evidence, "十六层里必须有 ⑭证据层").toBeTruthy();
    const dsKeys = evidence!.items.filter((i) => i.group === "派生溯源规格").map((i) => i.key);
    // 该切片含 Order/Model ⇒ 至少 order_value / model_total_demand / model_order_count 三条进层。
    expect(dsKeys).toContain("ds:order_value");
    expect(dsKeys).toContain("ds:model_total_demand");
    expect(dsKeys).toContain("ds:model_order_count");
  });

  it("④ 消费点②端点级：process-inspect ⑭证据层同样长出 ds: 条目（P22 承载 Model）", async () => {
    const t = await bootSeeded();
    await seedDemoProcessLayer(t.repos);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/process-definitions/P22/inspect", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = J<{ carrierLayers: { layers: { id: string; items: { key: string; group: string }[] }[] } | null }>(res);
    const evidence = body.carrierLayers?.layers.find((l) => l.id === "evidence");
    expect(evidence, "process-inspect 十六层里必须有 ⑭证据层").toBeTruthy();
    const dsKeys = evidence!.items.filter((i) => i.group === "派生溯源规格").map((i) => i.key);
    expect(dsKeys).toContain("ds:model_total_demand");
    expect(dsKeys).toContain("ds:model_order_count");
  });

  it("⑤ 变异 M1：把种子改坏一处（order_value +1）⇒ 对账扫描必须红并指认 Order.value", async () => {
    const t = await bootSeeded();
    expect(await reconcile(t.repos)).toEqual([]); // 改之前是干净的（变异基线）
    const good = (await activeSpecs(t.repos)).find((s) => s.specKey === "order_value")!;
    const broken: DerivationSpecRecord = { ...good, formula: "this.qty * this.unitPrice + 1" };
    await t.repos.derivationSpecs.put(broken);
    const mismatches = await reconcile(t.repos);
    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches.every((m) => m.startsWith("order_value @")), `变异只应打中 order_value：\n${mismatches.join("\n")}`).toBe(true);
  });

  it("⑥ 变异 M2：把种子清空（全部置 RETIRED）⇒ 消费点共享读端回到空（证明①的非空是种子给的）", async () => {
    const t = await bootSeeded();
    expect((await activeSpecs(t.repos)).length).toBe(9); // 变异基线
    for (const s of await activeSpecs(t.repos)) {
      await t.repos.derivationSpecs.put({ ...s, status: "RETIRED" });
    }
    expect((await activeSpecs(t.repos)).length).toBe(0);
  });
});
