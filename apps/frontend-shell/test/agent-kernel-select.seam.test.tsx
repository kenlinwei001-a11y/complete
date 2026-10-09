import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { db } from "@/mocks/db";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";

/**
 * WO-AGENT-KERNEL-SELECT · Agent 编辑器「运行内核」选择器接缝。
 *
 * **接缝在哪**：契约 `AgentDefinition.kernel`（additive 可选）× 编辑器表单（初值/回显）
 * × 保存通道（`PUT /b/v1/agents/:id` body 必须带上 kernel——**静默丢字段同族病**第五例
 * 防线：本单前面已有 MCP-FORWARD/TOOLSETTLE 四例，全是「映射层少抄一个字段」）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ⚑ WO-NATIVE-RETIRE-FIX（2026-10-09）· **本文件的断言被改过，理由留在原地**
 * ═══════════════════════════════════════════════════════════════════════════════
 * **旧口径**（原 ① 断言）：**「缺省（字段缺失）≡ 原生 ⇒ 选择器回显『原生内核』」**，
 *   下拉只有两态 `NATIVE`/`EXTERNAL`。它当时是真话：内核标识上线前外部运行时开关恒关闭
 *   （休眠门机器守 + 出货 compose 显式 0），故缺失确实可证 ≡ 原生。
 * **何时作废**：2026-10-09。仓主裁决旧内核退役（原话「都改掉，不考虑回退」）——
 *   写侧 `POST/PUT /b/v1/agents` 对显式 `"NATIVE"` **一律 400**（错误原文「kernel:"NATIVE"
 *   已被拒：…回退方式已不提供」），`kernel` 字段也不再被执行层读取（执行恒走 DSH）。
 * **为什么连断言一起改**：旧断言钉住的正是**后端已经不认的语义**。它当时还是绿的，
 *   而绿的原因就是病灶本身 —— 编辑器把「字段缺失」捏造成 `"NATIVE"` 塞进表单，保存时整份
 *   PUT 上去。后果是用户可见的：**存量记录（字段缺失）连「只改个名字」都存不下来**，
 *   而且会读到一条他**从没选过**的退役报错（改前实测：同形载荷在旧基线 200、在本单 400）。
 * **新口径**：缺省 = **未设置**（下拉第一项，屏上就是当前真值，不冒充任何内核取值）；
 *   可选项只有**写侧仍接受**的取值；用户**没动过**内核 ⇒ 保存载荷**不带 `kernel` 键**
 *   （不替用户发出他从没做过的选择）；**显式选了** ⇒ 原样带上（功能不许改哑）。
 *   记录现值若是已退役取值（存量数据）⇒ 只作**只读回显**，保存同样不发。
 * ⚠ 这不是「把断言改绿」：被改的是**语义本身**；新断言在旧实现上必须**红** —— 改前实跑
 *   （新断言 × 旧实现）：**① 红在它的显示断言上**（选择器回显 `NATIVE` 而不是「未设置」），
 *   ① 的载荷断言排在它后面、**根本没执行到**；**④ 也红**（退役取值没被锁成只读）。
 *   载荷面「不许替用户发出选择」的牙在 **④**（存量退役取值同样不许随保存上行）。
 *
 * **变异反证内建**：③ 把后端数据改掉（kernel=EXTERNAL）⇒ 选择器必须跟着变；
 * 纹丝不动 = 控件写死，那才是假绿。
 */
describe("WO-AGENT-KERNEL-SELECT · 编辑器运行内核选择器", () => {
  async function openDraftEditor() {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/agents");
    await user.click(await screen.findByText("周报生成 Agent（草稿）"));
    await screen.findByTestId("agent-editor");
    return user;
  }

  /** 捕获保存载荷的替身（与真后端 `PUT /b/v1/agents/:id` 同形状）：读 body 后原样落 mock 库。 */
  function captureSave() {
    const captured: Record<string, unknown>[] = [];
    server.use(
      http.put("*/b/v1/agents/:id", async ({ params, request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        captured.push(body);
        const agent = db.agents.find((a) => a.id === params.id);
        if (!agent) return HttpResponse.json({ error: "NOT_FOUND" }, { status: 404 });
        Object.assign(agent, body);
        return HttpResponse.json(agent);
      }),
    );
    return captured;
  }

  it("① 存量记录（无 kernel 字段）只改名字 ⇒ 能存下来，且载荷不带 kernel（不替用户发出选择）", async () => {
    expect(db.agents.find((a) => a.id === "agt-draft")!.kernel, "夹具被改动：agt-draft 应无 kernel 字段").toBeUndefined();
    const user = await openDraftEditor();
    const captured = captureSave();

    // 缺省 = 「未设置」这一项本身（空值），不是任何具体内核取值 —— 回显具体取值
    // 就等于替用户发出了一次他没做过的选择（这正是 400 的来源）。
    const select = await screen.findByLabelText("运行内核");
    expect(select, "存量记录（字段缺失）必须回显「未设置」，不许捏造一个用户没选过的取值").toHaveValue("");

    // 用户只改名字：内核选择器一下都没碰（存量记录的日常操作）。
    const nameInput = screen.getByLabelText("agent 名称");
    await user.clear(nameInput);
    await user.type(nameInput, "周报生成 Agent（改名）");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("已保存");

    expect(captured.length, "保存没有发出 PUT ⇒ 通道是死的").toBe(1);
    // eslint-disable-next-line no-console
    console.log(`[WO-NATIVE-RETIRE-FIX ①] 存量记录只改名字 ⇒ PUT body = ${JSON.stringify(captured[0])}`);
    expect(
      Object.keys(captured[0]!),
      "载荷里凭空多出 kernel 键 = 替用户发出了一次他没做过的内核选择（本单病灶；改前实跑红在 ① 的显示断言上，这条被挡在后面、没执行到）",
    ).not.toContain("kernel");
    const saved = db.agents.find((a) => a.id === "agt-draft")!;
    expect(saved.name, "改名必须真的落库（存量记录的日常操作不许被内核面挡住）").toBe("周报生成 Agent（改名）");
    expect(saved.kernel, "存量记录的缺失内核不许被前端补成任何具体取值").toBeUndefined();
  });

  it("② 显式选 DSH → 保存 ⇒ PUT body 带 kernel=\"EXTERNAL\" 且落 mock 库（不静默丢字段）", async () => {
    const user = await openDraftEditor();
    const captured = captureSave();

    const select = await screen.findByLabelText("运行内核");
    await user.selectOptions(select, "EXTERNAL");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByText("已保存");
    expect(captured.length, "保存没有发出 PUT ⇒ 通道是死的").toBe(1);
    // 字面量 "EXTERNAL" 是**断言标的**（退役后写侧唯一接受的显式取值），不是实现里抄来的常量。
    expect(captured[0]!.kernel, "PUT body 丢 kernel 字段 = 静默丢字段同族病；显式选择必须原样上行").toBe("EXTERNAL");
    expect(db.agents.find((a) => a.id === "agt-draft")!.kernel).toBe("EXTERNAL");
  });

  it("③ 变异反证：后端 agent 带 kernel=\"EXTERNAL\" ⇒ 选择器回显 DSH（控件不写死）", async () => {
    db.agents.find((a) => a.id === "agt-draft")!.kernel = "EXTERNAL";
    await openDraftEditor();
    const select = await screen.findByLabelText("运行内核");
    expect(select).toHaveValue("EXTERNAL");
  });

  it("④ 记录现值已是退役取值（存量数据）⇒ 只读回显、不可再选，且没动过就不随保存发出", async () => {
    // 存量数据形态：字段上线前被显式钉过（今天写侧拒收，但历史数据仍在库里，README 口径：不改不删）。
    db.agents.find((a) => a.id === "agt-draft")!.kernel = "NATIVE";
    const user = await openDraftEditor();
    const captured = captureSave();

    const select = await screen.findByLabelText("运行内核");
    expect(select, "存量退役取值必须回显（不许静默显示成别的状态）").toHaveValue("NATIVE");
    const retiredOption = Array.from(select.querySelectorAll("option")).find((o) => o.value === "NATIVE");
    expect(retiredOption?.disabled, "已退役取值不许再被选中（写侧 400）").toBe(true);

    // 只改描述：不做内核选择 ⇒ 载荷不许带这个已退役的取值，否则存量记录永远存不下来。
    const descInput = screen.getByLabelText("描述");
    await user.type(descInput, "补充描述");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("已保存");
    expect(captured.length).toBe(1);
    expect(
      Object.keys(captured[0]!),
      "载荷带存量退役取值 ⇒ 写侧 400，用户只是想改描述",
    ).not.toContain("kernel");
  });
});

/**
 * WO-AGENT-KERNEL-FORK-UI · 既有（PUBLISHED）Agent 的内核选择正路。
 *
 * **病灶**：编辑器 `editable = agent.status === "DRAFT"` 锁整表单（不可变发布语义，正确），
 * 但后端配套的 `POST /b/v1/agents/:id/new-version`（派生 DRAFT v+1）**前端没有任何入口调用它**
 * ⇒ PUBLISHED agent 在 UI 上是死胡同：不能改，也不告诉你怎么变成能改。
 * 仓主原话：「既有的无法选择，新建的可以选择」。
 *
 * **正路**（后端语义自带）：派生 DRAFT → 改（内核/任何字段）→ 发布。
 * 本单只补这条路的前端入口，**不动**不可变发布语义（PUBLISHED 表单保持锁定）。
 */
describe("WO-AGENT-KERNEL-FORK-UI · PUBLISHED agent 派生正路", () => {
  async function openPublishedEditor() {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/agents");
    await user.click(await screen.findByText("探索分析 Agent"));
    await screen.findByTestId("agent-editor");
    return user;
  }

  it("① PUBLISHED ⇒ 表单仍锁（不可变语义不动）+ 画出「派生新版本」入口（死胡同变正路）", async () => {
    await openPublishedEditor();
    const select = await screen.findByLabelText("运行内核");
    expect(select, "PUBLISHED 内核选择器必须保持锁定——派生不是绕过不可变语义的后门").toBeDisabled();
    expect(screen.getByTestId("agent-new-version"), "PUBLISHED agent 必须有派生入口，否则 UI 是死胡同").toBeEnabled();
  });

  it("② 派生 ⇒ 新 DRAFT v+1 落库且编辑器切换过去 ⇒ 内核选 DSH 保存进派生品（源版本不动）", async () => {
    const user = await openPublishedEditor();
    await user.click(screen.getByTestId("agent-new-version"));

    // 编辑器切到派生 DRAFT：内核选择器从锁定变可选（这是本单的标的）
    const select = await screen.findByLabelText("运行内核");
    await waitFor(() => expect(select).toBeEnabled(), { timeout: 15000 });

    const forked = db.agents.find((a) => a.key === "explore_agent" && a.status === "DRAFT");
    expect(forked, "派生后库里必须多一份 DRAFT（new-version 真落库，不是假动作）").toBeDefined();
    expect(forked!.version, "派生品版本 = 该 key 最新版 + 1（agt-explore 是 v2 ⇒ v3）").toBe(3);

    // 正路走通：选 DSH → 保存 → 内核落进派生品
    await user.selectOptions(select, "EXTERNAL");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("已保存");
    expect(db.agents.find((a) => a.id === forked!.id)!.kernel, "内核改动必须落进派生 DRAFT").toBe("EXTERNAL");
    expect(
      db.agents.find((a) => a.id === "agt-explore")!.kernel,
      "源 PUBLISHED 版本一个字节都不能被顺手改写（不可变发布语义）",
    ).toBeUndefined();
    expect(db.agents.find((a) => a.id === "agt-explore")!.status).toBe("PUBLISHED");
  });
});
