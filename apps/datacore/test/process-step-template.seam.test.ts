import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PROCESS_OWNER_FUNCTION_KEYS,
  PROCESS_WAIT_KINDS,
  PROCESS_STEP_DURATION_GRAIN_DAYS,
  ProcessStepTemplateResponseSchema,
  processStepTemplateId,
  tasksFromStepTemplate,
  validateProcessStepTemplateSet,
  type ProcessInstanceDetail,
  type ProcessStepTemplate,
  type ProcessStepTemplateResponse,
} from "@platform/contracts";
import {
  BATTERY_PROCESS_STEP_TEMPLATES,
  stepTemplateCoveredProcessKeys,
} from "../src/process/step-templates.js";
import { flowRuleCoveredProcessKeys } from "../src/process/flow-rules.js";
import { processLayerObjectTypes, processLayerLinkTypes } from "../src/process/ontology.js";
import { seedDemoProcessLayer, DEMO_TENANT } from "../src/seed.js";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";

/**
 * WO-STEP-TEMPLATE-LAYER · **接缝测试**（SEAM-GATE）。
 *
 * ══ 这条接缝是什么 ═════════════════════════════════════════════════════════
 *
 * 「模板层有步骤」和「建实例能用上它」是**两半**。两半各自绿证明不了接缝通：
 *  · 只测模板 schema 过 zod ⇒ 证明的是"我抄得对"；
 *  · 只测 `POST /a/v1/process-instances` 能建实例 ⇒ 它一直能建（喂它编出来的步骤也能建）。
 *
 * 故本文件的**头号断言**走**真入口**、驱动整条接缝：
 *
 *   `GET …/step-template`（真 HTTP）
 *     → `tasksFromStepTemplate()`（契约里那唯一一处转换，前端用的就是它）
 *     → `POST /a/v1/process-instances`（真 HTTP）
 *     → 逐条断言**建出来的每一步都对得回模板那一步**（步序 / 步名 / 责任职能 / 条数）
 *
 * 任一半漏了就红：模板没下发 ⇒ 第一步就拿不到 `steps`；转换函数改了序 ⇒ 步序对不上；
 * `create()` 把步骤当装饰 ⇒ 建出来的 task 与模板不符。
 *
 * ══ 第二组断言：**锚点必须回真数据核**（这一组是"不许发明步骤"的机器判据）═════
 *
 * 每一步都声明了它在承载对象上的痕迹（`carrierAnchor`）。本文件**真跑一遍 battery 合成种子**
 * 再逐条核：`TIMESTAMP_FIELD` 的 `propKey` 必须在真本体里该承载类型上查得到；
 * `STATUS_VALUE` 更严 —— 那个阶段值必须在**真实对象**里至少出现过一次。
 * ⚠ 不许拿源码里的字面量对字面量（那测的是"我抄得对不对"），也不许信行尾注释里的枚举
 * （`PropertyDef.enumValues` 本仓大量未声明，只写在注释里 —— 照注释建模就会造出数据里不存在的步）。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_APP = join(__dirname, "..");

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

async function getStepTemplate(t: TestApp, key: string): Promise<ProcessStepTemplateResponse> {
  const res = await t.app.inject({
    method: "GET",
    url: `/a/v1/process-definitions/${key}/step-template`,
    headers: ADMIN,
  });
  expect(res.statusCode, res.body).toBe(200);
  // 经契约 schema parse 一遍：字段少了/多了/类型错了在这里就红，不靠后面挑着断言。
  return ProcessStepTemplateResponseSchema.parse(res.json());
}

// ══════════════════════════════════════════════════════════════════════════
// ① 🔴 头号断言 · 真入口驱动接缝：选模板 → 建实例 → 步骤逐条来自模板
// ══════════════════════════════════════════════════════════════════════════

describe("WO-STEP-TEMPLATE-LAYER 接缝① · 按模板建实例，步骤逐条对得回模板", () => {
  it("P41（3 步模板）走真入口建实例：条数/步序/步名/责任职能逐条相等", async () => {
    const t = await makeApp();
    await seedDemoProcessLayer(t.repos);
    await enableRuntime(t);

    // ── 半边 A：模板层下发 ──
    const tpl = await getStepTemplate(t, "P41");
    expect(tpl.available, "P41 应有步骤模板（种子落地的 7 条之一）").toBe(true);
    expect(tpl.absence).toBeNull();
    expect(tpl.steps.length).toBe(3);
    expect(tpl.carrierTypeKey).toBe("InterBaseTransfer");

    // ── 接缝：契约里那唯一一处转换（前端用的是同一个函数，不许各拼一份）──
    const tasks = tasksFromStepTemplate(tpl.steps);

    // ── 半边 B：运行时层建实例（**真 HTTP**，就是 befe-seam 那条零调用端点）──
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/process-instances",
      headers: ADMIN,
      payload: {
        definitionKey: "P41",
        subjectRef: { typeKey: tpl.carrierTypeKey, objectId: "XFER-changzhou-yibin-4680-NCM" },
        tasks,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const detail = res.json() as ProcessInstanceDetail;

    // 🔴 逐条对回模板 —— 这才是接缝断言（不是"建成功了"）
    expect(detail.tasks.length, "建出来的步数必须等于模板步数").toBe(tpl.steps.length);
    for (const [i, step] of [...tpl.steps].sort((a, b) => a.seq - b.seq).entries()) {
      const task = detail.tasks[i]!;
      expect(task.seq, `第 ${i + 1} 步的步序`).toBe(step.seq);
      expect(task.name, `第 ${step.seq} 步的步名必须来自模板`).toBe(step.name);
      expect(task.ownerFunctionKey, `第 ${step.seq} 步的责任职能必须来自模板`).toBe(step.ownerFunctionKey);
    }

    /**
     * ⛔ **模板不产 gate**（契约裁决 ②）：模板知道"这类流程通常等外部回话"，
     * 不知道"这一单在等哪个回执号"。若这里冒出 gate，说明有人拿 `waitKind` 造了一个
     * 编出来的成因 —— 建出的实例会一上来就"卡"在一个不存在的东西上。
     */
    for (const task of detail.tasks) {
      expect(task.gate, `第 ${task.seq} 步不该带 gate（现场事实只能由 advance 喂进来）`).toBeUndefined();
    }
    // 无 gate ⇒ 首步直接开工，不是卡住（`create()` 建完立刻判一次首步 gate）。
    expect(detail.tasks[0]!.status).toBe("RUNNING");
    expect(detail.stuck, "无 gate 的首步不该有卡点").toBeUndefined();
  }, 300000);

  it("变异反证：把模板第 2 步的责任职能改掉，接缝断言必须红（证明它咬的是链路不是函数）", async () => {
    const t = await makeApp();
    await seedDemoProcessLayer(t.repos);
    await enableRuntime(t);

    const tpl = await getStepTemplate(t, "P41");
    const mutated = tpl.steps.map((s) =>
      s.seq === 2 ? { ...s, ownerFunctionKey: "finance" } : s,
    ) as ProcessStepTemplate[];
    const tasks = tasksFromStepTemplate(mutated);

    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/process-instances",
      headers: ADMIN,
      payload: {
        definitionKey: "P41",
        subjectRef: { typeKey: tpl.carrierTypeKey, objectId: "XFER-mutation-probe" },
        tasks,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const detail = res.json() as ProcessInstanceDetail;
    // 与**真模板**比对：第 2 步已被改动 ⇒ 上面那条断言在这份数据上必然不成立。
    const real = tpl.steps.find((s) => s.seq === 2)!;
    expect(detail.tasks[1]!.ownerFunctionKey).not.toBe(real.ownerFunctionKey);
  }, 300000);

  it("没有模板的流程（P17）：available=false + 具体缺席理由 + 可复跑探针，**不给空步骤糊过去**", async () => {
    const t = await makeApp();
    await seedDemoProcessLayer(t.repos);

    const tpl = await getStepTemplate(t, "P17");
    expect(tpl.available).toBe(false);
    expect(tpl.steps).toEqual([]);
    expect(tpl.absence).not.toBeNull();
    // 「算不出」与「算出来是 0」是两个命题 —— 合计必须是 null 不是 0。
    expect(tpl.stepsTotalStdDurationDays).toBeNull();
    // 缺席理由必须说清缺在哪一环，不许是「暂无数据」这种什么都没说的话。
    expect(tpl.absence!.reason).not.toMatch(/^暂无|^无数据|^N\/A/);
    expect(tpl.absence!.reason.length, "缺席理由必须具体").toBeGreaterThan(20);
    expect(tpl.absence!.probe.length, "缺席必须给可复跑的探针").toBeGreaterThan(20);
  }, 300000);

  it("流程 key 不存在 ⇒ 404（那是调用错）；流程在但没模板 ⇒ 200（那是合法答案）", async () => {
    const t = await makeApp();
    await seedDemoProcessLayer(t.repos);
    const miss = await t.app.inject({
      method: "GET",
      url: "/a/v1/process-definitions/P99/step-template",
      headers: ADMIN,
    });
    expect(miss.statusCode).toBe(404);
    const present = await t.app.inject({
      method: "GET",
      url: "/a/v1/process-definitions/P17/step-template",
      headers: ADMIN,
    });
    expect(present.statusCode).toBe(200);
  }, 300000);
});

// ══════════════════════════════════════════════════════════════════════════
// ② 🔴 锚点回真数据核 —— 「不许发明步骤」的机器判据
// ══════════════════════════════════════════════════════════════════════════

describe("WO-STEP-TEMPLATE-LAYER 接缝② · 每一步的锚点在真跑过的种子里查得到", () => {
  it("真跑 battery 合成种子 → 时刻字段在本体里有、状态值在真实对象里出现过", async () => {
    const t = await makeApp();
    await seedBattery(t); // ← 真跑，不是拿源码字面量对字面量
    await seedDemoProcessLayer(t.repos);

    const types = await t.repos.ontologyTypes.list(DEMO_TENANT);
    const propsByType = new Map(types.map((x) => [x.key, new Set(x.properties.map((p) => p.propKey))]));

    // 🐤 金丝雀（铁律 0.6：报否定结论前先自证工具是对的）。读取坏了会让下面的断言恒绿。
    expect(propsByType.size, "本体类型集合为空 ⇒ 是读取坏了，不是锚点不存在").toBeGreaterThan(50);
    expect(propsByType.get("PurchaseOrder"), "金丝雀：PurchaseOrder 必在种子里").toBeDefined();
    expect([...propsByType.get("PurchaseOrder")!], "金丝雀：orderDay 是已知必中的属性").toContain("orderDay");
    // 反向金丝雀：确定不存在的属性必须查不到，否则集合是"什么都包含"的假集合。
    expect(propsByType.get("PurchaseOrder")!.has("thisPropDoesNotExist_STEP")).toBe(false);

    const defs = await t.repos.processDefinitions.list(DEMO_TENANT);
    const carrierOf = new Map(defs.map((d) => [d.key, d.carrierTypeKey]));

    const steps = await t.repos.processStepTemplates.list(DEMO_TENANT);
    expect(steps.length, "步骤模板一条都没播 ⇒ 下面全部恒绿").toBeGreaterThan(0);

    const badField: string[] = [];
    const badStatus: string[] = [];
    for (const s of steps) {
      const carrier = carrierOf.get(s.processKey);
      expect(carrier, `步骤模板 ${s.processKey} 找不到流程定义`).toBeDefined();
      const props = propsByType.get(carrier!);
      if (!props?.has(s.carrierAnchor.propKey)) {
        badField.push(`${s.processKey}#${s.seq} → ${carrier}.${s.carrierAnchor.propKey} 在本体里不存在`);
        continue;
      }
      if (s.carrierAnchor.kind === "STATUS_VALUE") {
        // 更严的一档：注释里写着的枚举不算数，必须在**真实对象**里真出现过。
        const objs = await t.repos.objects.listByType(DEMO_TENANT, carrier!);
        const seen = new Set(objs.map((o) => String((o.props as Record<string, unknown>)[s.carrierAnchor.propKey])));
        if (!seen.has(s.carrierAnchor.value!)) {
          badStatus.push(
            `${s.processKey}#${s.seq} → ${carrier}.${s.carrierAnchor.propKey}="${s.carrierAnchor.value}" 在 ${objs.length} 条真实对象里一次都没出现（实测取值：${[...seen].sort().join("|")}）`,
          );
        }
      }
    }
    expect(badField, "TIMESTAMP_FIELD/STATUS_VALUE 锚点的属性必须在本体里存在").toEqual([]);
    expect(badStatus, "STATUS_VALUE 的阶段值必须在真实对象里出现过（注释不算证据）").toEqual([]);
  }, 300000);

  it("两种锚 kind 都真有种子在用 —— 不许留一条只有测试走过的死分支", () => {
    const kinds = new Set(
      Object.values(BATTERY_PROCESS_STEP_TEMPLATES).flatMap((ss) => ss.map((s) => s.carrierAnchor.kind)),
    );
    // 铁律 0.5 判据 ②「只有 test 引用 = 已排练，不是已实现」的同族：契约里声明了两个 kind，
    // 若种子只用一个，另一个就是"接了线没数据"的死分支。
    expect([...kinds].sort()).toEqual(["STATUS_VALUE", "TIMESTAMP_FIELD"]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ③ 契约不变量：工期守恒 · 半天粒度 · 步序连续（"随手多编一步"要付代价）
// ══════════════════════════════════════════════════════════════════════════

describe("WO-STEP-TEMPLATE-LAYER · 契约 §2 不变量在真种子上成立，且违反必红", () => {
  it("每条模板：Σ步工期 == 定义 stdDurationDays，步序 1 起连续，工期半天粒度", async () => {
    const t = await makeApp();
    await seedDemoProcessLayer(t.repos);
    const defs = await t.repos.processDefinitions.list(DEMO_TENANT);
    const defByKey = new Map(defs.map((d) => [d.key, d]));

    const covered = stepTemplateCoveredProcessKeys();
    expect(covered.length, "模板一条都没有 ⇒ 下面恒绿").toBeGreaterThan(0);

    for (const key of covered) {
      const def = defByKey.get(key)!;
      const steps = (await t.repos.processStepTemplates.list(DEMO_TENANT, (s) => s.processKey === key)).sort(
        (a, b) => a.seq - b.seq,
      );
      expect(validateProcessStepTemplateSet(def, steps), `${key} 的步骤模板违反契约 §2`).toEqual([]);
      // 端点下发的合计与定义工期必须相等（前端把它当对照列显示）。
      const tpl = await getStepTemplate(t, key);
      expect(tpl.stepsTotalStdDurationDays).toBeCloseTo(def.stdDurationDays, 9);
    }
  }, 300000);

  it("变异反证 · 多编一步（不改总量）⇒ DURATION_SUM_MISMATCH", () => {
    const def = { key: "P35", stdDurationDays: 2 };
    const base: ProcessStepTemplate[] = [1, 2].map((seq) => ({
      id: processStepTemplateId(DEMO_TENANT, "P35", seq),
      tenantId: DEMO_TENANT,
      processKey: "P35",
      seq,
      name: `步 ${seq}`,
      ownerFunctionKey: "quality",
      stdDurationDays: 1,
      waitKind: "WAITING_USER",
      carrierAnchor: { kind: "TIMESTAMP_FIELD", propKey: "arrivedDay", value: null },
      basis: "变异反证用",
    }));
    expect(validateProcessStepTemplateSet(def, base)).toEqual([]);
    const extra: ProcessStepTemplate[] = [
      ...base,
      { ...base[0]!, id: "x", seq: 3, name: "凭空多出来的一步", stdDurationDays: 1 },
    ];
    expect(validateProcessStepTemplateSet(def, extra).map((i) => i.code)).toContain("DURATION_SUM_MISMATCH");
  });

  it("变异反证 · 编出来的精度（1 天拆三份 0.333…）⇒ DURATION_GRAIN", () => {
    const def = { key: "P42", stdDurationDays: 1 };
    const thirds: ProcessStepTemplate[] = [1, 2, 3].map((seq) => ({
      id: `x${seq}`,
      tenantId: DEMO_TENANT,
      processKey: "P42",
      seq,
      name: `步 ${seq}`,
      ownerFunctionKey: "production_planning",
      stdDurationDays: 1 / 3,
      waitKind: "WAITING_SCHEDULE",
      carrierAnchor: { kind: "TIMESTAMP_FIELD", propKey: "startDate", value: null },
      basis: "变异反证用",
    }));
    const codes = validateProcessStepTemplateSet(def, thirds).map((i) => i.code);
    expect(codes).toContain("DURATION_GRAIN");
    expect(PROCESS_STEP_DURATION_GRAIN_DAYS).toBe(0.5);
  });

  it("变异反证 · 步序缺号 ⇒ SEQ_NOT_CONTIGUOUS；孤儿模板 ⇒ FOREIGN_PROCESS_KEY", () => {
    const def = { key: "P35", stdDurationDays: 2 };
    const mk = (seq: number, processKey = "P35"): ProcessStepTemplate => ({
      id: `x${seq}`,
      tenantId: DEMO_TENANT,
      processKey,
      seq,
      name: `步 ${seq}`,
      ownerFunctionKey: "quality",
      stdDurationDays: 1,
      waitKind: "WAITING_USER",
      carrierAnchor: { kind: "TIMESTAMP_FIELD", propKey: "arrivedDay", value: null },
      basis: "变异反证用",
    });
    expect(validateProcessStepTemplateSet(def, [mk(1), mk(3)]).map((i) => i.code)).toContain("SEQ_NOT_CONTIGUOUS");
    expect(validateProcessStepTemplateSet(def, [mk(1), mk(2, "P34")]).map((i) => i.code)).toContain(
      "FOREIGN_PROCESS_KEY",
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ④ 词表与边界：责任职能落登记册 · waitKind 是**模板四值**不是运行时五值
// ══════════════════════════════════════════════════════════════════════════

describe("WO-STEP-TEMPLATE-LAYER · 模板层与运行时层的边界不许弄糊", () => {
  it("每一步的 ownerFunctionKey 落在平台职能登记册里（同定义层纪律）", () => {
    const bad = Object.entries(BATTERY_PROCESS_STEP_TEMPLATES).flatMap(([k, ss]) =>
      ss.filter((s) => !PROCESS_OWNER_FUNCTION_KEYS.includes(s.ownerFunctionKey)).map((s) => `${k}#${s.seq}`),
    );
    expect(bad, "种子里出现登记册外的职能 key").toEqual([]);
  });

  it("每一步的 waitKind 是模板层四值 —— **WAITING_APPROVAL 一步都不许有**", () => {
    const all = Object.values(BATTERY_PROCESS_STEP_TEMPLATES).flatMap((ss) => ss.map((s) => s.waitKind));
    for (const w of all) expect(PROCESS_WAIT_KINDS as readonly string[]).toContain(w);
    // 这一条是边界的机器化形式：`WAITING_APPROVAL` 属运行时层 `ProcessTask.status`
    // （承载物 = S2 ActionDraft，是"这一单正卡在一张具体审批单上"），
    // 模板层说的是"这类流程通常卡在哪类等待"，仓主已裁「流程审批不体现」。
    expect(all).not.toContain("WAITING_APPROVAL");
  });

  it("模板里**没有任何 gate 字段**（gate 是现场事实，模板给不出）", async () => {
    const src = await readFile(join(REPO_APP, "src", "process", "step-templates.ts"), "utf8");
    // 🐤 金丝雀：先证这个文件真被读到了、且抽取方式对既有内容有效。
    expect(src, "金丝雀：种子文件必含 carrierAnchor").toContain("carrierAnchor");
    // 剥掉注释再查（注释里讲"为什么不含 gate"是应该的，不该被判为违规）。
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code, "种子里出现了 gate 字段 —— 模板层不许携带现场事实").not.toMatch(/\bgate\s*:/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ⑤ 覆盖面诚实位 · 候选集由既有单一来源算出，不是手挑
// ══════════════════════════════════════════════════════════════════════════

describe("WO-STEP-TEMPLATE-LAYER · 65 条里补了几条，其余如实标", () => {
  it("模板只落在 flowRuleCoveredProcessKeys() 候选集内（越界必红）", () => {
    const candidates = new Set(flowRuleCoveredProcessKeys());
    // 🐤 金丝雀：候选集函数本身得先有输出，否则下面的"全在集内"恒真。
    expect(candidates.size, "候选集为空 ⇒ 是 flow-rules 读取坏了").toBeGreaterThan(0);
    const outside = stepTemplateCoveredProcessKeys().filter((k) => !candidates.has(k));
    expect(outside, "步骤模板越出候选集 —— 给没观察过的流程写步骤就是发明").toEqual([]);
  });

  it("65 条全覆盖：有模板的 available=true，其余每一条都带具体缺席理由（一条都不许沉默）", async () => {
    const t = await makeApp();
    await seedDemoProcessLayer(t.repos);
    const defs = await t.repos.processDefinitions.list(DEMO_TENANT);
    expect(defs).toHaveLength(65);

    const covered = new Set(stepTemplateCoveredProcessKeys());
    let withTemplate = 0;
    const silent: string[] = [];
    for (const d of [...defs].sort((a, b) => a.key.localeCompare(b.key))) {
      const tpl = await getStepTemplate(t, d.key);
      if (tpl.available) {
        withTemplate += 1;
        expect(covered.has(d.key), `${d.key} 下发了步骤却不在覆盖清单里`).toBe(true);
        expect(tpl.absence).toBeNull();
      } else {
        expect(covered.has(d.key), `${d.key} 在覆盖清单里却没下发步骤`).toBe(false);
        if (!tpl.absence || tpl.absence.reason.length < 20 || tpl.absence.probe.length < 20) silent.push(d.key);
      }
    }
    expect(silent, "这些流程既没有模板、也没说清为什么 —— 沉默的缺席比错的答案更难发现").toEqual([]);
    // 金值：今日 7 条有模板 / 58 条如实标缺席。这个数**会随补模板而变**，
    // 变了就该在这里改并说明补了哪条 —— 它是覆盖面的诚实位，不是摆设。
    expect(withTemplate).toBe(7);
    expect(defs.length - withTemplate).toBe(58);
  }, 300000);
});

// ══════════════════════════════════════════════════════════════════════════
// ⑥ R9 三处同改 + 本体登记（金值即更）
// ══════════════════════════════════════════════════════════════════════════

describe("WO-STEP-TEMPLATE-LAYER · R9 仓储双实现与本体登记", () => {
  const CREATE_TABLE_RE = /CREATE TABLE IF NOT EXISTS\s+(\w+)/gi;
  const PGSTORE_RE = /new PgStore\(pool,\s*"(\w+)"/g;
  const allMatches = (re: RegExp, s: string) => [...s.matchAll(re)].map((m) => m[1]!);

  it("035 建的表，pg.ts 以**同名**接了 PgStore（表名写错只在 pg 模式炸，memory 单测测不到）", async () => {
    const ddl = await readFile(join(REPO_APP, "migrations", "035_process_step_templates.sql"), "utf8");
    const pgSrc = await readFile(join(REPO_APP, "src", "repo", "pg.ts"), "utf8");
    const created = allMatches(CREATE_TABLE_RE, ddl);
    const wired = allMatches(PGSTORE_RE, pgSrc);
    // 🐤 金丝雀：两个正则各拿一个已知必中的样例先自证（与主逻辑共用同一份实现，不另抄）。
    const ddl029 = await readFile(join(REPO_APP, "migrations", "029_process_definitions.sql"), "utf8");
    expect(allMatches(CREATE_TABLE_RE, ddl029), "金丝雀：029 的建表正则必须命中").toContain("process_definitions");
    expect(wired, "金丝雀：PgStore 正则必须命中既有表").toContain("process_definitions");

    expect(created).toEqual(["process_step_templates"]);
    for (const table of created) expect(wired, `migration 建了 ${table}，pg.ts 没接`).toContain(table);
  });

  it("金值 · 流程层本体从 2 类型 3 链路 → 3 类型 4 链路（+ProcessStepTemplate/+process_step_of）", () => {
    const types = processLayerObjectTypes();
    expect(types.map((x) => x.key).sort()).toEqual(["ProcessDefinition", "ProcessInstance", "ProcessStepTemplate"]);
    // 每个类型/属性必须有非空描述（`ontology-descriptions:check` 的同一条纪律）。
    for (const ty of types) {
      expect(ty.description.length, `${ty.key} 缺描述`).toBeGreaterThan(10);
      for (const p of ty.properties) expect(p.description?.length ?? 0, `${ty.key}.${p.propKey} 缺描述`).toBeGreaterThan(5);
    }
    const links = processLayerLinkTypes();
    expect(links.map((l) => l.key)).toContain("process_step_of");
    const stepLink = links.find((l) => l.key === "process_step_of")!;
    expect(stepLink.fromTypeKey).toBe("ProcessStepTemplate");
    expect(stepLink.toTypeKey).toBe("ProcessDefinition");
    expect(stepLink.cardinality).toBe("N:1");
  });

  it("R6 确定性：同一份种子重播两次，步骤模板逐字节一致", async () => {
    const t = await makeApp();
    await seedDemoProcessLayer(t.repos);
    const first = JSON.stringify(
      (await t.repos.processStepTemplates.list(DEMO_TENANT)).sort((a, b) => a.id.localeCompare(b.id)),
    );
    await seedDemoProcessLayer(t.repos); // 幂等重播
    const second = JSON.stringify(
      (await t.repos.processStepTemplates.list(DEMO_TENANT)).sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(second).toBe(first);
  }, 300000);
});
