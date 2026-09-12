import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { ProtoLinkSchema, SchemaReconcileCandidateSchema } from "@platform/contracts";
import { fetchReconcileCandidates } from "@/api/endpoints";
import { checkedTree, factHits } from "./factlock";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-BEFE-E ③ · **对账候选 HITL 队列的接缝门**
 * （门 `befe-seam:check` 载体②；断点 `G-BE-FE-SEAM-DEAD`）：
 *
 *     `GET  /a/v1/databuilder/reconcile-candidates`             datacore `app.ts:4804`（requireAdmin）
 *     `POST /a/v1/databuilder/reconcile-candidates/:id/resolve` datacore `app.ts:4811`（requireAdmin）
 *
 * ── 病灶形态：**写端接了，读/写回端没接**（铁律 0.5 三形态之③「接了线接错地方」）─────
 * intake 那一步已经把候选逐条落库了 —— `apps/datacore/src/databuilder/intake-pipeline.ts:135`
 * 的 `intake_persist_candidates` 节点，注释原文「落对账队列：候选入 HITL 队列等人确认」。
 * 而前端只把**本次响应里**那几条当纯文本列出来：看得见一行字、一条都确认不了、刷新即消失。
 * 后端连 `schema_reconcile.resolved` 事件都备好了（app.ts:4819），却永远发不出去。
 *
 * ── 顺带咬死的两处**同型形状漂移**（本门第 ④ 组）───────────────────────────────
 * 前端此前手写重定义了一份 `IntakePreview`，两个字段名与后端/契约**不一样**：
 *   · 候选列：前端 `column`，后端 `prototypeColumn`（`prototype-intake.ts:144` / 契约 schema）
 *   · 关系：  前端 `{src,tgt}`，后端 `{from,to,origin}`（`prototype-intake.ts:104/111` / `ProtoLinkSchema`）
 * 真后端下这两处渲染出的是 `ORDER_DATA.undefined` 与「undefined →rel→ undefined」——
 * 屏上看不出错的空洞。没人发现是因为 **MSW 桩当年照着那份错的前端类型写**，
 * 页面与桩互相印证、一起错（本仓治过的「mock 与引擎口径分家 ⇒ 测试咬 mock 恒绿」同型事故）。
 * 本组用**契约 schema 亲自 parse 桩的输出**当判据 —— 桩再想漂就当场红，不靠人记得两边写成一样。
 */

const readRepoFile = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** 打开原型 intake 页并跑一次解析（= 后端 `intake_persist_candidates` 把候选落库那一步）。 */
async function intakeAndParse(user: ReturnType<typeof userEvent.setup>) {
  renderApp("/admin/prototype-intake");
  await screen.findByTestId("intake-page");
  await user.type(screen.getByTestId("intake-html"), "<table id=BASE_DATA></table>");
  await user.click(screen.getByTestId("intake-submit"));
  await screen.findByTestId("intake-reconcile");
}

describe("WO-BEFE-E ③ 对账候选 HITL 队列（GET …/reconcile-candidates · POST …/:id/resolve）", () => {
  beforeEach(() => {
    loginAs("planner");
  });
  afterEach(() => cleanup());

  it("③-A 用户点得到：解析后队列真出现落库的那条（不是本次响应里那份只读预览）", async () => {
    const user = userEvent.setup();
    await intakeAndParse(user);

    // 队列的数来自 `GET …/reconcile-candidates`（落库那份），不是把上面预览的条数抄一遍。
    await waitFor(() => expect(screen.getByTestId("reconcile-pending-count").textContent).toBe("1"));
    const truth = await fetchReconcileCandidates();
    // 金丝雀：队列非空，否则下面「逐条相等」是空胜。
    expect(truth.items.length, "队列为空 ⇒ 这条用例证明不了任何事").toBe(1);

    const cand = truth.items[0]!;
    const row = screen.getByTestId(`reconcile-row-${cand.id}`);
    expect(row.getAttribute("data-status")).toBe("PENDING");
    // ★ 屏上的原型列名来自响应的 `prototypeColumn`（不是 `undefined`）。
    expect(within(row).getByTestId(`reconcile-col-${cand.id}`).textContent).toBe(
      `${cand.datasetName}.${cand.prototypeColumn}`,
    );
    expect(within(row).getByTestId(`reconcile-col-${cand.id}`).textContent).not.toContain("undefined");
    // ★ 默认动作 = 后端给的**建议**（引擎算的信息，不是前端另选一个）。
    expect((within(row).getByTestId(`reconcile-action-${cand.id}`) as HTMLSelectElement).value).toBe(
      cand.suggestedAction,
    );
  });

  it("③-B 真 URL + 真 body：点「确认」→ POST …/:id/resolve，body = 屏上选的 action + target", async () => {
    const user = userEvent.setup();
    const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
    await intakeAndParse(user);
    await waitFor(() => expect(screen.getByTestId("reconcile-pending-count").textContent).toBe("1"));
    const cand = (await fetchReconcileCandidates()).items[0]!;

    server.use(
      http.post("*/a/v1/databuilder/reconcile-candidates/:id/resolve", async ({ request }) => {
        calls.push({ url: request.url, method: request.method, body: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json({ ...cand, status: "RESOLVED", resolvedAction: "RENAME", resolvedTarget: "Customer.name" });
      }),
    );

    // 刻意改成**与建议不同**的一组：body 里若还是 suggestedAction，说明发的是写死的默认值。
    await user.selectOptions(screen.getByTestId(`reconcile-action-${cand.id}`), "RENAME");
    await user.selectOptions(screen.getByTestId(`reconcile-target-${cand.id}`), "Customer.name");
    await user.click(screen.getByTestId(`reconcile-resolve-${cand.id}`));

    await waitFor(() => expect(calls.length, "点了确认一个请求都没发 ⇒ 入口仍是死的").toBe(1));
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url, `打错端点：${calls[0]!.url}`).toContain(
      `/a/v1/databuilder/reconcile-candidates/${encodeURIComponent(cand.id!)}/resolve`,
    );
    expect(calls[0]!.body).toEqual({ action: "RENAME", target: "Customer.name" });
  });

  it("③-C 效果层（本门的要害）：确认后后端那条真的翻 RESOLVED，屏上跟着变、待确认数归零", async () => {
    const user = userEvent.setup();
    await intakeAndParse(user);
    await waitFor(() => expect(screen.getByTestId("reconcile-pending-count").textContent).toBe("1"));
    const cand = (await fetchReconcileCandidates()).items[0]!;

    await user.click(screen.getByTestId(`reconcile-resolve-${cand.id}`));

    // ★ 后端侧真变了（读的是真端点，不是读组件 state）。
    await waitFor(async () => {
      const after = (await fetchReconcileCandidates()).items.find((c) => c.id === cand.id)!;
      expect(after.status, "确认后后端仍是 PENDING ⇒ 只改了屏，没改库").toBe("RESOLVED");
      expect(after.resolvedAction).toBe(cand.suggestedAction);
    });
    // ★ 屏上：那一行翻「已拍板」，待确认计数归零（重取而不是本地改一行）。
    await waitFor(() => expect(screen.getByTestId("reconcile-pending-count").textContent).toBe("0"));
    expect(screen.getByTestId(`reconcile-resolved-${cand.id}`).textContent).toContain("已拍板");
    expect(screen.queryByTestId(`reconcile-resolve-${cand.id}`), "已拍板还留着确认按钮 ⇒ 会重复提交").toBeNull();
  });

  it("③-D 「查不出来」不许塌成「没有候选」：端点 500 → 明说这次没查出来", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/a/v1/databuilder/reconcile-candidates", () =>
        HttpResponse.json({ error: { code: "BOOM", message: "队列炸了", requestId: "req_q" } }, { status: 500 }),
      ),
    );
    await intakeAndParse(user);
    const box = await screen.findByTestId("reconcile-queue-error");

    /*
     * ⚠ WO-BEFE-CLEANUP 改了这条的**承载层**（`docs/CONVENTION-ui-information-layering.md` §1）：
     *   「队列不可用」是**状态**，留第一层（不点就得看见）；
     *   「不是『没有候选』，是这次没查到」是**诚实位说明**，规范归 `?` 浮层。
     * 判据随之拆两半，**两半都比原来严**（原来一句 `toContain("不是")` 连"不是"出现在哪都不管）：
     *   ① 状态词默认可见；② 那句「≠ 没有候选」在浮层里、默认不在 DOM、hover 后真可见。
     * 这条门要治的病（「我没找到」被说成「它不存在」）一点没放宽 —— 反而多咬了一层。
     */
    expect(box).toBeVisible();
    expect(box.textContent, "连「不可用」这个状态都没了 ⇒ 用户会以为查过了且确实没有").toContain("队列不可用");

    expect(screen.queryByTestId("info-body-intake-unavailable")).toBeNull();
    await user.hover(screen.getByTestId("info-intake-unavailable"));
    const why = await screen.findByTestId("info-body-intake-unavailable");
    expect(why).toBeVisible();
    expect(why.textContent, "「≠ 没有候选」这句被删了，不是降层").toContain("不是");

    expect(screen.queryByTestId("reconcile-queue-empty"), "读不出来被渲染成「队列为空」⇒ 把「我没找到」说成了「它不存在」").toBeNull();
  });

  it("③-E 形状漂移守门：桩的输出必须过**契约 schema**（`prototypeColumn` / `{from,to,origin}`）", async () => {
    const user = userEvent.setup();
    await intakeAndParse(user);
    await waitFor(() => expect(screen.getByTestId("reconcile-pending-count").textContent).toBe("1"));

    // ★ 拿契约 schema 亲自 parse —— 桩再想用 `column`/`{src,tgt}` 就当场红，不靠人记得两边写成一样。
    const items = (await fetchReconcileCandidates()).items;
    expect(items.length, "队列为空 ⇒ 这条 schema 断言是空胜").toBeGreaterThan(0);
    for (const c of items) expect(() => SchemaReconcileCandidateSchema.parse(c)).not.toThrow();

    // 关系那一段同理：屏上必须是真名字，不是 `undefined`。
    const links = screen.getByTestId("intake-links");
    expect(links.textContent, "关系渲染成了 undefined ⇒ 字段名与后端漂了").not.toContain("undefined");
    // 反证金丝雀：契约里 `{src,tgt}` 这种形状**必须**被 schema 拒（否则上面的 parse 恒真、证明不了任何事）。
    expect(() => ProtoLinkSchema.parse({ src: "A", tgt: "B", rel: "r" })).toThrow();
    expect(() => ProtoLinkSchema.parse({ from: "A", to: "B", rel: "r", origin: "ref" })).not.toThrow();
  });

  it("③-F 不是死组件：`ReconcileQueue` 真有挂载点，两条 URL 真有生产调用方", () => {
    /*
     * ⚠ 三条判据从「PrototypeIntakePage.tsx 的文本」搬到**整棵前端源码树**（`./factlock`，剥注释）。
     * 名字/挂载点搬去别的文件是无害重构，而 `readRepoFile` 不剥注释、注释里提一嘴就能盖住
     * 被删的接线 —— 假红假绿两个方向都错（`G-FACTLOCK-POSITION-ANCHOR`）。
     * 字段名 `c.prototypeColumn` 这条尤其是纯代理：它想说的「屏上渲染的是 prototypeColumn 不是
     * undefined」在本文件 L65-69 已经**端到端断言过**（比对 `reconcile-col-*` 的真 textContent），
     * 那条才是真行为判据，这里只留「不是死代码」的静态盘点。
     */
    const fe = checkedTree("apps/frontend-shell/src", "<ReconcileQueue />", 100);
    expect(factHits(fe, "<ReconcileQueue />"), "ReconcileQueue 零生产挂载点 ⇒ 死组件").not.toEqual([]);
    for (const fn of ["fetchReconcileCandidates", "resolveReconcileCandidate"]) {
      expect(
        factHits(fe, new RegExp(`(?:queryFn|mutationFn):\\s*${fn}\\b|\\b${fn}\\s*\\(`)),
        `${fn} 零生产调用方（只有声明/只有 import = 没接线）`,
      ).not.toEqual([]);
    }
    // 漂移不许回潮：`c.column` / `l.src` 一旦回来，真后端下又是 undefined。
    expect(factHits(fe, "c.prototypeColumn"), "候选列字段名没有任何生产使用点").not.toEqual([]);

    const page = readRepoFile("../src/pages/admin/PrototypeIntakePage.tsx");
    expect(page.length, "PrototypeIntakePage.tsx 读到了空内容——路径漂了，先修路径再看结论").toBeGreaterThan(1000);
    expect(page).not.toContain("{l.src}");

    const eps = readRepoFile("../src/api/endpoints.ts");
    // 金丝雀：先抓一个**已知必在**的同族 URL；抓不到说明读法坏了，而不是端点没接。
    expect(eps, "金丝雀未中 ⇒ 读法坏了，下面的「不存在」全部不可信").toContain("/a/v1/databuilder/intake");
    expect(eps).toContain("/a/v1/databuilder/reconcile-candidates");
    expect(eps).toContain("/resolve`");
  });
});
