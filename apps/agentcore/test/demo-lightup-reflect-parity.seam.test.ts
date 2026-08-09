import { describe, expect, it } from "vitest";
import { defaultOnKeys, FEATURE_REGISTRY } from "../src/features/registry.js";
import { reflectEnabled, escalationEnabled } from "../src/router/orchestrator.js";

/**
 * WO-SKILL-PARTIAL-B · **反思闭环 / 升级阶梯：生产实参真的会开门** SEAM。
 *
 * ── 这道门补的是哪个洞（铁律 0.5 判据 #6「生产实参与测试实参交集为空」）────────────
 *
 * `agent.critic`（反思闭环）与 `agent.escalation`（升级阶梯）今天**已经**在 demo 上点亮
 * （`apps/datacore/src/seed.ts` `DEMO_LIGHTUP` → `seedDemoEntitlements` → `server.ts` SEED_DEMO=1 播种），
 * 而且两侧各有门守着：
 *   · datacore `demo-lightup-seam.test.ts`  → 证「seed → resolve 里有这个键」（**登记**）
 *   · agentcore `reflect-wiring-seam.test.ts` / `escalation-ladder-seam.test.ts`
 *                                           → 证「门开了 → orchestrator 真注入 runAgentLoop」（**接线**）
 *   · agentcore `demo-lightup-2-prod-set.seam.test.ts`
 *                                           → 证「**生产那一份**功能集 → 真编排器换路」（**生产实参**）
 *
 * ── ⚠ 本门的诚实定位：**补强，不是补洞**（先说清楚，免得下一个人高估它）────────────
 *
 * 本单起初判「生产实参这一格没人咬」，依据是：`demo-lightup-2-prod-set.seam.test.ts`
 * （其自述职责正是"拿生产 demo 那一份真实功能集去跑真编排器"）**没有 import
 * `reflectEnabled` / `escalationEnabled`**（grep 零命中·此条属实），而
 * `reflect-wiring-seam.test.ts:83` / `escalation-ladder-seam.test.ts:41` 喂的是
 * **手搓单元素集** `new Set(["agent.critic"])` / `new Set(["agent.escalation"])`。
 *
 * **但这个判断被变异反证推翻了一半，照实记在这里**：给 `reflectEnabled` 植入一条
 * 「`set.has("qos.agent-fallback")` 即返 false」的排除（只在**生产形状**的集合里成立、
 * 手搓单元素集看不见）——本以为只有本门会红，实测 `reflect-wiring-seam.test.ts` **同样红**。
 * 原因：那两个文件的**端到端**用例并非只用单元素集，而是
 * `t.deps.features.mock.set(TENANT, [...defaultOnKeys(), <key>])`
 * （`reflect-wiring-seam.test.ts:runDeep` / `escalation-ladder-seam.test.ts:48,94`），
 * 已经是生产形状。⇒ **「生产实参未被覆盖」对这两个门并不成立**。
 *
 * 故本门的真实价值只有两条，不夸大：
 *   ① **把两条 reflect 家族的门与"生产 demo 集"绑在一处**断言（含暗发锁死的反面锚 ③④），
 *      与 registry parity ⑤ 同文件——此前散在三个文件、各咬各的一半；
 *   ② **更要紧的是这段注释本身**：`registry.ts` 的 `defaultOn:false` 是 **L1 平台默认**，
 *      它**不代表 demo 上是关的**——demo 经 **L3 显式 override**（datacore `seed.ts` `DEMO_LIGHTUP`）
 *      早已点亮。本单的派单说明就是照着 `defaultOn:false` 判成"用户永远看不到"，**判反了**。
 *      下一个人多半会再犯同一个错，故把完整证据链钉在这里（见下）。
 *
 * ── 证据链（追到条件为止·铁律 0.5）────────────────────────────────────────
 *   `seed.ts:63 DEMO_LIGHTUP{agent.critic:true, agent.escalation:true}`
 *     → `seedDemoEntitlements`(`seed.ts:134`) 写 tenant override
 *     → 仅 `server.ts:84`（`SEED_DEMO==="1"`）与 `seed-cli.ts:38` 调用
 *     → `features.ts:317-326` L3 override 并入 → `cascade`（两键无 `requires`，不被级联砍）
 *     → `resolve()` 下发 → AgentCore `FeatureGate.enabledSet`(`gate.ts:98`) 得**真 Set**
 *     → `reflectEnabled`(`orchestrator.ts:202`) / `escalationEnabled`(`:224`) `set.has` 为真
 *     → `orchestrator.ts:2022` 注入 `reflect:true`+`critic` 进 `runAgentLoop`
 *     → `loop.ts:881` 收尾前 `reflectWithCritic`。
 *   ⚠ 唯一会让它**在生产里失效**的分支：`gate.ts:90 failOpen` —— DataCore 拉不到/401 时返回
 *     `"ALL"`，而两门对 `"ALL"` 一律返 false（见 ④）⇒ **entitlement 拉不到 = 反思闭环静默关掉**。
 *
 * ── 镜像纪律 ────────────────────────────────────────────────────────────
 * `DEMO_LIGHTUP` 在 `apps/datacore/src/seed.ts`，跨 app 引源码违反 **contracts-only-shared**，
 * 故此处与 `demo-lightup-2-prod-set.seam.test.ts` 同款维护**镜像**，并由 ③ 的 registry parity
 * 断言 + datacore 侧 `demo-lightup-seam.test.ts` 的金值共同守住它不漂。
 */

/** 生产 demo 租户真实功能集里，本门关心的两条暗发键（镜像自 datacore `seed.ts` `DEMO_LIGHTUP`）。 */
const REFLECT_KEYS = ["agent.critic", "agent.escalation"] as const;

/**
 * 生产 demo 的功能集近似：平台默认开 ∪ 显式点亮键。
 * （与 `demo-lightup-2-prod-set.seam.test.ts` 同款构造——battery 模板把 QOS 暗发键诚实排除，
 * 故这两条只可能经**显式 override** 进来，正是 `DEMO_LIGHTUP` 干的事。）
 */
const demoProdSet = (): Set<string> => new Set([...defaultOnKeys(), ...REFLECT_KEYS]);

describe("WO-SKILL-PARTIAL-B · 生产 demo 集 → 反思闭环/升级阶梯真开（补「生产实参未被覆盖」那一格）", () => {
  it("① 生产实参 SEAM：拿 demo 生产集喂 reflectEnabled → 必须为真（反思闭环真会跑·非手搓单元素集）", () => {
    expect(
      reflectEnabled(demoProdSet()),
      "demo 生产集应让 agent.critic 反思闭环开门（seed.ts DEMO_LIGHTUP 点亮 → orchestrator 注入 runAgentLoop）",
    ).toBe(true);
  });

  it("② 生产实参 SEAM：拿 demo 生产集喂 escalationEnabled → 必须为真（停滞升级阶梯真会跑）", () => {
    expect(
      escalationEnabled(demoProdSet()),
      "demo 生产集应让 agent.escalation 升级阶梯开门（关 = 停滞直接 degrade）",
    ).toBe(true);
  });

  /**
   * 反面锚：没有这一条，① / ② 的绿可能只是「门恒真」而非「那个键承重」。
   * 同时咬住暗发纪律——**不随 defaultOn 顺带开**，必须经显式 override。
   */
  it("③ 反面锚：只有平台默认集（无显式 override）→ 两门必须仍关（暗发诚实锁死·新租户零影响）", () => {
    const defaultsOnly = new Set(defaultOnKeys());
    expect(reflectEnabled(defaultsOnly), "未显式点亮时 agent.critic 应关").toBe(false);
    expect(escalationEnabled(defaultsOnly), "未显式点亮时 agent.escalation 应关").toBe(false);
  });

  it("④ 降级态字节兼容：set==='ALL'（mock 默认 / DataCore 拉不到 fail-open）→ 两门仍关（不劫持既有 path-B）", () => {
    expect(reflectEnabled("ALL")).toBe(false);
    expect(escalationEnabled("ALL")).toBe(false);
  });

  it("⑤ 双注册 parity + 镜像防漂：两键在 AgentCore registry 在册且 defaultOn:false（L1 默认关·靠 L3 override 开）", () => {
    for (const key of REFLECT_KEYS) {
      const def = FEATURE_REGISTRY.find((f) => f.key === key);
      expect(def, `${key} 必须在 AgentCore registry（双注册 parity）`).toBeDefined();
      expect(def!.defaultOn, `${key} 必须 defaultOn:false（暗发·L1 平台默认关）`).toBe(false);
      expect(defaultOnKeys(), `${key} 不得随 defaultOn 顺带开`).not.toContain(key);
    }
  });
});
