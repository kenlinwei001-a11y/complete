import { describe, it, expect, beforeEach } from "vitest";
import type { IntelligenceResource, ResourceSearchResponse, WorkflowDefinition } from "@platform/contracts";
import { findInvalidResources } from "@platform/contracts";
import { createTestApp, debugHeaders, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { seedRegistry, seedMcpConfigs } from "../src/mocks/seed.js";
import type { CatalogClientItem } from "../src/tools/clients.js";

/**
 * WO-SLICE-DISCOVERY · B 侧接缝驱动门（SEAM-GATE）。
 *
 * 病灶（真双服务实测 2026-08-10 · demo · seed 42 · A=4193 / B=4194 亲手打接口）：
 *   `GET /b/v1/resources` 1055 条里 `kind=slice` **恒 2 条**（两条还是 A 侧硬编码的内置目录项）；
 *   `POST /b/v1/resources/search` 问「订单从下单到回款」top-20 **零切片**。
 *   根因在 A 侧（98 条 SliceSpec 因 `spec.description` 恒空被目录过滤掉），
 *   但**后果全部落在 B 侧**：Agent 一条切片都发现不了。
 *
 * 本门驱动的是 B 侧真链路：
 *   目录条目（形状照抄真 A 输出）→ 真 `projectSlices` → 真 `ResourceRegistryService.projectTenant`
 *   → 真三表 → 真 `GET /b/v1/resources` → 真 `ResourceSearchEngine`。
 * **不是**只调 `projectSlices` 断言它能产出 description —— 那是假绿第 9 形态（咬函数不咬链路）。
 *
 * ⚠ 关于 `resource-registry.ts` 的「两端在册」过滤：本门**同时**钉住它的两个方向 ——
 *   切片在册 ⇒ `workflow --includes--> slice` 边必须活；切片不在册 ⇒ 边必须仍被丢掉（无死路 R13）。
 *   这两条缺一不可：只测前者，把过滤删掉也绿；只测后者，本单的修复根本没被验到。
 */

const SLICE_A = "wo_seam_order_chain";
const SLICE_UNREGISTERED = "wo_seam_never_registered";

/** 目录条目形状 = 真 A 侧 `GET /a/v1/catalog?kind=slices` 的行（含本单新增的加性字段）。 */
function catalogSliceItems(): CatalogClientItem[] {
  return [
    {
      key: SLICE_A,
      name: "销售订单·跨 3 域切片（4 类 · 最长 2 跳）",
      description:
        "本体切片 wo_seam_order_chain：以「销售订单（Order）」为根，沿 2 条路径最多 2 跳展开，覆盖 4 个对象类型、3 个业务域。调用需提供实参 so（销售订单 的业务主键）。",
      argHints: { so: "销售订单 的业务主键（root selector 按 objectKey 定位）" },
      requiredArgs: ["so"],
      answersQuestions: ["销售订单关联的客户有哪些", "销售订单关联的应收发票有哪些"],
      tags: ["销售订单", "Order", "客户", "Customer", "应收发票", "ARInvoice"],
      rootType: "Order",
      includedTypes: ["ARInvoice", "Customer", "Model", "Order"],
      includedLinkKeys: ["customer_has_invoice", "order_for_model", "order_of_customer"],
      descriptionSynthesized: true,
      domain: "product",
    },
    {
      key: "wo_seam_coverage_base",
      name: "生产基地·全字段切片",
      description: "本体切片 wo_seam_coverage_base：以「生产基地（Base）」为根，不展开关联，覆盖 1 个对象类型。无需实参即可解出子图。",
      argHints: {},
      requiredArgs: [],
      answersQuestions: ["生产基地这一类对象有哪些、每个的字段值是什么"],
      tags: ["生产基地", "Base", "工厂/基地", "factory"],
      rootType: "Base",
      includedTypes: ["Base"],
      includedLinkKeys: [],
      descriptionSynthesized: true,
      domain: "factory",
    },
  ];
}

/** 一条真 workflow，`resolve_slice` 指向**在册**切片（驱动「两端在册」过滤的正向）。 */
function workflowReferencing(sliceKey: string, key: string): WorkflowDefinition {
  const now = new Date().toISOString();
  return {
    id: `wf_${key}`,
    tenantId: TENANT,
    key,
    version: 1,
    name: `接缝用工作流 ${key}`,
    description: "resolve_slice → render（驱动 workflow→slice 边）",
    inputs: { type: "object", properties: {} },
    steps: [
      { id: "s1", type: "resolve_slice", params: { sliceKey, args: {} } },
      { id: "s2", type: "render_answer", params: { blocks: [{ type: "text", markdown: "ok" }] } },
    ] as WorkflowDefinition["steps"],
    status: "PUBLISHED",
    createdAt: now,
    updatedAt: now,
  } as WorkflowDefinition;
}

async function seedAll(t: TestApp): Promise<void> {
  const { agents, workflows, skills } = seedRegistry();
  for (const w of workflows) await t.repos.workflows.insert(w);
  for (const s of skills) await t.repos.skills.insert(s);
  for (const a of agents) await t.repos.agents.insert(a);
  for (const m of seedMcpConfigs()) await t.repos.mcpConfigs.insert(m);
  await t.repos.workflows.insert(workflowReferencing(SLICE_A, "wo_seam_wf_registered"));
  await t.repos.workflows.insert(workflowReferencing(SLICE_UNREGISTERED, "wo_seam_wf_dangling"));
}

/** 把 A 侧目录换成本门的条目（`items` 为空 = 复现修前的「切片发现不了」态）。 */
function stubCatalog(t: TestApp, items: CatalogClientItem[]): void {
  t.dataCore.catalog.discover = async (_ctx, kind) => ({ items: kind === "slices" ? items : [] });
}

const listResources = async (t: TestApp, query = ""): Promise<IntelligenceResource[]> => {
  const res = await t.app.inject({ method: "GET", url: `/b/v1/resources${query}`, headers: debugHeaders(ADMIN) });
  expect(res.statusCode).toBe(200);
  return (res.json() as { items: IntelligenceResource[] }).items;
};

const search = async (t: TestApp, query: string, body: Record<string, unknown> = {}): Promise<ResourceSearchResponse> => {
  const res = await t.app.inject({
    method: "POST",
    url: "/b/v1/resources/search",
    headers: debugHeaders(ADMIN),
    payload: { query, maxResults: 20, minScore: 0, ...body },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as ResourceSearchResponse;
};

describe("WO-SLICE-DISCOVERY · B 侧：切片可发现 + 摘要带 requiredArgs（接缝驱动）", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
    await seedAll(t);
  });

  it("SEAM-B1：A 侧目录里有几条切片，/b/v1/resources 的 kind=slice 就有几条（不再在接缝上丢）", async () => {
    // 修前态：A 侧目录只给得出 2 条（98 条被空 description 过滤）。
    stubCatalog(t, []);
    expect((await listResources(t, "?kind=slice")).length).toBe(0);

    // 修后态：A 侧把登记切片全给出来 ⇒ B 侧一条不少地收录。
    const items = catalogSliceItems();
    stubCatalog(t, items);
    const slices = await listResources(t, "?kind=slice");
    expect(slices.map((r) => r.key).sort()).toEqual(items.map((i) => i.key).sort());
    for (const r of slices) expect(r.description.trim().length).toBeGreaterThan(0);
    expect(findInvalidResources(slices)).toEqual([]);
  });

  it("SEAM-B2：摘要 requiredArgs 一路活到端点（接缝上不许被类型层静默吃掉）", async () => {
    stubCatalog(t, catalogSliceItems());
    const detail = await t.app.inject({
      method: "GET",
      url: `/b/v1/resources/slice/${SLICE_A}`,
      headers: debugHeaders(ADMIN),
    });
    expect(detail.statusCode).toBe(200);
    const r = detail.json() as IntelligenceResource & { rootType?: string; includedTypes?: string[] };
    // 这三个断言各钉一处接缝：requiredArgs（本单新增）· rootType/includedTypes（原被硬写成 ""/[]）。
    expect(r.requiredArgs).toEqual(["so"]);
    expect(r.argHints?.so).toBeTruthy();
    expect(r.rootType).toBe("Order");
    expect(r.includedTypes).toEqual(["ARInvoice", "Customer", "Model", "Order"]);

    // 无需实参的切片必须是**明确的空数组**，不是缺省 —— 「没声明」与「不需要」是两个命题。
    const cov = await t.app.inject({
      method: "GET",
      url: "/b/v1/resources/slice/wo_seam_coverage_base",
      headers: debugHeaders(ADMIN),
    });
    expect((cov.json() as IntelligenceResource).requiredArgs).toEqual([]);
  });

  it("SEAM-B3：检索「订单…」类问句时切片真的进 top-N（修前 top-20 零切片）", async () => {
    stubCatalog(t, []);
    const before = await search(t, "订单从下单到回款");
    expect(before.results.filter((x) => x.resource.kind === "slice").length).toBe(0);

    stubCatalog(t, catalogSliceItems());
    const after = await search(t, "订单从下单到回款");
    const hitKeys = after.results.map((x) => x.resource.key);
    expect(hitKeys, "订单类问句的 top-20 里应出现订单链切片").toContain(SLICE_A);

    // kind 收窄后它必须排在同类首位（同类里最贴题的那条 —— 只看"出现了"会被大 maxResults 蒙混）。
    const sliceOnly = await search(t, "订单从下单到回款", { kinds: ["slice"] });
    expect(sliceOnly.results[0]?.resource.key).toBe(SLICE_A);
  });

  it("SEAM-B4：切片在册 ⇒ workflow→slice 边活；不在册 ⇒ 仍被丢掉（无死路 R13·两个方向都钉）", async () => {
    // ① 切片不在册（= 修前态）：边被「两端在册」过滤静默丢掉。
    stubCatalog(t, []);
    const wfsBefore = await listResources(t, "?kind=workflow");
    const regBefore = wfsBefore.find((w) => w.key === "wo_seam_wf_registered")!;
    expect((regBefore.relations ?? []).filter((e) => e.toKind === "slice")).toEqual([]);

    // ② 切片在册（= 修后态）：同一条 workflow 的同一条边自己活过来，无需改 relations 抽取逻辑。
    stubCatalog(t, catalogSliceItems());
    const wfsAfter = await listResources(t, "?kind=workflow");
    const regAfter = wfsAfter.find((w) => w.key === "wo_seam_wf_registered")!;
    expect((regAfter.relations ?? []).filter((e) => e.toKind === "slice")).toEqual([
      { relType: "includes", toKind: "slice", toKey: SLICE_A },
    ]);

    // ③ 反向锚：指向**不存在**的切片那条边仍必须被丢掉。
    //    没有这一条，把 :221 的过滤整个删掉也能让 ② 变绿 —— 那就等于没验到过滤本身。
    const dangling = wfsAfter.find((w) => w.key === "wo_seam_wf_dangling")!;
    expect((dangling.relations ?? []).filter((e) => e.toKind === "slice")).toEqual([]);
  });

  it("SEAM-B5：slice→objectType 边随 includedTypes 活过来（原 includedTypes 硬写 [] ⇒ 边恒空）", async () => {
    stubCatalog(t, catalogSliceItems());
    const res = await t.app.inject({
      method: "GET",
      url: `/b/v1/resources/slice/${SLICE_A}/relations`,
      headers: debugHeaders(ADMIN),
    });
    expect(res.statusCode).toBe(200);
    const rel = res.json() as { relations: { relType: string; toKind: string; toKey: string }[] };
    expect(rel.relations.filter((e) => e.toKind === "objectType").map((e) => e.toKey)).toEqual([
      "ARInvoice",
      "Customer",
      "Model",
      "Order",
    ]);
  });
});
