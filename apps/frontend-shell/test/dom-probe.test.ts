import { describe, expect, it } from "vitest";
// 探针是纯 .mjs（无类型声明），vitest 只运行不 typecheck —— 本文件验的是运行时行为。
// eslint-disable-next-line import/no-extraneous-dependencies
import {
  snapshotDom,
  diffDomSnapshots,
  probeDomChange,
} from "../../../scripts/lib/layout-probe.mjs";

/**
 * WO-GATE-B-BROWSER-HARNESS · B-1 探针（两时刻 DOM 快照比对）的**纯逻辑门**。
 *
 * ══ 本文件与浏览器金丝雀的分工（刻意不重复）═══════════════════════════════════
 *  · **浏览器金丝雀**（`scripts/check-layout-legibility.mjs` 的 CANARY_REACT/CANARY_DEAD）
 *    证明「真 Chromium 里、真事件下，探针报得对」—— 它走 `page.evaluate` 序列化通道。
 *  · **本文件**在 jsdom 里咬探针的**纯逻辑**：快照口径（哪些变化看得见）、多重集合
 *    比对语义（重复行按次数、同集换序不算变）、轮询驱动的四个终态
 *    （变了 / 没变 / 根未命中 / 动作失败）。这些不需要浏览器，进 vitest 才能每次提交都跑。
 *  两侧**共用同一份实现**（本文件 import 的就是金丝雀用的那几个函数本尊），不另抄。
 *
 * ══ 为什么 probeDomChange 能进 jsdom 测 ════════════════════════════════════════
 * 它对 `page` 的依赖只有两招：`evaluate(fn, opts)` 与 `waitForTimeout(ms)`。
 * 假 page 把 `evaluate` 直接落成「在 jsdom 的 document 上调 fn」—— 与真浏览器里
 * 跑的是**同一个函数对象**，只是省掉了序列化通道（那一层由浏览器金丝雀守）。
 */

type FakePage = {
  evaluate: (fn: (opts: unknown) => unknown, opts: unknown) => Promise<unknown>;
  waitForTimeout: (ms: number) => Promise<void>;
};

/** 假 page：evaluate 在 jsdom document 上直接执行探针函数（与金丝雀同一函数本尊）。 */
function fakePage(): FakePage {
  return {
    evaluate: async (fn, opts) => fn(opts),
    waitForTimeout: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

const snap = (rootSelector?: string) =>
  snapshotDom({ rootSelector }) as { ok: boolean; count: number; lines: string[] };

describe("diffDomSnapshots · 多重集合比对语义", () => {
  const S = (lines: string[]) => ({ ok: true, count: lines.length, lines });

  it("完全一致 ⇒ 没变", () => {
    const d = diffDomSnapshots(S(["a", "b"]), S(["a", "b"]));
    expect(d.changed).toBe(false);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("一行内容变了 ⇒ 报变，且 added/removed 各指得出那一行（不许空喊「变了」）", () => {
    const d = diffDomSnapshots(S(["1|p|结果：旧"]), S(["1|p|结果：新"]));
    expect(d.changed).toBe(true);
    expect(d.added).toEqual(["1|p|结果：新"]);
    expect(d.removed).toEqual(["1|p|结果：旧"]);
  });

  it("重复行按**次数**比：2 份变 1 份 ⇒ 报变（removed 恰好 1 条，不是 2 条也不是 0 条）", () => {
    const d = diffDomSnapshots(S(["x", "x", "y"]), S(["x", "y"]));
    expect(d.changed).toBe(true);
    expect(d.removed).toEqual(["x"]);
    expect(d.added).toEqual([]);
  });

  it("同一批行只换了顺序 ⇒ 判「没变」（成文口径： identical 内容换序用户看不见）", () => {
    const d = diffDomSnapshots(S(["a", "b", "c"]), S(["c", "a", "b"]));
    expect(d.changed).toBe(false);
  });

  it("任一侧快照不可用 ⇒ degraded=true 且 changed=true（比不了不许读作「没变」）", () => {
    const d = diffDomSnapshots({ ok: false, reason: "根未命中" } as never, S(["a"]));
    expect(d.degraded).toBe(true);
    expect(d.changed).toBe(true);
  });
});

describe("snapshotDom · 快照口径（jsdom）", () => {
  it("看得见：直接文本、data-testid、复选框 checked 翻转", () => {
    document.body.innerHTML =
      `<div id="out"><p>结果：（空）</p></div>` +
      `<label><input id="cb" type="checkbox"><span>常州</span></label>`;
    const before = snap("body");
    expect(before.ok).toBe(true);
    expect(before.lines.some((l) => l.includes("#cb") && l.includes("checked=false"))).toBe(true);
    (document.getElementById("cb") as HTMLInputElement).checked = true;
    const d = diffDomSnapshots(before, snap("body") as never);
    expect(d.changed).toBe(true);
    // 「勾上复选框」必须落成 added/removed 里指得出的行，不是一个裸布尔
    expect(d.added.some((l: string) => l.includes("#cb") && l.includes("checked=true"))).toBe(true);
    expect(d.removed.some((l: string) => l.includes("#cb") && l.includes("checked=false"))).toBe(true);
  });

  it("根未命中 ⇒ ok:false 带原因（不许静默产出空快照冒充「没内容」）", () => {
    document.body.innerHTML = `<div id="out">x</div>`;
    const s = snapshotDom({ rootSelector: "#nope" }) as { ok: boolean; reason?: string };
    expect(s.ok).toBe(false);
    expect(s.reason).toContain("#nope");
  });
});

describe("probeDomChange · 轮询驱动四终态", () => {
  it("① 改输入后结果 DOM 变了 ⇒ changed=true 且 elapsedMs < timeoutMs，diff 指得出新文本", async () => {
    document.body.innerHTML = `<input id="src"><div id="out"><p>结果：（空）</p></div>`;
    const r = await probeDomChange(fakePage() as never, {
      rootSelector: "#out",
      timeoutMs: 1000,
      pollMs: 20,
      act: async () => {
        (document.getElementById("out") as HTMLElement).innerHTML = "<p>结果：产能</p>";
      },
    });
    expect(r.changed).toBe(true);
    expect(r.elapsedMs).toBeLessThan(1000);
    expect(r.diff.added.join("\n")).toContain("结果：产能");
  });

  it("② 变化**延迟到达**（act 后 120ms 才落 DOM）⇒ 轮询必须等到它，不是只看 act 当拍", async () => {
    document.body.innerHTML = `<input id="src"><div id="out"><p>结果：（空）</p></div>`;
    const r = await probeDomChange(fakePage() as never, {
      rootSelector: "#out",
      timeoutMs: 1500,
      pollMs: 30,
      act: async () => {
        setTimeout(() => {
          (document.getElementById("out") as HTMLElement).textContent = "结果：迟来";
        }, 120);
      },
    });
    expect(r.changed).toBe(true);
    expect(r.elapsedMs).toBeGreaterThanOrEqual(100);
  });

  it("③ 输入是死的（act 什么都不改）⇒ 陪跑到 timeout 报 changed=false，不冤枉页面", async () => {
    document.body.innerHTML = `<input id="src"><div id="out"><p>结果：（恒定）</p></div>`;
    const r = await probeDomChange(fakePage() as never, {
      rootSelector: "#out",
      timeoutMs: 300,
      pollMs: 40,
      act: async () => {},
    });
    expect(r.changed).toBe(false);
    expect(r.elapsedMs).toBeGreaterThanOrEqual(280);
  });

  it("④ 快照根未命中 ⇒ 抛 ProbeBroken（工具坏了），绝不读作「页面没变」", async () => {
    document.body.innerHTML = `<div id="out">x</div>`;
    await expect(
      probeDomChange(fakePage() as never, { rootSelector: "#nope", timeoutMs: 200, act: async () => {} }),
    ).rejects.toMatchObject({ probeBroken: true });
  });

  it("⑤ act 自己抛错（门够不到它要改的输入）⇒ 包成 ProbeBroken，原因里留着原始错误", async () => {
    document.body.innerHTML = `<div id="out">x</div>`;
    await expect(
      probeDomChange(fakePage() as never, {
        rootSelector: "#out",
        timeoutMs: 200,
        act: async () => {
          throw new Error("locator 超时：sc-base-changzhou");
        },
      }),
    ).rejects.toMatchObject({ probeBroken: true, message: expect.stringContaining("sc-base-changzhou") });
  });

  it("⑥ 缺 act ⇒ 立刻 ProbeBroken（门没说清要改哪个输入），不去碰页面", async () => {
    document.body.innerHTML = `<div id="out">x</div>`;
    await expect(
      probeDomChange(fakePage() as never, { rootSelector: "#out", timeoutMs: 200 } as never),
    ).rejects.toMatchObject({ probeBroken: true });
  });
});
