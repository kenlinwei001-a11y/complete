import { describe, expect, it } from "vitest";
import { makeApp, debugUser } from "./helpers.js";
import { ParetoAssembleResultSchema, ParetoRequestSchema, ParetoResultSchema, type ParetoAssembleResult, type ParetoResult } from "@platform/contracts";

/**
 * WO-SIM-PARETO-MODEL-EXIT · **模型装配出口的接缝门**（DataCore 半）。
 *
 * ══ 今天的行为是 X，应该是 Y ══════════════════════════════════════════════════
 *
 * **X（开工时实测，两条各自成立）**
 *  ① 装配能力**有**但**没有出口**：`solvers/service.ts` 的 `assembleBaselineFromSelection`
 *     是 `private`，只在 `optimize_whatif` 的 `autoBind` 分支里走，**只回 Δ目标不回 args**。
 *     真跑原文（内存态 demo 租户）：
 *     `POST /a/v1/solvers/optimize_whatif/invoke` `{"args":{"family":"facility_location","autoBind":true,…}}`
 *     → `200 {"data":{"applicable":false,"missingRoles":["facility（Base 在选中范围内无实例）"],
 *              "baselineObjective":null,…}}` —— 通篇没有一格叫 `args`。
 *  ② 它只认 `facility_location`/`min_cost_flow` 两族，而这两族在内存态一律
 *     `400 未接入最优化引擎` ⇒ **能装配的解不了、解得了的装配不出**。
 *  于是 `POST /a/v1/sim/optimize-pareto` 那份必填的 `ParetoRequest` 谁都拼不出来，
 *  页4 前沿图恒 `data-source="placeholder"`。
 *
 * **Y（本门驱动的那条缝）**
 *  `POST …/optimize-pareto/assemble`（要范围）→ 服务端从**本租户已发布本体**推角色、装 args、
 *  声明目标、生成杠杆网格 → 回一份**完整的 `ParetoRequest`** →
 *  **把它原样 POST 给 `…/optimize-pareto`** → 真前沿。
 *
 * ══ 这道门咬的是链路不是函数（本仓复验头号判据）════════════════════════════════
 * 两步都走 **HTTP 路由**（`app.inject`），中间那份请求体**不是测试写的、是上一跳回的** ——
 * 装配器、契约、绑定层、求解器、路由、entitlement 任一半退化即红。
 * ⛔ 刻意**不**直调 `assembleParetoModel()`：只测装配函数是本仓记过的假绿第 9 形态
 * （「实现有、测试有、且是绿的，零生产调用方」）。
 *
 * ══ R14 反硬编码：本门的本体里**没有一个电池/基地字样** ══════════════════════════
 * 类型叫 `TicketOrder`/`Coach`，字段叫 `farePrice`/`refundCost`/`seatCapacity`/`runCost`。
 * 装配器若哪天偷偷硬编 `Order`/`Base`/`unitPrice`，本门当场红 —— 这就是那条硬编码的**捕手**。
 */

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 装置：一套与本仓演示行业**完全无关**的本体（客运售票）
// ══════════════════════════════════════════════════════════════════════════

const T = "acme"; // 非 demo 租户：顺带把 R2 隔离一起咬了
const ACME = debugUser(T, "admin", "admin");
const OTHER = debugUser("zeta", "admin", "admin");

type App = Awaited<ReturnType<typeof makeApp>>;

const putType = (
  t: App,
  tenantId: string,
  key: string,
  // `unit` 是 WO-MARGIN-AXIS 加的：毛利轴的准入证就现算自这一格（本体声明的量纲）。
  props: { propKey: string; dataType: string; isPrimaryKey?: boolean; refToTypeKey?: string; unit?: string }[],
) =>
  t.repos.ontologyTypes.put({
    id: `ot_${tenantId}_${key}`, tenantId, key, displayName: key, domain: "x", version: 1, status: "ACTIVE",
    derivedProperties: [], sourceBindings: [],
    properties: props.map((p) => ({ isPrimaryKey: false, ...p })) as never,
  });

const putObj = (t: App, tenantId: string, type: string, id: string, props: Record<string, unknown>) =>
  t.repos.objects.put({ origin: { type: "MANUAL" }, id, tenantId, type, props });

/** 开门：`sim.sandbox` 是这两条口**同一格**门禁（关 ⇒ 404，见用例 ⑤）。 */
const enableSim = (t: App, tenantId: string, headers: Record<string, string>) =>
  t.app.inject({ method: "PUT", url: `/a/v1/tenants/${tenantId}/features`, headers, payload: { overrides: { "sim.sandbox": true } } });

/**
 * 售票世界：**总需求 41 > 三节车厢的最小档合计 30** —— 这一条是刻意的：
 * 产能不够用时"多拉一单"才要付出"另一单被挤"的代价，前沿上才会有**真的权衡**。
 * 若把产能放到人人有座，营收维恒定，"前沿"会退化成一个点（那也是真答案，只是咬不住几何）。
 */
async function seedTicketWorld(t: App, tenantId = T): Promise<void> {
  // 需求侧：命中 leaf 词库（…order…）+ 有"量"(seatQty→qty 词库) + 有"价"(farePrice→revenue 词库)
  //         + 有"罚"(refundCost→cost 词库，且 ≠ 价) ⇒ penalty 目标也接得到地。
  await putType(t, tenantId, "TicketOrder", [
    { propKey: "ticketNo", dataType: "string", isPrimaryKey: true },
    { propKey: "seatQty", dataType: "number" },
    { propKey: "farePrice", dataType: "number" },
    { propKey: "refundCost", dataType: "number" },
  ]);
  // 资源侧：有"产能"(seatCapacity) + 有"成本"(runCost) ⇒ cost 目标接得到地。
  await putType(t, tenantId, "Coach", [
    { propKey: "coachId", dataType: "string", isPrimaryKey: true },
    { propKey: "seatCapacity", dataType: "number" },
    { propKey: "runCost", dataType: "number" },
  ]);
  const orders: [string, number, number, number][] = [
    ["o1", 12, 100, 50], ["o2", 8, 60, 5], ["o3", 15, 90, 40], ["o4", 6, 30, 30],
  ];
  for (const [id, seatQty, farePrice, refundCost] of orders) {
    await putObj(t, tenantId, "TicketOrder", id, { ticketNo: id, seatQty, farePrice, refundCost });
  }
  const coaches: [string, number, number][] = [["c1", 20, 5], ["c2", 10, 3], ["c3", 30, 7]];
  for (const [id, seatCapacity, runCost] of coaches) {
    await putObj(t, tenantId, "Coach", id, { coachId: id, seatCapacity, runCost });
  }
}

const assemble = async (t: App, headers: Record<string, string>, payload: Record<string, unknown> = {}) => {
  const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/optimize-pareto/assemble", headers, payload });
  return { statusCode: r.statusCode, body: r.body, json: r.statusCode === 200 ? (JSON.parse(r.body) as ParetoAssembleResult) : undefined };
};

const solve = async (t: App, headers: Record<string, string>, payload: unknown) => {
  const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/optimize-pareto", headers, payload: payload as object });
  return { statusCode: r.statusCode, body: r.body };
};

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 用例
// ══════════════════════════════════════════════════════════════════════════

describe("WO-SIM-PARETO-MODEL-EXIT · 装配出口 → 求解 整条缝", () => {
  it("⓪ 金丝雀：装置与探针先自证（不中 ⇒ 报「工具坏了」，不许读作「接线对了」）", async () => {
    const t = await makeApp();
    await enableSim(t, T, ACME);
    await seedTicketWorld(t);
    // (a) 本体真的进去了（种子失败会让下面每一条报缺都"因为正确的原因"变绿）。
    const types = await t.repos.ontologyTypes.list(T);
    expect(types.map((x) => x.key).sort(), "本体种子没进去 ⇒ 后面所有报缺都是空转").toEqual(["Coach", "TicketOrder"]);
    expect((await t.repos.objects.listByType(T, "TicketOrder")).length, "订单实例没进去").toBe(4);
    expect((await t.repos.objects.listByType(T, "Coach")).length, "车厢实例没进去").toBe(3);
    // (b) 路由真的在（404 会让"装不出"与"没这条路"分不开）。
    const r = await assemble(t, ACME);
    expect(r.statusCode, "装配口不通 ⇒ 本门测的是别的东西").toBe(200);
    // (c) 门禁探针可用：关着的租户必须 404（用例⑤ 靠它）。
    const closed = await assemble(t, OTHER);
    expect(closed.statusCode, "未开门的租户居然通了 ⇒ 门禁探针失效").toBe(404);
  });

  it("① 正向整条缝：要范围 → 装配 → **把装出来的那份原样求解** → 真前沿（多点·账平）", async () => {
    const t = await makeApp();
    await enableSim(t, T, ACME);
    await seedTicketWorld(t);

    const a = await assemble(t, ACME, { sessionId: "sess-1" });
    expect(a.statusCode).toBe(200);
    const parsed = ParetoAssembleResultSchema.safeParse(a.json);
    expect(parsed.success, `装配回包过不了契约：${JSON.stringify(a.json)}`).toBe(true);
    const res = parsed.success ? parsed.data : undefined;
    expect(res?.applicable, `装不出来：${JSON.stringify(a.json)}`).toBe(true);
    if (!res || res.applicable !== true) return;

    // ── 反向证据 1：角色是**从本体推出来的**，不是硬编 —— 本体里一个电池字样都没有。
    const roleMap = Object.fromEntries(res.roles.map((r) => [r.role, r.ref]));
    expect(roleMap.order).toBe("TicketOrder");
    expect(roleMap.line).toBe("Coach");
    expect(roleMap.revenue).toBe("TicketOrder.farePrice");
    expect(roleMap.qty).toBe("TicketOrder.seatQty");
    expect(roleMap.penalty).toBe("TicketOrder.refundCost");
    expect(roleMap.line_capacity).toBe("Coach.seatCapacity");
    expect(roleMap.line_assign_cost).toBe("Coach.runCost");
    expect(JSON.stringify(res), "装配结果里出现了本仓演示行业的实体名 ⇒ 有硬编码").not.toMatch(/Base|unitPrice|formationCap/);

    // ── 反向证据 2：三个**接得到本体地**的目标（label 就是它的出处），外加一根**交付**。
    //
    // ⚠ WO-PARETO-AXES 起这里从 3 根变 4 根。第 4 根（`serviceRate`）与前三根**性质不同**：
    //   前三根的 label 是「类型.字段」= 它从本体哪一格接出来的；
    //   第 4 根是引擎结构读数（`servedCount`/`orderCount`）的派生，本体上没有对应字段。
    //   这个区别**必须被咬住** —— 下面 `groundedLabels` 那一条正是防止哪天有人
    //   把一根派生轴混进"接得到地"的那批里，从而让「真目标 < 2 ⇒ 报缺」这条红线失效。
    //
    // ⚠ WO-MARGIN-AXIS 起**顺序变了**：决策轴（毛利/交付）打头，其构成项（营收/成本/违约）在后。
    //   顺序不是审美 —— 前端散点图取前两根当 X/Y（`projectPareto` 的 `const [ax0, ax1] = axes`）。
    //   本例**没有毛利轴**，因为这个租户的本体一格单位都没声明 ⇒ 折不到同一货币单位 ⇒
    //   `currencyAligned:false` ⇒ 毛利照红线报缺（下面 `unavailableObjectives` 咬住）。
    expect(res.request.objectives.map((o) => `${o.key}:${o.dir}:${o.label}`)).toEqual([
      "serviceRate:max:获排率（获排单数 ÷ 总单数）",
      "revenue:max:TicketOrder.farePrice",
      "penalty:min:TicketOrder.refundCost",
      "cost:min:Coach.runCost",
    ]);
    // 后三根的 label 必须逐个是「本租户某类型.某字段」；打头那根必须**不是** ——
    // 它若长成 `X.y` 的样子，就说明有人给它伪造了一个本体出处。
    const groundedLabels = res.request.objectives.slice(1).map((o) => o.label ?? "");
    for (const l of groundedLabels) expect(l).toMatch(/^(TicketOrder|Coach)\.[A-Za-z]+$/);
    expect(res.request.objectives[0]!.label ?? "").not.toMatch(/^(TicketOrder|Coach)\./);
    // 量纲折不动 ⇒ 毛利**必须仍在报缺清单里**，且不许出现在 objectives 里。
    // 这一条是本单红线的反向证据：宁可报缺，也不给一个两边不同单位硬减出来的数。
    expect(res.request.objectives.some((o) => o.key === "margin"), "本体零单位声明却算出了毛利 ⇒ 准入证形同虚设").toBe(false);
    expect((res.request.unavailableObjectives ?? []).map((g) => g.key)).toContain("margin");
    // ── 反向证据 3：杠杆档位取自**实测产能取值**（10/20/30），不是编出来的等分刻度。
    expect(res.request.levers.map((l) => l.values)).toEqual([[10, 20, 30], [10, 20, 30], [10, 20, 30]]);
    expect(res.request.levers.map((l) => l.key).sort()).toEqual(["lines.c1.capacity", "lines.c2.capacity", "lines.c3.capacity"]);
    expect(res.request.sessionId, "R6 确定性键没透进装配结果").toBe("sess-1");

    // ── 头号判据：**把上一跳回的那份原样发出去**（一格不改）→ 真前沿。
    const s = await solve(t, ACME, res.request);
    expect(s.statusCode, `装出来的请求求解失败：${s.body}`).toBe(200);
    const out = ParetoResultSchema.parse(JSON.parse(s.body)) as ParetoResult;
    expect(out.iterations, "杠杆网格 3 根 × 3 档 = 27 个候选").toBe(27);
    expect(out.iterations, "账不平 ⇒ 有解被静默吞掉").toBe(out.frontier.length + out.dominated.length + out.residual);
    expect(out.frontier.length, "前沿一个点都没有 ⇒ 这不是前沿").toBeGreaterThan(1);
    expect(out.dominated.length, "一个被支配解都没有 ⇒ 支配剔除根本没发生（网格白扫）").toBeGreaterThan(0);

    // ── 反向证据 4：**真的是权衡**，不是一维排序 —— 前沿上存在两个解，一个营收更高、
    //    另一个成本更低。少了这一条，"多点前沿"可能只是同一堆并列点。
    const better = (k: string, x: number, y: number) => (k === "revenue" ? x > y : x < y);
    const tradeoff = out.frontier.some((p) =>
      out.frontier.some((q) => p.id !== q.id && better("revenue", p.metrics.revenue!, q.metrics.revenue!) && better("cost", q.metrics.cost!, p.metrics.cost!)),
    );
    expect(tradeoff, "前沿上没有一对真权衡（营收更高 vs 成本更低）⇒ 前沿是退化的").toBe(true);

    // ── 反向证据 5：解的数值**真来自本体**（41 座需求 vs 最小档 30 座 ⇒ 一定有人被挤）。
    const minCap = out.frontier.concat(out.dominated).find((p) => p.levers.every((l) => l.value === 10));
    expect(minCap, "最小档那个候选不见了").toBeDefined();
    expect(minCap!.metrics.penalty, "全档最小产能下居然零违约 ⇒ 产能约束没生效").toBeGreaterThan(0);
  });

  it("② 反向：本体撑不起两个真目标 ⇒ applicable:false（**不补一个恒为 0 的假目标**）", async () => {
    const t = await makeApp();
    await enableSim(t, T, ACME);
    // 与①同一个世界，唯独**去掉两个成本字段**：订单没有 refundCost、车厢没有 runCost。
    await putType(t, T, "TicketOrder", [
      { propKey: "ticketNo", dataType: "string", isPrimaryKey: true },
      { propKey: "seatQty", dataType: "number" },
      { propKey: "farePrice", dataType: "number" },
    ]);
    await putType(t, T, "Coach", [
      { propKey: "coachId", dataType: "string", isPrimaryKey: true },
      { propKey: "seatCapacity", dataType: "number" },
    ]);
    await putObj(t, T, "TicketOrder", "o1", { ticketNo: "o1", seatQty: 12, farePrice: 100 });
    await putObj(t, T, "Coach", "c1", { coachId: "c1", seatCapacity: 20 });
    await putObj(t, T, "Coach", "c2", { coachId: "c2", seatCapacity: 10 });

    const a = await assemble(t, ACME);
    expect(a.statusCode, "本体撑不起模型是**结论**不是故障 ⇒ 必须 200，不许 4xx/5xx").toBe(200);
    expect(a.json?.applicable, "只剩一个真目标却装出来了 ⇒ 补了假目标").toBe(false);
    if (a.json?.applicable !== false) return;
    // 报缺必须**点名到字段**，让人去补本体而不是去改请求。
    expect(a.json.missingRoles.join("|")).toMatch(/penalty（TicketOrder 上没有命中成本\/违约词库的数值字段）/);
    expect(a.json.missingRoles.join("|")).toMatch(/cost（/);
    expect(a.json.note).toMatch(/只接地到 1 个真目标/);
    // 关键：这一态下调用方**拿不到任何可发的请求** ⇒ 前端据此不发 pareto（前端半由
    // `sandbox-pareto-model-exit.seam.test.tsx` 咬「零请求 + placeholder」）。
    expect(Object.keys(a.json).includes("request"), "报缺却还给了一份 request ⇒ 兜了假模型").toBe(false);
  });

  it("③ R6 确定性：同租户同范围两跑，装配结果与求解结果**逐字节一致**", async () => {
    const run = async (): Promise<{ asm: string; sol: string }> => {
      const t = await makeApp();
      await enableSim(t, T, ACME);
      await seedTicketWorld(t);
      const a = await assemble(t, ACME, { sessionId: "sess-1" });
      const j = a.json as Extract<ParetoAssembleResult, { applicable: true }>;
      const s = await solve(t, ACME, j.request);
      return { asm: a.body, sol: s.body };
    };
    const r1 = await run();
    const r2 = await run();
    expect(r1.asm, "装配结果两跑不一致 ⇒ 排序缺 tiebreaker（R6 破）").toBe(r2.asm);
    expect(r1.sol, "求解结果两跑不一致").toBe(r2.sol);
  });

  it("④ R2 租户隔离：装配只读本租户 —— 别租户的本体一行都摸不到", async () => {
    const t = await makeApp();
    await enableSim(t, T, ACME);
    await enableSim(t, "zeta", OTHER);
    await seedTicketWorld(t, T); // 只给 acme 播种，zeta 是空的
    const mine = await assemble(t, ACME);
    expect(mine.json?.applicable, "自己租户装不出 ⇒ 本用例在测别的东西").toBe(true);
    const theirs = await assemble(t, OTHER);
    expect(theirs.statusCode).toBe(200);
    expect(theirs.json?.applicable, "空租户居然装出来了 ⇒ 读到了别人的本体（R2 破）").toBe(false);
    expect(JSON.stringify(theirs.json), "别租户回包里出现了本租户的类型名").not.toMatch(/TicketOrder|Coach/);
  });

  it("⑤ R3 门禁先于 authz：`sim.sandbox` 关 ⇒ 404 FEATURE_NOT_FOUND（不泄露存在性）", async () => {
    const t = await makeApp();
    await seedTicketWorld(t); // 本体齐全 —— 证明 404 来自门禁而不是"装不出"
    const r = await assemble(t, ACME);
    expect(r.statusCode).toBe(404);
    expect(JSON.parse(r.body).error.code).toBe("FEATURE_NOT_FOUND");
    // 同一格门禁也管着求解口（拆成两个 entitlement 会造出"能装配不能求解"的半开态）。
    const s = await solve(t, ACME, { family: "cross_object_occupancy", objectives: [{ key: "a", dir: "min" }, { key: "b", dir: "min" }], levers: [{ key: "x.y.z", values: [1] }] });
    expect(s.statusCode, "两条口的门禁不是同一格").toBe(404);
  });

  it("⑥ 错误信封：坏形状走 `parseBody` ⇒ 400 VALIDATION_ERROR（不是 500、不回显 zod 内部结构）", async () => {
    const t = await makeApp();
    await enableSim(t, T, ACME);
    const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/optimize-pareto/assemble", headers: ACME, payload: { family: 123, nope: 1 } });
    expect(r.statusCode, "裸 .parse 会让校验失败漏成 500（本仓刚在同一条路由上修过这个坑）").toBe(400);
    const e = JSON.parse(r.body).error;
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(e.requestId, "错误信封缺 requestId").toBeTruthy();
    expect(r.body, "回显了 zod 内部结构").not.toMatch(/invalid_type|"expected"|"received"/);
  });

  it("⑦ 装不出的族：诚实点名「能装哪些」，**不替调用方猜一份**", async () => {
    const t = await makeApp();
    await enableSim(t, T, ACME);
    await seedTicketWorld(t);
    const a = await assemble(t, ACME, { family: "facility_location" });
    expect(a.statusCode).toBe(200);
    expect(a.json?.applicable).toBe(false);
    if (a.json?.applicable !== false) return;
    expect(a.json.note).toMatch(/cross_object_occupancy/);
  });

  it("⑧ 范围收窄：selection 点名的车厢之外的**一节都不进 args**", async () => {
    const t = await makeApp();
    await enableSim(t, T, ACME);
    await seedTicketWorld(t);
    const a = await assemble(t, ACME, { selection: [{ objectType: "Coach", objectId: "c1" }, { objectType: "Coach", objectId: "c3" }] });
    const j = a.json as Extract<ParetoAssembleResult, { applicable: true }>;
    expect(j.applicable).toBe(true);
    // `ParetoRequest.args` 在契约里是**可选**的 ⇒ 直接下标取 `TS18048 possibly undefined`。
    // 这里先把「args 必须在」单独断言出来（装配成功却不给 args 本身就是缺陷，值得独立报错），
    // 之后再取字段 —— 比 `!` 断言强：`!` 只是让类型闭嘴，缺 args 时会在下一行抛 TypeError，
    // 报错指向的是「读不到 .lines」而不是「装配没给 args」，那是把病因盖掉。
    const args = j.request.args;
    expect(args, "装配声明 applicable 却没给 args").toBeDefined();
    expect((args!.lines as { id: string }[]).map((l) => l.id).sort(), "收窄没生效（c2 还在）").toEqual(["c1", "c3"]);
    expect((args!.orders as unknown[]).length, "订单侧被误伤收窄了").toBe(4);
    // 装出来的仍是一份合法请求（收窄不该把契约弄坏）。
    expect(ParetoRequestSchema.safeParse(j.request).success).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // § 2 · WO-MARGIN-AXIS · 毛利成为一根真轴
  // ══════════════════════════════════════════════════════════════════════════
  //
  // ══ 今天的行为是 X，应该是 Y（开工实测原文，本机 4001 内存态 demo 租户）══
  //
  // **X①（营收轴不含用量）**：`inproc-optimizer` 对获排单求 `Σ ord.revenue`，而绑定层把
  //   `orders[].revenue` 取成 `OrderLine.unitPrice`（元/**件**）。实测两行同型号订单
  //   `SO-900030-L2`(qty 722) 与 `SO-900215-L1`(qty 7220) **各贡献同一个 21,626** ——
  //   10 倍的量差在这根轴上完全消失。⇒ 那不是营收，是单价之和。
  // **X②（两轴不同量纲）**：`OrderLine.unitPrice` 声明「元」、`Base.serveCost` 声明「万元」，
  //   实测读数 `revenue 9,187,992` vs `cost 17,039.17` —— 差三个量级，相减无意义。
  // **X③（毛利根本没有）**：装配器把 `margin` 放在 `unavailableObjectives` 里报缺。
  //
  // **Y**：营收 = Σ(单价 × 用量)、成本折到同一货币单位、`margin = 营收 − 成本` **逐解一个值**、
  //   进支配比较与加权名次；折不齐则**报错或报缺**，绝不给一个硬减出来的数。
  //
  // ⚠ 本节的本体仍与本仓演示行业无关（客运售票），且**刻意复刻那对量纲**：
  //   营收侧「元」× 成本侧「万元」—— 折算若没发生，毛利会差 10⁴ 倍，下面的等式当场红。

  /**
   * 售票世界·量纲版：营收侧是**每座票价**（强度量，元），成本侧是**每趟运营成本**（万元）。
   *
   * `o-small` / `o-big` 是**对照实验①的那一对**：同一个 `pricePerUnit`、`seatQty` 相差整 10 倍。
   * 修前它们对营收轴贡献相同（病），修后必须相差整 10 倍。
   */
  async function seedUnitPricedWorld(t: App, tenantId = T, runCostWanOverride?: Record<string, number>): Promise<void> {
    await putType(t, tenantId, "TicketOrder", [
      { propKey: "ticketNo", dataType: "string", isPrimaryKey: true },
      { propKey: "seatQty", dataType: "number", unit: "件" },
      // 命中 `revenue`（price）**且**命中 `unitRate`（perUnit）⇒ 走 `unit_revenue` 角色 ⇒ 乘用量。
      { propKey: "pricePerUnit", dataType: "number", unit: "元" },
      { propKey: "refundCost", dataType: "number", unit: "元" },
    ]);
    await putType(t, tenantId, "Coach", [
      { propKey: "coachId", dataType: "string", isPrimaryKey: true },
      { propKey: "seatCapacity", dataType: "number" },
      // ⚠ 单位**故意与营收侧不同**（万元 vs 元）：不折算就差 10⁴ 倍。
      { propKey: "runCostWan", dataType: "number", unit: "万元" },
    ]);
    const orders: [string, number, number, number][] = [
      ["o-small", 2, 100, 5], ["o-big", 20, 100, 40], ["o3", 15, 90, 30], ["o4", 6, 60, 10],
    ];
    for (const [id, seatQty, pricePerUnit, refundCost] of orders) {
      await putObj(t, tenantId, "TicketOrder", id, { ticketNo: id, seatQty, pricePerUnit, refundCost });
    }
    // 总需求 43 > 最小档合计 30 ⇒ 一定有人被挤（否则营收维恒定，前沿退化成一个点）。
    const coaches: [string, number, number][] = [["c1", 20, 5], ["c2", 10, 3], ["c3", 30, 7]];
    for (const [id, seatCapacity, runCostWan] of coaches) {
      await putObj(t, tenantId, "Coach", id, { coachId: id, seatCapacity, runCostWan: runCostWanOverride?.[id] ?? runCostWan });
    }
  }

  it("⑨ 毛利成轴：营收乘用量（对照实验①·同价 10 倍量 ⇒ 贡献 10 倍）+ 元/万元折齐 + margin 逐解一个值", async () => {
    const t = await makeApp();
    await enableSim(t, T, ACME);
    await seedUnitPricedWorld(t);

    const a = await assemble(t, ACME);
    expect(a.statusCode, a.body).toBe(200);
    // 先按**联合类型**收下（不预先 cast 成 applicable:true），这样装配失败时
    // 断言消息里能带上服务端给的 `note` —— 少了它，红的时候只看到 `false !== true`，
    // 病因（缺哪个角色）全丢。
    const parsed = ParetoAssembleResultSchema.parse(a.json) as ParetoAssembleResult;
    expect(parsed.applicable, parsed.applicable === false ? parsed.note : "").toBe(true);
    const j = parsed as Extract<ParetoAssembleResult, { applicable: true }>;

    // ── ⓪ 金丝雀：先自证这套装置真的接到了「单价」那条路，而不是碰巧走了老路 ────────
    const roleMap = Object.fromEntries(j.roles.map((r) => [r.role, r.ref]));
    expect(roleMap.unit_revenue, "营收没走 unit_revenue 角色 ⇒ 单价/金额的区分根本没生效，下面的 10 倍是假的").toBe("TicketOrder.pricePerUnit");
    expect(roleMap.revenue, "同时又绑了 revenue 角色 ⇒ 两条路都开着，语义打架").toBeUndefined();
    const args = j.request.args;
    expect(args, "装配声明 applicable 却没给 args").toBeDefined();
    expect(args!.revenueFromUnitRate, "回包没自述『营收是单价×用量』").toBe(true);
    expect(args!.revenueQtyProp).toBe("seatQty");
    expect(args!.currencyAligned, "元/万元没折齐 ⇒ 毛利轴不该出现").toBe(true);
    expect(args!.currencyUnit).toBe("元");

    // ── 对照实验①（本单验收判据）：同价、量差 10 倍 ⇒ 营收贡献必须差 10 倍 ──────────
    //    修前这两个数**相同**（那就是病：一张 2 件的单与一张 20 件的单贡献一样多营收）。
    const orders = args!.orders as { id: string; revenue: number; qty: number }[];
    const small = orders.find((o) => o.id === "o-small")!;
    const big = orders.find((o) => o.id === "o-big")!;
    expect(small.qty).toBe(2);
    expect(big.qty).toBe(20);
    expect(small.revenue, "小单营收 ≠ 单价×用量").toBe(200);
    expect(big.revenue, "大单营收 ≠ 单价×用量").toBe(2000);
    expect(big.revenue / small.revenue, "量差 10 倍而营收贡献没差 10 倍 ⇒ 用量项没进公式").toBe(big.qty / small.qty);
    expect(small.revenue, "两单营收相同 ⇒ 病还在（这正是修前的读数）").not.toBe(big.revenue);

    // ── 量纲：成本侧「万元」必须已折成「元」（5 万元 → 50000）。折算没发生就差 10⁴ 倍。
    const elig = args!.eligibility as { order: string; line: string; cost: number }[];
    const costByLine = new Map(elig.map((e) => [e.line, e.cost]));
    expect([...costByLine.entries()].sort(), "万元没折成元（或折错倍数）").toEqual([["c1", 50000], ["c2", 30000], ["c3", 70000]]);

    // ── 毛利已是在册真轴，且**打头**（前端散点取前两根当 X/Y）；不再出现在报缺清单里。
    expect(j.request.objectives[0]!.key).toBe("margin");
    expect(j.request.objectives[0]!.unit).toBe("元");
    expect(j.request.objectives.map((o) => o.key)).toEqual(["margin", "serviceRate", "revenue", "penalty", "cost"]);
    expect((j.request.unavailableObjectives ?? []).map((g) => g.key), "毛利接上了却还在报缺清单里 ⇒ 屏上会同时说『有』和『要不到』").not.toContain("margin");
    expect((j.request.unavailableObjectives ?? []).map((g) => g.key), "现金今天仍答不了（本族无时间维），不许悄悄消失").toContain("cash");

    // ── 头号判据：把装出来的那份**原样**求解 → 毛利逐解一个值、且恒等于 营收−成本 ────
    const s = await solve(t, ACME, j.request);
    expect(s.statusCode, s.body).toBe(200);
    const out = ParetoResultSchema.parse(JSON.parse(s.body)) as ParetoResult;
    const all = [...out.frontier, ...out.dominated];
    expect(all.length, "一个解都没有").toBeGreaterThan(1);
    for (const p of all) {
      expect(p.metrics.margin, `解 ${p.id} 没有毛利读数`).toBeTypeOf("number");
      expect(p.metrics.margin, `解 ${p.id} 的毛利 ≠ 营收−成本 ⇒ 这根轴算的是别的东西`).toBe(p.metrics.revenue! - p.metrics.cost!);
    }
    // **不是恒定轴**（本仓明令禁止把季度聚合那种不随解变化的数当轴）：至少两个不同读数。
    expect(new Set(all.map((p) => p.metrics.margin)).size, "全体候选的毛利读数只有一个 ⇒ 这是一根恒定轴，在支配比较里永远打平").toBeGreaterThan(1);
    // 权重面板：毛利必须**真进**加权名次（不是前端摆设）——权重表里有它、名次覆盖整条前沿。
    expect(Object.keys(out.weights).sort()).toEqual(["cost", "margin", "penalty", "revenue", "serviceRate"]);
    expect(out.ranking.length).toBe(out.frontier.length);
  });

  it("⑩ 对照实验②：调高某车厢运营成本 ⇒ 毛利变小、营收纹丝不动（营收跟着变 = 成本误接进营收路径）", async () => {
    const t = await makeApp();
    await enableSim(t, T, ACME);
    await seedUnitPricedWorld(t);
    const before = ParetoAssembleResultSchema.parse((await assemble(t, ACME)).json) as Extract<ParetoAssembleResult, { applicable: true }>;
    const s0 = await solve(t, ACME, before.request);
    expect(s0.statusCode, s0.body).toBe(200);
    const out0 = ParetoResultSchema.parse(JSON.parse(s0.body)) as ParetoResult;

    // 只动**最贵**那节车厢（c3，7 万元）——它在贪心的"成本升序候选表"里本就排最后，
    // 调高不改变任何一单的择线次序 ⇒ 指派不变 ⇒ 营收/获排率必须逐字不变，只有成本与毛利动。
    // ⚠ 挑最贵的那一节是**刻意**的：随便挑一节会改变择线次序，营收跟着变，
    //    那时就分不清「成本误接进营收」与「优化器合理改道」——判据会失去分辨力。
    const t2 = await makeApp();
    await enableSim(t2, T, ACME);
    await seedUnitPricedWorld(t2, T, { c3: 17 }); // 7 万元 → 17 万元（+10 万元/趟 = +100000 元）
    const after = ParetoAssembleResultSchema.parse((await assemble(t2, ACME)).json) as Extract<ParetoAssembleResult, { applicable: true }>;
    const s1 = await solve(t2, ACME, after.request);
    expect(s1.statusCode, s1.body).toBe(200);
    const out1 = ParetoResultSchema.parse(JSON.parse(s1.body)) as ParetoResult;

    const byId0 = new Map([...out0.frontier, ...out0.dominated].map((p) => [p.id, p]));
    const byId1 = new Map([...out1.frontier, ...out1.dominated].map((p) => [p.id, p]));
    const shared = [...byId0.keys()].filter((id) => byId1.has(id));
    expect(shared.length, "两跑没有一个同名解可比 ⇒ 对照实验做不成").toBeGreaterThan(0);
    let sawCostRise = false;
    for (const id of shared) {
      const p0 = byId0.get(id)!, p1 = byId1.get(id)!;
      expect(p1.metrics.revenue, `解 ${id}：调成本却把营收也带动了 ⇒ 成本被误接进营收路径`).toBe(p0.metrics.revenue);
      expect(p1.metrics.serviceRate, `解 ${id}：择线次序被改变了，本对照实验的前提不再成立`).toBe(p0.metrics.serviceRate);
      expect(p1.metrics.cost!, `解 ${id}：成本没变大`).toBeGreaterThanOrEqual(p0.metrics.cost!);
      // 毛利必须**恰好**少掉成本涨的那一块 —— 只断言"变小"会放过一个算错倍数的实现。
      expect(p1.metrics.margin, `解 ${id}：Δ毛利 ≠ −Δ成本`).toBe(p0.metrics.margin! - (p1.metrics.cost! - p0.metrics.cost!));
      if (p1.metrics.cost! > p0.metrics.cost!) {
        sawCostRise = true;
        expect(p1.metrics.margin!, `解 ${id}：成本涨了毛利却没跌`).toBeLessThan(p0.metrics.margin!);
      }
    }
    expect(sawCostRise, "没有任何一个解的成本变大 ⇒ 这次调高压根没被读到（对照实验空转）").toBe(true);
  });

  it("⑪ 折不齐就报错，不给数：声明 margin 但 args 未标 currencyAligned ⇒ 400（机器先说话）", async () => {
    const t = await makeApp();
    await enableSim(t, T, ACME);
    await seedUnitPricedWorld(t);
    const j = ParetoAssembleResultSchema.parse((await assemble(t, ACME)).json) as Extract<ParetoAssembleResult, { applicable: true }>;
    // 只抹掉那一格准入证，其余一字不动 —— 变异反证：守卫若是装饰品，这里会照常回 200 + 一个错数。
    const tampered = { ...j.request, args: { ...(j.request.args as Record<string, unknown>), currencyAligned: false } };
    const s = await solve(t, ACME, tampered);
    expect(s.statusCode, `未折齐却把毛利算出来了：${s.body.slice(0, 300)}`).toBe(400);
    expect(s.body).toMatch(/currencyAligned/);
    // 金丝雀：同一份请求**不抹**那一格时必须 200 —— 否则上面的 400 可能来自任何别的毛病。
    const ok = await solve(t, ACME, j.request);
    expect(ok.statusCode, "原样请求也 400 ⇒ 上面那个 400 不能证明是守卫拦的").toBe(200);
  });
});
