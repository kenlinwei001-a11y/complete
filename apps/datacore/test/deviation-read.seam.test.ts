import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { recomputeDemoDerivationsAtSeed, seedDemoDerivationSpecs } from "../src/seed-derivation-specs.js";
import { DEVIATION_READ_STATE_VARS, DeviationReader } from "../src/sim/deviation-read.js";
import { SIM_WORLD_PROJECTION_RULES } from "../src/sim/world-read.js";
import { stateVarDomains } from "../src/synthetic/battery.js";

/**
 * WO-COSTPRESSURE-IDENTITY · 落点 (b) 的**接缝门**（普通 vitest，⛔ 非新门脚本、⛔ 非基线 JSON —— 禁令 3）。
 *
 * ── 这道门守的是什么 ─────────────────────────────────────────────────────────
 * 病：`Order.costPressure` 的生产端播的是**水平**（`creditUsedRatio × 100`），
 * 消费端读的是**偏离**（`金额 = 基线 ×（1 + 压力 ÷ 100）`），**全仓没有东西守着两者一致**。
 * (b) 的治法：消费端不再假设「静息 = 0」，而是**取 `baseSnapshot` 同一格**（与生产端同源）。
 *
 * 于是要守的就不再是「某个数等于 24.03」，而是四条**结构性**判据：
 *   §1 消费端真读到的 stateVar 集合 ⊆ 声明名单 ⊆ 已声明域的 stateVar（两向都咬，带双向金丝雀）
 *   §2 零扰动 ⇒ 金额投影**逐字节等于**基线（这就是病本身：偏离为 0 才叫没偏）
 *   §3 真有扰动 ⇒ 金额**必须动**（对照实验：⛔ 防 (b) 把金额投影改死成恒等于基线）
 *   §4 取不到静息值 ⇒ **不退回 0**，逐格进 `unresolvedRestPoints`（单元级，直喂 TickState）
 *
 * §2 与 §3 缺一条都不成立：只有 §2 ⇒ 把金额锁死也能全绿；只有 §3 ⇒ 病还在。
 *
 * ── 为什么必须接缝驱动 ───────────────────────────────────────────────────────
 * 各半 unit 都能绿而功能是坏的：`DeviationReader` 纯函数当然对，但求解器可能压根没调它
 * （本仓假绿第 9 形态：测试咬的是**函数**不是**链路**）。故 §2/§3 一律走
 * **真种子 → 真规则 → 真会话 → 真扰动 → 真 tick → 真 invoke 求解器**。
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * 剥注释（**铁律 0.6 第 6 条**：数符号之前先剥注释、再定语法位置）。
 * 两向金丝雀见 §1：正样例必须被数到，**只出现在注释里的同名串必须不被数到**。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** 取 `open(...)` 的**整段实参文本**（按括号配平，跨行安全）。 */
function callArgs(src: string, callee: string): string[] {
  const out: string[] = [];
  const needle = `${callee}(`;
  let i = src.indexOf(needle);
  while (i >= 0) {
    let depth = 0;
    let j = i + needle.length - 1;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === "(") depth += 1;
      else if (c === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(i + needle.length, j));
    i = src.indexOf(needle, j);
  }
  return out;
}

/** 从一段文本里取「是已声明域的键」的字符串字面量（`stateVarDomains()` 的键集）。 */
function stateVarLiterals(text: string, declared: readonly string[]): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/"([A-Za-z][A-Za-z0-9_]*)"/g)) {
    if (declared.includes(m[1]) && !found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

const enableSim = async (t: TestApp) =>
  t.app.inject({
    method: "PUT",
    url: "/a/v1/tenants/demo/features",
    headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

/** 三元正极 —— demo 世界里 `priceShock` 有下游成本链的物料（同 `turn-loop.seam.test.ts`，不另选一个）。 */
const MAT_ID = "obj_material_pos_ncm";

async function seededApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoPropagationRules(t.repos);
  /**
   * ⛔ **必须带派生规格**（`zz-probe*` 的仪器缺陷就是这么来的，已入册）：
   * 不跑这两步，`Order.costPressure` / `Customer.receivablePressure` 在开局快照里恒为静息值，
   * 于是「水平」与「偏离」**数值上恰好相等** ⇒ 这条门对金额侧**没有鉴别力**（mutation 反证会当场抖出来）。
   * 带上之后快照才是真部署那条路播出来的，静息值 ≠ 水平值，门才咬得住。
   */
  await seedDemoDerivationSpecs(t.repos, t.services.ontologyCore, t.services.governance, t.adminCtx);
  await recomputeDemoDerivationsAtSeed(t.repos, t.services.ontologyCore, t.adminCtx);
  await enableSim(t);
  return t;
}

/** 披露里的**水平**读数（面 C 口径）—— 用来把「水平」与「金额实际吃的偏离」并排摆出来。 */
const levels = (d: any) =>
  (d.pressures as any[])
    .map((p) => `${p.stateVar}=${p.value}`)
    .join(" ");

async function newSession(t: TestApp): Promise<string> {
  const r = await t.app.inject({
    method: "POST",
    url: "/a/v1/sim/sessions",
    headers: ADMIN,
    payload: { scope: { mode: "GLOBAL" } },
  });
  expect(r.statusCode, `建会话失败：${r.body}`).toBe(201);
  return r.json().id as string;
}

/** **相对**扰动（`mode:"delta"`）：真实强度 = magnitude（`set` 模式下强度是 `magnitude − 起点值`，两件事别混）。 */
async function perturbDelta(t: TestApp, sid: string, objectId: string, magnitude: number): Promise<void> {
  const r = await t.app.inject({
    method: "POST",
    url: `/a/v1/sim/sessions/${sid}/perturbations`,
    headers: ADMIN,
    payload: {
      kind: "cost_shock",
      targetObjectId: objectId,
      targetStateVar: "priceShock",
      magnitude,
      mode: "delta",
      startTick: 0,
      durationTicks: null,
      label: `${objectId} delta+${magnitude}`,
    },
  });
  expect(r.statusCode, `扰动写入必须 2xx：code=${r.statusCode} ${r.body}`).toBe(201);
}

async function tick(t: TestApp, sid: string, n: number): Promise<void> {
  const r = await t.app.inject({
    method: "POST",
    url: `/a/v1/sim/sessions/${sid}/tick`,
    headers: ADMIN,
    payload: { n },
  });
  expect([200, 201], `tick 失败：${r.statusCode} ${r.body}`).toContain(r.statusCode);
}

const project = async (t: TestApp, sid: string) => {
  const r = await invokeSolver(t, "finance_world_projection", { worldId: sid });
  expect(r.statusCode, `求解器失败：${r.body}`).toBe(200);
  return (r.json() as { data: any }).data;
};

const lineOf = (d: any, role: string) => (d.lines as any[]).find((l) => l.role === role);

/**
 * `WorldSnapshot.state` 的**逐格指纹**（面 A/B 读的就是它）。
 * 按 id / stateVar 排序后序列化再哈希 —— 这才是「逐字节」：对象键序不稳定，直接 `JSON.stringify` 会假红/假绿。
 */
async function worldCells(t: TestApp, sid: string): Promise<{ cells: number; digest: string }> {
  const r = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/world`, headers: ADMIN });
  expect(r.statusCode, `读世界态失败：${r.body}`).toBe(200);
  const j = r.json() as { state: Record<string, Record<string, number>> };
  const ids = Object.keys(j.state).sort();
  let cells = 0;
  const canon = JSON.stringify(
    ids.map((id) => {
      const vars = Object.entries(j.state[id] ?? {}).sort((a, b) => (a[0] < b[0] ? -1 : 1));
      cells += vars.length;
      return [id, vars];
    }),
  );
  return { cells, digest: createHash("sha256").update(canon).digest("hex").slice(0, 16) };
}

describe("落点 (b) · 消费端按率读口吃「偏离」", () => {
  it("§1 名单封闭：真读点 ⊆ 声明名单 ⊆ 已声明域（双向 + 双向金丝雀）", () => {
    const declared = Object.keys(stateVarDomains());
    expect(declared.length, "金丝雀：域表非空（空了说明读错文件/域表改名）").toBeGreaterThan(20);

    const financeSrc = stripComments(readFileSync(`${HERE}../src/solvers/finance-world.ts`, "utf8"));
    const rulesSrc = stripComments(readFileSync(`${HERE}../src/sim/world-read.ts`, "utf8"));

    /**
     * ① **真读点**（不是手写台账）：
     *   · `sim/world-read.ts` 的投影声明表（**结构性来源**，直接读那张表）
     *   · `finance-world.ts` 里 `deviationOf(...)` / `aggregatePressure(...)` 调用实参中的 stateVar 字面量
     */
    const fromRules = [...new Set(SIM_WORLD_PROJECTION_RULES.map((r) => r.stateVar))].sort();
    const sites = [...callArgs(financeSrc, "deviationOf"), ...callArgs(financeSrc, "aggregatePressure")];
    const fromFinance = [...new Set(sites.flatMap((s) => stateVarLiterals(s, declared)))].sort();
    const readPoints = [...new Set([...fromRules, ...fromFinance])].sort();

    console.log(`§1 真读点（world-read 声明表）：${fromRules.join(",")}`);
    console.log(`§1 真读点（finance-world 实参字面量）：${fromFinance.join(",")}`);
    console.log(`§1 声明名单：${[...DEVIATION_READ_STATE_VARS].sort().join(",")}`);

    // 正向金丝雀：扫描器必须能从一个**必然命中**的样例里取到值
    expect(stateVarLiterals(`deviationOf(x, "T", "overduePressure")`, declared)).toEqual(["overduePressure"]);
    // ⛔ 反向金丝雀：只出现在注释里的同名串**必须不被数到**（证明剥注释真的生效，不是装饰）
    expect(stateVarLiterals(stripComments(`// deviationOf(x, "T", "loadIndex")`), declared)).toEqual([]);
    // 金丝雀 2：域表过滤不许把真键也滤掉
    expect(declared).toContain("overduePressure");

    // 正向：消费端真读到的每一个，都必须在声明名单里（新增读点而不入名单 ⇒ 红）
    expect(readPoints, "有读点没进 DEVIATION_READ_STATE_VARS（新增读点要同步改名单与域表）").toEqual(
      [...DEVIATION_READ_STATE_VARS].sort(),
    );

    // 反向：名单里每一个都必须真的有读点（名单不许长出「没人读的条目」）
    for (const v of DEVIATION_READ_STATE_VARS) {
      expect(readPoints, `${v} 在名单里但全仓没有读点 ⇒ 名单在骗人`).toContain(v);
      // (a) 已声明域：没有声明就没有域、没有静息点，消费端无从取静息值
      expect(declared, `${v} 被按率消费，却没有声明域`).toContain(v);
      // (b) 静息点必须是个真数（(b) 之后静息值取 `baseSnapshot`，但生产者仍要有**声明的**锚）
      const d = stateVarDomains()[v];
      expect(Number.isFinite(d.restPoint), `${v} 的域没声明静息点`).toBe(true);
    }
  });

  it("§2/§3 零扰动 ⇒ 金额逐字节等于基线；有扰动 ⇒ 金额必须动（对照实验）", async () => {
    const t = await seededApp();

    // ── 臂 A：**零扰动**（不推任何 tick，世界态 = 开局快照）────────────────────────
    const z = await newSession(t);
    /**
     * 面 A/B 逐字节不变性（终裁强判据）：金额投影是**只读**的 ——
     * 它跑完不许动 `WorldSnapshot.state` 里任何一个格子。
     * 判据落在**格子值**上（不是"有没有报错"）：同一会话投影前后各取一次全量指纹，必须逐字节相等。
     */
    const before = await worldCells(t, z);
    const zd = await project(t, z);
    const after = await worldCells(t, z);
    console.log(`§2 世界态逐字节不变：cells=${before.cells} sha256=${before.digest} → ${after.digest}`);
    expect(after.digest, "金额投影必须是只读的：跑完 WorldSnapshot.state 逐字节不变（面 A/B 靠它）").toBe(
      before.digest,
    );
    expect(before.cells, "金丝雀：世界态非空（空世界这条断言恒真，等于没测）").toBeGreaterThan(1000);
    const zc = lineOf(zd, "COST");
    const zm = lineOf(zd, "MARGIN");
    const zr = lineOf(zd, "REVENUE");
    console.log(
      `§2 零扰动：REVENUE ${zr.rolling}→${zr.projected} COST ${zc.rolling}→${zc.projected} ` +
        `MARGIN ${zm.rolling}→${zm.projected} 静息缺席=${(zd.unresolvedRestPoints ?? []).length}`,
    );
    console.log(`§2 水平读数（面 C）：${levels(zd)}`);
    console.log(`§2 金额实际吃的偏离：cost=${((zc.projected / zc.rolling - 1) * 100).toFixed(6)}`);

    /**
     * 一条**对照实验臂**（铁律 1.5 判据一）：三元正极 priceShock 相对扰动 `mag`，走真传导链 2 跳。
     * 三元正极 —— demo 世界里 `priceShock` 有下游成本链的物料（同 `turn-loop.seam.test.ts`）。
     */
    const arm = async (mag: number) => {
      const sid = await newSession(t);
      await perturbDelta(t, sid, MAT_ID, mag);
      await tick(t, sid, 3);
      const d = await project(t, sid);
      const c = lineOf(d, "COST");
      const m = lineOf(d, "MARGIN");
      const r = lineOf(d, "REVENUE");
      console.log(
        `§3 Δ${mag > 0 ? "+" : ""}${mag}：REVENUE ${r.rolling}→${r.projected} ` +
          `COST ${c.rolling}→${c.projected} MARGIN ${m.rolling}→${m.projected} ` +
          `静息缺席=${(d.unresolvedRestPoints ?? []).length}`,
      );
      console.log(`§3 Δ${mag > 0 ? "+" : ""}${mag} 水平读数（面 C）：${levels(d)}`);
      console.log(
        `§3 Δ${mag > 0 ? "+" : ""}${mag} 金额实际吃的偏离：cost=${((c.projected / c.rolling - 1) * 100).toFixed(6)}`,
      );
      return { d, c, m };
    };

    // 臂 B①：**正向**相对扰动（源涨 ⇒ 成本压力偏离 > 0 ⇒ 成本必须涨、毛利必须跌）。
    const { d: ad, c: ac, m: am } = await arm(1000);
    // 臂 B②：**反向**相对扰动 Δ=−3（终裁点名的那条臂）。
    // 它比正向臂更硬：水平口径下 23.0367−1.755 = 21.28 仍**远大于 0** ⇒ 「拿水平当偏离」照样把成本**顶高**
    // （改前成本会涨到 700 量级），而正解的成本必须**降到基线以下**。**两臂符号相反**，
    // 于是「金额有没有真的吃偏离」在两臂上都被咬住，不是靠一个方向的巧合。
    const { d: bd, c: bc, m: bm } = await arm(-3);

    // ⚠ 三臂**全部测完、打完**才下断言 —— 这样变异反证（把三处金额改回水平）一次就能拿到
    // 「改前 × 三臂」的全部读数，不必为了看数去放宽某条断言。
    // 偏离为 0 ⇒ 因子 1 ⇒ 金额**逐字节**等于基线（这就是病：修前是 118.9 → −20.72）
    expect(zc.projected, "零扰动下成本偏离必须为 0（成本不许自己涨）").toBe(zc.rolling);
    expect(zm.projected, "零扰动下毛利必须等于基线（修前 118.9 → −20.72 就是它）").toBe(zm.rolling);
    // ⛔ 下面这条是防 (b) 把金额投影改死：只用 §2 的话，「恒等于基线」也能全绿。
    expect(ac.projected, "扰动后成本必须高于基线（否则 (b) 把金额投影改死了）").toBeGreaterThan(ac.rolling);
    expect(am.projected, "扰动后毛利必须低于基线").toBeLessThan(am.rolling);
    expect(bc.projected, "源跌 ⇒ 成本必须低于基线（水平口径下它会反向涨）").toBeLessThan(bc.rolling);
    expect(bm.projected, "源跌 ⇒ 毛利必须高于基线").toBeGreaterThan(bm.rolling);

    // 逐字节不变性：三臂的**压力披露**（面 C）各自是水平口径，与金额口径不是一回事 ——
    // 这条不断言数值，只断言「披露里带了静息缺席的账」这一形状（没有缺席就不该有这个键）。
    for (const d of [zd, ad, bd]) {
      const u = d.unresolvedRestPoints;
      if (u !== undefined) {
        expect(Array.isArray(u)).toBe(true);
        expect(d.notes.join("\n")).toContain("unresolvedRestPoints");
      }
    }
  }, 300_000);

  it("§5 现金半对照臂：有静息点 ⇒ 金额真的动；无静息点 ⇒ 金额纹丝不动但逐格点名", async () => {
    const t = await seededApp();
    const links = await t.repos.links.list("demo");
    // 一条**真**链路实例（不是编的 id —— 编 id 会让这条门在链路改了之后照样绿）：
    // Material --material_used_by_model--> Model --model_demanded_by_order--> Order --order_of_customer--> Customer
    const mubm = links.find((l) => l.type === "material_used_by_model");
    expect(mubm, "金丝雀：链路表里没有 material_used_by_model ⇒ 用例前提不成立").toBeDefined();
    const chainOrder = links.find((l) => l.type === "model_demanded_by_order" && l.fromId === mubm!.toId);
    expect(chainOrder, "金丝雀：该物料所属型号没有下游订单 ⇒ 用例前提不成立").toBeDefined();
    const orderId = chainOrder!.toId;
    const custId = links.find((l) => l.type === "order_of_customer" && l.fromId === orderId)!.toId;
    const invIds = links.filter((l) => l.type === "customer_has_invoice" && l.fromId === custId).map((l) => l.toId);
    expect(invIds.length, "该客户名下没有发票 ⇒ 应收链无从驱动，用例前提不成立").toBeGreaterThan(0);

    const run = async (base: Record<string, Record<string, number>>) => {
      const r = await t.app.inject({
        method: "POST",
        url: "/a/v1/sim/sessions",
        headers: ADMIN,
        payload: { baseSnapshot: base },
      });
      expect(r.statusCode, `建会话失败：${r.body}`).toBe(201);
      const sid = r.json().id as string;
      await perturbDelta(t, sid, mubm!.fromId, 1000);
      // 5 拍不是随手拍的：`demo_customer_receivable_to_invoice_overdue` 这条边 `delayTicks: 1`
      // （seed.ts「逾期是账期到了才显形」），且它上游还隔着 Material→Model→Order→Customer 三跳 ⇒
      // 3 拍时世界态里**还没有**发票的 overduePressure 格，逾期敞口恒 0 会读出假红。
      await tick(t, sid, 5);
      return { sid, d: await project(t, sid) };
    };

    // ── 臂①「无静息点」：世界态里**有**客户/发票的压力格，开局快照里**没有** ⇒ (b) 不消费它。
    //    这正是「水平读数非 0 而金额不许动」的场景 —— 改前它会把 0.126pp 当偏离乘进金额（本病的指纹）。
    const a = await run({ [orderId]: { costPressure: 0 } });
    const aLvl = (a.d.pressures as any[]).find((p) => p.stateVar === "receivablePressure");
    const aMiss = (a.d.unresolvedRestPoints ?? []).filter(
      (u: any) => u.stateVar === "receivablePressure" || u.stateVar === "overduePressure",
    );
    console.log(
      `§5 臂①（无静息点）：水平读数 receivablePressure=${aLvl.value}（承载 ${aLvl.carriers}）·` +
        ` 应收 ${a.d.cash.arProjected}（基线 ${a.d.cash.arBaseline}）· 静息缺席 ${aMiss.length} 格`,
    );
    // 金丝雀：世界态里必须真有承载格 —— 否则下面两条读不出是「静息值取不到」还是「压根没这格」。
    expect(aLvl.carriers, "金丝雀：世界态里必须有客户的 receivablePressure 格").toBeGreaterThan(0);
    expect(aMiss.length, "有世界态格、快照里取不到静息值 ⇒ 必须逐格进诚实缺席表").toBeGreaterThan(0);
    expect(
      a.d.cash.arProjected,
      "无静息点 ⇒ 应收投影一格都不许动（⛔ 既不许拿水平当偏离，也不许静默按偏离 0 乘）",
    ).toBe(a.d.cash.arBaseline);

    // ── 臂②「有静息点」：同一扰动、同一条链，唯一差别是把承载体播上静息点 ⇒ 金额必须真的动。
    const b = await run({
      [orderId]: { costPressure: 0 },
      [custId]: { receivablePressure: 0 },
      ...Object.fromEntries(invIds.map((id) => [id, { overduePressure: 0 }])),
    });
    const seeded = new Set<string>([`${custId}|receivablePressure`, ...invIds.map((id) => `${id}|overduePressure`)]);
    const bMiss = (b.d.unresolvedRestPoints ?? []).filter((u: any) => seeded.has(`${u.objectId}|${u.stateVar}`));
    console.log(
      `§5 臂②（有静息点）：应收 ${b.d.cash.arProjected}（基线 ${b.d.cash.arBaseline}）·` +
        ` 逾期敞口 ${b.d.cash.overdueExposure}（承载发票 ${b.d.cash.invoiceCarriers}）·` +
        ` 播过静息点的格进缺席表 ${bMiss.length}`,
    );
    expect(bMiss, "播过静息点的格不许进诚实缺席表（否则「金额动了」读不出是偏离驱动还是别的路）").toHaveLength(0);
    expect(b.d.cash.arProjected, "有静息点 ⇒ 应收投影必须真的动（否则 (b) 把现金半改死了）").toBeGreaterThan(
      b.d.cash.arBaseline,
    );
    // 金丝雀先于结论：世界态里得真有带 overduePressure 的发票格 ——
    // 否则「逾期敞口 = 0」读不出是「压根没这格」还是「偏离恰好为 0」。
    expect(
      b.d.cash.invoiceCarriers,
      "金丝雀：世界态里必须有带 overduePressure 的发票格（⛔ 没有就说明是拍数不够/链路没通，不是金额算对了）",
    ).toBeGreaterThan(0);
    expect(b.d.cash.overdueExposure, "有静息点 ⇒ 逾期敞口必须 > 0").toBeGreaterThan(0);
    // 两臂**同源同扰动**，唯一差别是「静息点在不在」—— 这才叫对照实验。
    expect(a.d.cash.invoiceUniverse, "两臂的发票全域必须相同（否则比的是两个世界）").toBe(b.d.cash.invoiceUniverse);
  }, 300_000);

  it("§4 静息值取不到 ⇒ 不退回 0，逐格点名（单元级）", () => {
    // (i) 世界态有格、快照里连对象都没有 ⇒ 记一条，返回 undefined（⛔ 不是 0）
    const r1 = new DeviationReader({ o1: { costPressure: 24 } }, {});
    expect(r1.deviationOf("o1", "Order", "costPressure")).toBeUndefined();
    expect(r1.unresolvedRestPoints()).toHaveLength(1);
    expect(r1.unresolvedRestPoints()[0].reason).toContain("开局快照里没有对象");

    // (ii) 世界态有格、快照有对象但没有那一格 ⇒ 记一条，返回 undefined
    const r2 = new DeviationReader({ o1: { costPressure: 24 } }, { o1: {} });
    expect(r2.deviationOf("o1", "Order", "costPressure")).toBeUndefined();
    expect(r2.unresolvedRestPoints()[0].reason).toContain("没有 costPressure 这一格");

    // (iii) 两格都在 ⇒ **偏离**，且**不是**水平本身
    const r3 = new DeviationReader({ o1: { costPressure: 24 } }, { o1: { costPressure: 21.24 } });
    expect(r3.deviationOf("o1", "Order", "costPressure")).toBeCloseTo(2.76, 10);
    expect(r3.unresolvedRestPoints()).toHaveLength(0);

    // (iv) 「世界态里没这格」= **不消费**，与「静息值取不到」是两件事：⛔ 不许记账、不许混
    const r4 = new DeviationReader({}, {});
    expect(r4.deviationOf("o1", "Order", "costPressure")).toBeUndefined();
    expect(r4.carried("o1", "costPressure")).toBe(false);
    expect(r4.unresolvedRestPoints(), "「不承载」不是「静息值取不到」——两件事不许混").toHaveLength(0);

    // (v) 同一格被多条规则读到 ⇒ 只记一条账（去重），且按稳定键排序（R6）
    const r5 = new DeviationReader({ o2: { overduePressure: 1 }, o1: { costPressure: 2 } }, {});
    r5.deviationOf("o2", "ARInvoice", "overduePressure");
    r5.deviationOf("o2", "ARInvoice", "overduePressure");
    r5.deviationOf("o1", "Order", "costPressure");
    expect(r5.unresolvedRestPoints()).toHaveLength(2);
    expect(r5.unresolvedRestPoints().map((u) => u.stateVar)).toEqual(["costPressure", "overduePressure"]);
  });
});
