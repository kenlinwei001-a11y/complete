import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import { BATTERY_ACTION_TYPES } from "../src/synthetic/battery.js";

/**
 * WO-ACTION-NOOP-EXEC · 非 global-sim 的 `plan_change` **按 payload 形态二分**（G-ACTION-NOOP-EXEC 续接）。
 *
 * ── 病灶与本单改动 ───────────────────────────────────────────────────────────
 * `plan_change` 一个 key 承载六条生产者，此前只有 `source:"global-sim"` 一条有真执行器，
 * 其余**一律诚实失败**。实测（WO-ACTION-NOOP-EXEC）发现这一刀切错了半边：
 * 风险看板「采纳风险处置方案」（`RiskBoardView.tsx adoptScenario()`）发的
 * `payload.levers = LiveScenario.apply`，其契约就是 `{objectType,objectId,prop,value}[]` ——
 * **与 `采纳产能保障方案` 的杠杆同形**，也就是说它一直带着一份可直接落库的真值写入指令，
 * 却因为 source 不叫 global-sim 而被判「未实现」。本单据此二分：
 *   · 带 levers → 真写本体属性 + runDerivations（与 `采纳产能保障方案` **同一份**写入器）；
 *   · 不带 levers → 仍诚实失败，但错误里说清**为什么**（模拟态结论 / 无落点），欠账可读。
 *
 * ── 本测的头号判据（写死在这里防回潮）─────────────────────────────────────────
 * **审批后回仓储查那个对象，属性必须真的变成了拨定值。**
 * 断言 `ok:true` / `status==="EXECUTED"` / targetRef 非空都是**运输层**断言 ——
 * 那正是让「假 MO 号」这个病灶存活至今的东西（状态全绿、真值零动）。
 *
 * ── 为什么第一条是金丝雀（铁律 0.6：扫描/检查类结论一律先自证工具）───────────────
 * 本测的核心手法是「建草稿 → 审批 → 回读对象核对字段」。若这套手法本身坏了
 * （回读端点换形状 / 种子里没这个对象 / 审批路由改了），那么**所有**用例都会读到"没变"，
 * 而我会把它读成"代码没写"——恰好是相反的结论。故先拿一个**确知有真写入路径**的型
 * （`对象数据变更`，`app.ts domainExecutor` 里第一批就有分支）跑同一套手法：
 * 它若也报"没变"，报的是**工具坏了**，不许报"代码没写"。
 */

interface ExecDone {
  status: string;
  executionResult: { ok?: boolean; targetRef?: string; error?: string };
}

/**
 * 审批用**多角色**身份：`adopt_mitigation` 的审批链是 planner → admin **两步**
 * （`battery.ts BATTERY_ACTION_TYPES`）。只带 admin 角色时第一步会 409 INVALID_STEP，
 * 草稿停在 PENDING_APPROVAL —— **执行器根本没被调用**，而它看起来"没报未实现"，
 * 于是会被误判成「已接线」。这正是本文件反复警告的那种病：**信号是真的，只是它不指向我要断言的东西**。
 */
const APPROVER = { "x-debug-user": "demo:admin:admin|planner" };

/**
 * 建草稿 → 提交 → **走完整条审批链** → 返回终态。
 * 两种回包形状都认（审批端点历史上回过 draft 包裹与裸包两形态）。
 */
async function submitAndApprove(t: TestApp, actionTypeKey: string, payload: Record<string, unknown>): Promise<ExecDone> {
  const created = await t.app.inject({
    method: "POST",
    url: "/a/v1/action-drafts",
    headers: APPROVER,
    payload: { actionTypeKey, payload, submit: true },
  });
  expect(created.statusCode, created.body).toBeLessThan(300);
  const draftId = (created.json() as { draftId: string }).draftId;

  let out: ExecDone = { status: "", executionResult: {} };
  // 多步链需要逐步批；上限 6 步足够覆盖本仓最长的链（2 步），超了说明链没在推进。
  for (let step = 0; step < 6; step++) {
    const approved = await t.app.inject({
      method: "POST",
      url: `/a/v1/action-drafts/${draftId}/approve`,
      headers: APPROVER,
      payload: {},
    });
    const b = approved.json() as {
      status?: string;
      draft?: { status: string; executionResult?: ExecDone["executionResult"] };
      executionResult?: ExecDone["executionResult"];
    };
    out = {
      status: b.draft?.status ?? b.status ?? "",
      executionResult: b.draft?.executionResult ?? b.executionResult ?? {},
    };
    if (out.status !== "PENDING_APPROVAL" && out.status !== "APPROVED") break;
  }
  return out;
}

/** 回仓储读一个对象的属性真值（**不复用审批响应里的回显**——回显证明不了落库）。 */
async function readProp(t: TestApp, type: string, objectId: string, prop: string): Promise<unknown> {
  const res = await t.app.inject({ method: "GET", url: `/a/v1/objects?type=${type}&pageSize=500`, headers: ADMIN });
  const items = (res.json() as { items: { id: string; props: Record<string, unknown> }[] }).items;
  const hit = items.find((o) => o.id === objectId);
  expect(hit, `回读不到对象 ${objectId}（类型 ${type}）—— 是回读手法坏了，不是写入没发生`).toBeTruthy();
  return hit!.props[prop];
}

async function firstEquipment(t: TestApp): Promise<{ id: string; oee: number }> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Equipment&pageSize=1", headers: ADMIN });
  const items = (res.json() as { items: { id: string; props: Record<string, unknown> }[] }).items;
  expect(items.length, "种子里应有 Equipment 对象（否则本测无从验证写回）").toBeGreaterThan(0);
  const e = items[0]!;
  return { id: e.id, oee: Number(e.props.oee_current) };
}

describe("plan_change（非 global-sim）· 按 payload 形态二分：带杠杆真写 / 无杠杆诚实失败", () => {
  it("金丝雀（先自证检查手法）：`对象数据变更` 走同一套「审批→回读核对」必须看得见真值变化", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const eq = await firstEquipment(t);
    const target = Math.min(0.99, Number((eq.oee + 0.05).toFixed(4)));
    expect(target, "构造值必须与现值不同，否则本金丝雀无法区分'写了'与'没写'").not.toBe(eq.oee);

    const done = await submitAndApprove(t, "对象数据变更", {
      objectId: eq.id,
      patch: { oee_current: target },
      reason: "金丝雀：验证「审批→回读核对」这套手法本身是通的",
    });
    expect(done.status, `金丝雀执行失败：${done.executionResult.error ?? ""}`).toBe("EXECUTED");
    const after = Number(await readProp(t, "Equipment", eq.id, "oee_current"));
    expect(
      after,
      "⛔ 金丝雀不中 ⇒ **本测的检查手法坏了**（回读端点/种子/审批路由变了），" +
        "下面任何用例报出的『真值没变』都不许读作『代码没写』——本次结论作废，先修手法。",
    ).toBeCloseTo(target, 6);
  }, 120000);

  it("★ 主判据：plan_change 带 levers → 审批后 Equipment.oee_current **在仓储里真的变了**", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const eq = await firstEquipment(t);
    const target = Math.min(0.99, Number((eq.oee + 0.08).toFixed(4)));
    expect(target).not.toBe(eq.oee);

    // 载荷逐字照抄生产者 `RiskBoardView.tsx adoptScenario()`：versionId + reason + baseId + levers(=LiveScenario.apply)。
    const done = await submitAndApprove(t, "plan_change", {
      versionId: `risk:changzhou:scn-1`,
      reason: "采纳风险处置方案：设备提效（基地 changzhou）",
      baseId: "changzhou",
      scenarioId: "scn-1",
      scenarioName: "设备提效",
      levers: [{ objectType: "Equipment", objectId: eq.id, prop: "oee_current", value: target }],
    });
    expect(done.status, `执行未成功：${done.executionResult.error ?? ""}`).toBe("EXECUTED");

    // ★ 效果层：这一条红 = 又回到「审批通过但什么都没写」。
    const after = Number(await readProp(t, "Equipment", eq.id, "oee_current"));
    expect(after, "审批通过但 Equipment.oee_current 未变 —— 空执行回潮（G-ACTION-NOOP-EXEC）").toBeCloseTo(target, 6);
    expect(after).not.toBeCloseTo(eq.oee, 6);

    // targetRef 自证写了什么，且**绝不能是 MO 形态**（假单号与真单号不可分辨正是病灶）。
    expect(done.executionResult.targetRef).toContain("PLAN-CHANGE-LEVER");
    expect(String(done.executionResult.targetRef)).not.toMatch(/^MO-\d{4}/);
  }, 120000);

  it("诚实边界①：sim_sandbox 结论（patch.simulated:true·无杠杆）→ 失败且点名「仿真不得回流真实」，真值零动", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const eq = await firstEquipment(t);

    // 载荷照抄 `SandboxView.tsx onAdopt()`。
    const done = await submitAndApprove(t, "plan_change", {
      versionId: "sim:sess-1@tick3",
      reason: "采纳推演沙盘结论（GLOBAL · 全局态 71.4）",
      patch: { source: "sim_sandbox", simulated: true, sessionId: "sess-1", tick: 3, globalKpi: 71.4, scope: "GLOBAL" },
    });
    expect(done.status).toBe("EXECUTION_FAILED");
    expect(done.executionResult.error).toContain("EXECUTOR_NOT_IMPLEMENTED");
    expect(done.executionResult.error, "错误必须说清『为什么』，否则欠账只活在源码注释里").toContain("simulated");
    expect(done.executionResult.error).toContain("仿真");
    // 且真值未被污染。
    expect(Number(await readProp(t, "Equipment", eq.id, "oee_current"))).toBeCloseTo(eq.oee, 6);
  }, 120000);

  it("诚实边界②：order-chain 结论（只有 verdict·无杠杆）→ 失败且点名「没有 levers 落点」", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 载荷照抄 `OrderChainView.tsx` 的「采纳结论 → 工单」按钮。
    const done = await submitAndApprove(t, "plan_change", {
      versionId: "order-chain:SO-00001",
      reason: "全链判定：可接",
      so: "SO-00001",
      verdict: "可接",
    });
    expect(done.status).toBe("EXECUTION_FAILED");
    expect(done.executionResult.error).toContain("EXECUTOR_NOT_IMPLEMENTED");
    expect(done.executionResult.error).toContain("levers");
    // 错误里必须把收到的键列出来——审批人据此判断"是生产者少发了字段"还是"这一型本来就没落点"。
    expect(done.executionResult.error).toContain("verdict");
  }, 120000);

  it("原子性：杠杆行缺 value → 拒绝臆造写入，且**一个字节都不写**", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const eq = await firstEquipment(t);

    const done = await submitAndApprove(t, "plan_change", {
      versionId: "risk:changzhou:scn-2",
      reason: "采纳风险处置方案（残缺载荷）",
      levers: [{ objectType: "Equipment", objectId: eq.id, prop: "oee_current" }],
    });
    expect(done.status).toBe("EXECUTION_FAILED");
    expect(done.executionResult.error).toContain("拒绝臆造写入");
    expect(Number(await readProp(t, "Equipment", eq.id, "oee_current"))).toBeCloseTo(eq.oee, 6);
  }, 120000);
});

/**
 * ── 兜底线普查（WO-ACTION-NOOP-EXEC · 机器先说话）──────────────────────────────
 *
 * 为什么要有这一条：`G-ACTION-NOOP-EXEC` 这张账被人手改过四轮，每轮都留下一句
 * 「现在还剩 N 型」，而**每一轮的那个 N 到下一轮都是错的**（本体 §116 与 §8 两处同源过期
 * 就是实证）。根因是那个数一直靠**读代码推算**，没有任何机器在数。
 *
 * 本条把「还剩几型落兜底线」变成**跑出来的**结果：把每个已注册 ActionType 用一份最小合法载荷
 * 真推过 `建草稿 → 提交 → 审批 → domainExecutor`，看它最终**落在哪条线上**。
 * 判别标记是 `EXECUTOR_NOT_IMPLEMENTED:` —— 它只由 `actions.ts notImplementedResult()` 产出，
 * 是兜底线的唯一出口；任何其它结局（EXECUTED、或"情景不存在"这类**领域**错误）都证明它进了真分支。
 *
 * ⚠️ 金丝雀内置：`对象数据变更` / `采纳产能保障方案` 是**确知已接**的型。它们若也被数进兜底线，
 *    那是本普查的手法坏了（载荷构造错 / 审批路由变了），**不许**读作「代码没接」。
 */
/**
 * ⚠️ 实测纠正（**别照着源码推算，这一条就是推算会错的活例**）：
 * `定稿月度计划版本` / `计划版本变更` 的草稿在 **POST /a/v1/action-drafts 建草稿期**
 * 就校验 S&OP 版本存在，喂假 id 直接 404 —— **根本走不到执行器**，普查会在这里断掉。
 * 我第一版按读代码推断「它们会落到执行器再失败」，实跑第一次就被打脸。故这两型必须喂**真版本 id**。
 */
function minimalPayloads(sopVersionId: string): Record<string, Record<string, unknown>> {
  return {
    adopt_mitigation: { base: "常州", factor: "cf-nonexistent-probe", planKey: "probe" },
    plan_change: { versionId: "census:probe", reason: "普查探针（无杠杆形态）" },
    AOP情景拍板: { scenarioKey: "__census_probe__", year: 2026 },
    校准参数变更: { proposalId: "__census_probe__", mode: "approve" },
    采纳经营方案: { schemeNo: "壹", scheme: {}, targets: {} },
    定稿月度计划版本: { versionId: sopVersionId, snapshot: {} },
    计划版本变更: { versionId: sopVersionId, reason: "普查探针" },
    采纳产能保障方案: { modelId: "4680-NCM", levers: [] },
    对象数据变更: { objectId: "__census_probe__", patch: {}, reason: "普查探针" },
    // WO-SIM-ACTION-REAL 新增型。载荷形状照 `ForecastAdoptionPayloadSchema` 逐字段填，**不自创**
    // ——普查若因我编错入参而失败，会被读成「执行器没接」，那正是本普查要避免的误判。
    采纳产能预测结论: {
      source: "project-sim",
      modelId: "4680-NCM",
      mode: "single",
      demandWan: 40,
      weeks: 6,
      snapshot: { capWanP50: 42, capWanP90: 38, gapWan: 2, healthFactor: 0.9, ok: false, mainBn: "__census_probe__" },
    },
    流水线发布物化: { workflowId: "__census_probe__", nodeId: "n1", rows: [] },
  };
}

/**
 * 造一个走到 `EXEC_MEETING` 的真 S&OP 版本（`定稿月度计划版本` 的前置）。
 * 步骤序列与实参照抄既有 `test/sop-actions.test.ts` 的真实用法——**不自创**，
 * 免得本普查因为自己编的入参失败，然后被读成「执行器没接」。
 */
async function makeSopVersionAtExecMeeting(t: TestApp): Promise<string> {
  const created = await t.app.inject({
    method: "POST",
    url: "/a/v1/sop/versions",
    headers: APPROVER,
    payload: { month: "2026-07", inputs: { demTotal: 120 } },
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = (created.json() as { id: string }).id;
  const advance = (step: number, payload: Record<string, unknown> = {}) =>
    t.app.inject({ method: "POST", url: `/a/v1/sop/versions/${id}/advance`, headers: APPROVER, payload: { step, payload } });
  await advance(1);
  await advance(2, {
    segments: [
      { key: "pas", name: "乘用车", target: 60, rolling: 61, lastActual: 58 },
      { key: "ess", name: "储能", target: 38, rolling: 37, lastActual: 36 },
      { key: "com", name: "商用车", target: 22, rolling: 21, lastActual: 20 },
    ],
  });
  await advance(3, {});
  await advance(4, { revSum: 100, gmSum: 14, gmBudget: 14, cashCushion: 56 });
  const s5 = await advance(5, { resolutions: [{ name: "常州夜班", delta: 1.2 }] });
  expect((s5.json() as { status?: string }).status, `S&OP 版本没走到 EXEC_MEETING：${s5.body}`).toBe("EXEC_MEETING");
  return id;
}

/** 已知**确已接**真执行器的型（金丝雀基准·改这里等于改基准，请连同论据一起改）。 */
const KNOWN_WIRED_CANARIES = ["对象数据变更", "采纳产能保障方案"];

/**
 * 实测 golden：**跑出来的**、当前真正落在兜底线上的探针。
 * 改这个数组前必须先跑本用例看新输出，**不许照着源码推算**（那正是本条要根治的病）。
 *
 * ⚠️ 这个数组的第一版我写的是 `["采纳经营方案"]` —— **推算的，实跑当场证伪**：
 *    机器数出来是 **2** 个。差的那个是 `plan_change`，因为它是**条件成员**：
 *    同一个 key 承载六条生产者，本普查喂的是「无杠杆」那一形态（`{versionId, reason}`），
 *    它确实落兜底线；而**带 levers 的那一形态真写真值**——由本文件「★ 主判据」用例
 *    回读 `Equipment.oee_current` 逐字段咬住。
 *    ⇒ **「落兜底线」是 (型 × 载荷形态) 的属性，不是型的属性。** 这正是 `G-PLAN-CHANGE-NO-LEVER`
 *      要表达的东西，也是本仓「N 型没接」这个说法每轮都错的根源：它把一个二维事实压成了一维。
 */
const EXPECTED_FALLBACK = ["plan_change", "采纳经营方案"];

describe("兜底线普查 · 「还剩几型审批通过后什么都不写」由机器数，不由人推算", () => {
  it("逐型真推过 domainExecutor，落兜底线者必须恰好等于登记在案的那一组", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const registered = BATTERY_ACTION_TYPES.map((a) => a.key);
    expect(registered.length, "BATTERY_ACTION_TYPES 读出 0 型 ⇒ **本普查坏了**，不许读作『没有动作类型』").toBeGreaterThan(0);

    // 先造一个**真** S&OP 版本并把它推到 EXEC_MEETING（见 minimalPayloads 头注）。
    // ⚠️ 又一次实测纠正：只建版本还不够 —— `定稿月度计划版本` 的草稿在建草稿期还要求版本
    //    **已走完五步状态机**，否则 409「cannot request finalize from DRAFT (run step ⑤ first)」，
    //    同样走不到执行器。步骤序列照抄既有 `test/sop-actions.test.ts` 的真实用法，不自创。
    const sopVersionId = await makeSopVersionAtExecMeeting(t);
    const payloads = minimalPayloads(sopVersionId);

    const fallback: string[] = [];
    const realBranch: { key: string; outcome: string }[] = [];
    for (const key of registered) {
      const payload = payloads[key];
      expect(payload, `新增了 ActionType「${key}」却没给普查载荷 —— 本普查会漏数它，请补 minimalPayloads()`).toBeTruthy();
      const done = await submitAndApprove(t, key, payload!);
      // ⚠️ 先证明「执行器真的被调用过」再分类。停在 PENDING_APPROVAL/DRAFT = **本次没测到执行器**，
      //    它既不是「已接线」也不是「没接线」——把它算进任何一桶都是拿一个不度量该事实的信号下结论。
      expect(
        done.status,
        `「${key}」没走到执行终态（停在 ${done.status || "空"}）⇒ **本普查这一型没测到执行器**，` +
          `结论作废：既不许算作已接线，也不许算作没接线。多半是审批链角色不够或载荷没过 paramsSchema。`,
      ).toMatch(/^(EXECUTED|EXECUTION_FAILED)$/);
      const err = String(done.executionResult.error ?? "");
      if (err.includes("EXECUTOR_NOT_IMPLEMENTED")) fallback.push(key);
      else realBranch.push({ key, outcome: done.status + (err ? `(${err.slice(0, 60)})` : "") });
    }

    // 普查结果原样打印——交单报告里的那个数字直接取这里，不再手抄。
    // eslint-disable-next-line no-console
    console.log(
      `\n[兜底线普查] 已注册 ${registered.length} 型｜落兜底线 ${fallback.length} 型：${fallback.join("、") || "（无）"}\n` +
        realBranch.map((r) => `   进真分支：${r.key} → ${r.outcome}`).join("\n"),
    );

    // 每一型都必须被数到（普查覆盖率自证：漏数一型就等于替它作了「已接线」的默认判断）。
    expect(fallback.length + realBranch.length, "普查覆盖数 ≠ 已注册数 ⇒ 有型被漏数").toBe(registered.length);

    // ★ 金丝雀先说话：确知已接的型若也被数进兜底线，是手法坏了，不是代码没接。
    for (const c of KNOWN_WIRED_CANARIES) {
      expect(
        fallback,
        `⛔ 金丝雀「${c}」被数进了兜底线 ⇒ **本普查的手法坏了**（载荷/审批路由/判别标记变了）。` +
          `本次普查结论作废：不许据此报「还剩 N 型没接」。`,
      ).not.toContain(c);
    }

    expect(
      [...fallback].sort(),
      "兜底线成员变了。多出来 = 有型退回空执行（回潮）；少了 = 有型接上了，" +
        "请同步改 EXPECTED_FALLBACK 与本体 §8 G-ACTION-NOOP-EXEC 的状态描述（**别只改代码不改账**）。",
    ).toEqual([...EXPECTED_FALLBACK].sort());
  }, 300000);
});

describe("采纳经营方案 · 域映射缺失 ⇒ 诚实失败（**不是**忘了接·勿改成 NO_WRITE 洗白）", () => {
  it("审批后诚实失败，且错误里带得出「为什么今天写不了」的四条论据", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 载荷照抄 `PlanGenerateView.tsx adoptScheme()`。
    const done = await submitAndApprove(t, "采纳经营方案", {
      schemeNo: "壹",
      pathKey: "P2",
      scheme: { name: "稳健", outcome: { rev: 512, gm: 0.171, share: 0.19, turns: 6.2, cash: 46, capex: 22 }, scores: {}, hardViol: [] },
      targets: { revGrowthPct: 18, gmFloor: 0.155, sharePts: 12, turnsFloor: 6, capexCap: 30, cashFloor: 40 },
    });
    expect(done.status).toBe("EXECUTION_FAILED");
    expect(done.executionResult.error).toContain("EXECUTOR_NOT_IMPLEMENTED");
    // 「没接」与「为什么没接」是两件事，处置也不同（排单去接 vs 先立域映射）。错误必须说得出后者。
    expect(done.executionResult.error).toContain("域映射缺失");
    expect(done.executionResult.error).toContain("PLAN_GOAL_TARGETS");
  }, 120000);

  it("硬约束（业务已裁定·勿改）：采纳动作**绝不覆盖**经营目标基线 —— 审批前后 plan_generate 输出逐字节相同", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 用真消费者取证：`plan_generate` 读的就是目标基线。目标若被动过，同参数两次调用不可能同输出。
    const before = await t.app.inject({ method: "POST", url: "/a/v1/solvers/plan_generate/invoke", headers: ADMIN, payload: { args: {} } });
    expect(before.statusCode, before.body).toBeLessThan(300);

    const done = await submitAndApprove(t, "采纳经营方案", {
      schemeNo: "叁",
      pathKey: "P5",
      scheme: { name: "进取", outcome: { rev: 610, gm: 0.142, share: 0.24, turns: 5.4, cash: 31, capex: 44 }, scores: {}, hardViol: ["C15"] },
      // 刻意送一组**与基线完全不同**的目标：若执行器哪天偷偷把 targets 写回基线，本例立刻变红。
      targets: { revGrowthPct: 99, gmFloor: 0.99, sharePts: 99, turnsFloor: 99, capexCap: 999, cashFloor: 999 },
    });
    expect(done.status).toBe("EXECUTION_FAILED");

    const after = await t.app.inject({ method: "POST", url: "/a/v1/solvers/plan_generate/invoke", headers: ADMIN, payload: { args: {} } });
    expect(
      JSON.stringify((after.json() as { data: unknown }).data),
      "采纳动作改动了经营目标基线 —— 违反业务硬裁定「目标不能改」（actions.ts ACTION_WIRING 采纳经营方案 条）",
    ).toBe(JSON.stringify((before.json() as { data: unknown }).data));
  }, 120000);
});
