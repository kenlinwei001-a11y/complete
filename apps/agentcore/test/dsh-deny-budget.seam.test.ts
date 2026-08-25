/**
 * WO-DSH-GOV-CREDENTIAL · 修 ② · **deny 侧上界**：连续治理拒绝必须有界终止。
 *
 * ## 治的是什么
 *
 * 修 ① 之前，DSH 治理裁决问 DataCore 时一个鉴权头都不发 ⇒ 401 ⇒ 插件 fail-closed 转 deny
 * ⇒ 模型重试 ⇒ **没有任何东西喊停**。实测一条问句烧掉 305,532 + 111,780 tokens / ~4,963 轮，
 * 答案为空。修 ① 堵住了那个 401，但「治理持续拒绝 ⇒ 无界重试」这个**形状**还在：
 * 换一条规则真的判 BLOCK、或裁决端点长时间不可达，同样能把预算烧干。
 * 修 ① 治病因，修 ② 治病理 —— 两者缺一不可。
 *
 * ## 为什么既有那只看门狗看不见它（两条独立原因，各自单独就足以致盲）
 *
 *   ① **挂载点错位**：`platform-world.mjs` 的治理闸在 `tools/pre-execute` 里
 *      `return {kind:'deny'}` 且**不调 `next()`** ⇒ 瀑布短路 ⇒ 工具从未派发
 *      ⇒ `tools/post-execute` 帧压根不存在，而 STALL_LOOP 看门狗正挂在那里。
 *   ② **豁免集**：`final_answer` ∈ `META_TOOLS`，即便 ① 不成立也照样被 skip ——
 *      而实测烧掉 ~4,963 轮的那个环，锤的恰恰就是 `final_answer`。
 *
 * 本文件用 `MOCK_SCENARIO=stall_loop_meta`（8 轮**同参 `final_answer`**）+
 * `PLATFORM_GOV_DENY=final_answer` 复现那个形状：**逐字命中**上面两条 ——
 * 被拒的是 meta 工具、拒发生在 pre-execute。
 *
 * ## 隔离纪律
 *
 * 全部臂**显式禁用** `QOS_AGENT_LOOP_REPEAT_CAP`（STALL_LOOP 看门狗关掉），
 * 使「有界终止」只可能由 deny 上界产生 —— 否则两只看门狗谁喊停的说不清，
 * 这条测试就不度量它声称度量的东西（本仓铁律 0.6 的那句话）。
 * env 卫生：runner 把 `process.env` 原样 spread 进子进程，臂间必须 save/restore。
 */
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDshAgent, type DshSessionEvent } from "../src/dsh-runtime/index.js";
import type { DshSetupSpec } from "../src/dsh-runtime/index.js";

const HARNESS_DIR = fileURLToPath(new URL("../../../packages/dsh-harness", import.meta.url));
const INTEGRATION_TIMEOUT = 60_000;
const REPEAT_CAP_KEY = "QOS_AGENT_LOOP_REPEAT_CAP";
const DENY_CAP_KEY = "QOS_AGENT_DENY_CAP";

/** mock 裁决器走 config.deny/env 清单，ruleKeys 只需非空以打开治理闸（spec.governance !== undefined）。 */
const GOV: DshSetupSpec["governance"] = {
  ruleBindings: { ruleKeys: ["r_deny_final_answer"], mode: "PRE_CHECK" },
  scopeObjectTypes: [],
};

const toolCallFrames = (events: readonly DshSessionEvent[]) => events.filter((e) => e.type === "tool/call");
const turnEndFrame = (events: readonly DshSessionEvent[]) => events.find((e) => e.type === "turn/end");

/** 剧本 8 轮同参 final_answer 全被拒；cap 由各臂注入。 */
async function runDenyLoop(env: Record<string, string>) {
  return runDshAgent(
    { prompt: "answer now", setup: { tenantId: "t1", governance: GOV }, provider: "mock", model: "mock" },
    {
      harnessDir: HARNESS_DIR,
      requestTimeoutMs: 30_000,
      cordisFile: "cordis.poc.yml",
      env: { MOCK_SCENARIO: "stall_loop_meta", PLATFORM_GOV_DENY: "final_answer", ...env },
    },
  );
}

describe("WO-DSH-GOV-CREDENTIAL 修② · deny 侧上界（pre-execute 拒绝的有界终止）", () => {
  let savedRepeat: string | undefined;
  let savedDeny: string | undefined;
  beforeEach(() => {
    savedRepeat = process.env[REPEAT_CAP_KEY];
    savedDeny = process.env[DENY_CAP_KEY];
    // STALL_LOOP 看门狗关掉：本文件断言的有界终止只能来自 deny 上界。
    delete process.env[REPEAT_CAP_KEY];
    delete process.env[DENY_CAP_KEY];
  });
  afterEach(() => {
    if (savedRepeat === undefined) delete process.env[REPEAT_CAP_KEY];
    else process.env[REPEAT_CAP_KEY] = savedRepeat;
    if (savedDeny === undefined) delete process.env[DENY_CAP_KEY];
    else process.env[DENY_CAP_KEY] = savedDeny;
  });

  it(
    "① 连续 deny 达 cap ⇒ 在**有界轮次内**终止，终态诚实且说清为什么",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const run = await runDenyLoop({ [DENY_CAP_KEY]: "3" });

      // 金丝雀：治理闸真的拒了（否则「有界终止」可能只是剧本自己跑完了，与上界无关）。
      const denied = run.events.filter(
        (e) => e.type === "tool/result" && JSON.stringify(e.data).includes("denied by ruleBindings PRE_CHECK"),
      );
      expect(denied.length, "治理闸未产生任何 deny ⇒ 本臂没有在测它声称要测的东西").toBeGreaterThan(0);

      // 本体①：有界 —— 剧本备了 8 轮，cap=3 必须在第 3 次就收，不许跑满。
      expect(toolCallFrames(run.events).length, "deny 上界未生效：跑满了剧本的 8 轮").toBeLessThanOrEqual(3);

      // 本体②：终态是**诚实的非成功态**，且带着 abort cause。
      const end = turnEndFrame(run.events);
      expect(end, "帧流缺 turn/end").toBeDefined();
      const endJson = JSON.stringify((end as DshSessionEvent).data);
      expect(endJson, "turn/end 未落 abort cause").toContain('"kind":"aborted"');
      expect(endJson).toContain("budget-exhausted");

      // 本体③：说清为什么 —— 原因逐字带到帧上（cap 值 + 被拒工具名）。
      expect(endJson).toContain("QOS_AGENT_DENY_CAP=3");
      expect(endJson).toContain("final_answer");

      // 本体④：**不许假装成功**。8 轮同参 final_answer 全被拒，答案是不存在的。
      expect(run.result.ok).toBe(true);
      if (run.result.ok) {
        expect(run.result.outcome, "deny 环不得收敛成 ANSWERED（那就是假装成功）").not.toBe("ANSWERED");
        expect(run.result.outcome).toBe("BUDGET_EXHAUSTED");
        // 用户可见文案里必须能读到「为什么停了」，而不是一段空答案。
        const answerText = JSON.stringify(run.result.answer);
        expect(answerText).toContain("预算耗尽");
        expect(answerText).toContain("QOS_AGENT_DENY_CAP=3");
      }
    },
  );

  it(
    "② 变异反证臂：显式禁用上界（cap=0）⇒ 同一剧本跑满 8 轮、无 abort ⇒ 证明喊停的确是上界",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      const run = await runDenyLoop({ [DENY_CAP_KEY]: "0" });

      // 金丝雀同上：确认这一臂里治理照样在拒（变量只有 cap 一个）。
      const denied = run.events.filter(
        (e) => e.type === "tool/result" && JSON.stringify(e.data).includes("denied by ruleBindings PRE_CHECK"),
      );
      expect(denied.length).toBeGreaterThan(0);

      // 禁用态 = 修前的世界：8 轮全跑完，没有任何东西喊停。
      expect(toolCallFrames(run.events)).toHaveLength(8);
      const endJson = JSON.stringify(turnEndFrame(run.events)?.data);
      expect(endJson, "禁用态不得出现 budget-exhausted abort").not.toContain("budget-exhausted");
    },
  );

  it(
    "③ 不误伤：全程 allow 的正常 run 不受 deny 上界影响（cap=1 亦然）",
    { timeout: INTEGRATION_TIMEOUT },
    async () => {
      // 同一剧本、同一 cap 边界值，唯一差别是 deny 清单为空 ⇒ 一次都不该 cancel。
      const run = await runDshAgent(
        { prompt: "answer now", setup: { tenantId: "t1", governance: GOV }, provider: "mock", model: "mock" },
        {
          harnessDir: HARNESS_DIR,
          requestTimeoutMs: 30_000,
          cordisFile: "cordis.poc.yml",
          env: { MOCK_SCENARIO: "final_answer", [DENY_CAP_KEY]: "1" },
        },
      );
      const endJson = JSON.stringify(turnEndFrame(run.events)?.data);
      expect(endJson, "零 deny 的 run 不得被 deny 上界打断").not.toContain("budget-exhausted");
      expect(run.result.ok).toBe(true);
      if (run.result.ok) expect(run.result.outcome).toBe("ANSWERED");
    },
  );

  it("④ 缺省**启用**：未设 env ⇒ 上界仍在（不许是「接了线没数据」）", async () => {
    // @ts-expect-error -- harness 侧纯 JS 插件无声明文件；形状由右侧 as 断言锁（同 dsh-watchdog.test.ts D1/D2）
    const { parseDenyCap, installDenyBudget } = (await import("../../../packages/dsh-harness/plugins/platform-watchdog.mjs")) as {
      parseDenyCap: (raw: unknown) => number | undefined;
      installDenyBudget: (ctx: unknown, env?: Record<string, string | undefined>) => { enabled: boolean; cap?: number };
    };
    // 金丝雀：解析器本身能认一个已知值（否则下面的「缺省启用」是空真理）。
    expect(parseDenyCap("7")).toBe(7);
    // 本体：未配置 ⇒ 有缺省 cap，不是 undefined。出货 compose 不在本单范围内，
    // 若此处 opt-in，生产态就恒禁用 —— 那正是本仓最忌的「代码在、测试绿、生产一次都不触发」。
    expect(parseDenyCap(undefined)).toBeGreaterThan(0);
    expect(parseDenyCap("")).toBeGreaterThan(0);
    // 逃生阀：显式 0 / 负数 / 非整数 ⇒ 禁用。
    expect(parseDenyCap("0")).toBeUndefined();
    expect(parseDenyCap("-1")).toBeUndefined();
    expect(parseDenyCap("abc")).toBeUndefined();
    // 装配层同步：不传 env ⇒ enabled。
    const stub = { on: () => {} };
    expect(installDenyBudget(stub, {}).enabled).toBe(true);
    expect(installDenyBudget(stub, { QOS_AGENT_DENY_CAP: "0" }).enabled).toBe(false);
  });

  it("⑤ 计数不设 meta 豁免（这正是既有看门狗致盲的第二条原因）", async () => {
    // @ts-expect-error -- harness 侧纯 JS 插件无声明文件；形状由右侧 as 断言锁（同 dsh-watchdog.test.ts D1/D2）
    const { installDenyBudget } = (await import("../../../packages/dsh-harness/plugins/platform-watchdog.mjs")) as {
      installDenyBudget: (
        ctx: unknown,
        env?: Record<string, string | undefined>,
      ) => { enabled: boolean; record: (exec: unknown, decision: unknown) => void };
    };
    const cancels: unknown[] = [];
    const exec = { name: "final_answer", agent: { cancel: (c: unknown) => cancels.push(c) } };
    const budget = installDenyBudget({ on: () => {} }, { QOS_AGENT_DENY_CAP: "3" });

    budget.record(exec, { kind: "deny", reason: "r" });
    budget.record(exec, { kind: "deny", reason: "r" });
    expect(cancels, "未达 cap 不得 cancel").toHaveLength(0);
    budget.record(exec, { kind: "deny", reason: "r" });
    // 若 final_answer 像 STALL_LOOP 那样被豁免，这里会是 0 —— 那就是 4,963 轮的成因。
    expect(cancels, "meta 工具的 deny 必须计数").toHaveLength(1);
    // 只喊一次（cancel 后到 turn 边界之间可能还有 in-flight 调用）。
    budget.record(exec, { kind: "deny", reason: "r" });
    expect(cancels).toHaveLength(1);
    // allow 不计数（它是分母，不是分子）。
    const fresh = installDenyBudget({ on: () => {} }, { QOS_AGENT_DENY_CAP: "2" });
    const cancels2: unknown[] = [];
    const exec2 = { name: "echo_tool", agent: { cancel: (c: unknown) => cancels2.push(c) } };
    fresh.record(exec2, { kind: "allow" });
    fresh.record(exec2, { kind: "allow" });
    fresh.record(exec2, { kind: "allow" });
    expect(cancels2).toHaveLength(0);
  });
});
