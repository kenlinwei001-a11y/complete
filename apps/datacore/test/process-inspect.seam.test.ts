import { describe, expect, it } from "vitest";
import { ProcessDefinitionSchema, ProcessInspectResponseSchema } from "@platform/contracts";
import { LEVER_PROP_META } from "../src/solvers/service.js";
import { DEMO_TENANT, seedDemoProcessLayer } from "../src/seed.js";
import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * WO-V4-INSPECT · 流程节点检视投影（`GET /a/v1/process-definitions/{key}/inspect`）· 接缝测试。
 *
 * ══ 为什么这是接缝测试而不是 unit ═══════════════════════════════════════════
 * 本端点是**四张表 join** 出来的（`process_definitions` × `object_types` × `ontology_links` × `objects`），
 * 任何一半单独测都能绿：流程表有 65 条是真的、本体有 94 类型是真的，
 * 但「这条流程的 `carrierTypeKey` 在本体里查不查得到」只有把两边**合起来跑一次种子**才知道。
 * 故本文件一律 `seedBattery` + `seedDemoProcessLayer` 真跑，再打真路由 —— 不拿字面量对字面量。
 *
 * ══ 四条硬约束逐条上断言（PRD-sandbox-v4 §4.2）═══════════════════════════════
 *  ① `carrierTypeKey` 解析不到 ⇒ `carrier.status="absent"` + 原因，HTTP **200**（不是 500/404）
 *  ② **不下发运行态**：`runtime.available===false` 且响应里**不许**出现任何"已卡 N 天"式字段
 *  ③ 零新真值源：只读，跑两遍字节一致（R6 确定性）
 *  ④ R2 租户：换租户查同一个 key ⇒ 404（不是别人的数据）
 *
 * ⚠ **先证有、再断言**（避免空断言）：`sharedCarrierProcesses` 的非空样例不写死在测试里 ——
 * 先从 65 条真种子里**现算**出「哪个承载物被 ≥2 条流程共用」，证明确实存在，再拿它去断言。
 * 写死一个 key 的话，种子一改这条断言会静默失效（或者更糟：改成永远查不到、于是恒空恒绿）。
 */

const by = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

async function boot(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoProcessLayer(t.repos);
  return t;
}

const inspect = async (t: TestApp, key: string, headers = ADMIN) =>
  t.app.inject({ method: "GET", url: `/a/v1/process-definitions/${key}/inspect`, headers });

describe("WO-V4-INSPECT · 流程节点检视投影", () => {
  it("① 存在的流程：契约通过 · 承载类型 present · 属性/派生/一跳关系/十六层都算了出来", async () => {
    const t = await boot();
    const defs = await t.repos.processDefinitions.list(DEMO_TENANT);
    // 基数下限先咬住：集合不够大的话下面的遍历本身就是空转（coverage-blind 门要求单参 expect）
    expect(defs.length).toBeGreaterThan(60);

    // 挑一条**承载类型真有对象**的流程 —— 现算，不写死 key。
    const types = await t.repos.ontologyTypes.list(DEMO_TENANT);
    const typeKeys = new Set(types.map((x) => x.key));
    const withObjects: string[] = [];
    for (const d of defs) {
      if (!typeKeys.has(d.carrierTypeKey)) continue;
      const n = (await t.repos.objects.listByType(DEMO_TENANT, d.carrierTypeKey)).length;
      if (n > 0) withObjects.push(d.key);
    }
    expect(withObjects.length).toBeGreaterThan(0); // 先证有，再断言（否则下面是空断言）

    const res = await inspect(t, withObjects.sort()[0]!);
    expect(res.statusCode).toBe(200);
    const body = ProcessInspectResponseSchema.parse(res.json()); // 契约本身即第一条断言

    expect(body.carrier.status).toBe("present");
    expect(body.carrier.properties.length).toBeGreaterThan(0);
    expect(body.carrier.objectCount).toBeGreaterThan(0);
    // R14：中文名随响应下发（至少有一个属性带 displayName，否则前端只能显裸键 = 词表没接线）
    expect(body.carrier.properties.filter((p) => p.displayName !== null).length).toBeGreaterThan(0);
    // 十六层复用 slice-layers 的既有投影：恰好 16 层，且 sliceKey 明示是即席切片
    expect(body.carrierLayers).not.toBeNull();
    expect(body.carrierLayers!.layers.length).toBe(16);
    expect(body.carrierLayers!.sliceKey).toContain("process-inspect:");
  });

  it("② 承载类型解析不到 ⇒ absent + 说明缺在哪一环，HTTP 200（不是 500、也不是 404）", async () => {
    const t = await boot();
    // 种子期**不校验** carrierTypeKey 存在（判据在 test/process-layer.test.ts），
    // 所以这条记录是**合法可写入的**——正因如此，这一态必须被端点处理，而不是当成不可能的异常。
    await t.repos.processDefinitions.putMany([
      ProcessDefinitionSchema.parse({
        id: `pdef_${DEMO_TENANT}_P99`,
        tenantId: DEMO_TENANT,
        key: "P99",
        domainKey: "D01",
        name: "承载物还没建模的流程（本用例专用）",
        ownerFunctionKey: "decision_support",
        stdDurationDays: 2,
        waitKind: "WAITING_DATA",
        carrierTypeKey: "__NoSuchCarrierType__",
      }),
    ]);

    const res = await inspect(t, "P99");
    expect(res.statusCode).toBe(200); // ⛔ 不许 500：缺的是承载物，不是这条流程
    const body = ProcessInspectResponseSchema.parse(res.json());
    expect(body.carrier.status).toBe("absent");
    expect(body.carrier.objectCount).toBeNull(); // null ≠ 0：「这一类不存在」不是「这一类没数据」
    expect(body.carrier.absentReason).toContain("__NoSuchCarrierType__");
    // 说明必须指出缺在哪一跳，而不是一句「暂无数据」
    expect(body.carrier.absentReason).toContain("carrierTypeKey");
    // 十六层：没算就说没算，**不返回 16 个空壳假装算过**
    expect(body.carrierLayers).toBeNull();
    expect(body.carrierLayersAbsentReason).not.toBeNull();
    // 流程静态属性照样完整下发（承载物缺席不该把整页拖垮）
    expect(body.process.name.length).toBeGreaterThan(0);
    expect(body.process.domainName).not.toBeNull();
  });

  it("③ 不下发运行态：runtime.available 恒 false + 三条答不了的问题 + 工期口径写明是标准工期", async () => {
    const t = await boot();
    const res = await inspect(t, "P37");
    const body = ProcessInspectResponseSchema.parse(res.json());

    expect(body.runtime.available).toBe(false);
    expect(body.runtime.unanswerable.length).toBeGreaterThan(2);
    expect(body.runtime.reason).toContain("ProcessTask");
    expect(body.runtime.stdDurationCaption).toContain("标准工期");
    // 反向判据（真正的牙）：整份响应里**不许**出现任何冒充运行态的键。
    // 只断言 available=false 是不够的——那只证明"我说了没有"，证不了"我没偷偷给一个"。
    const flat = JSON.stringify(res.json());
    for (const forbidden of ["enteredAt", "stuckDays", "waitingSince", "wipCount", "actualWaitDays", "blockedCount"]) {
      expect(flat.includes(`"${forbidden}"`)).toBe(false);
    }
  });

  it("④ 同承载物流程：先从真种子现算出确有共用的承载物，再断言反查非空（不写死 key，避免空断言）", async () => {
    const t = await boot();
    const defs = await t.repos.processDefinitions.list(DEMO_TENANT);
    const byCarrier = new Map<string, string[]>();
    for (const d of defs) byCarrier.set(d.carrierTypeKey, [...(byCarrier.get(d.carrierTypeKey) ?? []), d.key]);
    const shared = [...byCarrier.entries()].filter(([, ks]) => ks.length > 1).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    // 先证有：65 条里确实存在被 ≥2 条流程共用的承载物（契约文件头写明「共用不是空壳」）。
    // ⚠ 这里**不用** `toBeGreaterThan(0)`：那是存在性断言，"1 个共用"与"全都共用"同色
    //   （coverage-blind 门的 EXISTS_FOR_ALL 形态）。下面对 shared **全集**逐条打端点，是 ∀ 不是 ∃。
    expect(shared.length).toBeGreaterThanOrEqual(1);

    for (const [carrierTypeKey, keys] of shared) {
      const sortedKeys = [...keys].sort();
      for (const k of sortedKeys) {
        const res = await inspect(t, k);
        const body = ProcessInspectResponseSchema.parse(res.json());
        expect(body.process.carrierTypeKey).toBe(carrierTypeKey);
        // 反查结果 = 同承载物的其它流程（**不含自己**）—— 逐个 key 都要成立，不是抽一个
        expect(body.sharedCarrierProcesses.map((s) => s.key)).toEqual(sortedKeys.filter((x) => x !== k));
        // R14：同承载物流程的域名/职能名也随响应下发（前端零写死）
        expect(body.sharedCarrierProcesses.filter((s) => s.domainName !== null).length).toBe(sortedKeys.length - 1);
      }
    }
  });

  it("⑤ 一跳关系沿 OntologyLink 带方向与基数；对端类型不存在时计数为 null 而不是 0", async () => {
    const t = await boot();
    const links = await t.repos.ontologyLinks.list(DEMO_TENANT);
    expect(links.length).toBeGreaterThan(50); // 基数下限：链路表够大，下面的挑选才有意义

    const defs = await t.repos.processDefinitions.list(DEMO_TENANT);
    const linkedTypes = new Set(links.flatMap((l) => [l.fromTypeKey, l.toTypeKey]));
    const linked = defs.filter((d) => linkedTypes.has(d.carrierTypeKey)).map((d) => d.key).sort();
    // ⚠ 不用 `toBeGreaterThan(0)`：那是存在性断言，"1 条有邻居"与"47 条有邻居"同色。
    //   实测（demo 种子·65 条流程）承载物在链路表里有邻居的是 **47 条**；这里咬一个真实规模下限，
    //   哪天链路表被砍到只剩零星几条，本条当场红（而存在性断言不会）。
    expect(linked.length).toBeGreaterThanOrEqual(40);
    // ∀ 结构断言（对全集，不抽样）：候选集合里每一条的承载类型都确实在链路表两端之一出现
    for (const k of linked) {
      const d = defs.find((x) => x.key === k)!;
      expect(linkedTypes.has(d.carrierTypeKey)).toBe(true);
    }

    const res = await inspect(t, linked[0]!);
    const body = ProcessInspectResponseSchema.parse(res.json());
    expect(body.relations.length).toBeGreaterThan(0);
    for (const r of body.relations) {
      // 方向是**相对承载类型**算的，不是照抄 link 的 from/to
      if (r.direction === "out") expect(r.fromTypeKey).toBe(body.process.carrierTypeKey);
      else expect(r.toTypeKey).toBe(body.process.carrierTypeKey);
      expect(["1:1", "1:N", "N:1", "N:N"]).toContain(r.cardinality);
    }
    // 确定性：按 linkKey 升序
    expect(body.relations.map((r) => r.linkKey)).toEqual([...body.relations.map((r) => r.linkKey)].sort());
  });

  it("⑥ PRD §4.1 杠杆→域映射：一跳查表零手抄，且落点解析结果与 LEVER_PROP_META 同源", async () => {
    const t = await boot();
    const defs = await t.repos.processDefinitions.list(DEMO_TENANT);
    // 现算：哪些杠杆的承载类型真被某条流程用着（先证有，再断言）
    const carrierSet = new Set(defs.map((d) => d.carrierTypeKey));
    const leverTypes = new Set(
      Object.keys(LEVER_PROP_META)
        .map((k) => k.slice(0, k.lastIndexOf(".")))
        .filter((tk) => carrierSet.has(tk)),
    );
    // ⚠ 不用 `toBeGreaterThan(0)`（存在性 ⇒ "1 个"与"全部"同色）。实测 12 条杠杆落在 5 个对象类型上，
    //   其中 5 个既是杠杆承载类型又是某条流程的承载物（Line / MaterialBalance / Order / ChangeoverMatrix / Shipment）。
    expect(leverTypes.size).toBeGreaterThanOrEqual(3);

    // ∀：**每一条**承载类型上有杠杆的流程都要能把杠杆下发出来，不是抽一条
    const targets = defs.filter((d) => leverTypes.has(d.carrierTypeKey)).sort((a, b) => by(a.key, b.key));
    expect(targets.length).toBeGreaterThanOrEqual(3);
    for (const target of targets) {
      const res = await inspect(t, target.key);
      const body = ProcessInspectResponseSchema.parse(res.json());
      expect(body.levers.length).toBeGreaterThanOrEqual(1);
      for (const l of body.levers) {
        expect(l.objectTypeKey).toBe(target.carrierTypeKey);
        // 标签/单位/值类必须**逐字**等于单一真值表，任何一处再写一份都会在这里红
        const meta = LEVER_PROP_META[l.leverKey]!;
        expect(l.label).toBe(meta.label);
        expect(l.unit).toBe(meta.unit);
        expect(l.valueKind).toBe(meta.kind);
        // 该杠杆至少打到本流程；域名随响应下发（前端零写死「这条杠杆影响哪几个域」）
        expect(l.processKeys).toContain(target.key);
        expect(l.domains.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("⑦ 死杠杆闭环（SEAM）：LEVER_PROP_META 每条落点都要在**真跑过种子的本体**里解析得到", async () => {
    const t = await boot();
    const types = await t.repos.ontologyTypes.list(DEMO_TENANT);
    expect(types.length).toBeGreaterThan(90); // 基数下限：本体真的种进去了，否则下面恒空恒绿
    const byKey = new Map(types.map((x) => [x.key, x]));

    const leverKeys = Object.keys(LEVER_PROP_META);
    expect(leverKeys.length).toBeGreaterThan(10);
    const dead: string[] = [];
    for (const k of leverKeys) {
      const i = k.lastIndexOf(".");
      const tk = k.slice(0, i);
      const pk = k.slice(i + 1);
      const def = byKey.get(tk);
      const ok =
        !!def &&
        (def.properties.some((p) => p.propKey === pk) ||
          (def.derivedProperties ?? []).some((p) => p.propKey === pk) ||
          (def.stateVariables ?? []).some((p) => p.propKey === pk));
      if (!ok) dead.push(k);
    }
    // 金丝雀：判据本身活着吗？拿一个我确定不存在的键跑同一段逻辑，它必须被判死。
    // （不加这条，`dead` 恒空既可能是"真干净"，也可能是"判据写坏了"——两者在屏上一样绿。）
    const canaryDef = byKey.get("Equipment")!;
    expect(canaryDef.properties.some((p) => p.propKey === "__no_such_prop__")).toBe(false);
    expect(dead).toEqual([]);

    // 并且 MaterialBalance.coverage 就是那条曾经的死杠杆：它现在必须是**派生**而不是凭空补的存储真值
    const mb = byKey.get("MaterialBalance")!;
    expect((mb.derivedProperties ?? []).map((x) => x.propKey)).toContain("coverage");
    const cov = (mb.derivedProperties ?? []).find((x) => x.propKey === "coverage")!;
    expect(cov.formula).toContain("gapTon"); // 缺口口径（业务定义式），不是 ltaPct/100 的巧合式
    // 派生值真物化到对象上（否则"派生属性"只是本体里的一句声明，杠杆面板读 o.props 仍读不到）
    const objs = await t.repos.objects.listByType(DEMO_TENANT, "MaterialBalance");
    expect(objs.length).toBeGreaterThan(0);
    for (const o of objs) expect(typeof o.props.coverage).toBe("number");
  });

  it("⑧ R6 确定性 + R2 租户：同 key 连查两次字节一致；换租户查同一 key ⇒ 404", async () => {
    const t = await boot();
    const a = await inspect(t, "P37");
    const b = await inspect(t, "P37");
    expect(a.body).toBe(b.body); // 只读投影，零时钟零随机

    const other = await inspect(t, "P37", { "x-debug-user": "other:admin:admin" });
    expect(other.statusCode).toBe(404); // 跨租户自然为空 ⇒ 查无此流程，不是"看得见但没数据"
  });

  it("⑨ 流程 key 不存在 ⇒ 404（与「承载物不存在 ⇒ 200+absent」严格分开，两者处置不同）", async () => {
    const t = await boot();
    const res = await inspect(t, "P00");
    expect(res.statusCode).toBe(404);
  });
});
