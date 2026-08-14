import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SandboxView from "@/views/sim/SandboxView";
import { fetchSimViewConfig } from "@/api/endpoints";
import { tokenStore } from "@/api/tokenStore";

/**
 * ══ 「连真后端」验收 · 推演沙盘方案环（WO-V4-PLAYS）══════════════════════════════
 *
 * ⚠ **它不在 `pnpm test` 里**（扩展名 `.live.tsx` 不匹配 vitest 默认 include；
 *   `tsconfig.include` 与 `eslint src test` 也都不覆盖本目录）。它需要一台**真的跑着的** datacore，
 *   所以只在人手动验收时跑 —— 但它必须存在：本单的验收判据是「不许用 mock 数据」，
 *   而"我在本地跑过一遍"不是证据，一条能被别人原样重跑的命令才是。
 *
 * ── 怎么跑（2026-08-13 实跑通过）───────────────────────────────────────────────
 *   1) 起真后端（内存仓储 · 电池行业合成种子 seed 42 · 端口 4801）：
 *      PORT=4801 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
 *      CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js
 *      （先 `pnpm --filter datacore build`；等 `curl 127.0.0.1:4801/readyz` 回 ready）
 *   2) 跑本文件：
 *      pnpm --filter frontend-shell exec vitest run --config live-acceptance/live.config.ts
 *
 * ── 凭什么说"没用 mock"───────────────────────────────────────────────────────
 *  · `VITE_MOCK=0`（见 `live.config.ts`）⇒ `src/mocks/*` 的 MSW worker 不启动；
 *  · 本文件的 setup（`live-setup.ts`）**不装** `setupServer` ⇒ 没有任何拦截层；
 *  · 末尾一条断言把本次**所有**出站请求的 origin 与 `http://127.0.0.1:4801` 做全称比较 ——
 *    只要有一条走了别处（或被桩掉），它就红。`handlers.ts` 的 `mockDecisionPlay()` 一次都进不来。
 *
 * 验收的是**整条链**：真 `endpoints.ts`（URL 模板 + body 序列化）× 真 `SandboxView` 状态机 ×
 * 真 datacore 求解器与 sim 端点 × 真 Action 审批（读回草稿状态，不信屏上的 toast）。
 */

// 屏上出现的每一次网络往返（用真 fetch 包一层，纯记账，不改行为）。
const wire: { method: string; url: string; status: number }[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await realFetch(input as never, init as never);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  wire.push({ method, url, status: res.status });
  return res;
}) as typeof fetch;

let cfg: Awaited<ReturnType<typeof fetchSimViewConfig>>;

beforeAll(async () => {
  // 真登录（demo 租户 admin/demo1234）—— Bearer 走 tokenStore，与生产链路同一条路。
  const res = await realFetch("http://127.0.0.1:4801/a/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }),
  });
  const body = (await res.json()) as { accessToken?: string };
  if (!res.ok || !body.accessToken) throw new Error(`登录失败 ${res.status} ${JSON.stringify(body)}`);
  tokenStore.set(body.accessToken);
  cfg = await fetchSimViewConfig();
  // eslint-disable-next-line no-console
  console.log(`[live] view-config: ${cfg.nodeTypes.length} 类对象 · ${cfg.stateVars.length} 状态变量 · ${cfg.propagationCount} 传导规则`);
});

describe("连真后端 · 推演沙盘方案环端到端", () => {
  it("拨扰动 → 求方案 → 平行世界 → 比对 → 采纳（全程真 HTTP）", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SandboxView injectedConfig={cfg} />
      </QueryClientProvider>,
    );
    await screen.findByTestId("sandbox-view");

    // ── 顶栏诚实位：会话刚建好 ⇒ 占位 ─────────────────────────────────────
    await waitFor(() => expect(screen.getByTestId("sandbox-kpi-origin").getAttribute("data-origin")).toBe("DERIVED"));
    // eslint-disable-next-line no-console
    console.log(`[live] 建会话后徽标 = ${screen.getByTestId("sandbox-kpi-origin").textContent}`);

    // ── ① 拨一条扰动（真 POST …/perturbations）────────────────────────────
    await screen.findByTestId("sandbox-perturbation");
    await user.selectOptions(screen.getByTestId("sandbox-perturbation-mode"), "delta");
    const mag = screen.getByTestId("sandbox-perturbation-magnitude");
    await user.clear(mag);
    await user.type(mag, "-18");
    // 「施加扰动」在会话建成之前是**禁用**的（`disabled={!sessionId || perturbing}`）—— 这是产品的正确行为，
    // 不是缺陷：会话没建好，扰动无处可落。真后端下建会话要几百毫秒，故先等它可点再点（真人也是这么用的）。
    await waitFor(() =>
      expect((screen.getByTestId("sandbox-perturbation-apply-btn") as HTMLButtonElement).disabled).toBe(false),
    );
    const applyBtn = screen.getByTestId("sandbox-perturbation-apply-btn") as HTMLButtonElement;
    // eslint-disable-next-line no-console
    console.log(`[live] 施加前：disabled=${applyBtn.disabled} 落点=${(screen.getByTestId("sandbox-perturbation-object") as HTMLSelectElement).value} 变量=${(screen.getByTestId("sandbox-perturbation-statevar") as HTMLSelectElement).value} 幅度=${(mag as HTMLInputElement).value}`);
    await user.click(applyBtn);
    try {
      await screen.findByTestId("sandbox-perturbation-last-id");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(`[live] 施加失败，屏上 toast = ${document.body.textContent?.slice(0, 400)}`);
      throw e;
    }
    // eslint-disable-next-line no-console
    console.log(`[live] 扰动回执 = ${screen.getByTestId("sandbox-perturbation-last").textContent}`);

    // 扰动回包是后端算的世界态 ⇒ 徽标必须已换成「实测」
    await waitFor(() => expect(screen.getByTestId("sandbox-kpi-origin").getAttribute("data-origin")).toBe("MEASURED"));
    // eslint-disable-next-line no-console
    console.log(`[live] 扰动后徽标 = ${screen.getByTestId("sandbox-kpi-origin").textContent}`);

    // ── ② 求方案（真 decision_play）───────────────────────────────────────
    await user.click(screen.getByTestId("sandbox-plays-solve-btn"));
    const box = await screen.findByTestId("sandbox-plays-options");
    const count = Number(box.getAttribute("data-count"));
    // eslint-disable-next-line no-console
    console.log(`[live] decision_play 回 ${count} 个方案 · 根因 ${screen.getByTestId("sandbox-plays-root").textContent}`);
    expect(count).toBeGreaterThan(1);

    // ── ③ 每个方案一个平行世界（真 checkpoint + branch + perturbations）────
    await user.click(screen.getByTestId("sandbox-plays-branch-btn"));
    const worlds = await screen.findByTestId("sandbox-plays-worlds");
    await waitFor(() => expect(Number(worlds.getAttribute("data-count"))).toBe(count));
    const rows = Array.from(worlds.querySelectorAll("[data-testid^='sandbox-play-world-'][data-world-id]"));
    // eslint-disable-next-line no-console
    for (const r of rows) console.log(`[live] 世界 ${r.getAttribute("data-world-id")} · ${r.textContent}`);
    expect(rows.length).toBeGreaterThan(1);

    // ── ④ 并排比对（真 GET /a/v1/sim/compare）────────────────────────────
    const ids = rows.map((r) => r.getAttribute("data-world-id")!);
    await user.selectOptions(screen.getByTestId("sandbox-plays-pick-a"), ids[0]!);
    await user.selectOptions(screen.getByTestId("sandbox-plays-pick-b"), ids[ids.length - 1]!);
    await user.click(screen.getByTestId("sandbox-plays-compare-btn"));
    const cmp = await screen.findByTestId("sandbox-plays-compare");
    const diff = Number(screen.getByTestId("sandbox-plays-compare-diff").getAttribute("data-diff"));
    // eslint-disable-next-line no-console
    console.log(`[live] 比对：${cmp.textContent}`);
    expect(Math.abs(diff)).toBeGreaterThan(0); // 真差异，不是两列一样的数

    // ── ⑤ 采纳 → ActionDraft（必须 PENDING，不是 EXECUTED）────────────────
    const adoptBtn = worlds.querySelector("[data-testid^='sandbox-play-adopt-']") as HTMLButtonElement;
    await user.click(adoptBtn);
    await waitFor(() => expect(wire.some((w) => w.url.includes("/a/v1/action-drafts") && w.method === "POST")).toBe(true));
    const draftCall = wire.find((w) => w.url.includes("/a/v1/action-drafts") && w.method === "POST")!;
    expect(draftCall.status).toBe(201);

    // 真读回那张草稿，看它的状态（不信屏上的 toast，读后端）
    const list = await realFetch("http://127.0.0.1:4801/a/v1/action-drafts", {
      headers: { authorization: `Bearer ${tokenStore.get()}` },
    });
    const raw = (await list.json()) as unknown;
    const items = (Array.isArray(raw) ? raw : ((raw as { items?: unknown[] }).items ?? [])) as {
      id: string; status: string; payload: Record<string, unknown>;
    }[];
    // eslint-disable-next-line no-console
    console.log(`[live] GET /a/v1/action-drafts 回 ${items.length} 张草稿`);
    const mine = items.filter((d) => (d.payload?.patch as Record<string, unknown> | undefined)?.source === "sim_sandbox_play");
    // eslint-disable-next-line no-console
    console.log(`[live] 本环创建的草稿 ${mine.length} 张，状态：${mine.map((d) => `${d.id}=${d.status}`).join(" ")}`);
    expect(mine.length).toBeGreaterThan(0);
    for (const d of mine) {
      expect(d.status).toBe("PENDING_APPROVAL");
      expect(d.status).not.toBe("EXECUTED");
    }

    // ── ⑥ 全程一条 mock 都没走：真实打出去的端点逐条打印 ─────────────────
    const uniq = [...new Set(wire.map((w) => `${w.method} ${new URL(w.url).pathname}`))].sort();
    // eslint-disable-next-line no-console
    console.log(`[live] 真实往返端点：\n  ${uniq.join("\n  ")}`);
    expect(wire.every((w) => w.url.startsWith("http://127.0.0.1:4801"))).toBe(true);
  });
});
