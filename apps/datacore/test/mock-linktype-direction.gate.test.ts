import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery } from "./helpers.js";

/**
 * WO-SANDBOX-PROP-DIRECTION · **前端 mock 的链路方向 = 本体单源**（欠账 #160 的机械门）。
 *
 * ── 为什么这道门必须存在（铁律 0.6：同一个错第二次必须建机制）────────────────────────
 * #158（种子规则方向反）与 #160（前端 mock 方向反）是**同一个错的两个副本**，写成一句是：
 *   **「我用『这个 linkKey 的名字读起来像 A→B』当作『它在本体里就是 A→B』的证据。」**
 * `line_belongs_to_base` 名字读作 Line→Base；而契约 cardinality 只允许 1:1/1:N/N:N，
 * N:1 语义**一律翻转方向**表达为 1:N（`battery.ts:2314` 注释原文）⇒ 真方向是 **Base→Line**。
 * 两处都照名字猜，两处都猜反。#158 已修（WO-P1），#160 本单修 —— 按三级处置，
 * 第 2 次必须**当场建机制**，所以有了本文件：**下次谁再把方向写反，是机器先说话，不是人先想起来。**
 *
 * ── 这道门比"再抄一份对照表"强在哪 ────────────────────────────────────────────────
 * 判据来源是**真路由的真响应**（`GET /a/v1/ontology/mapping/registries`，
 * 与 mock 所模仿的是同一个端点），不是本文件里硬编的一张表 ——
 * 硬编只是把"抄错"的位置从 mock 挪到测试，本体一改照样两边一起过期。
 *
 * ⚠ 只咬**方向**（fromType/toType）。cardinality 的既有漂移**如实登记在案**（见下 §诚实缺席），
 * 不在本单顺手改 —— 本单范围是"只改方向不改别的"。
 */

/** 前端 mock 文件（唯一读取点）。测试文件位置变了这里也要跟着变，故用 import.meta 定位，不用 cwd。 */
const MOCK_PATH = fileURLToPath(new URL("../../frontend-shell/src/mocks/handlers.ts", import.meta.url));

interface MockLinkType { key: string; fromType: string; toType: string; cardinality: string }

/**
 * 从 mock 源码里抽出 `/a/v1/ontology/mapping/registries` 那个 handler 的 `linkTypes` 数组。
 *
 * **金丝雀与主逻辑共用这一支实现**（铁律 0.6 明令：不许各抄一份正则 ——
 * 抄了就是装饰品，改主正则时金丝雀拿旧的去测、照样绿）。
 */
function extractMockLinkTypes(src: string): MockLinkType[] {
  // ⚠️ **锚点必须咬 handler，不能咬裸路径串**（2026-08-15 四包 gate 实测抓出）：
  //    裸串 `/a/v1/ontology/mapping/registries` 在本文件里出现 **2 次** ——
  //    第 1 次在一段**注释**里（`057157fe` 收编 WO-ACTIVE-EDGE-UX 时带进来的），
  //    真 handler 在 2000 行开外。`indexOf` 取第一处 ⇒ 从注释往后找 `linkTypes: [`
  //    ⇒ 抽出 **0 条**，金丝雀当场报「工具坏了」（它没有谎报「mock 很干净」，这正是它该干的）。
  //    形态（CLAUDE.md 铁律 0.5 判据 #5 同族）：
  //      **「我用『源码里出现了这个路径串』当作『这里就是那个 handler』的证据，而前者并不度量后者。」**
  //    本仓已因未剥注释的 `indexOf` 栽过至少三次（变异反证插进注释里 / 补文案插进 import 区）。
  //    改法：锚 `http.get("…路径…"` 这个**调用形态**，注释里不会出现它。
  const anchor = src.search(/http\.get\(\s*"[^"]*\/a\/v1\/ontology\/mapping\/registries"/);
  if (anchor < 0) throw new Error(`工具坏了：${MOCK_PATH} 里找不到 registries **handler**（不是注释）锚点（文件被挪了/端点改名了）`);
  const start = src.indexOf("linkTypes: [", anchor);
  if (start < 0) throw new Error("工具坏了：registries handler 之后找不到 linkTypes 数组");
  const end = src.indexOf("]", start);
  if (end < 0) throw new Error("工具坏了：linkTypes 数组没有收口");
  const block = src.slice(start, end);
  const out: MockLinkType[] = [];
  const re = /\{\s*key:\s*"([^"]+)",\s*fromType:\s*"([^"]+)",\s*toType:\s*"([^"]+)",\s*cardinality:\s*"([^"]+)"\s*\}/g;
  for (let m = re.exec(block); m !== null; m = re.exec(block)) {
    out.push({ key: m[1]!, fromType: m[2]!, toType: m[3]!, cardinality: m[4]! });
  }
  return out;
}

/**
 * §诚实缺席 —— **已知的 cardinality 漂移登记表**（本单不修，如实亮出）。
 *
 * 为什么登记而不是忽略：忽略等于把一个已知的错藏进"测试是绿的"里，
 * 那正是本仓要根治的假绿。登记之后它是**机器可见**的：
 *  · 谁把它修好了 ⇒ 本表对不上、测试变红 ⇒ 顺手把这一行删掉即可（红得便宜、红得有信息）；
 *  · 谁又新写坏一条 ⇒ 同样变红。
 * 两种都比"静静地错着"强。
 */
const KNOWN_CARDINALITY_DRIFT: { key: string; mock: string; real: string }[] = [
  // mock 写 1:1，真本体是 1:N（一个型号被多张订单要）。方向对，只有基数不对 ⇒ 不在本单范围。
  { key: "order_for_model", mock: "1:1", real: "1:N" },
];

describe("WO-SANDBOX-PROP-DIRECTION · 前端 mock 链路方向 = 本体单源（#160 机械门）", () => {
  it("🔴 mock 的每条 linkType 方向都与真路由下发的本体声明一致（#158/#160 同源复发闸）", async () => {
    const src = readFileSync(MOCK_PATH, "utf8");
    const mockLinks = extractMockLinkTypes(src);

    // 🐤 金丝雀（与主逻辑同一支 `extractMockLinkTypes`）：抽取器本身得是好的。
    // 抽出 0 条时**不许**报「mock 很干净 / 没有方向问题」，只能报「工具坏了」。
    expect(mockLinks.length).toBeGreaterThan(0);
    expect(mockLinks.map((l) => l.key)).toContain("line_belongs_to_base");

    const t = await makeApp();
    await seedBattery(t);
    const reg = (await (await t.app.inject({
      method: "GET", url: "/a/v1/ontology/mapping/registries", headers: ADMIN,
    })).json()) as { linkTypes: MockLinkType[] };
    // 🐤 金丝雀 2：真路由这一侧也得真有数据，否则下面「零不一致」是因为没得比。
    expect(reg.linkTypes.length).toBeGreaterThan(0);
    const real = new Map(reg.linkTypes.map((l) => [l.key, l]));

    const mismatches: string[] = [];
    const cardinalityDrift: { key: string; mock: string; real: string }[] = [];
    for (const m of mockLinks) {
      const r = real.get(m.key);
      if (!r) {
        mismatches.push(`${m.key}: mock 里有、真本体里**没有这条 linkType**（键名过期或拼错）`);
        continue;
      }
      if (m.fromType !== r.fromType || m.toType !== r.toType) {
        mismatches.push(
          `${m.key}: mock 声明 ${m.fromType}→${m.toType}，真本体是 ${r.fromType}→${r.toType}（方向相反/错位）`,
        );
      }
      if (m.cardinality !== r.cardinality) cardinalityDrift.push({ key: m.key, mock: m.cardinality, real: r.cardinality });
    }

    // 🔴 本门的判据：方向零不一致。
    expect(mismatches).toEqual([]);
    // 诚实缺席：基数漂移必须与登记表**逐条对得上**（多一条少一条都红）。
    expect(cardinalityDrift.sort((a, b) => a.key.localeCompare(b.key)))
      .toEqual([...KNOWN_CARDINALITY_DRIFT].sort((a, b) => a.key.localeCompare(b.key)));
  });

  it("🔴 变异反证：喂一段方向写反的 mock 源码，门必须判它红（证明门咬的是方向不是存在性）", async () => {
    const src = readFileSync(MOCK_PATH, "utf8");
    // #160 原文：把 line_belongs_to_base 改回 Line→Base。
    const mutated = src.replace(
      '{ key: "line_belongs_to_base", fromType: "Base", toType: "Line", cardinality: "1:N" }',
      '{ key: "line_belongs_to_base", fromType: "Line", toType: "Base", cardinality: "1:N" }',
    );
    // 变异必须真的发生 —— 否则下面"抽到反方向"是假的（本仓栽过：改名成 xxxXX 而断言用 toContain("xxx") 照样通过）。
    expect(mutated).not.toBe(src);

    const mutatedLinks = extractMockLinkTypes(mutated); // 同一支抽取器，不另抄
    const bad = mutatedLinks.find((l) => l.key === "line_belongs_to_base")!;
    expect([bad.fromType, bad.toType]).toEqual(["Line", "Base"]);

    const t = await makeApp();
    await seedBattery(t);
    const reg = (await (await t.app.inject({
      method: "GET", url: "/a/v1/ontology/mapping/registries", headers: ADMIN,
    })).json()) as { linkTypes: MockLinkType[] };
    const r = reg.linkTypes.find((l) => l.key === "line_belongs_to_base")!;
    // 判据反过来走一遍：同一套比较逻辑，对变异体必须报不一致。
    expect(bad.fromType !== r.fromType || bad.toType !== r.toType).toBe(true);
  });
});
