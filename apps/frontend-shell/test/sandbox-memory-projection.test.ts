/**
 * WO-SANDBOX-MEMORY · `sim-sessions` 流式投影的判据。
 *
 * 本门咬的是**这一跳的真实形状**，不是"函数跑通了"：
 *  · 剥掉 `baseSnapshot` 之后剩下的字段必须**逐字段等于**原样（少一个就是把别人的读数弄丢了）；
 *  · `keepFor` 指名的那一条必须**逐格等于**原快照（差一格，下区差分就静默算错）；
 *  · 金丝雀：拿一份**确定含** `baseSnapshot` 的样例跑，`stripped` 必须 > 0 ——
 *    它为 0 时只能报「扫描器坏了」，不许报「回包里没有这个字段」。
 */
import { describe, expect, it } from "vitest";
import {
  projectSessionsText,
  readSessionsProjected,
  STRIPPED_KEY,
} from "@/api/simSessionsProjection";

type Sess = {
  id: string;
  tenantId: string;
  baseSnapshot: Record<string, Record<string, number>>;
  scope: Record<string, unknown>;
  status: string;
  curTick: number;
  parentCheckpointId: string | null;
  disabledRuleKeys: string[];
  createdAt: string;
};

function mkSession(id: string, cells: number): Sess {
  const snap: Record<string, Record<string, number>> = {};
  for (let i = 0; i < cells; i++) snap[`obj_${id}_${i}`] = { loadIndex: i, demandLoad: i * 2 };
  return {
    id,
    tenantId: "demo",
    baseSnapshot: snap,
    // 引号 / 反斜杠 / 花括号全塞进字符串里：扫描器若不认转义，栈会当场数错
    scope: { kind: "GLOBAL", target: null, label: 'a"b\\c{}[],:' },
    status: "READY",
    curTick: 3,
    parentCheckpointId: null,
    disabledRuleKeys: ["r1", "r2"],
    createdAt: `2026-08-2${id.length}T00:00:00.000Z`,
  };
}

describe("WO-SANDBOX-MEMORY · sim-sessions 流式投影", () => {
  it("① 剥掉 baseSnapshot，其余字段逐字段原样（金丝雀：stripped 必须 > 0）", () => {
    const items = [mkSession("a", 3), mkSession("b", 5), mkSession("c", 1)];
    const text = JSON.stringify({ items });
    const r = projectSessionsText<Sess>(text);

    // 金丝雀先说话：样例**确定含** baseSnapshot，剥不到就是扫描器坏了
    expect(r.stats.itemsSeen, "扫到 0 个 item ⇒ 扫描器坏了，不许报「列表是空的」").toBe(3);
    expect(r.stats.stripped, "金丝雀不中 ⇒ 扫描器坏了，不许报「回包里没有 baseSnapshot」").toBe(3);
    expect(r.stats.strippedBytes).toBeGreaterThan(0);

    expect(r.items).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const rest: Record<string, unknown> = { ...items[i]! };
      delete rest.baseSnapshot;
      expect(r.items[i]).toEqual(rest);
      expect(Object.prototype.hasOwnProperty.call(r.items[i], STRIPPED_KEY)).toBe(false);
    }
    expect(r.kept).toBeNull();
  });

  it("② keepFor 指名的那一条逐格等于原快照；别的条一格都不留", () => {
    const items = [mkSession("a", 3), mkSession("b", 5), mkSession("c", 1)];
    const r = projectSessionsText<Sess>(JSON.stringify({ items }), "b");
    expect(r.kept).toEqual(items[1]!.baseSnapshot);
    // 列表里仍然一条 baseSnapshot 都没有（keepFor 只回给指名的那一处，不塞回列表）
    for (const it of r.items) expect(Object.prototype.hasOwnProperty.call(it, STRIPPED_KEY)).toBe(false);
  });

  it("③ keepFor 指名一个不存在的 id ⇒ kept 为 null（**不造一个空世界出来**）", () => {
    const r = projectSessionsText<Sess>(JSON.stringify({ items: [mkSession("a", 2)] }), "nope");
    expect(r.kept).toBeNull();
  });

  it("④ baseSnapshot 排在**最后一个成员**时不留下悬空逗号（这是最容易写坏的一处）", () => {
    const text = '{"items":[{"id":"x","curTick":1,"baseSnapshot":{"o":{"v":1}}},{"id":"y","baseSnapshot":{},"curTick":2}]}';
    const r = projectSessionsText<{ id: string; curTick: number }>(text);
    expect(r.items).toEqual([{ id: "x", curTick: 1 }, { id: "y", curTick: 2 }]);
    expect(r.stats.stripped).toBe(2);
  });

  it("⑤ 只剥会话那一层；**嵌套更深处**的同名键不动（免得误伤别人的字段）", () => {
    const text = '{"items":[{"id":"x","scope":{"baseSnapshot":{"deep":1}},"baseSnapshot":{"o":{"v":1}}}]}';
    const r = projectSessionsText<{ id: string; scope: { baseSnapshot: { deep: number } } }>(text);
    expect(r.stats.stripped).toBe(1);
    expect(r.items[0]!.scope.baseSnapshot).toEqual({ deep: 1 });
  });

  it("⑥ 后端将来自己投影了（回包不含该字段）⇒ 本模块是纯拷贝，行为逐字节不变", () => {
    const text = '{"items":[{"id":"x","curTick":0},{"id":"y","curTick":1}]}';
    const r = projectSessionsText<{ id: string; curTick: number }>(text);
    expect(r.stats.stripped).toBe(0);
    expect(r.stats.itemsSeen, "itemsSeen 才是「扫描器活着」的证据；stripped=0 单独不构成任何结论").toBe(2);
    expect(r.items).toEqual([{ id: "x", curTick: 0 }, { id: "y", curTick: 1 }]);
  });

  it("⑦ 分块喂（模拟真实流）与整串喂，结果逐字节一致 —— 边界切在键中间也不许错", async () => {
    const items = [mkSession("a", 4), mkSession("bb", 6)];
    const text = JSON.stringify({ items });
    const whole = projectSessionsText<Sess>(text, "bb");
    for (const size of [1, 3, 7, 64, 997]) {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          const enc = new TextEncoder().encode(text);
          for (let i = 0; i < enc.length; i += size) c.enqueue(enc.slice(i, i + size));
          c.close();
        },
      });
      const r = await readSessionsProjected<Sess>(new Response(stream), "bb");
      expect(r.items, `chunk=${size}`).toEqual(whole.items);
      expect(r.kept, `chunk=${size}`).toEqual(whole.kept);
      expect(r.stats.stripped, `chunk=${size}`).toBe(2);
    }
  });

  it("⑧ 无 body 的 Response（jsdom/MSW 老实现）回落到 text()，走的是**同一支**扫描器", async () => {
    const items = [mkSession("a", 2)];
    const fake = { body: null, text: async () => JSON.stringify({ items }) } as unknown as Response;
    const r = await readSessionsProjected<Sess>(fake, "a");
    expect(r.stats.stripped).toBe(1);
    expect(r.kept).toEqual(items[0]!.baseSnapshot);
  });

  it("⑨ 省下来的量级是真的：11,348 对象 × 36 变量那一条，剥后 < 1‰", () => {
    // 与生产同量级（缩到 1/8 跑得动即可，比例才是判据）
    const snap: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 1400; i++) {
      const row: Record<string, number> = {};
      for (let v = 0; v < 36; v++) row[`stateVar${v}`] = v;
      snap[`obj_type_${i}`] = row;
    }
    const items = Array.from({ length: 5 }, (_, i) => ({ ...mkSession(`s${i}`, 0), baseSnapshot: snap }));
    const text = JSON.stringify({ items });
    const r = projectSessionsText<Sess>(text);
    const after = JSON.stringify({ items: r.items }).length;
    expect(r.stats.stripped).toBe(5);
    expect(after / text.length).toBeLessThan(0.001);
  });
});
