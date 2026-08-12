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
/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * 本仓门的退出码是**三分**约定（docs/SOP-reviewer-claim-discipline.md §3）：
 *   0 = 干净 · 1 = **真有问题**（先修代码）· 2 = **工具自己坏了**（只许说「我没查出来」）。
 * 而 node 对**未捕获异常一律退 1** —— 恰好撞上「真有问题」这个码。于是「门根本没跑起来」
 * （缺依赖 / 只读 FS / 权限 / OOM / node 版本差异 / dist 没构建）会被 gate.sh 和人一起
 * 读成「你的代码有问题」，方向**正好相反**。2026-08-11 一天之内两道门各撞一次，故建此机制。
 * 形态（铁律 0.6 句式）：「我用『进程非 0 退出』当作『代码有问题』的证据，而前者并不度量后者。」
 *
 * 这段只**加**默认失败方向，**不动**任何既有 exit(0)/exit(1)：兜底若把真违规也吞成 2，
 * 那是拿一个更糟的假绿换掉一个假红。RC=1 仍然只由主判据明确判负产生。
 * 守门的门：scripts/check-gate-exit-discipline.mjs（新加的门不带兜底会被它当场判红）。 */
process.on("uncaughtException", (e) => gateToolBroken(e));
process.on("unhandledRejection", (e) => gateToolBroken(e));
function gateToolBroken(e) {
  console.error(`⛔ check-action-wiring.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


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

// —— ④⑤ 堵 NO_WRITE 洗白通道 ——
// 病灶（本门自查时发现的自身漏洞）：①②③ 对 NO_WRITE **零校验**。三态里只有它是「绿着却什么都不写」，
// 于是把一条 NOT_IMPLEMENTED 改成 NO_WRITE 就能五秒变绿而问题原封不动，且比 NOT_IMPLEMENTED 更难发现
// ——因为它看起来"已经想清楚了"。以下两条把洗白成本从"改一个词"抬到"要么与另一处声明打架、要么签一份理由"。

// ④ 跨源交叉核对：`mapping.ts` 白纸黑字声明「（写回）」的动作，不得在 ACTION_WIRING 里标成 NO_WRITE。
//    这是**两处独立声明必须一致**（R-一致：同一事实一个出处），不是自证——mapping.ts 是业务侧登记表，
//    ACTION_WIRING 是执行侧接线表，二者对同一动作说反话，必有一处在撒谎。
const mappingSrc = read("apps/datacore/src/mapping.ts");
const writebackNames = new Set(
  [...mappingSrc.matchAll(/name:\s*"([^"]+)"[^\n]*写回/g)].map((m) => m[1]),
);
if (writebackNames.size === 0) {
  fails.push("锚点失效：mapping.ts 里解析出 0 条「（写回）」声明（改文案须同步本门·勿让断言④空跑通过）");
}
for (const name of writebackNames) {
  if (wiring.get(name) === "NO_WRITE") {
    fails.push(
      `断言④ 「${name}」在 mapping.ts 里声明了**写回**目标，却在 ACTION_WIRING 里标 NO_WRITE（=设计上无副作用）——` +
        `两处声明自相矛盾，必有一处在撒谎。修：要么接真执行器标 WIRED，要么据实标 NOT_IMPLEMENTED（欠账可见）；` +
        `若确系 mapping.ts 的写回声明已过期，改那边并说明。`,
    );
  }
}

// ⑤ 已注册**内置** ActionType 若标 NO_WRITE，必须在 actions.ts `NO_WRITE_RATIONALE` 里签一条非空理由。
//    NO_WRITE 的正当用途只有一个：**租户经 registerType 自注册的键**（平台侧不可能有内置执行器，
//    判 NOT_IMPLEMENTED 会误杀正当功能）——那条路径走的是 `ACTION_WIRING[key] ?? "NO_WRITE"` 的默认值，
//    根本不进 ACTION_WIRING 表。所以内置键出现 NO_WRITE 本身就可疑，必须留下可复核的书面理由。
const ratStart = actionsSrc.indexOf("export const NO_WRITE_RATIONALE");
if (ratStart < 0) fails.push("锚点失效：actions.ts 找不到 NO_WRITE_RATIONALE（断言⑤ 依赖它·勿删）");
// ⚠️ 取花括号体用**配平扫描**，不用 `indexOf("\n};")`：后者只认多行缩进写法，遇到单行
// `= { k: "v" };` 直接 -1 → slice 出垃圾 → 明明登记了却报"没登记"（假红），换个形态就可能变假绿。
// 这个 bug 是本门自己做变异反证时当场暴露的——门的解析器也要经得起变形。
const braceBody = (src, from) => {
  const open = src.indexOf("{", from);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  return "";
};
const ratBody = ratStart >= 0 ? braceBody(actionsSrc, ratStart) : "";
// 不锚行首（单行字面量里多个键挤在一行），键允许带引号 / 中文 / 下划线。
const rationale = new Map(
  [...ratBody.matchAll(/(?:^|[{,\s])"?([\p{L}\p{N}_$]+)"?\s*:\s*"([^"]*)"/gu)].map((m) => [m[1], m[2]]),
);
const PLACEHOLDER = /^\s*(|-|—|TODO|TBD|N\/A|待定|无|暂无|见上|同上)\s*$/i;
for (const key of registered) {
  if (wiring.get(key) !== "NO_WRITE") continue;
  const why = rationale.get(key);
  if (why === undefined) {
    fails.push(
      `断言⑤ 已注册内置 ActionType「${key}」标了 NO_WRITE 但没在 NO_WRITE_RATIONALE 里登记理由 —— ` +
        `NO_WRITE 是三态里唯一"绿着却什么都不写"的一态，也是洗白欠账最省事的一态（改一个词即变绿）。` +
        `若它**设计上**就无真值副作用（纯审计/纯登记），把这句话写进 NO_WRITE_RATIONALE 签字；` +
        `若只是还没接执行器，据实标 NOT_IMPLEMENTED。`,
    );
  } else if (PLACEHOLDER.test(why)) {
    fails.push(`断言⑤ 「${key}」的 NO_WRITE 理由是占位词「${why}」—— 签字要签真话，占位等于没签。`);
  }
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
    `WIRED 者在 domainExecutor 均有真分支；兜底为诚实执行器（无假 MO 号产地）；` +
    `mapping.ts ${writebackNames.size} 条写回声明与接线态无矛盾；NO_WRITE 内置项 ${byW.NO_WRITE ?? 0} 个均已签实名理由。`,
);
