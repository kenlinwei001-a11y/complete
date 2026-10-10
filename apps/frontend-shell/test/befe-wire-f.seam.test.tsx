import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { db } from "@/mocks/db";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-BEFE-F · **「后端注册了、前端零调用」六条端点的接缝门**
 * （门 `befe-seam:check` 载体② · 断点 `G-BE-FE-SEAM-DEAD`）。
 *
 * 本文件咬的六条（其余 13 条属「设计上不该有前端」或「已有等价入口」，见工单分诊表）：
 *   ① `GET  /a/v1/llm-budgets`            管理员读配额（`apps/datacore/src/app.ts:1276`）
 *   ② `PUT  /a/v1/llm-budgets`            管理员改配额（同上 :1277·`mustAdmin`·**零服务调用方**）
 *   ③ `POST /a/v1/kb/search`              知识库语义检索（同上 :5186）
 *   ④ `POST /a/v1/kb/:connId/docs`        文档入库（同上 :5193）
 *   ⑤ `POST /a/v1/kb/:connId/sync`        全量重嵌（同上 :5211）
 *   ⑥ `GET  /b/v1/resources/:kind/:key`   单资源详情（`apps/agentcore/src/server.ts:1020`）
 *
 * ── 为什么**不** `vi.mock("@/api/endpoints")`（与 WO-BEFE-WIRE-3 同源纪律）────────────
 * 那会把病灶所在的那一跳一起 mock 掉：桩函数收什么参数都行，URL 模板、方法、body 序列化根本不
 * 参与，于是断言恒绿而缺口仍在。本文件走**真 endpoints**，在 MSW 层拦**真实 URL + 真实方法 +
 * 真实 body**，并把每次请求记进 `seen[]` —— 咬的是链路，不是函数。
 *
 * ── 判据「用户点得到」而不是「API 层有函数」──────────────────────────────────────
 * 每条都从**真实 route 渲染出来的可见控件**驱动：
 *   ①② `/admin/llm-providers` → 点「成本配额」Tab → 读数 → 填硬线 → 点「保存配额」→ 屏上状态翻档
 *   ③④⑤ `/admin/connections` → KB 面板 → 上传文档 → 检索命中该文档 → 全量重嵌回报篇数
 *   ⑥   `/admin/resources` → 点资源行 → 详情出现**只有详情端点才下发**的字段
 *
 * ── no-secrets-echo 的机器判据（本单安全红线·见文件末尾 describe）───────────────────
 * 光靠「前端没写读密钥的代码」是靠人保证的，不是机器保证的。末段那条用例**故意让后端回明文**
 * （四种形态：`apiKey` / `credential` / `apiKeyCiphertext` / 顶层 `sk-…` 串），
 * 然后断言**整棵 DOM 里不得出现明文形态** —— 后端哪天不小心回显了，这条当场变红。
 */

const readRepoFile = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** 一次被拦下的真实请求（URL + 方法 + body）。 */
interface SeenReq {
  method: string;
  path: string;
  body?: unknown;
}

/** 在既有 mock handler **之前**插一层探针：记录真实 URL/方法/body，然后放行给原 handler。 */
function spy(seen: SeenReq[], method: "get" | "post" | "put", pattern: string) {
  return http[method](pattern, async ({ request }) => {
    const path = new URL(request.url).pathname;
    let body: unknown;
    if (method !== "get") body = await request.clone().json().catch(() => undefined);
    seen.push({ method: request.method, path, ...(body !== undefined ? { body } : {}) });
    return undefined; // 落到下一个 handler（真 mock 后端）
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ①② GET / PUT /a/v1/llm-budgets
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("WO-BEFE-F ①② LLM 成本配额（GET/PUT /a/v1/llm-budgets）", () => {
  let seen: SeenReq[];
  beforeEach(() => {
    seen = [];
    server.use(spy(seen, "get", "*/a/v1/llm-budgets"), spy(seen, "put", "*/a/v1/llm-budgets"));
    loginAs("planner"); // roles 含 admin + tenant_admin ⇒ 过 AdminGuard("llm-providers")
  });
  afterEach(() => cleanup());

  it("真 route /admin/llm-providers → 成本配额 Tab 打真 GET，屏上是后端回的那三个数", async () => {
    const user = userEvent.setup();
    renderApp("/admin/llm-providers");
    await user.click(await screen.findByTestId("tab-budget"));

    const panel = await screen.findByTestId("llm-budget-panel");
    await waitFor(() => expect(within(panel).getByTestId("llm-budget-used")).not.toBeEmptyDOMElement());

    // 打的是真 URL、真方法 —— 不是「某个函数被调用了」。
    expect(
      seen.filter((r) => r.method === "GET" && r.path === "/a/v1/llm-budgets"),
      "GET /a/v1/llm-budgets 一次都没打出去 ⇒ 端点仍是零调用方",
    ).toHaveLength(1);

    // 屏上数字来自后端 seed（8,000,000 / 80% ⇒ 软线 6,400,000 / 已用 5,120,000 ⇒ OK）。
    expect(within(panel).getByTestId("llm-budget-used")).toHaveTextContent("5,120,000");
    expect(within(panel).getByTestId("llm-budget-hard")).toHaveTextContent("8,000,000");
    expect(within(panel).getByTestId("llm-budget-soft")).toHaveTextContent("6,400,000");
    expect(within(panel).getByTestId("llm-budget-state")).toHaveTextContent("正常");
    expect(within(panel).queryByTestId("llm-budget-degrade")).toBeNull();
  });

  it("改硬线 → 真 PUT（body 带 hardLimitTokens）→ 后端重算 state，屏上从「正常」翻到「已过软线」", async () => {
    const user = userEvent.setup();
    renderApp("/admin/llm-providers");
    await user.click(await screen.findByTestId("tab-budget"));
    const panel = await screen.findByTestId("llm-budget-panel");
    await waitFor(() => expect(within(panel).getByTestId("llm-budget-state")).toHaveTextContent("正常"));

    // 硬线压到 6,000,000 ⇒ 软线 4,800,000 ≤ 已用 5,120,000 < 硬线 ⇒ SOFT_EXCEEDED。
    await user.clear(within(panel).getByTestId("llm-budget-hard-input"));
    await user.type(within(panel).getByTestId("llm-budget-hard-input"), "6000000");
    await user.click(within(panel).getByTestId("llm-budget-save"));

    await waitFor(() => {
      expect(within(panel).getByTestId("llm-budget-state"), "state 没翻档 ⇒ PUT 要么没打出去、要么回值没被读").toHaveTextContent("已过软线");
    });
    // 降级提示同步出现（`degrade` 是后端算的，不是前端猜的）。
    expect(within(panel).getByTestId("llm-budget-degrade")).toBeInTheDocument();
    expect(within(panel).getByTestId("llm-budget-soft")).toHaveTextContent("4,800,000");

    const put = seen.filter((r) => r.method === "PUT" && r.path === "/a/v1/llm-budgets");
    expect(put, "PUT /a/v1/llm-budgets 没打出去").toHaveLength(1);
    expect(put[0]!.body).toMatchObject({ hardLimitTokens: 6000000 });
  });

  it("诚实位：`POST /a/v1/llm-budgets/record` 属服务间记账口，前端生产代码不得有调用方", () => {
    const src = readRepoFile("../src/api/endpoints.ts");

    /**
     * 判据只认 **URL 字面量**：引号/反引号**紧挨着**路径开头（`api.a("/a/v1/…")` /
     * 模板串 `` `/a/v1/…${x}` `` 都是这个形状），散文与注释不算。
     *
     * ⚠ 这条正则的**第一版写宽了**（`["'`][^"'`]*` 允许引号与路径之间隔任意字符），
     * 结果把本文件旁边那句注释里的 `` `POST /a/v1/llm-budgets/record` `` 当成了调用 —— 自己咬自己。
     * 「注释里提了一嘴」和「代码里调了」是两件事，判据必须能分开（同 CLAUDE.md「提及 ≠ 读取」）。
     */
    const CALL_RE = /["'`]\/a\/v1\/llm-budgets\/record/;

    // 双向金丝雀（铁律 0.6）：
    // ① 正向 —— 同款判据必须认得出**真的调用**（否则否定结论是空胜）。
    expect(
      CALL_RE.test('export const x = () => api.a("/a/v1/llm-budgets/record", { body });'),
      "判据认不出真实调用形态 ⇒ **判据坏了**，下面那条「没有调用方」不许被相信",
    ).toBe(true);
    // ② 反向 —— 判据必须**不**把注释/散文当调用。
    expect(
      CALL_RE.test("// ⚠ `POST /a/v1/llm-budgets/record` 故意不接：服务间记账口"),
      "判据把注释当成调用 ⇒ 恒红，同样不可信",
    ).toBe(false);
    // ③ 读法自证：这份源码确实读到了、且确实含已知存在的那两条 budget 端点。
    expect(src.length, "endpoints.ts 读出来是空的 ⇒ 读法坏了").toBeGreaterThan(1000);
    expect(src, "金丝雀不中 ⇒ 读法坏了，否定结论没有资格被相信").toContain('"/a/v1/llm-budgets"');

    // 真判据。
    expect(CALL_RE.test(src), "前端出现了 llm-budgets/record 调用 ⇒ 浏览器可伪造 token 计数，账本失去可信度").toBe(
      false,
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ③④⑤ POST /a/v1/kb/search · /a/v1/kb/:connId/docs · /a/v1/kb/:connId/sync
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("WO-BEFE-F ③④⑤ 知识库（kb/search · kb/:connId/docs · kb/:connId/sync）", () => {
  let seen: SeenReq[];
  beforeEach(() => {
    seen = [];
    server.use(
      spy(seen, "post", "*/a/v1/kb/search"),
      spy(seen, "post", "*/a/v1/kb/:connId/docs"),
      spy(seen, "post", "*/a/v1/kb/:connId/sync"),
    );
    loginAs("planner");
  });
  afterEach(() => cleanup());

  it("真 route /admin/connections → 上传文档(真 POST docs) → 检索(真 POST search)命中它 → 重嵌(真 POST sync)", async () => {
    const user = userEvent.setup();
    renderApp("/admin/connections");
    const panel = await screen.findByTestId("kb-panel");

    // ④ 入库：走真 <input type=file> —— 用户真做得到的那个动作。
    const file = new File(["换型时间按标准工时表折算，单次换型 45 分钟。"], "工艺规范.txt", { type: "text/plain" });
    await user.upload(within(panel).getByTestId("kb-file-input"), file);
    await waitFor(() => expect(within(panel).getByTestId("kb-ingest-result")).toHaveTextContent("工艺规范.txt"));

    const docs = seen.filter((r) => r.method === "POST" && /\/a\/v1\/kb\/[^/]+\/docs$/.test(r.path));
    expect(docs, "POST /a/v1/kb/:connId/docs 没打出去").toHaveLength(1);
    expect(docs[0]!.path, "connId 必须是真的 knowledge_base 连接，不是硬编码").toBe("/a/v1/kb/conn-kb/docs");
    expect(docs[0]!.body).toMatchObject({ filename: "工艺规范.txt" });
    // 明文文件内容以 base64 传输（后端 RuleDocJsonSchema 分支），不是裸串。
    expect((docs[0]!.body as { contentBase64?: string }).contentBase64, "contentBase64 缺失 ⇒ 后端 parseBody 会 400").toBeTruthy();

    // ③ 检索：命中刚入库那篇 —— 「上传了」和「搜得到」是两件事，这里一起验。
    await user.type(within(panel).getByTestId("kb-search-input"), "换型");
    await user.click(within(panel).getByTestId("kb-search-btn"));
    await waitFor(() => expect(within(panel).getByTestId("kb-search-results")).toBeInTheDocument());
    await waitFor(() => {
      expect(
        within(panel).queryByTestId("kb-search-empty"),
        "检索零命中 ⇒ 要么 search 没打出去，要么 connId 传错搜到了别的库",
      ).toBeNull();
    });
    expect(within(panel).getByTestId("kb-search-results")).toHaveTextContent("换型时间按标准工时表折算");

    const searches = seen.filter((r) => r.method === "POST" && r.path === "/a/v1/kb/search");
    expect(searches.length, "POST /a/v1/kb/search 没打出去").toBeGreaterThanOrEqual(1);
    expect(searches.at(-1)!.body).toMatchObject({ query: "换型", connId: "conn-kb" });

    // ⑤ 重嵌：回报的篇数/切块数要落到屏上（不是 fire-and-forget）。
    await user.click(within(panel).getByTestId("kb-sync-btn"));
    await waitFor(() => expect(within(panel).getByTestId("kb-sync-result")).toHaveTextContent("重嵌 1 篇"));
    expect(
      seen.filter((r) => r.method === "POST" && r.path === "/a/v1/kb/conn-kb/sync"),
      "POST /a/v1/kb/:connId/sync 没打出去",
    ).toHaveLength(1);
  });

  it("「搜全部知识库」勾选 → 请求里不带 connId（跨库检索是另一条语义，不许悄悄限死在当前库）", async () => {
    const user = userEvent.setup();
    renderApp("/admin/connections");
    const panel = await screen.findByTestId("kb-panel");

    await user.click(within(panel).getByTestId("kb-scope-all"));
    await user.type(within(panel).getByTestId("kb-search-input"), "换型");
    await user.click(within(panel).getByTestId("kb-search-btn"));

    await waitFor(() => expect(seen.filter((r) => r.path === "/a/v1/kb/search").length).toBeGreaterThanOrEqual(1));
    expect(seen.filter((r) => r.path === "/a/v1/kb/search").at(-1)!.body).not.toHaveProperty("connId");
  });

  it("诚实位：租户没有 knowledge_base 连接 ⇒ KB 面板整块不渲染（不是渲染一个永远空的壳）", async () => {
    const saved = db.connections.slice();
    db.connections = db.connections.filter((c) => c.connectorTypeKey !== "knowledge_base");
    try {
      renderApp("/admin/connections");
      // 等页面真渲染出来（否则「没找到」只是还没渲染，是假阴）。
      await screen.findByTestId("conn-conn-erp");
      expect(screen.queryByTestId("kb-panel")).toBeNull();
    } finally {
      db.connections = saved;
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ⑥ GET /b/v1/resources/:kind/:key
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("WO-BEFE-F ⑥ 单资源详情（GET /b/v1/resources/:kind/:key）", () => {
  let seen: SeenReq[];
  beforeEach(() => {
    seen = [];
    server.use(spy(seen, "get", "*/b/v1/resources/:kind/:key"));
    db.tenantOverrides["qos.dril-routing"] = true; // entitlement 先于 authz：关则 404，这里开出来
    loginAs("planner");
  });
  afterEach(() => {
    delete db.tenantOverrides["qos.dril-routing"];
    cleanup();
  });

  it("真 route /admin/resources → 点资源行 → 打真 GET 详情，屏上出现**只有详情端点才下发**的字段", async () => {
    const user = userEvent.setup();
    renderApp("/admin/resources");
    await user.click(await screen.findByTestId("resource-row-capacity_forecast"));

    const detail = await screen.findByTestId("resource-detail");
    // 判据是「屏上多了列表给不出的东西」，不是「函数被调过」：
    // mock 列表刻意不下发 capability/正负问句，只有 GET :kind/:key 才有（handlers.ts DRIL_RESOURCES）。
    await waitFor(() => expect(within(detail).getByTestId("resource-capability")).toBeInTheDocument());
    expect(within(detail).getByTestId("resource-capability")).toHaveTextContent("算出产能满足度与主瓶颈工序");
    expect(within(detail).getByTestId("resource-questions")).toHaveTextContent("下季度 A 型号产能够不够？");
    expect(detail).toHaveAttribute("data-detail-source", "endpoint");

    const hit = seen.filter((r) => r.method === "GET" && r.path === "/b/v1/resources/solver/capacity_forecast");
    expect(hit, "GET /b/v1/resources/:kind/:key 没打出去 ⇒ 详情仍吃列表旧投影（无 overlayQuality）").toHaveLength(1);
  });

  it("详情端点 404 → 退回列表投影（面板不空白、也不假装有新数据）", async () => {
    server.use(
      http.get("*/b/v1/resources/:kind/:key", () =>
        HttpResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "gone", requestId: "t" } }, { status: 404 }),
      ),
    );
    const user = userEvent.setup();
    renderApp("/admin/resources");
    await user.click(await screen.findByTestId("resource-row-capacity_forecast"));

    const detail = await screen.findByTestId("resource-detail");
    await waitFor(() => expect(detail).toHaveAttribute("data-detail-source", "list-seed"));
    expect(detail, "退化态也必须还看得见资源本身").toHaveTextContent("产能推演");
    expect(within(detail).queryByTestId("resource-capability"), "404 了还显示 capability ⇒ 那是编的").toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 安全红线 · no-secrets-echo 的**机器判据**
 *
 * 本仓铁律：凭据 AES-GCM 加密落库（`CREDENTIAL_KEY`），任何响应不回显明文，仅 `credentialRef`
 * / `hasApiKey`。前端侧的对应义务有三条，且**都必须由机器盯着**，不能靠「我写代码时注意了」：
 *   (a) 不得把明文 key 显示回屏 —— **哪怕后端不小心回了**；
 *   (b) 不得把明文写进 mock fixture / 测试快照；
 *   (c) 表单只能「写入新值」，不能「读回现值」。
 *
 * 下面这组用例就是那台机器。核心设计是**双向金丝雀**（铁律 0.6）：
 *   · 正向：故意让后端回四种明文形态 → 断言 DOM（含 input.value）里一个都不出现；
 *   · 反向：拿一个**故意把明文渲染出来的对照组件**喂给同一个探测器 → 它必须报红。
 * 只有正向的探测器可能是**恒真**的（比如探测器自己写错了、永远找不到东西），那样上面那条
 * 「屏上没有明文」就是空胜。反向那条把这种可能性钉死：探测器一旦失灵，反向用例先红。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 四种明文凭据形态（覆盖 provider/连接器两条线上真实会出现的字段名与串形）。 */
const PLAINTEXT_SECRETS = {
  apiKey: "sk-live-DO-NOT-ECHO-0123456789abcdef",
  credential: "AKIA-DO-NOT-ECHO-SECRET-TOKEN",
  apiKeyCiphertext: "ciphertext-DO-NOT-ECHO-deadbeef",
  password: "P@ssw0rd-DO-NOT-ECHO",
} as const;

/**
 * 明文泄漏探测器。**必须同时扫两处**：
 *   ① `document.body.innerHTML` —— 文本节点 + 属性（`value=` 写死的、`title`、`data-*`）；
 *   ② 所有 `input`/`textarea` 的 **`.value` 属性** —— React 受控输入的当前值**不进 innerHTML**，
 *      只扫 ① 会把「密钥被回填进输入框」这种最典型的泄漏整个漏掉（本探测器的存在理由）。
 * 返回命中的形态名数组（空 = 干净）。
 */
function detectPlaintextLeaks(root: HTMLElement = document.body): string[] {
  const html = root.innerHTML;
  const fieldValues = [...root.querySelectorAll("input, textarea")]
    .map((el) => (el as HTMLInputElement | HTMLTextAreaElement).value ?? "")
    .join("\n");
  const haystack = `${html}\n${fieldValues}`;
  return Object.entries(PLAINTEXT_SECRETS)
    .filter(([, secret]) => haystack.includes(secret))
    .map(([name]) => name);
}

describe("WO-BEFE-F · 安全红线 no-secrets-echo（机器判据 + 双向金丝雀）", () => {
  afterEach(() => cleanup());

  it("反向金丝雀：把明文渲染出来的对照组件，探测器**必须**报红（否则上面所有「没泄漏」都是空胜）", () => {
    // 这不是被测代码，是**测探测器的**——一个故意泄漏的最小对照组。
    const probe = document.createElement("div");
    probe.innerHTML = `<span>${PLAINTEXT_SECRETS.apiKey}</span>`;
    document.body.appendChild(probe);
    try {
      expect(
        detectPlaintextLeaks(probe),
        "探测器对着明文都报不出来 ⇒ **探测器坏了**，不许读作「代码干净」（铁律 0.6）",
      ).toContain("apiKey");
    } finally {
      probe.remove();
    }

    // 第二只金丝雀：受控 input 的 .value 不进 innerHTML —— 只扫 HTML 的探测器会漏掉它。
    const probe2 = document.createElement("div");
    const input = document.createElement("input");
    input.value = PLAINTEXT_SECRETS.credential;
    probe2.appendChild(input);
    document.body.appendChild(probe2);
    try {
      expect(probe2.innerHTML, "前提自证：明文确实不在 innerHTML 里，所以必须单独扫 .value").not.toContain(
        PLAINTEXT_SECRETS.credential,
      );
      expect(detectPlaintextLeaks(probe2), "探测器没扫 input.value ⇒ 最典型的「密钥回填输入框」会漏报").toContain(
        "credential",
      );
    } finally {
      probe2.remove();
    }

    // 反向的反向：干净 DOM 上必须**不**报红（恒真的探测器同样是坏的）。
    const clean = document.createElement("div");
    clean.innerHTML = "<span>••• 已配置</span>";
    document.body.appendChild(clean);
    try {
      expect(detectPlaintextLeaks(clean), "干净 DOM 上也报红 ⇒ 探测器恒真，同样不可信").toEqual([]);
    } finally {
      clean.remove();
    }
  });

  it("(a) 后端**故意**回显四种明文 → LLM Provider 页 DOM/输入框里一个都不许出现", async () => {
    // ⚠ 这是变异反证的常驻版：模拟「后端不小心回了明文」。前端的义务是**即便如此也不渲染**。
    server.use(
      http.get("*/a/v1/llm-providers", () =>
        HttpResponse.json([
          {
            id: "llmp-leak",
            tenantId: "demo",
            name: "泄漏探针 Provider",
            kind: "openai_compatible",
            baseUrl: "https://api.example.com/v1",
            models: [{ modelId: "m1", displayName: "M1", capabilities: { tools: true, structuredOutput: true, maxContext: 128000 } }],
            status: "ACTIVE",
            hasApiKey: true,
            ...PLAINTEXT_SECRETS, // apiKey / credential / apiKeyCiphertext / password 全塞进响应
          },
        ]),
      ),
    );
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/llm-providers");

    // 列表态：只许出现「••• 已配置」这种存在性标记。
    await screen.findByTestId("provider-llmp-leak");
    expect(screen.getByTestId("provider-key-llmp-leak")).toHaveTextContent("已配置");
    expect(detectPlaintextLeaks(), "列表页把后端回的明文渲染出来了 —— 违反 no-secrets-echo").toEqual([]);

    // 编辑态（最危险的一屏：表单最容易「读回现值」）。
    await user.click(screen.getByTestId("provider-edit-llmp-leak"));
    await screen.findByText(/API 密钥/);
    expect(detectPlaintextLeaks(), "编辑器把明文回填进了表单 —— 违反 no-secrets-echo (c)").toEqual([]);
  });

  it("(c) 表单只写不读：已配置的 provider，密钥输入框默认**不存在**；点「更换」出来的也是空的 password 框", async () => {
    server.use(
      http.get("*/a/v1/llm-providers", () =>
        HttpResponse.json([
          {
            id: "llmp-leak",
            tenantId: "demo",
            name: "泄漏探针 Provider",
            kind: "openai_compatible",
            baseUrl: "https://api.example.com/v1",
            models: [],
            status: "ACTIVE",
            hasApiKey: true,
            ...PLAINTEXT_SECRETS,
          },
        ]),
      ),
    );
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/llm-providers");
    await user.click(await screen.findByTestId("provider-edit-llmp-leak"));
    await screen.findByText(/API 密钥/);

    // 「读回现值」的形态：一个已经带着值的密钥框。这里必须要么没有框，要么框是空的。
    const keyInput = screen.queryByLabelText("API 密钥") as HTMLInputElement | null;
    if (keyInput) {
      expect(keyInput.value, "密钥框带着值出场 = 读回现值，违反 (c)").toBe("");
      expect(keyInput.type, "密钥框必须是 password 型").toBe("password");
    }
    expect(detectPlaintextLeaks()).toEqual([]);
  });

  it("(b) mock fixture / 本文件本身不得含明文凭据形态（写进 fixture = 泄漏进仓库）", () => {
    const files = ["../src/mocks/fixtures.ts", "../src/mocks/db.ts", "../src/mocks/handlers.ts"].map((p) => ({
      path: p,
      src: readRepoFile(p),
    }));

    // 金丝雀：先证「这个读法真的读到了内容」（否则「没找到明文」只是文件读空了）。
    for (const f of files) {
      expect(f.src.length, `${f.path} 读出来是空的 ⇒ 读法坏了，下面的否定结论作废`).toBeGreaterThan(1000);
    }
    // 已知必中样例：handlers.ts 里确实写了 hasApiKey（证明这套 includes 判定在真源码上有效）。
    expect(files.find((f) => f.path.endsWith("handlers.ts"))!.src, "金丝雀不中 ⇒ 工具坏了").toContain("hasApiKey");

    // 真判据：三份 mock 源码里不许出现明文凭据形态（`sk-` 开头的真串 / 本文件那四个哨兵）。
    for (const f of files) {
      for (const [name, secret] of Object.entries(PLAINTEXT_SECRETS)) {
        expect(f.src, `${f.path} 含明文凭据形态 ${name}`).not.toContain(secret);
      }
      expect(/["'`]sk-[A-Za-z0-9_-]{16,}["'`]/.test(f.src), `${f.path} 含疑似真实 API key 串`).toBe(false);
    }
  });
});
