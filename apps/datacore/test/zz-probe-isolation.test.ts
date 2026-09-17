// WO-SNAPSHOT-RESTORE 验收④（派单验收条）：还原后各文件状态独立 ——
// app A 里的改动对 app B / 后续还原不可见。机制 = 模块级只缓存 Buffer，每次还原重新
// v8.deserialize（全新对象图）+ putMany 再 structuredClone（world-snapshot.ts 头注「防污染」节）。
// 本探针证机制真的生效，不是信注释（铁律 1.5 判据四）。测完即删 —— 证据落账本 §10.6。
import { expect, test } from "vitest";
import { createBareTestApp, ensureWorldSnapshot, restoreWorldFromSnapshot } from "./world-snapshot.js";

test("isolation: mutations in app A after restore are invisible in app B and later restores", async () => {
  const { buf } = await ensureWorldSnapshot("base", 42);
  const a = await createBareTestApp();
  const b = await createBareTestApp();
  await restoreWorldFromSnapshot(a.repos, buf);
  await restoreWorldFromSnapshot(b.repos, buf);

  // ① A 改写一个世界对象的 props（任意取一条 —— 金丝雀：世界非空，否则本探针什么都没验）
  const anyObj = (await a.repos.objects.list("demo", () => true))[0];
  expect(anyObj, "还原后世界为空 ⇒ 探针失效").toBeDefined();
  const marker = `mutation-probe-${Date.now()}`;
  await a.repos.objects.put({ ...anyObj!, props: { ...anyObj!.props, probeMarker: marker } });
  const inA = await a.repos.objects.get("demo", anyObj!.id);
  expect((inA!.props as Record<string, unknown>).probeMarker, "金丝雀：A 自己的写入必须可见").toBe(marker);

  // ② B 读同一对象 id —— 必须还是快照原值（A 的写入不可见）
  const inB = await b.repos.objects.get("demo", anyObj!.id);
  expect(inB).toBeDefined();
  expect((inB!.props as Record<string, unknown>).probeMarker).toBeUndefined();

  // ③ A 删一个对象 —— B 里必须还在
  await a.repos.objects.remove("demo", anyObj!.id);
  expect(await a.repos.objects.get("demo", anyObj!.id)).toBeUndefined();
  expect(await b.repos.objects.get("demo", anyObj!.id)).toBeDefined();

  // ④ 同一 buf 再还原到 C —— 全新对象图，A 的删/改都不存在
  const c = await createBareTestApp();
  await restoreWorldFromSnapshot(c.repos, buf);
  const inC = await c.repos.objects.get("demo", anyObj!.id);
  expect(inC, "A 删过的对象在 C 必须复活（还原不共享 A 的对象图）").toBeDefined();
  expect((inC!.props as Record<string, unknown>).probeMarker).toBeUndefined();

  console.log(`ISOLATION ok: A-mutation invisible in B and C (obj=${anyObj!.id})`);
  await a.app.close();
  await b.app.close();
  await c.app.close();
}, 300_000);
