import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROCESS_INSTANCE_ORIGINS, PROCESS_WAIT_KINDS, ProcessInstanceSchema } from "@platform/contracts";
import { seedDemoProcessLayer } from "../src/seed.js";
import { BATTERY_PROCESS_FLOW_RULES, PROCESS_FLOW_STRUCTURAL_NOTES, flowTimeDayZero } from "../src/process/flow-rules.js";
import { processLayerLinkTypes, processLayerObjectTypes } from "../src/process/ontology.js";
import { reconstructAndPersist } from "../src/process/reconstruct.js";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * WO-FLOWTIME · **接缝驱动**测试（SEAM-GATE）：数据半（单据时间戳）× 引擎半（反推 + 站间时长）
 * × 端点半（只读投影）在**同一次真跑**里对接，任一半漏即红。
 *
 * ⚠ 本文件刻意**不喂 fixture**：它先真播一遍电池种子（`seedBattery`）再去反推 ——
 * 拿源码里的字面量表对字面量表，测的是「我抄得对不对」，不是「本体里到底有没有」。
 * 这条判据抄自兄弟文件 `process-layer.test.ts` 的断言①，两处口径必须一致。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_APP = join(__dirname, "..");

async function seeded(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoProcessLayer(t.repos);
  return t;
}

describe("WO-FLOWTIME · 流程实例反推（接缝驱动）", () => {
  // ══════════════════════════════════════════════════════════════════════════
  // ① 头号接缝：真种子 → 反推 → 站间时长 → 求解器输出，一条也不许断
  // ══════════════════════════════════════════════════════════════════════════
  it("① 从真种子反推出流程实例，每条能溯回具体源单据 id + 字段 + 原值", async () => {
    const t = await seeded();
    const out = await reconstructAndPersist(t.repos, "demo");

    // 基数下限**单参**（`coverage-blind` 门的正则要求 `)` 紧跟 `.length`，双参识别不到）
    expect(out.instances.length).toBeGreaterThan(500);
    expect(out.timelines.length).toBeGreaterThan(300);

    // 逐条：契约 strictObject 过一遍（形状错了当场炸），且溯源必须指回真存在的对象
    for (const inst of out.instances) {
      ProcessInstanceSchema.parse(inst);
      expect(inst.sourceDocuments.length).toBeGreaterThan(0);
      for (const s of inst.sourceDocuments) {
        // `rawValue` 必须是**那个字段在仓储里的值本身**（原单位、不换算）——
        // 病史：`gap_attribution` 曾标 drillField 却回换算后的数，恰差 1e4。
        const obj = await t.repos.objects.get("demo", s.objectId);
        expect(obj, `溯源对象 ${s.objectId} 必须真存在`).toBeTruthy();
        expect(obj!.props[s.field]).toEqual(s.rawValue);
      }
    }
  });

  it("② 反推值与实测值结构性可辨：origin 恒 DERIVED_FROM_DOCUMENT，MEASURED 今天 0 条", async () => {
    const t = await seeded();
    const out = await reconstructAndPersist(t.repos, "demo");
    const derived = out.instances.filter((i) => i.origin === "DERIVED_FROM_DOCUMENT");
    const measured = out.instances.filter((i) => i.origin === "MEASURED");
    expect(derived.length).toBeGreaterThan(500);
    // MEASURED 是**留位**不是已实现。这条断言写死 0 是有意的：哪天真接了 MES 它会红，
    // 逼着人来确认"这是有意补的数据，不是回归"（同 skill-compiler 那次金丝雀的机制）。
    expect(measured.length).toBe(0);
    // 词表两档都在契约里，前端渲染图例不必再抄一份
    expect(PROCESS_INSTANCE_ORIGINS).toEqual(["DERIVED_FROM_DOCUMENT", "MEASURED"]);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ③ ⛔ 头号红线：一次都不许读 stdDurationDays（不拿标准工期冒充实测）
  // ══════════════════════════════════════════════════════════════════════════
  it("③ 契约与规则表一次都不出现 stdDurationDays（金丝雀自证：同一份文本能搜到别的已知串）", async () => {
    const contract = await readFile(join(REPO_APP, "../../packages/contracts/src/process-instance.ts"), "utf8");
    const rules = await readFile(join(REPO_APP, "src/process/flow-rules.ts"), "utf8");
    // 🐤 金丝雀：先证明"我搜得到东西"。搜不到已知必中串 ⇒ 是工具坏了，不许读作"代码干净"。
    expect(contract).toContain("PROCESS_INSTANCE_ORIGINS");
    expect(rules).toContain("BATTERY_PROCESS_FLOW_RULES");
    // 正题：两份文件里 `stdDurationDays` 只允许出现在**警告性注释**里，绝不允许被读取。
    // 判据落在「代码行」而非「全文」：注释里点名这条红线是**好事**，读它才是坏事。
    const codeLines = (src: string) =>
      src
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => !l.startsWith("*") && !l.startsWith("//") && !l.startsWith("/*"));
    expect(codeLines(contract).filter((l) => l.includes("stdDurationDays"))).toEqual([]);
    expect(codeLines(rules).filter((l) => l.includes("stdDurationDays"))).toEqual([]);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ④ 两向：反推得出的有时长；反推不出的 absent + 原因，不是 0 也不是编的数
  // ══════════════════════════════════════════════════════════════════════════
  it("④ 两向都真实：得出的有天数与责任方，不出的有 kind/reason/probe", async () => {
    const t = await seeded();
    const out = await reconstructAndPersist(t.repos, "demo");

    // 正向：至少覆盖两条真·多站链的关键站
    const reconstructed = new Set(out.instances.map((i) => i.processKey));
    for (const key of ["P33", "P35", "P43", "P47", "P51"]) {
      expect(reconstructed.has(key), `${key} 应反推得出`).toBe(true);
    }

    // 反向：缺席条目必须说清楚缺什么 + 怎么复验，且**不是空话**
    expect(out.absences.length).toBeGreaterThan(40);
    for (const a of out.absences) {
      expect(a.reason.length).toBeGreaterThan(20); // 「无数据」这种什么都没说的话过不了这条
      expect(a.probe.length).toBeGreaterThan(10);
      expect(a.carrierTypeKey.length).toBeGreaterThan(0);
    }
    // 反推得出的流程**不许**同时出现在缺席清单里（两向互斥，不许既有数又报缺）
    const absent = new Set(out.absences.map((a) => a.processKey));
    for (const k of reconstructed) expect(absent.has(k), `${k} 不该既有实例又报缺席`).toBe(false);

    // 结构性缺席（有意不收）用它自己的取证说话，不被"补条规则就行"的缺省理由盖住
    const p31 = out.absences.find((a) => a.processKey === "P31");
    expect(p31?.kind).toBe("NOT_APPLICABLE");
    expect(p31?.reason).toContain("verifiedDate");
    expect(Object.keys(PROCESS_FLOW_STRUCTURAL_NOTES)).toContain("P31");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ⑤ 求解器真跑：站间时长 + 至少一条能指出瓶颈站与卡顿站
  // ══════════════════════════════════════════════════════════════════════════
  it("⑤ process_flow_time 真跑：给出站间时长、瓶颈站、卡顿站与卡在谁那里", async () => {
    const t = await seeded();
    const res = await invokeSolver(t, "process_flow_time", {});
    expect(res.statusCode).toBe(200);
    const d = (JSON.parse(res.body) as { data: Record<string, unknown> }).data;

    // 瓶颈站：必须点得出是哪一站、平均停留多少天、最久那条实例是谁
    const bottleneck = d.bottleneck as { processKey: string; avgDwellDays: number; maxDwellInstanceKey: string } | null;
    expect(bottleneck).not.toBeNull();
    expect(bottleneck!.processKey).toMatch(/^P\d{2}$/);
    expect(bottleneck!.avgDwellDays).toBeGreaterThan(0);
    expect(bottleneck!.maxDwellInstanceKey.length).toBeGreaterThan(0);

    // 卡顿站：至少一条，且**卡在谁那里**必须给得出（职能 + 具体责任方）
    const stuck = d.stuck as { processKey: string; stuckDays: number; ownerRef: { functionKey: string; partyField: string | null; partyValue: string | null } | null; waitState: string | null }[];
    expect(stuck.length).toBeGreaterThan(0);
    const top = stuck[0]!;
    expect(top.stuckDays).toBeGreaterThan(0);
    expect(top.ownerRef).not.toBeNull();
    expect(top.ownerRef!.functionKey.length).toBeGreaterThan(0);
    // 未出站 ⇒ waitState 必须是契约四值之一（词表单源，不许另造）
    expect(PROCESS_WAIT_KINDS as readonly string[]).toContain(top.waitState);

    // **站间流转时长**（本单标题那件事）：至少一条链的相邻站之间算得出间隔
    const stations = d.stations as { processKey: string; avgGapDaysToNext: number | null }[];
    const withGap = stations.filter((s) => s.avgGapDaysToNext !== null);
    expect(withGap.length).toBeGreaterThan(0);

    // 诚实位一个都不许少（漏进形状契约 = 前端只看得见好消息）
    for (const k of ["asOf", "asOfSource", "origin", "coverage", "absences"]) {
      expect(Object.keys(d)).toContain(k);
    }
    expect(d.origin).toBe("DERIVED_FROM_DOCUMENT");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ⑥ R6 确定性：同 seed 两跑逐字节一致，且无 Date.now
  // ══════════════════════════════════════════════════════════════════════════
  it("⑥ R6：两跑逐字节一致；asOf 由数据派生不是 wall-clock", async () => {
    const t = await seeded();
    const a = await invokeSolver(t, "process_flow_time", {});
    const b = await invokeSolver(t, "process_flow_time", {});
    expect(JSON.parse(a.body).data).toEqual(JSON.parse(b.body).data);
    expect(a.body).toBe(b.body);

    const d = JSON.parse(a.body).data as { asOf: string; asOfSource: string };
    // 缺省取数据里最晚的观测时刻 —— 不是 forecastStart（那是窗口起点），更不是今天
    expect(d.asOfSource).toBe("DATA_LATEST");
    expect(d.asOf > flowTimeDayZero(), "asOf 应晚于锚点（数据往后走）").toBe(true);
    // 反证：wall-clock 会随运行日期漂，这条断言钉死它不含"今年"以外的偶然值
    expect(d.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 显式传 asOf ⇒ 来源改标 ARG（诚实位随之变，不是恒 DATA_LATEST 的装饰）
    const c = await invokeSolver(t, "process_flow_time", { asOf: "2026-06-20" });
    const dc = JSON.parse(c.body).data as { asOf: string; asOfSource: string };
    expect(dc.asOfSource).toBe("ARG");
    expect(dc.asOf).toBe("2026-06-20");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ⑦ 端点（R2 租户隔离 · 解析不到标 absent 不 500 · 不存在 404）
  // ══════════════════════════════════════════════════════════════════════════
  it("⑦ 端点两向 + 404 + 跨租户为空", async () => {
    const t = await seeded();
    const ok = await t.app.inject({ method: "GET", url: "/a/v1/process-definitions/P35/instances", headers: ADMIN });
    expect(ok.statusCode).toBe(200);
    const okj = JSON.parse(ok.body) as { available: boolean; instanceCount: number; instances: unknown[]; definition: { stdDurationDays: number }; flowTime: unknown[] };
    expect(okj.available).toBe(true);
    expect(okj.instances.length).toBeGreaterThan(0);
    expect(okj.flowTime.length).toBeGreaterThan(0);
    // 标准工期只作为**对照列**原样透出，与实测天数分属两个字段（前端不可能拿错）
    expect(typeof okj.definition.stdDurationDays).toBe("number");

    // 反推不出 ⇒ 200 + available:false + 缺席理由（**不是 500，也不是空数组冒充"没卡顿"**）
    const absent = await t.app.inject({ method: "GET", url: "/a/v1/process-definitions/P01/instances", headers: ADMIN });
    expect(absent.statusCode).toBe(200);
    const aj = JSON.parse(absent.body) as { available: boolean; absence: { kind: string; reason: string; probe: string } | null; instanceCount: number };
    expect(aj.available).toBe(false);
    expect(aj.instanceCount).toBe(0);
    expect(aj.absence).not.toBeNull();
    expect(aj.absence!.probe.length).toBeGreaterThan(10);

    // 流程 key 不存在 ⇒ 404（那是调用错，该报错；与"算不出来"是两回事）
    const nf = await t.app.inject({ method: "GET", url: "/a/v1/process-definitions/P99/instances", headers: ADMIN });
    expect(nf.statusCode).toBe(404);

    // R2：另一个租户读不到本租户的实例
    const other = await t.repos.processInstances.list("other-tenant");
    expect(other.length).toBe(0);
    const mine = await t.repos.processInstances.list("demo");
    expect(mine.length).toBeGreaterThan(500);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ⑧ R9 四落点：pg 表名与 migration 里的 CREATE TABLE 逐字一致（不是靠人眼看两处）
  // ══════════════════════════════════════════════════════════════════════════
  it("⑧ R9：033 migration 的表名与 repo/pg.ts 的字面量对得上", async () => {
    const sql = await readFile(join(REPO_APP, "migrations/033_process_instances.sql"), "utf8");
    const pg = await readFile(join(REPO_APP, "src/repo/pg.ts"), "utf8");
    // 🐤 金丝雀：先证明抽取器工作（已知必中）
    const names = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]!);
    expect(names).toContain("process_instances");
    expect(pg).toContain('new PgStore(pool, "process_instances")');
    // memory 侧也必须有（少了它测试全绿而 pg 模式启动即炸的反面：memory 少了则测试直接炸）
    const mem = await readFile(join(REPO_APP, "src/repo/memory.ts"), "utf8");
    expect(mem).toContain("processInstances: new MemStore()");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ⑨ 本体：类型/属性描述齐全 + 链路从规则表**派生**（不是手抄，改规则表自动跟）
  // ══════════════════════════════════════════════════════════════════════════
  it("⑨ 本体登记：描述非空 + carries 链路与规则表的承载类型集合逐字相等", async () => {
    const types = processLayerObjectTypes();
    expect(types.length).toBe(2);
    for (const ty of types) {
      expect(ty.displayName.length).toBeGreaterThan(0);
      expect((ty.description ?? "").length).toBeGreaterThan(10);
      for (const p of ty.properties) expect((p.description ?? "").length, `${ty.key}.${p.propKey} 缺描述`).toBeGreaterThan(5);
    }

    const links = processLayerLinkTypes();
    expect(links.some((l) => l.key === "process_instance_of" && l.toTypeKey === "ProcessDefinition")).toBe(true);
    // **派生而非手抄**：carries 一族必须逐字等于规则表里出现的承载类型集合。
    // 规则表加一站 ⇒ 这里自动多一条边；手抄一份就会在下次改规则时悄悄漂。
    const fromRules = [...new Set(BATTERY_PROCESS_FLOW_RULES.flatMap((r) => r.stations.map((s) => s.typeKey)))].sort();
    const fromLinks = links
      .filter((l) => l.key.startsWith("process_instance_carries_"))
      .map((l) => l.toTypeKey)
      .sort();
    expect(fromLinks).toEqual(fromRules);

    // 真播一遍：本体确实落进仓储且 ACTIVE
    const t = await makeApp();
    await seedDemoProcessLayer(t.repos);
    const stored = await t.repos.ontologyTypes.list("demo", (x) => x.key === "ProcessInstance");
    expect(stored.length).toBe(1);
    expect(stored[0]!.status).toBe("ACTIVE");
    const storedLinks = await t.repos.ontologyLinks.list("demo", (x) => x.key.startsWith("process_instance"));
    expect(storedLinks.length).toBeGreaterThan(5);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ⑩ 事件：发了就必须有消费方（有事件没人听 = 假接线）
  // ══════════════════════════════════════════════════════════════════════════
  it("⑩ 反推产出真 emit 两个事件，且事件名与订阅表逐字一致", async () => {
    const t = await seeded();
    await invokeSolver(t, "process_flow_time", {});
    const events = await t.repos.outboxEvents.list("demo");
    const names = events.map((e) => e.event);
    expect(names).toContain("process.instance_entered");
    expect(names).toContain("process.instance_stuck");

    // stuck 事件必须带得出「卡在哪一站、卡了多久」—— 只发一个空信号等于没发
    const stuckEvt = events.find((e) => e.event === "process.instance_stuck")!;
    const p = stuckEvt.payload as { worstProcessKey?: string; worstStuckDays?: number; stuckFlowCount?: number };
    expect(p.worstProcessKey).toMatch(/^P\d{2}$/);
    expect(p.worstStuckDays).toBeGreaterThan(0);
    expect(p.stuckFlowCount).toBeGreaterThan(0);

    // 订阅表那一侧（AgentCore）由 `apps/agentcore/test` 咬；此处只钉事件名不漂
    // （同一个字符串在两个包里，写错一个字母就是「有事件没人听」）。
    expect(names.filter((n) => n.startsWith("process.")).length).toBeGreaterThan(1);
  });
});
