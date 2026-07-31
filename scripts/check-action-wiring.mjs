#!/usr/bin/env node
/**
 * action-wiring:check —— 堵死 G-ACTION-NOOP-EXEC 回潮。
 *
 * 病灶（真实·用户可感知）：`app.ts domainExecutor` 只有 7 个分支，未覆盖的已注册 ActionType
 * 全部落到 `MockActionExecutor`，后者返回 `MO-2026-${hash}` —— 一个哈希编出来的**假工单号，
 * 形态与真 MO 一模一样**。审批链走完、审计留痕齐全、targetRef 看着像真的，而真值一个字节没动；
 * 而平台自己的 `mapping.ts` 还声称「采纳产能保障方案 → target: 生产工单MO（写回）」。
 * 用户在界面上无法分辨"做了"和"没做"——这比功能缺失危险，因为它会被当成事实沉淀进决策。
 *
 * 本门三条断言（任一不满足即红）：
 *   ① 每个**已注册** ActionType（BATTERY_ACTION_TYPES）必须在 ACTION_WIRING 里显式归类；
 *   ② 标 WIRED 的必须在 app.ts domainExecutor 里真有分支（不许口头 WIRED）；
 *   ③ domainExecutor 的最终兜底**不得**是 MockActionExecutor（那是假 MO 号的产地）。
 *
 * 读源码而非 dist：本门守的是"声明与接线一致"，源码即声明。
 */
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const fails = [];

const batterySrc = read("apps/datacore/src/synthetic/battery.ts");
const actionsSrc = read("apps/datacore/src/actions.ts");
const appSrc = read("apps/datacore/src/app.ts");

// —— 已注册 ActionType：截取 BATTERY_ACTION_TYPES 数组体，取其中的 key ——
const regStart = batterySrc.indexOf("export const BATTERY_ACTION_TYPES");
if (regStart < 0) fails.push("锚点失效：battery.ts 找不到 BATTERY_ACTION_TYPES（改名须同步本门）");
const regBody = regStart >= 0 ? batterySrc.slice(regStart, batterySrc.indexOf("\n];", regStart)) : "";
const registered = [...regBody.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
if (registered.length === 0) fails.push("BATTERY_ACTION_TYPES 解析出 0 个 key（解析器失锚·勿让本门空跑通过）");

// —— 声明的接线态 ——
const wStart = actionsSrc.indexOf("export const ACTION_WIRING");
if (wStart < 0) fails.push("锚点失效：actions.ts 找不到 ACTION_WIRING");
const wBody = wStart >= 0 ? actionsSrc.slice(wStart, actionsSrc.indexOf("\n};", wStart)) : "";
const wiring = new Map(
  [...wBody.matchAll(/^\s*([A-Za-z_一-龥][\w一-龥]*)\s*:\s*"(WIRED|NO_WRITE|NOT_IMPLEMENTED)"/gm)].map((m) => [m[1], m[2]]),
);

// ① 全覆盖
for (const key of registered) {
  if (!wiring.has(key)) {
    fails.push(
      `断言① 已注册 ActionType「${key}」未在 ACTION_WIRING 里归类 —— 未归类者执行期落兜底，` +
        `曾经的兜底会返回 MO-2026-xxxx 假单号使"没做"冒充"做了"。修：在 actions.ts ACTION_WIRING 显式标 ` +
        `WIRED（真有执行器）/ NO_WRITE（设计上不写真值）/ NOT_IMPLEMENTED（欠账·执行期诚实失败）。`,
    );
  }
}

// ② WIRED 必须真有分支
const branchKeys = new Set([...appSrc.matchAll(/actionTypeKey === "([^"]+)"/g)].map((m) => m[1]));
for (const [key, w] of wiring) {
  if (w === "WIRED" && !branchKeys.has(key)) {
    fails.push(
      `断言② 「${key}」标了 WIRED 但 app.ts domainExecutor 里没有对应分支 —— 口头 WIRED 等于没接，` +
        `执行期照样落兜底。修：补真执行器分支，或据实改标 NOT_IMPLEMENTED。`,
    );
  }
}

// ③ 兜底不得是假 MO 产地
const domStart = appSrc.indexOf("const domainExecutor");
const domBody = domStart >= 0 ? appSrc.slice(domStart, appSrc.indexOf("\n  };", domStart)) : "";
if (!domStart) fails.push("锚点失效：app.ts 找不到 domainExecutor");
if (/return\s+mockExecutor\.execute\(/.test(domBody)) {
  fails.push(
    "断言③ domainExecutor 仍以 mockExecutor 兜底 —— 那是 `MO-2026-${hash}` 假工单号的产地（G-ACTION-NOOP-EXEC 回潮）。" +
      "修：兜底改用 UnwiredActionExecutor（未实现即 ok:false 诚实失败·NO_WRITE 显式标注·绝不产出 MO 形态字符串）。",
  );
}
if (!/return\s+unwiredExecutor\.execute\(/.test(domBody)) {
  fails.push("断言③ domainExecutor 未接 unwiredExecutor 兜底（未接线动作将无诚实出口）。");
}

if (fails.length > 0) {
  console.error(`\n✗ action-wiring:check 失败（${fails.length}）：`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}

const byW = [...wiring.values()].reduce((a, w) => ({ ...a, [w]: (a[w] ?? 0) + 1 }), {});
console.log(
  `\n✓ action-wiring:check 通过：${registered.length} 个已注册 ActionType 全部显式归类` +
    `（WIRED ${byW.WIRED ?? 0} · NO_WRITE ${byW.NO_WRITE ?? 0} · NOT_IMPLEMENTED ${byW.NOT_IMPLEMENTED ?? 0}）；` +
    `WIRED 者在 domainExecutor 均有真分支；兜底为诚实执行器（无假 MO 号产地）。`,
);
