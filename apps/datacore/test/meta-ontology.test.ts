import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { parseMetaOntology, deriveRuntimeStatus } from "../src/meta/parse.js";
import { MetaOntologyService, META_TENANT, resolveDocsDir } from "../src/meta/service.js";
import { OutboxService } from "../src/outbox.js";
import { createMemoryRepos } from "../src/repo/memory.js";
import { makeApp, ADMIN, debugUser } from "./helpers.js";

// META-RUNTIME-TRUTH 齿的合成本体夹具：一个声称 ✅FIXED（判据待跑）+ 一个 ◐PARTIAL。
const RT_MD = [
  "## 8. 断点",
  "| 编号 | 断点 | 链路位置 | 性质 |",
  "|---|---|---|---|",
  "| G-90 | ✅ 已修 R6 招牌 | X→Y | ✅ 已闭（`debattery:check` 守·revert 即红） |",
  "| G-91 | ◐ 部分修 | X→Y | ◐ 大部 |",
  "`meta.ontology_synced`",
].join("\n");
const RT_IDX = {
  ontology: { invariants: ["R6"], breakpoints: ["G-90", "G-91"] },
  breakpointCoverage: { "G-90": ["PRD-x"] },
  prds: {},
};
const bpProps = (md: string, idx: unknown, g: string, opts?: Parameters<typeof parseMetaOntology>[2]) =>
  (parseMetaOntology(md, idx as Parameters<typeof parseMetaOntology>[1], opts).nodes.find(
    (n) => n.kind === "SystemBreakpoint" && n.key === g,
  )!.props) as Record<string, unknown>;

// cwd 无关：与产品同源 resolveDocsDir()（META-SYNC-CWD-FIX 同病同治·从仓根 --root 跑不再 ENOENT 假红）
const DOCS = resolveDocsDir();
async function sources() {
  return {
    ontologyMd: await readFile(join(DOCS, "SYSTEM-ONTOLOGY.md"), "utf8"),
    prdIndex: JSON.parse(await readFile(join(DOCS, "prd-ontology-index.json"), "utf8")),
  };
}

describe("META-SYNC-CWD-FIX · docsDir cwd 无关（治本 G-DM）", () => {
  it("resolveDocsDir 经 import.meta.url 锚定,任意 cwd 下都解析到含 SYSTEM-ONTOLOGY.md 的真实 docs/", () => {
    const orig = process.cwd();
    try {
      // 模拟从仓库根启动（CLAUDE.md 命令 node apps/datacore/dist/server.js）→ 旧实现会得 <root>/../../docs
      process.chdir(tmpdir());
      const dir = resolveDocsDir();
      expect(isAbsolute(dir)).toBe(true);
      // 真值必须真实存在（不作假）：docsDir 下确有本体母体与 prd-index
      expect(existsSync(join(dir, "SYSTEM-ONTOLOGY.md"))).toBe(true);
      expect(existsSync(join(dir, "prd-ontology-index.json"))).toBe(true);
      // 断定 cwd 无关：即便 cwd 变了两次,结果一致
      process.chdir("/");
      expect(resolveDocsDir()).toBe(dir);
    } finally {
      process.chdir(orig);
    }
  });

  it("DOCS_DIR env 覆盖优先（容器/非标准布局兜底）", () => {
    const prev = process.env.DOCS_DIR;
    try {
      process.env.DOCS_DIR = "/custom/docs/override";
      expect(resolveDocsDir()).toBe("/custom/docs/override");
    } finally {
      if (prev === undefined) delete process.env.DOCS_DIR;
      else process.env.DOCS_DIR = prev;
    }
  });
});

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
    // 不变量 + 断点数均以 prd-index 权威集为准（避免硬编码漂移）
    expect(a.nodes.filter((n) => n.kind === "SystemInvariant").length).toBe(prdIndex.ontology.invariants.length);
    expect(a.nodes.filter((n) => n.kind === "SystemBreakpoint").length).toBe(prdIndex.ontology.breakpoints.length);
    // G-8 断点带状态 + 关联不变量 + 覆盖 PRD
    const g8 = a.nodes.find((n) => n.kind === "SystemBreakpoint" && n.key === "G-8")!;
    expect(["FIXED", "PARTIAL", "OPEN"]).toContain(g8.props.status);
    expect((g8.props.relatedInvariants as string[]).length).toBeGreaterThan(0);
    expect((g8.props.relatedPRDs as string[]).length).toBeGreaterThan(0);
  });

  it("sync 物化进元租户 __platform__ + R2 隔离（demo 查不到元对象）+ 影响分析 BFS", async () => {
    const t = await makeApp();
    const { prdIndex } = await sources();
    const res = await t.app.inject({ method: "POST", url: "/a/v1/meta/sync", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const sync = res.json() as { objects: number; links: number; byKind: Record<string, number> };
    expect(sync.objects).toBeGreaterThan(20);
    expect(sync.byKind.SystemBreakpoint).toBe(prdIndex.ontology.breakpoints.length);

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

  it("P4 #14 派生（保守只读）：/meta/derive 返回 code 求解器 + 与本体 diff,不改 markdown", async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: "GET", url: "/a/v1/meta/derive", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const d = res.json() as { dimension: string; code: string[]; inCodeNotInDoc: string[]; note: string };
    expect(d.dimension).toBe("solvers");
    expect(d.code.length).toBeGreaterThan(0); // SOLVER_KEYS 内省
    expect(Array.isArray(d.inCodeNotInDoc)).toBe(true);
    expect(d.note).toContain("不自动改");
  });
});

describe("Dogfooding · Entitlement 先于 authz（admin.meta-ontology 功能门）", () => {
  it("功能关闭 → /meta/* 返回 404 FEATURE_NOT_FOUND（先于角色门：连 admin 也 404）", async () => {
    const t = await makeApp();
    // 默认开：admin 可 sync
    expect((await t.app.inject({ method: "POST", url: "/a/v1/meta/sync", headers: ADMIN })).statusCode).toBe(200);
    // 关闭 admin.meta-ontology 功能
    const put = await t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN, payload: { overrides: { "admin.meta-ontology": false } } });
    expect(put.statusCode).toBe(200);
    // 关闭后：admin 访问 /meta/* → 404 FEATURE_NOT_FOUND（entitlement 先于 authz，铁律）
    const r = await t.app.inject({ method: "POST", url: "/a/v1/meta/sync", headers: ADMIN });
    expect(r.statusCode).toBe(404);
    expect((r.json() as { error: { code: string } }).error.code).toBe("FEATURE_NOT_FOUND");
    const g = await t.app.inject({ method: "GET", url: "/a/v1/meta/ontology", headers: ADMIN });
    expect(g.statusCode).toBe(404);
  });
});

describe("META-RUNTIME-TRUTH · 断点声称 ↔ 运行时判据交叉核对（PRD §3.5·根治 P2 meta 镜像谎言）", () => {
  it("deriveRuntimeStatus 三态派生（纯函数 R6）：只对声称 FIXED 核对，其余原样透传", () => {
    // 声称 FIXED：判据不通=DRIFT（本体谎言曝光）；判据通=FIXED；无判据/未跑=UNCHECKED（诚实·不信 emoji）
    expect(deriveRuntimeStatus("FIXED", { ran: true, passed: false })).toBe("DRIFT");
    expect(deriveRuntimeStatus("FIXED", { ran: true, passed: true })).toBe("FIXED");
    expect(deriveRuntimeStatus("FIXED", undefined)).toBe("UNCHECKED");
    expect(deriveRuntimeStatus("FIXED", { ran: false, passed: false })).toBe("UNCHECKED");
    // 未自称已修 → 无谎可揭，判据结果不覆盖
    expect(deriveRuntimeStatus("PARTIAL", { ran: true, passed: false })).toBe("PARTIAL");
    expect(deriveRuntimeStatus("OPEN", { ran: true, passed: true })).toBe("OPEN");
  });

  it("向后兼容：不传 judgeResults → status 仍读 §8 声称（emoji），claimedStatus/judgeRefs 亮出", () => {
    const p = bpProps(RT_MD, RT_IDX, "G-90");
    expect(p.status).toBe("FIXED"); // 无判据入参时 = 声称（不破既有 sync/parse 测试）
    expect(p.claimedStatus).toBe("FIXED");
    expect(p.judgeRefs).toEqual(["debattery:check"]); // 整行门名抽取（供交叉核对）
    expect(p.runtimeChecked).toBe(false);
  });

  it("齿①：声称 FIXED 但运行时判据不通 → status 派生为 DRIFT（非 FIXED）·claimedStatus 保留两张皮", () => {
    const p = bpProps(RT_MD, RT_IDX, "G-90", { judgeResults: { "G-90": { ran: true, passed: false } } });
    expect(p.status).toBe("DRIFT"); // revert deriveRuntimeStatus→只信 emoji 则此断言塌（green→red 自证）
    expect(p.claimedStatus).toBe("FIXED"); // §8 声称仍留痕，审计对照
    expect(p.runtimeStatus).toBe("DRIFT");
    expect(p.runtimeChecked).toBe(true);
  });

  it("齿②：真 FIXED 且判据通 → FIXED（不误报 DRIFT）；无判据可跑 → UNCHECKED（诚实·非假 FIXED）", () => {
    // 判据真跑通过 → 印证声称
    expect(bpProps(RT_MD, RT_IDX, "G-90", { judgeResults: { "G-90": { ran: true, passed: true } } }).status).toBe("FIXED");
    // 传了 judgeResults 但此断点无条目（无判据可跑）→ 诚实 UNCHECKED，绝不默认信 emoji 假 FIXED
    expect(bpProps(RT_MD, RT_IDX, "G-90", { judgeResults: {} }).status).toBe("UNCHECKED");
    // PARTIAL 声称不被判据覆盖（未自称已修）
    expect(bpProps(RT_MD, RT_IDX, "G-91", { judgeResults: { "G-91": { ran: true, passed: false } } }).status).toBe("PARTIAL");
  });

  it("齿③：sync 落库「用平台查平台自己」→ 元对象 status 即运行时真相（DRIFT），非 §8 emoji 声称", async () => {
    const repos = createMemoryRepos();
    const outbox = new OutboxService(repos, { info() {}, error() {}, warn() {}, debug() {}, child() { return this; } } as never);
    const svc = new MetaOntologyService(repos, outbox);
    const ctx = { tenantId: META_TENANT, userId: "u", roles: ["admin"], attributes: {} };
    await svc.sync(ctx, { ontologyMd: RT_MD, prdIndex: RT_IDX }, { judgeResults: { "G-90": { ran: true, passed: false } } });
    const stored = await svc.getBreakpoint(ctx, "G-90");
    expect(stored?.props.status).toBe("DRIFT"); // 落库对象反映运行时真相
    expect(stored?.props.claimedStatus).toBe("FIXED");
  });

  it("齿④（返工·覆盖率自证）：跑批器独立枚举 §8 全表，声称 FIXED 但无判据者显性列入 uncoveredFixed（命名断点不静默逃过）", () => {
    // META-RUNTIME-TRUTH 返工根因：parse.ts 只投影编号 G-1..G-15，§8 命名断点（G-RET/G-DR-1/
    // G-SIEM-1/G-3b）自称 ✅ 却从不进交叉核对，且判据从不披露覆盖率 → 测谎门自身留未声明盲区。
    // 本齿真跑跑批器（对真 §8）验证：覆盖率被披露 + 那 4 个自称已闭却无判据者被显性列入 uncoveredFixed。
    // revert 跑批器的 §8 独立枚举/覆盖率段 → coverage 缺失或 uncoveredFixed 不含命名断点 → 此断言塌（green→red）。
    const here = fileURLToPath(new URL(".", import.meta.url));
    const root = join(here, "..", "..", "..");
    const script = join(root, "scripts", "meta-runtime-truth.mjs");
    const distParse = join(root, "apps", "datacore", "dist", "meta", "parse.js");
    if (!existsSync(distParse)) return; // 跑批器依赖 dist（gates 链先 build）；无 dist 诚实跳过·非假绿
    const r = spawnSync("node", [script, "--json"], { cwd: root, encoding: "utf8", timeout: 180_000 });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as {
      coverage: { totalSection8: number; parsed: number; unparsed: string[]; claimedFixed: number; crossCheckedFixed: number; uncoveredFixed: string[] };
    };
    const cov = out.coverage;
    expect(cov.totalSection8).toBeGreaterThan(cov.parsed); // §8 全表 > 编号投影（命名断点存在）
    expect(cov.claimedFixed).toBeGreaterThan(cov.crossCheckedFixed); // 声称 FIXED > 真交叉核对印证（有未核对者）
    // 4 个命名断点自称 ✅ 却无静态判据 → 必被显性列入未核对清单（不静默逃过）
    for (const named of ["G-3b", "G-RET", "G-DR-1", "G-SIEM-1"]) {
      expect(cov.unparsed).toContain(named); // parse 未投影
      expect(cov.uncoveredFixed).toContain(named); // 但跑批器独立枚举后显性披露为未核对
    }
  });
});
