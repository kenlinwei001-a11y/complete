import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LINK_MATERIALIZATION_FIELDS } from "@platform/contracts";
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
    expect(m.materialized.created, "补上实现属性后必须真的连出实例边，不只是改了一行登记").toBeGreaterThan(0);
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

  /**
   * WO-ONTO-WIRE-4 · 接缝：**下线一个类型，读出面必须真的看不见它**。
   *
   * ── 今天的行为是 X，应该是 Y（2026-09-10 真后端 4741 口实测）────────────────
   * **X**：`POST types/:key/retire` → 200 `{status:"RETIRED"}`，只写 `deprecation`；
   *   顶层 `status` 仍是 `ACTIVE`，而 `ontology.ts` 的 `listTypes()` 恰恰按
   *   `t.status === "ACTIVE"` 过滤 ⇒ 已下线的类型**继续出现在类型列表与能力清单里**，
   *   求解器 / 时序 / 数据模版 / 实体目录 / 切片覆盖照常拿到它。
   *   读顶层的说「在用」，读 `deprecation` 的说「已下线」，两个都是系统自己写的。
   * **Y**：`deprecation.status` 是唯一权威，顶层 `status` 是它的派生投影 ⇒ retire 之后
   *   类型从读出面消失；而 **DEPRECATED 仍留在读出面**（宽限期 90 天内还能用）。
   *
   * ── 这道断言为什么必须带对照臂 ──────────────────────────────────────────
   * 只断言「retire 后不在了」，`listTypes` 整个坏掉（返回空）也会绿。
   * 故同一用例里放一条**只 deprecate** 的类型，要求它**仍在**：
   * 「该消失的消失了」与「什么都没了」这两件事，靠这条对照臂才分得开。
   */
  it("⑤ 下线收敛：retire 后类型从读出面消失，而只 deprecate 的仍在（对照臂）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const mk = (key: string) =>
      t.app.inject({
        method: "POST",
        url: "/a/v1/ontology/object-types",
        headers: ADMIN,
        payload: {
          key,
          displayName: "生命周期探针",
          domain: "unassigned",
          properties: [{ propKey: "pid", dataType: "string", isPrimaryKey: true, unit: "dimensionless", scale: "absolute" }],
        },
      });
    const listedKeys = async (): Promise<string[]> => {
      const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { items?: { key: string }[] } | { key: string }[];
      const arr = Array.isArray(body) ? body : (body.items ?? []);
      return arr.map((x) => x.key);
    };

    expect((await mk("ZzLifeCtl")).statusCode).toBe(201);
    expect((await mk("ZzLifeRet")).statusCode).toBe(201);
    // 金丝雀：两条都在。它若不成立，下面任何「不在」都不许当结论。
    const born = await listedKeys();
    expect(born, "金丝雀·新建的两个类型都该在读出面").toEqual(expect.arrayContaining(["ZzLifeCtl", "ZzLifeRet"]));

    expect((await post(t, "/a/v1/ontology/types/ZzLifeCtl/deprecate")).statusCode).toBe(200);
    expect((await post(t, "/a/v1/ontology/types/ZzLifeRet/deprecate")).statusCode).toBe(200);
    // 宽限期语义：DEPRECATED **不**从读出面消失，否则宣告弃用的当天就等于删库。
    expect(await listedKeys(), "DEPRECATED 仍须可见（90 天宽限期）").toEqual(
      expect.arrayContaining(["ZzLifeCtl", "ZzLifeRet"]),
    );

    expect((await post(t, "/a/v1/ontology/types/ZzLifeRet/retire")).statusCode).toBe(200);
    const after = await listedKeys();
    expect(after, "retire 之后必须从读出面消失").not.toContain("ZzLifeRet");
    // 对照臂：同一次读取里它必须还在 —— 这条把「该消失的消失了」与「全都没了」分开。
    expect(after, "对照臂·只 deprecate 的仍须在").toContain("ZzLifeCtl");

    // 能力清单是同一条读出面的下游（`listTypes` → `buildInventory`），一并咬住：
    // 已下线的类型不许继续被当成「本租户具备的能力」对外宣称。
    const inv = await t.app.inject({ method: "GET", url: "/a/v1/capability-inventory", headers: ADMIN });
    expect(inv.statusCode).toBe(200);
    const objectTypes = (JSON.parse(inv.body) as { objectTypes: string[] }).objectTypes;
    expect(objectTypes, "能力清单不许宣称已下线的类型").not.toContain("ZzLifeRet");
    expect(objectTypes, "对照臂·只 deprecate 的仍在能力清单").toContain("ZzLifeCtl");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * WO-MAPPING-WHITELIST · 接缝门：**读—改—写往返不许丢字段**
 *
 * ── 今天的行为是 X（修前实测）──────────────────────────────────────────────
 * `buildMappingRegistries`（`apps/datacore/src/mapping.ts`）的下发白名单**只透传
 * `viaProperty`/`viaSide` 两个**，而建边路由 `POST /a/v1/ontology/link-types` 已收 **9 个**
 * 物化声明字段。差集 **7 个**：`anchorProperty` `viaMultiValue` `viaBridge` `viaWhere`
 * `viaKeyExpr` `viaWhereTo` `viaCross`。
 * 关系编辑器（`OntologyRelationsPage.tsx` 的 `updateLink`）拿 registries 预填、拿 POST 回写，
 * 而 POST 是**整条覆盖**（`upsertLinkType`：`{ id, tenantId, version, ...input }` → `put`）
 * ⇒ 一条带 `viaWhere` 的边，用户**一个字段都不改**、只点一次「保存」，那 7 个里已声明的当场归零：
 * 边退回 0 实例、多跳检索遍历不到、**屏上不报错**。这是静默数据丢失，不是记账问题。
 *
 * ── 应该是 Y ────────────────────────────────────────────────────────────────
 * 读投影把 9 个物化声明字段**一并下发**（加性可选，未声明即缺席）⇒ 客户端原样回填一次，
 * **保存前后的声明逐字节相同**（本门用 sha256 咬，不用眼睛看 —— 眼睛盖不住「字段还在但值被改了」）。
 *
 * ── 这道门为什么用 hash 而不是逐字段 expect ──────────────────────────────────
 * 逐字段 expect 只能咬住**今天写下的那几个字段**；hash 咬的是**整个声明**。
 * 将来写路再加第 10 个字段而读路忘了跟，`ROUNDTRIP_CASES` 里任一条只要带上它，本门当场红。
 * 配套的 §0 更直接：**读路发的字段集必须等于契约的字段集**，两份清单一漂移就红。
 * ══════════════════════════════════════════════════════════════════════════ */

type Registries = {
  linkTypes: (Record<string, unknown> & { key: string; fromType: string; toType: string; cardinality: string })[];
};

const registries = async (t: Awaited<ReturnType<typeof makeApp>>): Promise<Registries> => {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/mapping/registries", headers: ADMIN });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body) as Registries;
};

/** 落盘真相（不是投影）：往返有没有丢东西，只有存下来的那条 `LinkTypeDef` 说了算。 */
async function storedDecl(t: Awaited<ReturnType<typeof makeApp>>, key: string): Promise<Record<string, unknown>> {
  const rows = await t.repos.ontologyLinks.list("demo", (l) => l.key === key);
  expect(rows.length, `落盘应恰好 1 条 ${key}`).toBe(1);
  const row = rows[0] as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // 只取物化声明这 9 个：`version` 每次 upsert 必 +1，把它算进 hash 会让本门恒红且毫无意义。
  for (const f of [...LINK_MATERIALIZATION_FIELDS].sort()) if (row[f] !== undefined) out[f] = row[f];
  return out;
}

/** 稳定序列化后取 sha256 —— 「字段还在」与「值没被改」一次咬住。 */
const declHash = (decl: Record<string, unknown>) =>
  createHash("sha256").update(JSON.stringify(decl)).digest("hex").slice(0, 16);

/**
 * **走用户那条路**保存一次，一个字段都不改。
 *
 * 严格复刻关系编辑器的往返：**只用 `GET …/mapping/registries` 给出来的东西**拼 POST 体
 * （编辑器手上也只有这些）。读投影漏发的字段，这里同样回填不出来 —— 这正是要咬的那条缝。
 * ⚠ 不许从 `t.repos` 取值来拼 POST 体：那等于替客户端补上它根本拿不到的信息，
 *   本门会变成一句永远为真的空话（本仓「假绿」的经典形态）。
 */
async function saveViaEditor(t: Awaited<ReturnType<typeof makeApp>>, key: string, extra: Record<string, unknown> = {}) {
  const row = (await registries(t)).linkTypes.find((l) => l.key === key);
  expect(row, `registries 里必须有 ${key}`).toBeDefined();
  const payload: Record<string, unknown> = {
    key: row!.key,
    fromTypeKey: row!.fromType,
    toTypeKey: row!.toType,
    cardinality: row!.cardinality,
  };
  for (const f of LINK_MATERIALIZATION_FIELDS) if (row![f] !== undefined) payload[f] = row![f];
  return t.app.inject({ method: "POST", url: "/a/v1/ontology/link-types", headers: ADMIN, payload: { ...payload, ...extra } });
}

/**
 * 每条用例专挑一个（或一组）物化声明字段，合起来把 9 个**全部**覆盖到。
 * 形态互斥（`viaProperty` / `viaBridge` / `viaKeyExpr` / `viaCross` 四选一）所以必须分条，
 * 不能塞进一条边里 —— 塞了会被写入期 400 挡掉，那是另一件事。
 */
const ROUNDTRIP_CASES: { name: string; covers: string[]; payload: Record<string, unknown> }[] = [
  {
    name: "谓词边（viaWhere）",
    covers: ["viaProperty", "viaSide", "viaWhere"],
    payload: {
      key: "zz_rt_where", fromTypeKey: "Material", toTypeKey: "CarbonFactor", cardinality: "N:N",
      viaProperty: "key", viaSide: "to", viaWhere: "CarbonFactor.kind == 'material'",
    },
  },
  {
    name: "锚点列 + anchor 侧谓词（anchorProperty / viaWhereTo）",
    covers: ["anchorProperty", "viaWhereTo"],
    payload: {
      key: "zz_rt_anchor", fromTypeKey: "Order", toTypeKey: "PlanTarget", cardinality: "N:N",
      viaProperty: "dueMonth", viaSide: "from", anchorProperty: "period", viaWhereTo: "PlanTarget.level == 'month'",
    },
  },
  {
    name: "多值展开（viaMultiValue）",
    covers: ["viaMultiValue"],
    payload: {
      key: "zz_rt_multi", fromTypeKey: "Model", toTypeKey: "Base", cardinality: "N:N",
      viaProperty: "bases", viaSide: "from", viaMultiValue: true,
    },
  },
  {
    name: "桥实体（viaBridge，含可选 anchor 列）",
    covers: ["viaBridge"],
    payload: {
      key: "zz_rt_bridge", fromTypeKey: "Model", toTypeKey: "Line", cardinality: "N:N",
      viaBridge: { typeKey: "Certification", fromProperty: "modelId", toProperty: "lineId" },
    },
  },
  {
    name: "算端点（viaKeyExpr）",
    covers: ["viaKeyExpr"],
    payload: {
      key: "zz_rt_keyexpr", fromTypeKey: "PlanTarget", toTypeKey: "Principal", cardinality: "N:1",
      viaSide: "from", viaKeyExpr: 'IF(this.level == "month", "prin-plan", "prin-coo")',
    },
  },
  {
    name: "叉积（viaCross，含 fromWhere 与 maxEdges）",
    covers: ["viaCross"],
    payload: {
      key: "zz_rt_cross", fromTypeKey: "AnnualScenario", toTypeKey: "CapexProject", cardinality: "N:N",
      viaCross: { fromWhere: "AnnualScenario.key != 'conservative'", maxEdges: 10000 },
    },
  },
];

describe("WO-MAPPING-WHITELIST · 接缝：关系编辑器保存一次，物化声明不许被抹掉", () => {
  it("§0 读路发的字段集 == 契约字段集（两份手抄清单一漂移就红）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 金丝雀：拿一个**确定在白名单里**的字段用同一个查法跑一遍。
    // 它若也报「发不出来」，那是这个查法坏了，**不许**报「字段缺失」。
    const canaryKey = "zz_wl_canary";
    expect((await createLink(t, {
      key: canaryKey, fromTypeKey: "Material", toTypeKey: "CarbonFactor", cardinality: "N:N",
      viaProperty: "key", viaSide: "to",
    })).statusCode).toBe(201);
    const canaryRow = (await registries(t)).linkTypes.find((l) => l.key === canaryKey);
    expect(canaryRow?.viaProperty, "金丝雀：viaProperty 本来就该发得出来").toBe("key");
    expect(canaryRow?.viaSide).toBe("to");

    // 契约字段集本身不许缩水（9 个，见 `LinkMaterializationDeclSchema`）。
    expect([...LINK_MATERIALIZATION_FIELDS].sort()).toEqual([
      "anchorProperty", "viaBridge", "viaCross", "viaKeyExpr",
      "viaMultiValue", "viaProperty", "viaSide", "viaWhere", "viaWhereTo",
    ]);

    // 主断言：每个字段都**真的能穿过读投影**。修前这里 7 个全军覆没。
    const missing: string[] = [];
    for (const c of ROUNDTRIP_CASES) {
      expect((await createLink(t, c.payload)).statusCode, `${c.name} 建边应 201`).toBe(201);
      const row = (await registries(t)).linkTypes.find((l) => l.key === c.payload.key);
      for (const f of c.covers) if (row?.[f] === undefined) missing.push(`${c.payload.key}.${f}`);
    }
    expect(missing, "这些物化声明字段没能穿过 registries 读投影 ⇒ 保存一次即丢").toEqual([]);
  });

  it("§1 往返：原样保存一次，落盘声明的 hash 必须逐字节相同（9 个字段全覆盖）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    for (const c of ROUNDTRIP_CASES) {
      const key = c.payload.key as string;
      expect((await createLink(t, c.payload)).statusCode, `${c.name} 建边应 201`).toBe(201);

      // 步 1：落库后读回来，字段在。
      const before = await storedDecl(t, key);
      const hBefore = declHash(before);
      for (const f of c.covers) expect(before[f], `${c.name}: 落库后 ${f} 应在`).toBeDefined();

      // 步 2：走用户那条路原样保存一次，一个字段都不改。
      const saved = await saveViaEditor(t, key);
      expect(saved.statusCode, `${c.name} 保存应 201`).toBe(201);

      // 步 3：保存前后**逐字节相同**。修前这里 6 条用例全红（丢字段 ⇒ hash 变）。
      const after = await storedDecl(t, key);
      expect(declHash(after), `${c.name}: 保存前后声明必须逐字节相同（before=${hBefore} decl=${JSON.stringify(before)} after=${JSON.stringify(after)}）`).toBe(hBefore);

      // 再存一次仍然稳定（幂等；一次不丢不代表两次不丢）。
      expect((await saveViaEditor(t, key)).statusCode).toBe(201);
      expect(declHash(await storedDecl(t, key)), `${c.name}: 第二次保存仍须不变`).toBe(hBefore);
    }
  });

  it("§2 反向对照：垃圾字段走同一条路必须被丢掉（白名单不是全放行）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const key = "zz_rt_junk";
    expect((await createLink(t, {
      key, fromTypeKey: "Material", toTypeKey: "CarbonFactor", cardinality: "N:N",
      viaProperty: "key", viaSide: "to", viaWhere: "CarbonFactor.kind == 'material'",
    })).statusCode).toBe(201);
    const before = await storedDecl(t, key);

    // 同一条路，额外塞三个不该被保留的字段（含一个像内部字段的 `tenantId` —— 越权注入的形态）。
    const junk = { zzNotAField: "should-be-dropped", viaPropertyTYPO: "nope", tenantId: "evil-tenant" };
    const res = await saveViaEditor(t, key, junk);
    expect(res.statusCode).toBe(201);

    const rows = await t.repos.ontologyLinks.list("demo", (l) => l.key === key);
    const raw = rows[0] as unknown as Record<string, unknown>;
    for (const f of Object.keys(junk)) {
      if (f === "tenantId") {
        // `tenantId` 是内部字段，落盘必须仍是本租户 —— 被请求体改写就是越权。
        expect(raw.tenantId, "垃圾 tenantId 不许覆盖落盘租户").toBe("demo");
        continue;
      }
      expect(raw[f], `垃圾字段 ${f} 不许落盘（落了说明白名单被改成了全放行）`).toBeUndefined();
    }
    // 且垃圾字段不许把合法声明带歪。
    expect(declHash(await storedDecl(t, key))).toBe(declHash(before));

    // 垃圾字段同样不许从读投影漏出去。
    const row = (await registries(t)).linkTypes.find((l) => l.key === key);
    for (const f of Object.keys(junk)) expect(row?.[f], `垃圾字段 ${f} 不许出现在读投影`).toBeUndefined();
  });
});
