import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import {
  CHAIN_DETAIL_ABSENCE_CODES,
  ChainNodeDetailSchema,
  type ChainNodeDetail,
} from "@platform/contracts";

/**
 * WO-SIM-NODEDETAIL-FIELDS · 节点详情端点「补的那几个量」的**接缝门**。
 *
 * ══ 这道门咬的是链路，不是函数 ═══════════════════════════════════════════════
 * 驱动的接缝 = **种子/本体 → 端点回包**：真 `seedBattery`（真合成对象 + 真 A8 时钟）
 * → 真会话 → 真路由 `GET /a/v1/sim/sessions/:id/node-detail` → 回包。
 * 全程**不直调** `chainNodeDetail()` —— 直调只能证明那个函数会算，证明不了
 * 「`buildDrillWorld` 真把时钟/会话喂进去了」「路由真把 session 传下去了」。
 * 本仓假绿第 9 形态（`G-SKILL-REFGRAPH-DEAD-EXTRACTOR`）正是「测试咬的是函数不是链路」。
 *
 * ══ 三臂 + 两个自证 ═══════════════════════════════════════════════════════════
 * ① **A 路臂**：有数据的量给真值，且该值能在**对象库里独立找回**
 *    （拿 `repos.objects.listByType` 另走一条路取，不是端点自己算完自己断言）。
 * ② **B 路臂**：没数据的量给 `null` + **机器可读的枚举** reason，不是一句人话串。
 * ③ **不许编数臂**（本单的标的）：回包里**任何**非 null 的业务量都能追到对象库里的出处。
 *    ①② 都绿也可能是编的 —— 只有这一臂能证明不是。
 * ④ **时钟臂**：`dwellDays` 的减数是 A8 模拟时钟；把时钟记录删掉 ⇒ 该量诚实变 null，
 *    而**不依赖时钟的 `elapsedDays` 必须纹丝不动**（否则就是两个口径被糊成了一个）。
 * ⑤ **裁决登记臂**：屏上那几个「本回包不答」的量必须逐条登记且码在冻结枚举里。
 *
 * ⚠ **金丝雀（铁律 0.6）**：所有「回包里没有 X」这类**否定结论**之前，
 *   先用同一条取数路径证明一个**确定存在**的量能取到。金丝雀不中 ⇒ 报「工具坏了」，
 *   不许报「端点不工作」。见 `canary()`。
 */

const NODE_WITH_LOTS = "capacity.op.OP-002"; // 涂布 —— Operation.operationName ∩ Process.name，站上真有在制批号
const DAY_MS = 86_400_000;

const enableSim = async (t: TestApp) =>
  t.app.inject({
    method: "PUT",
    url: "/a/v1/tenants/demo/features",
    headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

async function seededApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await enableSim(t);
  return t;
}

async function newSession(t: TestApp): Promise<string> {
  const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: {} });
  expect(r.statusCode).toBe(201);
  return (r.json() as { id: string }).id;
}

/** 真路由取回包，并**当场按契约 parse** —— 路由本身不 parse，形状漂了这里才看得见。 */
async function nodeDetail(t: TestApp, sid: string, nodeId = NODE_WITH_LOTS): Promise<ChainNodeDetail> {
  const r = await t.app.inject({
    method: "GET",
    url: `/a/v1/sim/sessions/${sid}/node-detail?nodeId=${encodeURIComponent(nodeId)}`,
    headers: ADMIN,
  });
  expect(r.statusCode, `node-detail 非 200：${r.body.slice(0, 400)}`).toBe(200);
  return ChainNodeDetailSchema.parse(r.json());
}

/** 对象库直读（**与端点不同的一条路**）：批号主键 → 那一行的 props。 */
async function wipLotProps(t: TestApp): Promise<Map<string, Record<string, unknown>>> {
  const rows = await t.repos.objects.listByType("demo", "WIPLot");
  return new Map(rows.filter((o) => !o.mergedInto).map((o) => [String(o.props.lotId ?? ""), o.props]));
}

/**
 * 金丝雀：拿一个**确定存在**的属性走与断言同一条取数路径。
 * 它若也取不到，那是取数坏了（seed 没跑 / 类型名写错），不是「本体里没有那个量」。
 */
async function canary(t: TestApp): Promise<{ lotCount: number; sampleQty: number }> {
  const byLot = await wipLotProps(t);
  const first = [...byLot.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))[0];
  expect(byLot.size, "金丝雀：对象库里一条 WIPLot 都没有 ⇒ 取数坏了，不是「本体没有这个量」").toBeGreaterThan(0);
  expect(first, "金丝雀：WIPLot 取到了但首行为空 ⇒ 取数坏了").toBeDefined();
  const qty = first![1].qty;
  expect(typeof qty, `金丝雀：WIPLot.${first![0]}.qty 不是数 ⇒ 取数坏了`).toBe("number");
  return { lotCount: byLot.size, sampleQty: qty as number };
}

describe("WO-SIM-NODEDETAIL-FIELDS · 种子/本体 → node-detail 回包 接缝", () => {
  // ══════════════════════════════════════════════════════════════════════
  // ① A 路臂 —— 有数据的量给真值，且真值能在对象库里独立找回
  // ══════════════════════════════════════════════════════════════════════
  it("① 型号 / 两个耗时口径是真值，且逐条能在对象库里独立找回（不是端点自证）", async () => {
    const t = await seededApp();
    const probe = await canary(t);
    const sid = await newSession(t);
    const res = await nodeDetail(t, sid);

    // 金丝雀命中证据（报否定结论时必须同时给出，见文件头）
    expect(probe.lotCount).toBeGreaterThan(0);
    expect(res.lots.length, "站位上一条批号都没下发 ⇒ 后面的断言全是空转").toBeGreaterThan(0);

    const byLot = await wipLotProps(t);
    let checkedModel = 0;
    let checkedElapsed = 0;
    for (const lot of res.lots) {
      const conduction = lot.conduction;
      expect(conduction, `批号 ${lot.lotNo} 没带 conduction ⇒ 端点没下发本单补的那三列`).toBeDefined();
      const props = byLot.get(lot.lotNo);
      expect(props, `批号 ${lot.lotNo} 在对象库里找不回来 ⇒ 回包的批号是编的`).toBeDefined();

      // 型号 ← WIPLot.modelId（对象库里那一行自己的字段）
      const expectModel = typeof props!.modelId === "string" && props!.modelId !== "" ? (props!.modelId as string) : null;
      expect(conduction!.model, `批号 ${lot.lotNo} 的型号与对象库对不上`).toBe(expectModel);
      if (expectModel !== null) checkedModel += 1;

      // 在链历时 ← lastMoveTime − startTime（**两个日戳都来自对象库**，本测试自己重算一遍）
      const started = Date.parse(`${String(props!.startTime ?? "").slice(0, 10)}T00:00:00Z`);
      const moved = Date.parse(`${String(props!.lastMoveTime ?? "").slice(0, 10)}T00:00:00Z`);
      const expectElapsed =
        Number.isFinite(started) && Number.isFinite(moved) && moved >= started ? (moved - started) / DAY_MS : null;
      expect(conduction!.elapsedDays, `批号 ${lot.lotNo} 的在链历时与对象库日戳算出来的对不上`).toBe(expectElapsed);
      if (expectElapsed !== null) checkedElapsed += 1;
    }
    // 「逐条都对」在全 null 时也成立 —— 必须证明真的验到过非空值，否则这一臂是空转。
    expect(checkedModel, "一条型号都没验到 ⇒ 本臂空转（不是通过）").toBeGreaterThan(0);
    expect(checkedElapsed, "一条在链历时都没验到 ⇒ 本臂空转（不是通过）").toBeGreaterThan(0);
  });

  // ══════════════════════════════════════════════════════════════════════
  // ② B 路臂 —— 没有的量给 null + **机器可读枚举**，不是一句人话串
  // ══════════════════════════════════════════════════════════════════════
  it("② 影响级本体零承载 ⇒ 逐批恒 null，且缺席理由是冻结枚举里的码而非人话串", async () => {
    const t = await seededApp();
    await canary(t); // 否定结论（「本体里没有影响级」）之前先自证取数是好的
    const sid = await newSession(t);
    const res = await nodeDetail(t, sid);

    expect(res.lots.length).toBeGreaterThan(0);
    for (const lot of res.lots) {
      expect(lot.conduction?.impactLevel, `批号 ${lot.lotNo} 的影响级不是 null ⇒ 有人给它编了个数`).toBeNull();
    }

    const entry = res.missing.find((m) => m.field === "conduction.impactLevel");
    expect(entry, "影响级恒 null 却没登记原因 ⇒ 屏上分不清「没有这个数」与「还没加载」").toBeDefined();
    expect(entry!.code).toBe("ONTOLOGY_MISSING");
    // 判据落在**枚举**上：拿人话串去 includes() 分类是本仓吃过亏的接法。
    expect(CHAIN_DETAIL_ABSENCE_CODES).toContain(entry!.code);
    expect(entry!.probe.length, "probe 必须是可执行的下一步，不是一句抱歉").toBeGreaterThan(0);
    // 一条节点级登记，**不是**每批一条（260 条一样的话等于没说）
    expect(res.missing.filter((m) => m.field === "conduction.impactLevel")).toHaveLength(1);
  });

  // ══════════════════════════════════════════════════════════════════════
  // ③ 不许编数臂 —— 回包里任何非 null 的业务量都能追到对象库里的出处
  // ══════════════════════════════════════════════════════════════════════
  it("③ 每一个非 null 的业务量都能追到出处：证据三元组回仓储逐位对拍", async () => {
    const t = await seededApp();
    await canary(t);
    const sid = await newSession(t);
    const res = await nodeDetail(t, sid);
    const byLot = await wipLotProps(t);

    expect(res.clock, "回包没带 as-of 戳 ⇒ dwellDays 的减法无人能复核").toBeDefined();
    const nowMs = Date.parse(`${res.clock!.simulatedDate}T00:00:00Z`);
    expect(Number.isFinite(nowMs), "as-of 戳解析不出来").toBe(true);

    let traced = 0;
    for (const lot of res.lots) {
      const c = lot.conduction!;
      const props = byLot.get(lot.lotNo)!;

      // 三条文本证据：objectType/objectId/prop 必须指向真存在的那一行那一列，value 必须逐位相同。
      for (const [key, ev] of [
        ["modelId", c.evidence.model],
        ["startTime", c.evidence.startedAt],
        ["lastMoveTime", c.evidence.lastMovedAt],
      ] as const) {
        expect(ev, `批号 ${lot.lotNo} 的 ${key} 没给证据`).not.toBeNull();
        expect(ev!.objectType).toBe("WIPLot");
        expect(ev!.objectId).toBe(lot.lotNo);
        expect(ev!.prop).toBe(key);
        const raw = props[key];
        const expected = typeof raw === "string" && raw !== "" ? raw : null;
        expect(ev!.value, `批号 ${lot.lotNo} 的 ${key} 证据值与对象库对不上 ⇒ 这个数是编的`).toBe(expected);
        if (expected !== null) traced += 1;
      }

      // 屏上会显示的那三个数，必须与证据本身算出来的**逐位相同**（不许中间掺任何常数）。
      expect(c.model).toBe(c.evidence.model!.value);
      expect(c.startedAt).toBe(c.evidence.startedAt!.value);
      expect(c.lastMovedAt).toBe(c.evidence.lastMovedAt!.value);

      const moved = Date.parse(`${String(c.lastMovedAt ?? "").slice(0, 10)}T00:00:00Z`);
      // dwellDays 连**符号**一起咬死：种子的批号日戳跑在 A8 时钟前面时它是负数，
      // 那是「数据与时钟对不齐」这个事实本身。有人把它 clamp 成 0 ⇒ 这一行当场红。
      const expectDwell = Number.isFinite(moved) ? (nowMs - moved) / DAY_MS : null;
      expect(c.dwellDays, `批号 ${lot.lotNo} 的在站停留不是「as-of 戳 − lastMoveTime」`).toBe(expectDwell);
    }
    expect(traced, "一条证据都没追到 ⇒ 本臂空转").toBeGreaterThan(0);

    // 既有的四个数值量（wip/batch/takt/yield）也一并守住：非 null 就必须有证据且值相同。
    for (const lot of res.lots) {
      if (lot.wip !== null) expect(lot.evidence.lot.value).toBe(lot.wip);
      if (lot.batch !== null) expect(lot.evidence.batch?.value).toBe(lot.batch);
      if (lot.takt !== null) expect(lot.evidence.takt?.value).toBe(lot.takt);
      if (lot.yieldPct !== null) expect(lot.evidence.yield?.value).toBeCloseTo(lot.yieldPct / 100, 12);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // ④ 时钟臂 —— as-of 戳来自 A8；时钟没了 ⇒ 只有依赖它的那个量变 null
  // ══════════════════════════════════════════════════════════════════════
  it("④ as-of 戳 = A8 模拟时钟；删掉时钟记录 ⇒ dwellDays 诚实变 null 而 elapsedDays 纹丝不动", async () => {
    const t = await seededApp();
    const sid = await newSession(t);
    const before = await nodeDetail(t, sid);

    // 金丝雀 + A 路：戳必须与仓储里那条时钟记录逐位对上（不是端点自己编的日期）
    const rec = await t.repos.simulationClocks.get("demo", "demo");
    expect(rec, "金丝雀：A8 时钟记录不存在 ⇒ seed 没跑全，不是「端点不答时钟」").toBeDefined();
    expect(before.clock!.source).toBe("A8_SIMULATION_CLOCK");
    expect(before.clock!.t0).toBe(rec!.t0.slice(0, 10));
    expect(before.clock!.tick).toBe(rec!.currentTick);
    expect(before.clock!.simulatedDate).toBe(
      new Date(Date.parse(`${rec!.t0.slice(0, 10)}T00:00:00Z`) + rec!.currentTick * DAY_MS).toISOString().slice(0, 10),
    );
    // 租户时钟与会话进度是两个量，分开给（合成一个就互相冒充了）
    expect(before.clock!.sessionTick).toBe(0);
    expect(before.clock!.sessionTickDays).toBe(1);
    const dwellBefore = before.lots.map((l) => l.conduction!.dwellDays);
    const elapsedBefore = before.lots.map((l) => l.conduction!.elapsedDays);
    expect(dwellBefore.some((d) => d !== null), "本臂空转：没有一条 dwellDays 有值").toBe(true);
    expect(elapsedBefore.some((d) => d !== null), "本臂空转：没有一条 elapsedDays 有值").toBe(true);

    // ── 把时钟记录删掉：这一步驱动的是「没有『现在』时端点怎么办」这条真分支 ──
    await t.repos.simulationClocks.remove("demo", "demo");
    const after = await nodeDetail(t, sid);

    expect(after.clock!.source).toBe("UNINITIALIZED");
    expect(after.clock!.t0).toBeNull();
    expect(after.clock!.simulatedDate).toBeNull();
    // ⛔ 头号判据：**没有退回 wall-clock**。退了的话 simulatedDate 会是今天，上面那条就绿不了；
    //    这里再补一刀 —— 依赖时钟的量必须全 null，不许出现一个「看起来对」的数。
    for (const lot of after.lots) expect(lot.conduction!.dwellDays).toBeNull();
    // 而**不**依赖时钟的在链历时必须一个字节都没变（两个口径没被糊成一个）
    expect(after.lots.map((l) => l.conduction!.elapsedDays)).toEqual(elapsedBefore);

    const entry = after.missing.find((m) => m.field === "clock");
    expect(entry, "时钟没了却不登记 ⇒ 屏上只会看到一列空白而不知为什么").toBeDefined();
    expect(entry!.code).toBe("CLOCK_UNINITIALIZED");
    expect(after.missing.some((m) => m.field === "conduction.dwellDays" && m.code === "CLOCK_UNINITIALIZED")).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════════════
  // ⑤ 裁决登记臂 —— 屏上那几个「本回包不答」的量逐条登记，码在冻结枚举里
  // ══════════════════════════════════════════════════════════════════════
  it("⑤ 不答的量逐条登记（纯呈现 / 别处已答 / 本体没有三码分开），且一个都没被顺手编出来", async () => {
    const t = await seededApp();
    await canary(t);
    const sid = await newSession(t);
    const res = await nodeDetail(t, sid);

    const expected: Record<string, string> = {
      "cone.radius": "PRESENTATION_ONLY",
      "cone.angle": "PRESENTATION_ONLY",
      "chrome.directions": "ANSWERED_ELSEWHERE",
      "chrome.filters": "ONTOLOGY_MISSING",
      "chrome.strip": "ONTOLOGY_MISSING",
      "conduction.impactLevel": "ONTOLOGY_MISSING",
    };
    for (const [field, code] of Object.entries(expected)) {
      const hit = res.missing.find((m) => m.field === field);
      expect(hit, `屏上的「${field}」既没给真值也没登记为什么 ⇒ 沉默缺席`).toBeDefined();
      expect(hit!.code, `「${field}」的裁决码不对`).toBe(code);
      expect(CHAIN_DETAIL_ABSENCE_CODES).toContain(hit!.code);
    }

    // 「不答」必须是真的不答：这些字段名不许作为**带值**的键出现在回包里。
    const flat = JSON.stringify(res);
    for (const key of ["radiusLabel", "angleLabel", "directions", "filters"]) {
      expect(flat.includes(`"${key}":`), `回包里冒出了 ${key} ⇒ 裁决说不答却又答了一个编的`).toBe(false);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // ⑥ R6 —— 同输入两跑逐字节一致（本单新增的量一个都没引入时钟/随机）
  // ══════════════════════════════════════════════════════════════════════
  it("⑥ 同 (seed, 会话, 节点) 两跑逐字节一致：新增字段没把 wall-clock 或随机漏进来", async () => {
    const t = await seededApp();
    const sid = await newSession(t);
    const a = await nodeDetail(t, sid);
    const b = await nodeDetail(t, sid);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    // 空转反证：两个都空对象也会「一致」。
    expect(a.lots.length).toBeGreaterThan(0);
    expect(a.missing.length).toBeGreaterThan(0);
  });
});
