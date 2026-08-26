import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppProviders } from "@/App";
import { AnswerCard } from "@/components/Answer/AnswerCard";
import { ANSWER_KIT, KIT_TABLE_COLUMNS, KIT_TABLE_ROWS } from "@/mocks/kitFixtures";
import { scriptForQuery } from "@/mocks/sseScripts";
import {
  buildKitOrderVMs,
  isKitReadinessTable,
  LEG_LABEL,
  legDaysText,
  OWNER_LABEL,
  scanJsonObjects,
} from "@/components/Answer/kitProcurement";
import {
  PROCUREMENT_LEGS,
  PROCUREMENT_OWNERS,
  procurementTotalDays,
  type Answer,
  type ProcurementLeg,
} from "@platform/contracts";
import { db, type MockTask } from "@/mocks/db";

/**
 * WO-S08-KIT-PROCUREMENT-FE 的门。
 *
 * 咬的是**链路**不是函数：从 `AnswerCard` + 一个与真后端同形状的答案载荷出发真渲染
 * （载荷经 `mocks/kitFixtures.ts` 用 agentcore 的两条投影规则现算，不手抄表格），
 * 断言四段真的出现在屏上、且三态**功能性**可分。
 */

function renderAnswer(taskId: string, answer: Answer) {
  db.tasks.set(taskId, {
    id: taskId,
    query: "下周哪些订单缺料开不了工？",
    context: {},
    plan: { segments: [], path: "WORKFLOW", finalAnswer: answer },
    status: "COMPLETED",
    clarificationRounds: 0,
    createdAt: "",
  } as MockTask);
  return render(
    <AppProviders>
      <MemoryRouter>
        <AnswerCard answer={answer} taskId={taskId} />
      </MemoryRouter>
    </AppProviders>,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ① 链路：S08 问句 → 脚本 → 答案 → 四段真的渲染出来
// ═══════════════════════════════════════════════════════════════════════════

describe("S08 齐套答案 · 采购四段接线", () => {
  it("① S08 预置问句走到齐套脚本（不再落探索兜底）", () => {
    const plan = scriptForQuery("t", "下周哪些订单缺料开不了工？", { selectedObjects: [] } as never);
    expect(plan.intentKey).toBe("kit_analysis");
    expect(plan.path).toBe("WORKFLOW");
    expect(plan.finalAnswer).toBe(ANSWER_KIT);
  });

  it("② 四段逐段渲染：段名 + 天数 + 责任方，四段一段不少", () => {
    renderAnswer("task-kit-1", ANSWER_KIT);
    const panel = screen.getByTestId("kit-procurement");
    // 「四段一段不少」这句话的机器判据：契约真有四段，下面才是在逐段验。
    // 契约哪天加/减一段，这里先红 —— 逼着回来把新段的渲染断言补上，而不是循环少跑一圈静悄悄。
    expect(PROCUREMENT_LEGS).toHaveLength(4);
    for (const leg of PROCUREMENT_LEGS) {
      const row = within(panel).getByTestId(`kit-leg-SO-3391-elyte-${leg}`);
      expect(row).toBeInTheDocument();
      expect(row.textContent).toContain(LEG_LABEL[leg]);
    }
    // 真值逐段（取自真跑：12 / 18 / 3 / 3.25 天）
    expect(within(panel).getByTestId("kit-legdays-SO-3391-elyte-supplier_production").textContent).toBe("12.00 天");
    expect(within(panel).getByTestId("kit-legdays-SO-3391-elyte-in_transit").textContent).toBe("18.00 天");
    expect(within(panel).getByTestId("kit-legdays-SO-3391-elyte-customs").textContent).toBe("3.00 天");
    expect(within(panel).getByTestId("kit-legdays-SO-3391-elyte-incoming_inspection").textContent).toBe("3.25 天");
  });

  it("③ 关键段横幅答「该找谁」：具体责任方 + 段名 + 天数 + 对外/对内", () => {
    renderAnswer("task-kit-2", ANSWER_KIT);
    const banner = screen.getByTestId("kit-critical-SO-3391-elyte");
    // 关键段 = 实测段里天数最大的（in_transit 18 天）——走契约 criticalProcurementLeg，前端不另判
    expect(banner.textContent).toContain("远洋班轮-海运");
    expect(banner.textContent).toContain(LEG_LABEL.in_transit);
    expect(banner.textContent).toContain("18.00 天");
    expect(banner).toHaveAttribute("data-owner", "CARRIER");
    expect(banner.textContent).toContain("对外");
  });

  it("④ 该找谁总榜按累计天数降序，且区分对内/对外", () => {
    renderAnswer("task-kit-3", ANSWER_KIT);
    const list = screen.getByTestId("kit-who-to-call");
    const items = within(list).getAllByRole("listitem");
    // 承运方 18 天 > 供应商（诺德 5 + 星宇 9 = 14 天）
    expect(items[0]!.textContent).toContain("远洋班轮-海运");
    expect(items[0]!).toHaveAttribute("data-internal", "0");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // ⑤⑥⑦ 诚实位：三态 **功能性** 可分（这几条是本单的红线）
  // ═════════════════════════════════════════════════════════════════════════

  it("⑤ NOT_APPLICABLE ≠ EMPTY：前者计 0 不阻断合计，后者令合计不可结算", () => {
    renderAnswer("task-kit-4", ANSWER_KIT);
    // cu_foil 的清关段 = NOT_APPLICABLE（境内直供），合计仍可结算 = 8 天
    const naLeg = screen.getByTestId("kit-leg-SO-3391-cu_foil-customs");
    expect(naLeg).toHaveAttribute("data-status", "NOT_APPLICABLE");
    const naTotal = screen.getByTestId("kit-total-SO-3391-cu_foil");
    expect(naTotal).toHaveAttribute("data-complete", "1");
    expect(naTotal.textContent).toContain("8.00 天");

    // sep_film 有两段 EMPTY ⇒ 合计不可结算，并列出被哪几段挡住
    const emptyTotal = screen.getByTestId("kit-total-SO-3402-sep_film");
    expect(emptyTotal).toHaveAttribute("data-complete", "0");
    expect(emptyTotal.textContent).toContain("不可结算");
    expect(emptyTotal.textContent).toContain(LEG_LABEL.in_transit);
    expect(emptyTotal.textContent).toContain(LEG_LABEL.incoming_inspection);
    // 不可结算的合计里**不许出现任何数字**（拿已知三段之和冒充总数正是要堵的）
    expect(emptyTotal.textContent!.replace(/[^0-9]/g, "")).toBe("");
  });

  it("⑥ EMPTY 段天数格恒「—」：渲染层最后一道「不拿 0 冒充」闸", () => {
    renderAnswer("task-kit-5", ANSWER_KIT);
    for (const leg of ["in_transit", "incoming_inspection"] as const) {
      const cell = screen.getByTestId(`kit-legdays-SO-3402-sep_film-${leg}`);
      expect(cell.textContent).toBe("—");
      // 断言"格子里没有任何数字"——比断言等于某个字符串更难被一个 0 蒙混过去
      expect(cell.textContent!.replace(/[^0-9]/g, "")).toBe("");
    }
    // NOT_APPLICABLE 相反：它是**真值 0**，必须显出来（画成和 EMPTY 一样就没这条差别）
    expect(screen.getByTestId("kit-legdays-SO-3402-sep_film-customs").textContent).toBe("0.00 天");
  });

  it("⑦ EMPTY 责任方不摊到任何人头上（契约 unknownOwners 直达屏上）", () => {
    renderAnswer("task-kit-6", ANSWER_KIT);
    const unknown = screen.getByTestId("kit-unknown-owners-SO-3402-sep_film");
    expect(unknown.textContent).toContain(OWNER_LABEL.CARRIER);
    expect(unknown.textContent).toContain(OWNER_LABEL.QUALITY_IQC);
    // 已知的两个仍照常分摊
    expect(screen.getByTestId("kit-owner-SO-3402-sep_film-SUPPLIER").textContent).toContain("9.00 天");
  });

  it("⑧ 整单最早齐套日 EMPTY → 说「算不出来」+ 原因，不填 0 也不留空", () => {
    renderAnswer("task-kit-7", ANSWER_KIT);
    const cell = screen.getByTestId("kit-earliest-SO-3402");
    expect(cell).toHaveAttribute("data-status", "EMPTY");
    expect(cell.textContent).toContain("算不出来");
    // 原因栏必须在场且以「缺：」起头（具体内容分两种情形，见 ⑱ 与 ⑲）
    const reason = screen.getByTestId("kit-earliest-reason-SO-3402");
    expect(reason.textContent!.startsWith("缺：")).toBe(true);
    // 可结算的那单相反：显真值
    expect(screen.getByTestId("kit-earliest-SO-3391")).toHaveAttribute("data-status", "MEASURED");
    expect(screen.getByTestId("kit-earliest-SO-3391").textContent).toContain("11.67");
  });

  it("⑨ 缺席分支：引擎没给 procurement 的缺料项单列，不画四段空壳", () => {
    renderAnswer("task-kit-8", ANSWER_KIT);
    const note = screen.getByTestId("kit-no-procurement-SO-3402");
    expect(note.textContent).toContain("binder");
    expect(note.textContent).toContain("未下发");
    // 屏上文案不许出现 markdown 强调符（会原样显示成星号）
    expect(note.textContent).not.toContain("**");
    // 没给四段 ⇒ 压根没有 binder 的段行
    expect(screen.queryByTestId("kit-item-SO-3402-binder")).toBeNull();
  });

  it("⑩ MOQ / 准时率：取不到显「取不到」，绝不写 0；MOQ 抬高采购量要说出来", () => {
    renderAnswer("task-kit-9", ANSWER_KIT);
    const moqReal = screen.getByTestId("kit-moq-SO-3391-elyte");
    expect(moqReal.textContent).toContain("2500");
    expect(moqReal.textContent).toContain("起订量抬高了采购量");
    const moqEmpty = screen.getByTestId("kit-moq-SO-3402-sep_film");
    expect(moqEmpty.textContent).toContain("取不到");
    expect(moqEmpty.textContent).not.toContain("起订量抬高了采购量");
  });

  it("⑪ 表格里那一列从转义 JSON 换成可读摘要（原表不再是一坨 JSON）", () => {
    renderAnswer("task-kit-10", ANSWER_KIT);
    const table = screen.getByTestId("answer-table");
    expect(table.textContent).toContain("缺 2 项：elyte、cu_foil");
    // 兜底判据：单元格里不再有 JSON 结构符
    expect(table.textContent).not.toContain("\"leg\"");
    expect(table.textContent).not.toContain("supplier_production");
  });

  it("⑫ 认不出来的表 → 原样渲染普通表格（不硬渲染空壳、不丢信息）", () => {
    const other: Answer = {
      trustLevel: "VERIFIED_WORKFLOW",
      unverifiedNumerics: false,
      blocks: [{ type: "table", columns: ["SO", "客户"], rows: [["SO-1", "蔚途汽车"]], provId: "p1" }],
      provenance: [{ id: "p1", source: "TOOL_RESULT", toolCallId: "tc", toolName: "query_objects", outputPath: "$" }],
    };
    renderAnswer("task-kit-11", other);
    expect(screen.getByTestId("answer-table").textContent).toContain("蔚途汽车");
    expect(screen.queryByTestId("kit-procurement")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 模型层：口径同源与解析鲁棒性
// ═══════════════════════════════════════════════════════════════════════════

describe("S08 采购四段 · 口径同源", () => {
  it("⑬ 中文标签的键集由契约定死（契约加一段/一个责任方 → 这里必红）", () => {
    expect(Object.keys(LEG_LABEL).sort()).toEqual([...PROCUREMENT_LEGS].sort());
    expect(Object.keys(OWNER_LABEL).sort()).toEqual([...PROCUREMENT_OWNERS].sort());
  });

  it("⑭ 屏上的合计 == 契约 procurementTotalDays（前端不另写一份加法）", () => {
    const orders = buildKitOrderVMs(KIT_TABLE_COLUMNS, KIT_TABLE_ROWS);
    expect(orders).not.toBeNull();
    // 两层循环各自的基数下限：任一层塌成空集，下面的逐项对拍就一次都不执行而照样绿。
    expect(orders!.length).toBe(KIT_TABLE_ROWS.length); // fixture 两行 ⇒ 两张单，解析漏一张即红
    for (const o of orders!) {
      expect(o.items.length).toBeGreaterThan(0); // 实测 [2,1]：每张单都真有缺料项
      for (const it of o.items) {
        const legs = it.legs.map(
          (l) =>
            ({
              leg: l.leg,
              owner: l.owner,
              ownerRef: l.ownerRef,
              days: l.status === "EMPTY" ? null : l.days,
              status: l.status,
              ...(l.reason === null ? {} : { reason: l.reason }),
              source: l.source,
            }) as ProcurementLeg,
        );
        expect(it.totalDays).toBe(procurementTotalDays(legs));
      }
    }
  });

  it("⑮ 引擎自报的汇总与契约重算一致时不报 MISMATCH（真载荷上对得上）", () => {
    const orders = buildKitOrderVMs(KIT_TABLE_COLUMNS, KIT_TABLE_ROWS)!;
    // 同上：三个 AGREE 若一次都没被执行，本条用例证明不了任何"对得上"。
    expect(orders.length).toBe(KIT_TABLE_ROWS.length);
    for (const o of orders) {
      expect(o.items.length).toBeGreaterThan(0);
      for (const it of o.items) {
        expect(it.criticalAgreement).toBe("AGREE");
        expect(it.ownerAgreement).toBe("AGREE");
        expect(it.totalAgreement).toBe("AGREE");
      }
    }
  });

  it("⑯ JSON 拆包不按「；」split：reason 里带分隔符也拆得对", () => {
    const a = { material: "x", ratio: 0.1, shortage: 1, note: "前段；后段" };
    const b = { material: "y", ratio: 0.2, shortage: 2 };
    const cell = `${JSON.stringify(a)}；${JSON.stringify(b)}`;
    const scanned = scanJsonObjects(cell);
    expect(scanned).toHaveLength(2);
    expect((scanned[0] as { note: string }).note).toBe("前段；后段");
  });

  it("⑰ 列名签名判据：缺一列就不认（不去猜标题/意图键）", () => {
    expect(isKitReadinessTable(["orderId", "kitRatio", "shortItems", "advice"])).toBe(true);
    expect(isKitReadinessTable(["orderId", "kitRatio", "advice"])).toBe(false);
  });

  it("⑱ 首行可结算时 earliestKitDayReason 整列缺席 —— 不编原因，明说后端没下发", () => {
    // 这是真链路的实测行为：summarizeSolverOutput 的列名取自 rows[0]
    expect(KIT_TABLE_COLUMNS).not.toContain("earliestKitDayReason");
    const orders = buildKitOrderVMs(KIT_TABLE_COLUMNS, KIT_TABLE_ROWS)!;
    const emptyOrder = orders.find((o) => o.earliestKitDayStatus === "EMPTY")!;
    expect(emptyOrder.earliestKitDayReason).toBeNull();
    renderAnswer("task-kit-12", ANSWER_KIT);
    expect(screen.getByTestId("kit-earliest-reason-SO-3402").textContent).toContain("后端未随表下发原因");
  });

  it("⑳ 即使上游递来一个（契约非法的）EMPTY+天数，渲染层也拒绝把它印成数字", () => {
    // 变异反证时发现：`days === null` 这一层守卫已经挡住了契约合法的 EMPTY，
    // 于是 `known: false` 这一层看起来"删了也不红"。这条把第二层守卫单独钉住 ——
    // 它防的是"上游哪天回归成 EMPTY 还带个 0"（正是本仓要堵的假默认值形态）。
    expect(legDaysText("EMPTY", 0)).toBe("—");
    expect(legDaysText("EMPTY", 7)).toBe("—");
    // 对照：NOT_APPLICABLE 的 0 是真值，必须印出来
    expect(legDaysText("NOT_APPLICABLE", 0)).toBe("0.00 天");
    expect(legDaysText("MEASURED", 18)).toBe("18.00 天");
  });

  it("㉑ 首行就是 EMPTY 时该列在场 —— 原样透出引擎给的原因，不换成自己那句", () => {
    // 把两行掉个个儿：首行带 earliestKitDayReason ⇒ 列名里就有这一列（与真链路同规则）
    const idxStatus = KIT_TABLE_COLUMNS.indexOf("earliestKitDayStatus");
    const columns = [...KIT_TABLE_COLUMNS, "earliestKitDayReason"];
    const engineReason = "以下物料的采购段四段不全，无法结算最早齐套日（拒绝用已知几段之和冒充日期）：sep_film、binder";
    const rows = [...KIT_TABLE_ROWS].reverse().map((r, i) => [...r, i === 0 ? engineReason : null]);
    expect(rows[0]![idxStatus]).toBe("EMPTY");

    const answer: Answer = {
      ...ANSWER_KIT,
      blocks: ANSWER_KIT.blocks.map((b) => (b.type === "table" ? { ...b, columns, rows } : b)),
    };
    renderAnswer("task-kit-13", answer);
    const reason = screen.getByTestId("kit-earliest-reason-SO-3402");
    expect(reason.textContent).toContain("四段不全");
    expect(reason.textContent).not.toContain("后端未随表下发原因");
  });
});
