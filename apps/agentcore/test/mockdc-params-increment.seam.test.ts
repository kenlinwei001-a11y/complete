import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createMockDataCore } from "../src/mocks/clients.js";
import type { ToolAuthCtx } from "../src/tools/clients.js";

/**
 * WO-MOCKDC-PARAMS-INCREMENT · 在 WO-MOCKDC-SIGNATURE 闭合的形参承重之上补三个**真增量**
 * （旧竞争分支 claude/handoff-wo-mockdc-params 复验后弃并，这三个是它身上有、集成线没有的）：
 *
 * ① **snapshotVersion 时点可见性**：`queryObjects` 带 `asOfEpoch` 时 snapshotVersion 追加
 *    `@<asOfEpoch>` 后缀（与真 DataCore `datacore/src/ontology.ts` 的 `${snapshot}@${asOfEpoch}` 同形）。
 *    「读到的是哪个时点的快照」由此外部可见可断言 —— 集成线版只能数行数，证不了「时点读生效了」。
 * ② **同 id 多版本解析**：同一行 id 在同一租户写多次（不同 epoch）= 该行的新版本，不是另一行。
 *    集成线扁平 tenantRows 对同 id 写两次会读出**两条重复行**（本文件 §2 的断言在修复前就是红的，
 *    修复后咬行为：读回必须是 epoch<=asOfEpoch 的最新版那一条）。
 * ③ **形状断言**：`createMockDataCore()` 返回对象的字段不许是内联对象字面量
 *    （如 `epoch: { async current() {…} }`）——类型级形参守卫（signature-parity.ts）只看
 *    已声明的类，字面量替身是它的盲区；这条 AST 断言把盲区钉死，防回潮。
 *
 * 金丝雀纪律（CLAUDE.md 铁律 0.6）：③ 的扫描器自带 MUTATION 金丝雀——把源码在内存里
 * 改出一个字面量字段重扫，必须被抓出来；抓不出 ⇒ 报「工具坏了」，不许报「代码干净」。
 * 金丝雀与主逻辑共用同一个 `scanInlineLiteralFields()`，不各抄一份。
 */

const ctxOf = (tenantId: string): ToolAuthCtx =>
  ({ tenantId, userId: "u1", roles: ["planner"] }) as unknown as ToolAuthCtx;

const A = ctxOf("tenant-a");

const itemsOf = (p: { data: unknown }): Record<string, unknown>[] =>
  (p.data as { items: Record<string, unknown>[] }).items;

describe("WO-MOCKDC-PARAMS-INCREMENT ① · snapshotVersion 时点可见性（与真 DataCore 同形）", () => {
  it("带 asOfEpoch ⇒ snapshotVersion 追加 @<asOfEpoch>；不带 ⇒ 无后缀", async () => {
    const dc = createMockDataCore();
    const eWrite = dc.ontology.addObjectForTenant(A, "Base", { objectId: "base_sv", name: "时点探针" });

    const pinned = await dc.ontology.queryObjects(A, "Base", {}, undefined, eWrite);
    const live = await dc.ontology.queryObjects(A, "Base", {});

    // 同形判据：真 DataCore ontology.ts 的 as-of 读就是 `${snapshot}@${asOfEpoch}`。
    expect(pinned.snapshotVersion).toBe(`ont-snap-001@${eWrite}`);
    expect(pinned.snapshotVersion).toMatch(/@\d+$/);
    expect(live.snapshotVersion).toBe("ont-snap-001");
    expect(live.snapshotVersion).not.toContain("@");
    // 不同时点 ⇒ 后缀不同（「时点读生效」的外部可见证据，不只靠行集差异）。
    const earlier = await dc.ontology.queryObjects(A, "Base", {}, undefined, eWrite - 1);
    expect(earlier.snapshotVersion).toBe(`ont-snap-001@${eWrite - 1}`);
    expect(earlier.snapshotVersion).not.toBe(pinned.snapshotVersion);
  });
});

describe("WO-MOCKDC-PARAMS-INCREMENT ② · 同 id 多版本解析（后写覆盖先写，按时点回溯）", () => {
  it("同 id 不同 epoch 写两次 ⇒ 读回必须是**最新版那一条**，不是两条重复行", async () => {
    const dc = createMockDataCore();
    const e1 = dc.ontology.addObjectForTenant(A, "Base", { objectId: "base_ver", name: "版本1", util: 0.1 });
    const e2 = dc.ontology.addObjectForTenant(A, "Base", { objectId: "base_ver", name: "版本2", util: 0.2 });
    expect(e2).toBeGreaterThan(e1);

    const rows = itemsOf(await dc.ontology.queryObjects(A, "Base", {})).filter((i) => i.objectId === "base_ver");
    // 头号判据：一条，且是后写的版本。修复前这里读出两条（版本1+版本2并排）——重复行病灶。
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "版本2", util: 0.2 });

    // 时点回溯：钉在 e1 ⇒ 只能见到版本1；钉在两写之前 ⇒ 该行那时还不存在。
    const atE1 = itemsOf(await dc.ontology.queryObjects(A, "Base", {}, undefined, e1)).filter((i) => i.objectId === "base_ver");
    expect(atE1).toHaveLength(1);
    expect(atE1[0]).toMatchObject({ name: "版本1", util: 0.1 });
    const atE0 = itemsOf(await dc.ontology.queryObjects(A, "Base", {}, undefined, e1 - 1)).filter((i) => i.objectId === "base_ver");
    expect(atE0).toHaveLength(0);

    // total 与 items 同口径（去重后的计数，不是历史条数）。
    const live = await dc.ontology.queryObjects(A, "Base", { objectId: "base_ver" });
    expect((live.data as { total: number }).total).toBe(1);
  });

  it("归组只按同 id：不同 id 的行各有各的，不被折叠；解析不出 id 的行不参与版本归组", async () => {
    const dc = createMockDataCore();
    dc.ontology.addObjectForTenant(A, "Base", { objectId: "base_k1", name: "甲" });
    dc.ontology.addObjectForTenant(A, "Base", { objectId: "base_k2", name: "乙" });
    // 无 objectId/id/baseId 的匿名行：连标识都没有，不能折进同一个键假装是同一行的版本。
    dc.ontology.addObjectForTenant(A, "Base", { name: "匿名1" });
    dc.ontology.addObjectForTenant(A, "Base", { name: "匿名2" });

    const names = itemsOf(await dc.ontology.queryObjects(A, "Base", {}))
      .map((i) => String(i.name))
      .filter((n) => ["甲", "乙", "匿名1", "匿名2"].includes(n));
    expect(names.sort()).toEqual(["匿名1", "匿名2", "甲", "乙"].sort());
  });
});

/* ── ③ 形状断言的扫描器（主逻辑；金丝雀与正式扫描共用这一份） ───────────── */

const MOCK_PATH = fileURLToPath(new URL("../src/mocks/clients.ts", import.meta.url));

/** 扫 createMockDataCore() 的 return 对象字面量，抓「字段值是带方法的内联对象字面量」。 */
function scanInlineLiteralFields(textOverride?: string): { inline: string[]; factoryFound: boolean; returnIsLiteral: boolean } {
  const sf = ts.createSourceFile(MOCK_PATH, textOverride ?? readFileSync(MOCK_PATH, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  let factory: ts.FunctionDeclaration | undefined;
  ts.forEachChild(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === "createMockDataCore") factory = n;
  });
  if (!factory) return { inline: [], factoryFound: false, returnIsLiteral: false };
  const ret = factory.body?.statements.find((s): s is ts.ReturnStatement => ts.isReturnStatement(s));
  const obj = ret?.expression;
  if (!obj || !ts.isObjectLiteralExpression(obj)) return { inline: [], factoryFound: true, returnIsLiteral: false };
  const inline: string[] = [];
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const init = prop.initializer;
    const isLiteralWithMethods =
      ts.isObjectLiteralExpression(init) &&
      init.properties.some(
        (p) => ts.isMethodDeclaration(p) || (ts.isPropertyAssignment(p) && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))),
      );
    if (isLiteralWithMethods) inline.push(prop.name.getText(sf));
  }
  return { inline, factoryFound: true, returnIsLiteral: true };
}

describe("WO-MOCKDC-PARAMS-INCREMENT ③ · createMockDataCore 字段不许内联对象字面量（形参守卫盲区封堵）", () => {
  it("正式断言：13 个客户端字段都是类实例/类构造调用，零内联字面量", () => {
    const r = scanInlineLiteralFields();
    // 结构自证：抽取器真的找到了工厂和 return 字面量 —— 找不到而判「干净」是假绿。
    expect(r.factoryFound, "找不到 createMockDataCore ⇒ 锚点坏了，不许静默跳过").toBe(true);
    expect(r.returnIsLiteral, "createMockDataCore 不再直接 return 对象字面量 ⇒ 本断言的抽取失效").toBe(true);
    expect(
      r.inline,
      `这些字段是内联对象字面量而非类实例：[${r.inline.join(", ")}] —— ` +
        `类型级形参守卫（signature-parity.ts）只看已声明的类，字面量替身少写多少形参都查不出来。` +
        `请改成 \`class MockXxx implements XxxClient\`（先例：MockEpochClient）。`,
    ).toEqual([]);
  });

  it("金丝雀 MUTATION：把 epoch 字段在内存里改成内联字面量 ⇒ 必须被抓出来（抓不出 = 扫描器是装饰品）", () => {
    const orig = readFileSync(MOCK_PATH, "utf8");
    const anchor = "epoch: new MockEpochClient(ontology),";
    expect(orig.includes(anchor), "金丝雀锚点串没匹配上（构造形状被改过？）⇒ 工具坏了，不是代码干净").toBe(true);
    const mutated = orig.replace(anchor, "epoch: { async current() { return { epoch: 1 }; } },");
    const r = scanInlineLiteralFields(mutated);
    expect(r.inline, "变异后仍判零内联 ⇒ 本断言检不出字面量回潮，是装饰品").toContain("epoch");
  });
});
