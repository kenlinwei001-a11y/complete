import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BuildNeedsReport } from "@platform/contracts";
import { BuildNeedsReportSchema, MODULE_KINDS, MODULE_KIND_REGISTRY } from "@platform/contracts";
import { runDataBuilder } from "@/api/endpoints";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-DBUI-13-NEEDS · 第 ② 步「显示目前缺少的信息」——接缝驱动测试（前端半）。
 *
 * ══ 接缝在哪 ══════════════════════════════════════════════════════════════════
 * **后端干跑回执的逐类清单 → 屏上 13 类各自的那句话**。
 * 所以本文件不隔离渲染组件，而是从**真入口**走：登录 → 进数据构建页 →
 * 在脚本框里打字 → 点「开始」→ 等第 ② 步。任一半漏（后端不发 / 前端不读 / 字段改名）即红。
 *
 * ══ 最要害的一条 ══════════════════════════════════════════════════════════════
 * 「查不到」和「不缺」在屏上**必须长得不一样**。
 * 建之前，7 类跨系统需求的现状真的查不到；若照老逻辑默认成「本次新建 N」，
 * 或者干脆渲染成「复用 0 · 待建 0」，看的人都会读成**已经清点过了**。
 * §3 咬死：这几类屏上出现的是「要等创建时才知道」，且**不出现 0 这个数**。
 *
 * ⛔ 同时咬「13 个标题不算显示了 13 类」：每一类都必须有**非空且互不相同**的结论文案，
 *    光有标题、结论是空串的，§2 当场红。
 */

/**
 * 截下 UI **这一次**真正收到的那份干跑回执。
 *
 * ⚠ 不许拿「测试自己再调一次接口」代替：那证明的是「接口回得出 13 类」，
 *   **不是**「屏上这些卡是那份回执变来的」—— 两件事不同，§6 要的是后者。
 *   （形态同本仓那条老账：「我用 X 当作 Y 的证据，而 X 并不度量 Y」。）
 *
 * ⚠ 同时这是**去掉硬写类名**的支点：哪几类跨系统、哪几类查不到，
 *   一律从回执自己的 `side` / `evidence` 读，不在测试里另抄一份类名清单 ——
 *   抄了就会在「契约新增一类 / 改个名」时**悄悄少测**，而 typecheck 一个字都看不见。
 */
function captureReceipt(): { get: () => BuildNeedsReport | undefined; stop: () => void } {
  let got: BuildNeedsReport | undefined;
  const onResponse = async ({ request, response }: { request: Request; response: Response }) => {
    if (!request.url.includes("/a/v1/data-builders/run")) return;
    const body = (await response.clone().json()) as { needs?: BuildNeedsReport };
    if (body?.needs) got = body.needs;
  };
  server.events.on("response:mocked", onResponse);
  return { get: () => got, stop: () => server.events.removeListener("response:mocked", onResponse) };
}

/** 从真入口走到第 ② 步（输入脚本 → 开始 → 逐类清点出现），并交出 UI 实收的那份回执。 */
async function reachStepTwo() {
  const user = userEvent.setup();
  const cap = captureReceipt();
  loginAs("planner");
  renderApp("/admin/data-builder");
  await screen.findByTestId("data-builder-page");

  // ① 真的在脚本框里打字（不是直接调 mutation）—— 这才是「经真入口驱动」
  const script = screen.getByTestId("dbf-script") as HTMLTextAreaElement;
  await user.clear(script);
  await user.type(script, "常州基地产能紧张，影响订单交期与客户信用");
  await user.click(screen.getByTestId("dbf-start"));

  // ⚠ 2026-08-19 WO-TIMEOUT-5000-SWEEP：findBy 预算 5s→20s（共享机高负载假红，同型见 c9ff5936f）；判据未动。
  const needs = await screen.findByTestId("dbf-needs", undefined, { timeout: 20000 });
  // 金丝雀：真截到了回执才往下比；截不到 = 探针坏了，不许读成「没差异」
  await waitFor(() => expect(cap.get(), "没截到干跑回执 —— 后面的比对全是空转").toBeTruthy());
  const receipt = cap.get()!;
  cap.stop();
  return { user, needs, receipt };
}

/** 屏上的「一类一张卡」= 同时带 `data-evidence` 与 `data-needed` 的那些节点（标题/结论/明细/条目都没有这两个属性）。 */
function cardsOf(needs: HTMLElement): Element[] {
  return [...needs.querySelectorAll("[data-evidence][data-needed]")];
}

describe("WO-DBUI-13-NEEDS · 第 ② 步逐类清点（接缝：干跑回执 → 屏上 13 类）", () => {
  /*
   * §0 是**这条接缝的另一端**：屏上好看不代表接得上真后端。
   * 前端这半跑在 mock 上，若 mock 的形状与共享契约漂了（后端改字段名、少一个字段），
   * 上面 5 条照样全绿，而生产环境第 ② 步会空白 —— 那正是本仓「绿测试≠能用·断在接缝」的老坑。
   * 故这里拿**共享契约**去校验 mock 真正回的那份 JSON：漂了当场红。
   */
  it("§0 干跑回执里的逐类清单**合共享契约**（mock 与真后端不许各说各话）", async () => {
    loginAs("planner");
    const job = await runDataBuilder({ script: "常州基地产能紧张", seed: 42, dryRun: true, builderKey: "foundry-grade-data-builder" });
    expect(job.needs, "干跑回执里没有逐类清单 —— 第 ② 步无米下锅").toBeTruthy();
    const parsed = BuildNeedsReportSchema.parse(job.needs); // 形状不合契约即抛
    expect(parsed.groups.map((g) => g.kind)).toEqual([...MODULE_KINDS]);
  });


  it("§1 13 类逐类上屏，一类不少 —— 且每一类的名字是人话，不是内部键名", async () => {
    const { needs } = await reachStepTwo();

    for (const kind of MODULE_KINDS) {
      within(needs).getByTestId(`dbf-need-${kind}`); // 这一类的卡片在屏上（不在即抛）
      const label = MODULE_KIND_REGISTRY.find((m) => m.kind === kind)!.label;
      /*
       * ⚠ 判据落在**类名那一行**，不是整张卡片。
       *   第一版写成「整张卡片的文本里不许出现 `kind`」，被自己的用例当场证伪：
       *   条目键 `plan_risk_inference` 含 "plan" —— 那是**用户要看的数据**（缺的就是这一条），
       *   不是内部黑话。拿「卡片里出现了这个串」当「内部键名上屏了」的证据，
       *   度量的根本不是同一件事。
       */
      const heading = within(needs).getByTestId(`dbf-need-label-${kind}`);
      expect(heading.textContent, `${kind} 的类名没用人话`).toBe(label);
    }
    // 整条墙钟预算同理上调（WO-TIMEOUT-5000-SWEEP）：renderApp+懒加载链路在共享机负载下会超全局 20s。
  }, 60000);

  it("§2 每一类都**说得出话**：结论非空 —— 13 个空标题不算「显示了 13 类」", async () => {
    const { needs } = await reachStepTwo();

    const verdicts = MODULE_KINDS.map((kind) => {
      const v = within(needs).getByTestId(`dbf-need-verdict-${kind}`);
      return (v.textContent ?? "").trim();
    });
    // 金丝雀：真取到了 13 条文案，不是空数组恒真
    expect(verdicts.length).toBe(MODULE_KINDS.length);
    for (const [i, text] of verdicts.entries()) {
      expect(text.length, `第 ${i + 1} 类的结论是空的（空壳冒充「显示了」）`).toBeGreaterThan(0);
    }
    // 不许所有类都是同一句话（那等于什么都没说）
    expect(new Set(verdicts).size).toBeGreaterThan(1);
  }, 60000);

  it("§3 【要害】查不到的那几类**明说查不到**，不渲染成 0（0 会被读成「不缺」）", async () => {
    const { needs, receipt } = await reachStepTwo();

    // 屏上先集中点名一次（散在卡片里容易被漏读）
    const unprobed = within(needs).getByTestId("dbf-needs-unprobed");
    expect(unprobed.textContent).toContain("还查不出");

    // 「哪几类查不到」由**回执**说了算 —— 不在测试里另抄一份类名清单（抄了就会悄悄少测）
    const unprobedGroups = receipt.groups.filter((g) => g.evidence === "NOT_PROBED");
    // 金丝雀：这一屏真的存在「查不到」的类，否则下面整段是空转恒真
    expect(unprobedGroups.length, "本屏一个「查不到」的类都没有 —— §3 整段空转").toBeGreaterThan(0);
    // 不变量：查不到的只可能是跨系统那半（本系统这半直查得到，查不到就是后端出了别的错）
    for (const g of unprobedGroups) expect(g.side, `${g.kind} 不是跨系统类却报查不到`).toBe("cross_system");

    for (const g of unprobedGroups) {
      const kind = g.kind;
      const card = within(needs).getByTestId(`dbf-need-${kind}`);
      expect(card.getAttribute("data-evidence"), `${kind} 屏上没标成查不到`).toBe("NOT_PROBED");
      const verdict = within(card).getByTestId(`dbf-need-verdict-${kind}`).textContent ?? "";
      // 明说：这一刻不知道
      expect(verdict, `${kind} 没说清「现在查不到」`).toContain("要等创建时才知道");
      // 且**不摆出 0** —— 「复用 0 / 待建 0」会被读成「已经清点过、不缺」
      expect(verdict, `${kind} 把「查不到」渲染成了 0`).not.toMatch(/0/);
      // 点开看到的每一条也必须标「现状查不到」，不是「本次新建」
      const detail = within(card).getByTestId(`dbf-need-detail-${kind}`);
      expect(detail.textContent).toContain("现状查不到");
      expect(detail.textContent).not.toContain("本次新建");
    }
  }, 60000);

  /*
   * §4 的三类样本**全部由回执自己挑**（「有复用的那一类」「代码类」「本次用不到的那一类」），
   * 不点名 `ontology_type` / `solver` / `mcp`。理由同 §3：类名硬写在测试里，
   * 契约改名或新增一类时**悄悄少测**，而 typecheck 看不见字符串里的类名。
   */
  it("§4 查得到的那几类给的是**真数**：复用 / 待建 / 建不出 分得开", async () => {
    const { needs, receipt } = await reachStepTwo();

    // ① 有复用的那一类 —— 「复用了既有的」正是"人不清楚库里现状"的正面回答
    const reuse = receipt.groups.find((g) => g.evidence === "PROBED" && g.existing > 0);
    expect(reuse, "回执里没有任何「复用了既有」的类 —— 这段无从验起").toBeTruthy();
    const reuseCard = within(needs).getByTestId(`dbf-need-${reuse!.kind}`);
    expect(reuseCard.getAttribute("data-evidence")).toBe("PROBED");
    expect(within(reuseCard).getByTestId(`dbf-need-verdict-${reuse!.kind}`).textContent).toContain(`复用 ${reuse!.existing}`);
    const existsItem = reuse!.items.find((i) => i.status === "EXISTS")!;
    expect(within(reuseCard).getByTestId(`dbf-need-item-${reuse!.kind}-${existsItem.key}`).textContent).toContain("库里已有");

    // ② 代码类（求解器）不能自动建 ⇒ 缺的那个必须说「建不出来」，不能混进「待建」
    const code = receipt.groups.find((g) => g.side === "code" && g.missing > 0);
    expect(code, "回执里没有「建不出来」的代码类 —— 这段空转").toBeTruthy();
    const codeCard = within(needs).getByTestId(`dbf-need-${code!.kind}`);
    expect(within(codeCard).getByTestId(`dbf-need-verdict-${code!.kind}`).textContent).toContain(`建不出 ${code!.missing}`);
    const missingItem = code!.items.find((i) => i.status === "MISSING")!;
    expect(within(codeCard).getByTestId(`dbf-need-item-${code!.kind}-${missingItem.key}`).textContent).toContain("建不出来");

    // ③ 本次用不到的类也要说话（needed=0 是一个确定的答案，不是空壳）
    const unused = receipt.groups.find((g) => g.needed === 0);
    expect(unused, "回执里没有 needed=0 的类 —— 这段空转").toBeTruthy();
    const unusedCard = within(needs).getByTestId(`dbf-need-${unused!.kind}`);
    expect(unusedCard.getAttribute("data-needed")).toBe("0");
    expect(within(unusedCard).getByTestId(`dbf-need-verdict-${unused!.kind}`).textContent).toContain("本次用不到");
  }, 60000);

  it("§5 「缺几个」在第一层，「缺哪几个」点开才看 —— 明细确实挂在折叠里", async () => {
    const { needs, receipt } = await reachStepTwo();

    // 样本由回执自己挑：随便哪一类，只要本次真有「待建」的条目（类名不硬写，理由同 §3/§4）
    const grp = receipt.groups.find((g) => g.items.some((i) => i.status === "TO_CREATE"));
    expect(grp, "回执里没有任何「本次新建」的条目 —— §5 无从验起").toBeTruthy();
    const card = within(needs).getByTestId(`dbf-need-${grp!.kind}`);
    const detail = within(card).getByTestId(`dbf-need-detail-${grp!.kind}`);
    // 明细的宿主是原生折叠（第二层），不是直接摊在第一层
    expect(detail.tagName.toLowerCase()).toBe("details");
    expect((detail as HTMLDetailsElement).open).toBe(false);
    // 结论那一行**不在**折叠里（它属于第一层）
    expect(detail.contains(within(card).getByTestId(`dbf-need-verdict-${grp!.kind}`))).toBe(false);
    // 点开之后逐条可见，且每条都带现状
    const toCreate = grp!.items.find((i) => i.status === "TO_CREATE")!;
    expect(within(detail).getByTestId(`dbf-need-item-${grp!.kind}-${toCreate.key}`).textContent).toContain("本次新建");
  }, 60000);

  /**
   * §6【本单要害·WO-BUILDPLAN-13CARDS】**后端回了几类，屏上就得有几张卡**。
   *
   * 为什么 §1 不够：§1 逐个 `kind` 去 `getByTestId`，能抓「少渲染了某一类」，
   * 却**抓不住「屏上这些卡根本不是从回执来的」** —— 若前端改成照 `MODULE_KIND_REGISTRY`
   * 这个常量摆 13 张卡、结论写死一句话，§1/§2 照样全绿。
   * 那正是本仓「绿测试≠能用」的老形态：**测试咬的是常量，不是那条链**。
   *
   * 故本条把判据落在**同一次驱动里 UI 真正收到的那份 JSON** 上，且比两件事：
   *   ① 卡片数 == 回执 `groups` 数（多渲、漏渲、拿常量凑数，三种都红）；
   *   ② 每张卡的 `data-needed` == 该组回执里的 `needed`（证明数字是**读来的**不是**摆出来的**）。
   */
  it("§6 【要害】后端回几类屏上就几张卡，且卡上的数字来自回执而非常量", async () => {
    const { needs, receipt } = await reachStepTwo();

    // 金丝雀：回执真的非空，否则下面两条比对恒真
    expect(receipt.groups.length, "回执里一个类都没有 —— §6 整段空转").toBeGreaterThan(0);

    const cards = cardsOf(needs);
    expect(
      cards.length,
      `后端回了 ${receipt.groups.length} 类，屏上却是 ${cards.length} 张卡`,
    ).toBe(receipt.groups.length);

    // 逐类核对数字来源（kind 取自回执，测试里一个类名字面量都不写）
    for (const g of receipt.groups) {
      const card = within(needs).getByTestId(`dbf-need-${g.kind}`);
      expect(card.getAttribute("data-needed"), `${g.kind} 卡上的「需几个」与回执对不上`).toBe(String(g.needed));
    }
  }, 60000);
});
