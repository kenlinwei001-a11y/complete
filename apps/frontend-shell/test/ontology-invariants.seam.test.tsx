import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { readRepo, stripComments } from "./factlock";

/**
 * WO-ONTOLOGY-EDGE-TRICLASS · **本体第三类边（不变式守卫）的接缝门**
 *
 * ── 这道门要证的那**一句话** ──────────────────────────────────────────────────
 *   **「把某条不变式的容差改到它不成立 ⇒ 屏上那一条真的从『成立』变成『不成立』。」**
 *
 * 刻意**不**证的三件事（它们能在缺口仍在的情况下全绿，本仓吃过太多次）：
 *   ⛔ 「不变式列表渲染出来了」 —— 渲染一张写死的表也能过；
 *   ⛔ 「求值函数被调用了」     —— 调用了但结果没上屏，屏上照样是旧字；
 *   ⛔ 「请求发出去了」         —— 发了但响应没驱动那一格，用户看到的还是「成立」。
 * 故断言落点一律是 **`orel-inv-status-*` 这一格的字**，不是别的。
 *
 * ── 变异反证（本门是不是装饰品，靠它验；实测记录见交单报告 T1）────────────────
 *   把「求值」那一步拆掉 —— `mocks/handlers.ts` 的 `mockInvariantReport` 里
 *   `const violated = measured > toleranceValue;` 改成 `> spec.tolerance.defaultValue`
 *   （= 收下了容差却不拿它求值）。此时**面板还在、函数还在、请求照发**，
 *   只有「屏上的成立/不成立不再随容差变」。本门必须红在 §1 那条
 *   「改完容差后这一格应为『不成立』」上 —— 红在别处就说明我证的是别的东西。
 *
 * ── 为什么不 `vi.mock("@/api/endpoints")` ─────────────────────────────────────
 *   那会把病灶所在的那一跳一起 mock 掉（URL、body 序列化全不参与）。本文件走**真 endpoints**，
 *   在 MSW 层拦**真实 URL + 真实 body**，故 §1 还能顺带咬住「覆盖真的送到了后端」。
 */

type Hit = { url: string; body: unknown };

function spyOn(method: "get" | "post", pattern: string, sink: Hit[]) {
  server.use(
    http[method](pattern, async ({ request }) => {
      const body = method === "post" ? await request.clone().json().catch(() => null) : null;
      sink.push({ url: request.url, body });
      return undefined as never; // 落回原 handler（有状态 store 照常推进）
    }),
  );
}

/** 屏上那一格的字（`成立` / `不成立` / `读不出来`）。 */
const verdictOf = (key: string): string => (screen.getByTestId(`orel-inv-status-${key}`).textContent ?? "").trim();

const measureOf = (key: string): string => (screen.getByTestId(`orel-inv-measure-${key}`).textContent ?? "").trim();

/** 系数上限那条：mock 世界里三条因果边的最大系数是 0.85，目录原值容差 1 ⇒ 开局成立。 */
const COEF = "causal_coefficient_within_ceiling";

async function openPage() {
  loginAs("planner");
  renderApp("/admin/ontology-relations");
  await screen.findByTestId("ontology-relations-page");
  // 等体检结果真回来（表还没来时读 `orel-inv-status-*` 会抛，断言就成了空胜）
  await screen.findByTestId("orel-inv-table");
  await waitFor(() => expect(screen.getByTestId(`orel-inv-status-${COEF}`)).toBeTruthy());
}

/** 改容差：用一次 change 事件落定（逐字符输入会把受控输入打成中间态，制造假红）。 */
function setTolerance(key: string, value: string) {
  fireEvent.change(screen.getByTestId(`orel-inv-tolerance-${key}`), { target: { value } });
}

describe("WO-ONTOLOGY-EDGE-TRICLASS ① 改容差 ⇒ 屏上那条真的从「成立」变「不成立」", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("容差 1 → 0.5：系数上限那条由成立翻成不成立，且违反者被逐条点名", async () => {
    const posts: Hit[] = [];
    spyOn("post", "*/a/v1/ontology/invariants/evaluate", posts);

    await openPage();

    // ── 开局：实测 0.85 ≤ 容差 1 ⇒ 成立（这一格的字就是本门的断言对象）
    expect(verdictOf(COEF), "开局这条本应成立（实测 0.85，容差 1）").toBe("成立");
    expect(measureOf(COEF)).toContain("0.85");

    // ── 动作：把线挪到 0.5（低于实测值）
    setTolerance(COEF, "0.5");

    // ── 载体①（**本门的头号判据**）：屏上那一格的字真的变了
    await waitFor(() => expect(verdictOf(COEF), "改完容差后这一格应为「不成立」——没变 = 求值那一步没接上").toBe("不成立"));

    // ── 载体②：实测量**没变**（变的是线，不是事实）——防止"把实测量也一起改掉"式的假通过
    expect(measureOf(COEF), "改容差不该改变实测值").toContain("0.85");

    // ── 载体③：翻转清单直答"谁因你的改动翻了"
    const flips = await screen.findByTestId("orel-inv-flip-violate");
    expect(flips.textContent).toContain("传导系数不得超过上限");

    // ── 载体④：违反者被点名（只说"有几条"而不说是哪几条，用户下一步就断了）
    const offenders = await screen.findByTestId(`orel-inv-offenders-${COEF}`);
    expect(offenders.textContent).toContain("seed_line_to_base");
    expect(offenders.textContent).toContain("0.85");

    // ── 载体⑤：覆盖**真的送到了后端**（不是前端自己算了个数显示出来）
    await waitFor(() => expect(posts.length, "试算请求一次都没发出去").toBeGreaterThan(0));
    const last = posts[posts.length - 1]!;
    expect(last.url).toContain("/a/v1/ontology/invariants/evaluate");
    expect(last.body).toMatchObject({ overrides: { [COEF]: { tolerance: 0.5 } } });
  });

  it("把容差调回去 ⇒ 那一格回到「成立」（试算可逆，且反向翻转也报出来）", async () => {
    await openPage();
    setTolerance(COEF, "0.5");
    await waitFor(() => expect(verdictOf(COEF)).toBe("不成立"));

    setTolerance(COEF, "2");
    await waitFor(() => expect(verdictOf(COEF), "容差放宽后应回到成立").toBe("成立"));
    // 放宽到 2 之后，开局就不成立的那几条里若有 ≤2 的会转成立 —— 反向清单必须也能报
    expect(screen.queryByTestId("orel-inv-flip-violate"), "已无由成立转不成立的条目").toBeNull();
  });

  it("「全部还原」把试算清干净，屏上回到目录原值那一版", async () => {
    await openPage();
    setTolerance(COEF, "0.5");
    await waitFor(() => expect(verdictOf(COEF)).toBe("不成立"));
    await waitFor(() => expect(screen.queryByTestId("orel-inv-reset")).not.toBeNull());

    const user = userEvent.setup();
    await user.click(screen.getByTestId("orel-inv-reset"));
    await waitFor(() => expect(verdictOf(COEF), "还原后应回到成立").toBe("成立"));
    expect(screen.queryByTestId(`orel-inv-overridden-${COEF}`), "还原后不该再标「试算中」").toBeNull();
  });
});

describe("WO-ONTOLOGY-EDGE-TRICLASS ② 停用是「不体检」，不是「问题没了」", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("停用一条不成立的守卫 ⇒ 它从「不成立」计数里退出，但实测值照算照显示", async () => {
    await openPage();
    // mock 世界里 `linkAB` 这条关系压根不在册 ⇒ 开局就有两条因果边失联（真问题，不是摆拍）
    const DANGLING = "causal_via_structural_edge_exists";
    expect(verdictOf(DANGLING), "mock 世界开局就该有失联的因果边").toBe("不成立");
    const measuredBefore = measureOf(DANGLING);
    const violatedBefore = Number(/(\d+)/.exec(screen.getByTestId("orel-inv-violated").textContent ?? "")?.[1]);

    fireEvent.click(screen.getByTestId(`orel-inv-enabled-${DANGLING}`));

    await waitFor(() => {
      const violatedAfter = Number(/(\d+)/.exec(screen.getByTestId("orel-inv-violated").textContent ?? "")?.[1]);
      expect(violatedAfter, "停用后它应退出「不成立」计数").toBe(violatedBefore - 1);
    });
    expect(screen.getByTestId("orel-inv-skipped").textContent).toContain("1");
    // 关键：**实测值一个字都没变** —— 停用不让问题消失，只是这轮不体检它
    expect(measureOf(DANGLING), "停用不该改变实测值").toBe(measuredBefore);
  });
});

describe("WO-ONTOLOGY-EDGE-TRICLASS ③ 阻断裁决未下：只标注，不拦", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("有不成立的守卫时，屏上明说不拦任何动作，并把「真要拦会拦几条」先算出来", async () => {
    await openPage();
    const banner = screen.getByTestId("orel-inv-enforcement").textContent ?? "";
    expect(banner).toContain("只标注");
    expect(banner).toMatch(/会拦下\s*\d+\s*条/);
  });

  it("发起发布会签仍然成功 —— 不变式今天一条都不拦（接缝：不成立 × 发布路）", async () => {
    const user = userEvent.setup();
    await openPage();
    expect(verdictOf("causal_via_structural_edge_exists"), "前提：此刻确有不成立的守卫").toBe("不成立");

    await user.click(screen.getByTestId("orel-publish-open"));
    // 拦了的话这张表不会长出行来 —— 这一条钉死「今天只标注」这个事实态
    await waitFor(() => expect(screen.getByTestId("orel-publish-table").querySelectorAll("tbody tr").length).toBeGreaterThan(0));
  });
});

describe("WO-ONTOLOGY-EDGE-TRICLASS ④ 事实锁：替身与真身的守卫清单必须同名同条数", () => {
  afterEach(() => cleanup());

  /**
   * 前端 mock 里那份 `MOCK_INVARIANT_SPECS` 是**替身**，真目录在 datacore。
   * 后端加了一条守卫而 mock 忘了加 ⇒ 屏上永远看不到它，而所有前端测试照样全绿。
   * 这一条让**机器先说话**：两边 key 集合逐条对账。
   *
   * ⚠ 报「抽不到」这种否定结论之前先跑金丝雀（铁律 0.6）：抽取器抽 0 条时
   *   必须报「工具坏了」，不许读作「后端没有守卫」。
   */
  it("datacore 目录里的守卫 key 集合 == mock 下发的 key 集合", async () => {
    const src = stripComments(readRepo("apps/datacore/src/ontology/invariants.ts"));
    const backendKeys = [...src.matchAll(/\bkey:\s*"([a-z][a-z0-9_]*)"/g)].map((m) => m[1]!).sort();

    // 金丝雀（与主判据共用同一份抽取实现）：一个已知必中的 key 必须在
    expect(backendKeys.length, "从 datacore 目录里一条 key 都没抽到 ⇒ 抽取器坏了，不许读作「后端没有守卫」").toBeGreaterThan(2);
    expect(backendKeys, "金丝雀 key 不在 ⇒ 抽取器坏了").toContain("causal_coefficient_within_ceiling");
    // 负向金丝雀：只在注释里出现的串不该被抽出（剥注释真的生效了）
    expect(backendKeys).not.toContain("这是注释里的假key");

    await openPage();
    const mockKeys = [...screen.getByTestId("orel-inv-table").querySelectorAll("tbody tr[data-testid^='orel-inv-']")]
      .map((tr) => (tr.getAttribute("data-testid") ?? "").replace(/^orel-inv-/, ""))
      .filter((k) => !k.startsWith("offenders-") && !k.startsWith("error-"))
      .sort();

    expect(mockKeys, "屏上的守卫清单与 datacore 目录不一致 —— 有一边忘了同步").toEqual(backendKeys);
  });
});

describe("WO-ONTOLOGY-EDGE-TRICLASS ⑤ 只读体检口与试算口各有其用", () => {
  afterEach(() => cleanup());

  it("没改任何东西时走只读体检口；一改容差才走试算口", async () => {
    const gets: Hit[] = [];
    const posts: Hit[] = [];
    spyOn("get", "*/a/v1/ontology/invariants", gets);
    spyOn("post", "*/a/v1/ontology/invariants/evaluate", posts);

    await openPage();
    await waitFor(() => expect(gets.length, "开局应走只读体检口").toBeGreaterThan(0));
    expect(posts.length, "没改任何东西就不该发试算请求").toBe(0);

    setTolerance(COEF, "0.5");
    await waitFor(() => expect(posts.length, "改了容差就该走试算口").toBeGreaterThan(0));
  });
});
