import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery } from "./helpers.js";

/**
 * 契约加性缺省的钉死判据：不需参切片的摘要行**键集逐字节不变**（ WO-SLICE-REQUIRED-ARGS）。
 * 这就是「既有消费方零影响」的机器证据 —— 多一个键（哪怕值是 []）这里都红。
 */
const SUMMARY_KEYS = ["fixtures", "hops", "linkKeys", "maxNodes", "rootType", "sliceKey", "version"];

/** GET /a/v1/ontology/slices：切片清单（管理面列表源；本次新增端点）。 */
describe("本体切片清单端点", () => {
  it("PUT 注册切片 → GET 列出（rootType/hops/fixtures）+ tenant 隔离", async () => {
    const t = await makeApp();
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/ontology/slices/test_slice",
      headers: ADMIN,
      payload: {
        version: 1,
        spec: {
          root: { typeKey: "Base", selector: {} },
          paths: [[{ linkKey: "HAS_ORDER", direction: "out" }]],
          maxNodes: 50,
        },
      },
    });
    const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/slices", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const list = res.json() as { sliceKey: string; rootType: string; hops: number }[];
    const mine = list.find((s) => s.sliceKey === "test_slice");
    expect(mine).toBeDefined();
    expect(mine!.rootType).toBe("Base");
    expect(mine!.hops).toBe(1);

    // 跨租户隔离：别租户看不到
    const other = await t.app.inject({ method: "GET", url: "/a/v1/ontology/slices", headers: { "x-debug-user": "other:u1:admin" } });
    expect((other.json() as unknown[]).some((s) => (s as { sliceKey: string }).sliceKey === "test_slice")).toBe(false);
  });

  /**
   * WO-SLICE-REQUIRED-ARGS · 摘要投影加性带出 requiredArgs（G-SLICE-ROOT-ARGS-UNDISCOVERABLE）。
   * 抽取口径 = sliceRequiredArgs（与缺参诊断同一函数）：root.selector 的 byKey/filter 值里
   * 整串锚定的 {{args.X}}（空白容忍、去重、字典序）。不需参 ⇒ 键整个缺省（逐字节不变）。
   */
  it("requiredArgs 抽取：byKey/filter 占位符 → 去重字典序；不需参 ⇒ 键缺省（键集钉死）", async () => {
    const t = await makeApp();
    const put = (key: string, selector: unknown) =>
      t.app.inject({
        method: "PUT",
        url: `/a/v1/ontology/slices/${key}`,
        headers: ADMIN,
        payload: { version: 1, spec: { root: { typeKey: "Base", selector }, paths: [], maxNodes: 50 } },
      });
    // byKey + filter 双处占位（含空白变体、跨处重复）→ 去重字典序
    await put("args_slice", { byKey: "{{args.so}}", filter: { region: "{{ args.region }}", so2: "{{args.so}}" } });
    // 非占位值（拼接串不是整串占位，resolveTemplate 不解 ⇒ 不算需参）
    await put("concat_slice", { filter: { k: "SO-{{args.x}}" } });
    await put("plain_slice", { filter: { k: "v" } });

    const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/slices", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Record<string, unknown>[];
    const byKey = (k: string) => list.find((s) => s.sliceKey === k)!;

    expect(byKey("args_slice").requiredArgs).toEqual(["region", "so"]);
    // 拼接串 resolveTemplate 不解（整串锚定）⇒ 不算需参，与执行期行为严格一致
    expect("requiredArgs" in byKey("concat_slice")).toBe(false);
    expect("requiredArgs" in byKey("plain_slice")).toBe(false);
    // 契约加性缺省钉死：不需参行的键集与本端点历史形状逐字节一致
    expect(Object.keys(byKey("plain_slice")).sort()).toEqual(SUMMARY_KEYS);
    expect(Object.keys(byKey("concat_slice")).sort()).toEqual(SUMMARY_KEYS);
  });

  /**
   * WO-SLICE-REQUIRED-ARGS · 种子金丝雀（现算 2026-08-19 · demo · seed 42）：
   * battery 种子 98 条切片里 root selector 声明占位符的**恰好 4 条**
   * （order_fulfillment_360 / order_to_cash_720 / enterprise_360 = {so}，aop_scenario_chain = {key}），
   * 其余 94 条（含全部 coverage_*）零占位 ⇒ 零误标。
   * 这两个数（4 / 0）是种子现算出来的，种子变了本测试红 —— 不许静默漂移。
   */
  it("种子金丝雀：98 条切片恰 4 条带 requiredArgs（键+参数名逐条钉死），其余零误标", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/slices", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const list = res.json() as { sliceKey: string; requiredArgs?: string[] }[];

    const withArgs = list.filter((s) => s.requiredArgs !== undefined);
    expect(withArgs.map((s) => [s.sliceKey, s.requiredArgs])).toEqual([
      ["aop_scenario_chain", ["key"]],
      ["enterprise_360", ["so"]],
      ["order_fulfillment_360", ["so"]],
      ["order_to_cash_720", ["so"]],
    ]);
    // 零误标：其余每一行都不许带 requiredArgs 键（含全部 coverage_*）
    const without = list.filter((s) => s.requiredArgs === undefined);
    expect(without.length).toBe(list.length - 4);
    expect(list.length).toBe(98); // 金丝雀同批：总条数变了也红（防「少种一条」被零误标断言吞掉）
  });
});
