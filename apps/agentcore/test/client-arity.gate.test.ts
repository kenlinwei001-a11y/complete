import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * WO-MOCKDC-PARAMS · **门**：DataCore 客户端的任何实现，形参不许比接口少。
 *
 * ── 为什么要一道门，而不是"下次注意"（CLAUDE.md 铁律 0.6 三级处置）──────────────
 * TS **允许**用更少的形参实现接口（`(a) => x` 可赋给 `(a, b) => x`）。于是：
 *   `pnpm -r build` 绿 · `pnpm -r typecheck` 绿 · 该 mock 的全部单测绿，
 * 而 mock 的具体类型比契约窄 —— 实质是**收了参数不认**：
 *   · 漏 `ctx`        ⇒ mock 里没有租户这一维 ⇒ 跑在它上面的 R2 断言测的是一个不认租户的世界；
 *   · 漏 `asOfEpoch`  ⇒ 「按某时刻读」这一维不存在 ⇒ 时点读断言恒绿而真后端未必；
 *   · 漏 `signal`     ⇒ 「取消」这一维不存在。
 * 形态（0.6 句式）：**「我用『测试在 mock 上绿』当作『真后端也会这么行为』的证据，
 * 而 mock 少收了参数 ⇒ 它连那个维度都不存在。」**
 * 类型系统看不见这件事 ⇒ 只能另外扫 ⇒ 这就是本门存在的理由。
 *
 * ── 金丝雀纪律（0.6 已落地的机制）──────────────────────────────────────────
 * 扫描类结论在报出之前必须先跑一个「已知必中」的样例，且**金丝雀与主逻辑共用同一份实现**
 * （各抄一份正则的金丝雀是装饰品：改主正则时它拿旧的去测、照样绿）。
 * 本文件里两者都走同一个 `scanArity()`：
 *   · POSITIVE：一个确定形参齐全的方法必须判 OK —— 判 MISSING 就是对照方法坏了；
 *   · MUTATION：把该方法在**内存里**砍掉一个形参重扫，必须判 MISSING —— 判 OK 也是对照方法坏了。
 * 金丝雀不中 ⇒ 报「工具坏了」，**不许**报「代码干净」。
 */

const IFACE_PATH = fileURLToPath(new URL("../src/tools/clients.ts", import.meta.url));
const IMPL_PATHS = [
  fileURLToPath(new URL("../src/mocks/clients.ts", import.meta.url)),
  fileURLToPath(new URL("../src/tools/datacore-http.ts", import.meta.url)),
];

interface MethodSig {
  params: string[];
  optional: boolean;
  line: number;
}
interface ArityRow {
  verdict: "OK" | "MISSING_PARAM" | "ABSENT";
  cls: string;
  iface: string;
  method: string;
  want: string[];
  wantLine: number;
  got: string[] | null;
  gotLine: number | null;
  file: string;
}

function parse(file: string, textOverride?: string): ts.SourceFile {
  return ts.createSourceFile(file, textOverride ?? readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

function collectInterfaces(sf: ts.SourceFile): Map<string, { extendsList: string[]; methods: Map<string, MethodSig> }> {
  const out = new Map<string, { extendsList: string[]; methods: Map<string, MethodSig> }>();
  ts.forEachChild(sf, (node) => {
    if (!ts.isInterfaceDeclaration(node)) return;
    const methods = new Map<string, MethodSig>();
    for (const m of node.members) {
      let name: string | undefined;
      let params: string[] | undefined;
      let optional = false;
      if (ts.isMethodSignature(m) && m.name) {
        name = m.name.getText(sf);
        params = m.parameters.map((p) => p.name.getText(sf));
        optional = !!m.questionToken;
      } else if (ts.isPropertySignature(m) && m.name && m.type && ts.isFunctionTypeNode(m.type)) {
        name = m.name.getText(sf);
        params = m.type.parameters.map((p) => p.name.getText(sf));
        optional = !!m.questionToken;
      }
      if (!name || !params) continue;
      methods.set(name, { params, optional, line: sf.getLineAndCharacterOfPosition(m.getStart(sf)).line + 1 });
    }
    out.set(node.name.text, {
      extendsList: (node.heritageClauses ?? [])
        .filter((h) => h.token === ts.SyntaxKind.ExtendsKeyword)
        .flatMap((h) => h.types.map((t) => t.expression.getText(sf))),
      methods,
    });
  });
  return out;
}

function resolveInterface(
  name: string,
  ifaces: ReturnType<typeof collectInterfaces>,
  seen = new Set<string>(),
): Map<string, MethodSig> {
  const merged = new Map<string, MethodSig>();
  if (seen.has(name)) return merged;
  seen.add(name);
  const i = ifaces.get(name);
  if (!i) return merged;
  for (const parent of i.extendsList) for (const [k, v] of resolveInterface(parent, ifaces, seen)) merged.set(k, v);
  for (const [k, v] of i.methods) merged.set(k, v);
  return merged;
}

function collectClasses(sf: ts.SourceFile): { name: string; impl: string[]; methods: Map<string, { params: string[]; line: number }> }[] {
  const out: { name: string; impl: string[]; methods: Map<string, { params: string[]; line: number }> }[] = [];
  ts.forEachChild(sf, (node) => {
    if (!ts.isClassDeclaration(node) || !node.name) return;
    const impl = (node.heritageClauses ?? [])
      .filter((h) => h.token === ts.SyntaxKind.ImplementsKeyword)
      .flatMap((h) => h.types.map((t) => t.expression.getText(sf)));
    const methods = new Map<string, { params: string[]; line: number }>();
    for (const m of node.members) {
      let name: string | undefined;
      let params: string[] | undefined;
      if (ts.isMethodDeclaration(m) && m.name) {
        name = m.name.getText(sf);
        params = m.parameters.map((p) => p.name.getText(sf));
      } else if (ts.isPropertyDeclaration(m) && m.name && m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer))) {
        name = m.name.getText(sf);
        params = m.initializer.parameters.map((p) => p.name.getText(sf));
      }
      if (!name || !params) continue;
      methods.set(name, { params, line: sf.getLineAndCharacterOfPosition(m.getStart(sf)).line + 1 });
    }
    out.push({ name: node.name.text, impl, methods });
  });
  return out;
}

/** 主逻辑 —— 金丝雀与正式扫描共用这一份（不许各抄一份）。 */
function scanArity(implPath: string, textOverride?: string): ArityRow[] {
  const ifaces = collectInterfaces(parse(IFACE_PATH));
  const sf = parse(implPath, textOverride);
  const rows: ArityRow[] = [];
  for (const cls of collectClasses(sf)) {
    for (const iname of cls.impl) {
      const im = resolveInterface(iname, ifaces);
      if (im.size === 0) continue;
      for (const [mname, sig] of im) {
        const got = cls.methods.get(mname);
        if (!got) {
          if (!sig.optional) {
            rows.push({ verdict: "ABSENT", cls: cls.name, iface: iname, method: mname, want: sig.params, wantLine: sig.line, got: null, gotLine: null, file: implPath });
          }
          continue;
        }
        rows.push({
          verdict: got.params.length < sig.params.length ? "MISSING_PARAM" : "OK",
          cls: cls.name,
          iface: iname,
          method: mname,
          want: sig.params,
          wantLine: sig.line,
          got: got.params,
          gotLine: got.line,
          file: implPath,
        });
      }
    }
  }
  return rows;
}

const MOCK_PATH = IMPL_PATHS[0] as string;
/** 金丝雀锚点：一个确定形参齐全的方法（形参名写在这里，改动它时金丝雀会立刻不中 = 机器先说话）。 */
const CANARY_SIGNATURE = "async getObject(ctx: ToolAuthCtx, objectType: string, objectId: string): Promise<ToolPayload> {";
const CANARY_MUTATED = "async getObject(ctx: ToolAuthCtx, objectType: string): Promise<ToolPayload> {";

describe("WO-MOCKDC-PARAMS 门 · DataCore 客户端实现的形参不许比接口少", () => {
  it("金丝雀 POSITIVE：已知形参齐全的方法必须判 OK（判 MISSING 就是对照方法坏了）", () => {
    const row = scanArity(MOCK_PATH).find((r) => r.cls === "MockOntologyClient" && r.method === "getObject");
    expect(row, "金丝雀探针方法没找到 ⇒ 对照方法坏了，本门的一切否定结论作废").toBeDefined();
    expect(row?.verdict, `金丝雀 POSITIVE 不通过：want=[${row?.want}] got=[${row?.got}] ⇒ 对照方法坏了`).toBe("OK");
  });

  it("金丝雀 MUTATION：人为砍掉一个形参后必须判 MISSING_PARAM（判 OK 就是对照方法坏了）", () => {
    const orig = readFileSync(MOCK_PATH, "utf8");
    expect(orig.includes(CANARY_SIGNATURE), "金丝雀锚点串没匹配上（签名被改过？）⇒ 工具坏了，不是代码干净").toBe(true);
    const mutated = orig.replace(CANARY_SIGNATURE, CANARY_MUTATED);
    const row = scanArity(MOCK_PATH, mutated).find((r) => r.cls === "MockOntologyClient" && r.method === "getObject");
    expect(row?.verdict, "变异后仍判 OK ⇒ 本门检不出少形参，是装饰品").toBe("MISSING_PARAM");
  });

  it("全量：mocks/clients.ts 与 tools/datacore-http.ts 的每个实现，形参数量 ≥ 接口声明", () => {
    const all = IMPL_PATHS.flatMap((p) => scanArity(p));
    // 自证：扫到的配对数必须显著大于 0，否则是"什么都没扫到"被读成"没有问题"。
    expect(all.length, "一个「接口方法 × 实现类」配对都没扫到 ⇒ 工具坏了").toBeGreaterThan(50);
    const bad = all.filter((r) => r.verdict !== "OK");
    const detail = bad
      .map(
        (r) =>
          `[${r.verdict}] ${r.cls}.${r.method} @ ${r.file.split("/apps/")[1]}:${r.gotLine ?? "-"}\n` +
          `    接口 ${r.iface}.${r.method} (src/tools/clients.ts:${r.wantLine}) 声明 ${r.want.length} 形参 [${r.want.join(", ")}]\n` +
          `    实现只写 ${r.got?.length ?? "缺"} 个 [${(r.got ?? []).join(", ")}]\n` +
          `    ⚠ TS 允许少写形参实现接口，故 build/typecheck 都不会报 —— 但那个维度在这个实现里**根本不存在**。`,
      )
      .join("\n");
    expect(bad, `形参比接口少的实现（补齐并让它真的被用上，别只补签名）：\n${detail}`).toEqual([]);
  });
});
