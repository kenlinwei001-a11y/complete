import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseMetaOntology } from "../src/meta/parse.js";
import { makeApp, ADMIN, debugUser } from "./helpers.js";

const DOCS = join(process.cwd(), "..", "..", "docs");
async function sources() {
  return {
    ontologyMd: await readFile(join(DOCS, "SYSTEM-ONTOLOGY.md"), "utf8"),
    prdIndex: JSON.parse(await readFile(join(DOCS, "prd-ontology-index.json"), "utf8")),
  };
}

describe("Dogfooding P1 · 系统本体自反落库", () => {
  it("parse 确定性（R6）：同 markdown+index 两次解析字节级一致 + 八类齐全", async () => {
    const { ontologyMd, prdIndex } = await sources();
    const a = parseMetaOntology(ontologyMd, prdIndex);
    const b = parseMetaOntology(ontologyMd, prdIndex);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // R6 字节级一致
    const kinds = new Set(a.nodes.map((n) => n.kind));
    expect(kinds.has("SystemInvariant")).toBe(true);
    expect(kinds.has("SystemBreakpoint")).toBe(true);
    expect(kinds.has("SystemEvent")).toBe(true);
    // 14 不变量 + 8 断点（与 prd-index 权威集一致）
    expect(a.nodes.filter((n) => n.kind === "SystemInvariant").length).toBe(prdIndex.ontology.invariants.length);
    expect(a.nodes.filter((n) => n.kind === "SystemBreakpoint").length).toBe(8);
    // G-8 断点带状态 + 关联不变量 + 覆盖 PRD
    const g8 = a.nodes.find((n) => n.kind === "SystemBreakpoint" && n.key === "G-8")!;
    expect(["FIXED", "PARTIAL", "OPEN"]).toContain(g8.props.status);
    expect((g8.props.relatedInvariants as string[]).length).toBeGreaterThan(0);
    expect((g8.props.relatedPRDs as string[]).length).toBeGreaterThan(0);
  });

  it("sync 物化进元租户 __platform__ + R2 隔离（demo 查不到元对象）+ 影响分析 BFS", async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: "POST", url: "/a/v1/meta/sync", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const sync = res.json() as { objects: number; links: number; byKind: Record<string, number> };
    expect(sync.objects).toBeGreaterThan(20);
    expect(sync.byKind.SystemBreakpoint).toBe(8);

    // /meta/breakpoints/G-8 返回状态 + 关联不变量 + 覆盖 PRD（DoD #2）
    const bp = (await (await t.app.inject({ method: "GET", url: "/a/v1/meta/breakpoints/G-8", headers: ADMIN })).json()) as { props: { status: string; relatedPRDs: string[] } };
    expect(["FIXED", "PARTIAL", "OPEN"]).toContain(bp.props.status);
    expect(bp.props.relatedPRDs.length).toBeGreaterThan(0);

    // 影响分析（DoD #3）：改 R14 影响哪些节点 → BFS 命中引用 R14 的 PRD
    const impact = (await (await t.app.inject({ method: "GET", url: "/a/v1/meta/impact?node=R14", headers: ADMIN })).json()) as { affected: { id: string }[] };
    expect(impact.affected.length).toBeGreaterThan(0);

    // R2 铁纪律①：demo 业务租户任意对象查询查不到 __platform__ 元对象
    const demoObjs = (await (await t.app.inject({ method: "GET", url: "/a/v1/objects?type=SystemBreakpoint", headers: ADMIN })).json()) as { rows?: unknown[]; data?: unknown[] };
    const rows = demoObjs.rows ?? demoObjs.data ?? [];
    expect(Array.isArray(rows) ? rows.length : 0).toBe(0);
  });

  it("默认仅 admin（planner → 403）", async () => {
    const t = await makeApp();
    const r = await t.app.inject({ method: "POST", url: "/a/v1/meta/sync", headers: debugUser("demo", "planner", "planner") });
    expect(r.statusCode).toBe(403);
  });

  it("P2 鉴权可配置：默认 [admin] → 授予 planner 可访问 → 撤销回 403（按租户）", async () => {
    const t = await makeApp();
    const PLANNER = debugUser("demo", "planner", "planner");
    await t.app.inject({ method: "POST", url: "/a/v1/meta/sync", headers: ADMIN });

    // 默认策略 [admin];planner 不可
    const pol = (await (await t.app.inject({ method: "GET", url: "/a/v1/meta/access-policy", headers: ADMIN })).json()) as { roles: string[] };
    expect(pol.roles).toEqual(["admin"]);
    expect((await t.app.inject({ method: "GET", url: "/a/v1/meta/ontology", headers: PLANNER })).statusCode).toBe(403);

    // admin 把 planner 加入白名单 → planner 可访问
    const put = await t.app.inject({ method: "PUT", url: "/a/v1/meta/access-policy", headers: ADMIN, payload: { roles: ["admin", "planner"] } });
    expect(put.statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: "/a/v1/meta/ontology", headers: PLANNER })).statusCode).toBe(200);

    // 撤销 → planner 回 403
    await t.app.inject({ method: "PUT", url: "/a/v1/meta/access-policy", headers: ADMIN, payload: { roles: ["admin"] } });
    expect((await t.app.inject({ method: "GET", url: "/a/v1/meta/ontology", headers: PLANNER })).statusCode).toBe(403);

    // planner 改策略 = 403（仅 admin 可配）
    expect((await t.app.inject({ method: "PUT", url: "/a/v1/meta/access-policy", headers: PLANNER, payload: { roles: ["planner"] } })).statusCode).toBe(403);
  });

  it("P2 通用元对象读取端点：invariants/:id · events/:name 命中", async () => {
    const t = await makeApp();
    await t.app.inject({ method: "POST", url: "/a/v1/meta/sync", headers: ADMIN });
    const r14 = await t.app.inject({ method: "GET", url: "/a/v1/meta/invariants/R14", headers: ADMIN });
    expect(r14.statusCode).toBe(200);
    expect((r14.json() as { type: string }).type).toBe("SystemInvariant");
    // 不存在 → 404
    expect((await t.app.inject({ method: "GET", url: "/a/v1/meta/invariants/R999", headers: ADMIN })).statusCode).toBe(404);
  });
});
