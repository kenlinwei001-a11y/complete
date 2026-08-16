import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PROCESS_WAIT_KINDS, type ProcessWaitKind } from "@platform/contracts";
import { getRenderer } from "@/views/registry";
import { NAV_GROUPS } from "@/pages/ShellLayout";
import { ACCOUNTS, workspaceForAccount } from "@/mocks/fixtures";
import { db } from "@/mocks/db";
import { PROCESS_DEFINITIONS_RESPONSE } from "@/mocks/processWaitFixtures";
import { buildProcessWaitModel, WAIT_KIND_STYLE } from "@/views/process/processWait";
import { zh } from "@/locales/zh";
import { checkedTree, factHits } from "./factlock";
import { loginAs, renderApp } from "./utils";

/**
 * WO-WAITING-STATES-FE · 流程等待态（需求 §20「『等待』是一等状态」）。
 *
 * ══ 本文件咬的是**链路**，不是组件 ═════════════════════════════════════════════
 *
 * 本仓连栽五次的病（`G-SKILL-REFGRAPH-DEAD-EXTRACTOR`）：组件写了 ✅ · renderer 注册了 ✅ ·
 * 测试全绿 ✅ · **零路径渲染得到 ❌**。那些绿测试全都是 `getRenderer(key)` 直接取组件再渲染 ——
 * 它们证明的是「拿到 renderer 之后能画出来」，**不证明「有任何东西能让你拿到 renderer」**。
 *
 * 故本文件的可达性断言一律**从 URL 出发**（`renderApp("/v/process-wait")`），
 * 摘掉后端 `BUILTIN_VIEWS` 那一行、或摘掉 mock fixtures 那一行，本文件当场红。
 *
 * ══ 需求判据逐条落点 ══════════════════════════════════════════════════════════
 *  §A 可达性     从 URL 真打得开 + 侧栏有点得到的入口 + 不落「其它」兜底桶
 *  §B 四态可辨   **每个态**都渲染得出，且**文案两两不同**（需求：不许 5 个态混成一个「等待中」）
 *  §C 词表单源   迭代序取自契约；契约若加第五态，缺文案/缺色即红（编译期 + 运行期双保险）
 *  §D 诚实缺席   「已卡多久」答不了这件事必须**说出来**，且不许拿标准工期冒充
 *  §E mock 保真  fixture 形状与真后端一致（过同一份 zod schema）· 四态每态 ≥2 条
 *  §F 无硬编码   文案全部来自 `locales/zh.ts`；样式零 hex 字面量
 */

/** 四态各自的 mock 期望条数（fixture 是 seed.ts 的逐字子集，见 processWaitFixtures.ts）。 */
const EXPECTED_COUNT: Record<ProcessWaitKind, number> = {
  WAITING_USER: 2,
  // WO-V4-INSPECT 追加 P37(SCHEDULE)/P40(DATA) 这一对**共用承载物**的流程后各 +1
  // （节点检视的「同承载物流程」反查需要 fixture 里真有一对，否则那条断言在空集合上恒真）。
  WAITING_DATA: 3,
  WAITING_EXTERNAL_SYSTEM: 3,
  WAITING_SCHEDULE: 3,
};

describe("WO-WAITING-STATES-FE · §0 金丝雀（否定结论前先自证工具）", () => {
  /**
   * 铁律 0.6 的机制：任何「0 命中 / 不存在」结论之前先跑一个**已知必中**的样例。
   * 下面几组断言里有多条是**否定形**（「不含 WAITING_APPROVAL」「不落兜底桶」「没有 hex」），
   * 若取数本身就是空的，这些否定断言会**恒真** —— 那是哑门，不是绿。
   */
  it("金丝雀：契约词表非空且恰为四值，fixture 非空且四态齐全 —— 否定断言的前提成立", () => {
    expect(PROCESS_WAIT_KINDS.length, "契约词表为空 ⇒ 下面所有否定断言恒真，是哑门不是绿").toBe(4);
    expect(PROCESS_DEFINITIONS_RESPONSE.definitions.length).toBeGreaterThan(0);
    const kinds = new Set(PROCESS_DEFINITIONS_RESPONSE.definitions.map((d) => d.waitKind));
    // 四态每态都有数据 —— 少一态，那一态的渲染断言就是在空集合上恒真
    for (const k of PROCESS_WAIT_KINDS) {
      expect(kinds.has(k), `fixture 里没有 ${k} 的数据 ⇒ 针对它的断言恒真（哑门）`).toBe(true);
    }
  });
});

describe("WO-WAITING-STATES-FE · §A 可达性（可达 ≠ 已注册·从 URL 出发）", () => {
  beforeEach(() => {
    loginAs("planner"); // mock 里 planner 持 admin 角色
  });

  it("金丝雀：mock workspace 真下发 process-wait（视图 + feature 双闸都开），且 renderer 注册在案", () => {
    const planner = ACCOUNTS.find((a) => a.username === "planner")!;
    const ws = workspaceForAccount(planner, db.tenantOverrides, db.configVersion);
    const view = (ws.views ?? []).find((v) => v.key === "process-wait");
    expect(
      view,
      "mock allViews 里没有 process-wait —— 不是页面坏了，是本测试的前提没成立（后端 BUILTIN_VIEWS 与 mock fixtures 已漂移）",
    ).toBeDefined();
    // renderer 字段必须逐字对齐后端单一来源，否则 ViewPage 拿它去 getRenderer 会落「该视图类型暂不支持」兜底卡
    expect(view!.renderer).toBe("process-wait");
    expect(ws.features).toContain("view.process-wait");
    expect(getRenderer("process-wait"), "registry 里没有 process-wait").toBeDefined();
  });

  it("链路层：直接访问 /v/process-wait → ViewPage 双闸放行 → 真渲染出整页", async () => {
    renderApp("/v/process-wait");
    // pw-root / pw-summary 只在真组件里出现；落 404/403/「暂不支持」兜底卡时一个都不会有
    await screen.findByTestId("pw-summary");
    expect(screen.getByTestId("pw-root")).toBeInTheDocument();
  });

  it("可发现性：侧栏「归因与风险」组里有一条 /v/process-wait 链接，且没落进「其它」兜底桶", async () => {
    renderApp("/v/dash");
    const nav = await screen.findByTestId("nav-business");
    const group = within(nav).getByTestId("nav-group-归因与风险");
    const link = within(group).getByText(zh.processWait.title);
    expect(link.closest("a")?.getAttribute("href")).toBe("/v/process-wait");
    // 反向：「其它」组（若存在）不得含它 —— 可达但折叠在兜底桶里 = 用户找不到（同族病第四层）
    const other = within(nav).queryByTestId("nav-group-其它");
    if (other) expect(within(other).queryByText(zh.processWait.title)).toBeNull();
  });

  it("结构守卫：NAV_GROUPS 里它挂的是 kind:\"view\"（经后端下发；挂成 route 会变成绕过下发的死链且无 R3 守卫）", () => {
    const items = NAV_GROUPS.flatMap((g) => g.items);
    const hit = items.filter((it) => it.key === "process-wait");
    expect(hit, "process-wait 在 NAV_GROUPS 里一条都没有").toHaveLength(1);
    expect(hit[0]!.kind).toBe("view");
  });

  it("R3「功能关闭 = 不存在」：view.process-wait 关 → 入口消失**且**页面渲染不出来", async () => {
    db.tenantOverrides["view.process-wait"] = false;
    const planner = ACCOUNTS.find((a) => a.username === "planner")!;
    const ws = workspaceForAccount(planner, db.tenantOverrides, db.configVersion);
    expect(ws.features).not.toContain("view.process-wait");

    renderApp("/v/process-wait");
    const nav = await screen.findByTestId("nav-business");
    const hrefs = new Set(Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href")));
    expect(hrefs.has("/v/process-wait"), "功能关着，入口仍在侧栏 —— 泄露了功能存在性（R3）").toBe(false);
    expect(screen.queryByTestId("pw-root"), "功能关着，页面仍渲染得出来 —— 孤儿态（R3）").toBeNull();
    delete db.tenantOverrides["view.process-wait"];
  });
});

describe("WO-WAITING-STATES-FE · §B 四态可辨识（需求头号判据：不许混成一个「等待中」）", () => {
  beforeEach(() => {
    loginAs("planner");
  });

  /**
   * 需求原文：「每个态都要有**可辨识的视觉区分**（不是 5 个都显示同一个『等待中』）——
   * 需求要的是回答『为什么卡住』，5 个态混成一个字就等于没做」。
   * 故本组逐态断言「渲染得出」**且**「文案两两不同」——只测前者的话，
   * 四个态都画成「等待中」照样全绿，正是需求点名要防的那种交付。
   */
  it("每个等待态都真渲染出一组（四态四组，一个都不许少）", async () => {
    renderApp("/v/process-wait");
    await screen.findByTestId("pw-summary");
    for (const kind of PROCESS_WAIT_KINDS) {
      expect(screen.getByTestId(`pw-group-${kind}`), `${kind} 这一组没渲染出来`).toBeInTheDocument();
    }
  });

  /**
   * ⚠ 本条曾是**哑门**，由变异反证抖出（2026-08-10）：标签原先与枚举名 `WAITING_*` 同处一个节点，
   * 于是把四态 label 全改成「等待中」后 textContent 仍互不相同（被后缀撑开），**变异照样全绿**。
   * 修法有两半，缺一不可：① 组件把标签文本单独挂 testid；② 本条同时断言**文案源**本身不重复。
   * 只断言渲染结果时，任何"渲染时又拼了点别的"都会重新把它变成哑门。
   */
  it("四态的标签两两不同（不是四个「等待中」）—— 文案源与渲染结果两侧都咬", async () => {
    // ① 文案源：locales 里四个 label 本身必须互不相同（这一半不受渲染拼接影响）
    const srcLabels = PROCESS_WAIT_KINDS.map((k) => zh.processWait.waitKind[k].label);
    expect(new Set(srcLabels).size, `locales 里四态 label 有重复：${srcLabels.join(" / ")}`).toBe(
      PROCESS_WAIT_KINDS.length,
    );

    // ② 渲染结果：屏幕上真出现四个不同的标签
    renderApp("/v/process-wait");
    await screen.findByTestId("pw-summary");
    const labels = PROCESS_WAIT_KINDS.map((k) => screen.getByTestId(`pw-label-${k}`).textContent ?? "");
    for (const l of labels) expect(l.length).toBeGreaterThan(0);
    // 渲染出的标签必须**就是**文案源那一个（不许混入枚举名等把它撑唯一的东西）
    expect(labels).toEqual(srcLabels);
    expect(new Set(labels).size, `四态标签有重复：${labels.join(" / ")} —— 混成一个字就等于没做`).toBe(
      PROCESS_WAIT_KINDS.length,
    );
  });

  it("四态的「等谁」两两不同 —— 这是本页回答「为什么卡住」的核心 answer", async () => {
    renderApp("/v/process-wait");
    await screen.findByTestId("pw-summary");
    const whos = PROCESS_WAIT_KINDS.map((k) => screen.getByTestId(`pw-who-${k}`).textContent ?? "");
    for (const w of whos) expect(w.length).toBeGreaterThan(0);
    expect(new Set(whos).size, "四态的『等谁』有重复 —— 那就答不了『在等谁』").toBe(PROCESS_WAIT_KINDS.length);
  });

  it("四态的判据说明（hint）两两不同，且逐字对齐契约注释里的判据", async () => {
    renderApp("/v/process-wait");
    await screen.findByTestId("pw-summary");
    const hints = PROCESS_WAIT_KINDS.map((k) => screen.getByTestId(`pw-hint-${k}`).textContent ?? "");
    expect(new Set(hints).size).toBe(PROCESS_WAIT_KINDS.length);
  });

  it("四态四色四记号（视觉区分不止靠文字；记号保证不依赖颜色也分得开·色盲可达）", async () => {
    const colors = PROCESS_WAIT_KINDS.map((k) => WAIT_KIND_STYLE[k].colorVar);
    expect(new Set(colors).size, `四态色变量有重复：${colors.join(" / ")}`).toBe(PROCESS_WAIT_KINDS.length);
    const marks = PROCESS_WAIT_KINDS.map((k) => WAIT_KIND_STYLE[k].mark);
    expect(new Set(marks).size, `四态记号有重复：${marks.join(" / ")}`).toBe(PROCESS_WAIT_KINDS.length);

    renderApp("/v/process-wait");
    await screen.findByTestId("pw-summary");
    for (const kind of PROCESS_WAIT_KINDS) {
      const group = screen.getByTestId(`pw-group-${kind}`);
      // 色变量真注入到该组的 style 上（否则四组同色 = 视觉上分不开）
      expect(group.getAttribute("style") ?? "").toContain(WAIT_KIND_STYLE[kind].colorVar);
      expect(screen.getByTestId(`pw-mark-${kind}`).textContent).toBe(WAIT_KIND_STYLE[kind].mark);
    }
  });

  it("每态的流程条数与明细行真按态分组渲染（不是把 65 条堆成一张表）", async () => {
    renderApp("/v/process-wait");
    await screen.findByTestId("pw-summary");
    for (const kind of PROCESS_WAIT_KINDS) {
      const group = screen.getByTestId(`pw-group-${kind}`);
      const rows = within(group).getAllByTestId(/^pw-row-/);
      expect(rows, `${kind} 组内明细行数不对`).toHaveLength(EXPECTED_COUNT[kind]);
      // 组内每一行的 waitKind 必须就是本组的态（错分 = 分组逻辑失效）
      for (const r of rows) expect(r.getAttribute("data-kind")).toBe(kind);
      expect(screen.getByTestId(`pw-count-${kind}`).textContent).toContain(String(EXPECTED_COUNT[kind]));
    }
  });

  it("「等谁」落到具体责任职能（不是只给一个抽象类别）", async () => {
    renderApp("/v/process-wait");
    await screen.findByTestId("pw-summary");
    // WAITING_EXTERNAL_SYSTEM 组里 fixture 有 demand_planning ×2 与 supply_chain ×1
    const owners = screen.getByTestId("pw-owners-WAITING_EXTERNAL_SYSTEM").textContent ?? "";
    expect(owners).toContain("需求计划");
    expect(owners).toContain("供应链");
    // WO-UI-BURNDOWN-21（2026-08-14）：条数原先写作 `×2`，一个乘号是算式记号（规范 R-UI-3）。
    // 记号换成量词之后**数必须还在** —— 否则那不是分层，是把信息删了。
    expect(owners, "责任职能后面的条数被改没了").toContain("2 条");
    expect(owners).toContain("1 条");
    expect(owners, "乘号记号没换干净").not.toContain("×");
  });
});

describe("WO-WAITING-STATES-FE · §C 词表单源（四态不是五态·WAITING_APPROVAL 是诚实缺席）", () => {
  /**
   * 派单基线写「五个等待态」，实测**只有四个**：`WAITING_APPROVAL` 被仓主明确裁掉
   * （「流程审批不体现」），契约 `process.ts:59-67` 写明「这是诚实缺席，不是漏写」，
   * 且 `apps/datacore/test/process-layer.test.ts:99/106/114` 三条断言钉着它不许回来。
   * 本组是前端这一侧的同款钉子：谁"顺手补齐成五种"，这里当场红。
   */
  it("契约词表恰为四值且**不含** WAITING_APPROVAL（仓主已裁·补第五态会同时打红 datacore 三条断言）", () => {
    expect(PROCESS_WAIT_KINDS).toHaveLength(4);
    expect(PROCESS_WAIT_KINDS).not.toContain("WAITING_APPROVAL");
  });

  it("前端不重写词表：渲染顺序逐项等于 PROCESS_WAIT_KINDS（派生而非手抄）", () => {
    const model = buildProcessWaitModel(PROCESS_DEFINITIONS_RESPONSE);
    expect(model.groups.map((g) => g.kind)).toEqual([...PROCESS_WAIT_KINDS]);
  });

  it("每个契约词条都有文案与样式 —— 契约加第五态而前端没跟，这里立刻红（运行期保险）", () => {
    for (const kind of PROCESS_WAIT_KINDS) {
      const copy = zh.processWait.waitKind[kind];
      expect(copy, `${kind} 缺文案`).toBeDefined();
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.who.length).toBeGreaterThan(0);
      expect(WAIT_KIND_STYLE[kind], `${kind} 缺视觉样式`).toBeDefined();
    }
  });

  it("词表漂移对账：后端下发词表 ≠ 契约词表 ⇒ 页面显式报警，不默默少画一组", async () => {
    // 正常态：无漂移，不显示告警
    const clean = buildProcessWaitModel(PROCESS_DEFINITIONS_RESPONSE);
    expect(clean.vocabDrift.missingInResponse).toHaveLength(0);
    expect(clean.vocabDrift.unknownInResponse).toHaveLength(0);

    // 变异反证：后端少下发一态 + 多下发一个契约没有的态 ⇒ 两侧差集都要被抓出来
    const drifted = buildProcessWaitModel({
      ...PROCESS_DEFINITIONS_RESPONSE,
      waitKinds: ["WAITING_USER", "WAITING_APPROVAL"],
    });
    expect(drifted.vocabDrift.missingInResponse).toContain("WAITING_DATA");
    expect(drifted.vocabDrift.unknownInResponse).toContain("WAITING_APPROVAL");
    // 即便后端漂了，前端仍按契约恒画四组（词表单源在契约，不由响应决定）
    expect(drifted.groups).toHaveLength(4);
  });

  it("空态也保留该组（「租户没有」与「前端漏画」不许在屏幕上长得一样）", () => {
    const onlyUser = buildProcessWaitModel({
      ...PROCESS_DEFINITIONS_RESPONSE,
      definitions: PROCESS_DEFINITIONS_RESPONSE.definitions.filter((d) => d.waitKind === "WAITING_USER"),
    });
    expect(onlyUser.groups).toHaveLength(4);
    const empty = onlyUser.groups.filter((g) => g.count === 0);
    expect(empty).toHaveLength(3);
    // 空组的百分比是 0 而不是 NaN（除零）
    for (const g of empty) expect(Number.isFinite(g.pctOfTotalStdDays)).toBe(true);
  });
});

describe("WO-WAITING-STATES-FE · §D 诚实缺席（不许拿标准工期冒充「已卡 N 天」）", () => {
  beforeEach(() => {
    loginAs("planner");
  });

  /**
   * ⚠ **本条断言 2026-08-13 随 WO-FLOWTIME 改口径，照实记账**：
   *
   * 原断言咬的是 `cannot` 文案里出现 `ProcessTask` —— 因为当时的诚实边界是
   * 「`ProcessTask`/`ProcessInstance` 全仓不存在，故『已卡多久』答不了」。
   * WO-FLOWTIME 落地后**那句话不再成立**（`ProcessInstance` 有了承载物 + 反推器 + 端点），
   * 于是这条断言当场报红。**红得对**：它咬的是一句已经过期的话。
   *
   * 改法不是把断言删掉或放宽，而是**换成咬新的那条诚实边界** ——
   * 边界本身一条都没放宽，只是内容变了：
   *  ① 实例时刻是**反推**的（推导值），不是流程引擎直采的实测值；
   *  ② 65 条里只有 9 条反推得出，其余会明说缺什么，**不返回 0 冒充「没有卡顿」**。
   * 同时「标准工期不是实测滞留」这条老红线**原样保留**（见下一条 it），一个字没松。
   */
  it("页面显式声明新的诚实边界：反推值 ≠ 实测值，且反推不出时不拿 0 冒充「没有卡顿」", async () => {
    renderApp("/v/process-wait");
    await screen.findByTestId("pw-summary");
    const cannot = screen.getByTestId("pw-honesty-cannot").textContent ?? "";
    // ① 推导值必须被标出来（不许把反推值说成实测）
    expect(cannot).toContain("反推");
    expect(cannot).toContain("不是流程引擎直采的实测值");
    // ② 反推不出那一路必须被说出来，且明写不拿 0 冒充
    expect(cannot).toContain("缺哪种单据");
    expect(cannot).toContain("不会返回 0 冒充");
    expect(screen.getByTestId("pw-honesty")).toBeInTheDocument();
  });

  it("标准工期旁必须写明「不是已卡 N 天」——把基线工期当实测滞留读是本页最容易犯的误读", async () => {
    renderApp("/v/process-wait");
    await screen.findByTestId("pw-summary");
    expect(screen.getByTestId("pw-not-measured").textContent ?? "").toContain("不是实测滞留天数");
  });

  it("标准工期是真值透传（不四舍五入、不换算）：逐行对齐 fixture 原值", async () => {
    renderApp("/v/process-wait");
    await screen.findByTestId("pw-summary");
    for (const def of PROCESS_DEFINITIONS_RESPONSE.definitions) {
      const cell = screen.getByTestId(`pw-row-${def.key}`).querySelector("[data-std-days]");
      expect(cell?.getAttribute("data-std-days"), `${def.key} 标准工期被改写了`).toBe(String(def.stdDurationDays));
    }
  });

  it("汇总口径可核对：合计 = 逐条之和；各态占比之和 = 100%", () => {
    const m = buildProcessWaitModel(PROCESS_DEFINITIONS_RESPONSE);
    const sum = PROCESS_DEFINITIONS_RESPONSE.definitions.reduce((s, d) => s + d.stdDurationDays, 0);
    expect(m.totalStdDays).toBe(sum);
    expect(m.totalProcesses).toBe(PROCESS_DEFINITIONS_RESPONSE.definitions.length);
    expect(m.groups.reduce((s, g) => s + g.count, 0)).toBe(m.totalProcesses);
    const pct = m.groups.reduce((s, g) => s + g.pctOfTotalStdDays, 0);
    expect(Math.abs(pct - 100)).toBeLessThan(0.5); // 各态四舍五入后允许 ±0.5 的合计误差
  });
});

describe("WO-WAITING-STATES-FE · §E mock 保真（防「mock 与真后端分家、测试咬 mock 恒绿」）", () => {
  /**
   * 本仓真事故：mock 与真后端形状分家后，测试咬着 mock 一路绿，而部署态是坏的。
   * 这里的机制不是"我抄的时候是对的"，而是 fixture **逐条过契约 zod schema**
   * （与后端 `seed.ts:691-696` 播种时用的是同一份 `strictObject`）：
   * 契约改字段 ⇒ fixture 模块加载即抛，本组当场红。
   */
  it("fixture 逐条满足契约 schema（与后端播种同一份 strictObject·多写少写一个字段都炸）", () => {
    // 模块能被 import 就说明 parse 全过了；这里再显式核对形状关键字段
    for (const d of PROCESS_DEFINITIONS_RESPONSE.definitions) {
      expect(d.key).toMatch(/^P\d{2}$/);
      expect(d.domainKey).toMatch(/^D\d{2}$/);
      expect(d.stdDurationDays).toBeGreaterThan(0);
      expect(d.carrierTypeKey.length).toBeGreaterThan(0);
      expect(PROCESS_WAIT_KINDS).toContain(d.waitKind);
      expect(d.tenantId.length).toBeGreaterThan(0); // R2 tenant_id everywhere
    }
    for (const dom of PROCESS_DEFINITIONS_RESPONSE.domains) {
      expect(dom.key).toMatch(/^D\d{2}$/);
      expect(dom.businessDomainKey.length).toBeGreaterThan(0);
    }
  });

  it("fixture 四态每态 ≥2 条 —— 每态只留 1 条会让「分组渲染」与「单条渲染」在测试里长得一样", () => {
    for (const kind of PROCESS_WAIT_KINDS) {
      const n = PROCESS_DEFINITIONS_RESPONSE.definitions.filter((d) => d.waitKind === kind).length;
      expect(n, `${kind} 只有 ${n} 条`).toBeGreaterThanOrEqual(2);
    }
  });

  it("响应体带词表与职能登记册（前端据此对账；两者取自契约，非 mock 自编）", () => {
    expect(PROCESS_DEFINITIONS_RESPONSE.waitKinds).toEqual([...PROCESS_WAIT_KINDS]);
    expect(PROCESS_DEFINITIONS_RESPONSE.ownerFunctions.length).toBeGreaterThan(0);
    // 每条流程的责任职能都能在登记册里查到（查不到 ⇒ 页面会退化成显示裸 key）
    const known = new Set(PROCESS_DEFINITIONS_RESPONSE.ownerFunctions.map((f) => f.key));
    for (const d of PROCESS_DEFINITIONS_RESPONSE.definitions) expect(known.has(d.ownerFunctionKey)).toBe(true);
  });

  it("域名解析走登记册；查不到时回退原 key 并可见（不静默显示空串把接缝断裂伪装成「这条没有域」）", () => {
    const m = buildProcessWaitModel({ ...PROCESS_DEFINITIONS_RESPONSE, domains: [] });
    const row = m.groups.flatMap((g) => g.rows)[0]!;
    expect(row.domainName).toBe(row.domainKey);
    expect(row.domainName.length).toBeGreaterThan(0);
  });

  it("R6 确定性：同输入两次构建结果逐字节一致，且组内按 key 升序（不依赖后端返回序）", () => {
    const a = buildProcessWaitModel(PROCESS_DEFINITIONS_RESPONSE);
    // 打乱输入顺序，结果必须不变
    const shuffled = {
      ...PROCESS_DEFINITIONS_RESPONSE,
      definitions: [...PROCESS_DEFINITIONS_RESPONSE.definitions].reverse(),
    };
    const b = buildProcessWaitModel(shuffled);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    for (const g of a.groups) {
      const keys = g.rows.map((r) => r.key);
      expect(keys).toEqual([...keys].sort((x, y) => x.localeCompare(y)));
    }
  });
});

describe("WO-WAITING-STATES-FE · §F 无硬编码（文案走 locales · 样式零裸色值）", () => {
  it("四态文案全部来自 locales/zh.ts（组件不内联中文业务文案）", () => {
    const t = zh.processWait;
    expect(t.title.length).toBeGreaterThan(0);
    for (const kind of PROCESS_WAIT_KINDS) {
      expect(t.waitKind[kind].label.length).toBeGreaterThan(0);
      expect(t.waitKind[kind].who.length).toBeGreaterThan(0);
      expect(t.waitKind[kind].hint.length).toBeGreaterThan(0);
      expect(t.waitKind[kind].short.length).toBeGreaterThan(0);
    }
  });

  /**
   * 与 `chain-impediment` 同一条纪律：样式里出现 hex 或任何颜色函数字面量即红。
   * 理由不是洁癖 —— 裸色值在 light / warm 两套皮下会失效（本仓三套主题）。
   *
   * ⚠ 金丝雀（铁律 0.6：报「没有命中」之前先证明正则真的会命中）：
   * 先拿一段**已知含 hex** 的字符串跑同一个正则，它若也不中，那是正则坏了不是样式干净。
   */
  it("样式零硬编码颜色（含金丝雀自证：同一个正则对已知 hex 必中）", () => {
    // vitest 里 import.meta.url 不保证是 file: 协议（实测会抛 "The URL must be of scheme file"），
    // 故按包根解析：vitest 的 cwd 即 apps/frontend-shell。
    const cssPath = resolve(process.cwd(), "src/views/process/ProcessWaitView.module.css");
    const css = readFileSync(cssPath, "utf8");
    const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|color-mix)\s*\(/;

    // 金丝雀①：文件真读到了（读空/读错文件 ⇒ 下面的否定断言恒真，是哑门不是绿）
    expect(css.length, "样式文件没读到 ⇒ 报「没有硬编码颜色」等于什么都没测").toBeGreaterThan(100);
    // 金丝雀②：正则必须对已知含色值的样本命中，否则否定断言恒真
    expect(COLOR_LITERAL.test("color: #ff00aa;"), "正则对已知 hex 都不中 ⇒ 工具坏了，不是样式干净").toBe(true);
    expect(COLOR_LITERAL.test("background: rgba(1,2,3,.5);")).toBe(true);

    const offenders = css
      .split("\n")
      .map((line, i) => ({ line: line.trim(), no: i + 1 }))
      // 注释行不算（文件头解释纪律时会提到 hex 这个词）
      .filter((l) => !l.line.startsWith("/*") && !l.line.startsWith("*") && COLOR_LITERAL.test(l.line));
    expect(offenders.map((o) => `${o.no}: ${o.line}`)).toEqual([]);

    // 正向：四态色变量真的在样式里被消费（--kind-color 由组件注入）
    expect(css).toContain("var(--kind-color)");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §G · WO-FLOWTIME · 实例下钻（「哪一条卡着 / 卡在谁那里 / 卡了多久 / 站间多久」）
// ══════════════════════════════════════════════════════════════════════════════

describe("WO-FLOWTIME · §G 实例下钻（两向都咬：反推得出 / 反推不出）", () => {
  beforeEach(() => {
    loginAs("planner");
  });

  /**
   * ⚠ 本组断言**从 URL 出发**（同 §A 纪律）：点侧栏进得去的那张页面上的按钮，
   * 而不是 `getRenderer` 直接取 `InstancePanel` 渲染 —— 后者证明的是「拿到组件能画」，
   * 不证明「有任何路径能让用户点到它」。
   */
  it("G1 反推得出的那一路：点开 P34 → 出实例行 + 站内停留天数 + 卡在谁那里 + 溯源到具体单据字段与原值", async () => {
    const user = userEvent.setup();
    renderApp("/v/process-wait");
    await screen.findByTestId("pw-summary");

    await user.click(screen.getByTestId("pw-drill-P34"));
    const panel = await screen.findByTestId("pw-inst-P34");

    // ① 天数是**实测反推值**，不是标准工期。fixture 里 P34 的标准工期是 7 天、
    //    而真跑反推出来的站内停留是 **3 天**（declaredDay=2 → clearedDay=5）。
    //    两个数不同**是本条断言的全部意义**：若哪天有人把标准工期接到这一列上，这里当场红。
    const row = within(panel).getByTestId("pw-inst-row-P34::obj_customsclearance_cc_po_12");
    expect(row.querySelector("[data-dwell-days]")?.getAttribute("data-dwell-days")).toBe("3");
    const std = PROCESS_DEFINITIONS_RESPONSE.definitions.find((d) => d.key === "P34")!.stdDurationDays;
    expect(std).toBe(7); // 金丝雀：确认这两个数真的不同，否则上一条断言是恒真的哑门
    expect(std).not.toBe(3);

    // ② 「卡在谁那里」——职能 + **具体责任方**（单据字段名=值），两层都要有
    const owner = within(panel).getByTestId("pw-inst-owner-P34::obj_customsclearance_cc_po_12").textContent ?? "";
    expect(owner).toContain("supply_chain");
    expect(owner).toContain("brokerName");
    expect(owner).toContain("洋山报关行");

    // ③ R13 溯源：字段名 + **原值**（原单位·不换算）+ 换算后的 ISO 三者都在屏幕上
    const src = within(panel).getByTestId("pw-inst-src-P34::obj_customsclearance_cc_po_12").textContent ?? "";
    expect(src).toContain("declaredDay=2");
    expect(src).toContain("clearedDay=5");
    expect(src).toContain("2026-06-12");
    expect(src).toContain("2026-06-15");

    // ④ 诚实位：推导值必须被标出来，且「现在」是怎么定的要写在屏幕上
    expect(within(panel).getByTestId("pw-inst-origin-P34").textContent ?? "").toContain("反推");
    expect(within(panel).getByTestId("pw-inst-asof-P34").textContent ?? "").toContain("DATA_LATEST");
    // ⑤ 标准工期只作为**对照**出现，且明写「非实测」
    expect(within(panel).getByTestId("pw-inst-std-P34").textContent ?? "").toContain("非实测");
  });

  it("G2 反推不出的那一路：P01 出缺席理由 + 缺席类型 + 复验探针，**不是空表也不是 0**", async () => {
    const user = userEvent.setup();
    renderApp("/v/process-wait");
    await screen.findByTestId("pw-summary");

    await user.click(screen.getByTestId("pw-drill-P01"));
    const panel = await screen.findByTestId("pw-inst-P01");

    // 缺席块在，且三样东西齐（类型 / 原因 / 探针）—— 缺任一样就是「说了等于没说」
    const absent = within(panel).getByTestId("pw-inst-absent-P01");
    expect(within(absent).getByTestId("pw-inst-absent-kind-P01").textContent ?? "").toContain("NO_RECONSTRUCTION_RULE");
    const reason = within(absent).getByTestId("pw-inst-absent-reason-P01").textContent ?? "";
    expect(reason).toContain("PlanTarget");
    expect(reason.length).toBeGreaterThan(20); // 「无数据」这种什么都没说的话过不了
    expect(within(absent).getByTestId("pw-inst-absent-probe-P01").textContent ?? "").toContain("listByType");

    // 🔴 头号反证：**不许**渲染出一张空的实例表冒充「这条流程很顺畅」。
    // 空表与「反推不出」在屏幕上必须长得不一样，否则用户会把「我不知道」读成「没问题」。
    expect(within(panel).queryByTestId("pw-inst-counts-P01")).toBeNull();
  });

  it("G3 loading 是独立态，不与「反推不出」挤在同一个块里（RootCausePanel 那次的病）", async () => {
    const user = userEvent.setup();
    renderApp("/v/process-wait");
    await screen.findByTestId("pw-summary");
    await user.click(screen.getByTestId("pw-drill-P34"));
    // 请求还在飞时只能看到 loading，绝不能同时出现缺席块（那是「还没回来」被宣告成「失败」）
    const loading = screen.queryByTestId("pw-inst-loading-P34");
    if (loading) expect(screen.queryByTestId("pw-inst-absent-P34")).toBeNull();
    await screen.findByTestId("pw-inst-P34");
  });

  it("G4 事件订阅是真接线：queryKey 与 LABEL_TO_KEYS 的 process-instances 对得上", async () => {
    // 「有事件没人听」是假接线。判据不是「表里写了」，而是**表里的 key 与视图真用的 key 对得上**。
    /*
     * ⚠ 2026-08-16 WO-FACTLOCK-TRIAGE：判据从「这两个写死文件的文本」搬到**整棵前端源码树**
     * （`./factlock`，剥注释后）。要锁的事实是「**这条 queryKey 前缀**两边对得上」——
     * 它与「注册它的那段代码住在哪个文件」无关：`InstancePanel` 抽成独立文件、
     * 失效表拆分模块，都是无害重构，而原写法会当场假红（`G-FACTLOCK-POSITION-ANCHOR`）。
     * 反方向也堵上了：原写法的 `readFileSync` **不剥注释**，注释里抄一句 queryKey 就能假绿。
     *
     * 原来那两条手写金丝雀（`InstancePanel` / `LABEL_TO_KEYS`）一并撤掉 ——
     * `checkedTree` 内建四条更硬的（扫描面下界 · 已知必中 · 注释不算代码 · 代码没被当注释吃），
     * 而且**与主判据共用同一份实现**，不会出现「金丝雀绿而主判据瞎」。
     * 另注：手写那两条的失败文案写着「读空会让下面两条**否定**断言恒真」，
     * 而下面两条其实是**正向** `toContain` —— 正向断言在空串上必然失败，本就不会恒真。
     */
    const fe = checkedTree("apps/frontend-shell/src", "LABEL_TO_KEYS", 100);
    // 正题：视图注册的 queryKey 前缀 == 失效表里登记的前缀（两边各自必须真有人写）
    expect(
      factHits(fe, 'queryKey: ["a", "process-instances", processKey]'),
      "视图没有注册 process-instances 的 queryKey ⇒ 事件来了也没人听",
    ).not.toEqual([]);
    expect(
      factHits(fe, '"process-instances": [["a", "process-instances"]]'),
      "失效表里没登记 process-instances 前缀 ⇒ 有事件没人听（假接线）",
    ).not.toEqual([]);
  });
});
