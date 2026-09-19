import type { MappingRow, MappingRegistries } from "@platform/contracts";
import { LINK_MATERIALIZATION_FIELDS } from "@platform/contracts";
import type { Repos } from "./repo/repo.js";
import { SOLVER_KEYS } from "./solvers/service.js";
import { AGENT_SEEDS, CONN_SYSTEM, DOMAIN_ORDER, GRAPH_DOMAIN, SOLVER_GRAPH } from "./graphmeta.js";

/**
 * §7.20 业务建模映射表：服务端由本体元数据 + sourceBindings + 规则 scope + 派生公式
 * + 求解器注册表 + Agent 静态清单拼装，按数据域分组、组内按显示名排序后下发。
 */
export async function buildMappingRows(repos: Repos, tenantId: string): Promise<MappingRow[]> {
  const types = await repos.ontologyTypes.list(tenantId, (t) => t.status === "ACTIVE");
  const rules = await repos.rules.list(tenantId, (r) => r.status === "PUBLISHED");
  const conns = await repos.connections.list(tenantId);
  const connName = (connId?: string): string | undefined => {
    if (!connId) return undefined;
    return conns.find((c) => c.id === connId)?.name ?? CONN_SYSTEM[connId] ?? connId;
  };

  const rows: MappingRow[] = [];
  for (const t of types) {
    const binding = (t.sourceBindings ?? [])[0];
    const domain = GRAPH_DOMAIN[t.key] ?? "factory";
    rows.push({
      domain,
      objectKey: t.key,
      displayName: t.displayName ?? t.key,
      kind: "object",
      // WO-MODELING-INTERACTIVE 合并后：sourceBindings 可能指向合成动态连接（connId 不在静态 CONN_SYSTEM）——
      // 高层「源系统」标签只认已知连接器系统，未知/合成绑定回落数据域默认（真实源系统连接名走下方 lineage.connName）。
      sourceSystem: (binding ? CONN_SYSTEM[binding.connId] : undefined) ?? (domain === "plan" ? "平台·计划域" : "—"),
      keyProps: (t.properties ?? []).slice(0, 5).map((p) => p.propKey),
      rules: rules.filter((r) => (r.scopeObjectTypes ?? []).includes(t.key)).map((r) => r.key).sort(),
      derivations: (t.derivedProperties ?? []).map((d) => `${d.propKey} = ${d.formula}`),
      lineage: {
        ...(binding ? { connName: connName(binding.connId), dataset: binding.dataset } : {}),
        fieldCount: binding ? Object.keys(binding.fieldMappings ?? {}).length : 0,
      },
    });
  }
  // 求解器行（kind="solver"）
  for (const solverKey of SOLVER_KEYS) {
    const meta = SOLVER_GRAPH[solverKey];
    if (!meta) continue;
    rows.push({
      domain: "solver",
      objectKey: solverKey,
      displayName: meta.label,
      kind: "solver",
      sourceSystem: "平台求解器",
      keyProps: [],
      rules: [...meta.ruleRefs],
      derivations: [`输出绑定 → ${meta.target}`],
      lineage: { fieldCount: 0 },
    });
  }
  // Agent 行（kind="agent"，静态种子清单）
  for (const a of AGENT_SEEDS) {
    rows.push({
      domain: "agent",
      objectKey: a.key,
      displayName: a.displayName,
      kind: "agent",
      sourceSystem: "AgentCore",
      keyProps: [],
      rules: [],
      derivations: [a.summary],
      lineage: { fieldCount: 0 },
    });
  }
  // 分组排序：数据域顺序 → 显示名（码点序，跨环境确定性）
  const domainIdx = (d: string) => {
    const i = DOMAIN_ORDER.indexOf(d);
    return i === -1 ? DOMAIN_ORDER.length : i;
  };
  rows.sort((a, b) => {
    const di = domainIdx(a.domain) - domainIdx(b.domain);
    if (di !== 0) return di;
    return a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0;
  });
  return rows;
}

// PRD-IND-map §4.4：Action / 事件类型注册表（静态种子，确定性 R6；逐字录自参考原型 ACTION_TYPES/EVENT_TYPES）。
const ACTION_TYPE_REG: MappingRegistries["actions"] = [
  { name: "采纳产能保障方案", params: "型号 / 需求量 / 交期 / 调参组合(夜班·通道·外协)", check: "C03 上限校验 · C08 外协红线 · 需含审批人(C10)", target: "生产工单MO（写回）", perm: "发起:规划员 · 审批:生产计划部" },
  // WO-SIM-ACTION-REAL：项目推演⑥「采纳结论」真接的 Action（屏上 DAG fc 节点那句承诺的兑现）。
  { name: "采纳产能预测结论", params: "型号 / 需求(万套) / 窗口(周) / 推演快照(P50·P90·缺口·健康度)", check: "payload 过 ForecastAdoptionPayloadSchema 契约 · 需含审批人(C10)", target: "ForecastAdoption 台账对象（写回）+ 选中订单回 stamp", perm: "发起:规划员 · 审批:生产计划部" },
  { name: "预警处置方案", params: "基地 / 风险对象 / 方案编号 / 起效时间", check: "C06 齐套冻结 · C11 错峰评审", target: "处置工单（写回）+ 风险曲线消解", perm: "发起:基地负责人 · 审批:生产计划部" },
  { name: "调整排产分配", params: "订单 / 基地分配比例 / 生效周", check: "C04 仅认证产线 · C01 产线上限", target: "排产计划（写回）", perm: "发起:计划员 · 审批:基地负责人" },
  { name: "定稿月度计划版本", params: "计划版本号 / 三张评审表快照 / 高管决议", check: "C21 差异已提报 · C18 现金安全垫 · C22 定稿后锁定", target: "月度S&OP版本（定稿+锁定）", perm: "发起:S&OP主持人 · 审批:经营决策会" },
];
const EVENT_TYPE_REG: MappingRegistries["events"] = [
  { name: "检修窗口", window: "每基地年度检修周（如常州第8周）", affects: "设备OEE / 产线负载率 +14", source: "EAM/CMMS 检修计划" },
  { name: "交付高峰", window: "订单交期聚集日 ±3天", affects: "产线负载率 / 人力工时 +9", source: "S&OP 订单交期" },
  { name: "到货间隙", window: "采购批次周期(≈14天)末端", affects: "物料供给齐套 / 物流在途 +10", source: "WMS/ERP 采购批次" },
];

/**
 * §7.20 映射表四注册表段：关系类型（OntologyLink 派生）/ 规则（RuleService 派生）/ Action / 事件（静态种子）。
 * linkTypes/rules 来自真实本体 + 规则注册（R13/R14），actions/events 为确定性静态注册（R6）。
 */
export async function buildMappingRegistries(repos: Repos, tenantId: string): Promise<MappingRegistries> {
  const links = await repos.ontologyLinks.list(tenantId, (l) => l.published !== false);
  const rules = await repos.rules.list(tenantId, (r) => r.status === "PUBLISHED");
  const sevLabel: Record<string, string> = { BLOCK: "阻断", WARN: "告警", INFO: "提示" };
  return {
    linkTypes: links
      // WO-RELATION-EDIT-GAPS ①：`viaProperty`/`viaSide` 随边下发（加性可选，未声明即缺席）——
      // 关系编辑器的「改」表单靠它预填「由哪个属性实现」，不预填就会在保存时把它抹掉。
      //
      // WO-MAPPING-WHITELIST：**同一条纪律对全部 9 个物化声明字段成立，此前只兑现了 2 个。**
      // 修前这里手写 `...(l.viaProperty ? { viaProperty, viaSide } : {})`，而写路
      // （`POST /a/v1/ontology/link-types`）已收 9 个 ⇒ 差集 7 个（`anchorProperty`
      // `viaMultiValue` `viaBridge` `viaWhere` `viaKeyExpr` `viaWhereTo` `viaCross`）
      // 在「读—改—写」往返里被静默抹掉：写路是整条覆盖（`upsertLinkType` 的 `{...input}` + `put`），
      // 客户端拿不到就回填不出来，用户一个字段都不改、只点一次保存，声明当场归零。
      //
      // 现在按**契约的字段集**（`LINK_MATERIALIZATION_FIELDS`，与写路同一份 schema）逐个拷贝：
      // · 仍是**白名单**（逐个 key 拷贝，不 `...spread` 整条 `LinkTypeDef`）——
      //   `id`/`tenantId`/`version`/`published`/`deprecation` 一个都不会漏出去；
      // · 加字段只需改契约那一处，读写两路同时生效，**不再靠人记得同步两份手抄清单**。
      .map((l) => {
        const decl: Record<string, unknown> = {};
        for (const f of LINK_MATERIALIZATION_FIELDS) {
          // `LinkTypeDef` 上这 9 个字段同名同义 ⇒ 直接按契约的 key 取，不做 `any`/宽转换：
          // 哪天 `LinkTypeDef` 少了其中一个，这一行**当场编译红**，而不是悄悄发不出来。
          const v = l[f];
          if (v !== undefined) decl[f] = v;
        }
        // `viaSide` 的缺省态必须**显式**下发：编辑器把它拼进 `${viaSide}:${viaProperty}` 当预填值，
        // 缺席会拼出 `undefined:...`。仅在声明了 viaProperty 时补默认（与修前逐字节同行为）。
        if (l.viaProperty !== undefined && decl.viaSide === undefined) decl.viaSide = "from" as const;
        return {
          key: l.key,
          fromType: l.fromTypeKey,
          toType: l.toTypeKey,
          cardinality: l.cardinality,
          ...decl,
        };
      })
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    rules: rules
      .map((r) => ({ key: r.key, expression: r.expression, scope: (r.scopeObjectTypes ?? []).join("、") || "全局", severity: sevLabel[r.severity] ?? r.severity }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    actions: ACTION_TYPE_REG,
    events: EVENT_TYPE_REG,
  };
}
