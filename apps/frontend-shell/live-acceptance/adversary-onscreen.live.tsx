import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PerturbRail from "@/views/sim/unified/rail/PerturbRail";
import { tokenStore } from "@/api/tokenStore";

/**
 * ══ 「连真后端」验收 · **对抗方读侧上屏**（WO-ADVERSARY-ONSCREEN）══════════════════
 *
 * ⚠ **它不在 `pnpm test` 里**（`.live.tsx` 不匹配 vitest 默认 include）。它需要一台
 * 真的跑着的 datacore，只在人手动验收时跑 —— 但它必须存在：本单的验收判据是
 * 「交付验证必须来自真起的服务 + 真前端」，而"我在本地点过一遍"不是证据，
 * **一条能被别人原样重跑的命令才是。**
 *
 * ── 怎么跑 ────────────────────────────────────────────────────────────────
 *   1) 起真后端（内存仓储 · 电池行业合成种子 seed 42 · 端口 4801）：
 *      PORT=4801 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
 *      CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js
 *   2) 开对抗方（**L3 租户 override，不动任何默认值 / 暗发集合**）：
 *      curl -XPUT 127.0.0.1:4801/a/v1/tenants/demo/features \
 *        -H 'X-Debug-User: demo:admin:admin' -H 'content-type: application/json' \
 *        -d '{"overrides":{"sim.propagation.adversary":true}}'
 *   3) pnpm --filter frontend-shell exec vitest run --config live-acceptance/live.config.ts
 *
 * ── 凭什么说"没用 mock" ────────────────────────────────────────────────────
 *  · `VITE_MOCK=0`（`live.config.ts`）⇒ MSW worker 不启动；
 *  · `live-setup.ts` **不装** `setupServer` ⇒ 没有任何拦截层；
 *  · 末尾一条断言把本次**所有**出站请求的 origin 与 `http://127.0.0.1:4801` 全称比较。
 *  · 且断言里回显**真实回包次数**与 `disclose` 那一跳的实际 URL。
 *
 * ── 本文件咬的是什么 ──────────────────────────────────────────────────────
 * 不是「面板渲染出来了」，而是**四态里的两态在真屏上确实不同**：
 * 同一条 UI 动线，只改**扰动幅度**这一个变量（1 → 96，容忍线 12），
 * 屏上必须从「未越线」翻成「还手」，且给出动作 · 越线对手数 · 系数 · 规则 key。
 * 幅度改了而屏上那句话不变 ⇒ 那是**写死的展示**，正是铁律 1.5 要拦的东西。
 */

const ORIGIN = "http://127.0.0.1:4801";
const wire: { method: string; url: string; status: number }[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await realFetch(input as never, init as never);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  wire.push({ method, url, status: res.status });
  return res;
}) as typeof fetch;

const AUTH = { "content-type": "application/json" };
let bearer = "";

/** 真登录（demo 租户 admin/demo1234）—— Bearer 走 tokenStore，与生产链路同一条路。 */
beforeAll(async () => {
  const res = await realFetch(`${ORIGIN}/a/v1/auth/login`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }),
  });
  const body = (await res.json()) as { accessToken?: string };
  if (!res.ok || !body.accessToken) throw new Error(`登录失败 ${res.status} ${JSON.stringify(body)}`);
  bearer = body.accessToken;
  tokenStore.set(bearer);

  // 前提自证：对抗方开关必须真的是开的，否则下面验的是另一件事（ONE_SIDED 态）。
  const f = await realFetch(`${ORIGIN}/a/v1/tenants/demo/features`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  const feats = ((await f.json()) as { features?: string[] }).features ?? [];
  // 金丝雀：拿一个确定在册的键证明量法是好的，再报目标键的有无。
  expect(feats.includes("sim.propagation"), "金丝雀失败 ⇒ 特性量法坏了，不是开关没开").toBe(true);
  expect(
    feats.includes("sim.propagation.adversary"),
    "对抗方开关是关的 ⇒ 先按本文件头注第 2 步开 override 再跑",
  ).toBe(true);
});

/** 建一个真会话（真 HTTP），返回 sessionId。扰动由 UI 去拨，这里只给一个空世界。 */
async function newSession(): Promise<string> {
  const r = await realFetch(`${ORIGIN}/a/v1/sim/sessions`, {
    method: "POST",
    headers: { ...AUTH, authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ baseSnapshot: {} }),
  });
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { id: string }).id;
}

function mount(sessionId: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PerturbRail sessionId={sessionId} />
    </QueryClientProvider>,
  );
}

/**
 * 走一遍**真 UI 动线**：选状态量 → 选类型 → 选对象 → 填幅度 → 点「施加并推演」。
 * 回屏上对抗方那一栏的 `data-state` 与全文。
 */
async function runThroughUi(magnitude: number): Promise<{ state: string; text: string }> {
  const user = userEvent.setup({ delay: null });
  const sessionId = await newSession();
  const { container, unmount } = mount(sessionId);

  const varSel = (await screen.findByTestId("rail-statevar", {}, { timeout: 60000 })) as HTMLSelectElement;
  await waitFor(() => expect(varSel.options.length).toBeGreaterThan(1), { timeout: 60000 });
  // 直接拨**还手规则读的那个量**（`Customer.receivablePressure` = 我方把成本转嫁了多少）。
  // 它若不在可扰清单里，本单的对照实验就走不完 —— 让它红，不静默换一个量。
  const target = [...varSel.options].find((o) => o.value.includes("receivablePressure"));
  expect(target, `可扰状态量里没有 receivablePressure（共 ${varSel.options.length} 项）`).toBeTruthy();
  await user.selectOptions(varSel, target!.value);

  const typeSel = (await screen.findByTestId("rail-typekey")) as HTMLSelectElement;
  await waitFor(() => expect(typeSel.options.length).toBeGreaterThan(0), { timeout: 60000 });
  const custOpt = [...typeSel.options].find((o) => o.value === "Customer") ?? typeSel.options[0]!;
  await user.selectOptions(typeSel, custOpt.value);

  const objSel = (await screen.findByTestId("rail-objectid")) as HTMLSelectElement;
  await waitFor(() => expect(objSel.options.length).toBeGreaterThan(0), { timeout: 60000 });
  await user.selectOptions(objSel, objSel.options[0]!.value);

  const mag = (await screen.findByTestId("rail-magnitude")) as HTMLInputElement;
  await user.clear(mag);
  await user.type(mag, String(magnitude));

  await user.click(await screen.findByTestId("rail-apply"));

  // 真推演：等披露面板出现（它只在 tick 回包带 disclosure 时才渲染）。
  const panel = await screen.findByTestId("sim-disclosure", {}, { timeout: 120000 });
  const adv = within(panel).getByTestId("sim-disclosure-adversary");
  container.querySelectorAll("details").forEach((el) => el.setAttribute("open", ""));
  const out = { state: adv.getAttribute("data-state") ?? "", text: container.textContent ?? "" };
  unmount();
  return out;
}

describe("连真后端 · 对抗方在屏上看得见（对照实验：只改幅度这一个变量）", () => {
  it("幅度 1（低于容忍线 12）⇒ 屏上说「无人越过容忍线」，⛔ 不许说成单方推演", async () => {
    const { state, text } = await runThroughUi(1);
    expect(state).toBe("NO_REACTION");
    expect(text).toContain("无人越过容忍线");
    expect(text).toContain("在册还手规则 1 条");
    expect(text, "开着却说『单方推演』= 谎报对手缺席").not.toContain("单方推演");
  }, 180000);

  it("幅度 96（越过容忍线 12）⇒ 屏上给出还手：动作 · 越线对手 · 系数 · 规则 key", async () => {
    const { state, text } = await runThroughUi(96);
    expect(state).toBe("REACTED");
    expect(text).toContain("砍单"); // 人话名，⛔ 不许只显裸键
    expect(text).toContain("本拍还手 1 条");
    expect(text).toContain("规则表直选"); // 「这一步零 LLM」必须明写
    expect(text).toContain("demo_customer_reaction_cut_order"); // 规则 key = 业务事实，必须给
    expect(text).toContain("0.35"); // 系数
    expect(text).toContain("12"); // 容忍线
    expect(text).toContain("未调用 agent"); // 推演路零 LLM，恒写不留白
    expect(text, "越线了还说『无人越过容忍线』").not.toContain("无人越过容忍线");
  }, 180000);

  it("⛔ 全程零 mock：所有出站请求都打到真 datacore，且 tick 那一跳真带了 disclose", () => {
    expect(wire.length, "一次网络往返都没有 ⇒ 这一轮没真跑").toBeGreaterThan(0);
    const foreign = wire.filter((w) => !w.url.startsWith(ORIGIN));
    expect(foreign, `有请求没走真后端：${JSON.stringify(foreign.slice(0, 3))}`).toEqual([]);
    const ticks = wire.filter((w) => /\/sim\/sessions\/[^/]+\/tick/.test(w.url));
    expect(ticks.length, "没有一跳是 tick ⇒ 屏上那些数不是这次推演来的").toBeGreaterThan(0);
    expect(ticks.every((t) => t.status === 200)).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`[live] 真实回包 ${wire.length} 次 · tick ${ticks.length} 次 · 全部 origin=${ORIGIN}`);
  });
});
