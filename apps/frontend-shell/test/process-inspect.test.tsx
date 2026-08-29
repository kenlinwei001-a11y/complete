import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProcessInspectResponseSchema, SLICE_LAYER_IDS } from "@platform/contracts";
import { zh } from "@/locales/zh";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";
import REAL from "./fixtures/process-inspect-real.json";

/**
 * WO-V4-INSPECT · 流程节点检视面板（PRD-sandbox-v4-backward-derivation §4.2）。
 *
 * ⚠ **2026-08-14 已知过期点（WO-R9-PROCESS-MERGE 登记，刻意不手改）**：
 * 本文件的录制 fixture 里 `runtime.reason` 仍是那句
 * 「`ProcessTask` / `ProcessInstance` 两个承载物**全仓不存在**」。
 * 那句话**在服务端已经被改掉了**（`apps/datacore/src/process/inspect.ts` —— 承载物已落地，
 * 缺席理由改成「本投影是定义层，运行态去哪儿答」）。这里没有跟着改，是因为：
 *  · 它是**录制**不是编造的样本，手改一行就不再是录制，而"看起来像录制的手写件"比过期更危险；
 *  · 它**没有接进 mock 模式的 UI**（实测：`grep -rn process-inspect-real apps/frontend-shell/src`
 *    零命中；金丝雀 —— 同命令对 `processWaitFixtures` 命中 `src/mocks/handlers.ts`，
 *    证明是真没接线不是 grep 坏了），故不会让任何用户看到那句过期的话。
 * ⇒ 处置是**重新录制**（起 `SEED_DEMO=1` 真后端重跑那三条），列为交回报告里的遗留项，不在本单夹带。
 * 下方两条断言只咬 `toContain("ProcessTask")` 与清单条数，故新旧文案都过 —— 它们没有在替过期文案背书。
 *
 * ══ fixture 是**真后端录制**，不是编的 ═══════════════════════════════════════
 * `test/fixtures/process-inspect-real.json` 三条录制全部来自 `SEED_DEMO=1` 的真 datacore
 * （`GET /a/v1/process-definitions/{key}/inspect`，`X-Debug-User: demo:admin:admin`）：
 *   · `P32` 物料平衡（MRP）运行 —— 承载 `MaterialBalance`，含**派生属性** `coverage`
 *     与打到它的杠杆 `MaterialBalance.coverage`（本单同批修好的那条死杠杆）
 *   · `P37` 主生产计划（MPS）—— 承载 `ProductionSchedule`，**有同承载物流程**（`P40`）与一跳关系
 *   · `P32-ABSENT-PROBE` —— 把 P32 的 `carrierTypeKey` 临时改成一个不存在的类型、
 *     重启真后端录下来的响应（**承载类型解析不到**那一态的真样本，不是手写的假 JSON）
 * 每条录制在下面都先过一次 `ProcessInspectResponseSchema.parse` ——
 * 契约一改，录制过期即当场红，不会出现「mock 悄悄与真后端分家、测试照样绿」。
 *
 * ══ 咬的是**链路**不是组件 ═══════════════════════════════════════════════════
 * 断言从 URL 出发（`renderApp("/v/process-wait")` → 点行 → 面板出现），
 * 不用 `getRenderer(key)` 直接取组件渲染 —— 那样只证明「拿到组件能画」，
 * 不证明「有任何路径能让你拿到它」（假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`）。
 */

const T = zh.processWait.inspect;
const RECORDINGS = REAL as Record<string, unknown>;

/**
 * 注册 inspect 路由的 handler：按 key 取录制；没有录制的 key 一律 404，**不拿别的数据顶包**。
 * ⚠ 函数名不许以 `use` 开头 —— eslint 的 `react-hooks/rules-of-hooks` 会把它当 React Hook 判红。
 */
function installInspectHandler(map: Record<string, unknown>) {
  server.use(
    http.get("*/a/v1/process-definitions/:key/inspect", ({ params }) => {
      const body = map[String(params.key)];
      if (!body) return HttpResponse.json({ error: { code: "NOT_FOUND", message: "no recording", requestId: "req_test" } }, { status: 404 });
      return HttpResponse.json(body);
    }),
  );
}

async function openPanel(processKey: string, recording: unknown) {
  installInspectHandler({ [processKey]: recording });
  loginAs("planner");
  renderApp("/v/process-wait");
  // ⚠ 2026-08-19 WO-TIMEOUT-5000-SWEEP：findBy 预算 5s→20s（共享机高负载假红，同型见 c9ff5936f）；判据未动。
  const btn = await screen.findByTestId(`pw-inspect-${processKey}`, undefined, { timeout: 20000 });
  await userEvent.click(btn);
  return await screen.findByTestId("pi-panel", undefined, { timeout: 20000 });
}

describe("WO-V4-INSPECT · §0 金丝雀（否定结论之前先自证 fixture 是真的）", () => {
  it("三条录制都过真契约 schema，且各自覆盖一个**不同**的形态（present / 同承载物 / absent）", () => {
    // 录制不为空 —— 否则下面每一条断言都在空对象上跑，恒真恒绿
    expect(Object.keys(RECORDINGS).length).toBeGreaterThan(2);
    for (const body of Object.values(RECORDINGS)) {
      const parsed = ProcessInspectResponseSchema.parse(body); // 契约漂移 ⇒ 这里当场炸
      expect(parsed.process.key.length).toBeGreaterThan(0);
    }
    const p32 = ProcessInspectResponseSchema.parse(RECORDINGS.P32);
    const p37 = ProcessInspectResponseSchema.parse(RECORDINGS.P37);
    const absent = ProcessInspectResponseSchema.parse(RECORDINGS["P32-ABSENT-PROBE"]);
    // 形态互不重叠 —— 三条都长一样的话，"覆盖三种态"就是句空话
    expect(p32.carrier.status).toBe("present");
    expect(p32.levers.length).toBeGreaterThan(0);
    expect(p37.sharedCarrierProcesses.length).toBeGreaterThan(0);
    expect(absent.carrier.status).toBe("absent");
  });
});

describe("WO-V4-INSPECT · §A 可达（从 URL 出发，不是直接 new 组件）", () => {
  it("打开 /v/process-wait → 点一行 → 检视面板真渲染出来，并带出流程静态属性", async () => {
    const panel = await openPanel("P32", RECORDINGS.P32);
    const d = ProcessInspectResponseSchema.parse(RECORDINGS.P32);
    expect(within(panel).getByTestId("pi-name")).toHaveTextContent(d.process.name);
    // 域名/职能名来自响应，不是前端字面量
    expect(within(panel).getByTestId("pi-domain")).toHaveTextContent(d.process.domainName!);
    expect(within(panel).getByTestId("pi-owner")).toHaveTextContent(d.process.ownerFunctionName!);
    expect(within(panel).getByTestId("pi-carrierkey")).toHaveTextContent(d.carrier.typeKey);
    // 整条墙钟预算同理上调（WO-TIMEOUT-5000-SWEEP）：renderApp+懒加载链路在共享机负载下会超全局 20s。
  }, 60000);

  it("没点开时不渲染面板（只给一句提示）—— 空面板与「还没点」在屏上必须分得开", async () => {
    installInspectHandler({});
    loginAs("planner");
    renderApp("/v/process-wait");
    expect(await screen.findByTestId("pw-inspect-hint", undefined, { timeout: 20000 })).toHaveTextContent(T.openHint);
    expect(screen.queryByTestId("pi-panel")).toBeNull();
  }, 60000);
});

describe("WO-V4-INSPECT · §B 承载物本体关系（属性 / 派生 / 一跳关系 / 同承载物）", () => {
  it("承载类型 present：属性逐条渲染，中文名与单位来自响应，派生属性带记号且摆出公式", async () => {
    const panel = await openPanel("P32", RECORDINGS.P32);
    const d = ProcessInspectResponseSchema.parse(RECORDINGS.P32);
    expect(d.carrier.properties.length).toBeGreaterThan(4); // 基数下限：够多才谈得上"逐条渲染"
    for (const p of d.carrier.properties) {
      const row = within(panel).getByTestId(`pi-prop-${p.propKey}`);
      // 中文名有就显中文名；没有就显「未登记中文名」——两种都不许留空白
      if (p.displayName !== null) expect(row).toHaveTextContent(p.displayName);
      else expect(row).toHaveTextContent(T.propTable.noZhName);
      expect(row).toHaveAttribute("data-derived", p.derived ? "1" : "0");
    }
    // 派生属性：本单修好的那条死杠杆落点，必须被标成派生并把公式摆出来（公式即口径）
    expect(d.carrier.derivedProperties.length).toBeGreaterThan(0);
    for (const x of d.carrier.derivedProperties) {
      expect(within(panel).getByTestId(`pi-derived-${x.propKey}`)).toHaveTextContent(T.propTable.derived);
      expect(within(panel).getByTestId(`pi-formula-${x.propKey}`)).toHaveTextContent(x.formula);
    }
  }, 60000);

  it("同承载物流程 + 一跳关系：P37 的反查非空（先证有再断言），方向与基数都画出来", async () => {
    const d = ProcessInspectResponseSchema.parse(RECORDINGS.P37);
    // 先证有：这条录制里确实存在共用承载物的流程与一跳关系，否则下面是空断言
    expect(d.sharedCarrierProcesses.length).toBeGreaterThan(0);
    expect(d.relations.length).toBeGreaterThan(0);

    const panel = await openPanel("P37", RECORDINGS.P37);
    for (const s of d.sharedCarrierProcesses) {
      const li = within(panel).getByTestId(`pi-sibling-${s.key}`);
      expect(li).toHaveTextContent(s.name);
      expect(li).toHaveTextContent(s.domainName!); // 域名随响应下发（R14）
    }
    for (const r of d.relations) {
      const li = within(panel).getByTestId(`pi-rel-${r.linkKey}`);
      expect(li).toHaveAttribute("data-direction", r.direction);
      expect(li).toHaveTextContent(r.cardinality); // 基数是关系的一等信息，不许省
      expect(li).toHaveTextContent(r.neighborTypeKey);
    }
  }, 60000);

  it("空集合要说话：P32 的一跳关系与同承载物流程都是 0，界面各给一句，不是一片空白", async () => {
    const d = ProcessInspectResponseSchema.parse(RECORDINGS.P32);
    expect(d.relations.length).toBe(0); // 先钉住这条录制确实是空的（否则下面测的不是空态）
    expect(d.sharedCarrierProcesses.length).toBe(0);
    const panel = await openPanel("P32", RECORDINGS.P32);
    expect(within(panel).getByTestId("pi-relations-empty")).toHaveTextContent(T.relations.empty);
    expect(within(panel).getByTestId("pi-shared-empty")).toHaveTextContent(T.shared.empty);
  }, 60000);
});

describe("WO-V4-INSPECT · §C 诚实位（本页答不了什么 · 不拿标准工期冒充实测卡顿）", () => {
  it("运行态诚实位：available=0 + 后端下发的原因 + 答不了的问题清单，全部显示出来", async () => {
    const panel = await openPanel("P32", RECORDINGS.P32);
    const d = ProcessInspectResponseSchema.parse(RECORDINGS.P32);
    const rt = within(panel).getByTestId("pi-runtime");
    expect(rt).toHaveAttribute("data-runtime-available", "0");
    expect(within(panel).getByTestId("pi-runtime-reason")).toHaveTextContent("ProcessTask");
    const list = within(panel).getByTestId("pi-unanswerable");
    expect(d.runtime.unanswerable.length).toBeGreaterThan(2);
    for (const q of d.runtime.unanswerable) expect(list).toHaveTextContent(q);
  }, 60000);

  it("工期口径由**后端下发**（前端不写第二份可能过期的说明），且明说不是实测卡顿", async () => {
    const panel = await openPanel("P32", RECORDINGS.P32);
    const d = ProcessInspectResponseSchema.parse(RECORDINGS.P32);
    const cap = within(panel).getByTestId("pi-stddays-caption");
    expect(cap).toHaveTextContent(d.runtime.stdDurationCaption);
    expect(cap).toHaveTextContent("标准工期");
    // 反向判据：口径句里必须**否认**它是实测。只断言"显示了工期"是不够的
    expect(d.runtime.stdDurationCaption).toContain("不是实测");
    // 数字本身照原样挂在 data 属性上（不四舍五入，门要能断言精确工期）
    expect(within(panel).getByTestId("pi-stddays")).toHaveAttribute("data-std-days", String(d.runtime.stdDurationDays));
  }, 60000);
});

describe("WO-V4-INSPECT · §D 承载类型解析不到（absent 一向 —— 真后端录制）", () => {
  it("absent：显示缺在哪一环，十六层不画空壳，而流程静态属性照样完整", async () => {
    const d = ProcessInspectResponseSchema.parse(RECORDINGS["P32-ABSENT-PROBE"]);
    expect(d.carrier.status).toBe("absent"); // 先钉住这条录制真是 absent 那一向
    const panel = await openPanel("P32", RECORDINGS["P32-ABSENT-PROBE"]);

    expect(within(panel).getByTestId("pi-carrier")).toHaveAttribute("data-carrier-status", "absent");
    expect(within(panel).getByTestId("pi-carrier-absent")).toHaveTextContent(d.carrier.absentReason!);
    // 十六层：没算就说没算，不画 16 个空格子
    expect(within(panel).getByTestId("pi-layers-absent")).toHaveTextContent(d.carrierLayersAbsentReason!);
    expect(within(panel).queryByTestId("pi-layer-object")).toBeNull();
    // 承载物缺席不该把整页拖垮
    expect(within(panel).getByTestId("pi-name")).toHaveTextContent(d.process.name);
  }, 60000);
});

describe("WO-V4-INSPECT · §E 十六层三态 + §4.1 杠杆→域映射", () => {
  it("十六层：恰好 16 层按序渲染，三态各有各的说法（不合并成有/无）", async () => {
    const panel = await openPanel("P32", RECORDINGS.P32);
    const d = ProcessInspectResponseSchema.parse(RECORDINGS.P32);
    expect(d.carrierLayers).not.toBeNull();
    expect(d.carrierLayers!.layers.length).toBe(16);
    // 层 id 与契约词表逐一对齐（前端不另存一份层清单）
    expect(d.carrierLayers!.layers.map((l) => l.id)).toEqual([...SLICE_LAYER_IDS]);
    const seen = new Set<string>();
    for (const l of d.carrierLayers!.layers) {
      const li = within(panel).getByTestId(`pi-layer-${l.id}`);
      expect(li).toHaveAttribute("data-status", l.status);
      expect(within(panel).getByTestId(`pi-layer-status-${l.id}`)).toHaveTextContent(T.layerStatus[l.status]!);
      seen.add(l.status);
    }
    // 这条录制里至少出现两种态 —— 只有一种态的话，"三态可辨"这条根本没被测到
    expect(seen.size).toBeGreaterThan(1);
  }, 60000);

  it("杠杆→域：标签/单位/落点/打到哪几个域全部来自响应，前端零写死", async () => {
    const d = ProcessInspectResponseSchema.parse(RECORDINGS.P32);
    expect(d.levers.length).toBeGreaterThan(0); // 先证有
    const panel = await openPanel("P32", RECORDINGS.P32);
    for (const l of d.levers) {
      const li = within(panel).getByTestId(`pi-lever-${l.leverKey}`);
      expect(li).toHaveTextContent(l.label); // = LEVER_PROP_META.label 单源
      expect(li).toHaveAttribute("data-resolved", l.landingResolved ? "1" : "0");
      const reach = within(panel).getByTestId(`pi-lever-domains-${l.leverKey}`);
      for (const dm of l.domains) expect(reach).toHaveTextContent(dm.name ?? dm.key);
    }
    // 本单修好的那条曾经的死杠杆：它现在必须**解析得到**，且落在派生位上
    const cov = d.levers.find((l) => l.leverKey === "MaterialBalance.coverage");
    expect(cov).toBeDefined();
    expect(cov!.landingResolved).toBe(true);
  }, 60000);
});

describe("WO-V4-INSPECT · §F 零写死词表（R14）", () => {
  it("面板源码里不出现任何业务名词字面量（流程名/域名/类型名/属性中文名一律来自响应）", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "../src/views/process/ProcessInspectPanel.tsx"), "utf8");
    // 金丝雀：先证明我真读到了组件源码（读空文件的话，下面每条否定断言都恒真）
    expect(src.includes("ProcessInspectPanel")).toBe(true);
    expect(src.length).toBeGreaterThan(2000);
    // 取真录制里的业务名词去反查 —— 不是我凭空列一串"看着像业务词"的清单
    const d = ProcessInspectResponseSchema.parse(RECORDINGS.P32);
    const businessWords = [
      d.process.name,
      d.process.domainName!,
      d.process.ownerFunctionName!,
      d.carrier.displayName!,
      ...d.carrier.properties.map((p) => p.displayName).filter((x): x is string => x !== null),
      ...d.levers.map((l) => l.label),
    ];
    expect(businessWords.length).toBeGreaterThan(5); // 基数下限：词够多，这条否定断言才有意义
    for (const w of businessWords) expect(src.includes(w)).toBe(false);
    // 颜色也不许写死（三套皮全靠 tokens）
    const cssRaw = readFileSync(resolve(__dirname, "../src/views/process/ProcessInspectPanel.module.css"), "utf8");
    // ⚠ 必须先剥注释再扫：本文件的注释里就写着「不许出现 hex / rgb() / hsl()」——
    //   不剥注释的话，**门会被它自己的说明文字咬红**（第一版就是这么红的）。
    //   形态：「我用『文件里出现了这个串』当作『代码里用了这个颜色』的证据，而前者并不度量后者。」
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "");
    const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;
    expect(css.includes("var(--")).toBe(true); // 金丝雀①：确实读到了 CSS 正文（不是剥成空串）
    expect(COLOR_LITERAL.test("color: #a1b2c3;")).toBe(true); // 金丝雀②：正则真认得出颜色字面量
    expect(COLOR_LITERAL.test(css)).toBe(false);
  });
});
