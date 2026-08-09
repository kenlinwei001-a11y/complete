import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHAIN_NODE_REGISTRY,
  PROCESS_OWNER_FUNCTION_KEYS,
  PROCESS_WAIT_KINDS,
  ProcessDefinitionSchema,
  ProcessDomainSchema,
} from "@platform/contracts";
import { BUSINESS_DOMAIN_KEYS } from "../src/graphmeta.js";
import { seedDemoProcessLayer, DEMO_TENANT } from "../src/seed.js";
import { makeApp, seedBattery } from "./helpers.js";

/**
 * WO-Q0 · 业务流程层（13 一级业务域 × 65 核心业务流程）。
 *
 * 本文件的两条**头号断言**（工单 §4 点名要「会红的效果层断言」）：
 *  ① 每条 `ProcessDefinition.carrierTypeKey` 在**真跑过种子的本体**里查得到该类型（防空壳·红线 3）；
 *  ② `CHAIN_NODE_REGISTRY` 的 24 个 id **一个没变**（防误伤 S0 冻结表·红线 1）。
 *
 * ⚠ 断言① 必须**真跑一遍合成种子**再去查本体，不许拿源码里的字面量表对字面量表 ——
 * 那样测的是「我抄得对不对」，不是「本体里到底有没有」。这两件事在本仓已经分开过一次：
 * 「接了线没数据」与「没接线」修法完全不同，判据就是看有没有真跑。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_APP = join(__dirname, "..");

// ══════════════════════════════════════════════════════════════════════════
// 断言② · CHAIN_NODE_REGISTRY 的 24 个 id 一个没变（红线 1）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 金值（逐字取自 `packages/contracts/src/chain-sim.ts` `CHAIN_NODE_REGISTRY`）。
 *
 * 前 12 条是 S0 冻结的原表 —— 契约自己写着「**一个 id 都没动**：改任何一个已在册 id =
 * 把『交集为 0』的事故复现一遍（消费方按 id 查表，改 id 就是断链）」。
 * 后 12 条是 WO-CHAIN-24 追加，**只在末位追加**，故下标语义对前 12 条稳定
 * （前端 `node-inspector-reachable.test.tsx` 就按 `[4] === capacity.schedule` 取样）。
 *
 * 本单（流程层）**只增数据表，一个字都不碰 `chain-sim.ts`**。这条金值就是那句承诺的机器化形式：
 * 谁在做流程层时顺手动了那张表，这里当场红。
 */
const FROZEN_24_CHAIN_NODE_IDS = [
  // 原表 12 条（S0 冻结）
  "demand.consensus",
  "order.review",
  "order.cash",
  "order.settlement",
  "capacity.schedule",
  "capacity.qc_batch",
  "capacity.quality",
  "capacity.aging",
  "capacity.maint",
  "material.mrp",
  "material.replenish",
  "material.shipping",
  // WO-CHAIN-24 末位追加 12 条
  "demand.forecast",
  "demand.quote",
  "capacity.rccp",
  "capacity.wo_release",
  "material.kitting",
  "material.purchase_req",
  "material.purchase_order",
  "material.inbound_transit",
  "material.iqc",
  "delivery.fg_stock",
  "delivery.transit",
  "delivery.acceptance",
] as const;

describe("WO-Q0 断言② · CHAIN_NODE_REGISTRY 24 节点冻结（红线 1：本单不许碰）", () => {
  it("24 个 id 逐条逐序不变（改一个字/挪一个位/加一条都红）", () => {
    expect(CHAIN_NODE_REGISTRY.map((n) => n.nodeId)).toEqual([...FROZEN_24_CHAIN_NODE_IDS]);
  });

  it("前 12 条的**下标语义**稳定（新增只许追加在末位）", () => {
    // 与前端 node-inspector-reachable.test.tsx 同一个取样点：下标 4 必须仍是主计划排产。
    expect(CHAIN_NODE_REGISTRY[4]?.nodeId).toBe("capacity.schedule");
    expect(CHAIN_NODE_REGISTRY[0]?.nodeId).toBe("demand.consensus");
    expect(CHAIN_NODE_REGISTRY[11]?.nodeId).toBe("material.shipping");
  });

  it("流程层与节拍层是两套 key 空间，不许互相冒充（P## / D## 一个都不许出现在节拍表里）", () => {
    for (const n of CHAIN_NODE_REGISTRY) {
      expect(n.nodeId).not.toMatch(/^[PD]\d{2}$/);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 词表单源（工单 §2：否则复现「两个 dev 各发明一套词表、交集为 0」）
// ══════════════════════════════════════════════════════════════════════════

describe("WO-Q0 · waitKind 词表单源（REQ057 减 WAITING_APPROVAL）", () => {
  it("恰好四种，且**没有** WAITING_APPROVAL（仓主已裁『流程审批不体现』）", () => {
    expect([...PROCESS_WAIT_KINDS]).toEqual([
      "WAITING_USER",
      "WAITING_DATA",
      "WAITING_EXTERNAL_SYSTEM",
      "WAITING_SCHEDULE",
    ]);
    expect(PROCESS_WAIT_KINDS).not.toContain("WAITING_APPROVAL");
  });

  it("schema 拒收词表外的值（含 WAITING_APPROVAL）——契约层就挡住，不靠自觉", () => {
    const base = {
      id: "pdef_t_P01", tenantId: "t", key: "P01", domainKey: "D01", name: "x",
      ownerFunctionKey: "sales", stdDurationDays: 1, carrierTypeKey: "Order",
    };
    expect(() => ProcessDefinitionSchema.parse({ ...base, waitKind: "WAITING_APPROVAL" })).toThrow();
    expect(() => ProcessDefinitionSchema.parse({ ...base, waitKind: "waiting_user" })).toThrow();
    expect(ProcessDefinitionSchema.parse({ ...base, waitKind: "WAITING_USER" }).waitKind).toBe("WAITING_USER");
  });

  it("stdDurationDays 必须为正（0 天的『流程』是一次记账动作，不是流程）", () => {
    const base = {
      id: "pdef_t_P01", tenantId: "t", key: "P01", domainKey: "D01", name: "x",
      ownerFunctionKey: "sales", waitKind: "WAITING_USER" as const, carrierTypeKey: "Order",
    };
    expect(() => ProcessDefinitionSchema.parse({ ...base, stdDurationDays: 0 })).toThrow();
    expect(() => ProcessDefinitionSchema.parse({ ...base, stdDurationDays: -1 })).toThrow();
    expect(ProcessDefinitionSchema.parse({ ...base, stdDurationDays: 0.5 }).stdDurationDays).toBe(0.5);
  });

  it("carrierTypeKey 不许为空串（红线 3 的形状层第一道；真判据在断言①）", () => {
    expect(() =>
      ProcessDefinitionSchema.parse({
        id: "pdef_t_P01", tenantId: "t", key: "P01", domainKey: "D01", name: "x",
        ownerFunctionKey: "sales", stdDurationDays: 1, waitKind: "WAITING_USER", carrierTypeKey: "",
      }),
    ).toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 种子：13 域 + 65 流程
// ══════════════════════════════════════════════════════════════════════════

describe("WO-Q0 · 13 域 × 65 流程种子", () => {
  it("恰好 13 域 · 65 流程，key 形如 D01/P01 且无重号无断号", async () => {
    const t = await makeApp();
    await seedDemoProcessLayer(t.repos);

    const domains = await t.repos.processDomains.list(DEMO_TENANT);
    const defs = await t.repos.processDefinitions.list(DEMO_TENANT);
    expect(domains).toHaveLength(13);
    expect(defs).toHaveLength(65);

    // 无重号 + 无断号：D01..D13 / P01..P65 连续（漏建一条会红，而不是悄悄少一条）
    expect(domains.map((d) => d.key).sort()).toEqual(
      Array.from({ length: 13 }, (_, i) => `D${String(i + 1).padStart(2, "0")}`),
    );
    expect(defs.map((p) => p.key).sort()).toEqual(
      Array.from({ length: 65 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`),
    );

    // 逐条过 schema（种子直接写对象字面量，漏字段/多字段都要在这里炸）
    for (const d of domains) expect(() => ProcessDomainSchema.parse(d)).not.toThrow();
    for (const p of defs) expect(() => ProcessDefinitionSchema.parse(p)).not.toThrow();
  });

  it("每条 P## 四件齐（谁做 / 多久 / 哪种等待 / 承载物），且 domainKey 真能解析到域", async () => {
    const t = await makeApp();
    await seedDemoProcessLayer(t.repos);
    const domainKeys = new Set((await t.repos.processDomains.list(DEMO_TENANT)).map((d) => d.key));
    const defs = await t.repos.processDefinitions.list(DEMO_TENANT);

    for (const p of defs) {
      expect(domainKeys.has(p.domainKey), `${p.key} 的 domainKey=${p.domainKey} 没有对应的域`).toBe(true);
      expect(PROCESS_OWNER_FUNCTION_KEYS, `${p.key} 的 ownerFunctionKey 不在登记册里`).toContain(p.ownerFunctionKey);
      expect(p.stdDurationDays).toBeGreaterThan(0);
      expect(PROCESS_WAIT_KINDS).toContain(p.waitKind);
      expect(p.carrierTypeKey.length).toBeGreaterThan(0);
    }
    // 13 个域**每个都得有流程**——空域是另一种空壳
    const byDomain = new Map<string, number>();
    for (const p of defs) byDomain.set(p.domainKey, (byDomain.get(p.domainKey) ?? 0) + 1);
    for (const k of domainKeys) expect(byDomain.get(k), `域 ${k} 一条流程都没有`).toBeGreaterThan(0);
  });

  it("🔴 每个 D## 锚到既有 14 域注册表（不新造第二套业务域词表）", async () => {
    const t = await makeApp();
    await seedDemoProcessLayer(t.repos);
    const domains = await t.repos.processDomains.list(DEMO_TENANT);

    // 🐤 金丝雀：先证明"锚点集合"这个判据本身是活的（BUSINESS_DOMAIN_KEYS 若为空，下面的循环恒真）。
    expect(BUSINESS_DOMAIN_KEYS.length).toBe(14);
    expect(BUSINESS_DOMAIN_KEYS).toContain("plan");

    for (const d of domains) {
      expect(BUSINESS_DOMAIN_KEYS, `${d.key}(${d.name}) 的锚点 ${d.businessDomainKey} 不在 14 域注册表里`)
        .toContain(d.businessDomainKey);
    }
    // 13 个流程域锚到 13 个**不同**的业务域（1:1，不许两个 D## 挤同一个锚点凑数）
    expect(new Set(domains.map((d) => d.businessDomainKey)).size).toBe(13);
    // 唯一没被流程域覆盖的是 external（外部信号 = 数据来源域，不是业务活动域）——**判断，不是遗漏**。
    const anchored = new Set(domains.map((d) => d.businessDomainKey));
    expect(BUSINESS_DOMAIN_KEYS.filter((k) => !anchored.has(k))).toEqual(["external"]);
  });

  it("PRD §3.2.2 点名的两个编号锚点不许漂（P37=MPS · P40=APS，WO-Q1 的映射按它建）", async () => {
    const t = await makeApp();
    await seedDemoProcessLayer(t.repos);
    const defs = await t.repos.processDefinitions.list(DEMO_TENANT);
    const byKey = new Map(defs.map((p) => [p.key, p]));

    expect(byKey.get("P37")?.name).toContain("MPS");
    expect(byKey.get("P40")?.name).toContain("APS");
    // 两条共用同一个排产承载物 —— 这正是 chain-sim.ts「全仓只有一个排产承载物」的实测事实。
    // **共用 ≠ 空壳**：判据是「一条流程必须有承载物」，不是「一个承载物只能被一条流程用」。
    expect(byKey.get("P37")?.carrierTypeKey).toBe("ProductionSchedule");
    expect(byKey.get("P40")?.carrierTypeKey).toBe("ProductionSchedule");
  });

  it("R2 租户隔离：别的租户读不到 demo 的流程层", async () => {
    const t = await makeApp();
    await seedDemoProcessLayer(t.repos);
    expect(await t.repos.processDefinitions.list("otherco")).toHaveLength(0);
    expect(await t.repos.processDomains.list("otherco")).toHaveLength(0);
    expect(await t.repos.processDefinitions.get("otherco", `pdef_${DEMO_TENANT}_P01`)).toBeUndefined();
  });

  it("R6 幂等 + 确定性：重播两次条数不变、内容字节级一致", async () => {
    const t = await makeApp();
    await seedDemoProcessLayer(t.repos);
    const first = JSON.stringify(
      (await t.repos.processDefinitions.list(DEMO_TENANT)).sort((a, b) => a.key.localeCompare(b.key)),
    );
    await seedDemoProcessLayer(t.repos);
    const second = JSON.stringify(
      (await t.repos.processDefinitions.list(DEMO_TENANT)).sort((a, b) => a.key.localeCompare(b.key)),
    );
    expect(await t.repos.processDefinitions.list(DEMO_TENANT)).toHaveLength(65);
    expect(second).toBe(first);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🔴 断言① · 承载物必须在本体里真有该类型（红线 3 · 防空壳）
// ══════════════════════════════════════════════════════════════════════════

describe("WO-Q0 断言① · carrierTypeKey 在本体里真有该类型（红线 3：空壳不是建模）", () => {
  it("真跑一遍 battery 合成种子 → 65 条流程的承载物逐条在本体里查得到", async () => {
    const t = await makeApp();
    await seedBattery(t); // ← 真跑，不是拿源码字面量对字面量
    await seedDemoProcessLayer(t.repos);

    const typeKeys = new Set((await t.repos.ontologyTypes.list(DEMO_TENANT)).map((x) => x.key));

    // 🐤 金丝雀（铁律 0.6：报否定结论前先自证工具是对的）。
    //    这一步若不中，说明"本体读取"这条路坏了 —— 那时该报「门自己坏了」，
    //    **不许**报「承载物不存在」。少了它，一个返回空集的读取会让下面 65 条断言**恒绿**。
    expect(typeKeys.size, "本体类型集合为空 ⇒ 是读取坏了，不是承载物不存在").toBeGreaterThan(50);
    expect(typeKeys, "金丝雀：Order 是种子必产的类型").toContain("Order");
    expect(typeKeys, "金丝雀：ProductionSchedule 是种子必产的类型").toContain("ProductionSchedule");
    // 反向金丝雀：一个**确定不存在**的类型必须查不到，否则说明集合是"什么都包含"的假集合。
    expect(typeKeys.has("ThisTypeDoesNotExist_Q0")).toBe(false);

    const defs = await t.repos.processDefinitions.list(DEMO_TENANT);
    expect(defs).toHaveLength(65);
    const orphans = defs
      .filter((p) => !typeKeys.has(p.carrierTypeKey))
      .map((p) => `${p.key}(${p.name}) → 承载物 ${p.carrierTypeKey} 在本体里不存在`);
    expect(orphans, "空壳流程（承载物在本体里查不到）").toEqual([]);
  }, 300000);
});

// ══════════════════════════════════════════════════════════════════════════
// R9 三处同改 · pg 侧表名与 migration 对齐
// ══════════════════════════════════════════════════════════════════════════

describe("WO-Q0 · R9 仓储双实现（pg 表名 ↔ migration DDL）", () => {
  /**
   * 为什么要这条：测试默认走 memory，`new PgStore(pool, "process_definition")`（少个 s）
   * **编译通过、单测全绿**，只在 pg 模式运行时炸 —— 本仓记过的「生产实参与测试实参交集为空」形态。
   * 这里把 migration 的 `CREATE TABLE` 名与 `pg.ts` 的 `new PgStore(pool, "…")` 实参对上。
   */
  const CREATE_TABLE_RE = /CREATE TABLE IF NOT EXISTS\s+(\w+)/gi;
  const PGSTORE_RE = /new PgStore\(pool,\s*"(\w+)"/g;
  const allMatches = (re: RegExp, s: string) => [...s.matchAll(re)].map((m) => m[1]!);

  it("029 建的两张表，pg.ts 都以**同名**接了 PgStore", async () => {
    const ddl = await readFile(join(REPO_APP, "migrations", "029_process_definitions.sql"), "utf8");
    const pgSrc = await readFile(join(REPO_APP, "src", "repo", "pg.ts"), "utf8");

    const created = allMatches(CREATE_TABLE_RE, ddl);
    const wired = allMatches(PGSTORE_RE, pgSrc);

    // 🐤 金丝雀：两个正则各拿一个"已知必中"的样例先自证（与主逻辑**共用同一份实现**，不另抄正则）。
    const ddl028 = await readFile(join(REPO_APP, "migrations", "028_perturbations.sql"), "utf8");
    expect(allMatches(CREATE_TABLE_RE, ddl028), "金丝雀：028 的建表正则必须命中").toContain("sim_perturbation");
    expect(wired, "金丝雀：PgStore 正则必须命中既有表").toContain("meta_access_policies");

    expect(created.sort()).toEqual(["process_definitions", "process_domains"]);
    for (const table of created) expect(wired, `migration 建了 ${table}，pg.ts 没接`).toContain(table);
  });

  it("029 号未被占用（迁移号唯一 · 欠账 #74）", async () => {
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(join(REPO_APP, "migrations"))).filter((f) => f.endsWith(".sql"));
    expect(files.filter((f) => f.startsWith("029")), "029 撞号").toEqual(["029_process_definitions.sql"]);
  });
});
