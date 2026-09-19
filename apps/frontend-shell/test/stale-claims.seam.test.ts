import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { checkedTree, commentOnlyCanary, factHits, srcCode, stripComments } from "./factlock";

/**
 * WO-STALE-CLAIMS · **过期「自称实测」声明**的接缝门（本体 §8 `G-STALE-MEASURED-CLAIM`）。
 *
 * ── 这一族病是什么 ────────────────────────────────────────────────────────────
 * 一句「运行态实测 X 是 0」，写下的当天是真的；上游一补齐它就变成**屏上说谎**，
 * 而且没有任何人会被通知。**「自称实测」把可疑度压到最低**，所以它比普通过期注释更能骗过复审 ——
 * 2026-08-08 一天之内在本仓实测到 6 例同族。
 *
 * ── 本文件咬三件事（缺一件这道门就只是"排练"）───────────────────────────────
 *  ① **门真的在跑、且门自己没瞎**：`scripts/check-stale-claims.mjs --selftest` 必须 RC=0，
 *     且它必须被 `scripts/gate.sh` 真正挂上（门存在 ≠ 门在跑）。
 *  ② **判据真的会咬**：把已知的坏样例喂给检测器，必须被咬中；把「把实测当词用」的样例喂进去，
 *     必须放过。**这一条是金丝雀的金丝雀** —— 检测器改坏时，是它先红。
 *  ③ **事实锁**：本单改写的三处文案所依赖的上游事实（`putAll("Cadence")` 与 tick 读回）
 *     必须还在。哪天上游把它删了，新文案又变成假话 —— 那时这条断言当场红，
 *     逼着把文案改回去，而不是靠人记性。
 *
 * ⚠ 这与「测试咬的是函数不是链路」正相反：本文件不测某个函数好不好用，
 *   它测的是**那道门有没有被接进交付链、以及它的判据今天还成不成立**。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../..");
const GATE = join(REPO_ROOT, "scripts/check-stale-claims.mjs");
const readRepo = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");

/** 检测器（纯函数）＋ 事实源，从门脚本本体取 —— 不在测试里另写一份判据（两处写判据 = 迟早对不上）。 */
async function loadJudge() {
  const mod = (await import(/* @vite-ignore */ GATE)) as {
    judgeUnit: (text: string, facts: { materializedTypes: Set<string> | null; refCounter: (s: string) => { n: number; hits: string[] } }) => { code: string; detail: string }[];
  };
  const service = readRepo("apps/datacore/src/synthetic/service.ts");
  const materializedTypes = new Set([...service.matchAll(/putAll\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g)].map((m) => m[1]!));
  return { judge: mod.judgeUnit, facts: { materializedTypes, refCounter: () => ({ n: 0, hits: [] }) } };
}

describe("§1 · 门在跑，且门自己没瞎", () => {
  it("`--selftest` 金丝雀通过（必咬样例全部咬中 · 必不咬样例全部放过 · 扫描规模达标）", () => {
    const out = execFileSync("node", [GATE, "--selftest"], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(out).toContain("金丝雀");
    expect(out).toMatch(/必咬全部咬中/);
  });

  it("门本体通过（存量豁免棘轮内，无新增声明违规）", () => {
    const out = execFileSync("node", [GATE], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(out).toContain("stale-claims:check 通过");
  });

  it("门**真的被挂进交付链**（gate.sh 里有它）—— 门存在 ≠ 门在跑", () => {
    expect(readRepo("scripts/gate.sh")).toContain("check-stale-claims.mjs");
  });

  it("豁免棘轮：每条都有理由，maxExemptions 恒等于条数，且不超历史最高水位", () => {
    const b = JSON.parse(readRepo("scripts/stale-claim-baseline.json")) as {
      ratchetHigh: number;
      maxExemptions: number;
      exemptions: { key: string; why: string }[];
    };
    expect(b.maxExemptions).toBe(b.exemptions.length);
    expect(b.exemptions.length).toBeLessThanOrEqual(b.ratchetHigh);
    for (const e of b.exemptions) {
      expect(e.why.trim().length, `豁免 ${e.key} 没写理由 —— 无理由白名单正是本门要治的病`).toBeGreaterThanOrEqual(10);
    }
    // key 必须是「文件 + 文案哈希」，不是行号：行号会漂，漂了白名单就变成通行证
    for (const e of b.exemptions) expect(e.key).toMatch(/^[\w./-]+#[0-9a-f]{16}$/);
  });
});

describe("§2 · 判据真的会咬（喂已知坏样例）", () => {
  it("自称实测但**没日期** ⇒ STALE-1", async () => {
    const { judge, facts } = await loadJudge();
    const codes = judge("// 运行态实测 GET /a/v1/objects?type=Order → total 0，共 0 条", facts).map((v) => v.code);
    expect(codes).toContain("STALE-1");
  });

  it("自称实测但**没复验方式** ⇒ STALE-2", async () => {
    const { judge, facts } = await loadJudge();
    const codes = judge("// 2026-08-08 实测 130 行，够用且留余量", facts).map((v) => v.code);
    expect(codes).toContain("STALE-2");
  });

  it("声称某对象类型 0 条，**而它其实在 putAll 册上** ⇒ STALE-3（上游一补齐，声明当场红）", async () => {
    const { judge, facts } = await loadJudge();
    const codes = judge("// 2026-08-08 实测 `GET /a/v1/objects?type=Cadence` → `Cadence` 对象全仓 0 条", facts).map((v) => v.code);
    expect(codes).toContain("STALE-3");
  });

  it("**不含任何触发词**、但事实已被上游推翻 ⇒ 照样 STALE-3（事实层与关键词解耦）", async () => {
    const { judge, facts } = await loadJudge();
    const codes = judge('"`Cadence.offsetDays` 契约字段在，但同上无 `Cadence` 实例"', facts).map((v) => v.code);
    expect(codes).toContain("STALE-3");
    // 这一条正是本单病灶 ②：它一个「实测」字都没有。若事实层挂在关键词上，它就溜过去了。
    expect(codes).not.toContain("STALE-1");
  });

  it("把「实测」当**词**用的（三态徽章 / 字段名 / 诚实灰标）一律放过 —— 噪声门等于没门", async () => {
    const { judge, facts } = await loadJudge();
    for (const t of [
      'const PROV_KIND_COLOR = { 实测: "#62BE77", 派生: "#4C90F0" };',
      "<dt>实测值 vs 阈值</dt>",
      "<span>合成·未接实测</span>",
      "逐环节 · 实测归因",
    ]) {
      expect(judge(t, facts), `「${t}」被误咬了`).toEqual([]);
    }
  });

  it("对象类型**不在** putAll 册上时不乱咬（宁可漏，不可诬）", async () => {
    const { judge, facts } = await loadJudge();
    const codes = judge("// 2026-08-08 实测 `GET /a/v1/objects?type=Zzzznotatype` → `Zzzznotatype` 对象全仓 0 条", facts).map((v) => v.code);
    expect(codes).not.toContain("STALE-3");
  });
});

/**
 * 事实锁的扫描面：**整棵 datacore 源码树，剥注释后**。
 *
 * ── 病历（2026-08-11 实测，本文件自己犯的）────────────────────────────────────
 * 本节原先写死 `readRepo("apps/datacore/src/app.ts")` 去找两个串。集成分支把这段装配从
 * `app.ts` 抽到了 `sim/propagation-inputs.ts:88-89`（`app.ts` 还留了注释说明「刻意不在本文件
 * import」）——**能力一行没少，纯粹搬了个家**。于是同一次重构里，这一条 it 同时产出了两个
 * **方向相反**的错误信号：
 *   · `listByType(…, "Cadence")` → **假红**：事实还在，只是锚点没了；
 *   · `buildCadenceGates`        → **假绿**：它命中的是那句**注释**，不是代码。
 *     真正的调用点搬走了，而这条断言一声不吭 —— 正是本文件 §4 早已在防的「注释不参与判定」。
 *
 * 一个根因、两个方向：**「我用『某串在 app.ts 里』当作『tick 仍在读回 Cadence』的证据，
 * 而前者并不度量后者。」** 事实锁必须锚在**事实**上，不能锚在**位置**上 ——
 * 会因一次无害重构而红的门，只会训练人把门删掉，那时真删了才没人拦。
 */
/** 扫描面/剥注释/命中判据一律走 `./factlock` —— 两处写判据迟早对不上，金丝雀也就成了装饰品。 */
const datacoreCode = () => srcCode("apps/datacore/src");

describe("§3 · 事实锁：本单改写的文案，其依据必须还在（上游一删就红）", () => {
  it("上游承载还在：仍 `putAll(\"Cadence\")`、推演仍读回 —— 删了则 K1/K2 新文案又变假话", () => {
    const code = datacoreCode();

    // ── 金丝雀：先自证扫描器没坏，再据它下否定结论（铁律 0.6：报「不存在」必须附金丝雀证据）──
    expect(code.length, "datacore 源码扫不到几个文件 ⇒ 扫描器坏了，本次结论作废，不许读作「事实没了」").toBeGreaterThan(50);
    expect(
      factHits(code, 'putAll("Cadence"'),
      '金丝雀①：已知必中的 putAll("Cadence") 一个都找不到 ⇒ 扫描器坏了，不许读作「承载没了」',
    ).toContain("apps/datacore/src/synthetic/service.ts");
    // 金丝雀②：剥注释真的在生效。取一段**只在注释里**出现的合成串喂进去，必须不中 ——
    // 这条直接钉死本 it 当初那个「命中注释而误报绿」的形态。
    expect(
      factHits(commentOnlyCanary("buildCadenceGatesCANARY"), "buildCadenceGatesCANARY"),
      "金丝雀②：注释里的散文仍被当成代码 ⇒ stripComments 坏了或被摘了，本次结论作废",
    ).toEqual([]);

    // ── 事实本体：锚在「在不在」上，不锚在「在哪个文件里」上 ──────────────────────
    expect(
      factHits(code, 'putAll("Cadence"'),
      'datacore 不再 putAll("Cadence") —— K1/K2 的「承载今天也有」当场变成假话，必须改回去',
    ).not.toEqual([]);
    // `\bbuildCadenceGates\s*\(` 且排除声明式：光有 `export function buildCadenceGates(` 是「没接线」，
    // 不是「在读回」。import 行没有紧跟的括号，自然也不算。
    expect(
      factHits(code, /(?<!function\s)\bbuildCadenceGates\s*\(/),
      "推演装配不再**调用** buildCadenceGates —— K1 的「已在读回」变假（注释提一嘴、光有定义，都不算）",
    ).not.toEqual([]);
    expect(
      factHits(code, /listByType\([^)]*,\s*"Cadence"\)/),
      'tick 不再 listByType(…, "Cadence") —— 承载在库里但没人读，K1 的「已在读回」同样变假',
    ).not.toEqual([]);
  });

  it("offsetDays 的运行时消费方还在（K2 那句「零消费方为假」的依据）", () => {
    // **「零消费方」是全链的命题** —— 判据必须扫整棵树。原写法钉死 `propagation.ts` +
    // `transitFlow.ts` 两个文件：消费方哪天搬去别的模块（能力一行没少）就假红，
    // 而命中注释/import 又会假绿。两个方向都错，同 §3 上面那段病历一个根因。
    const engine = srcCode("apps/datacore/src");
    const web = srcCode("apps/frontend-shell/src");

    // ── 金丝雀：先自证扫描器没坏，再据它下「消费方还在/没了」的结论 ──────────────
    expect(engine.length, "datacore 源码扫不到几个文件 ⇒ 扫描器坏了，结论作废").toBeGreaterThan(50);
    expect(web.length, "frontend 源码扫不到几个文件 ⇒ 扫描器坏了，结论作废").toBeGreaterThan(50);
    expect(
      factHits(engine, "putAll("),
      "金丝雀①：已知必中的 putAll( 一个都找不到 ⇒ 扫描器坏了，不许读作「消费方没了」",
    ).not.toEqual([]);
    expect(
      factHits(commentOnlyCanary("cadence.offsetDaysCANARY"), "cadence.offsetDaysCANARY"),
      "金丝雀②：注释里的散文仍被当成代码 ⇒ stripComments 坏了，本次结论作废",
    ).toEqual([]);

    // ── 事实本体：两侧各自**至少有一个**运行时消费方，锚在「有没有」不锚在「在哪个文件」──
    const OFFSET_READ = /\bcadence\s*\.\s*offsetDays\b/;
    expect(
      factHits(engine, OFFSET_READ),
      "引擎侧再没有人读 cadence.offsetDays —— K2 的「零消费方为假」当场变成假话，文案必须改回去",
    ).not.toEqual([]);
    expect(
      factHits(web, OFFSET_READ),
      "前端侧再没有人读 cadence.offsetDays —— 同上",
    ).not.toEqual([]);
  });

  it("K1 / K2 的 evidence：旧的那两句假话没了，且新话带**实测日期 + 复验方式**", () => {
    // 事实锚（WO-C 修法）：evidence 宿主**住在哪个文件**不是事实 —— 用 varId 全树定位（搬家不红；文案没了才红）。
    const fe = checkedTree("apps/frontend-shell/src", 'from "@platform/contracts"', 100);
    const homes = factHits(fe, 'varId: "K1"');
    expect(homes, `varId: "K1" 全树命中 ${homes.length} 处（${homes.join("、")}）—— 定位前提变了`).toHaveLength(1);
    const src = readRepo(homes[0]!);
    // 旧假话（这两句今天为假）。**注释不参与判定**：文档里引用旧写法是应该的（`:558` 那段是病历，
    // 同段自己就写着「今天是假的」），真正要禁的是它重新变成上屏的可执行文案。
    const code = stripComments(src);
    expect(code, "K1 又回到「Cadence 对象全仓 0 条」").not.toMatch(/`Cadence` 对象全仓 0 条/);
    expect(code, "K1 又回到「从没落库」").not.toContain("从没落库");
    expect(code, "K2 又回到「同上无 Cadence 实例」").not.toContain("但同上无 `Cadence` 实例");
    // 新话必须带保质期与复验方式
    for (const varId of ["K1", "K2"]) {
      const unit = evidenceOf(src, varId);
      expect(unit, `${varId} evidence 没写实测日期`).toMatch(/20\d{2}-\d{2}-\d{2}/);
      expect(unit, `${varId} evidence 没给复验方式（file:line / 端点 / 命令）`).toMatch(/[\w./-]+\.tsx?(:\d+)?|grep|\/a\/v1/);
    }
    // 「缺」今天的含义必须写清楚：缺的是**来路**，不是承载（三分法混了必修错地方）
    expect(evidenceOf(src, "K1")).toContain("没接线");
  });

  it("REWORK 那条**没被顺手改坏**（它与后端口径一致、今天仍成立）", () => {
    expect(factHits(checkedTree("apps/frontend-shell/src", 'from "@platform/contracts"', 100), "没有返工工时或天数字段"), "REWORK 的口径文案没了 —— 要么被顺手改坏，要么搬了家").not.toEqual([]);
  });
});

describe("§4 · 控制台图例不许再复述「零输入基线」", () => {
  const console_ = () => readRepo("apps/frontend-shell/src/views/sim/SandboxConsole.tsx");

  it("图例只读 `.label`（四个分支恒等、不带保质期），**不读** `.reason` / `.status` / `.unblockedBy`", () => {
    // 注释里**引用**旧写法是应该的（那是病历），要禁的是它是可执行代码
    const code = stripComments(console_());
    for (const perishable of ["reason", "status", "unblockedBy"]) {
      for (const rec of ["CADENCE_ABSENCE", "PROCUREMENT_BRANCH"]) {
        expect(
          code,
          `${rec}.${perishable} 又被渲染了 —— 那是 deriveXxx() 零输入那一档（恒 NOT_FETCHED），` +
            "而它下面的 <TransitFlowView> 正在真取数：同一屏两句话互相打脸",
        ).not.toContain(`${rec}.${perishable}`);
      }
    }
    // 仍在引用（`transitFlow.ts:486-490` 记着这两个导出保留的理由就是本图例还在用它们）——
    // 引用**住在哪个文件**不是事实（WO-C 修法）：全树判在不在，搬家不红。
    const feTree = checkedTree("apps/frontend-shell/src", 'from "@platform/contracts"', 100);
    expect(factHits(feTree, "CADENCE_ABSENCE.label"), "图例不再读 CADENCE_ABSENCE.label —— 又回去读会过期的字段了").not.toEqual([]);
    expect(factHits(feTree, "PROCUREMENT_BRANCH.label"), "图例不再读 PROCUREMENT_BRANCH.label —— 同上").not.toEqual([]);
  });

  it("`.label` 确实是**输入无关**的（四个分支同一个值）—— 否则读它一样是在读一张会过期的快照", async () => {
    const m = await import("@/views/sim/transitFlow");
    const cadenceRow = { nodeId: "n1", dataMode: "SYNTHETIC", everyDays: 5, cadenceKind: "batch" };
    const labels = [
      m.deriveCadenceAbsence().label, // NOT_FETCHED
      m.deriveCadenceAbsence({ cadenceRows: [] }).label, // TENANT_EMPTY
      m.deriveCadenceAbsence({ cadenceRows: [{ nodeId: "n1" }] }).label, // CONTRACT_REJECTED
      m.deriveCadenceAbsence({ cadenceRows: [cadenceRow] }).label, // PRESENT
    ];
    expect(new Set(labels).size, "label 随输入变了 —— 图例就不能只读它").toBe(1);
    const pLabels = [
      m.deriveProcurementBranch().label,
      m.deriveProcurementBranch({ customsRows: [] }).label,
      m.deriveProcurementBranch({ customsRows: [{ clearanceId: "c", declaredDay: 1, clearedDay: 2 }] }).label,
    ];
    expect(new Set(pLabels).size).toBe(1);
  });

  it("图例紧挨着渲染的就是会真取数的 `<TransitFlowView>` —— 状态由它自陈", () => {
    // 邻接关系住在哪个文件不是事实（WO-C 修法）：全树判（剥注释后 JSX 相邻关系不受影响）。
    expect(factHits(checkedTree("apps/frontend-shell/src", 'from "@platform/contracts"', 100), /<TransitComputabilityLegend \/>[\s\S]{0,200}<TransitFlowView/), "图例不再挨着 <TransitFlowView> —— 「状态由它自陈」的布局前提没了").not.toEqual([]);
  });
});

/** 取某个变量对象的 evidence 串（到下一个属性为止）。 */
function evidenceOf(src: string, varId: string): string {
  const at = src.indexOf(`varId: "${varId}"`);
  expect(at, `找不到变量 ${varId}`).toBeGreaterThan(-1);
  const from = src.indexOf("evidence:", at);
  const to = src.indexOf("\n      baseline:", from);
  return src.slice(from, to === -1 ? from + 1200 : to);
}
