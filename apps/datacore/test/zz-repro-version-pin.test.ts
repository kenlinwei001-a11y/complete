/**
 * 临时复现单（本文件不进交付，验完即删）。
 *
 * 目标：亲手复现「会签单钉 vN，全票后实际发出去的是 vM (M≠N)」。
 * 不许拿线索当结论 —— 必须把完整版本号序列打出来。
 */
import { describe, it, expect } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";

const J = <T,>(r: { body: string }): T => JSON.parse(r.body) as T;
const CATALOG_ADMIN = { "x-debug-user": "demo:usr_demo_admin:admin|catalog_admin" };
const PLANNER_OWNER = { "x-debug-user": "demo:usr_demo_planner:planner" };

interface Req {
  id: string;
  status: string;
  ontologyVersion: number;
  signoffs: { domainKey: string; ownerUserId: string | null; decision: string | null }[];
}

async function openRequest(t: TestApp): Promise<Req> {
  const r = await t.app.inject({ method: "POST", url: "/a/v1/ontology/publish-requests", headers: CATALOG_ADMIN, payload: {} });
  expect(r.statusCode).toBe(201);
  return J<Req>(r);
}

const undecided = (rec: Req) => rec.signoffs.filter((s) => !s.decision).length;

/** 轮流让两位 owner 把能签的全签掉，返回最后一次 200 的记录 + 最后一次响应码。 */
async function signAll(t: TestApp, rec: Req): Promise<{ cur: Req; lastCode: number; lastBody: string }> {
  let cur = rec;
  let lastCode = 0;
  let lastBody = "";
  for (let i = 0; i < rec.signoffs.length * 2 && undecided(cur) > 0; i++) {
    for (const h of [CATALOG_ADMIN, PLANNER_OWNER]) {
      const r = await t.app.inject({
        method: "POST",
        url: `/a/v1/ontology/publish-requests/${cur.id}/signoff`,
        headers: h,
        payload: { decision: "APPROVE" },
      });
      lastCode = r.statusCode;
      lastBody = r.body;
      if (r.statusCode === 200) cur = J<Req>(r);
    }
  }
  return { cur, lastCode, lastBody };
}

describe("复现：签的版本号 vs 实际发出的版本号", () => {
  it("金丝雀 —— 正常路：钉 vN 签满 → 实际发出 vN（观测好使的证据）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await t.services.ontology.currentVersion("demo");
    const rec = await openRequest(t);
    // eslint-disable-next-line no-console
    console.log(`[金丝雀] 建单前 max=${before} · 会签单钉=v${rec.ontologyVersion}`);
    const { cur } = await signAll(t, rec);
    expect(cur.status).toBe("APPROVED");
    const after = await t.services.ontology.currentVersion("demo");
    // eslint-disable-next-line no-console
    console.log(`[金丝雀] 签满后 max=${after} · 钉=v${rec.ontologyVersion} · 实际发出=v${after}`);
    expect(after, "金丝雀：正常路都发不出去 ⇒ 我的观测坏了").toBe(before + 1);
    expect(after, "金丝雀：正常路钉的与发的就对不上").toBe(rec.ontologyVersion);
  });

  it("缺陷路：破窗抢先发掉 v(N)，钉在 v(N) 的 PENDING 单签满后发出的是别的版本号", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const v0 = await t.services.ontology.currentVersion("demo");
    // ① 先建一条会签单，它钉的是 v0+1
    const rec = await openRequest(t);
    expect(rec.status).toBe("PENDING_SIGNOFF");
    const pinned = rec.ontologyVersion;

    // ② 破窗抢先把 pinned 这个版本号用掉
    const glass = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/publish?breakGlass=true&reason=" + encodeURIComponent("抢先"),
      headers: CATALOG_ADMIN,
    });
    expect(glass.statusCode, "金丝雀：破窗都发不出去 ⇒ 观测坏了").toBe(200);
    const afterGlass = await t.services.ontology.currentVersion("demo");

    // ③ 那条钉在 pinned 的 PENDING 单仍在，签满
    const { cur, lastCode, lastBody } = await signAll(t, rec);
    const afterSignoff = await t.services.ontology.currentVersion("demo");

    // eslint-disable-next-line no-console
    console.log(
      [
        "───── 版本号序列 ─────",
        `建单前 max            = v${v0}`,
        `会签单钉的版本        = v${pinned}`,
        `破窗发出后 max        = v${afterGlass}`,
        `会签签满后 status     = ${cur.status}`,
        `会签签满后 max        = v${afterSignoff}`,
        `⇒ 签的是 v${pinned}，实际发出的是 v${afterSignoff}`,
        `最后一次 signoff 响应码 = ${lastCode}`,
        `最后一次 signoff 响应体 = ${lastBody.slice(0, 300)}`,
        "──────────────────────",
      ].join("\n"),
    );

    // 这条断言就是缺陷的定性：若签的版本 == 发出的版本，缺陷不存在。
    expect(
      afterSignoff,
      `缺陷不成立：签的 v${pinned} 与发出的 v${afterSignoff} 相同`,
    ).not.toBe(pinned);
  });
});
