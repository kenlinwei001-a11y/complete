/**
 * ══ WO-SIM-SEVERITY §2 · `fetchSimSessionBaseSnapshot` 的**真后端**正反两臂 ══════════
 *
 * ── 为什么单独开这个文件、且默认跳过 ─────────────────────────────────────────────
 * `sandbox-memory-window.seam.test.tsx` ⑥ 里的「真后端形状臂」走的是 MSW 桩 ——
 * 桩的形状是我们**按真后端实测**钉进去的，它能防回归，但它证明不了「今天真后端
 * 还长这样」。WO 的原话：桩绿不算数，必须真后端两臂。真后端不是任何人随时都有，
 * 所以本文件 **`SIM_REAL_DATACORE_URL` 不给就整个 skip** —— skip 的含义是
 * 「没环境，别跑」，**不是**「绿了」。给了 URL 就必须真打通，断一条都是红。
 *
 * 跑法（datacore 内存模式 `SEED_DEMO=1`，端口换成你自己的）：
 *   SIM_REAL_DATACORE_URL=http://127.0.0.1:<port> \
 *     pnpm --filter frontend-shell exec vitest run test/sim-session-basesnapshot.real-backend.test.ts
 *
 * ── 为什么是 `SIM_REAL_DATACORE_URL` 而不是 `VITE_DATACORE_URL` ──────────────────
 * `vitest.config.ts` 的 `test.env` 把 `VITE_DATACORE_URL` **钉死在 `http://a.test`**
 * （外加 `VITE_MOCK=1`）—— shell 传进来的同名变量根本到不了 `env.ts`，
 * 请求会打到不存在的 `a.test` 上 `ENOTFOUND`（本文件第一次跑就是这样四条全红的，
 * 那条失败记录留在证据目录里）。所以本文件用另一个变量名接真地址，
 * 并在 beforeAll 里**改写已解析的 `env.datacoreUrl` 属性**：
 * `apiClient.baseUrl()` 每次调用都现读这个属性，改它 = 改被测函数实际打出去的 baseURL，
 * 被测的那一跳（endpoints → apiClient → 路由形状）一个字节没绕开。afterAll 原样恢复。
 *
 * ── 它要钉死的那件事（2026-09-17 实测，canonical 8775dc67d）────────────────────
 * 真后端今天：`GET /a/v1/sim/sessions` 列表里 **0 个** `baseSnapshot` 字段
 * （复验：`curl … | grep -c '"baseSnapshot"'` → 0；裸 `:id` → 1，4,775 对象 / 7,295 格）。
 * 旧实现（本仓 2026-08-22 的原装）只扫列表这一跳：
 *   `api.aRaw("/a/v1/sim/sessions")` → `readSessionsProjected(res, sessionId)` → `kept ?? null`
 * 列表不下发 ⇒ `kept` 恒 null ⇒ **基线静默恒 null**，而它的测试全绿 —— 因为桩比真后端慷慨。
 * 旧注释自己就预言过这一态（写在 `fetchSimSessions` 头上）：
 *   「⚠ 这不替代后端投影…后端一旦不再下发该字段，扫描器扫不到，本跳退化成纯拷贝。」
 *   —— 同一作者防住了列表那条路，却给基线这条路留了一模一样的洞。
 *
 * ── 两臂 ────────────────────────────────────────────────────────────────────────
 * · 反向臂：旧实现的**两个组成函数原样**（`api.aRaw` + `readSessionsProjected`，
 *   都还是生产函数，列表那条路至今在用）打到真后端上 ⇒ `kept` 必须 = null。
 *   这是「改前恒 null」的**实证**，不是读码演绎。
 * · 正向臂：修复后的 `fetchSimSessionBaseSnapshot`（**生产那份**，走裸 `:id`）
 *   打到真后端 ⇒ 非 null、非空世界、格子是有限数；不存在的 id ⇒ null（不许造空世界）。
 *
 * ⚠ 鉴权：真后端要 `X-Debug-User`（无头实测 401 `UNAUTHORIZED`）。本文件在 fetch 层
 *   注入这个头 —— 注入的只是「登录态」这一事实，与浏览器里 Bearer 的位置相同。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { http, passthrough } from "msw";
import type { SimSession, TickState } from "@platform/contracts";
import { server } from "./setup";
import { api } from "@/api/apiClient";
import { env } from "@/env";
import { fetchSimSessionBaseSnapshot } from "@/api/endpoints";
import { readSessionsProjected } from "@/api/simSessionsProjection";

const REAL_URL = process.env.SIM_REAL_DATACORE_URL;

/** 真后端形状臂用的固定不存在 id —— 404 臂。 */
const NO_SUCH = "sims_no_such_session_000";

let origFetch: typeof globalThis.fetch;
let origDatacoreUrl: string;

beforeAll(() => {
  origFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("X-Debug-User", "demo:admin:admin");
    return origFetch(input, { ...init, headers });
  }) as typeof fetch;
  // vitest.config 的 test.env 把 VITE_DATACORE_URL 钉死在 http://a.test ——
  // 这里把**已解析的** env 对象重新指到真后端（apiClient 每调用现读它），afterAll 恢复。
  origDatacoreUrl = env.datacoreUrl;
  if (REAL_URL) env.datacoreUrl = REAL_URL;
});
afterAll(() => {
  globalThis.fetch = origFetch;
  env.datacoreUrl = origDatacoreUrl;
});

beforeEach(() => {
  // setup.ts 每个用例后 resetHandlers()（回到初始桩集）⇒ 放行必须逐用例重钉。
  // 只给被测的两跳打洞，其余路由的桩一张不动。
  server.use(
    http.get("*/a/v1/sim/sessions", () => passthrough()),
    http.get("*/a/v1/sim/sessions/:id", () => passthrough()),
  );
});

describe.skipIf(!REAL_URL)("WO-SIM-SEVERITY §2 · 基线捞取的真后端正反两臂", () => {
  it("金丝雀：URL 覆盖真的到了被测模块 · 列表路由今天**确实**不下发 baseSnapshot", async () => {
    // 自证连的是「我以为的那个后端」，不是哪个 agent 的遗留实例（本机 4001 就有别人的）
    expect(env.datacoreUrl, "SIM_REAL_DATACORE_URL 没吃进 env 对象 ⇒ 这一拳打去了别处").toBe(REAL_URL);

    const res = await api.aRaw("/a/v1/sim/sessions");
    const rawText = await res.clone().text();
    expect(
      rawText.includes('"baseSnapshot"'),
      "列表路由又开始下发 baseSnapshot 了 ⇒ 反向臂失去地基（它证明的是『列表不下发时旧实现恒 null』）",
    ).toBe(false);

    const { items } = await readSessionsProjected<SimSession>(res);
    expect(items.length, "真后端一个会话都没有 ⇒ 后面两臂无从谈起（SEED_DEMO=1 应至少有 1 条）").toBeGreaterThan(0);
  });

  it("🔴 反向臂：旧实现的两个组成函数原样跑在真后端上 ⇒ kept 恒 null（改前静默断链实证）", async () => {
    const listRes = await api.aRaw("/a/v1/sim/sessions");
    const { items } = await readSessionsProjected<SimSession>(listRes);
    const sid = items[0]!.id;

    // 旧实现原文（canonical 8775dc67d endpoints.ts）：aRaw(列表) → readSessionsProjected(res, id) → kept ?? null
    const res2 = await api.aRaw("/a/v1/sim/sessions");
    const { kept } = await readSessionsProjected<SimSession>(res2, sid);
    expect(
      kept,
      "kept 非 null ⇒ 列表其实在下发 baseSnapshot，本单 §2 的前提整个不成立 —— 停手顶回去，别修",
    ).toBeNull();
    // kept === null ⇒ 旧函数返回值 `(kept as TickState | null) ?? null` 恒 null。QED。
  });

  it("🟢 正向臂：修复后的生产函数走裸 :id ⇒ 基线非 null、非空世界、格子是有限数", async () => {
    const listRes = await api.aRaw("/a/v1/sim/sessions");
    const { items } = await readSessionsProjected<SimSession>(listRes);
    const sid = items[0]!.id;

    const snap = await fetchSimSessionBaseSnapshot(sid);
    expect(snap, "修复后仍 null ⇒ 修复没生效").not.toBeNull();
    const world = snap as TickState;
    const objCount = Object.keys(world).length;
    // 今日实测 4,775 对象 / 7,295 格；阈值放 1,000 —— 足够咬死「空世界/桩世界」，又不钉死种子
    expect(objCount, `只捞回 ${objCount} 个对象 ⇒ 不是一份真的推演世界基线`).toBeGreaterThan(1000);
    let cells = 0;
    let sawFinite = false;
    for (const row of Object.values(world)) {
      for (const v of Object.values(row)) {
        cells++;
        if (Number.isFinite(v)) sawFinite = true;
      }
    }
    expect(cells).toBeGreaterThan(1000);
    expect(sawFinite, "格子里一个有限数都没有 ⇒ 捞回来的不是世界态").toBe(true);
  });

  it("🟢 404 臂：不存在的会话必须给 null，⛔ 不许造一个空世界顶上（空世界 ⇒ 差分恒 0，比 null 更坏）", async () => {
    const snap = await fetchSimSessionBaseSnapshot(NO_SUCH);
    expect(snap).toBeNull();
  });
});
