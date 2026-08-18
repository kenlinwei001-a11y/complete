import { describe, expect, it } from "vitest";
import type { Answer, ObjectRef, PageContext, PageEntity, QueryTask } from "@platform/contracts";
import { extractAnswerText } from "../src/skill-probe.js";
import { createTestApp, submitQuery, waitForTask, ADMIN } from "./helpers.js";

/**
 * WO-QOS-PAGECTX-EVAL · 同屏问答「答得对不对」内容面评测集（闭 G-SPLITACCOUNT-PROMISE-ONLY 的 B-4·U7 一项）。
 *
 * 断言落点 = **答案载荷的内容正确性**，不是「知不知道自己在哪一页」（结构面已由
 * `ceo-pagecontext-seam.test.ts` 判讫：usedPageContext/slots 派生），也不是「返回了东西」。
 * 每条用例 = 同屏场景（view + pageContext·经 derivePageContextMirror 逐字段镜像前端
 * sessionStore.derivePageContext）+ 问题 + **期望要素**，经真 QOS 管线（deterministic:ceo-route →
 * path-A invoke_solver → 模板投影答案·**全程零 LLM 块装配**）真跑，判分只看答案文本里
 * 期望要素命中/漏答/禁现要素（答非所问探针）。
 *
 * 判分口径（R6 确定性·禁 LLM-as-judge）：`scoreAnswer` 纯函数——子串匹配，三态可区分：
 *   ① noAnswer（没答：任务未 COMPLETED 或答案文本空）
 *   ② missing（漏答：期望要素未命中·指名缺哪个）
 *   ③ offTopic（答非所问：禁现要素出现·指名是哪个）
 * 金丝雀与主判分**共用同一 `scoreAnswer` 实现**（铁律 0.6·不各抄一份）：
 *   · 必中样例 `remedy-cathode`（明知答得对 ⇒ 必须判对）；
 *   · 必不咬样例 `offtopic-weather`（明知答非所问 ⇒ 必须判不对）——该场景**答案块非空**
 *    （诚实降级文案），专杀「只断言返回了东西」的伪判分。
 *
 * 诚实边界（沿用 evals.ts 同款声明）：agentcore MockDataCore 对 gap_attribution /
 * bottleneck_matrix / supply_demand_gap_attribution 返通用桩 {solverKey, ok, args}，
 * 故这些求解器的内容面断言粒度 = 「答的是哪个求解器 + 哪个页面要素」；decision_play
 * 为**高保真 mock**（根因标签/方案表/缺口数字全真），断言到方案内容粒度。接真 datacore
 * 后要素只会更丰富，本判分口径不变（要素子串匹配不依赖 mock 特有字段名）。
 *
 * 变异反证口径：把任一 mustInclude 要素改成答案里不可能出现的串 ⇒ 本文件红且
 * 失败信息**指名缺哪个要素**；还原转绿（交单附两遍实录）。
 */

// ---------------------------------------------------------------------------
// 判分器（纯函数·确定性·主套件与金丝雀共用）
// ---------------------------------------------------------------------------

export interface PageCtxExpect {
  /** 期望要素：全部命中才判「答得对」（漏答 = missing 指名）。 */
  mustInclude: string[];
  /** 禁现要素：任一出现即「答非所问」（offTopic 指名）。 */
  mustNotInclude: string[];
}

export interface PageCtxVerdict {
  pass: boolean;
  /** 没答：任务未 COMPLETED 或答案文本为空。 */
  noAnswer: boolean;
  /** 漏答：未命中的期望要素（指名）。 */
  missing: string[];
  /** 答非所问：出现在答案里的禁现要素（指名）。 */
  offTopic: string[];
}

/** 确定性判分：子串匹配（extractAnswerText 序列化与 evals.ts 同一份实现）。 */
export function scoreAnswer(answerText: string, completed: boolean, expect: PageCtxExpect): PageCtxVerdict {
  const noAnswer = !completed || answerText.trim().length === 0;
  const missing = noAnswer ? [...expect.mustInclude] : expect.mustInclude.filter((el) => !answerText.includes(el));
  const offTopic = noAnswer ? [] : expect.mustNotInclude.filter((el) => answerText.includes(el));
  return { pass: !noAnswer && missing.length === 0 && offTopic.length === 0, noAnswer, missing, offTopic };
}

// ---------------------------------------------------------------------------
// 评测集：同屏场景 + 问题 + 期望要素
// ---------------------------------------------------------------------------

interface PageCtxCase {
  key: string;
  /** 金丝雀标记：mustPass=明知答得对 · mustFail=明知答不对（判分器必须咬）。 */
  canary?: "mustPass" | "mustFail";
  view: string;
  selectedObjects: ObjectRef[];
  question: string;
  expect: PageCtxExpect;
}

/** 镜像 sessionStore.derivePageContext（前端真源·跨 app 不可 import·与 ceo-pagecontext-seam 同一份）。 */
function derivePageContextMirror(s: { view: string; selectedObjects: ObjectRef[]; filters: Record<string, string | string[]> }): PageContext {
  const entities: PageEntity[] = s.selectedObjects.map((o) => ({ type: o.objectType, id: o.objectId, label: o.label ?? o.objectId, drillRef: o.objectId }));
  const selection = s.selectedObjects.map((o) => o.objectId);
  const scalar = (k: string) => (typeof s.filters[k] === "string" && (s.filters[k] as string).length > 0 ? (s.filters[k] as string) : undefined);
  const byType = (t: string) => s.selectedObjects.find((o) => o.objectType === t)?.objectId;
  const focus: NonNullable<PageContext["focus"]> = {};
  const metric = scalar("metric") ?? byType("Metric");
  const base = scalar("base") ?? byType("Base");
  const factorId = scalar("factorId") ?? byType("RootCause") ?? byType("GapAttribution") ?? byType("Factor");
  if (metric) focus.metric = metric;
  if (base) focus.base = base;
  if (factorId) focus.factorId = factorId;
  const pc: PageContext = { view: s.view, entities, selection, drillPath: [], actions: [] };
  if (Object.keys(focus).length > 0) pc.focus = focus;
  return pc;
}

const GAP_WATERFALL_CATHODE: ObjectRef[] = [
  { objectType: "Metric", objectId: "seg_attain_ess", label: "储能达成率" },
  { objectType: "RootCause", objectId: "cf-cathode-shortage", label: "正极粉短缺" },
];

const CASES: PageCtxCase[] = [
  {
    key: "rootcause-cathode",
    view: "gap-waterfall",
    selectedObjects: GAP_WATERFALL_CATHODE,
    question: "储能为什么没达标",
    expect: {
      // 答得对 = 根因深问求解器 + 本页指标进答案；答非所问探针 = 决策求解器/别页根因。
      mustInclude: ["gap_attribution", "seg_attain_ess"],
      mustNotInclude: ["decision_play", "cf-upstream-cut"],
    },
  },
  {
    key: "remedy-cathode",
    canary: "mustPass", // 必中金丝雀：decision_play 高保真答案，要素实测全命中（探针实录见提交说明）。
    view: "gap-waterfall",
    selectedObjects: GAP_WATERFALL_CATHODE,
    question: "这个根因怎么补",
    expect: {
      // 答得对 = 答的是本页选中的那个根因 + 真方案内容（标签/缺口/两个可选对策）。
      mustInclude: ["decision_play", "cf-cathode-shortage", "上游正极材料减供", "27.8", "扩备份供应池", "长协提量"],
      mustNotInclude: ["cf-upstream-cut", "gap_attribution"],
    },
  },
  {
    key: "remedy-follows-page",
    view: "gap-waterfall",
    selectedObjects: [
      { objectType: "Metric", objectId: "seg_attain_ess", label: "储能达成率" },
      { objectType: "RootCause", objectId: "cf-upstream-cut", label: "上游减产" },
    ],
    question: "这个根因怎么补", // 同问句换选中 ⇒ 答案内容必须跟着页面走（内容面·非 slots 结构面）。
    expect: {
      mustInclude: ["cf-upstream-cut", "plan-cf-upstream-cut"],
      mustNotInclude: ["cf-cathode-shortage"],
    },
  },
  {
    key: "bottleneck-risk",
    view: "risk",
    selectedObjects: [],
    question: "哪道工序是瓶颈",
    expect: {
      // 答得对 = 对口瓶颈求解器；答非所问探针 = 被根因/决策求解器劫持（RE_ROOTCAUSE 过度捕获的老坑）。
      mustInclude: ["bottleneck_matrix"],
      mustNotInclude: ["gap_attribution", "decision_play"],
    },
  },
  {
    key: "supply-demand-gap",
    view: "gap-waterfall",
    selectedObjects: [{ objectType: "Metric", objectId: "seg_attain_ess", label: "储能达成率" }],
    question: "供需为什么对不上",
    expect: {
      mustInclude: ["supply_demand_gap_attribution", "seg_attain_ess"],
      mustNotInclude: ["decision_play"],
    },
  },
  {
    key: "offtopic-weather",
    canary: "mustFail", // 必不咬金丝雀：明知答不了 ⇒ 必须判不对。答案块非空（诚实降级文案）·专杀「返回了东西就算过」。
    view: "gap-waterfall",
    selectedObjects: GAP_WATERFALL_CATHODE,
    question: "今天天气怎么样",
    expect: {
      // 挂「若真答了本页根因补救应含」的要素：天气题答不出 ⇒ 判分器必须报漏答并指名。
      mustInclude: ["cf-cathode-shortage", "扩备份供应池"],
      mustNotInclude: [],
    },
  },
];

// ---------------------------------------------------------------------------
// 套件
// ---------------------------------------------------------------------------

function formatVerdict(c: PageCtxCase, v: PageCtxVerdict): string {
  const parts: string[] = [];
  if (v.noAnswer) parts.push("没答(noAnswer)");
  if (v.missing.length > 0) parts.push(`漏答(missing): ${v.missing.join("、")}`);
  if (v.offTopic.length > 0) parts.push(`答非所问(offTopic): ${v.offTopic.join("、")}`);
  return `[${c.key}] ${v.pass ? "答得对" : `答不对 —— ${parts.join("；")}`}`;
}

describe("WO-QOS-PAGECTX-EVAL · 同屏问答内容面评测集（B-4·U7·判分确定性 R6）", () => {
  it("判分器单测：命中/漏答/答非所问/没答 四态可区分（纯函数·不碰 app）", () => {
    const exp: PageCtxExpect = { mustInclude: ["甲", "乙"], mustNotInclude: ["丙"] };
    // 全命中 → 判对
    expect(scoreAnswer("这里有甲和乙", true, exp)).toEqual({ pass: true, noAnswer: false, missing: [], offTopic: [] });
    // 漏答 → 指名缺「乙」
    const vMiss = scoreAnswer("这里只有甲", true, exp);
    expect(vMiss.pass).toBe(false);
    expect(vMiss.missing).toEqual(["乙"]);
    expect(vMiss.noAnswer).toBe(false);
    // 答非所问 → 指名出现「丙」
    const vOff = scoreAnswer("这里有甲和乙和丙", true, exp);
    expect(vOff.pass).toBe(false);
    expect(vOff.offTopic).toEqual(["丙"]);
    // 没答（空答案 / 未 COMPLETED）→ missing 全列·offTopic 不冤判
    const vNo = scoreAnswer("", true, exp);
    expect(vNo.noAnswer).toBe(true);
    expect(vNo.missing).toEqual(["甲", "乙"]);
    expect(scoreAnswer("甲和乙", false, exp).noAnswer).toBe(true);
  });

  it("主套件：5 条同屏场景经真 QOS 管线逐条判分（必中金丝雀在内·全过 = 现状答得对）", async () => {
    const t = await createTestApp();
    const mainCases = CASES.filter((c) => c.canary !== "mustFail");
    const verdicts: { c: PageCtxCase; v: PageCtxVerdict }[] = [];
    for (const c of mainCases) {
      const pageContext = derivePageContextMirror({ view: c.view, selectedObjects: c.selectedObjects, filters: {} });
      const { taskId, statusCode } = await submitQuery(t, ADMIN, c.question, { view: c.view, pageContext });
      expect(statusCode).toBe(202);
      const task: QueryTask = await waitForTask(t, taskId);
      const answerText = extractAnswerText(task.answer as Answer | null);
      const v = scoreAnswer(answerText, task.status === "COMPLETED", c.expect);
      verdicts.push({ c, v });
      console.log(`[PAGECTX-EVAL] ${formatVerdict(c, v)}`);
    }
    await t.app.close();
    const failed = verdicts.filter(({ v }) => !v.pass);
    // 失败信息指名缺哪个要素 / 出现哪个禁现要素（变异反证的断言面）。
    expect(failed.map(({ c, v }) => formatVerdict(c, v)).join("\n")).toBe("");
  }, 60000);

  it("金丝雀·必不咬：明知答非所问的场景 ⇒ 判不对且指名缺哪个要素（同一 scoreAnswer 实现）", async () => {
    const t = await createTestApp();
    const c = CASES.find((x) => x.key === "offtopic-weather")!;
    const pageContext = derivePageContextMirror({ view: c.view, selectedObjects: c.selectedObjects, filters: {} });
    const { taskId } = await submitQuery(t, ADMIN, c.question, { view: c.view, pageContext });
    const task: QueryTask = await waitForTask(t, taskId);
    const answer = task.answer as Answer | null;
    const answerText = extractAnswerText(answer);
    // 前提：答案**非空**（诚实降级文案）——若哪天变空，本前提先红，逼你重估这条金丝雀在测什么。
    expect(answer?.blocks?.length ?? 0).toBeGreaterThan(0);
    expect(answerText.length).toBeGreaterThan(0);
    const v = scoreAnswer(answerText, task.status === "COMPLETED", c.expect);
    console.log(`[PAGECTX-EVAL·canary] ${formatVerdict(c, v)}`);
    // 判不对 · 且失败三态里落在「漏答」并指名两个要素 · 不冤判答非所问。
    expect(v.pass).toBe(false);
    expect(v.missing).toEqual(["cf-cathode-shortage", "扩备份供应池"]);
    expect(v.offTopic).toEqual([]);
    await t.app.close();
  }, 30000);
});
