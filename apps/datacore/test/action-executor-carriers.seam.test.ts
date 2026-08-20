import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import { ActionService } from "../src/actions.js";

/**
 * WO-ACTION-EXECUTOR-CARRIERS · 行动写回三连的**接缝**测试
 * （G-ACTION-NOOP-EXEC / G-ADOPT-SCHEME-NO-CARRIER / G-PLAN-CHANGE-NO-LEVER）
 *
 * ── 本单开工时的实测起点（**与派单描述不一致，以实测为准**）────────────────────────
 * 派单正文说「四个已注册型无分支 → 全落 MockActionExecutor」「`采纳经营方案` 仍 NOT_IMPLEMENTED」。
 * 实测（本分支 HEAD）**两句都已过期**：
 *   · `BATTERY_ACTION_TYPES` 现 **11 型**，`ACTION_WIRING` 里 **11 型全部 WIRED**，
 *     `NOT_IMPLEMENTED_RATIONALE` 是空表（= 今天没有任何一型停在「没接执行器」）；
 *   · `domainExecutor` 的末尾兜底早已是 `UnwiredActionExecutor`（前序 WO-ACTION-NOOP-EXEC 换的）。
 * 故本单的真实缺口**不是**「补执行器」，而是下面两条 —— 都属「假绿的又一形态：
 * 信号是真的，只是它不指向我要断言的那个对象」。
 *
 * ── 缺口①（活 bug·可复现）：**已接线的型穿过自己的分支，落到兜底线上冒充「没接线」** ────
 * `app.ts` 的 `计划版本变更` 分支此前写作
 *     `if (key === "计划版本变更" && typeof payload.versionId === "string") { const r = await sop.applyChangeAction(...); if (r) return ...; }`
 * 两道守卫**任一不满足就穿透**，落到 `unwiredExecutor` → `notImplementedResult()` →
 * 审批人看到的是「动作类型「计划版本变更」**尚未接入真实执行器**」。
 * 这句话**是假的**：执行器就在上面那一行（`sop.applyChangeAction`，真改 S&OP 版本 inputs）。
 * 而且它把处置指向了完全相反的方向 —— 审批人会去排一张「写执行器」的单，
 * 真正的缺口却是「生产者发的 `versionId` 指不到任何版本」。
 * 佐证：`sop.ts` `applyChangeAction` 的头注当时白纸黑字写着「非 S&OP 版本 → null，**回落 mock**」
 * —— 穿透是**当年设计的**，只是那时的兜底叫 mock（回假单号），后来兜底换了、这条穿透没跟着改。
 *
 * ⚠️ 这条为什么一直没被抓到：既有普查用例（`action-plan-change-levers.seam.test.ts`）给
 * `计划版本变更` 喂的是**真** S&OP 版本 id（`makeSopVersionAtExecMeeting()`），
 * 恰好走进真分支 —— **「这个型有测试」证明不了「生产走的那条分支有测试」**（CLAUDE.md 铁律 0.5 判据 6）。
 *
 * ── 缺口②（埋雷·当前不可达，但必须拆）：**假单号产地仍接在两条活线上** ──────────────
 * 派单 §5.4 是硬约束：「不许让 `MockActionExecutor` 继续当兜底」。实测它仍被 `new` 在两处 src 里：
 *   · `app.ts` `new GlobalSimPlanExecutor({...}, mockExecutor)` —— 作 fallback 传进去；
 *   · `actions.ts` `ActionService.executor` 的**字段默认值**。
 * 两处**今天都不可达**（前者靠 `planChangeIsWired()` 与 `GlobalSimPlanExecutor` 内部谓词恰好同义；
 * 后者靠 `buildApp()` 构造完立刻 `setExecutor(domainExecutor)` 覆盖）。据实说明：
 * **这是埋雷，不是活 bug** —— 但两个谓词「恰好同义」不是不变量，谁动一边雷就响，
 * 而响的形态正是最难发现的那种：审批链全绿 + targetRef 形态与真 MO 一模一样。
 * 既有的 `action-wiring:check` 断言③**扫不到这两处**（它只扫 `domainExecutor` 函数体内的
 * `return mockExecutor.execute(`）—— 典型的「门 RC=0 不度量被守的东西干净」（扫描面不含实物所在位置）。
 * 本单范围边界禁改门脚本，故把这道守卫落在本文件 §E。
 */

interface ExecDone {
  status: string;
  executionResult: { ok?: boolean; targetRef?: string; error?: string };
}

/** 审批身份带双角色：本仓最长的链是 planner → admin 两步（`battery.ts`）。 */
const APPROVER = { "x-debug-user": "demo:admin:admin|planner" };

/** 建草稿 → 提交 → 走完整条审批链 → 返回终态。两种回包形状都认。 */
async function submitAndApprove(
  t: TestApp,
  actionTypeKey: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = APPROVER,
  approveHeaders: Record<string, string> = headers,
): Promise<ExecDone> {
  const created = await t.app.inject({
    method: "POST",
    url: "/a/v1/action-drafts",
    headers,
    payload: { actionTypeKey, payload, submit: true },
  });
  expect(created.statusCode, created.body).toBeLessThan(300);
  const draftId = (created.json() as { draftId: string }).draftId;

  let out: ExecDone = { status: "", executionResult: {} };
  for (let step = 0; step < 6; step++) {
    const approved = await t.app.inject({
      method: "POST",
      url: `/a/v1/action-drafts/${draftId}/approve`,
      headers: approveHeaders,
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

/** 回仓储读对象属性真值（**不复用审批响应的回显** —— 回显证明不了落库）。 */
async function readProp(t: TestApp, type: string, objectId: string, prop: string): Promise<unknown> {
  const res = await t.app.inject({ method: "GET", url: `/a/v1/objects?type=${type}&pageSize=500`, headers: ADMIN });
  const items = (res.json() as { items: { id: string; props: Record<string, unknown> }[] }).items;
  const hit = items.find((o) => o.id === objectId);
  expect(hit, `回读不到对象 ${objectId}（${type}）—— 是回读手法坏了，不是写入没发生`).toBeTruthy();
  return hit!.props[prop];
}

async function firstEquipment(t: TestApp): Promise<{ id: string; oee: number }> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Equipment&pageSize=1", headers: ADMIN });
  const items = (res.json() as { items: { id: string; props: Record<string, unknown> }[] }).items;
  expect(items.length, "种子里应有 Equipment 对象（否则本测无从验证写回）").toBeGreaterThan(0);
  const e = items[0]!;
  return { id: e.id, oee: Number(e.props.oee_current) };
}

/** 假单号形态：`MockActionExecutor` 产出的 `MO-2026-1234`（4 位年 + 4 位哈希派生序号）。 */
const FAKE_MO = /^MO-\d{4}-\d{4}$/;

// ---------------------------------------------------------------------------
// A · T1 有落点的型 → 真写（效果层逐字段断言，不看运输层）
// ---------------------------------------------------------------------------
describe("A · 有落点的型：审批后目标属性在仓储里真的变了（T1）", () => {
  it("金丝雀先说话 + 主判据：`对象数据变更`（确知已接）与 `采纳产能保障方案` 走同一套「审批→回读核对」都必须看得见真值变化", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const eq = await firstEquipment(t);

    // —— 金丝雀：确知有真写入路径的型。它若也报"没变"，报的是**手法坏了**，不许报"代码没写"。——
    const canaryTarget = Math.min(0.99, Number((eq.oee + 0.03).toFixed(4)));
    expect(canaryTarget, "构造值必须与现值不同，否则金丝雀分不出'写了'与'没写'").not.toBe(eq.oee);
    const canary = await submitAndApprove(t, "对象数据变更", {
      objectId: eq.id,
      patch: { oee_current: canaryTarget },
      reason: "金丝雀：自证「审批→回读核对」这套手法本身是通的",
    });
    expect(canary.status, `金丝雀执行失败：${canary.executionResult.error ?? ""}`).toBe("EXECUTED");
    expect(
      Number(await readProp(t, "Equipment", eq.id, "oee_current")),
      "⛔ 金丝雀不中 ⇒ **本测的检查手法坏了**（回读端点/种子/审批路由变了）。本次结论作废，先修手法。",
    ).toBeCloseTo(canaryTarget, 6);

    // —— 主判据：`采纳产能保障方案`（杠杆 → 本体属性真值）。——
    const target = Math.min(0.99, Number((canaryTarget + 0.04).toFixed(4)));
    const done = await submitAndApprove(t, "采纳产能保障方案", {
      modelId: "4680-NCM",
      levers: [{ objectType: "Equipment", objectId: eq.id, prop: "oee_current", value: target }],
    });
    expect(done.status, `执行未成功：${done.executionResult.error ?? ""}`).toBe("EXECUTED");
    expect(
      Number(await readProp(t, "Equipment", eq.id, "oee_current")),
      "审批通过但 Equipment.oee_current 未变 —— 空执行回潮（G-ACTION-NOOP-EXEC）",
    ).toBeCloseTo(target, 6);

    // T4：单号必须自证写了什么，且**绝不是**哈希派生的假 MO 号。
    expect(String(done.executionResult.targetRef)).toContain("CAP-ADOPT");
    expect(
      String(done.executionResult.targetRef),
      "targetRef 退回 MO-2026-xxxx 形态 ⇒ 假单号产地复活（G-ACTION-NOOP-EXEC）",
    ).not.toMatch(FAKE_MO);
    // 单号里点名的那处写入必须**对应一条真记录**（不是编出来的字符串）。
    expect(String(done.executionResult.targetRef)).toContain(eq.id);
  }, 180000);
});

// ---------------------------------------------------------------------------
// B · T2/T3 三种「不工作」必须在错误信息里可分辨（§5.3）
//    ① 生产者少发/发错字段 ⇒ 改前端  ② 引用的承载对象不存在 ⇒ 查数据  ③ 本型没有落点 ⇒ 改本体
//    混成一句 `EXECUTOR_NOT_IMPLEMENTED` 就是把问题藏了。
// ---------------------------------------------------------------------------
describe("B · 三种「不工作」可分辨：少发字段 / 引用对象不存在 / 本型没落点（T2·T3）", () => {
  it("★ 主判据：`计划版本变更` 引用一个不存在的 S&OP 版本 → **不得**报「尚未接入真实执行器」（它已接线），必须点名版本解不出", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 载荷形状照抄生产者 `SopBalanceView.tsx` 的「发起变更」按钮，只把 versionId 换成不存在的。
    const done = await submitAndApprove(t, "计划版本变更", {
      versionId: "sopv_does_not_exist_probe",
      reason: "定稿后字段变更（C22 锁定 → 走变更 Action）",
      patch: {},
    });
    expect(done.status).toBe("EXECUTION_FAILED");
    const err = String(done.executionResult.error ?? "");

    // ★ 这一条红 = 已接线的型又在冒充「没接线」，把审批人指向相反的处置。
    expect(
      err,
      "⛔ `计划版本变更` 已接线（sop.applyChangeAction 真改版本 inputs），却报「尚未接入真实执行器」——" +
        "这句话是假的，且会让审批人去排一张『写执行器』的单，而真缺口是引用的版本不存在。",
    ).not.toContain("EXECUTOR_NOT_IMPLEMENTED");
    // 必须点名到底哪一步断了：版本 id 原样回显 + 定性为「引用的承载对象不存在」。
    expect(err).toContain("sopv_does_not_exist_probe");
    expect(err, "错误必须说清这是**数据问题**（引用不到版本），不是**接线问题**").toContain("解不出");
  }, 180000);

  it("对照组（同一型走通）：`计划版本变更` 指向真版本 → EXECUTED，且 S&OP 版本 inputs 真被 patch 改了", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const versionId = await makeSopVersion(t);

    const done = await submitAndApprove(t, "计划版本变更", {
      versionId,
      reason: "对照组：同一型、真版本 id",
      patch: { demTotal: 137 },
    });
    expect(done.status, `对照组执行失败：${done.executionResult.error ?? ""}`).toBe("EXECUTED");
    expect(done.executionResult.targetRef).toBe(versionId);
    expect(String(done.executionResult.targetRef)).not.toMatch(FAKE_MO);
    // 效果层：真值真的变了（否则「对照组走通」只是运输层绿）。
    const v = await t.repos.sopVersions.get("demo", versionId);
    expect(Number(v?.inputs.demTotal), "审批通过但 S&OP 版本 inputs 未变 —— 空执行").toBe(137);
  }, 180000);

  it("三条文案互不相同：少发字段 ≠ 引用不存在 ≠ 本型没落点（否则审批人分不出该改前端还是改本体）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const eq = await firstEquipment(t);

    // ③ 本型没落点：plan_change 只带结论/KPI 快照（`OrderChainView.tsx` 的「采纳结论」）。
    const noCarrier = await submitAndApprove(t, "plan_change", {
      versionId: "order-chain:SO-00001",
      reason: "全链判定：可接",
      so: "SO-00001",
      verdict: "可接",
    });
    expect(noCarrier.status).toBe("EXECUTION_FAILED");
    const errNoCarrier = String(noCarrier.executionResult.error ?? "");
    expect(errNoCarrier).toContain("EXECUTOR_NOT_IMPLEMENTED");
    expect(errNoCarrier).toContain("levers");
    // 必须列出实际收到的键——审批人据此分辨「生产者少发了」还是「本来就没有落点」。
    expect(errNoCarrier).toContain("verdict");

    // ② 引用的承载对象不存在：带杠杆但 objectId 指不到任何对象。
    const badRef = await submitAndApprove(t, "采纳产能保障方案", {
      modelId: "4680-NCM",
      levers: [{ objectType: "Equipment", objectId: "obj_equipment_does_not_exist", prop: "oee_current", value: 0.5 }],
    });
    expect(badRef.status).toBe("EXECUTION_FAILED");
    const errBadRef = String(badRef.executionResult.error ?? "");
    expect(errBadRef).toContain("obj_equipment_does_not_exist");
    expect(errBadRef, "「引用不到对象」不是「没接执行器」，两者处置方向相反").not.toContain("EXECUTOR_NOT_IMPLEMENTED");

    // ① 生产者少发字段：杠杆行缺 value。
    const missingField = await submitAndApprove(t, "采纳产能保障方案", {
      modelId: "4680-NCM",
      levers: [{ objectType: "Equipment", objectId: eq.id, prop: "oee_current" }],
    });
    expect(missingField.status).toBe("EXECUTION_FAILED");
    const errMissing = String(missingField.executionResult.error ?? "");
    expect(errMissing).toContain("拒绝臆造写入");
    expect(errMissing).not.toContain("EXECUTOR_NOT_IMPLEMENTED");

    // ★ 三条文案必须两两不同（都退化成同一句 = 把三个不同的病压成一个）。
    const msgs = [errNoCarrier, errBadRef, errMissing];
    expect(new Set(msgs).size, "三种「不工作」的错误文案出现重复 —— 审批人无法据此判断该改哪一半").toBe(3);

    // 且这一整轮里真值一个字节都没动。
    expect(Number(await readProp(t, "Equipment", eq.id, "oee_current"))).toBeCloseTo(eq.oee, 6);
  }, 180000);
});

// ---------------------------------------------------------------------------
// C · T5 跨租户：A 租户的审批不得写到 B 租户的对象上
// ---------------------------------------------------------------------------
describe("C · 跨租户隔离：另一租户的审批写不到 demo 的对象上（T5）", () => {
  it("租户 t2 用 demo 的 objectId 发杠杆 → 诚实失败，且 demo 的属性逐字节未动", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const eq = await firstEquipment(t);

    // t2 未注册 ActionType（种子只落 demo）→ 审批链回落单步 admin；发起人/审批人取不同 userId 以免自批被拦。
    const done = await submitAndApprove(
      t,
      "采纳产能保障方案",
      { modelId: "4680-NCM", levers: [{ objectType: "Equipment", objectId: eq.id, prop: "oee_current", value: 0.123 }] },
      { "x-debug-user": "t2:u_creator:admin" },
      { "x-debug-user": "t2:u_approver:admin" },
    );
    expect(done.status, `期望跨租户写入被拒，实际 ${done.status}`).toBe("EXECUTION_FAILED");
    expect(String(done.executionResult.error ?? "")).toContain("对象不存在");

    expect(
      Number(await readProp(t, "Equipment", eq.id, "oee_current")),
      "⛔ 跨租户写穿：t2 的审批改动了 demo 的对象真值",
    ).toBeCloseTo(eq.oee, 6);
  }, 180000);
});

// ---------------------------------------------------------------------------
// D · ActionService 的**字段默认执行器**（`buildApp` 之外的构造路径）
// ---------------------------------------------------------------------------
describe("D · ActionService 未 setExecutor 时的默认执行器不得是假单号产地（§5.4）", () => {
  it("直接 new ActionService（不 setExecutor）执行一条 APPROVED 草稿 → 必须诚实失败，绝不回 MO-2026-xxxx", async () => {
    const t = await makeApp();

    // 先经真路由建一条草稿（不自己拼 ActionDraft 形状——拼错了会把本例的红读成"接线坏了"）。
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: APPROVER,
      payload: { actionTypeKey: "plan_change", payload: { versionId: "probe", reason: "默认执行器探针" }, submit: false },
    });
    expect(created.statusCode, created.body).toBeLessThan(300);
    const draftId = (created.json() as { draftId: string }).draftId;
    const draft = await t.repos.actionDrafts.get("demo", draftId);
    expect(draft, "建草稿后回读不到 —— 手法坏了，不是默认执行器的问题").toBeTruthy();
    await t.repos.actionDrafts.put({ ...draft!, status: "APPROVED" });

    // 关键：**不调用 setExecutor**，跑的就是 `ActionService.executor` 的字段默认值。
    const bare = new ActionService(
      t.repos,
      {} as never,
      { emit: async () => {} } as never,
      undefined,
      undefined,
    );
    const out = await bare.execute("demo", draftId);
    const ref = String(out.executionResult?.targetRef ?? "");
    expect(
      ref,
      "⛔ ActionService 的默认执行器仍是假单号产地：任何漏掉 setExecutor 的构造路径都会把" +
        "「一个字节没写」记成一张形态与真 MO 一模一样的工单号，沉淀进审批记录与审计时间线。",
    ).not.toMatch(FAKE_MO);
    expect(out.status, "默认执行器必须是**显式失败**，不是「回个看起来成功的假单号」").toBe("EXECUTION_FAILED");
  }, 120000);
});

// ---------------------------------------------------------------------------
// E · 假单号产地普查（结构性）——为什么不是行为断言，写在下面
// ---------------------------------------------------------------------------
describe("E · 假单号产地普查：`MockActionExecutor` 不得出现在任何 src 接线上（§5.4）", () => {
  /**
   * 为什么这一条是**结构性**断言而不是行为断言：`app.ts` 里
   * `new GlobalSimPlanExecutor({...}, fallback)` 的 fallback 分支，其进入条件是
   * `actionTypeKey !== "plan_change" || payload.source !== "global-sim"`，
   * 而 `domainExecutor` 只在 `planChangeIsWired(payload)`（= 同一个谓词）为真时才把 draft 交给它
   * ⇒ **今天从任何 HTTP 入口都构造不出能进那条 fallback 的输入**。
   * 也就是说：它是「接了线、但当前不可达」的埋雷，行为层**驱动不出来**（能驱动出来的话它就是活 bug 了）。
   * 对这种形态，唯一诚实的守法是守住**接线本身**。
   *
   * ⚠️ 既有门 `scripts/check-action-wiring.mjs` 断言③ 扫的是 `domainExecutor` **函数体内**的
   * `return mockExecutor.execute(` —— 这两处（构造实参 / 字段默认值）都不在它的扫描面里。
   * 「门 RC=0」不度量「被守的东西干净」，本条补的正是那块扫不到的地方。
   */
  const SRC = ["../src/app.ts", "../src/actions.ts"] as const;
  const readSrc = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

  it("金丝雀先自证扫描器没瞎，再报否定结论", () => {
    // 金丝雀：拿一个**确知存在**的样例跑同一份实现。不中 ⇒ 报「扫描器坏了」，不许报「代码干净」。
    const actionsSrc = readSrc("../src/actions.ts");
    expect(
      /export class MockActionExecutor/.test(actionsSrc),
      "⛔ 金丝雀不中：连 `MockActionExecutor` 的类声明都没扫到 ⇒ **扫描器/路径坏了**，" +
        "本 describe 的任何「未发现」结论一律作废，不许读作「代码干净」。",
    ).toBe(true);

    // 反向金丝雀：确知存在的**接线**样例（兜底诚实执行器）必须被同一份实现扫到。
    expect(
      /new UnwiredActionExecutor\(\)/.test(readSrc("../src/app.ts")),
      "⛔ 反向金丝雀不中：`new UnwiredActionExecutor()` 没扫到 ⇒ 扫描面选错了文件。",
    ).toBe(true);
  });

  it("主判据：两份 src 里 `new MockActionExecutor()` 出现 0 次", () => {
    const hits: string[] = [];
    for (const rel of SRC) {
      readSrc(rel)
        .split("\n")
        .forEach((line, i) => {
          if (/new MockActionExecutor\s*\(/.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(
      hits,
      "⛔ 假单号产地又被接回 src 接线：`MockActionExecutor` 回的是 `MO-2026-${hash}` —— " +
        "形态与真工单号一模一样，于是「审批通过但一个字节没写」在界面与审计里**无法分辨**，" +
        "会被当成事实沉淀进决策（G-ACTION-NOOP-EXEC）。兜底必须是显式失败（UnwiredActionExecutor），" +
        "不是「回个看起来成功的假单号」。\n命中：\n" + hits.join("\n"),
    ).toEqual([]);

    // 该类本身**刻意保留**（测试用它作反面基准，见 `action-noop-exec.seam.test.ts`），只是不许再接进 src 接线。
    expect(/export class MockActionExecutor/.test(readSrc("../src/actions.ts"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 造一个 S&OP 版本（`计划版本变更` 只要求版本存在，不要求走完状态机 —— 与 `定稿月度计划版本` 不同）。
// ---------------------------------------------------------------------------
async function makeSopVersion(t: TestApp): Promise<string> {
  const created = await t.app.inject({
    method: "POST",
    url: "/a/v1/sop/versions",
    headers: APPROVER,
    payload: { month: "2026-07", inputs: { demTotal: 120 } },
  });
  expect(created.statusCode, created.body).toBe(201);
  return (created.json() as { id: string }).id;
}
