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
 * （`probeMissingRefs` · apps/agentcore/src/resources.ts）的论域经 WO-PUBLISH-REFPROBE
 * 订正 = A 侧 `catalog.solverRegistry` = **全集 61 条（含 GENERIC 档）**——判据钉死在
 * 运行时真判据 `SOLVER_KEYS.includes()`（`apps/datacore/src/solvers/service.ts`），
 * generic 档的 `generic_inference` / `selection_optimize` 都是合法 key；旧
 * `discover("solvers")` 40 论域（scenario+cockpit）会把出厂计划 `ceo_whatif`
 * （invoke_solver generic_inference）误判死路——会误杀正确计划的门比没有门更坏。
 * 于是手抄 4 条**两个方向都错**：
 *   · 太严：技能引用 `kit_readiness`（真注册之一）→ mock 误判 422 死路，真后端放行；
 *   · 太松：技能引用词表外**真不存在**的 solver → mock 放行，真后端 422。
 *     「本地绿、线上红」正是本仓明令禁止的反向假信号
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

  it("① 引用真注册之一（kit_readiness·旧手抄 4 条没有）→ 不再误判死路：200 + 落库 PUBLISHED", async () => {
    seedSkillReferencing("kit_readiness");
    const { status, body } = await publish("skl-action");
    expect(
      { status, code: body.error?.code ?? null, message: body.error?.message ?? null },
      "修前此断言红：mock 拿 4 条手抄清单当注册表，把真后端放行的引用误判成死路",
    ).toEqual({ status: 200, code: null, message: null });
    expect(body.status).toBe("PUBLISHED");
    expect(db.skills.find((x) => x.id === "skl-action")!.status, "发布成功必须落库").toBe("PUBLISHED");
  });

  it("② 引用 GENERIC 档（selection_optimize·WO-PUBLISH-REFPROBE 后已是合法 key）→ 同真后端放行：200 + 落库", async () => {
    seedSkillReferencing("selection_optimize");
    const { status, body } = await publish("skl-action");
    expect(
      { status, code: body.error?.code ?? null },
      "refprobe 论域（=运行时真判据 SOLVER_KEYS 全集）下 selection_optimize 是合法 key——mock 拒它 = 比真后端严 = 本地红线上绿的反向假信号",
    ).toEqual({ status: 200, code: null });
    expect(body.status).toBe("PUBLISHED");
    expect(db.skills.find((x) => x.id === "skl-action")!.status, "发布成功必须落库").toBe("PUBLISHED");
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
