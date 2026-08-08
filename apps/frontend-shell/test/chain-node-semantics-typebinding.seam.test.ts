import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * WO-SEMANTICS-SINGLESOURCE · **语义表键 ↔ 契约注册表的编译期绑定** 接缝门。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 这道门在守什么（以及为什么非它不可）
 * ══════════════════════════════════════════════════════════════════════════════
 * `chain-node-singlesource` 门的 `C·抄表` 判据本来会把 `chainNodeSemantics.ts` 判红
 * （12 个在册 nodeId 写成字面量 = 「第二份注册表」）。该判据现在**按机制豁免**它，
 * 豁免的**唯一理由**是这一行声明：
 *
 *     const CHAIN_NODE_SEMANTICS: Partial<Record<RegisteredChainNodeId, ChainNodeSemantics>>
 *     type RegisteredChainNodeId = ChainNodeDef["nodeId"]        // 派生自 CHAIN_NODE_REGISTRY
 *
 * ——键类型是注册表 `as const` 派生的字面量联合，所以「改册这里不跟着变」是假的：**改册即 TS2353**。
 *
 * ⚠ **豁免的前提是可以被人无声改掉的**：把类型放宽成 `Record<string, …>`、
 *   掺成 `Rid | string`、或改用 `as` 断言，`tsc` 当场就不再咬了（三条都是实测），
 *   而**文件表面看起来一模一样**、既有单测也全绿 —— 那一刻豁免就变成了白送，
 *   `C` 判据对这个文件等于被拆了，且没有任何信号。
 *   本仓管这个叫「绿测试 ≠ 能用」；`chain-node-singlesource` 自己的自检只能证明
 *   **门的豁免逻辑**没瞎，证明不了**被豁免那个文件**的类型还在不在。
 *
 * ⇒ 故本门**真跑 TypeScript 编译器**（不是读源码找关键字、不是正则匹配声明行），
 *   在内存里对真实的 `chainNodeSemantics.ts` × 真实的 `chain-sim.ts` 注册表做四组正反对拍。
 *   跨的是「契约包 × 前端包 × 编译器」三方接缝，任一半改动都咬得到。
 *
 * 四组用例（正反成对，缺一组都会让另一组变成恒真）：
 *  §1 原样  ⇒ 零 TS2353            （反面锚：证明报错不是本 harness 自己制造的噪声）
 *  §2 键写歪 ⇒ TS2353 且点名到那个键 （正面：编译期包含关系真的在生效）
 *  §3 **改册** ⇒ 语义表当场红        （正面：直接证伪 C 的立论「改册时这里不会跟着变」）
 *  §4 类型放宽 ⇒ §2 的错误**消失**   （反面锚：证明是那行类型在承重，不是别的什么东西）
 */

// ── 仓根 = 自**本测试文件**向上第一个含 pnpm-workspace.yaml 的目录 ─────────────
// 刻意不用 process.cwd()：隔离 worktree 里跑时 cwd 仍指向主 checkout，曾据此读错文件造成假绿。
const TEST_FILE = import.meta.url.startsWith("file:") ? fileURLToPath(import.meta.url) : import.meta.url;
const REPO_ROOT = (() => {
  let dir = dirname(TEST_FILE);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`[semantics-typebinding] 找不到仓根（自 ${TEST_FILE} 向上未见 pnpm-workspace.yaml）`);
})();

const SEMANTICS_FILE = join(REPO_ROOT, "apps/frontend-shell/src/views/sim/chainNodeSemantics.ts");
const CONTRACT_FILE = join(REPO_ROOT, "packages/contracts/src/chain-sim.ts");
const CONTRACT_ENTRY = join(REPO_ROOT, "packages/contracts/src/index.ts");
/** 虚拟探针文件：与真文件同目录同扩展名，保证模块解析行为一致。 */
const PROBE_FILE = join(REPO_ROOT, "apps/frontend-shell/src/views/sim/__typebinding_probe__.ts");

const SEMANTICS_SRC = readFileSync(SEMANTICS_FILE, "utf8");
const CONTRACT_SRC = readFileSync(CONTRACT_FILE, "utf8");

/** 被拿来做变异的那个在册节点（取自**契约**，不在本文件里另写一份 id）。 */
const PROBE_NODE_ID = (() => {
  const m = /nodeId:\s*"([^"]+)"/.exec(CONTRACT_SRC);
  if (m === null) throw new Error("[semantics-typebinding] 从 chain-sim.ts 解析不到任何 nodeId —— 契约形状变了");
  return m[1]!;
})();

/**
 * 编译真实语义表（可注入覆盖内容），只取**该文件自己的**语义诊断。
 * 契约走 `paths` 指到**源码**而非 dist —— 不依赖「先 build 过 contracts」这个隐藏前置，
 * 否则本门会在没 build 的机器上静默变成「零诊断 ⇒ 全绿」。
 */
function diagnose(overrides: Record<string, string>): readonly ts.Diagnostic[] {
  const host = ts.createCompilerHost({}, true);
  const origRead = host.readFile.bind(host);
  const origExists = host.fileExists.bind(host);
  host.readFile = (f) => overrides[f] ?? origRead(f);
  host.fileExists = (f) => (overrides[f] !== undefined ? true : origExists(f));

  const program = ts.createProgram({
    rootNames: [PROBE_FILE],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noUncheckedIndexedAccess: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
      baseUrl: REPO_ROOT,
      paths: { "@platform/contracts": [CONTRACT_ENTRY] },
    },
    host,
  });
  const sf = program.getSourceFile(PROBE_FILE);
  expect(sf, "探针文件没进 program —— harness 坏了，不是代码干净").toBeTruthy();
  return program.getSemanticDiagnostics(sf);
}

const text = (d: ts.Diagnostic) => ts.flattenDiagnosticMessageText(d.messageText, " ");
/** TS2353 = 「对象字面量只能指定已知属性」——键不在联合里时报的就是它。 */
const strayKeyErrors = (ds: readonly ts.Diagnostic[]) => ds.filter((d) => d.code === 2353);

describe("§0 · harness 自证（本门咬得到东西，不是在空视野里报绿）", () => {
  it("真实语义表 / 契约 / 契约入口三个文件都在，且探针节点取自契约", () => {
    expect(existsSync(SEMANTICS_FILE)).toBe(true);
    expect(existsSync(CONTRACT_ENTRY)).toBe(true);
    expect(CONTRACT_SRC).toContain("CHAIN_NODE_REGISTRY");
    // 探针 id 必须真的出现在语义表里，否则 §3 的「改册」变异会打空
    expect(SEMANTICS_SRC, `契约首个 nodeId (${PROBE_NODE_ID}) 不在语义表里 ⇒ §3 咬不到东西`).toContain(
      `"${PROBE_NODE_ID}"`,
    );
  });
});

describe("§1 · 反面锚：原样编译零 TS2353（报错不是 harness 自己制造的）", () => {
  it("未变异的真实语义表，本文件零「未知属性」诊断", () => {
    const ds = strayKeyErrors(diagnose({ [PROBE_FILE]: SEMANTICS_SRC }));
    expect(ds.map(text), "原样就报错 ⇒ 后面三组的红全部不可信").toEqual([]);
  });
});

describe("§2 · 键写歪 ⇒ 编译期当场红（C 的立论对本文件不成立的直接证据）", () => {
  it("把一个在册键改成不在册的 id，tsc 报 TS2353 并点名到它", () => {
    const stray = "demand.not_in_registry_probe";
    const mutated = SEMANTICS_SRC.replace(`"${PROBE_NODE_ID}": {`, `"${stray}": {`);
    expect(mutated, "变异没应用上 ⇒ 本例恒真").not.toBe(SEMANTICS_SRC);

    const ds = strayKeyErrors(diagnose({ [PROBE_FILE]: mutated }));
    expect(ds.length, "键写歪了却编译通过 ⇒ 类型绑定已失效，chain-node-singlesource 的 C 豁免必须立刻撤回").toBeGreaterThan(0);
    expect(text(ds[0]!)).toContain(stray);
    expect(text(ds[0]!)).toContain("does not exist in type");
  });
});

describe("§3 · **改册即红** —— 直接证伪「改册时这里不会跟着变」", () => {
  it("契约里改掉一个在册 nodeId，语义表当场编译失败（点名旧 id）", () => {
    const renamed = `${PROBE_NODE_ID}_renamed_by_gate_probe`;
    const mutatedContract = CONTRACT_SRC.replace(`nodeId: "${PROBE_NODE_ID}"`, `nodeId: "${renamed}"`);
    expect(mutatedContract, "契约变异没应用上 ⇒ 本例恒真").not.toBe(CONTRACT_SRC);

    const ds = strayKeyErrors(
      diagnose({ [PROBE_FILE]: SEMANTICS_SRC, [CONTRACT_FILE]: mutatedContract }),
    );
    expect(
      ds.length,
      "改了注册表，语义表却照样编译通过 ⇒ 键根本没绑在契约上，C 豁免的前提不存在",
    ).toBeGreaterThan(0);
    expect(text(ds[0]!), "报错没点名到被改掉的那个 id").toContain(PROBE_NODE_ID);
  });
});

describe("§4 · 反面锚：承重的就是那行类型（放宽后 §2 的红会消失）", () => {
  it("键类型放宽成 Record<string, …> ⇒ 同样的写歪不再报错", () => {
    const stray = "demand.not_in_registry_probe";
    const widened = SEMANTICS_SRC.replace(`"${PROBE_NODE_ID}": {`, `"${stray}": {`).replace(
      "Partial<Record<RegisteredChainNodeId, ChainNodeSemantics>>",
      "Record<string, ChainNodeSemantics>",
    );
    expect(widened.includes("Record<string, ChainNodeSemantics>"), "放宽变异没应用上 ⇒ 本例恒真").toBe(true);

    const ds = strayKeyErrors(diagnose({ [PROBE_FILE]: widened }));
    expect(
      ds,
      "放宽了类型居然还报错 ⇒ §2 的红另有来源，本组对拍证明不了「是那行类型在承重」",
    ).toEqual([]);
  });

  it("声明行仍然是 `Partial<Record<RegisteredChainNodeId, …>>`，且别名派生自契约（豁免前提的静态锚）", () => {
    // 这一条是给**人**看的护栏：上面三组已经证明了机制，这条把「合法写法」钉死成文本，
    // 免得有人改成 `as` 断言（实测 tsc 不咬）后，§2/§3 变绿却没人知道为什么。
    expect(SEMANTICS_SRC).toContain("Partial<Record<RegisteredChainNodeId, ChainNodeSemantics>>");
    expect(SEMANTICS_SRC).toContain('type RegisteredChainNodeId = ChainNodeDef["nodeId"]');
    expect(SEMANTICS_SRC).toContain('from "@platform/contracts"');
    expect(SEMANTICS_SRC, "用 `as` 断言会让编译期检查静默失效").not.toContain(
      "} as Partial<Record<RegisteredChainNodeId",
    );
  });
});
