import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  ProcessStepTemplateResponseSchema,
  tasksFromStepTemplate,
  type CreateProcessInstanceRequest,
  type ProcessStepTemplateResponse,
} from "@platform/contracts";
import { db } from "@/mocks/db";
import { loginAs, renderApp } from "./utils";

/**
 * WO-STEP-TEMPLATE-LAYER FE · **接缝测试**：从模板到实例，前端一步都不发明。
 *
 * ══ 这条接缝为什么必须从 URL 出发 ═════════════════════════════════════════
 *
 * `POST /a/v1/process-instances` 在 `befe-seam` 上挂了很久的「后端注册了·前端零调用」。
 * 消这条账的判据**不是**「前端有一个 `createProcessInstance()` 函数」——
 * 那正是基线台账里反复写着的「把一个死端点换成一个死客户端函数，纯为消红」。
 * 判据是：**从用户点得到的地方出发，真的把那个 POST 打出去了，而且它的 body 来自模板**。
 * 故本文件从 `/v/process-stuck` 这个 URL 渲染，不 `import` 组件直接渲染
 * （直接 import 只能证明「函数能跑」，证不了「接线了」—— 本仓 F2/F3/F4 连踩三次）。
 *
 * ══ 三条被咬住的纪律 ═══════════════════════════════════════════════════════
 *  ① 发出去的 `tasks` **逐条等于** `tasksFromStepTemplate(模板.steps)`（契约里唯一那处转换）；
 *  ② 没有模板的流程：屏上说清楚 + **启动按钮不渲染**（宁可少展示，不许造数）；
 *  ③ 组件源码里**不许出现**任何构造步名/责任职能的字面量（发明步骤的语法形态）。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "src");
const COMPONENT = join(SRC, "views", "process", "ProcessStartFromTemplate.tsx");

/** 网络桩：只桩这一条 POST（其余走 mock handlers，即 mock 模式下用户真会看到的那份数据）。 */
const net = vi.hoisted(() => ({
  posted: [] as CreateProcessInstanceRequest[],
  fail: null as unknown,
}));

vi.mock("@/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/endpoints")>();
  return {
    ...actual,
    createProcessInstance: vi.fn(async (body: CreateProcessInstanceRequest) => {
      net.posted.push(body);
      if (net.fail !== null) throw net.fail;
      return actual.createProcessInstance(body); // 真打到 mock handler，回显的步骤就是 body 里那份
    }),
  };
});

beforeEach(() => {
  net.posted = [];
  net.fail = null;
  vi.clearAllMocks();
  loginAs("planner");
  // `process.runtime` 是暗发键（defaultOn:false）⇒ 不开通则 /v/process-stuck 整页不可达。
  db.tenantOverrides["process.runtime"] = true;
});
afterEach(() => {
  delete db.tenantOverrides["process.runtime"];
});

/** 选中一条流程（下拉是真 DOM，不是 mock 的返回值 —— 走用户真会走的那条路）。 */
async function selectProcess(key: string) {
  const select = await screen.findByTestId("start-process-select");
  fireEvent.change(select, { target: { value: key } });
  return select;
}

// ══════════════════════════════════════════════════════════════════════════
// ① 🔴 头号断言 · 从 URL 出发，模板 → tasks → POST，逐条对得回模板
// ══════════════════════════════════════════════════════════════════════════

describe("WO-STEP-TEMPLATE-LAYER FE · 接缝①：按模板建实例，body 逐条来自模板", () => {
  it("/v/process-stuck 里选 P34 → 屏上出现模板步骤 → 点按钮 → POST 的 tasks 逐条等于模板", async () => {
    renderApp("/v/process-stuck");

    // 面板必须**经 URL** 渲染得到（不是 import 出来的）。
    await waitFor(() => expect(screen.getByTestId("start-from-template")).toBeTruthy());

    await selectProcess("P34");

    // ── 半边 A：模板真上屏（步名/责任职能都来自后端，前端零字面量）──
    await waitFor(() => expect(screen.getByTestId("start-steps")).toBeTruthy());
    const steps = screen.getAllByTestId("start-step");
    expect(steps.length, "P34 在 mock 里有 2 步模板").toBe(2);
    expect(steps[0]!.textContent).toContain("报关申报");
    expect(steps[1]!.textContent).toContain("海关查验与放行");
    // 工期合计 = 定义工期（步骤模板不新增总量），这句必须真上屏而不是只在契约里
    expect(screen.getByTestId("start-total").textContent).toContain("7 天");

    // ── 承载对象来自真实对象列表（不是让用户手填一个 id）──
    const carrier = await screen.findByTestId("start-carrier-select");
    expect((carrier as HTMLSelectElement).options.length).toBeGreaterThan(0);

    // ── 半边 B：真的把 POST 打出去 ──
    fireEvent.click(await screen.findByTestId("start-submit"));
    await waitFor(() => expect(net.posted.length).toBe(1));

    // 🔴 接缝断言：body 里的 tasks **逐条等于**「模板经契约那唯一一处转换」的结果。
    //    这里重新独立取一次模板再转换 —— 不复用组件算出来的那份，
    //    否则就是拿组件的输出证明组件的输出（自证）。
    const { fetchProcessStepTemplate } = await import("@/api/endpoints");
    const tpl: ProcessStepTemplateResponse = ProcessStepTemplateResponseSchema.parse(
      await fetchProcessStepTemplate("P34"),
    );
    expect(net.posted[0]!.definitionKey).toBe("P34");
    expect(net.posted[0]!.subjectRef.typeKey).toBe(tpl.carrierTypeKey);
    expect(net.posted[0]!.tasks).toEqual(tasksFromStepTemplate(tpl.steps));

    // ── 回显：建出来的实例，步骤逐条还是那几步 ──
    await waitFor(() => expect(screen.getByTestId("start-created")).toBeTruthy());
    const created = screen.getAllByTestId("start-created-task");
    expect(created.length).toBe(tpl.steps.length);
    for (const [i, s] of tpl.steps.entries()) {
      expect(created[i]!.textContent, `第 ${s.seq} 步`).toContain(s.name);
      expect(within(created[i]!).getByText(s.ownerFunctionKey)).toBeTruthy();
    }
  });

  it("变异反证：模板步名改一个字 ⇒ 上面那条 `toEqual` 必然不成立（证明它咬的是模板不是常量）", async () => {
    renderApp("/v/process-stuck");
    await waitFor(() => expect(screen.getByTestId("start-from-template")).toBeTruthy());
    await selectProcess("P34");
    await waitFor(() => expect(screen.getByTestId("start-steps")).toBeTruthy());
    fireEvent.click(await screen.findByTestId("start-submit"));
    await waitFor(() => expect(net.posted.length).toBe(1));

    const { fetchProcessStepTemplate } = await import("@/api/endpoints");
    const tpl = await fetchProcessStepTemplate("P34");
    const mutated = tpl.steps.map((s) => (s.seq === 1 ? { ...s, name: `${s.name}X` } : s));
    expect(net.posted[0]!.tasks).not.toEqual(tasksFromStepTemplate(mutated));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ② 🔴 没有模板的流程：说清楚 + 不给按钮（红线：宁可少展示，不许造数）
// ══════════════════════════════════════════════════════════════════════════

describe("WO-STEP-TEMPLATE-LAYER FE · 接缝②：没有模板就不给建，且说清为什么", () => {
  it("选 P17（无模板）⇒ 屏上出现缺席理由与可复跑探针，**启动按钮不存在**", async () => {
    renderApp("/v/process-stuck");
    await waitFor(() => expect(screen.getByTestId("start-from-template")).toBeTruthy());
    await selectProcess("P17");

    await waitFor(() => expect(screen.getByTestId("start-no-template")).toBeTruthy());
    // 缺席理由与探针必须是**后端下发的字段**（前端写死的诚实位会随改版蒸发）。
    expect(screen.getByTestId("start-absent-reason").textContent!.length).toBeGreaterThan(20);
    expect(screen.getByTestId("start-absent-probe").textContent!.length).toBeGreaterThan(20);
    // 🔴 关键的一条：按钮**不渲染**。渲染了就意味着有一条能建出"发明步骤"的路。
    expect(screen.queryByTestId("start-submit")).toBeNull();
    expect(screen.queryByTestId("start-steps")).toBeNull();
    // 且**没有**把 POST 打出去
    expect(net.posted.length).toBe(0);
  });

  it("从有模板切到无模板：步骤与按钮必须一起消失（不许留着上一条流程的残影）", async () => {
    renderApp("/v/process-stuck");
    await waitFor(() => expect(screen.getByTestId("start-from-template")).toBeTruthy());
    await selectProcess("P34");
    await waitFor(() => expect(screen.getByTestId("start-submit")).toBeTruthy());
    await selectProcess("P01");
    await waitFor(() => expect(screen.getByTestId("start-no-template")).toBeTruthy());
    expect(screen.queryByTestId("start-submit")).toBeNull();
    expect(screen.queryByTestId("start-step")).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ③ 结构守卫 · 组件源码里不许有"发明步骤"的语法形态，也不许有硬编码颜色
// ══════════════════════════════════════════════════════════════════════════

describe("WO-STEP-TEMPLATE-LAYER FE · 结构守卫", () => {
  const src = readFileSync(COMPONENT, "utf8");
  /** 剥注释再查（注释里讲"为什么不发明步骤"是应该的，不该被判成违规）。 */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("金丝雀：源码真被读到、且剥注释没把代码一起吞掉", () => {
    // 正向：已知必中的两个串（一个在注释里、一个在代码里）
    expect(src).toContain("tasksFromStepTemplate");
    expect(code, "剥注释把代码吞了 ⇒ 下面的否定结论全部作废").toContain("createProcessInstance");
    /**
     * 反向：一个**只在注释里**出现的串，剥完必须没有。
     * ⚠ 选串要小心：初版取的是「宁可少展示」，而那句话**同时**写在了 `<p>` 的上屏文案里
     *（组件正文第一段），于是这条反向金丝雀当场自红 —— 它测出的不是剥注释坏了，
     * 是我选的样例不是注释独有的。改用断点编号 `G-FRONTEND-HARDCODED-ABSENCE`：
     * 那是只写给读代码的人看的内部标识，不会也不该出现在界面上。
     */
    expect(src).toContain("G-FRONTEND-HARDCODED-ABSENCE");
    expect(code).not.toContain("G-FRONTEND-HARDCODED-ABSENCE");
  });

  it("**`tasks` 只有一处来源**：`tasksFromStepTemplate`，源码里没有第二处构造 tasks 的地方", () => {
    expect(code).toContain("tasksFromStepTemplate(steps)");
    // 「发明步骤」的语法形态：自己拼一个带 name + ownerFunctionKey 的对象字面量。
    expect(code, "组件里出现了自造的任务对象 ⇒ 步骤不再只来自模板").not.toMatch(
      /\{\s*name\s*:\s*["'`]/,
    );
    expect(code, "组件里出现了写死的责任职能 ⇒ 同上").not.toMatch(/ownerFunctionKey\s*:\s*["'`]/);
  });

  it("三色系：样式零硬编码颜色（全部走 tokens.css 变量）", () => {
    const css = readFileSync(join(SRC, "views", "process", "ProcessStartFromTemplate.module.css"), "utf8");
    /**
     * 🔴 **剥注释再查** —— 与上面组件源码那两条同一条纪律，初版漏了，被真数据当场抖出来：
     * 补上「`--accent` 在 warm 是 `#E8590C`，白字仅 3.58:1，故改用 `--accent-solid`」这段
     * **取证注释**后，本条立刻自红。但注释里**引用**色值当证据不是「硬编码颜色」——
     * 这条门要禁的是**声明里**写死色值（那才会真上屏）。判据落错位置的后果不是漏判，
     * 是逼人把取证删掉去凑绿，那正好把「为什么这么改」的证据从原地擦掉。
     */
    const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");
    // 🐤 正向金丝雀：文件真读到了，且剥注释没把声明一起吞掉。
    expect(cssCode, "剥注释把声明吞了 ⇒ 下面的否定结论全部作废").toContain("var(--");
    // 🐤 反向金丝雀：一个**只可能在注释里**出现的串，剥完必须没有 —— 否则「剥」根本没生效，
    //    下面两条否定断言会退化成「原文里就没有」，再也分不出注释与声明。
    expect(css, "反向金丝雀样例本身必须存在于原文").toContain("WO-STEP-TEMPLATE-LAYER");
    expect(cssCode, "剥注释没生效 ⇒ 下面的否定结论不成立").not.toContain("WO-STEP-TEMPLATE-LAYER");
    expect(cssCode, "出现 hex 颜色字面量").not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(cssCode, "出现颜色函数字面量").not.toMatch(/\b(rgba?|hsla?|color-mix)\s*\(/);
  });

  it("诚实位：组件不许出现「未知 / N/A / 暂无」这类占位符（缺席只许不显示）", () => {
    for (const bad of ["未知", "N/A", "暂无数据"]) {
      expect(code, `出现占位符「${bad}」—— 缺席只是没说，占位符是说了一句假的`).not.toContain(bad);
    }
  });
});
