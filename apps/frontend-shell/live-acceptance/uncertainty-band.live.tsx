import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BaseOutlookPanel } from "@/views/BaseOutlookPanel";
import { tokenStore } from "@/api/tokenStore";

/**
 * ══ 「连真后端」验收 · 需求不确定性区间上屏（WO-UNCERTAINTY-INPUTS）══════════════
 *
 * 验的是本单交付判据 4：**验证来自真起的服务 + 真前端**，
 * `VITE_MOCK=1` 与各类桩不许作为交付验证的依据（仓主明令）。
 *
 * ⚠ 与 `pnpm test` 隔离：扩展名 `.live.tsx` 不匹配 vitest 默认 include。
 *
 * ── 怎么跑（2026-09-03 实跑通过）───────────────────────────────────────────────
 *   1) `pnpm --filter datacore build`
 *   2) 起真后端（内存仓储 · 电池种子 seed 42 · 端口 4801）：
 *      PORT=4801 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
 *      CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js
 *   3) `pnpm --filter frontend-shell exec vitest run --config live-acceptance/live.config.ts`
 *
 * ── 本单要证的那句话 ────────────────────────────────────────────────────────
 * 改之前：屏上销售预测**只有一个点**，而那个点的字段名里写着 P50 ——
 * 「中位数」三个字在屏上没有任何东西支撑它（上下游没有第二个分位）。
 * 改之后：同一条摊窗公式喂 `DemandSegment` 的 P90/P50/P10 三个**真字段**，
 * 屏上出现 P90–P10 区间。**不是采样、不是蒙特卡洛**，是三次确定性求值。
 */

const wire: { method: string; url: string; status: number }[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await realFetch(input as never, init as never);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  wire.push({ method, url, status: res.status });
  return res;
}) as typeof fetch;

beforeAll(async () => {
  const res = await realFetch("http://127.0.0.1:4801/a/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }),
  });
  const body = (await res.json()) as { accessToken?: string };
  if (!res.ok || !body.accessToken) throw new Error(`登录失败 ${res.status} ${JSON.stringify(body)}`);
  tokenStore.set(body.accessToken);
});

const renderPanel = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BaseOutlookPanel baseId="changzhou" />
    </QueryClientProvider>,
  );
};

/** 屏上读出来的数带千分位（`toLocaleString("en-US")`），还原成数再比。 */
const numOf = (t: string) => Number(t.replace(/[^0-9.]/g, ""));

describe("WO-UNCERTAINTY-INPUTS · 真后端 · 需求三点分布上屏", () => {
  it("① 真后端 DemandSegment 三行都带 P90 ≤ P50 ≤ P10（区间不是塌的）", async () => {
    const r = await realFetch("http://127.0.0.1:4801/a/v1/objects?type=DemandSegment", {
      headers: { authorization: `Bearer ${tokenStore.get()}` },
    });
    const rows = ((await r.json()) as { items: { props: Record<string, number | string> }[] }).items;
    expect(rows.length, "DemandSegment 一行都没有 ⇒ 后端没起或没播种，下面结论作废").toBeGreaterThan(0);
    for (const { props: p } of rows) {
      const p90 = Number(p.demandWanPerYearP90), p50 = Number(p.demandWanPerYearP50), p10 = Number(p.demandWanPerYearP10);
      expect(Number.isFinite(p10), `${p.segment} 没有 P10 —— 本单的字段没到真后端`).toBe(true);
      expect(p90).toBeLessThanOrEqual(p50);
      expect(p50).toBeLessThanOrEqual(p10);
      // 金丝雀：区间不许塌成一个点（P10=P90 的"占位式"离散度正是本单明令禁止的那种）
      expect(p10, `${p.segment} 的区间塌成一个点 ⇒ 离散度是占位不是真数据`).toBeGreaterThan(p90);
    }
  });

  it("② 屏上真出现 P90–P10 区间，且区间把基准点夹在中间", async () => {
    renderPanel();
    // 先等四线出来（证明求解器真回了数），再看区间。
    await waitFor(() => expect(screen.getByTestId("outlook-line-salesForecast-value")).toBeInTheDocument(), { timeout: 60000 });

    const band = await screen.findByTestId("outlook-forecast-band", {}, { timeout: 60000 });
    expect(band).toBeInTheDocument();

    const bandText = screen.getByTestId("outlook-forecast-band-value").textContent ?? "";
    const [lo, hi] = bandText.split("–").map(numOf);
    const baseline = numOf(screen.getByTestId("outlook-line-salesForecast-value").textContent ?? "");

    // eslint-disable-next-line no-console
    console.log(`[live] 屏上销售预测：保守 ${lo} ≤ 基准 ${baseline} ≤ 乐观 ${hi}（套/30天窗）`);

    expect(Number.isFinite(lo) && Number.isFinite(hi)).toBe(true);
    expect(lo).toBeLessThan(hi); // 区间真有宽度
    expect(lo).toBeLessThanOrEqual(baseline);
    expect(baseline).toBeLessThanOrEqual(hi);
  });

  /**
   * ⚠ 这条断言第一版抄了 `sandbox-plays.live.tsx`，只放行 A 侧 4801 —— **当场红**。
   * 不是代码错了，是断言错了：`runSolver` 走的是 **B 侧** `POST /b/v1/solvers/{key}/run`
   * （`endpoints.ts` 注释写着「推演类视图统一走 B 侧，entitlement 先行再 OBO 透传 DataCore」）。
   * 记在这里，免得下一个人照抄同一份模板再红一次：**推演类面板的 live 验收要起两个服务**。
   */
  it("③ 全程零 mock：所有出站请求都打到真服务（A 侧 4801 / B 侧 4802）", () => {
    const uniq = [...new Set(wire.map((w) => `${w.method} ${new URL(w.url).pathname}`))].sort();
    // eslint-disable-next-line no-console
    console.log(`[live] 真实往返端点：\n  ${uniq.join("\n  ")}`);
    expect(wire.length, "一次网络往返都没有 ⇒ 上面两条断言可能验的是空气").toBeGreaterThan(0);
    const REAL = ["http://127.0.0.1:4801", "http://127.0.0.1:4802"];
    const strays = wire.filter((w) => !REAL.some((o) => w.url.startsWith(o)));
    expect(strays.map((s) => s.url), "有请求没打到真服务 ⇒ 中间有桩，验收作废").toEqual([]);
    // 金丝雀：本次真的走了 B 侧求解端点（否则「零 mock」是在给一个空集合发合格证）。
    expect(uniq.some((u) => u.includes("/b/v1/solvers/base_capacity_outlook/run")), "没看到求解请求").toBe(true);
  });
});
