import { describe, expect, it } from "vitest";
import { tokenFor, db } from "@/mocks/db";
import { ACCOUNTS } from "@/mocks/fixtures";

/**
 * WO-MOCK-FE-REGISTRY-PARITY · 发布探针词表的行为接缝（本单的修前 repro / 修后回归）。
 *
 * ── 病灶 ──────────────────────────────────────────────────────────────────────
 * `handlers.ts` 的 `MOCK_SOLVER_REGISTRY` 曾是**手抄 4 条**（capacity_forecast /
 * bottleneck_matrix / selection_optimize / order_fullchain），而 `POST /b/v1/skills/:id/publish`
 * 的引用存在性探针拿它当「哪些求解器真的注册了」判死路。真后端探针
 * （`probeMissingRefs` · apps/agentcore/src/resources.ts）的论域 = A 侧
 * `discover("solvers")` = `SOLVER_CATALOG + COCKPIT_SOLVER_CATALOG`（本单实测 22+18=40 条，
 * feature 全开口径）。于是手抄 4 条**两个方向都错**：
 *   · 太严：技能引用 `kit_readiness`（真 40 条之一）→ mock 误判 422 死路，真后端放行；
 *   · 太松：技能引用 `selection_optimize`（GENERIC 档，**不在** discover 论域）
 *     → mock 放行，真后端 422。「本地绿、线上红」正是本仓明令禁止的反向假信号
 *     （mock 可以松的方向仅限「真后端本就更松」，这里恰恰相反）。
 *
 * ── 本测试咬的是链路 ──────────────────────────────────────────────────────────
 * 真打 MSW HTTP（不是调函数）：改种子技能的 references → POST publish → 断言状态码/
 * 错误码/落库态。修前：①②红（mock 词表错）；修后：全绿。
 * 词表与真 A 侧的**集合对拍**在 `solver-registry-parity.seam.test.ts`（同一单），
 * 本文件不重复造词表，只验行为。
 */

const token = tokenFor(ACCOUNTS.find((a) => a.username === "planner")!);

async function publish(skillId: string): Promise<{ status: number; body: Record<string, any> }> {
  const res = await fetch(`http://127.0.0.1/b/v1/skills/${skillId}/publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

/** 把种子草稿技能改造成「只引用指定 solver」的探针样本（dependsOn 清空以隔离变量）。 */
function seedSkillReferencing(solverKey: string): void {
  const s = db.skills.find((x) => x.id === "skl-action")!;
  s.references = [{ kind: "solver", key: solverKey, role: "precondition", required: true }];
  s.dependsOn = [];
}

describe("WO-MOCK-FE-REGISTRY-PARITY · skill 发布探针与真后端同论域（行为接缝）", () => {
  it("金丝雀：探针样本确实只引一个 solver（夹具自证，不中就是夹具坏了）", () => {
    seedSkillReferencing("kit_readiness");
    const s = db.skills.find((x) => x.id === "skl-action")!;
    expect(s.references).toEqual([{ kind: "solver", key: "kit_readiness", role: "precondition", required: true }]);
    expect(s.dependsOn).toEqual([]);
    expect(s.status).toBe("DRAFT");
  });

  it("① 引用真 40 条之一（kit_readiness·旧手抄 4 条没有）→ 不再误判死路：200 + 落库 PUBLISHED", async () => {
    seedSkillReferencing("kit_readiness");
    const { status, body } = await publish("skl-action");
    expect(
      { status, code: body.error?.code ?? null, message: body.error?.message ?? null },
      "修前此断言红：mock 拿 4 条手抄清单当注册表，把真后端放行的引用误判成死路",
    ).toEqual({ status: 200, code: null, message: null });
    expect(body.status).toBe("PUBLISHED");
    expect(db.skills.find((x) => x.id === "skl-action")!.status, "发布成功必须落库").toBe("PUBLISHED");
  });

  it("② 引用 GENERIC 档（selection_optimize·不在真 discover 论域）→ 同真后端拒：422 + 未落库", async () => {
    seedSkillReferencing("selection_optimize");
    const { status, body } = await publish("skl-action");
    expect(status, "mock 不得比真后端松：真探针论域不含 GENERIC 档，本地放行 = 本地绿线上红").toBe(422);
    expect(body.error?.code).toBe("SKILL_REF_UNRESOLVED");
    expect(body.error?.message).toContain("selection_optimize");
    expect(db.skills.find((x) => x.id === "skl-action")!.status, "被拒不得落库").toBe("DRAFT");
  });

  it("③ 引用真不存在的 solver → 仍 422（探针没被修成无脑放行）", async () => {
    seedSkillReferencing("ghost_solver_本单探针");
    const { status, body } = await publish("skl-action");
    expect(status).toBe(422);
    expect(body.error?.code).toBe("SKILL_REF_UNRESOLVED");
    expect(body.error?.message).toContain("ghost_solver_本单探针");
    expect(db.skills.find((x) => x.id === "skl-action")!.status).toBe("DRAFT");
  });
});
