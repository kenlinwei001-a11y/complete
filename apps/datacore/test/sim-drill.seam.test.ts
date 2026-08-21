import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, BASE_MANAGER, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import { SUB_CAUSE_CONSERVATION_TOLERANCE_PCT, subCauseConservationResidual, type ChainLossDrill, type ChainNodeDetail } from "@platform/contracts";
import type { ChainLossResult } from "../src/solvers/chain-loss.js";

/**
 * WO-SIM-BE-DRILL · 根因二级下钻 + 批号级传导明细的门。
 *
 * ── 这个文件咬五件事（全在**效果层**，不是「路由存在 / 字段非空」的运输层）──
 *  ① **守恒（命门）**：`Σ子因pct + residual.pct == 该环节pct`，**逐环节**断言（不是抽一个样）。
 *     另加**非空洞前置**：必须至少有一个环节真拆出 ≥2 条 `UNIT` 级子因 ——
 *     否则这条守恒测在本数据集上等于「1 == 1」，门没牙。
 *  ② **子因不许是编的（红线）**：每条子因的 `evidence.objectId` 拿**已发布本体声明的主键**
 *     回 `listByType` 必须捞得到那一行，且 `evidence.value` 与该行那个字段**逐位相等**。
 *     金丝雀：同一套解析对一个**故意不存在**的 id 必须捞不到 —— 捞得到说明解析器坏了，
 *     这时候本条的「全部命中」是假绿（本仓「报否定结论前先自证工具」那条纪律）。
 *  ③ **诚实缺席**：派生不出子因的环节返回**空数组 + reason**，且 reason **必须来自数据**
 *     （= `chain_loss_attribution` 的 `empty[].reason` 原文），不是本测试或引擎编的一句文案。
 *  ④ **A6 行级过滤（本单唯一带权限断言的门）**：`base_manager:常州` 调明细只拿到常州批号；
 *     同一请求换到别的基地 **0 条**，且**必须配金丝雀**：admin 同参数拿得到 >0 条 ——
 *     否则「0 条」证明不了是权限挡的，可能只是那儿本来就没数据。
 *  ⑤ **变异反证的常设机制**：把子因换成写死词表（「炉位不足 / 批次拆分」）后，②的解析必须**当场落空**。
 *     写成断言而不是只在报告里说一句 —— 「下次同样的错发生时，是机器先说话」。
 */

const A: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
const TOL = SUB_CAUSE_CONSERVATION_TOLERANCE_PCT;

/** 本体声明的主键属性（单一出处 = 已发布本体·**非硬编码类型→PK 映射表**，新增下钻类型自动进门）。 */
async function pkPropOf(t: TestApp, typeKey: string): Promise<string | undefined> {
  const ty = (await t.services.ontology.listTypes(A)).find((x) => x.key === typeKey);
  return ty?.properties.find((p) => p.isPrimaryKey)?.propKey;
}

/** 按 `objectType.objectId` 回仓储捞那一行的 props。捞不到 → undefined（调用方必须判为失败）。 */
async function rowOf(t: TestApp, objectType: string, objectId: string): Promise<Record<string, unknown> | undefined> {
  const pk = await pkPropOf(t, objectType);
  if (!pk) return undefined;
  const rows = (await t.repos.objects.listByType(A.tenantId, objectType)).map((o) => o.props);
  return rows.find((r) => String(r[pk]) === objectId);
}

const chainLoss = (t: TestApp) => t.services.solvers.invoke(A, "chain_loss_attribution", {}) as unknown as Promise<ChainLossResult>;

const drill = async (t: TestApp, nodeId: string, headers: Record<string, string> = ADMIN): Promise<{ status: number; body: ChainLossDrill }> => {
  const res = await t.app.inject({ method: "POST", url: "/a/v1/sim/chain-loss-drill", headers, payload: { nodeId } });
  return { status: res.statusCode, body: res.json() as ChainLossDrill };
};

async function newSession(t: TestApp): Promise<string> {
  const res = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: {} });
  if (res.statusCode !== 201) throw new Error(`sim session create failed: ${res.body}`);
  return (res.json() as { id: string }).id;
}

const detail = async (t: TestApp, sid: string, query: string, headers: Record<string, string> = ADMIN): Promise<{ status: number; body: ChainNodeDetail }> => {
  const res = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/node-detail?${query}`, headers });
  return { status: res.statusCode, body: res.json() as ChainNodeDetail };
};

describe("WO-SIM-BE-DRILL · 根因二级下钻 + 批号级传导明细", () => {
  // ══════════════════════════════════════════════════════════════════════
  // ① 守恒（逐环节）
  // ══════════════════════════════════════════════════════════════════════
  it("① 守恒：Σ子因占比 + 残差 == 该环节占比，逐环节断言（且门有牙：至少一个环节真拆出 ≥2 条 UNIT 级）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const loss = await chainLoss(t);

    // 非空洞前置：链上真有归因行，否则下面的循环等于空转。
    expect(loss.nodes.length, "chain_loss_attribution 一个节点都没有 ⇒ 本条空转，不是通过").toBeGreaterThan(0);

    let unitLevelNodes = 0;
    let maxUnitFanout = 0;
    for (const node of loss.nodes) {
      const { status, body } = await drill(t, node.nodeId);
      expect(status, `节点 ${node.nodeId} 下钻返回 ${status}`).toBe(200);

      // 守恒本体：Σ子因 + 残差 == 环节占比（口径走契约的**唯一实现**，测试不自己写这条加减）。
      const residual = subCauseConservationResidual(body.subCauses, body.residual.pct, body.nodePct);
      expect(Math.abs(residual), `节点 ${node.nodeId}：Σ子因 ${body.conservation.subCausePct} + 残差 ${body.residual.pct} 与环节占比 ${body.nodePct} 差 ${residual}`).toBeLessThanOrEqual(TOL);
      expect(body.conservation.ok, `节点 ${node.nodeId} 自报守恒未通过：residual=${body.conservation.residual}`).toBe(true);
      // 引擎自报的三个数必须与测试独立算出的一致（自报值不许是另一份口径）。
      expect(body.conservation.nodePct).toBe(body.nodePct);
      expect(body.conservation.residualPct).toBe(body.residual.pct);

      // admin 无行级过滤 ⇒ 残差只该是浮点尾差，子因必须覆盖整个环节。
      const sum = body.subCauses.reduce((s, x) => s + x.pct, 0);
      expect(Math.abs(sum - body.nodePct), `admin 视角下节点 ${node.nodeId} 有未认领份额：Σ子因=${sum} vs 环节=${body.nodePct}（残差原因：${body.residual.reason}）`).toBeLessThanOrEqual(TOL);

      // 环节占比必须与 §5 attribution 折叠出来的一致（下钻不许悄悄换分母）。
      const foldPct = loss.attribution
        .filter((a) => loss.evidence.some((e) => e.stepId === a.stepId && e.nodeId === node.nodeId))
        .reduce((s, a) => s + a.pctOfChainLoss, 0);
      expect(body.nodePct, `节点 ${node.nodeId} 的下钻分母与 attribution 折叠值不一致`).toBeCloseTo(foldPct, 10);

      const units = body.subCauses.filter((s) => s.level === "UNIT");
      if (units.length >= 2) unitLevelNodes += 1;
      maxUnitFanout = Math.max(maxUnitFanout, units.length);
      // 天数守恒同样成立（占比对了但天数错了，屏上两栏会自相矛盾）。
      const dSum = body.subCauses.reduce((s, x) => s + x.days, 0) + body.residual.days;
      expect(dSum, `节点 ${node.nodeId} 天数不守恒`).toBeCloseTo(body.nodeDays, 9);
    }

    // 门有牙：本数据集上必须真发生过「二级」下钻，否则这条测只是在验 1==1。
    expect(unitLevelNodes, `没有任何环节拆出 ≥2 条 UNIT 级子因（最大扇出 ${maxUnitFanout}）⇒ 本门空转`).toBeGreaterThan(0);
  }, 300_000);

  // ══════════════════════════════════════════════════════════════════════
  // ② 子因证据不许悬空（红线：不许编）
  // ══════════════════════════════════════════════════════════════════════
  it("② 每条子因的 evidence.objectId 都能在 objects.listByType 里查到，且 evidence.value 与该字段真值逐位相等（配不存在 id 的金丝雀）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const loss = await chainLoss(t);

    let checked = 0;
    const seenTypes = new Set<string>();
    for (const node of loss.nodes) {
      const { body } = await drill(t, node.nodeId);
      for (const sc of body.subCauses) {
        const { objectType, objectId, prop, value } = sc.evidence;
        const pk = await pkPropOf(t, objectType);
        expect(pk, `子因 ${sc.key}：本体里没有类型 ${objectType} 或它没有主键属性 ⇒ 这条子因指向一个不存在的类型`).toBeTruthy();
        const row = await rowOf(t, objectType, objectId);
        expect(row, `子因 ${sc.key}（label="${sc.label}"）的 evidence 指向 ${objectType}.${objectId}，回仓储**捞不到这一行** ⇒ 这条子因是编的`).toBeTruthy();
        const truth = row?.[prop];
        expect(typeof truth, `子因 ${sc.key}：${objectType}.${objectId}.${prop} 不是数值（真值=${JSON.stringify(truth)}）`).toBe("number");
        expect(value, `子因 ${sc.key}：标签写着 ${objectType}.${objectId}.${prop}，那个字段的真值是 ${String(truth)}，证据却回了 ${String(value)}`).toBe(truth);
        seenTypes.add(objectType);
        checked += 1;
      }
    }
    expect(checked, "一条子因都没检查到 ⇒ 本条空转").toBeGreaterThan(0);
    // 真发生过「二级」下钻的证据：至少见到 Process/Equipment/WorkOrder 里的一个执行单元类型。
    expect([...seenTypes].some((x) => x === "Equipment" || x === "WorkOrder" || x === "Process"), `子因只落在 ${[...seenTypes].join("/")} 上，一个执行单元类型都没有 ⇒ 没有真的下钻`).toBe(true);

    // 金丝雀（自证工具）：同一套解析对一个**故意不存在**的 id 必须捞不到。
    // 它若也「捞得到」，上面那一片 toBeTruthy 就全是假绿。
    const ghost = await rowOf(t, "Equipment", "EQUIP-这台设备不存在-金丝雀");
    expect(ghost, "金丝雀命中了不存在的 id ⇒ 解析器坏了，上面的全部命中不作数").toBeUndefined();
    const known = await rowOf(t, "Equipment", "LINE-WS-hefei-slurry-coating-E1");
    expect(known, "金丝雀：一个确定存在的 Equipment 也捞不到 ⇒ 解析器坏了（不是数据没有）").toBeTruthy();
  }, 300_000);

  // ══════════════════════════════════════════════════════════════════════
  // ③ 诚实缺席：拆不出来就是空数组 + 取自数据的原因
  // ══════════════════════════════════════════════════════════════════════
  it("③ 派生不出子因的环节：空数组 + reason，且 reason 原文来自 chain_loss_attribution 的 empty[]（不是编的）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const loss = await chainLoss(t);

    // 取一个**只在 empty[] 里**、不在 nodes[] 里的节点（= 本次锚点链上确实拆不出东西的那种）。
    const emptyOnly = loss.empty.filter((e) => !loss.nodes.some((n) => n.nodeId === e.nodeId));
    expect(emptyOnly.length, "本数据集上没有任何「只在 empty[] 里」的节点 ⇒ 本条空转").toBeGreaterThan(0);

    for (const e of emptyOnly) {
      const { status, body } = await drill(t, e.nodeId);
      expect(status).toBe(200);
      expect(body.subCauses, `节点 ${e.nodeId} 无承载却返回了 ${body.subCauses.length} 条子因 ⇒ 那些是编出来的`).toEqual([]);
      expect(body.nodePct, `节点 ${e.nodeId} 无损失却报了 ${body.nodePct}% ⇒ 0% 冒充「查过了没问题」`).toBe(0);
      expect(body.reason, `节点 ${e.nodeId} 返回空子因却不说为什么 ⇒ 空白比错答更容易被当成「没问题」`).toBeTruthy();
      // 原因必须**逐字**来自数据行，不是引擎另写的一句好听话。
      expect(body.reason, `节点 ${e.nodeId} 的 reason 与 chain_loss_attribution 登记的原因对不上：\nreason=${body.reason}\nempty.reason=${e.reason}`).toContain(e.reason);
      expect(body.residual.reason, "残差原因也必须说清（0 也要说）").toBeTruthy();
    }

    // 反面样例：有承载的环节**不许**走这条空分支（否则「空数组」就成了万能兜底）。
    const withLoss = loss.nodes[0]!;
    const { body: ok } = await drill(t, withLoss.nodeId);
    expect(ok.subCauses.length, `有损失的节点 ${withLoss.nodeId} 也返回空子因 ⇒ 空分支被当兜底用了`).toBeGreaterThan(0);
    expect(ok.reason, "有子因时不该再挂 reason（自相矛盾）").toBeUndefined();
  }, 300_000);

  // ══════════════════════════════════════════════════════════════════════
  // ④ A6 行级过滤（本单唯一带权限断言的门）
  // ══════════════════════════════════════════════════════════════════════
  it("④ A6：base_manager:常州 调明细只拿到常州批号；同一请求换个基地 0 条（配 admin 金丝雀证明不是没数据）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const sid = await newSession(t);
    const NODE = "capacity.op.OP-002"; // 涂布：实测这是全仓唯一有在制批号的站位

    // ── 金丝雀（必须先跑）：admin 在两个基地上都拿得到批号 ────────────────────
    // 没有这一步，下面的「0 条」证明不了是权限挡的 —— 可能只是那儿本来就没数据。
    const adminCz = await detail(t, sid, `nodeId=${NODE}&baseId=changzhou`);
    const adminHf = await detail(t, sid, `nodeId=${NODE}&baseId=hefei`);
    expect(adminCz.status).toBe(200);
    expect(adminCz.body.lots.length, "金丝雀：admin 在常州都拿不到批号 ⇒ 本条无意义").toBeGreaterThan(0);
    expect(adminHf.body.lots.length, "金丝雀：admin 在合肥都拿不到批号 ⇒ 下面的「0 条」证明不了任何事").toBeGreaterThan(0);
    expect(adminCz.body.visibility.visibleLineCount, "admin 不该被行级过滤收窄").toBe(adminCz.body.visibility.totalLineCount);

    // ── base_manager:常州 ───────────────────────────────────────────────────
    const bm = await detail(t, sid, `nodeId=${NODE}`, BASE_MANAGER);
    expect(bm.status).toBe(200);
    expect(bm.body.lots.length, "base_manager 一条批号都拿不到 ⇒ 过滤过头了（应当看得到自己基地的）").toBeGreaterThan(0);
    expect(bm.body.visibility.rowFilters.length, "base_manager 身上没有生效的行级过滤 ⇒ A6 根本没走").toBeGreaterThan(0);
    expect(bm.body.visibility.visibleLineCount, "base_manager 的可见产线数应当**少于**全量（否则没被收窄）").toBeLessThan(bm.body.visibility.totalLineCount);

    // 逐条回仓储验：每个批号的产线所属基地必须是常州。
    // ⛔ 不拿 lotNo 里的子串当基地判据（id 里恰好含基地名是巧合，不是契约）——
    //    回 WIPLot → Line → baseId 走真链路才是判据。
    const lines = (await t.repos.objects.listByType("demo", "Line")).map((o) => o.props);
    const lots = (await t.repos.objects.listByType("demo", "WIPLot")).map((o) => o.props);
    const baseOfLot = (lotNo: string): string | undefined => {
      const lot = lots.find((l) => String(l.lotId) === lotNo);
      const line = lines.find((l) => String(l.lineId) === String(lot?.lineId));
      return line ? String(line.baseId) : undefined;
    };
    const bases = [...new Set(bm.body.lots.map((l) => baseOfLot(l.lotNo)))];
    expect(bases, `base_manager:常州 拿到了非常州基地的批号：${JSON.stringify(bases)}`).toEqual(["changzhou"]);
    // 而 admin 同一请求跨多个基地（证明上面那个单元素集合不是「本来就只有一个基地」）。
    const adminAll = await detail(t, sid, `nodeId=${NODE}`);
    expect([...new Set(adminAll.body.lots.map((l) => baseOfLot(l.lotNo)))].length, "全仓只有一个基地 ⇒ 上面的基地断言空转").toBeGreaterThan(1);

    // ── 换个基地：0 条 ─────────────────────────────────────────────────────
    const bmHefei = await detail(t, sid, `nodeId=${NODE}&baseId=hefei`, BASE_MANAGER);
    expect(bmHefei.status).toBe(200);
    expect(bmHefei.body.lots, "base_manager:常州 拿到了合肥的批号 ⇒ 行级过滤没生效").toEqual([]);
    // 0 条必须**说清是被什么挡的**（静默空数组会被读成「那儿没有」）。
    const why = bmHefei.body.missing.find((m) => m.field === "lots");
    expect(why, "0 条却不登记原因 ⇒ 「看不到」被伪装成「没有」").toBeTruthy();
    expect(why?.reason).toContain("行级过滤");

    // 下钻路由同样受 A6 约束，且**不把挡掉的份额摊给可见行**（摊上去 = 用权限外的量污染权限内的数）。
    const { body: bmDrill } = await drill(t, "capacity.aging", BASE_MANAGER);
    const bmResidual = subCauseConservationResidual(bmDrill.subCauses, bmDrill.residual.pct, bmDrill.nodePct);
    expect(Math.abs(bmResidual), "受限视角下守恒也必须成立（残差装下被挡掉的份额）").toBeLessThanOrEqual(TOL);
    const hidden = bmDrill.nodePct - bmDrill.subCauses.reduce((s, x) => s + x.pct, 0);
    if (hidden > TOL) {
      expect(bmDrill.residual.reason, "有份额被挡掉却不在残差原因里点名 ⇒ 少掉的部分在屏上消失了").toContain("行级过滤");
    }
  }, 300_000);

  // ══════════════════════════════════════════════════════════════════════
  // ⑤ 变异反证的**常设机制**（不是只在报告里写一句「已知此坑」）
  // ══════════════════════════════════════════════════════════════════════
  it("⑤ 变异反证：把子因换成写死词表（炉位不足/批次拆分），②那套解析必须当场落空 —— 证明②真有牙", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 这就是本单红线禁止的那种东西：名字好看、`evidence` 齐全，但背后没有任何一行对象。
    // 种子一换它照印不误 —— 屏上撒谎比屏上没有更糟。
    const HARDCODED_LEXICON = [
      { key: "furnace_shortage", label: "炉位不足", evidence: { objectType: "Process", objectId: "PROC-炉位", prop: "channels" } },
      { key: "batch_split", label: "批次拆分", evidence: { objectType: "WorkOrder", objectId: "WO-批次拆分", prop: "qtyPlanned" } },
      { key: "equip_downtime", label: "设备停机", evidence: { objectType: "Equipment", objectId: "EQ-停机", prop: "availFactor" } },
    ];
    for (const fake of HARDCODED_LEXICON) {
      const row = await rowOf(t, fake.evidence.objectType, fake.evidence.objectId);
      expect(row, `写死词表「${fake.label}」竟然在仓储里捞得到 ${fake.evidence.objectType}.${fake.evidence.objectId} ⇒ ②的判据失效（此时②全绿也说明不了子因是真的）`).toBeUndefined();
    }

    // 反面：真实实现产出的子因，同一套解析必须**全部命中**（否则是解析器坏了，不是词表被抓住了）。
    const loss = await chainLoss(t);
    const { body } = await drill(t, "capacity.aging");
    expect(body.subCauses.length, "老化环节一条子因都没有 ⇒ 本条对照组空转").toBeGreaterThan(0);
    for (const sc of body.subCauses) {
      const row = await rowOf(t, sc.evidence.objectType, sc.evidence.objectId);
      expect(row, `真实子因 ${sc.key} 反而捞不到 ⇒ 解析器坏了`).toBeTruthy();
    }
    // 且真实子因的 label 里**不含**任何写死因名（引擎里根本没有那些串）。
    const labels = body.subCauses.map((s) => s.label).join(" ");
    for (const fake of HARDCODED_LEXICON) {
      expect(labels, `真实子因的 label 里出现了写死因名「${fake.label}」`).not.toContain(fake.label);
    }
    expect(loss.anchor.baseId, "锚点基地为空 ⇒ 上面的展开范围无意义").toBeTruthy();
  }, 300_000);

  // ══════════════════════════════════════════════════════════════════════
  // 明细的真值纪律（③ 的孪生：wip/takt/yieldPct 一律读回物化真值，禁常数）
  // ══════════════════════════════════════════════════════════════════════
  it("明细：wip / takt / yieldPct 逐条回仓储对拍（含单位换算可校），route 取自真实工序顺序而非空表 WIPMove", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const sid = await newSession(t);
    const { status, body } = await detail(t, sid, "nodeId=capacity.op.OP-002&baseId=changzhou");
    expect(status).toBe(200);
    expect(body.node.station, "站位派生不出来 ⇒ 下面全部空转").toBe("涂布");
    expect(body.lots.length, "该站位一条批号都没有 ⇒ 本条空转").toBeGreaterThan(0);

    for (const lot of body.lots) {
      // wip：批号行自己的 qty
      const lotRow = await rowOf(t, "WIPLot", lot.lotNo);
      expect(lotRow, `批号 ${lot.lotNo} 回仓储捞不到`).toBeTruthy();
      expect(lot.wip, `批号 ${lot.lotNo} 的 wip 与 WIPLot.qty 对不上`).toBe(lotRow?.qty);
      expect(lot.station).toBe(lotRow?.currentProcess);
      // batch：工单计划投产数
      expect(lot.evidence.batch, `批号 ${lot.lotNo} 缺 batch 证据`).toBeTruthy();
      const woRow = await rowOf(t, "WorkOrder", lot.evidence.batch!.objectId);
      expect(woRow?.qtyPlanned, `批号 ${lot.lotNo} 的 batch 与 WorkOrder.qtyPlanned 对不上`).toBe(lot.batch);
      // takt：设备节拍（原单位，1:1，不换算）
      expect(lot.evidence.takt, `批号 ${lot.lotNo} 缺 takt 证据 ⇒ 它的 takt 是哪来的？`).toBeTruthy();
      const eqRow = await rowOf(t, "Equipment", lot.evidence.takt!.objectId);
      expect(eqRow?.ctSeconds, `批号 ${lot.lotNo} 的 takt 与 Equipment.ctSeconds 对不上`).toBe(lot.takt);
      expect(lot.evidence.takt!.value).toBe(lot.takt);
      // yieldPct：Process.yield × 100 —— 证据回的是**比率原值**，换算必须机器可校（同 chain-loss 的 1e4 教训）
      expect(lot.evidence.yield, `批号 ${lot.lotNo} 缺 yield 证据`).toBeTruthy();
      const procRow = await rowOf(t, "Process", lot.evidence.yield!.objectId);
      expect(procRow?.yield, "yield 证据回的必须是比率原值（不是换算后的百分数）").toBe(lot.evidence.yield!.value);
      expect(lot.yieldPct, `批号 ${lot.lotNo}：yieldPct 必须 == Process.yield × 100`).toBeCloseTo((lot.evidence.yield!.value as number) * 100, 10);
      // 禁常数：三个数在批号之间必须真有差异（全等 = 很可能是个默认值）
    }
    const distinctWip = new Set(body.lots.map((l) => l.wip));
    const distinctYield = new Set(body.lots.map((l) => l.yieldPct));
    expect(distinctWip.size, "所有批号的 wip 完全相同 ⇒ 高度疑似常数兜底").toBeGreaterThan(1);
    expect(distinctYield.size, "所有批号的 yieldPct 完全相同 ⇒ 高度疑似常数兜底").toBeGreaterThan(1);

    // route：真实工序顺序（WIPMove 实测 0 条，不许拿它当来源）
    expect(body.route.fromStation, "route.fromStation 取不到 ⇒ 工序顺序没走通").toBe("混料");
    expect(body.route.toStation).toBe("辊压");
    expect(body.route.basis).toContain("operationSeq");
    expect((await t.repos.objects.listByType("demo", "WIPMove")).length, "WIPMove 一旦被物化，route 的取数口径要重新论证（本注释即金丝雀）").toBe(0);
  }, 300_000);

  it("R2/R3：别租户的会话 404；nodeId 缺失 400", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const sid = await newSession(t);
    const other = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/node-detail?nodeId=capacity.aging`, headers: { "x-debug-user": "acme:admin:admin" } });
    expect(other.statusCode, "别租户拿到了本租户的会话明细 ⇒ R2 破").toBe(404);
    const noNode = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/node-detail`, headers: ADMIN });
    expect(noNode.statusCode).toBe(400);
  }, 300_000);
});
