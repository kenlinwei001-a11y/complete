import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, PLANNER } from "./helpers.js";
import type { OutboxEvent } from "../src/domain.js";

/**
 * WO-ALERT (D6 §3.7 主动决策推送) —— RuleScan 决策阈值越线 → mitigation_select 出处置建议 →
 * 发 decision.alert（NOTIFY 层）+ push 待办（PUSH 替纯 PULL）。
 * 守：链路真跑（命中→建议→待办）、确定性 R6（两跑一致 + 去重）、租户隔离 R2。
 */
describe("WO-ALERT 主动决策推送（RuleScan→告警→mitigation→push 待办）", () => {
  it("越线情景触发 RULE_SCAN → 真发 decision.alert（带 mitigation 建议）+ planner 待办可拉取", async () => {
    const t = await makeApp();
    await seedBattery(t); // demo Orders 含确定性植入越线行（C03 demandDelta>0.5 / C08 outsourceRatio>0.3 等）

    const alerts = await t.services.ruleScan.scan("demo");
    // 至少命中一条决策阈值规则（C03/C08…）
    expect(alerts.length).toBeGreaterThan(0);

    const outbox = (await t.repos.outboxEvents.list("demo")) as OutboxEvent[];
    const decisionAlerts = outbox.filter((e) => e.event === "decision.alert");
    // 决策告警事件真落 outbox（GET /a/v1/outbox 可见）
    expect(decisionAlerts.length).toBeGreaterThan(0);

    // 每条 decision.alert 带 factor + 处置建议（mitigation_select 真案）
    const sample = decisionAlerts[0]!;
    expect(typeof sample.payload.factor).toBe("string");
    expect((sample.payload.factor as string).length).toBeGreaterThan(0);
    // 推荐案非空（canonical 方案库注入 → LIVE 真案）
    expect(sample.payload.recommended).toBeTruthy();
    expect(sample.payload.recommendedName).toBeTruthy();
    expect(sample.payload.draftPayload).toBeTruthy();

    // GET /a/v1/outbox 端点可见 decision.alert（审核方 curl 同口径）
    const obRes = await t.app.inject({ method: "GET", url: "/a/v1/outbox", headers: ADMIN });
    const obList = obRes.json() as { event: string }[];
    expect(obList.some((e) => e.event === "decision.alert")).toBe(true);

    // 待办 push 给 planner：GET /a/v1/notifications 可拉取（PUSH 替纯 PULL 命门）
    const ntfRes = await t.app.inject({ method: "GET", url: "/a/v1/notifications", headers: PLANNER });
    const ntf = ntfRes.json() as { items: { kind: string; title: string; body: string; refType?: string }[]; unread: number };
    const decisionTodos = ntf.items.filter((n) => n.kind === "decision_alert");
    expect(decisionTodos.length).toBeGreaterThan(0);
    // 待办文案含处置建议（让责任角色不必来查就看到「越线 + 建议」）
    expect(decisionTodos.some((n) => n.body.includes("建议处置") && n.refType === "decision_alert")).toBe(true);
  });

  it("R6 确定性：两次扫描 decision.alert 因素/推荐/去重键一致（同输入同输出）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const fingerprint = async () => {
      const all = (await t.repos.outboxEvents.list("demo")) as OutboxEvent[];
      return all
        .filter((e) => e.event === "decision.alert")
        .map((e) => `${e.payload.ruleKey}|${e.payload.baseName}|${e.payload.factor}|${e.payload.recommended}`)
        .sort();
    };

    await t.services.ruleScan.scan("demo");
    const fp1 = await fingerprint();
    // 二次扫描：去重键（ruleKey,baseName）使同一基地同一规则不重复推待办语义
    await t.services.ruleScan.scan("demo");
    const fp2 = await fingerprint();

    expect(fp1.length).toBeGreaterThan(0);
    // 内容指纹集合一致（R6）：二次扫描产生的 decision.alert 因素/推荐与首次同口径
    const uniq1 = [...new Set(fp1)].sort();
    const uniq2 = [...new Set(fp2)].sort();
    expect(uniq2).toEqual(uniq1);
  });

  it("R2 租户隔离：demo 扫描不向他租户 push 待办", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.services.ruleScan.scan("demo");

    // 另一租户的 outbox/通知不应出现 demo 的 decision.alert
    const otherOutbox = (await t.repos.outboxEvents.list("other-tenant")) as OutboxEvent[];
    expect(otherOutbox.filter((e) => e.event === "decision.alert")).toHaveLength(0);
    const otherNtf = await t.repos.notifications.list("other-tenant");
    expect(otherNtf.filter((n) => n.kind === "decision_alert")).toHaveLength(0);
  });
});
