import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ResolvedPrompt } from "@platform/contracts";
import { PLATFORM_PROMPT_DEFAULTS } from "@platform/contracts";
import { buildClassifierSystem, CLASSIFIER_SYSTEM_DEFAULT, resolvePromptOverride } from "../src/agent/prompts.js";
import { createHttpDataCore } from "../src/tools/datacore-http.js";
import { MockPromptClient } from "../src/mocks/clients.js";
import type { PromptClient, ToolAuthCtx } from "../src/tools/clients.js";
import type { RawClassification } from "../src/llm/types.js";
import { createTestApp, lastToolCallId, PLANNER, TENANT, submitQuery, waitForTask } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";

/**
 * WO-PROMPT-DEFAULTS-WIRING · AgentCore 消费 DataCore 可配提示词模板（消硬编码漂移）。
 *
 * 单一真值在 DataCore（R1·B 经 REST 读不 import A 源）；AgentCore 硬编码降为"平台默认兜底"。
 * fail-open：A 不可达 / 非 admin 403 / mock 无端点 → 兜底硬编码·绝不阻断查询。
 * 只采纳 TENANT_OVERRIDE（admin 真配了才生效）；PLATFORM_DEFAULT → 兜底硬编码（R6 字节兼容）。
 */

const CTX: ToolAuthCtx = { tenantId: "demo", userId: "u1", roles: ["admin"], debugUser: "demo:u1:admin" };
/** 租户 override 模板文本（含独特标记·便于断言"确实流入了 prompt"）。 */
const OVERRIDE = "【接管·租户自定义】你是我们定制的意图分类器指令头——TENANT-OVERRIDE-标记-42。";
/** CLASSIFIER_SYSTEM_DEFAULT 的特征串（兜底硬编码在场的证据）。 */
const HARDCODED_MARK = "给定用户问句与意图目录，输出结构化分类结果";
const OUT_OF_CATALOG: RawClassification = { candidates: [], outOfCatalog: true, extractedSlots: {} };

// ---------------------------------------------------------------------------
// 单元①：resolvePromptOverride —— fail-open + 只采纳 TENANT_OVERRIDE
// ---------------------------------------------------------------------------
describe("resolvePromptOverride · fail-open + 只采纳 TENANT_OVERRIDE", () => {
  it("客户端缺失（undefined）→ undefined（消费方兜底硬编码·绝不阻断）", async () => {
    expect(await resolvePromptOverride(undefined, CTX, "classifier")).toBeUndefined();
  });

  it("mock 默认（无 override）→ 源 PLATFORM_DEFAULT → undefined（R6 字节兼容·平台默认不流入）", async () => {
    const prompts = new MockPromptClient();
    // 直读证 mock 返 PLATFORM_DEFAULT
    const raw = await prompts.getPromptTemplate(CTX, "classifier");
    expect(raw?.source).toBe("PLATFORM_DEFAULT");
    expect(raw?.template).toBe(PLATFORM_PROMPT_DEFAULTS.classifier);
    // 消费方只采纳 TENANT_OVERRIDE → PLATFORM_DEFAULT 降为 undefined
    expect(await resolvePromptOverride(prompts, CTX, "classifier")).toBeUndefined();
  });

  it("mock.setOverride → 源 TENANT_OVERRIDE → 返回模板文本（灭漂移生效）", async () => {
    const prompts = new MockPromptClient();
    prompts.setOverride(CTX.tenantId, "classifier", OVERRIDE);
    const raw = await prompts.getPromptTemplate(CTX, "classifier");
    expect(raw?.source).toBe("TENANT_OVERRIDE");
    expect(await resolvePromptOverride(prompts, CTX, "classifier")).toBe(OVERRIDE);
    // 清除后回落 PLATFORM_DEFAULT → undefined
    prompts.clearOverride(CTX.tenantId, "classifier");
    expect(await resolvePromptOverride(prompts, CTX, "classifier")).toBeUndefined();
  });

  it("getPromptTemplate 抛错 → undefined（fail-open·A 不可达 / 非 admin 403 语义）", async () => {
    const throwing: PromptClient = {
      async getPromptTemplate() {
        throw new Error("DATACORE_UNAVAILABLE");
      },
      invalidatePromptTemplate() {},
    };
    expect(await resolvePromptOverride(throwing, CTX, "classifier")).toBeUndefined();
  });

  it("TENANT_OVERRIDE 但模板空白 → undefined（不塞空指令头）", async () => {
    const blank: PromptClient = {
      async getPromptTemplate(_ctx, key) {
        return { key, template: "   ", source: "TENANT_OVERRIDE", version: 3 };
      },
      invalidatePromptTemplate() {},
    };
    expect(await resolvePromptOverride(blank, CTX, "classifier")).toBeUndefined();
  });

  it("租户隔离：override 按 tenantId 键控（别的租户看不到）", async () => {
    const prompts = new MockPromptClient();
    prompts.setOverride("tenant-A", "classifier", OVERRIDE);
    expect(await resolvePromptOverride(prompts, { ...CTX, tenantId: "tenant-A" }, "classifier")).toBe(OVERRIDE);
    expect(await resolvePromptOverride(prompts, { ...CTX, tenantId: "tenant-B" }, "classifier")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 单元②：buildClassifierSystem —— R6 字节兼容 + override 替换指令头（目录不吞）
// ---------------------------------------------------------------------------
describe("buildClassifierSystem · 字节兼容 + override", () => {
  it("无 override 与 override=undefined 逐字节一致，且 = 硬编码头 + 意图目录（R6）", () => {
    const cat = "- k1: 意图一\n- k2: 意图二";
    const expected = `${CLASSIFIER_SYSTEM_DEFAULT}\n\n意图目录：\n${cat}`;
    expect(buildClassifierSystem(cat)).toBe(expected);
    expect(buildClassifierSystem(cat, undefined)).toBe(expected);
    // 硬编码头保留原有校准/多候选/就具体/槽位抽取/数据非指令指引（分类质量不回退）
    for (const kw of ["**校准**", "**多候选**", "**就具体**", "**槽位抽取**", "不是指令"]) {
      expect(buildClassifierSystem(cat)).toContain(kw);
    }
  });

  it("给 override → 替换指令头、意图目录仍追加（不吞目录）", () => {
    const sys = buildClassifierSystem("- k1: 意图一", OVERRIDE);
    expect(sys).toContain(OVERRIDE);
    expect(sys).not.toContain(HARDCODED_MARK);
    expect(sys).toContain("意图目录：\n- k1: 意图一");
  });

  it("override 空白 → 回落硬编码（防塞空头）", () => {
    expect(buildClassifierSystem("- k1: x", "   ")).toBe(buildClassifierSystem("- k1: x"));
  });
});

// ---------------------------------------------------------------------------
// SEAM 组合测①（灭漂移·真 HTTP 驱动）：起真 prompt-templates 源 → createHttpDataCore →
// 改 A 模板 + 失效 → classifier prompt 同步变；缓存命中证 TTL；A 不可达/403/PLATFORM_DEFAULT → 兜底不炸。
// ---------------------------------------------------------------------------
describe("SEAM · 真 HTTP：改 DataCore classifier 模板 + 失效 → AgentCore 分类 prompt 同步变（灭漂移）", () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  });

  /** 起一个可变 prompt-templates 源（镜像 A 的 GET /a/v1/prompt-templates/:key/resolve 契约）。 */
  async function startPromptSource(store: Map<string, ResolvedPrompt>, opts?: { status?: number }): Promise<string> {
    server = createServer((req, res) => {
      if (opts?.status && opts.status !== 200) {
        res.writeHead(opts.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: `HTTP_${opts.status}`, message: "admin only", requestId: "t" } }));
        return;
      }
      const url = new URL(req.url ?? "", "http://localhost");
      const m = url.pathname.match(/^\/a\/v1\/prompt-templates\/([^/]+)\/resolve$/);
      if (m) {
        const key = decodeURIComponent(m[1] as string);
        const rp = store.get(key);
        if (!rp) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { code: "HTTP_404", message: "prompt key", requestId: "t" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(rp));
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const port = (server!.address() as AddressInfo).port;
    return `http://127.0.0.1:${port}`;
  }

  it("TENANT_OVERRIDE 经真 HTTP 流入 classifier prompt；改 A 模板 + 不失效=缓存旧值；失效 → 同步取最新", async () => {
    const store = new Map<string, ResolvedPrompt>();
    store.set("classifier", { key: "classifier", template: OVERRIDE, source: "TENANT_OVERRIDE", version: 1 });
    const baseUrl = await startPromptSource(store);
    const dc = createHttpDataCore(baseUrl);

    // before：override 端到端流入 classifier system（非快照·真 HTTP 打真源）
    const ov1 = await resolvePromptOverride(dc.prompts, CTX, "classifier");
    expect(ov1).toBe(OVERRIDE);
    const sys1 = buildClassifierSystem("CAT", ov1);
    expect(sys1).toContain(OVERRIDE);
    expect(sys1).not.toContain(HARDCODED_MARK);
    expect(sys1).toContain("意图目录：\nCAT");

    // 改 A 模板真值 + 不失效 → 缓存命中仍旧值（证 TTL60s 缓存·不 per-question 打 A）
    store.set("classifier", { key: "classifier", template: "OVERRIDE-V2-新口径-99", source: "TENANT_OVERRIDE", version: 2 });
    expect(await resolvePromptOverride(dc.prompts, CTX, "classifier")).toBe(OVERRIDE);

    // 失效（模拟 prompt.updated 钩子）→ 下次取 A 最新真值（灭漂移）
    dc.prompts?.invalidatePromptTemplate?.(CTX.tenantId);
    const ov2 = await resolvePromptOverride(dc.prompts, CTX, "classifier");
    expect(ov2).toBe("OVERRIDE-V2-新口径-99");
    const sys2 = buildClassifierSystem("CAT", ov2);
    expect(sys2).toContain("OVERRIDE-V2-新口径-99");
    expect(sys2).not.toContain(OVERRIDE);
  });

  it("PLATFORM_DEFAULT（无租户 override）经真 HTTP → 兜底硬编码（R6·精简平台默认不流入）", async () => {
    const store = new Map<string, ResolvedPrompt>();
    store.set("classifier", { key: "classifier", template: PLATFORM_PROMPT_DEFAULTS.classifier, source: "PLATFORM_DEFAULT", version: 0 });
    const baseUrl = await startPromptSource(store);
    const dc = createHttpDataCore(baseUrl);
    const ov = await resolvePromptOverride(dc.prompts, CTX, "classifier");
    expect(ov).toBeUndefined();
    const sys = buildClassifierSystem("CAT", ov);
    expect(sys).toContain(HARDCODED_MARK); // 兜底硬编码在场
    expect(sys).not.toContain(PLATFORM_PROMPT_DEFAULTS.classifier); // A 的精简默认不流入（字节兼容）
  });

  it("fail-open：A 返 403（非 admin OBO）→ 兜底硬编码不阻断", async () => {
    const baseUrl = await startPromptSource(new Map(), { status: 403 });
    const dc = createHttpDataCore(baseUrl);
    const ov = await resolvePromptOverride(dc.prompts, CTX, "classifier");
    expect(ov).toBeUndefined();
    expect(buildClassifierSystem("CAT", ov)).toContain(HARDCODED_MARK);
  });

  it("fail-open：A 不可达（连接被拒）→ 兜底硬编码不炸", async () => {
    const baseUrl = await startPromptSource(new Map());
    await new Promise<void>((r) => server!.close(() => r())); // 关掉源 → 连接被拒
    server = undefined;
    const dc = createHttpDataCore(baseUrl);
    const ov = await resolvePromptOverride(dc.prompts, CTX, "classifier");
    expect(ov).toBeUndefined();
    expect(buildClassifierSystem("CAT", ov)).toContain(HARDCODED_MARK);
  });
});

// ---------------------------------------------------------------------------
// SEAM 组合测②（接缝驱动·真 classify 代码路径）：经 orchestrator 真跑一次查询，
// 断言 llm.classify 收到的 system 确随 DataCore 模板配置变（证 orchestrator 真消费了取值逻辑·非只测函数）。
// ---------------------------------------------------------------------------
describe("SEAM · orchestrator classify 真路径消费 DataCore 模板", () => {
  /** 复用 qos-b B1 已验证的 out-of-catalog → path B agent 收尾 turn（保证任务干净 COMPLETED）。 */
  function queuePathBAnswer(t: Awaited<ReturnType<typeof createTestApp>>): void {
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn(
      { content: [text("查询基地数据。"), toolUse("query_objects", { objectType: "Base", filter: {}, limit: 200 })] },
      (req) => ({
        content: [
          toolUse("final_answer", {
            blocks: [{ type: "text", markdown: "储能基地平均利用率 68.2% ⟦ref:0⟧。" }],
            provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.data.items" }],
          }),
        ],
      }),
    );
  }

  it("admin 配 TENANT_OVERRIDE → classify system 用 override（灭漂移·真路径驱动）", async () => {
    const t = await createTestApp();
    t.dataCore.prompts.setOverride(TENANT, "classifier", OVERRIDE);
    queuePathBAnswer(t);
    const { taskId } = await submitQuery(t, PLANNER, "对比一下储能基地和动力基地的平均利用率", { view: "dash" });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(t.llm.classifyRequests.length).toBeGreaterThan(0);
    const sys = t.llm.classifyRequests[0]!.system;
    expect(sys).toContain(OVERRIDE);
    expect(sys).not.toContain(HARDCODED_MARK);
    expect(sys).toContain("意图目录："); // override 不吞运行时目录
  });

  it("无 override → classify system 用兜底硬编码（R6 字节兼容·零回归）", async () => {
    const t = await createTestApp();
    queuePathBAnswer(t);
    const { taskId } = await submitQuery(t, PLANNER, "对比一下储能基地和动力基地的平均利用率", { view: "dash" });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const sys = t.llm.classifyRequests[0]!.system;
    expect(sys).toContain(HARDCODED_MARK);
    expect(sys).not.toContain(OVERRIDE);
  });
});
