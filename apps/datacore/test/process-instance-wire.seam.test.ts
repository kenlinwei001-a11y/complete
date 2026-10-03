import { describe, expect, it } from "vitest";
import {
  ProcessInstanceDetailSchema,
  ProcessStepTemplateResponseSchema,
  tasksFromStepTemplate,
  type ProcessInstanceDetail,
  type ProcessStepTemplateResponse,
} from "@platform/contracts";
import { stepTemplateCoveredProcessKeys } from "../src/process/step-templates.js";
import { seedDemoProcessLayer, DEMO_TENANT } from "../src/seed.js";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";

/**
 * WO-PROCESS-INSTANCE-WIRE · **接缝测试**：界面那条路，一步不跳地真跑一遍。
 *
 * ══ 已经有一条接缝测试了，为什么还要这一条 ═════════════════════════════════
 *
 * `process-step-template.seam.test.ts` 驱动的是
 *   `GET …/step-template` → `tasksFromStepTemplate()` → `POST /a/v1/process-instances`。
 * 那条链**跳过了界面真正要走的一步**：承载对象从哪来。
 * 它把 `subjectRef.objectId` 写成字面量（`"XFER-changzhou-yibin-4680-NCM"`，
 * 变异反证那例更直接写 `"XFER-mutation-probe"`），而 `ProcessRuntimeService.create()`
 * **只校验类型不校验对象存在**（`process/runtime.ts` 只比 `subjectRef.typeKey === def.carrierTypeKey`）
 * ⇒ 喂一个**根本不存在的 id 也会 200**。那条测试因此证明不了界面能走通：
 *
 *   界面的按钮**只在 `GET /a/v1/objects?type=<carrierTypeKey>` 真的返回了对象时才渲染**
 *   （`ProcessStartFromTemplate.tsx` 的 `canStart` 要求 `carriers.data.length > 0`；
 *    一条都没有时它显示「这个类型今天没有对象」并**不给按钮**）。
 *
 * ⇒ 「模板有 7 条」与「这 7 条今天真能从界面建出实例」是**两个命题**。
 * 前者已被证；后者取决于承载类型在真种子里**有没有对象** —— 那正是本仓
 * 铁律 0.5 判据 ① 区分的第二形态「**接了线没数据**」：接线是对的、分支从未进入。
 * 只测第一个命题而宣布"接上了"，就是拿"函数能跑"冒充"链路能用"。
 *
 * ══ 本文件驱动的链路（与 `ProcessStartFromTemplate.tsx` 逐跳同形）═══════════
 *
 *   ① `GET /a/v1/process-definitions/{key}/step-template`   ← 面板的模板来源
 *   ② `GET /a/v1/objects?type=<carrierTypeKey>&page=1&pageSize=20`  ← 面板的承载对象来源（**新增的那一跳**）
 *   ③ `tasksFromStepTemplate(steps)`                         ← 契约里唯一那处转换，前后端共用
 *   ④ `POST /a/v1/process-instances`（objectId 取自 ②，不是字面量）
 *   ⑤ `GET /a/v1/process-instances/{id}` **读回**            ← 证"真的建出来了"而非"响应回显了"
 *
 * ⑤ 这一跳同样是刻意的：POST 的响应是 `create()` 自己算出来的，
 * 拿它断言"建出来了"等于**拿函数的返回值证明函数的返回值**。读回走的是另一条
 * 代码路径（`store.get` → `detail()`），只有真落库了才拿得到。
 *
 * ⚠ 覆盖面**不写死 7**：候选集从 `stepTemplateCoveredProcessKeys()` 现取（单一来源）。
 * 将来补一条模板，本文件自动把它纳入验证，不需要有人记得回来改数字。
 */

/** 开运行时暗发门（`process.runtime` defaultOn:false ⇒ 不开则 `/a/v1/process-instances*` 全 404）。 */
async function enableRuntime(t: TestApp) {
  await t.repos.featureConfigs.put({
    id: `fcfg_${DEMO_TENANT}`,
    tenantId: DEMO_TENANT,
    overrides: { "process.runtime": true },
    configVersion: 1,
    updatedBy: "test",
    updatedAt: "2026-03-01T00:00:00.000Z",
  });
}

/** ① 模板层（真 HTTP + 契约 parse）。 */
async function getStepTemplate(t: TestApp, key: string): Promise<ProcessStepTemplateResponse> {
  const res = await t.app.inject({
    method: "GET",
    url: `/a/v1/process-definitions/${key}/step-template`,
    headers: ADMIN,
  });
  expect(res.statusCode, res.body).toBe(200);
  return ProcessStepTemplateResponseSchema.parse(res.json());
}

/**
 * ② 承载对象来源 —— **逐字节照抄界面那次请求**。
 * `ProcessStartFromTemplate.tsx` 调 `queryObjectsPaged(carrierTypeKey, 1, 20, {})`，
 * 而 `queryObjectsPaged`（`api/endpoints.ts`）拼出来的就是下面这个 query。
 * 参数写得不一样就不算复现界面那条路（分页/过滤都可能改变返回条数）。
 */
async function listCarrierObjects(t: TestApp, typeKey: string): Promise<{ id: string }[]> {
  const res = await t.app.inject({
    method: "GET",
    url: `/a/v1/objects?type=${encodeURIComponent(typeKey)}&page=1&pageSize=20`,
    headers: ADMIN,
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { items: { id: string }[] }).items;
}

/** ④ 建实例。objectId 必须是 ② 取到的真对象。 */
async function createInstance(t: TestApp, key: string, typeKey: string, objectId: string, tasks: unknown) {
  return t.app.inject({
    method: "POST",
    url: "/a/v1/process-instances",
    headers: ADMIN,
    payload: { definitionKey: key, subjectRef: { typeKey, objectId }, tasks },
  });
}

/** 一次性搭好整套（模板层 + 合成对象 + 暗发门）。 */
async function bootstrap(): Promise<TestApp> {
  const t = await makeApp();
  await seedDemoProcessLayer(t.repos);
  // 🔴 承载对象来自 battery 合成种子。不跑它，第 ② 跳恒空 ——
  //    那正是本文件要测的东西，所以它必须**真跑**，不许用手塞的假对象顶替。
  await seedBattery(t);
  await enableRuntime(t);
  return t;
}

// ══════════════════════════════════════════════════════════════════════════
// ① 🔴 头号断言 · 全部有模板的流程，都真能从界面那条路建出实例
// ══════════════════════════════════════════════════════════════════════════

describe("WO-PROCESS-INSTANCE-WIRE 接缝① · 界面那条链逐跳真跑（含承载对象取数）", () => {
  it("每条有模板的流程：模板→真承载对象→建实例→读回，步数逐条对得回模板", async () => {
    const t = await bootstrap();
    const keys = stepTemplateCoveredProcessKeys();

    // 🐤 金丝雀：候选集真取到了。取到 0 条 ⇒ 下面的循环一次都不跑，
    //    整个用例会**假绿**（"全过了"其实是"一条都没验"）。
    expect(keys.length, "步骤模板候选集为空 ⇒ 本用例什么都没验，属工具坏了不是代码干净").toBeGreaterThan(0);

    /**
     * 🔴 **先整轮量完，再统一断言**（不是在循环里就地 expect）。
     * 就地断言会让**第一条**不通的流程直接中断整轮 ⇒ 屏上只看得见一条，
     * 另外几条是好是坏无从得知，下一轮修完再跑又只看得见下一条。
     * 一次跑完给全表，是「机器先说话」要的那种说法：说全，不是说一句。
     */
    interface Row {
      key: string;
      carrierTypeKey: string;
      available: boolean;
      steps: number;
      objects: number;
      postRC: number | null;
      readBackSteps: number | null;
      mismatch: string[];
    }
    const rows: Row[] = [];

    for (const key of keys) {
      // ① 模板
      const tpl = await getStepTemplate(t, key);
      const row: Row = {
        key,
        carrierTypeKey: tpl.carrierTypeKey,
        available: tpl.available,
        steps: tpl.steps.length,
        objects: 0,
        postRC: null,
        readBackSteps: null,
        mismatch: [],
      };
      rows.push(row);
      if (!tpl.available || tpl.steps.length === 0) continue;

      // ② 承载对象 —— 界面按钮的**渲染前提**
      const objects = await listCarrierObjects(t, tpl.carrierTypeKey);
      row.objects = objects.length;
      if (objects.length === 0) continue; // 界面此时不给按钮 ⇒ 后面几跳在真实使用中根本走不到

      // ③ 契约里唯一那处转换（前端用的是同一个函数）
      const tasks = tasksFromStepTemplate(tpl.steps);
      if (tasks.length !== tpl.steps.length) row.mismatch.push(`转换后任务数 ${tasks.length} ≠ 模板步数 ${tpl.steps.length}`);

      // ④ 建实例：objectId 取自 ②，**不是字面量**
      const carrierId = objects[0]!.id;
      const res = await createInstance(t, key, tpl.carrierTypeKey, carrierId, tasks);
      row.postRC = res.statusCode;
      if (res.statusCode !== 200) {
        row.mismatch.push(`POST 非 200：${res.body}`);
        continue;
      }
      const posted = ProcessInstanceDetailSchema.parse(res.json());

      // ⑤ 读回 —— 证"真落库了"，不是"响应回显了"
      const back = await t.app.inject({
        method: "GET",
        url: `/a/v1/process-instances/${encodeURIComponent(posted.instance.id)}`,
        headers: ADMIN,
      });
      if (back.statusCode !== 200) {
        row.mismatch.push(`读回非 200：${back.body}`);
        continue;
      }
      const detail: ProcessInstanceDetail = ProcessInstanceDetailSchema.parse(back.json());
      row.readBackSteps = detail.tasks.length;

      // 🔴 接缝判据：**读回来的**步数等于模板步数，且逐条对得回模板那一步
      if (detail.tasks.length !== tpl.steps.length) {
        row.mismatch.push(`读回步数 ${detail.tasks.length} ≠ 模板步数 ${tpl.steps.length}`);
      }
      for (const [i, s] of tpl.steps.entries()) {
        const t2 = detail.tasks[i];
        if (!t2) { row.mismatch.push(`第 ${i + 1} 步缺失`); continue; }
        if (t2.seq !== i + 1) row.mismatch.push(`第 ${i + 1} 步步序=${t2.seq}`);
        if (t2.name !== s.name) row.mismatch.push(`第 ${i + 1} 步步名 ${t2.name} ≠ ${s.name}`);
        if (t2.ownerFunctionKey !== s.ownerFunctionKey) {
          row.mismatch.push(`第 ${i + 1} 步责任职能 ${t2.ownerFunctionKey} ≠ ${s.ownerFunctionKey}`);
        }
      }
      if (detail.instance.carrierObjectId !== carrierId) row.mismatch.push(`承载对象 ${detail.instance.carrierObjectId} ≠ ${carrierId}`);
      if (detail.instance.carrierTypeKey !== tpl.carrierTypeKey) row.mismatch.push(`承载类型不符`);
      if (detail.instance.origin !== "MANAGED") row.mismatch.push(`origin=${detail.instance.origin}（从界面建的应为 MANAGED）`);
    }

    // 逐条留痕：哪条流程走通了、承载对象有几条，一眼可核。
    // eslint-disable-next-line no-console
    console.log(
      `\n[WO-PROCESS-INSTANCE-WIRE] 界面链路逐条实测（${rows.length} 条有模板的流程）：\n` +
        rows
          .map(
            (r) =>
              `  ${r.key} carrier=${r.carrierTypeKey} 模板${r.steps}步 对象${r.objects}条 ` +
              `POST=${r.postRC ?? "-"} 读回${r.readBackSteps ?? "-"}步 ` +
              (r.objects === 0 ? "⛔界面不给按钮(接了线没数据)" : r.mismatch.length === 0 ? "✅" : `❌ ${r.mismatch.join("; ")}`),
          )
          .join("\n"),
    );

    // ── 统一断言（全表一次性判） ──
    const noTemplate = rows.filter((r) => !r.available);
    expect(noTemplate.map((r) => r.key), "候选集里的流程却报无模板").toEqual([]);

    const noCarrier = rows.filter((r) => r.objects === 0);
    expect(
      noCarrier.map((r) => `${r.key}/${r.carrierTypeKey}`),
      "这些流程的承载类型一条对象都没有 ⇒ 界面不渲染启动按钮，今天**建不出实例**" +
        "（形态：接了线没数据，不是没接线 —— 修法是补种子，不是改接线）",
    ).toEqual([]);

    const broken = rows.filter((r) => r.mismatch.length > 0);
    expect(broken.map((r) => `${r.key}: ${r.mismatch.join("; ")}`), "界面链路逐跳对不上").toEqual([]);

    // 🔴 头号判据（WO 原话）：建出来的 tasks 条数与模板步骤数一致 —— 全表都要成立。
    expect(rows.map((r) => `${r.key}=${r.readBackSteps}`)).toEqual(rows.map((r) => `${r.key}=${r.steps}`));
  }, 300000);
});

// ══════════════════════════════════════════════════════════════════════════
// ② 变异反证 —— 证明上面咬的是链路，不是"能跑通就行"
// ══════════════════════════════════════════════════════════════════════════

describe("WO-PROCESS-INSTANCE-WIRE 接缝② · 变异反证", () => {
  it("模板少喂一步 ⇒ 读回的步数与模板不符（证明断言咬的是模板，不是「建成功了」）", async () => {
    const t = await bootstrap();
    const key = stepTemplateCoveredProcessKeys()[0]!;
    const tpl = await getStepTemplate(t, key);
    expect(tpl.steps.length, "本反证需要至少 2 步的模板才有得少喂").toBeGreaterThan(1);

    const objects = await listCarrierObjects(t, tpl.carrierTypeKey);
    const carrierId = objects[0]!.id;
    // 把最后一步砍掉再建 —— 界面永远不会这么干（它整份折），但这里要证断言真的会红。
    const truncated = tasksFromStepTemplate(tpl.steps.slice(0, -1));

    const res = await createInstance(t, key, tpl.carrierTypeKey, carrierId, truncated);
    expect(res.statusCode, res.body).toBe(200); // 后端不管你喂几步，它照建
    const detail = ProcessInstanceDetailSchema.parse(res.json());
    // 🔴 正是这一条使得头号断言不是装饰：少喂一步，步数就对不上模板。
    expect(detail.tasks.length).not.toBe(tpl.steps.length);
    expect(detail.tasks.length).toBe(tpl.steps.length - 1);
  }, 300000);

  it("承载对象取数这一跳真的会拦人：类型不存在时返回空 ⇒ 界面据此不给按钮", async () => {
    const t = await bootstrap();
    // 🐤 正向金丝雀：一个**已知有对象**的真类型，必须非空 —— 否则说明查询方式本身写错了，
    //    下面那条"空"就不是"这个类型没对象"而是"我根本没查对"。
    const tpl = await getStepTemplate(t, stepTemplateCoveredProcessKeys()[0]!);
    expect(await listCarrierObjects(t, tpl.carrierTypeKey), "金丝雀类型应有对象").not.toHaveLength(0);
    // 反向：一个不存在的类型 ⇒ 空清单（界面 `carriers.data.length === 0` 分支 ⇒ 不渲染按钮）
    expect(await listCarrierObjects(t, "TypeThatDoesNotExistAnywhere")).toHaveLength(0);
  }, 300000);
});
