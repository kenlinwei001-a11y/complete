import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * WO-RELATION-EDIT-GAPS · 接缝门：**本体关系的「改 / 建 / 停 / 启」四条写路**。
 *
 * ── 这道门守的是哪条接缝 ────────────────────────────────────────────────────
 * 断言全部走**真路由**（`app.inject`），不是直接调校验函数 —— 本仓刚有过一个真实教训：
 * 同族既有测试全喂 mock、只咬「参数传下去了吗」，咬不到「算得对不对」，bug 就活在那道缝里。
 * 这里咬的是「**发一个 HTTP 请求，回来的状态码与随后回读的值**」，闸门若被摘掉当场红。
 *
 * ── 四条各自的「今天的行为是 X，应该是 Y」（2026-09-04 真后端 4411 口实测）──────
 * ① **改**：前端零入口（金丝雀：`deprecateLink.mutate`/`retireLink.mutate` 各 1 命中，
 *    `updateLinkType|patchLinkType|editLink` 0 命中）。后端一直是按 key 的 upsert。
 *    ⇒ Y：改基数 / 改实现属性 → 回读即新值、`version` 递增。
 * ② **同 key 反向**：派单线索说「可并存、传导重复计数」—— **实测推翻**，本路由是 upsert，
 *    同 key 恒 1 行（`zz_rev_probe` v1 `Order→Model` → v2 `Model→Order`，同一个 id）。
 *    真实缺陷是**静默掉头**：因果边靠 `viaLinkKey` 按方向挂在结构边上，方向校验只在因果边
 *    写入那一刻跑一次；结构边事后掉头后那些边永远贡献 0，不报错、不变红。
 *    ⇒ Y：端点是身份格，同 key 改端点 400；**换 key 的反向边仍 201**（金丝雀）。
 * ③ **key 脏字符**：`"a b"` / `"中文键"` / `"x!!"` 修前全部 201。
 *    ⇒ Y：字母开头 + `[A-Za-z0-9_]` + ≤64，越界 400 说中文。
 *    ⚠ **自环不禁**：存量实测有 1 条**合法**自环 `CausalFactor --caused_by--> CausalFactor`
 *      （`synthetic/battery.ts` 的因果链一等节点）。一刀切会误伤存量 ⇒ 先量后卡，只卡 key。
 * ④ **停用不可逆**：`/reactivate` 与 `/activate` 修前都是 404 route not found。
 *    ⇒ Y：DEPRECATED 可拨回 ACTIVE；RETIRED 仍 409（下线的前置是零引用，拨回会让两套引用并存）。
 *
 * ── 存量统计（先量后卡，闸门是照着这四个数定的，不是拍脑袋）─────────────────
 * 出厂 116 条结构边：脏 key **0** 条 · 同 key 多行 **0** 条 · 同 key 反向对 **0** 条 ·
 * 端点级反向对 **36** 条（`Supplier→Material` ⇄ `Material→Supplier` 一类，各有独立 key，业务真需要）·
 * 自环 **1** 条。`^[a-z][a-z0-9_]*$`（只收小写）会误伤 **9** 条大驼峰后缀边 ⇒ 没采用那一版。
 */

const createLink = (t: Awaited<ReturnType<typeof makeApp>>, payload: Record<string, unknown>) =>
  t.app.inject({ method: "POST", url: "/a/v1/ontology/link-types", headers: ADMIN, payload });

const post = (t: Awaited<ReturnType<typeof makeApp>>, url: string) =>
  t.app.inject({ method: "POST", url, headers: ADMIN, payload: {} });

/** 从**真下发口**回读一条边（不是从仓储偷看）—— 前端看到的就是这个投影。 */
async function readLink(
  t: Awaited<ReturnType<typeof makeApp>>,
  key: string,
): Promise<{ key: string; fromType: string; toType: string; cardinality: string; viaProperty?: string; viaSide?: string } | undefined> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/mapping/registries", headers: ADMIN });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body) as { linkTypes: { key: string; fromType: string; toType: string; cardinality: string; viaProperty?: string; viaSide?: string }[] };
  return body.linkTypes.find((l) => l.key === key);
}

describe("WO-RELATION-EDIT-GAPS · 接缝：关系的改/建/停/启四条写路", () => {
  it("③ key 字符集：脏 key 四条全 400 且各自说中文；合法 key 与存量大驼峰后缀 key 仍 201（金丝雀）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 金丝雀先跑：证明这条路本来是通的。它若不是 201，下面四个 400 一律不许当结论
    // ——「我的请求发错了」与「闸门拦住了」在状态码上一模一样。
    const canary = await createLink(t, { key: "zz_ok_probe", fromTypeKey: "Order", toTypeKey: "Model", cardinality: "N:1" });
    expect(canary.statusCode).toBe(201);

    for (const bad of ["a b", "中文键", "x!!", "1ab", "a-b", "a.b"]) {
      const r = await createLink(t, { key: bad, fromTypeKey: "Order", toTypeKey: "Model", cardinality: "N:1" });
      expect(r.statusCode, `脏 key '${bad}' 必须被拒`).toBe(400);
      const msg = (JSON.parse(r.body) as { error: { code: string; message: string } }).error;
      expect(msg.code).toBe("VALIDATION_ERROR");
      // 提示必须是可读中文并**点名是哪个值**，不是一串英文 code（派单明令）。
      expect(msg.message).toContain(bad);
      expect(msg.message).toContain("只能用英文字母、数字与下划线");
    }
    // 超长同样拒（上限 64，存量最长 43）。
    const tooLong = await createLink(t, { key: `z${"a".repeat(64)}`, fromTypeKey: "Order", toTypeKey: "Model", cardinality: "N:1" });
    expect(tooLong.statusCode).toBe(400);

    // 金丝雀②：**大写字母必须仍被收下** —— 这条就是「不采用只收小写那一版正则」的机器证据。
    // 摘掉它，某天有人把正则收紧成 `^[a-z][a-z0-9_]*$`，存量里那族大驼峰后缀边
    // （`process_instance_carries_CustomsClearance` 等 **9** 条，2026-09-04 真后端实测）
    // 会静默变成再也改不了，而没有任何测试会红。
    const camel = await createLink(t, { key: "zz_carries_CustomsClearance", fromTypeKey: "Order", toTypeKey: "Model", cardinality: "1:N" });
    expect(camel.statusCode, "大驼峰后缀 key 是存量形态，必须收").toBe(201);
    // ⚠ 那 9 条大驼峰后缀边由**流程域种子**建出，`seedBattery` 这个测试夹具里没有它们
    //   （本夹具的边全是小写）—— 所以这里不去断言「存量里有大写 key」，那会变成一句
    //   **在这个夹具上永远为假**的断言。上面那条合成 key 的 201 才是真正守着正则的那一句；
    //   9 这个数的出处是 2026-09-04 真后端 `SEED_DEMO=1` 的 116 条边，写在本文件头注里。
    //   （拿夹具的读数去证明生产存量的形态，正是「我用 X 当作 Y 的证据而 X 不度量 Y」。）
  });

  it("② 同 key 不许掉包端点（含掉头）；换 key 的反向边仍 201（金丝雀，存量 36 对反向不许误伤）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const a = await createLink(t, { key: "zz_rev_probe", fromTypeKey: "Order", toTypeKey: "Model", cardinality: "N:1" });
    expect(a.statusCode).toBe(201);

    // 同 key 掉头 ⇒ 400，且报文必须同时给出「它原本连的是什么」与「怎么办」，
    // 只说「不允许」的话调用方唯一能做的就是猜。
    const flipped = await createLink(t, { key: "zz_rev_probe", fromTypeKey: "Model", toTypeKey: "Order", cardinality: "1:N" });
    expect(flipped.statusCode).toBe(400);
    const err = (JSON.parse(flipped.body) as { error: { message: string } }).error.message;
    expect(err).toContain("Order → Model"); // 既有端点被点名
    expect(err).toContain("掉了个头");

    // 掉包**非反向**的端点同样拒（不是只挡反向这一种形态）。
    const swapped = await createLink(t, { key: "zz_rev_probe", fromTypeKey: "Order", toTypeKey: "Base", cardinality: "N:1" });
    expect(swapped.statusCode).toBe(400);

    // 表里必须仍是原来那条，一个字节没被改（"先拒绝再落库" 与 "先落库再报错" 的差别）。
    expect(await readLink(t, "zz_rev_probe")).toMatchObject({ fromType: "Order", toType: "Model" });

    // 金丝雀：**换个 key** 的反向边必须仍然 201 —— 本闸不是一刀切禁双向。
    const rev = await createLink(t, { key: "zz_rev_probe_back", fromTypeKey: "Model", toTypeKey: "Order", cardinality: "1:N" });
    expect(rev.statusCode).toBe(201);

    // 金丝雀②：自环仍收 —— 存量 `CausalFactor --caused_by--> CausalFactor` 是合法的一等因果链。
    const loop = await createLink(t, { key: "zz_selfloop", fromTypeKey: "Order", toTypeKey: "Order", cardinality: "N:N" });
    expect(loop.statusCode).toBe(201);
  });

  it("① 改：基数与实现属性可改，回读即新值、version 递增；实现属性随边下发（前端预填靠它）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const created = await createLink(t, { key: "zz_edit_probe", fromTypeKey: "Order", toTypeKey: "Model", cardinality: "N:1" });
    expect(created.statusCode).toBe(201);
    expect((JSON.parse(created.body) as { version: number }).version).toBe(1);
    expect(await readLink(t, "zz_edit_probe")).toMatchObject({ cardinality: "N:1" });
    // 未声明实现属性 ⇒ 字段**缺席**（不是空串）——前端据此把「由哪个属性实现」这一格留空。
    expect(await readLink(t, "zz_edit_probe")).not.toHaveProperty("viaProperty");

    // ── 对照实验（铁律 1.5）：把基数 N:1 改成 N:N，回读必须变，且版本必须 +1 ────────
    const edited = await createLink(t, { key: "zz_edit_probe", fromTypeKey: "Order", toTypeKey: "Model", cardinality: "N:N" });
    expect(edited.statusCode).toBeLessThan(300);
    expect((JSON.parse(edited.body) as { version: number }).version).toBe(2);
    expect(await readLink(t, "zz_edit_probe")).toMatchObject({ cardinality: "N:N" });

    // ── 对照实验②：补上「由哪个属性实现」，实例边数必须从 0 变成非 0 ────────────────
    // 这一条咬的是「改」真的改到了引擎能看见的地方，不只是改了一行登记。
    const withVia = await createLink(t, {
      key: "zz_edit_probe",
      fromTypeKey: "Order",
      toTypeKey: "Model",
      cardinality: "N:1",
      viaProperty: "model",
      viaSide: "from",
    });
    expect(withVia.statusCode).toBeLessThan(300);
    const m = (JSON.parse(withVia.body) as { version: number; materialized: { created: number } });
    expect(m.version).toBe(3);
    expect(m.created ?? m.materialized.created).toBeGreaterThan(0);
    // 下发口必须回读到实现属性 —— 缺了它，前端「改」表单预填不出来，
    // 下一次保存就会把它抹掉（改一个字段却把另一个字段清零，本仓最不许发生的静默失效）。
    expect(await readLink(t, "zz_edit_probe")).toMatchObject({ viaProperty: "model", viaSide: "from" });
  });

  it("④ 停用 ⇄ 启用可逆（四个读数）；已下线不许拨回，且本就启用的再启用也 409", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect((await createLink(t, { key: "zz_life_probe", fromTypeKey: "Order", toTypeKey: "Model", cardinality: "N:1" })).statusCode).toBe(201);

    // 读数 1：新建即启用（没有弃用记录）。
    const dep1 = await post(t, "/a/v1/ontology/links/zz_life_probe/deprecate");
    expect(dep1.statusCode).toBe(200);
    // 读数 2：停用后 DEPRECATED。
    expect((JSON.parse(dep1.body) as { deprecation: { status: string } }).deprecation.status).toBe("DEPRECATED");

    // 读数 3：拨回 ACTIVE —— 修前这一步是 404 route not found（死胡同）。
    const re = await post(t, "/a/v1/ontology/links/zz_life_probe/reactivate");
    expect(re.statusCode).toBe(200);
    expect((JSON.parse(re.body) as { deprecation: { status: string } }).deprecation.status).toBe("ACTIVE");

    // 读数 4：回到启用态之后再拨一次 ⇒ 409（不是静默成功）。
    // 「本来就是启用」与「拨回成功」必须是两个不同的回答，否则屏上分不出这次点击有没有生效。
    const again = await post(t, "/a/v1/ontology/links/zz_life_probe/reactivate");
    expect(again.statusCode).toBe(409);

    // 停用可以拨回，**下线不行** —— 这是有意的不对称，理由写在 `reactivate()` 头注。
    await post(t, "/a/v1/ontology/links/zz_life_probe/deprecate");
    expect((await post(t, "/a/v1/ontology/links/zz_life_probe/retire")).statusCode).toBe(200);
    const afterRetire = await post(t, "/a/v1/ontology/links/zz_life_probe/reactivate");
    expect(afterRetire.statusCode).toBe(409);
    expect((JSON.parse(afterRetire.body) as { error: { message: string } }).error.message).toContain("已下线");

    // 对象类型走的是同一段代码（只是 kind 不同），一并咬住 —— 只测 link 侧会让 type 侧悄悄退化。
    const typeKey = "Order";
    expect((await post(t, `/a/v1/ontology/types/${typeKey}/deprecate`)).statusCode).toBe(200);
    const reType = await post(t, `/a/v1/ontology/types/${typeKey}/reactivate`);
    expect(reType.statusCode).toBe(200);
    expect((JSON.parse(reType.body) as { deprecation: { status: string } }).deprecation.status).toBe("ACTIVE");
  });
});
