/** 中文文案集中地（预留 i18n 结构，不做翻译） */
// DF.13：文案里出现的业务阈值百分数一律由 @platform/contracts 单一来源格式化（R14 应用层无业务常数）。
import { OUTSOURCE_REDLINE, outsourceRedlinePct } from "@platform/contracts";

export const zh = {
  common: {
    appName: "全域数字化智能决策支撑系统",
    loading: "加载中…",
    save: "保存",
    cancel: "取消",
    confirm: "确认",
    create: "新建",
    edit: "编辑",
    delete: "删除",
    publish: "发布",
    retire: "退役",
    search: "搜索",
    copy: "复制",
    copied: "已复制",
    close: "关闭",
    back: "返回",
    none: "暂无数据",
    submit: "提交",
    refresh: "刷新",
    requestId: "请求 ID",
    yes: "是",
    no: "否",
  },
  object360: {
    properties: "属性",
    relations: "关系",
    footprint: "足迹",
    searchPlaceholder: "全局搜索对象…",
  },
  home: {
    fallbackTenant: "全域决策支撑",
    hint: "一键启动高频场景直达推演，或进入业务视图。按 ⌘K 随处快搜场景。",
    hotScenarios: "⚡ 高频场景",
    businessViews: "业务视图",
    allScenarios: "⚡ 全部场景启动器 →",
    writebackBadge: "写回",
  },
  launcher: {
    title: "场景启动器",
    paletteTitle: "⌘K · 场景命令面板",
    searchAria: "搜索场景",
    searchPlaceholder: "搜场景名 / 触发问句…",
  },
  login: {
    title: "登录",
    tenant: "租户",
    username: "用户名",
    password: "密码",
    submit: "登录",
    failed: "登录失败，请检查账号与密码",
  },
  nav: {
    businessGroup: "业务视图",
    adminGroup: "管理台",
    logout: "退出登录",
    switchAccount: "切换账号",
    connections: "连接器与上传",
    ruleDocs: "规则文档审核",
    modeling: "本体建模",
    objectTypes: "对象/类型浏览",
    rules: "规则库",
    permissions: "权限策略",
    synthetic: "合成数据",
    dataBuilder: "数据构建发动机",
    pipelines: "构建 Pipeline 配置",
    actions: "Action 审批",
    catalog: "意图目录",
    agents: "Agent",
    workflows: "Workflow",
    skills: "Skill 库",
    mcp: "MCP",
    scenes: "场景入口",
    opsFallback: "兜底统计",
    opsSchedule: "运营自动化",
    // WO-BEFE-B · 两个新管理页
    scheduler: "定时任务",
    calendars: "工厂日历",
    features: "功能开通",
    calibration: "校准报告",
    tenants: "租户管理",
    users: "用户管理",
    views: "视图配置",
    llmProviders: "LLM Provider",
    externalSignals: "外部信号",
    validation: "闭环验证(VLE)",
    quarantine: "隔离区",
    notifications: "通知中心",
    domains: "域管理",
    // WO-BEFE-A · 本体关系编辑器（结构边 + 因果边 + 发布会签）。
    ontologyRelations: "本体关系",
    evals: "Agent 评测",
    slices: "本体切片",
    sliceLibrary: "切片库",
    merge: "实体合并",
    growth: "自成长发动机",
    solverReview: "求解器审核台",
    solvers: "求解器目录",
    configMigration: "配置迁移",
    resources: "智能资源治理",
    planBuilder: "计划构建画布",
  },
  errors: {
    notFoundTitle: "页面不存在",
    notFoundDesc: "该功能不存在或未开通",
    forbiddenTitle: "无权访问",
    forbiddenDesc: "你没有访问该页面的权限",
    unsupportedView: "该视图类型暂不支持",
    pageError: "页面出错了",
    featureClosed: "该功能已被管理员关闭",
  },
  /**
   * 求解器**作用域诚实位**（欠账 #178 · `components/ScopeHonestyBadge.tsx`）。
   *
   * ⚠ 这里只放**短标签**（第一层那枚徽标上的字）。说明正文一律**取后端原文**，不在此另写一份 ——
   * 措辞是引擎侧的单一来源（`solvers/risk.ts:776-777` / `capacity.ts:443-444` /
   * `extended.ts:975` / `capex.ts:201-203`），前端另写一句必然与引擎口径漂移，
   * 那正是本欠账要治的病。
   *
   * 措辞判据（三态不许混·混了用户会去修错地方）：说的是「**没按这个实参重算**」，
   * **不是**「没有数据」——后者会把人引去补数据，而真正要补的是过滤维/挂载点。
   */
  scopeHonesty: {
    /** 真按实参重算：报出算的是谁即可，中性陈述、不是警告。 */
    scoped: (to: string) => (to ? `仅 ${to} · 已按此范围重算` : "已按所选范围重算"),
    /** 该维未限定 ⇒ 数是全域合计。用户最容易把它读成局部答案，故第一层必须直说。 */
    global: "全域口径 · 非所选范围",
    /** 实参给了却没参与计算（只当标签回显 / 该维数据层没有）—— 三档里最危险的一档。 */
    unapplied: "该范围实参未参与计算",
    popoverTopic: "作用域口径",
    fieldHint: (field: string) => `诚实位字段：${field}（求解器随结果下发）`,

    /* ══ 以下为 WO-R1 从 `claude/integ-ui-w5` 收编（2026-08-13）══════════════════
     * ⚠ **这些键必须并进上面这一个 `scopeHonesty` 块，绝不许另起第二个块。**
     * 实测（收编当日亲手数的）：canonical 这一块 5 个键、`integ-ui-w5` 那一块 19 个键，
     * **两边键名交集为 0**。JS 对象字面量里同名键后者静默覆盖前者，而 `git` 对这种
     * 「两个 `scopeHonesty:` 各在文件不同位置」的合并**零冲突、全自动**——
     * 于是 `scoped`/`global`/`unapplied`/`popoverTopic`/`fieldHint` 会在编译期毫无征兆地整组消失，
     * `ScopeHonestyBadge` 当场渲 `undefined`。复验命令（收编后应恒为 1）：
     *   `grep -c 'scopeHonesty: {' apps/frontend-shell/src/locales/zh.ts`
     * 服务对象是 `views/ScopeHonesty.tsx` 的 `KitScopeBar` / `QuoteScopeBar` ——
     * 它们补的是 `solverScopeHonesty.ts` 头注**指名拒收**的两个命题（抽样两数 · 报价两维）。
     * ⚠ 原 w5 块里的 `baseIdLabel` / `baseNameMissing` **未收编**：那两个只服务于被裁掉的
     * `RiskScopeBar`（理由见 `views/ScopeHonesty.tsx` 文件头「收编裁决」）。
     * ═══════════════════════════════════════════════════════════════════════ */
    title: "本次口径",
    /** 后端**没下发**诚实位 —— 与「说了是全网」是两件事，必须分开显示。 */
    unstated: "作用域未标注",
    noNote: "后端未回传该项口径说明（诚实缺席，非「无口径」）",
    whyItMatters:
      "为什么这一行必须存在：「没说算的是谁」与「说了是全网」在屏上一模一样时，" +
      "问某个基地却返回全网结果就完全看不出来 —— 那正是当初把它判为「静默错答」而非「报错」的直接原因。",

    // ── kit_readiness 抽样（这两个数改变 shortageCount 的读法，故在第一层）──
    kitTopic: "齐套口径与抽样",
    sampling: (pool: number | undefined, sampled: number | undefined) =>
      `订单池 ${pool ?? "—"} 张 · 本次分析 ${sampled ?? "—"} 张`,
    networkTotal: (n: number) => `全网订单总量 ${n} 张（本口径由此收窄而来）`,
    shortageReading: (shortage: number | undefined, sampled: number | undefined, pool: number | undefined) =>
      shortage === undefined
        ? "缺料单数：后端未回传"
        : sampled === undefined
          ? `缺料 ${shortage} 张（后端未回传本次分析量，无法判断这是不是全部）`
          : sampled < (pool ?? sampled)
            ? `缺料 ${shortage} 张 = 本次分析的 ${sampled} 张里有 ${shortage} 张缺料；订单池共 ${pool} 张，未分析的 ${(pool ?? 0) - sampled} 张不在此数内`
            : `缺料 ${shortage} 张 = 该口径下 ${sampled} 张全部分析后的结果（无截断）`,

    // ── quote_margin 两维（定性不同，不许合成一句）──
    quoteModelTitle: "型号维",
    quoteCustTitle: "客户维",
    modelApplied: (modelId: string) => `已生效 · ${modelId}`,
    modelAll: "未指定型号（非任何具体型号的配方）",
    /** ⚠ 客户维今天是**诚实标注**、不是真算 —— 第一层就得写「不生效」，不许画成算过的样子。 */
    custNotApplied: (custName: string) => (custName ? `${custName} · 不生效（NOT_APPLIED）` : "不生效（NOT_APPLIED）"),
    custApplied: (custName: string) => `已生效 · ${custName}`,
    missingTitle: "要真按这一维算，缺这些源：",
  },
  dock: {
    placeholder: "输入问题，回车提交…",
    expand: "展开对话",
    collapse: "收起",
    running: "仍在执行…",
    exploreMode: "探索模式",
    verifiedBadge: "已验证 · 工作流",
    exploratoryBadge: "探索 · AI",
    // WO-REAL-LLM-FREE-QUERY 诚实三态之三：path-B 真 LLM 深问（据页/块上下文·工具取证）——绝不标"数据库事实"。
    llmReasoningBadge: "真 LLM 推理 · 据页/块上下文工具取证",
    unverifiedStrip: "部分数字未能溯源，仅供参考",
    clarifyNone: "都不是",
    clarifyRound: (n: number) => `第 ${n}/2 次确认`,
    viewTask: "查看完整执行过程",
    pendingApproval: "待审批",
    gotoActions: "前往审批台",
    feedbackUp: "有帮助",
    feedbackDown: "没帮助",
    feedbackDone: "已记录反馈",
    failed: "任务失败",
    cancelled: "任务已取消",
    // CL.7 对话坞缺口卡（in-dialog gap-fill）
    gapTitle: "信息不足 · 缺口",
    gapTrigger: "▶ 触发生成缺失数据",
    gapTriggering: "正在生成…",
    gapFilled: "✓ 已补齐数据",
    gapContinue: "继续推演 →",
    gapUnreachable: (code: string) => `不可达：断在 ${code}（需开发/人工补）`,
    gapTicket: "查看成长工单 →",
    routedWorkflow: (name: string) => `命中工作流 · ${name}`,
    /** WO-FE-AGENT-TRACE：agent loop 轮次（后端 agent/loop.ts:848 的 iteration·0 基 → 展示 +1） */
    iterationChip: (n: number) => `第 ${n + 1} 轮`,
    blockedByRule: "被规则拦截",
  },
  prov: {
    valueSection: "值与口径",
    sourceSection: "来源",
    computeSection: "计算",
    ruleSection: "规则",
    tsAggText: (start: string, end: string, rows: number, agg: string, spec: string) =>
      `来自 ${start}~${end} 共 ${rows.toLocaleString()} 条实绩 · ${agg} · 规约 ${spec}`,
    trend: "聚合趋势",
    noRule: "无命中规则",
  },
  task: {
    title: "查询任务详情",
    classification: "分类结果",
    steps: "执行步骤",
    answer: "回答",
    toolAudit: "工具调用审计",
    events: "事件回放",
  },
  graph: {
    inspectorProps: "属性清单",
    inspectorSources: "源系统",
    inspectorRules: "适用规则",
    inspectorDerived: "派生公式",
    legend: "图例（按领域过滤）",
    legendSource: "图例（按源系统着色）",
    tooManyNodes: "节点数超过 300，已降级为静态布局",
    mappingButton: "映射表",
    mvpGap: "⊕ 缺口节点（需从源系统补采）",
    calibrationLink: "查看精度趋势与校准历史 →",
  },
  /** §7.20 业务建模映射表 */
  mapping: {
    title: "业务建模映射表",
    colObject: "对象",
    colKind: "类型",
    colSource: "源系统",
    colProps: "关键属性",
    colRules: "适用规则",
    colDerivations: "派生公式",
    colLineage: "血缘",
    exportCsv: "导出 CSV",
    exportHtml: "导出 HTML",
    footnote: "所有数字派生自同一本体",
    // PRD-IND-map §4.4：四注册表段
    regLinkTypes: "关系类型注册表",
    regColLink: "关系", regColFrom: "从", regColTo: "到", regColCard: "基数",
    regRules: "规则注册表",
    regColRule: "规则", regColExpr: "表达式", regColScope: "作用域", regColSev: "级别",
    regActions: "Action 类型注册表",
    regColAct: "动作", regColParams: "参数", regColCheck: "校验", regColTarget: "目标", regColPerm: "权限",
    regEvents: "事件对象表",
    regColEvent: "事件", regColWindow: "窗口", regColAffects: "影响", regColSrc: "来源",
    exportedAt: (ts: string) => `导出时间：${ts}`,
    lineageText: (conn: string, dataset: string, n: number) => `${conn} · ${dataset} · ${n} 字段`,
    locateHint: "点击行：关闭弹层并在图谱中定位该节点",
  },
  /** §7.14 年度规划 */
  aop: {
    title: (year: number) => `年度规划 · AOP ${year}`,
    demandUnit: "万套/年",
    capacityDecision: "产能决策",
    ltaLock: "长协锁量",
    finance: "财务测算",
    projectFinance: "项目测算（C1）",
    ruleChecks: "规则校验",
    financeText: (rev: number, capex: number, irr: number) =>
      `收入 ${rev.toLocaleString("zh-CN")} 亿 · CAPEX ${capex} 亿${irr > 0 ? ` · IRR ${(irr * 100).toFixed(0)}%` : ""}`,
    finalizedChip: "已拍板 AOP",
    finalizeBtn: "拍板情景",
    finalizeDone: "已生成 Action 草稿（AOP情景拍板）并进入审批流",
    triggerSection: "情景触发条件 · 挂牌监测",
    triggerHint: "条件满足 → 自动升级情景并通知投资委员会（后端规则扫描，前端只读）",
    trgCond: "触发条件",
    trgAction: "升级动作",
    trgState: "监测状态",
    monitoring: "⏳ 监测中",
    triggered: "✓ 已触发",
    triggeredAt: (ts: string) => `触发时间 ${ts}`,
    notified: (who: string) => `已通知：${who}`,
    decompSection: "目标分解流（年 → 季 → 月）",
    decompBaseline: (demand: number) => `基准情景 ${demand.toLocaleString("zh-CN")} 万套`,
    decompFootnote: "分解值 = S&OP 平衡台目标线（同源勾稽）",
    decompProv: (ref: string) => `同源目标对象：${ref}（= S&OP 平衡台目标线）`,
    compareChip: (n: number) => `三情景对比 · ${n} 情景`,
    windowSection: "缺口 / 过剩窗口曲线",
    windowHint: (scen: string) => `${scen}情景：季度需求曲线 vs 产能供给（capex_scenario 活算）→ 缺口/过剩窗口标段`,
    wcDemand: "需求",
    wcSupply: "供给",
    wcGap: "缺口",
    wcGapWin: (from: string, to: string) => `缺口窗口 ${from}→${to}`,
    wcSurplusWin: (from: string, to: string) => `过剩窗口 ${from}→${to}`,
    // WO-UNIT-MEANING：窗口曲线纵轴量纲。数量单位由调用方从 demandUnit 派生传入（唯一来源），
    // 此处只拼粒度（季）——契约无 unit 字段可消费，故量纲落在前端唯一常量上。
    wcAxisName: (qtyUnit: string) => `${qtyUnit}/季`,
    wcAxisCaption: (axis: string) => `纵轴：${axis}（需求 / 供给 / 缺口三序列同尺 · 年需求按季节权重卷积到季）`,
  },
  /** §7.15 季度规划 */
  dash: {
    // PRD-IND-dash §2.3/§2.5/§2.6
    problemsTitle: (n: number) => `🧩 待解决的问题（${n}）· 全部订单根源归并`,
    problemsSub: (orders: number, n: number) => `自下而上：${orders} 单逐单归因 → 汇成 ${n} 类问题清单`,
    feedbackTitle: "回采校准 · 逐级反馈链（实际 → 月度 → 季度 → 年度）",
    modulesTitle: "模块直达（点击进入）",
    problemDrill: "点击查看该问题的订单全链与逐单根因",
    ledgerAll: "全部",
    ledgerGm: "综合毛利率",
    ledgerDrill: "点击下钻该单的订单全链与逐单根因 DAG",
    // 假5 修：综合毛利率为估算口径（SEG_REGISTRY 参考单价/毛利率派生·非 metric_rollup 财务实测）。
    ledgerGmNote:
      "综合毛利率为估算：Σ(数量 × SEG 参考单价 × SEG 参考毛利率) ÷ Σ营收（SEG_REGISTRY 单一来源 · 缺数诚实 0 · 非 metric_rollup 财务实测值）。",
    drillLevels: { op: "运营", month: "月度", quarter: "季度", year: "年度" } as Record<string, string>,
    drillEmpty: (lvl: string) => `${lvl}层暂无经营指标（需合成该层 Metric）`,
    drillToGenerate: "去建议",
    drillToAudit: "去体检",
    exportLabel: "导出 CSV",
    exportTitleRow: "经营驾驶舱导出",
    exportMetricHeader: ["经营指标", "目标", "实际", "偏差", "越线"] as const,
    exportProblemHeader: ["待解决的问题", "影响单数", "财务影响(亿)"] as const,
  },
  quarter: {
    title: "季度规划",
    sub: "4–6 季滚动 · 需求 vs 供给 · 承接年度分解、向月度再分解",
    demand: "需求",
    supply: "供给",
    rampNote: "产能增量项目按年度基准情景投产时点入季（与 AOP/capex_scenario 同源勾稽）；缺口三档 >4 红 / >0 黄 / ≤0 绿。",
    gap: (v: number) => `缺 ${v}`,
    surplus: (v: number) => `冗余 ${v}`,
    ltaSection: "长协执行偏差 · 本季",
    ltaHint: "SRM/长协 vs WMS 实际到货 · 偏差>±5% 升级供应风险",
    ltaMaterial: "物料",
    ltaPlanned: "长协计划",
    ltaActual: "实际到货",
    ltaDev: "执行偏差",
    ltaNote: "说明",
    escalate: "升级供应风险",
    gotoRisk: "查看风险看板 →",
    // PRD-IND-quarter §4.5(F)：LTA 脚注去硬编码（迁 i18n，R14）；与风险看板「到货间隙」+ S&OP 第⑤步决议同源。
    ltaFootnote: "正极 −8.0% 偏差与预警大屏「到货间隙」事件同源；已在月度 S&OP 第⑤步决议加急 200 吨对冲。",
  },
  /**
   * WO-ORDER-JOURNEY · 决策推演面板（页面壳与各处就地嵌入**共用同一份实现**）。
   * 改这里一处文案 ⇒ 壳页与嵌入处同时变 —— 接缝测试两处一起断言，这就是「同一份实现」的可核判据。
   */
  decisionPlay: {
    implStamp: "决策推演 · 页面壳与就地嵌入共用同一份实现",
    embedSummary: "查看方案对比 ▸",
  },
  /**
   * §7.16 订单进展与卡因（WO-ORDER-JOURNEY 前名「订单全链聚合」）。
   * 改名理由：旧名只说「把全链聚合起来」= 典型传统 BI（只展示发生了什么）。
   * 本页现在同屏给三件事 —— 走到哪了（地铁线路图逐站）· 卡在什么上（阻滞点/根因）· 拿它怎么办（就地推演）。
   * 仓主原提「订单状态」，但「状态」是快照名词，既不含"进展到哪一站"，也不含"因为什么卡"，
   * 而这两维正是本页新增的主体，故取「订单进展与卡因」。
   * ⚠ renderer key 仍是 `order-chain`（那是路由契约，改了会连坐后端 VIEW_DEFS / features / mock 三处）。
   */
  orderChain: {
    title: "订单进展与卡因",
    baseFilter: "基地筛选",
    allBases: (n: number) => `全部风险基地（${n}）`,
    clearFilter: (b: string) => `✕ 清除（当前：${b}）`,
    sumOrders: "涉及订单数",
    sumQty: "合计套",
    sumCusts: "客户数",
    sumRevenue: "涉及收入(亿)",
    // PRD-IND-order-aggregate §4.5-A：经营数据看板 econTable
    econSection: "经营数据看板（套 · 亿元）",
    byApp: "按应用细分",
    byBase: "按风险基地",
    colBase: "基地",
    econCap: "未结产能(套)",
    econFg: "成品库存(亿)",
    econWip: "在制(亿)",
    econRm: "原料(亿)",
    econSales: "未结营收(亿)",
    econGp: "毛利(亿)",
    econGmRate: "毛利率",
    econTotal: "合计",
    // WO-SCOPE-HONESTY-FE ②③：齐套 / 报价毛利的作用域诚实位消费面（结构标签；口径原文一律来自回包）。
    scopeSection: "齐套与报价 · 这次算的是谁",
    kitTitle: "齐套（kit_readiness）",
    kitShortageLabel: "张缺料单（读法见下行）",
    quoteTitle: "报价毛利（quote_margin）",
    quoteMarginLabel: "毛利率",
    quoteModelSel: "型号",
    quoteCustSel: "客户",
    quoteModelAny: "不指定型号",
    quoteCustAny: "不指定客户",
    detailSection: "受影响订单 · 明细",
    colOrder: "订单",
    colCust: "客户",
    colSeg: "应用",
    colModel: "型号",
    colQty: "数量",
    colDue: "交期",
    colRisks: "关联风险点（基地·因素·越线日）",
    colDelay: "延误",
    delayDays: (d: number) => `${d} 天`,
    caliber: "聚合口径：订单分配至风险基地，且交期落入该风险点越线窗口 [T−7, T+14]；同一订单可关联多个风险点，延误取最大估计。",
    problemSection: "待解决问题（4 类归并）",
    problemOrders: (n: number) => `${n} 单受影响`,
    problemFinance: (v: number) => `财务贡献 ${v.toFixed(1)} 亿`,
    dagTitle: "逐单根因链（订单 → 判定 → 根因 → 对策）",
    // 假3 修：库存列平台无真源 → 诚实"—"（抄 OrderAggView）；营收/毛利经 SEG_REGISTRY 参考价勾稽（可溯·非逐单实际成交价）。
    econNoSource: "平台暂无该维度库存真数据源",
    econFootnote:
      "未结营收/毛利/毛利率经 affected_orders 真订单 × SEG_REGISTRY 参考单价/毛利率聚合派生（R13 可溯 · R6 单一真相源 · SEG 参考价非逐单实际成交价，属估算口径）；成品/在制/原料库存平台暂无该维度真数据源 → 诚实“—”（不伪造 · G-DM-1）。",

    // ── WO-ORDER-ROW-DETAIL ① 行内展开订单详情（点行 → 本行**紧邻下方**展开，非浮层非跳页）──
    colCtx: "对话",
    rowHint: "点订单行展开详情",
    rowDetailTitle: (so: string) => `${so} · 订单详情`,
    rowDetailDue: "交期（完整日期）",
    rowDetailRisksTitle: (n: number) => `关联风险点全量（${n} 条 · 不截断）`,
    rowRiskBase: "基地",
    rowRiskFactor: "因素",
    rowRiskCross: "越线日",
    rowRiskPeak: "峰值",
    rowRiskThreshold: "越线阈值",
    rowRiskSeries: "逐日序列",
    rowRiskNotCrossed: "窗口内不越线",
    rowRiskSeriesDays: (n: number) => `${n} 天`,
    rowRiskNoField: "响应未带回该字段",
    rowRevenueLabel: "本单营收暴露（估算）",
    // 诚实缺数披露（R14）：说清 affected_orders.rows[] 这一层到底带回了什么、没带回什么。
    rowDetailGap:
      "缺数诚实披露：affected_orders.rows[] 仅带回 订单/客户/应用/型号/数量/交期/延误/风险点 八个字段；逐单实际成交价、逐单毛利、齐套缺口、信用占用均不在本求解器输出内 → 详情不臆造、不另调接口（R14）。",

    // ── WO-ORDER-ROW-DETAIL ② 对话上下文（原 toggleSelectedObject 链保留，改为显式入口 + 可见选中态）──
    ctxAdd: "＋ 加入对话",
    ctxRemove: "✓ 已进入对话上下文",
    ctxInBadge: "已进入对话上下文",
    ctxHint: "把该订单写入对话上下文（selectedObjects），供追问时带上",

    // ── 追加需求 · 问题卡归因叙述（派生自 problems[]，每句绑定字段；零写死 R14）──
    narrTitle: "归因分析（叙述）",
    narrScale: (cat: string, title: string, n: number, fin: string) =>
      `【${cat}】${title}：归并 ${n} 单受影响，财务贡献 ${fin} 亿。`,
    narrCommon: (s: string) => `共性根因：${s}`,
    narrChain: (order: string, judge: string, cause: string, remedy: string) =>
      `${order}：判定「${judge}」← 根因「${cause}」→ 对策「${remedy}」。`,
    narrCoverage: (m: number, n: number) => `逐单因果链覆盖 ${m}/${n} 单。`,
    narrScopeNote:
      "口径披露：problems[] 按问题类别归并，契约 schema 不带基地/因素维 → 本叙述不做基地归因（不假装有基地维）。",
    narrGapTitle: "推不出的部分（诚实披露）",
    narrGapNoChains: "problems[].rootChains 为空 —— 该响应未带回逐单因果链，无法给出逐单归因叙述。",
    narrGapNoSummary: "problems[].rootCauseSummary 为空 —— 无共性根因可述。",
    narrGapLayer: (order: string, kinds: string) => `${order}：layers 缺「${kinds}」层 —— 该跳因果推不出。`,
    narrGapPartial: (miss: number, n: number) =>
      `另 ${miss}/${n} 单未随响应带回 rootChains —— 这 ${miss} 单的归因推不出（不编）。`,
    narrDagTitle: "同一份因果链的图形视图",
    narrProvSrc: "affected_orders 求解器 · problems[]（与本卡同源，未另调接口）",
  },
  /** §7.17 地理视图 */
  geo: {
    title: "基地地理视图",
    legendTitle: "定位（颜色）· GWh（大小）",
    overseas: "海外基地",
    cardLines: "产线数",
    cardGwh: "产能 (GWh)",
    cardYear: "投产年",
    cardProduct: "主产品",
    cardUtil: "利用率",
    cardBottleneck: "当前瓶颈",
    gotoRisk: "查看风险",
    gotoGraph: "图谱中查看",
  },
  /** §7.19 任务编排 DAG */
  taskDag: {
    section: "编排推演 DAG",
    intent: "意图解析",
    slots: "槽位",
    answer: "回答",
    classify: "意图分类",
    finalAnswer: "final_answer",
    noClarify: "无需澄清",
    clarifyRounds: (n: number) => `澄清 ${n} 轮`,
    outOfCatalog: "OUT_OF_CATALOG",
    failed: "失败",
    clickHint: "点击节点定位事件回放行",
  },
  /** §7.21 校准报告 */
  calib: {
    title: "校准报告（精度趋势 · 提案 · 历史）",
    filterObjectType: "对象类型",
    filterBase: "基地",
    filterSolver: "求解器",
    all: "全部",
    trendSection: "MAPE 精度趋势",
    thresholdLine: (pct: number) => `C12 阈值线 ${pct}%`,
    triggerMark: (date: string, rule: string) => `▲ ${date} ${rule} 触发`,
    proposalSection: "参数更新提案",
    colParam: "参数",
    colChange: "当前值 → 建议值",
    colBasis: "依据",
    colStatus: "状态",
    basisText: (from: string, to: string, n: number) => `偏差窗口 ${from} ~ ${to} · 样本 ${n}`,
    approve: "批准",
    rollback: "回滚",
    draftCreated: "已生成审批草稿（校准参数变更）",
    gotoActions: "前往审批台",
    historySection: "校准历史",
    historyLine: (trigger: string, params: string) => `触发：${trigger} · 变更参数：${params}`,
    mapeChange: (before: number, after: number) => `MAPE ${before.toFixed(1)}% → ${after.toFixed(1)}%`,
  },
  /** §7.22 数据健康度（文案同源：连接器页 / 顶栏徽章 / 推演降级说明共用） */
  health: {
    column: "健康度",
    summaryTitle: "数据健康度汇总",
    freshness: "新鲜度",
    threshold: "延迟阈值",
    statusOk: "正常",
    statusDelayed: "延迟",
    statusDown: "中断",
    degradeImpact: "降级影响",
    /** C09 降级说明（与 capacity_forecast degradeNote 同一来源） */
    degradeNote: (latencyH: string, from: string, to: string) =>
      `C09 数据健康度降级：关键数据源 IoT/SCADA 新鲜度延迟 ${latencyH}h（>2h），P90 系数 ${from} → ${to}`,
    affectedSolvers: (list: string) => `受影响求解器：${list}`,
    badgeTitle: "数据源健康度",
    gotoConnections: "前往连接器控制台 →",
    minutesAgo: (m: number) => `${m} 分钟前`,
  },
  risk: {
    peak: "峰值",
    crossDay: "越线日",
    legendHigh: "越线（≥阈值，高危）",
    legendMid: "临近（阈值−15，预警）",
    legendLow: "正常",
    primaryTag: "⚠ 首要风险",
    noCross: "未越线",
    // PRD-IND-risk §2.4：处置行动计划表
    planTitle: "产能风险处置 · 最终方案与行动计划",
    planSub: (n: number) => `按越线日前置 7 天排启动时间 · ${n} 行 · 峰值≥90 配备份方案`,
    planAct: "行动项",
    planDet: "详情",
    planOwner: "责任人",
    planStart: "启动",
    planDone: "完成",
    planEff: "预期",
    planRule: "规则",
    // WO-LIVE-DISPOSITION：处置表活推演化（生成/重算按钮 + 每行可点开看推导过程）。R14 文案下发·前端不内联业务常数。
    plan: {
      regen: "⚙ 生成/重算行动计划",
      regenHint: "吃当前杠杆推演态实时重算（真缺口三杠杆贪心派生·非配置库选方案）",
      regenBusy: "重算中…",
      baseline: "基线方案（未含杠杆调整）",
      withLevers: (n: number) => `含 ${n} 项杠杆推演`,
      rowHint: "点任意行看该行动如何推演出来",
      detailTitle: "推导过程",
      detailSub: (base: string, shortfall: number, residual: number) =>
        `${base} · 触发缺口 ${shortfall} 套 · 三杠杆贪心收窄 · 残留 ${residual} 套`,
      stepNo: (i: number) => `第 ${i} 步`,
      trigger: "触发值",
      closes: "收窄",
      noSteps: "该行无真缺口推导（窗内可用产能覆盖需求）——方案取自处置方案库参照名，非派生动作。",
      conserve: (sum: number, residual: number, shortfall: number) =>
        `守恒校验：Σ 收窄 ${sum} + 残留 ${residual} = 触发缺口 ${shortfall}`,
      close: "收起",
    },
    affectedOrders: "受影响订单",
    dailyStrip: "逐日张力",
    // WO-HOVER-LAYER（欠账 #104/#175 同族）：峰值的**口径**此前只挂在原生 `title=` 上 ——
    // 浏览器 tooltip 延迟约 1 秒才出、触屏根本不出、不能选中复制，且这里的宿主本身
    // 已经是个浮层（RiskPopover 走 portal），浮层里再套原生 tooltip 等于没做。
    // 改为浮层里的**可见文字**：口径必须能被读到，不能藏在属性里。
    peakCaliber: (min: number, max: number, hint: string) =>
      `峰值口径：${min}–${max} 紧张度指数（${hint}）·非该因素本身的值`,
    /** 逐日格的可访问名（读屏可达；视觉靠色块 + 下方图例给量程）。 */
    dayCellAria: (day: number, v: string) => `D+${day} · ${v}`,
    /**
     * WO-UI-DECLUTTER-TOP3 · 浮层文案（`docs/CONVENTION-ui-information-layering.md` §1）。
     * 第一层只留「数值 / 状态 / 名字」，**口径 · 公式 · 为什么这么算 · 数据来源**一律降进 `?` 浮层；
     * 文案走 locales（本体 R14：应用层不内联业务文案），不写死在组件里。
     */
    info: {
      bridge: "这一页在回答什么",
      bridgeBody:
        "计划-执行之桥：监测执行偏离月度计划的风险。窗口内预测越线（紧张度 ≥ 阈值）即出卡；偏离 → 处置 Action 或反提月度差异（C21）。",
      tightness: "紧张度口径",
      tightnessBody: (min: number, max: number, hint: string) =>
        `chip 上的数字是该风险因素的紧张度（${min}–${max}·${hint}），不是该指标本身的值。例：「设备OEE 76」= 设备OEE 这一项的张力 76/100，不是 OEE=76%。`,
      caliber: "受影响订单口径差",
      caliberBody:
        "本表 = 窗口内交期、且落在任一基地风险窗内的订单（覆盖全部基地）；顶部 KPI「受影响订单」只统计上方展示的那几张风险卡，覆盖面更窄，数值可能略少。",
      econSource: "经营数据取数来源",
      econSourceBody:
        "未结订单金额 / 毛利额 / 毛利率经 affected_orders 真订单 × SEG_REGISTRY 单价勾稽真聚合（R13 可溯 · R6 单一真相源）；产能 / 库存列平台暂无该维度真数据源 → 诚实「—」（不伪造 · G-DM-1）。",
      econNoSource: "平台暂无该维度真数据源，诚实留「—」，不伪造",
      rootcause: "根因树怎么来的",
      rootcauseBody:
        "为什么越线：结构反向归因（设备 / 物料 / 订单）→ caused_by 溯终点根因，每个节点可下钻真对象（R13）。数据源 gap_attribution 真求解器，按基地结构反向分摊、叶级下钻真对象字段。",
      rootcauseDiag: "诊断详情（响应字段 · 排查下一步）",
      score: "综合评分口径",
      scoreBody:
        "综合评分 = 见效 × 紧迫度 ÷（投入档 × 周期）。下表按评分降序排列，最高者即推荐方案。「预期堵口」一列的见效值源自 mitigation_select.eff（求解器回传，非前端估算）。",
      adoptGate: "采纳之后会发生什么",
      adoptGateBody: "采纳经 adopt_mitigation 生成 Action 草稿 → 审批后下发工单（C5 门不绕 · 前端不直改计划）。",
      planRow: "这张表怎么读",
      planRowBody: "按越线日前置排启动时间。点任意行可看该行动如何推演出来（逐 step 推导 + provenance）。",
      qa: "这个问答框的边界",
    },
    // WO-CAPLIVE-2 · 产能推演「活台」：原子因子活推演 / 因子级根因 / 人机对话 / 方案存比（R14 下发·不内联）。
    live: {
      leverTitle: "原子因子活推演（拨动即 generic_inference 真重算）",
      leverHint: "从本基地瓶颈反推的原子影响因子（细到工序×型号-物料），拖动经 generic_inference 沿派生 DAG 真重算——before/after + tornado 敏感度 + 每值溯源 + C08 边界。",
      // WO-CAPACITY-PAGE-100PCT ⑩（R8 量纲错标）：本页传给面板的 before 值是 `card.peak`＝**峰值张力（0–100 指数）**，
      // 却被标成"可用产能"——屏幕上出现「调整前可用产能 98.0」这种量纲错到底的数字。改为按其真实口径标注。
      leverBefore: "调整前峰值张力（0–100）",
      // WO-FACTOR-SCOPE-SINGLESOURCE：chip 显示用 label、传值用 CausalFactor.factorId；
      // 候选集来自引擎回执 scope.availableFactors（单一来源）。文案一律走本表，不内联到组件里。
      rootcause: {
        scopeTitle: "因子作用域",
        allFactors: "全部因子（基地级）",
        pick: (f: string) => `按「${f}」细分`,
        /** chip 悬停：这个因子细分后会下钻到哪类对象的哪个字段、本基地有几个（诚实可核）。 */
        chipTitle: (label: string, drillType: string, drillField: string, n: number) =>
          `按「${label}」细分 → 下钻本基地 ${drillType}.${drillField}（当前 ${n} 个对象）`,
        refined: (f: string) => `已按因子「${f}」细分（gap_attribution scope.factorId·细分层为占比层·结构分摊 L1/L2 不变）`,
        /** 第一层只留这一句可见记号；完整口径降进 `?` 浮层（WO-UI-DECLUTTER-TOP3·D4 守恒：降层不删除）。 */
        baseAggregatedShort: "按基地聚合 · 未按因子细分",
        baseAggregated: (f: string) =>
          `结构+因果根因源自 gap_attribution 真求解器（按基地结构反向分摊·叶级下钻真对象字段）。注：当前按基地聚合根因，未按具体越线因子（${f}）细分——点上方因子 chip 即按因子细分。`,
        /** 件三：一个可细分因子都没有时据实说，而不是画一排点不动的按钮。 */
        noneAvailable: "本基地当前无可细分因子（引擎未在本基地解析到任何因子的承载对象）。",
        /** 件四：引擎明说没细分时的告警条（用户不可能忽略的形态·非树底一行小字）。 */
        notRefinedTitle: "⚠ 未按该因子细分",
        notRefinedFallback: (f: string) => `引擎未按因子「${f}」细分，下方仍是本基地的聚合根因树。`,
        backToBase: "回到基地级",
      },
      dialog: {
        title: "人机对话 · 真 NL（orchestrator 路由）",
        sub: "问因子 / 问根因 / 给任意变量推演——经 orchestrator 识别产能 what-if 意图，路由 generic_inference / gap_attribution / capacity_forecast，叙述带溯源。",
        placeholder: "输入问题，如：化成良率降到 92% 产能少多少？",
        ask: "问",
        empty: "点击预设问题或输入追问。答案经 orchestrator 真路由求解器、带溯源（非正则假 NL）。",
        presets: (base: string) => [`${base}化成良率降到 92% 产能少多少？`, `哪个工序物料最卡 4680？`, `${base}为什么越线？`],
      },
      scenario: {
        title: "方案存 / 分支 / 横比（decision_play 范式）",
        hint: "把一次拨动结果存为命名方案、分支出变体、多方案横比矩阵——各格经 generic_inference 真算·可溯，一键采纳走 Action 审批（C5 门不绕）。",
        namePh: "方案名，如：化成扩通道",
        save: "存为当前推演方案",
        saveEmpty: "先拨动杠杆产生推演态再存方案",
        branch: "分支",
        compare: "横比选中方案",
        pickHint: "勾选 ≥2 个方案横比",
        col: { scheme: "方案", pick: "选" },
        capGain: "产能增益",
        cost: "外协代价",
        ruleFlag: "触规则闸",
        adopt: "采纳→Action",
        adopted: "采纳草稿已创建·待审批（C5 门不绕·非直改）",
        empty: "尚无保存的方案。拨动杠杆后「存为方案」，再存变体即可横比。",
      },
    },
    // 假NL 修：诚实标"预设快答·非智能问答"——答案确定性派生自本卡真求解器输出（客户/订单/越线/峰值），但入口是关键词匹配非自然语言理解/LLM。
    qa: {
      title: "💬 预设快答（关键词匹配 · 非智能问答）· 同源求解器",
      intro:
        "点击下方预设问题，或输入含关键词的追问（客户 / 订单 / 越线 / 后果）。本框按关键词匹配预设问题，非自然语言理解或 LLM；答案由本卡真求解器输出（受影响订单 / 越线日 / 峰值）确定性派生。",
      placeholder: "按关键词匹配预设问题，如：影响哪些客户？",
      ask: "匹配",
      disclosure: "说明：此为关键词匹配的预设快答，非智能问答；答案数字均来自本卡真求解器输出（非另起 LLM · 非伪造）。",
    },
  },
  ledger: {
    expand: "展开",
    filter: "筛选",
  },
  sim: {
    run: "开始推演",
    runAudit: "体检",
    /**
     * WO-SANDBOX-DECLUTTER · 推演沙盘主屏「信息减负」新增的**壳文案**。
     *
     * 只收本单**新写**的字（抽屉入口 / 横幅 / `?` 浮层的触发器与标题）。
     * **不搬**既有诚实位正文：那些正文带 `<b>/<code>` 结构、且相当一部分是
     * `sandboxConsoleModel.SCOPE_DIMENSIONS` / `chainImpediment.IMPEDIMENT_*` 的
     * **单一来源数据**（R14）——抄进本文件就是给它开一条会漂的分身。
     * 正文原样留在组件里（一个字没删），本单改的只是**承载方式**。
     */
    sandbox: {
      diag: {
        /** 抽屉入口（折叠态也必须看得见 + 带计数）。 */
        entry: "诊断",
        entryAria: "打开/收起诊断抽屉",
        /** 计数：有待办时报待办数，无待办时报收纳了几项（两种都是真数，不是装饰）。 */
        pending: (n: number) => `${n} 项待办`,
        items: (n: number) => `${n} 项`,
        title: "诊断 · 建模者 / 开发者 / 调试者的那三档",
        hint: "主屏只留决策者要看的东西；这里是就绪认证、世界列表与调试信息。诚实位一条没删，只是换了位置。",
        close: "收起诊断",
        empty: "本次没有可收纳的诊断项。",
        /** 调试信息分区（SEED / 时窗无 ARGS 等）。 */
        debugTitle: "调试信息",
        derivedTitle: "本体派生",
      },
      banner: {
        /** `canEnterSimulation === false` 时的**唯一**主屏治理信号；为 true 时整条不渲染。 */
        title: "尚未通过就绪认证 —— 现在推演出的结论仅供参考",
        why: "为什么不能推演（缺件清单前几条）：",
        more: (n: number) => `另有 ${n} 条`,
        cta: "查看详情 →",
        ctaAria: "在诊断抽屉里看完整就绪认证",
      },
      /**
       * WO-SANDBOX-V3 · 三区骨架的区名与「这一区回答什么」。
       *
       * 三区各自的判据是**能不能用一句话说清它回答什么**（PRD §1）——
       * 答不出就不该在第一层。所以每个区名后面那一句问句不是装饰，是这一区的**准入判据**：
       * 往区里加东西之前先问「它回答的是这一句吗」。
       */
      zones: {
        inputTitle: "① 扰动因素",
        inputQuestion: "我要试什么？",
        canvasTitle: "② 业务端到端路线图",
        canvasQuestion: "这条链现在长什么样",
        impactTitle: "③ 影响带",
        impactQuestion: "试了之后，哪里变了、值多少钱",
        scopeTitle: "范围",
        impedimentList: "阻滞点逐条",
        rows: " 条",
        pareto: "全链损失 Pareto · 环节级",
        paretoWaiting: "等 chain_loss_attribution",
        paretoHeadline: (top: number, total: number, pct: string, days: string) =>
          `Top${top}/${total} 吃掉 ${pct} 损失 · 全链非增值 ${days}D`,
        metrics: "全链指标",
        metricsCount: (n: number) => `${n} 项`,
      },
      /**
       * WO-SANDBOX-PROCESS-MODE · 主画布**第五档「业务流程」**的文案。
       *
       * ⚠ 本块**一个业务词都没有**：域名 / 流程名 / 职能名 / 承载物类型名一律来自端点下发，
       *   这里只放界面骨架（R14 零写死词表 —— 编错比不编危险，业务专家会照着错的理解）。
       * ⚠ 本块**不出现任何条数金值**（没有 `65`）：条数一律由 `counts(total, laid, lanes)` 现算填入。
       *   把金值抄进文案 = 种子一变就撒谎，而屏上撒谎比屏上没有更糟。
       */
      processCanvas: {
        counts: (total: number, laid: number, lanes: number) =>
          `端点下发 ${total} 条业务流程 · 本图上站 ${laid} 座 · ${lanes} 条线（一条线 = 一个一级业务域；两个数都是现算的，不是写死的金值）`,
        mismatch: "⚠ 下发条数 ≠ 上站座数 —— 本档漏画了流程，这不是「租户没有」而是渲染层掉了",
        disjointOk: "与链路节拍层 24 个冻结节点的键交集：0（两层同屏、不同模型）",
        disjointBroken: (keys: string) => `🔴 两层键集合出现交集：${keys} —— 有人把业务流程层揉进了链路节拍层`,
        layersNote:
          "契约 packages/contracts/src/process.ts 文件头原话：链路节拍层（24 条 CHAIN_NODE_REGISTRY）与业务流程层（65 条 ProcessDefinition）「两层粒度不同，不能互相替代，也不能合并」。那句话约束的是两个**数据模型**（不许互相顶替、不许揉成一张表），不是「不能同屏」。本档是画布上的另一个图层：自己的取数（GET /a/v1/process-definitions）、自己的检视面板、自己的选中态（processKey 而非 nodeId），只共用同一块画布区域与同一套档位按钮。左边那个交集数就是这条约束的机器判据 —— 它一旦非 0，说明两层真被揉了。",
        stdDaysCaveat: "卡上的天数是**标准工期**（模板值），不是「此刻已经卡了多久」——运行态由 /instances 与 process_flow_time 回答，本档不答。",
        unregisteredDomains: (keys: string) =>
          `⚠ 域登记册里查不到这些 domainKey：${keys} —— 单开一条线显示，不静默并进「其它」（静默并进会把「后端漏发」伪装成「前端没画」）`,
        laneUnregistered: "（域未登记）",
        laneStat: (count: number, days: number) => `${count} 站 · 标准工期合计 ${days}D`,
        stdDays: (d: number) => `标准 ${d}D`,
        loading: "取业务流程台账中…（GET /a/v1/process-definitions）",
        errorTitle: "业务流程台账取不到 —— 下面是后端原话，本档不替它编一个解释：",
        empty: "端点返回了 0 条业务流程。这是「本租户没有流程台账」，不是「本档没画」——两者在屏上必须分得开。",

        /* ── WO-R9-METRO-UX：线路图专有文案 ─────────────────────────────────
           ⚠ 下面 `orderBasis*` 三条是本档**最重要的诚实位**：
           端点没下发流程间先后（结构证明见 processCanvas.ts 文件头 §0），
           所以连线画虚线、并且当面说清楚"这条线不是流向"。删掉它，
           这张图就变成了"看着专业但顺序是编的"——派单原话说那比卡片墙更坏。 */
        orderBasisTitle: "线怎么连？",
        orderBasisDisplay:
          "本图的连线是**虚线**，因为它不表示先后：取数端点 GET /a/v1/process-definitions 一条流程间的先后关系都没下发（ProcessDefinition 是 zod strictObject，字段恰好是 key/domainKey/name/ownerFunctionKey/stdDurationDays/waitKind/carrierTypeKey，没有 predecessor/successor/stationIndex——strictObject 同时保证后端不可能多发一个字段而前端没接到）。故本图退回**按域分线**：一条线 = 一个一级业务域，线的上下次序取端点下发的 ProcessDomain.order（契约对该字段的原文是「展示序」，是稳定排版序，不是业务先后），站的左右次序取域内 P## 升序。",
        orderBasisWhyNotNumber:
          "为什么不干脆按 P## 编号画箭头：**编号相邻 ≠ 先后**，两个实测反例都在 apps/datacore/src/process/flow-rules.ts 文件头——① 真实链「在制流转到质检」是 P43 → P47，中间跳过 P44/P45/P46；② 第一版把它写成 P42 → P43 → P47，真跑一遍 P42 的站间间隔是 −9.82 天（负数），机器当场抖出建模错误（工单下达是「伞」不是前一站）。把 P## 升序画成箭头 = 复现一个已被实测证伪的顺序。〔实测日期 2026-08-14 · 复验：读 apps/datacore/src/process/flow-rules.ts:83 起那段「P42 为什么不在链 B 里」的订正（搜 avgGapDaysToNext 即到 −9.82 的出处）；⚠ 有保质期：flow-rules.ts 的链定义一改，本句即过期，须重测而不是照抄。〕",
        orderBasisWhereReal:
          "实测站序确实存在，但不在本档够得着的地方：BATTERY_PROCESS_FLOW_RULES（apps/datacore/src/process/flow-rules.ts:104）有 6 条链、覆盖 9 条流程（P25/P33/P34/P35/P41/P42/P43/P47/P51），其中只有 2 条是真多站（P33→P34→P35、P43→P47），经 process_flow_time 求解器与 GET /a/v1/process-definitions/{key}/instances 下发（带 flowKey + stationIndex），**不经本档这个端点**。复验探针：curl /a/v1/process-definitions/P34/instances 看 flowKey/stationIndex，再 curl /a/v1/process-definitions 看同样字段——后者没有。要在本图画出实测站序，需要 datacore 补一条下发，那在本单范围之外，故如实缺席、不编顺序顶上。〔实测日期 2026-08-14 · 复验：node -e \"import('./apps/datacore/dist/process/flow-rules.js').then(m=>console.log(m.BATTERY_PROCESS_FLOW_RULES.length, m.flowRuleCoveredProcessKeys()))\"，当日现跑 = 6 条链 / 9 条流程。⚠ 本句此前写「覆盖 8 条流程」，2026-08-14 现跑订正为 9（flowRuleCoveredProcessKeys 是端点/文档/测试共用的单一事实源，不许各数一遍）。⚠ 有保质期：规则表增删一条链即过期。〕",
        interchangeNote: (n: number) =>
          `换乘站（双环）${n} 处：两条流程**共用同一个承载物**。⚠ 共用承载物只说明它们作用在同一个对象上，**不说明有先后、也不说明有依赖**（契约 process.ts 原文：P37 MPS 与 P40 APS 都落在 ProductionSchedule，「共用不是空壳」）。这是端点下发的字段里唯一一条真把两条流程连起来的关系，故画成换乘——不是因为它像先后。`,
        interchangeNone:
          "本次下发里没有任何两条流程共用承载物 ⇒ 全图 0 个换乘站。这是「这批数据就没有」，不是「本档没画换乘」。",
        radiusNote:
          "站圈大小 ∝ √标准工期，且按**本次下发的最大标准工期**归一 —— 是相对量不是绝对量，换一批数据圈会重新分布。",
        labelOverflow: (keys: string) =>
          `⚠ 分两层后仍有站名挤在一起：${keys} —— 如实标出来，不偷偷藏标签也不假装不挤（放大或点站看右栏读全名）`,
        lineNo: (n: number) => `${n} 号线`,
        legendTitle: "图例",
        legendStation: "站 = 一条业务流程（圈大小 ∝ 标准工期）",
        legendInterchange: "换乘站 = 与另一条流程共用承载物",
        legendDashed: "虚线 = 同一条线上按展示序排列，**不是流向**",
        legendFold: "折返 = 一条线太长换到下一行，线没有断",
        legendWaitKind: "站圈颜色 = 卡在哪一类等待（四态词表来自契约）",
        zoomIn: "放大",
        zoomOut: "缩小",
        fit: "适应画布",
        zoomReadout: (k: number) => `${Math.round(k * 100)}%`,
        /** 缩到下限仍装不下：是事实就说出来，不许让它长得像「已经适应了」。 */
        fitClamped: "已缩到下限仍装不下 ⇒ 顶左对齐，拖拽/滚轮看其余部分",
        canvasLabel: "业务流程线路图（可缩放平移；站可点，点开右栏出完整本体关系）",
        /** 右栏：本档的检视面板标题与未选中提示。 */
        inspectTitle: "流程检视 · 完整本体关系",
        inspectHint: "点画布里任一条业务流程 → 这里出它的完整本体关系：承载类型 / 属性 / 派生 / 一跳关系 / 同承载物流程 / 打到它的杠杆 / 十六层三态。",
      },
      /**
       * WO-SANDBOX-V3 · 下区影响带（PRD §1③）的文案。
       *
       * ⚠ `financeGap` 是**诚实位**，不是免责声明。规范 §1 明写诚实位
       *   **允许降层、绝不允许删除**，故它常驻第一层。
       *
       * ⚠ **WO-FINANCE-WORLDSTATE 改写了它承载的那个事实，而不是删了它**：
       *   原文陈述「平台今天没有随世界态变化的金额型财务指标」——那句话在本单之后**不再成立**
       *   （`finance_world_projection` 就是那个出处）。诚实位说了假话比没有诚实位更坏，
       *   故这里**改写内容、保留位置**。`finance_pnl` 不吃 `worldId / sessionId` 这一条**仍然成立**
       *   且仍然写在里面：本单一个字都没动它的签名（它有既有调用方与金值，动签名会连坐）。
       */
      impact: {
        autoNote: "扰动一施加即自动分析（沙盘里的「假设」就是已经发生的那条扰动，不需要再按一次确认）",
        needPerturbation: "左区还没有施加扰动 —— 先施加一条，这里才知道要传播哪一处变更。",
        deltaTitle: "世界态随扰动的变化",
        deltaQuestion: "基线快照 → 当前 tick，哪些状态变量动了",
        deltaBaselineMissing:
          "本世界的基线快照（`SimSession.baseSnapshot`）还没取到 ⇒ 算不出变化量。这里显示空，不用当前值冒充「没变化」。",
        deltaNone: "与基线逐项相等 —— 是「比过了，一项都没动」，不是「没比」。",
        deltaMoved: (n: number, total: number) => `${n} / ${total} 项偏离基线`,
        deltaRest: (n: number) => `其余 ${n} 项（与基线同值）`,
        financeGapTitle: "这块金额是怎么来的 / 什么时候没有",
        financeGapBody:
          "**这是推演投影，不是实测值。** 基线取本体真值（FinancePlan 的 rolling / ARInvoice 的 amount），增量由**这个世界里**的成本压力（Order.costPressure）、回款压力（Customer.receivablePressure）、逾期压力（ARInvoice.overduePressure）沿种子里的传导规则折算：金额 = 基线 ×（1 + 压力 ÷ 换算除数），除数由后端随回包下发（不是前端写死的系数），产生这些压力的传导规则真 id 与真系数也一并回传，改种子系数这里跟着变。⚠️ **不要把它和 `finance_pnl` 搞混**：那个求解器读本体真值、其实现签名不吃 worldId / sessionId ⇒ 同一个租户下施加任何扰动它都返回同一组数 —— 那是它的正确行为（本单一个字没动它），只是它答不了「这个世界里花了多少钱」。本带的金额来自另一条通路 `finance_world_projection`。世界态为空 / 没有金额基线 / 该能力未开通时，这里**据实报缺**，绝不显示一个不动的 0。",
        moneyTitle: "财务金额随扰动的变化",
        moneyQuestion: "这次扰动，钱上差多少",
        /** 口径**常驻第一层**（不是浮层里的一句话）：读者一眼要知道这不是实测数。 */
        moneyCaliber: "推演投影 · 非实测",
        moneyCaliberDetail: (divisor: number) => `基线 ×（1 + 压力 ÷ ${divisor}）`,
        moneyLoading: "正在向财务投影求解器要数…",
        moneyNoSession: "还没有推演世界 —— 建好世界这里才有金额可投影。",
        /** 求解器说不可用（世界态空 / 无基线）：把**后端原话**摆出来，本页不替它编一个解释。 */
        moneyUnavailable: (reason: string) => `这个世界暂时给不出金额口径 —— ${reason}`,
        /** 请求本身失败（能力未开通 / 网络）：同样给后端原话。 */
        moneyFailed: (msg: string) => `财务投影求解器没答上来，下面是后端原话，本页不替它编一个数：${msg}`,
        moneyBaselineWord: "基线",
        moneyProjectedWord: "投影",
        moneyCashTitle: "应收 / 逾期",
        moneyArRow: "应收余额",
        moneyOverdueRow: "逾期敞口",
        moneyChain: (n: number) => `换算链 ${n} 跳（真规则系数）`,
        moneyNotes: (n: number) => `诚实缺席 ${n} 条`,

        /* ══ WO-FIELD-DEAD-6 · 「诚实位那一层」的文案 ═══════════════════════════════
         *
         * 这一组治的病一句话：**屏上一个金额，看的人无从知道它是 500 个对象里 3 个撑起来的，
         * 还是因为拿不到金额权重、退回等权硬算出来的。**
         * 契约 `finance-world.ts` 把 `worldStateSource` / `worldObjectCount` / `pressures[]`
         * 三个字段都写成**必填**（不带 `.optional()`），后端逐个算好下发，而前端此前一个都没读
         * （`solver-field-seam:check` 2026-08-14 判：全前端生产代码零提及）。
         *
         * ⚠ 三句 `moneyCarriers*` **不许合并成一句「无数据」**：契约注释原文写着
         *   「缺 `universe`，`carriers:0` 无法区分『台账空』与『查过了没中』」——
         *   合并 = 把这个区分重新抹掉，等于把 `universe` 这个字段再杀一次。
         *   `finance-provenance.seam.test.tsx` 用「两种 carriers:0 的屏上措辞必须不同」咬死这一条。
         */
        /** 世界态取自哪一份（`worldStateSource`）——不写出来，读者不知道这块钱是拿哪一份态算的。 */
        moneyWorldStateLabel: "世界态取自",
        moneyWorldStateTick: "当前 tick 的态",
        moneyWorldStateBaseSnapshot: "该 tick 没有落态 → 回落会话基线快照",
        /** 几个对象有态（`worldObjectCount`）——分母不藏起来。 */
        moneyWorldObjects: (n: number) => `${n} 个对象有态`,
        /**
         * `worldObjectCount === 0` 但回包仍报 `available:true` —— **契约要求此时 `available:false`**
         * （`finance-world.ts:146` 原文「0 = 空世界 → `available:false`」）。
         * 前端照契约判，不照回包的一面之词判：空世界算出来的金额恒等于基线，摆上去就是静默错答。
         */
        moneyWorldEmptyContradiction:
          "回包自相矛盾：`worldObjectCount: 0`（空世界）却报 `available: true` —— 契约要求此时 `available: false`。空世界的投影恒等于基线，摆上去就是拿基线冒充投影。本页据实报缺，不显示这组数。",
        /** 成色区的区头：这一段回答「这几个金额凭什么可信」。 */
        moneyPressureTitle: "这几个金额的成色",
        moneyPressureQuestion: "每条压力由几个对象撑着 · 用什么口径聚合",
        /** 有承载对象：分子分母一起给（只给分子 = 又一个没有成色的数）。 */
        moneyCarriersSome: (carriers: number, universe: number) => `${carriers} / ${universe} 个对象带这个态`,
        /** `carriers:0 · universe:0` —— 台账本身是空的（连查的对象都没有）。 */
        moneyCarriersNoUniverse: "台账里就没有这类对象（全域 0 个）",
        /** `carriers:0 · universe>0` —— 查过了，只是一个都没中。与上一句**是两件事**。 */
        moneyCarriersNoneCarry: (universe: number) => `查过了：全域 ${universe} 个对象，没有一个带这个态`,
        /** `weighting: "VALUE"` —— 金额口径唯一正确的聚合法。 */
        moneyWeightingValue: "按金额加权",
        /** `weighting: "EQUAL"` —— **回落**，可信度低于上面那档，不许显示成一样。 */
        moneyWeightingEqual: "等权回落",
        moneyWeightingEqualHint: "拿不到金额权重才退回等权，这条的可信度低于按金额加权的那些 —— 后端原话：",
        /** `weighting: "VALUE"` 时也把后端口径原话带出来（诚实位只许降层、不许删）。 */
        moneyWeightingValueHint: "后端口径原话：",
      },
      /**
       * WO-V4-PLAYS · 方案环（PRD-sandbox-v4 §3.3）的文案。
       *
       * ⚠ `caliber` / `r4` 是**诚实位**，与上面的 `financeGap` 同族：
       *   前者写明「平行世界之间那点差异是怎么造出来的」（它是推演投影，不是实测），
       *   后者写明「采纳只落审批草稿，沙盘绝不写本体真值」（R4 红线）。
       *   两者常驻第一层 —— 降层可以，删除不行。
       *
       * ⚠ 本节**不含任何方案名 / 指标名 / 行业实体名**：那些一律来自 `decision_play` 回包
       *   与契约 `GOAL_REGISTRY`（R14 去电池锁死）。这里只有结构性措辞。
       */
      plays: {
        title: "方案环 · 扰动 → 方案 → 平行世界 → 比对 → 采纳",
        intro:
          "左边拨一条扰动让指标动起来，这里向决策推演求解器要 N 个对症方案；每个方案开一个平行世界（从同一个检查点分支），并排比出差异，再把选中的那个送进 Action 审批。",
        metricLabel: "指标",
        metricAuto: "引擎自选（缺口最大的越线指标）",
        solve: "求方案",
        solving: "求方案中…",
        solveFailed: "求方案失败 —— 下面是后端原话，本页不替它编一个解释：",
        rootPrefix: "根因 ",
        gapWord: "缺口",
        narrowing: (pct: number, n: number) => `推荐组合 ${n} 项 · 收窄 ${pct}%`,
        recommended: "在推荐组合内",
        basis: "依据：",
        needPerturbation:
          "还没有施加扰动 ⇒ 平行世界没有可回补的落点。先在上面拨一条扰动，方案世界才会互不相同（不给一个点了只会开出 N 个一模一样的世界的按钮）。",
        zeroEffect: (objectId: string, stateVar: string) =>
          `本次扰动在 ${objectId}.${stateVar} 上的实测效应为 0（引擎规整或落点未变）⇒ 按比例回补出来的差异也必然是 0。这里如实说没有可比的差异，不去换一个"看着有差异"的算法把它糊过去。`,
        branch: (n: number) => `为 ${n} 个方案各开一个平行世界`,
        branching: "开世界中…",
        caliber: (objectId: string, stateVar: string, effect: number) =>
          `口径（这一段数字是推演值，不是实测值）：回补比例 = 该方案 closesGap ÷ 根因缺口；本次扰动在 ${objectId}.${stateVar} 上的实测效应 Δ = ${Math.round(effect * 1000) / 1000}；方案世界 = 分支世界 + 一条 delta = −Δ×回补比例 的扰动。`,
        worldsTitle: "平行世界（各方案各一个）",
        recovered: (pct: string) => `回补 ${pct}%`,
        adopt: "采纳（走审批）",
        adopting: "采纳中…",
        compareLabel: "并排比对",
        pickA: "比对世界 A",
        pickB: "比对世界 B",
        compare: "比对",
        comparing: "比对中…",
        compareEmpty: "两个世界里读不到该落点的值 —— 如实说读不到，不用 0 冒充。",
        diff: (d: string) => `差异 B − A = ${d}`,
        r4:
          "R4 红线：沙盘改的是推演会话的世界态，**不写本体真值**。「采纳」只创建 Action 草稿并进审批流（实测回 PENDING_APPROVAL），审批通过才由 Action 正门写真值。",
      },
      info: {
        /**
         * WO-HOVER-LAYER：以下三条原先挂在**原生 `title=`** 上，按
         * `docs/CONVENTION-ui-information-layering.md` §2 R-UI-3「公式与口径不在第一层，
         * 且禁止用 HTML title 属性充当浮层」迁到 InfoPopover。
         */
        routingConfidenceTopic: "分类置信度",
        routingConfidenceBody:
          "量纲＝分类置信度 0–1（QOS routing.completed 事件的 confidence），越高越确定。与阈值 tauHigh / tauMid 同尺度比较，恒 0–1；满分是 1 不是 100。",
        skillWriteModeTopic: "写模式（推导位）",
        skillWriteModeBody:
          "契约 isWriteModeSkill 的推导结果，非后端下发字段：会改变真值 或 需要审批 ⇒ 受 R4「真值只经 Action 审批链变更」约束，故必须产出 action_draft。",
        llmNoReasoningTopic: "关推理",
        llmNoReasoningBody:
          "关掉该用途的推理（分类 / 选型等本不需推理）：推理型模型改用同 provider 的非推理兄弟出快答，是治本的降时延手段。",
        /** `?` 触发器：hover / focus 出浮层，移开或 Esc 即消失。 */
        trigger: "?",
        triggerAria: (topic: string) => `${topic} —— 说明（悬停或聚焦查看）`,
        close: "关闭说明",
        impedimentCaliber: "口径差（按引擎显示，不按设计稿措辞）",
        impedimentJoin: "联动口径（真实的接缝缺口）",
        scopeDim: (label: string) => `${label} · 这一维带不带得下去`,
        scopeReach: "范围能带到哪",
        legend: "阻滞点图例",
        timeWindow: "时窗 30D / 60D / 90D 为何禁用",
        seed: "SEED · 确定性种子",
        chainCoverage: "链路阶段 · 在册 ≠ 有数据（完整口径与取证）",
        processLayers: "业务流程档 · 两层为何能同屏、又为何不合并",
        /** WO-R9-METRO-UX：线路图的连线**为什么是虚线**（诚实位，不是免责声明）。 */
        processOrderBasis: "业务流程线路图 · 线怎么连、为什么是虚线",
        paretoRate: "影响率怎么算 · 分母是什么",
        inspectorEvidence: "下钻证据为何是空的",
        stepTable: "逐环节表的口径",
        // ── WO-BEFE-WIRE-3 · 影响传播 / 快照分叉比对（口径与公式一律进浮层，第一层只留数值与状态）──
        impactBasis: "影响面怎么算 · 引擎与口径",
        impactDimension: (label: string) => `${label} · 这一维的连接键与全域`,
        impactHonesty: "「算不了」与「没影响」的区别",
        twinFork: "分叉进仿真世界会发生什么",
        twinDiff: "两份快照的差怎么算",
        /**
         * WO-SANDBOX-UI-INTEGRATE · 顶栏 KPI 的**量纲口径**。
         *
         * 来历：仓主指出沙盘第一层「密密麻麻，很多是功能或信息描述型」。顶栏读数此前写成
         * `全局态（0–100 指数 · tick 3） 62.5` 与 `s1（0–100 指数·全对象均值） 48.0` ——
         * 括号里那截是**口径**（规范 §2 R-UI-3 明令进浮层），它把每个读数撑长一倍，
         * 而顶栏恰恰是「这一页要回答的那个数」该独占的位置（R-UI-2）。
         *
         * ⚠ 降层**不是删除**（规范 §1 诚实位红线）：量纲是 WO-UNIT-MEANING 立的诚实位 ——
         * 裸「62.5」看不出满分是 100 还是 10。故原文一字不改地搬进浮层，
         * 第一层留 `?` 触发器当可见记号（「静默降层等于删除」）。
         */
        /**
         * WO-SANDBOX-UI-INTEGRATE · 壳级上下文的**诚实位**（原文一字未改，只换承载方式）。
         * 原先内联在 `SandboxView` 的 `title=` 属性里 —— 规范 §2 R-UI-3 明令禁止原生 tooltip
         * （不受控 · 永远画在最上层 · 移开滞留；本仓 2026-08-10 真出过遮挡事故）。
         */
        shellContextGap: "订单锚点 / 时窗为什么不是壳级控件",
        shellContextAnchor:
          "订单锚点：今天不是壳级控件——它由线路图按 so 自取（chain_loss_attribution 唯一认的入参），壳里没有第二个订单选择器，硬造一个就是各模式各用各的假旋钮。",
        shellContextWindow:
          "时窗：chain_loss_attribution 只认 so、chain_impediments 只认 scope，两者都没有时间窗入参，故控制台顶栏那个 30D/60D/90D 是禁用的（挂「时窗无 ARGS」徽标），壳里不再造第二个。",
        /**
         * WO-V4-HONEST-ORIGIN · 顶栏读数**出处**（PRD-sandbox-v4 §2.1 / §4.3）。
         * 两条正文互斥出现：占位期一条、实测期另一条 —— 记号必须真的换掉，不是加一句免责。
         */
        kpiOrigin: "这批读数是哪来的",
        kpiOriginDerived:
          "**合成·占位**：屏上这批数由前端按 `hash01(对象id|变量名)×100` 确定性派生，还没取到后端世界态。它是可复现的占位（R6），不是任何实测值 —— 全对象取均值必然收敛到 50，那是大数定律，不是各项压力恰好都在中位。推进一个 tick、施加一条扰动，或世界态事件触发重取之后，这个记号会换成「实测」。",
        kpiOriginMeasured:
          "**实测**：屏上这批数取自后端世界态（`GET /a/v1/sim/sessions/:id/world` 回包，或 tick / 扰动回包），不再是前端哈希占位。口径仍是 0–100 指数（见「读数量纲」）；它描述的是**这个推演会话里的模拟世界**，不是本体真值。（本条口径实测于 2026-08-13；复验：`pnpm --filter frontend-shell exec vitest run test/sandbox-world-origin.seam.test.tsx`）",
        /** WO-V4-PLAYS · 方案环里那点差异的口径（诚实位，常驻第一层 + `?` 出全文）。 */
        playCaliber: "平行世界之间的差异是怎么造出来的",
        playCaliberBody:
          "从同一个检查点分支出来的子世界**逐字节相同**，不给它们各自一处差异，比对面板就永远是两列一样的数。差异来自一处**显式的确定性投影**（不是新真值源）：回补比例 = 该方案 `closesGap` ÷ 根因缺口（两者同量纲，比值无量纲，取自 `decision_play` 回包）；本次扰动在该状态变量上的实测效应 Δ = 扰动后值 − 扰动前值（两头都取后端回包）；方案世界 = 分支世界 + 一条 `delta = −Δ × 回补比例` 的扰动，经真端点施加、由引擎照常规整与传导。读作「这个方案按引擎自己给的 closesGap 能补掉缺口的这么多，于是在沙盘里把本次扰动的效应回补这么多」。它是**推演值**，不是实测值。",
        kpiUnit: "读数量纲 · 0–100 指数",
        kpiUnitGlobal: "全局态是**全对象、全状态变量**的均值，量纲为 0–100 指数（非百分比、非任何单一变量的原值）；越高越好。",
        kpiUnitVar: "每个状态变量的读数是该变量在**全部已物化对象**上的均值，量纲为 0–100 指数（非百分比）。",
        /**
         * WO-SANDBOX-CANDIDATES-FE · 候选对策的浮层标题。
         * 第一层只放「拨哪个对象 / 拨哪个属性 / 从多少到多少 / 效果」；
         * 口径（档位怎么来的 · join 怎么推的 · 试算公式）一律降到这两个浮层里。
         */
        candidateHow: "这条对策是怎么推出来的",
        candidateNone: "为什么这个阻滞点没有方案",
      },
      /**
       * WO-SANDBOX-CANDIDATES-FE · 候选对策区的**壳文案**。
       *
       * 只收标题/表头/连接词这类纯壳字。**不收**任何口径正文 ——
       * 档位来源、join 路径、试算公式、缺席原因全部是**引擎回包里的字段原文**
       * （`rungSource` / `join.path` / `provenance.formula` / `noCandidateReason` / `gaps[]`），
       * 抄进本文件就是给引擎文案开一条会漂的分身（R14 同族纪律）。
       */
      candidates: {
        title: "候选对策",
        /** 计数：几条候选。0 条时不显示本行，改显示「为什么没方案」。 */
        count: (n: number) => `${n} 条`,
        lever: "拨哪个对象",
        prop: "拨哪个属性",
        move: "从多少拨到多少",
        rung: "档位来源",
        effect: "真试算的效果",
        join: "溯源",
        /** 档位纪律：必须让用户看见"这个数不是前端拍的"。 */
        rungNote: "档位取自同侪真实取值 / 规则阈值本身，全链零步长常数",
        /** 杠杆落点不是阻滞点落点时的记号（回包里没有该对象的显示名，只有业务 id）。 */
        leverElsewhere: "杠杆不在阻滞点落点上",
        leverIdOnly: "回包只带业务 id，无显示名 —— 如实回显 id，不去别处凑一个名字",
        /** KPI 维表头。 */
        dimBefore: "不施策",
        dimAfter: "施策后",
        dimDelta: "改善",
        /** 维算不出来（value===null）：显示引擎给的原因，**绝不补 0**。 */
        dimEmpty: "算不出来",
        /** 「为什么没方案」区。 */
        noneTitle: "为什么这个阻滞点没有方案",
        statLine: (a: number, p: number, e: number, m: number) =>
          `探了 ${a} 个杠杆锚点 · 试算 ${p} 次 · 有效 ${e} 个 · 下发 ${m} 条`,
        gapsTitle: "缺口（引擎原文）",
        statMissing: "引擎未回带本点的逐点账（candidateStats 无对应行）—— 说不出探了几个锚点，如实标注，不编一个数",
        /** 顶部总账。 */
        summary: (withC: number, total: number) => `${withC} 个阻滞点有对策 · 共 ${total} 条候选`,
        absentSummary: "没有对策的分三态（修法完全不同，不许合并看）：",
        probes: (n: number) => `本次试算探针 ${n} 次`,
        truncated: "⚠ 探针预算已耗尽 ⇒ 后面的档位没试算完，结果不完整",
        waiting: "等 chain_impediments 取回后，这里逐条列出候选对策。",
      },
    },
    inference: {
      toggle: "▸ 推演过程（编排 DAG）",
      hide: "▾ 推演过程（编排 DAG）",
      in: "输入",
      proc: "过程",
      out: "输出",
      gap: "缺口·断在此",
      notRun: "未跑/未接入",
    },
    ksf: {
      title: "财务计划 KSF 图（问题 → 关键成功要素 → 财务指标）",
      problems: "待解决问题",
      ksf: "关键成功要素",
      fin: "财务计划指标",
      timelineHint: (name: string) => `${name} 的时序推演（逐日传导度）`,
    },
    snapshotBadge: (v: string) => `快照 ${v}`,
    adoptToDraft: "采纳为草稿",
    adoptDone: "已生成 Action 草稿并进入审批流",
    gotoActions: "前往审批台",
    audit: {
      title: "规划体检",
      inputTitle: "输入计划字段",
      // PRD-IND-audit §3.1：「可定稿·关注风险」展示时插入 M 计数「可定稿 · 关注 N 项风险」。
      verdict: (verdict: string, score: number, mCount = 0) => {
        const label = verdict === "可定稿·关注风险" ? `可定稿 · 关注 ${mCount} 项风险` : verdict;
        return `体检结论：${label}（评分 ${score}/100）`;
      },
      hardSection: "⛔ 硬矛盾",
      medSection: "⚠ 软风险",
      sugSection: "💡 建议修正",
      applyFix: "一键应用",
      fixFootnote: "演示用——实际生效走 S&OP 议程与 Action 审批 (C10/C22)",
      timeline: "⏱ 时序推演（不解决会怎样）",
      timelineHint: "不解决会怎样 → 按审计口径(kind)逐日推演（audit_timeline 各项独立曲线）",
      gmStruct: "细分结构反推毛利率上限",
      baseline: (label: string) => `基线：${label}·改任意字段即时体检`,
      resetInput: "重置输入",
    },
    gen: {
      title: "规划建议",
      goals: "🎯 经营目标（改动即重算全部方案）",
      recommend: "推荐",
      extSens: "🌐 外部信号敏感性",
      focusKeys: "执行关键点",
      whyPrefix: "为什么必须解决（推演）：",
      hardViol: "硬约束冲突",
      hard: "硬约束",
      soft: "软偏好",
      gain: "得",
      give: "舍",
      meets: "目标达成清单",
      tradeoff: "取舍矩阵",
      radar: "五维评分雷达",
      violList: "硬约束违反清单",
      problems: (no: string) => `方案${no} · 关键点与必须解决的问题`,
      adopt: "采纳方案",
      unlock: "解锁条件",
      targetLabels: {
        revGrowthPct: "收入增长",
        gmFloor: "毛利底线",
        sharePts: "份额增",
        capexCap: "CAPEX 上限",
        cashFloor: "现金底线",
      },
      meetLabels: {
        meetRevenue: "收入增长",
        meetGm: "毛利底线",
        meetShare: "份额增",
        meetCapex: "CAPEX 上限",
        meetCash: "现金底线",
        meetTurns: "周转",
      },
    },
    proj: {
      title: "项目推演",
      orders: "订单列表",
      single: "整单",
      batch: "分批",
      model: "型号",
      qty: "需求(万套)",
      weeks: "交期(周)",
      addBatch: "＋ 添加批次",
      okBar: (weeks: number) => `✓ 可按 ${weeks} 周交付（P90 口径）`,
      gapBar: (gap: string) => `✗ P90 缺口 ${gap} 万套`,
      batchOk: "✓ 全部批次可按期交付（P90 口径，已扣物流时长）",
      batchGap: (gap: string) => `✗ 有批次越线 · 最大缺口 ${gap} 万套`,
      steps: ["① 场景解析", "② 可产基地收敛", "③ 驱动因子装载", "④ 逐级聚合 P50", "⑤ 瓶颈定位", "⑥ 结论与对策"],
      prevStep: "← 上一步",
      nextStep: "下一步 →",
      stepOf: (n: number, m: number) => `${n}/${m}`,
      dagTitle: "推演 DAG（随步骤点亮）",
      bnMatrix: "多维瓶颈矩阵",
      bnMatrixOpen: "🧮 打开瓶颈矩阵（基地×7因素）",
      whatIf: "What-if 调参（拖动即重算）",
      nightShift: "加夜班",
      extraChannels: "扩产能通道",
      outsource: "外协比例",
      // DF.13：红线百分数由契约单一来源格式化（此前手写两个「20%」，是唯一真正内联在用户可见文案里的裸数）。
      outsourceCap: `已达 ${OUTSOURCE_REDLINE.ruleKey} 红线 ${outsourceRedlinePct()}%（外协比例不得超过 ${outsourceRedlinePct()}%）`,
      gapZero: (surplus: string) => `缺口归零 · 富余 ${surplus} 万套`,
      gapLeft: (gap: string) => `缺口 ${gap} 万套`,
      adopt: "采纳产能保障方案",
      before: "调整前 P50",
      after: "调整后 P50",
      logistics: (days: number) => `物流 ${days} 天`,
      pendingCert: "认证中（产能按 60% 计）",
      certPending: "认证中",
      // PRD-IND-model §4.4-⑥：不达标时对症对策表（acts，方案库「按约束因素对症」，缺口时显示，与滑杆并存）。
      actsTitle: "对症对策（按约束因素 · 方案库）",
      acts: [
        { action: "加 2 夜班", effect: "+12% 产能 · 当周见效 · 低成本" },
        { action: "扩化成通道", effect: "+20% · 直击主瓶颈 · 含 2 周爬坡" },
        // DF.13：红线百分数派生（这是第二处手写「20%」的用户可见文案）。
        { action: "部分外协", effect: `+15% · 受 ${OUTSOURCE_REDLINE.ruleKey} ≤${outsourceRedlinePct()}% 约束` },
      ],
      // WO-PROJECT-SIM-WHATIF ⑥：动态杠杆（自瓶颈反推 + 敏感度排序，走 generic_inference 真重算）文案（R14 下发·不内联）。
      lever: {
        title: "动态杠杆（自瓶颈反推 · 敏感度排序）",
        hint: "杠杆集随⑤瓶颈变——每根杠杆是撬得动本项目瓶颈的可写对象属性，敏感度由 generic_inference 服务端 ±ε 真重算得出。",
        tornadoTitle: "敏感度龙卷图（∂目标/∂杠杆 · 降序）",
        sensitivity: "敏感度",
        current: "当前",
        boundHit: (name: string) => `⚠ 已达「${name}」规则闸/物理域上限`,
        empty: "未发现可撬动本瓶颈的杠杆（派生链未覆盖该因子）——诚实空态，不臆造滑杆。",
        deltaTitle: (n: number) => `下游派生 before → after（${n}）`,
        provFormula: "敏感度 = Δ下游派生 / Δ杠杆（generic_inference · recompute dryRun ±ε）",
        adopt: "采纳杠杆组合方案",
        schemeTitle: "多方案利弊量化矩阵（每方案 generic_inference 真算）",
        schemeHint: "就本瓶颈自动生成候选杠杆组合，每方案经 generic_inference 真重算比对——各格数字可溯（非写死）。",
        schemes: { maxCap: "max_产能", minCost: "min_代价", balanced: "均衡" },
        col: { scheme: "方案", capGain: "产能增益", impact: "影响面", ruleFlag: "触规则闸", adopt: "" },
        adoptScheme: "采纳",
        ruleGate: (pct: string) => `外协 ≤ ${pct}（C08 规则闸）`,
      },
    },
    sop: {
      title: "月度规划",
      newVersion: "新建版本",
      versions: "版本列表",
      steps: ["① 产品评审", "② 需求评审", "③ 供应评审", "④ 财务整合", "⑤ 高管决策会"],
      runStep: (n: string) => `执行第${n}步`,
      locked: "已定稿——变更须走变更 Action（C22 锁定，任何字段变更必须走计划变更 Action）",
      lockDemo: "改字段尝试（演示 409 PLAN_LOCKED）",
      finalize: "定稿 → 走 Action 审批（C10/C22）",
      finalizeDone: "草稿已创建，待审批",
      requestChange: "发起变更",
      changeDone: "变更草稿已创建，待审批",
      pendingBadge: "待审批",
      reviewing: (n: number) => `V${n} 评审中`,
      finalBadge: (n: number) => `V${n} 已定稿·C22 锁定`,
      c21Chip: "C21 差异提报 → 进议程",
      step5Blocked: "④ 财务整合未通过，阻断进入⑤（先修正财务输入并重跑第④步）",
      gapRed: "缺口 > 2 万套",
      kpi: {
        demand: "需求 P50(万套)",
        supply: "可供给(万套)",
        gap: "产销缺口(万套)",
        revAttain: "收入预算达成",
        gmVsBudget: "毛利率 vs 预算",
        cash: "现金垫 C18",
      },
    },
  },
  intake: {
    title: "原型 intake（HTML → 数据表/关系/对账）",
    sub: "粘贴 HTML 原型 → 确定性解析内嵌数据表（列+样例）与关系 → 与既有本体字段对账（自动映射/待确认候选/诚实标未解析），让「下一个 HTML 自动复刻数据与关系」可见可重复。",
    placeholder: "粘贴含 <script>const NAME=[...]</script> 的 HTML 原型……",
    parse: "解析 + 对账",
    tablesTitle: (n: number) => `解析出的数据表（${n}）`,
    relations: "关系",
    reconcileTitle: "与既有本体对账",
    autoMapped: "自动映射",
    candidates: "待确认候选",
    unparsed: "未解析（诚实跳过，不静默丢）",
    importBtn: "导入到库",
    importHint: "把解析出的数据表物化进统一数据库（经原型连接器），在「数据接入」可见此导入文件并在线查看每张表（值与原型一致，不写死前端）。",
    importedTitle: (n: number) => `已导入到库（连接器 + ${n} 张表）`,
    importedConn: "导入文件（数据连接器可见）",
    importedRows: "行",
    filenamePlaceholder: "文件名（如 cockpit-prototype.html）",
    objectifyBtn: "物化为对象",
    objectifyHint: "把导入表按确定性对账映射进既有对象类型（对账后的列→既有 type.field，不新建类型），成为可查询 ObjectInstance（对象浏览器计数可见）；映射不上的诚实跳过。",
    objectifiedTitle: (n: number) => `已物化为对象（${n} 项）`,
    objectifiedSkipped: "诚实跳过（无可确定映射）",
    objectifyEmpty: "无可确定映射的表——导入数据已在库可在线查看；如需物化为对象，先在建模页对账确认列映射。",
    modelNewBtn: "建模为新类型（A3）",
    modelNewHint: "原型表与既有本体不匹配时，到半自动建模页把它们建成新对象类型（确定性建模→审核→发布→物化）。",
  },
  boundary: {
    title: "边界册治理（单一来源 + 影响图）",
    sub: "基地/应用细分/规划目标阈值的单一来源册——改某条业务常数会波及谁（回答「改 X 影响什么」）。册为 @platform/contracts 单一来源，改值=改代码经 boundary-singlesource 门。",
    versionTitle: "版本指纹（改值留痕 / 缓存失效锚）",
    consumers: "派生消费端",
    consumersNote: "boundary-singlesource 门强制其从册派生、不内联",
    derivesVia: "派生方式",
    downstream: "下游受影响面",
  },
  admin: {
    connections: {
      title: "数据接入控制台",
      newConnection: "新建连接",
      testConnection: "测试连接",
      testOk: "连接成功",
      testFail: "连接失败",
      upload: "文件上传",
      uploadHint: "拖拽或点击上传 CSV/XLSX/JSON",
      fieldProfile: "字段画像",
      nullRate: "空值率",
      uniqueRate: "唯一率",
      enumCandidates: "枚举候选",
      lastSync: "上次同步",
      syncNow: "手动同步",
      syncRunning: "同步中…",
      chooseType: "选择连接器类型",
      configStep: "连接配置",
      secretNoEcho: "出于安全考虑，密钥保存后不再回显",
    },
    ruleDocs: {
      title: "规则文档审核台",
      upload: "上传规则文档",
      uploading: "上传抽取中…",
      uploadDone: (n: number) => `抽取完成：${n} 条候选待审`,
      progress: (n: number, m: number) => `${n}/${m} 已审`,
      approve: "通过",
      editApprove: "修改后通过",
      reject: "拒绝",
      confidence: "置信度",
      diffNew: "新增",
      diffChanged: "变更",
      diffDeleted: "疑似删除",
      dupBadge: "疑似重复",
      sourceQuote: "原文摘录",
    },
    modeling: {
      title: "本体建模工作台",
      newDraft: "AI 建议草案",
      newDraftHint: "选择原始数据集（来自连接器同步/文件上传），由 AI 给出对象建模建议",
      newDraftEmpty: "暂无原始数据集 —— 先在「数据接入」同步连接器或上传文件",
      suggestRun: "生成建议",
      suggestDone: "建议草案已生成",
      sourceFields: "源字段",
      canvas: "映射画布",
      operations: "操作面板",
      mapToExisting: "复用",
      publishErrors: "发布校验错误",
      materialize: "对象化",
      materializeProgress: "对象化作业进度",
      patchFailed: "操作失败，已回滚",
      assignDomain: "归域…",
    },
    pipelines: {
      title: "数据构建 Pipeline 配置",
      subtitle: "配置低代码 pipeline 的每个节点 SOP：干什么 · 失败怎么办 · 要不要人工放行。存下即生效——数据接入/导入/建域下次执行按新定义跑。",
      kindIntake: "数据接入",
      kindIntakeImport: "数据导入",
      kindStoryBuild: "故事建域",
      factory: "出厂默认",
      overridden: "已覆盖",
      colNode: "节点",
      colWhat: "干什么（SOP 正文）",
      colOnFailure: "失败怎么办",
      colApproval: "人要不要介入",
      colEnabled: "启用",
      policy: { ABORT: "中止整条", RETRY: "有界重试", SKIP: "跳过继续" },
      maxAttempts: "重试次数",
      requiresApproval: "需人工放行",
      enabled: "执行",
      save: "保存并生效",
      saving: "保存中…",
      resetFactory: "撤销覆盖 · 回出厂默认",
      pausedTitle: "等待放行的运行（PAUSED）",
      pausedEmpty: "当前没有等待放行的运行。",
      approve: "放行并续跑",
    },
    permissions: {
      title: "权限策略",
      explain: "authz explain 调试器",
      explainRun: "解释",
      matchedPolicies: "命中策略链",
      rowFilter: "最终行过滤",
    },
    synthetic: {
      title: "合成数据向导",
      step1: "行业与规模",
      step2: "生成进度",
      step3: "校验报告",
      industry: "行业",
      scale: "规模",
      seed: "随机种子",
      start: "开始生成",
      rerun: "重新生成",
      rerunConfirm: "将清除该租户全部 SYNTHETIC 数据，确认重跑？",
      phases: ["行业模板", "本体实例化", "源对象生成", "历史时序生成", "派生计算", "配套生成与校验"],
      tsSection: "时序校验",
      clock: {
        title: "模拟时钟控制台",
        current: "当前模拟日期",
        tick1d: "推进 1 天",
        tick7d: "推进 1 周",
        reset: "重置",
        script: "剧本时间线",
        reports: "tick 报告流",
        refreshHint: "数据已更新，打开中的看板请刷新",
        newAlerts: "新告警",
      },
    },
    actions: {
      title: "Action 草稿与审批",
      approve: "批准",
      reject: "驳回",
      comment: "审批意见",
      confirmApprove: "确认批准该 Action 草稿？",
      confirmReject: "确认驳回该 Action 草稿？",
      payload: "参数快照",
      originTask: "来源任务",
      noPermission: "你不是该步骤的审批角色",
      // WO-BEFE-B · 留痕与撤回（后端 audit/cancel 此前零前端调用方）
      auditTitle: "审批留痕",
      auditEvents: "后端事件",
      auditNoEvents: "该草稿尚无 action.* 事件",
      auditExecution: "执行结果",
      auditNotExecuted: "未执行",
      cancel: "撤回",
      confirmCancel: "确认撤回该 Action 草稿？撤回后不再进入执行，且不可恢复。",
      cancelNoPermission: "仅发起人或管理员可撤回，且执行开始后不可撤",
      submit: "提交审批",
      submitHint: "决策台落下的草稿停在 DRAFT，需提交后才进入审批链",
    },
    catalog: {
      title: "意图目录",
      examples: "示例问句",
      slots: "槽位",
      plan: "绑定执行计划",
    },
    fallback: {
      title: "兜底统计与意图孵化",
      promote: "一键孵化",
    },
    agents: {
      title: "Agent 注册表",
      minScopeHint: "最小授权：仅声明 Agent 实际需要的对象类型与工具",
      builtinTools: "内置工具",
      mcpTools: "MCP 工具",
      workflowTools: "Workflow 工具",
      /**
       * WO-AGENT-ADMIN-CONSOLE · 运行观测台文案（R14：页面不内联业务串）。
       *
       * ⚠️ **本块只写取证证实「后端真有数据」的那些**（`docs/AUDIT-agent-console-gap.md`）。
       * Context Manager 五段（Retriever / Ranker / Compressor / Assembler / Validator）
       * **刻意一个字都没有** —— 取证结论是「无承载物」（全仓仅参考原型 HTML 里一个节点标签），
       * 写了文案就等于给一块永远空着的面板发了通行证。
       */
      console: {
        title: "运行观测",
        subtitle: "本租户经 Agent 路径的真实推演运行",
        refresh: "刷新",
        /** 第一层 KPI（只放数值 + 状态 + 名字，口径一律进 ? 浮层）。 */
        kpiTotal: "AGENT 路径运行",
        kpiCompleted: "已完成",
        kpiFailed: "失败 / 取消",
        kpiRunning: "进行中",
        unitRuns: "次",
        /** 空态：真的没有运行，不是加载失败。 */
        empty: "本租户还没有经 Agent 路径的推演。到任意场景对话坞问一个开放问句即可产生。",
        loading: "加载中…",
        /** 最近运行清单 */
        recentTitle: "最近运行",
        colTime: "时间",
        colQuery: "问句",
        colStatus: "状态",
        colAction: "",
        openDetail: "展开",
        closeDetail: "收起",
        gotoTask: "证据链 →",
        /** 第二层 · 执行状态机 */
        stateMachineTitle: "执行状态机",
        stateReached: "本次到达",
        stateNotReached: "本次未经过",
        /** 第二层 · 工具调用 */
        toolCallsTitle: "工具调用",
        toolCallsEmpty: "本次运行没有工具调用记录。",
        colTool: "工具",
        colOutcome: "结果",
        colDuration: "耗时",
        /** 第二层 · 上下文工程 */
        contextTitle: "上下文工程",
        ctxIterations: "迭代轮次",
        ctxToolCalls: "工具调用",
        ctxTokensIn: "输入 token",
        ctxTokensOut: "输出 token",
        ctxOps: "上下文清理",
        ctxBudgetExhausted: "预算耗尽",
        yes: "是",
        no: "否",
        unitTimes: "次",
        unitRounds: "轮",
        /**
         * 诚实位 ①：上下文清理 0 次不是"没做"，是阈值够不到（#91）。
         * **允许降到浮层，绝不允许删除**；第一层留可见记号（数值本身 + ? 触发器）。
         */
        ctxZeroNote: "本次未触发上下文清理 —— 这是真值，不是缺数据",
        /** 诚实位 ②：引擎根本没跑（未接 LLM provider 的诚实降级）。 */
        noRunTitle: "本次未进入 Agent 循环",
        noRunBody:
          "任务走的是 AGENT 路径，但引擎没有执行工具循环，因此没有运行记录。最常见原因是未接入可用的 LLM 提供商 —— 此时系统会诚实降级并直接作答，而不是空转。",
        noRunCta: "去绑定 LLM 提供商 →",
        noTask: "该任务不存在或不属于当前租户。",
        // -------------------------------------------------------------------
        // WO-AGENTRUN-ATTRIBUTION · 「本 Agent 的运行」——归属已可得的那一半
        // 数据源：GET /b/v1/agents/:id/runs（引擎在 agent/loop.ts finishRun 单点回填归属）。
        // -------------------------------------------------------------------
        agentRunsTitle: "本 Agent 的运行",
        agentRunsSubtitle: "引擎在运行时回填的真实归属，跨版本按同一个 Agent 聚合",
        agentRunsCount: "已归属运行",
        agentRunsEmpty:
          "这个 Agent 还没有运行记录。把它绑到某个场景入口（AGENT_FIRST / AGENT_ONLY）或角色分派上，再去对话坞提问即可产生。注意：未接入可用 LLM 提供商时系统会诚实降级直接作答，那种情况下不产生运行记录 —— 数字为 0 是真值，不是加载失败。",
        agentRunsNoSelection: "在左侧选中一个 Agent，即可看到它自己的历次运行。",
        colModel: "模型",
        colVersion: "版本",
        colIterations: "轮次",
        colTokens: "token（入/出）",
        // -------------------------------------------------------------------
        // WO-BEFE-C · 「本次任务的全部运行」——复数读端 GET /b/v1/queries/:taskId/agent-runs
        //
        // 为什么必须单开一段、不能并进上面那张表：上面那张按 **Agent** 聚合
        // （「这个 Agent 一共跑过几次」），这一段按 **任务** 聚合（「这一次会诊叫了谁」）。
        // 合成一段就再也答不了「其中几次是被会诊叫去的」——那正是本单要让人在屏上看见的那句话。
        //
        // ⚠ 与单数端点的关系是本段最容易搞错的地方：多角色会诊的真实形态是
        // 「0 条顶层 + N 条子运行」，此时单数端点**如实返 404**（上方显示"本次未进入 Agent 循环"），
        // 而本段显示 N 条。两句都是真话，缺任一句都会把一次三角色会诊说成"什么都没跑"。
        // -------------------------------------------------------------------
        taskRunsTitle: "本次任务的全部运行",
        taskRunsSubtitle: "含多角色会诊扇出的子运行（顶层至多一条，扇出可有多条）",
        taskRunsTotal: "本次运行数",
        taskRunsFanout: "其中会诊扇出",
        /** 真空态：0 条是常态不是故障，必须说清楚"什么情况下才会有"。 */
        taskRunsEmpty:
          "本次任务没有任何 Agent 运行记录。走工作流路径、或未接入可用 LLM 提供商被诚实降级直接作答时，引擎都不会进入 Agent 循环 —— 这是真值，不是加载失败。",
        /** 「顶层 0 条但扇出 N 条」——本单最要紧的那句话，不说出来用户只会看到上方的"未进入循环"。 */
        taskRunsRootlessNote:
          "本次任务顶层没有跑 Agent 循环，真正干活的是下面这些被会诊叫去的子运行 —— 所以上方「本次未进入 Agent 循环」与这里的条数**同时为真**，不是矛盾。",
        colStep: "扇出步骤",
        colAgent: "执行 Agent",
        /**
         * WO-AGENTRUN-FANOUT-PERSIST · 「来源」列。
         * 会诊扇出的子运行开始计入之后，**运行数的含义变了** —— 5 次里可能有 3 次是被会诊叫去的。
         * 不标出来，用户会把它读成"这个 Agent 被直接调用了 5 次"。数字变了却不说，就是另一种说假话。
         */
        colOrigin: "来源",
        originRoot: "直接运行",
        originFanout: "会诊扇出",
        originUnknown: "—",
        /** 单次运行的归属形态（三态一一对应契约 attribution 字段；缺失≠EXPLORATORY） */
        attrLabel: "运行归属",
        attrRegisteredPrefix: "本次由 Agent ",
        attrRegisteredSuffix: " 执行",
        attrExploratory: "通用探索路 —— 本次没有任何 Agent 定义参与（引擎正面标记，不是缺数据）",
        attrUnknown: "归属未知 —— 本条运行写于归属上线之前，无从判定属于哪个 Agent",
        /**
         * 诚实位 ③（**降层而非删除**）：归属已经可得，但**只对一部分运行**可得。
         * 原文是「这些运行无法归属到上面选中的 Agent」——那句话在归属上线后已经不成立，
         * 继续挂着就是另一种说假话。现在改成陈述**残余缺口**，且残余缺口一条不少地列出来。
         */
        attributionTitle: "归属已可得，但不是每一次运行都归得上",
        /**
         * 诚实位 ③ 的第二次**降层**（WO-AGENTRUN-FANOUT-PERSIST）：
         * 原文第三类「多角色会诊扇出的子 Agent 运行（今天根本没有落库）」**已经不成立** ——
         * 那些运行现在真落库、真计入、真带标签。继续挂着就是拿一条已修好的缺口冒充缺口，
         * 与当初挂着"一次都归不上"一样是说假话，只是方向相反。
         * 故此处**删掉那一条**，同时在上方列表里加「来源」列把新语义显式说出来（数字变了必须说）。
         * 剩下的两类**一个字都不许删**：它们仍然真的归不上。
         */
        attributionBody:
          "上方「本 Agent 的运行」是引擎真回填的归属，可信，且已包含多角色会诊扇出的子运行（每行在「来源」列标明是直接运行还是会诊扇出）。下方「本租户 AGENT 路径运行」仍是租户级清单，其中两类运行归不到任何 Agent 头上：① 通用探索路（自由问句进探索模式，工具集当场按场景包白名单组装，全程没有 Agent 定义）；② 归属上线之前写下的旧记录。展开任意一次运行可看到它自己的归属形态。",
        /** ? 浮层（口径 · 公式 · 为什么这么算 · 数据来源） */
        info: {
          attribution: "哪些运行归得上、哪些归不上",
          attributionBody:
            "运行记录（AgentRunRecord）现在带 agentId / agentKey / agentVersion / 归属形态，由引擎在 Agent 循环收尾时与运行数据同一次写入 —— 所以「谁跑的」和「跑出了什么」不会各说各话。归属形态只有两种正值：REGISTERED（真解析了某一版 Agent 定义，如场景入口 Agent、角色 Agent）与 EXPLORATORY（本次确实没有 Agent 定义）。字段整体缺失是第三种情况：归属上线前的旧记录，属于未知，不会被当成 EXPLORATORY 混算。归属之外还有一个正交的维度：这次运行是这个任务自己跑的（直接运行），还是被多角色会诊扇出去的子运行（会诊扇出）。两者都算这个 Agent 真跑过一次，都计入上面的数字，「来源」列标明是哪一种 —— 此前会诊扇出的子运行根本不落库（运行记录曾以任务为唯一键，一个任务只存得下一条），那部分次数在全仓不可见，现在已经补上。",
          contextOps: "上下文清理的触发口径",
          contextOpsBody:
            "三种清理动作：折叠最旧一轮工具结果 · 服务端压缩 · 强制收尾。三者共用同一道软阈值：模型上下文窗口与 20 万 token 取小，再乘 0.7。默认 20 万窗口下软阈值是 14 万，而系统自身预算上界（工具调用次数上限 × 单条工具结果 8KB 硬截断）允许的最坏上下文约 10.3 万 —— 够不到，所以默认路上一次都不会触发。换成 12.8 万及以下窗口的提供商，同一份上下文就会触发。够不到的真正原因是上游两道防线在正常工作，属设计正确，不是缺陷。",
          stateMachine: "执行状态机的口径",
          stateMachineBody:
            "七个状态来自查询任务的状态枚举：路由中 · 等待澄清 · 执行工作流 · 执行 Agent · 已完成 · 失败 · 已取消。一次运行只会落在其中一个终态上；灰色的是本次没有经过的状态，不代表它不存在。",
          tokens: "token 计数的口径",
          tokensBody:
            "只统计 Agent 工具循环那部分的输入/输出 token，不含意图分类与文本组装的开销 —— 因为那两处的接口不外透用量。所以这个数是下界，不是全量成本。",
        },
        /** 状态机七态显示名（与后端枚举一一对应，勿另造词） */
        states: {
          ROUTING: "路由中",
          AWAITING_CLARIFICATION: "等待澄清",
          EXECUTING_WORKFLOW: "执行工作流",
          EXECUTING_AGENT: "执行 Agent",
          COMPLETED: "已完成",
          FAILED: "失败",
          CANCELLED: "已取消",
        },
      },
    },
    workflows: {
      title: "Workflow 编辑器",
      addStep: "添加步骤",
      moveUp: "上移",
      moveDown: "下移",
      cycleError: "检测到循环调用",
    },
    planBuilder: {
      title: "计划构建画布",
      newCanvas: "新建画布",
      listGroup: (key: string) => `${key}（按 key 分组）`,
      version: (v: number, status: string) => `v${v} · ${status}`,
      canvas: "画布",
      properties: "属性",
      dsl: "DSL (JSON)",
      dslHint: "画布与 DSL 双向等价（R24）。直接编辑 JSON 会同步回画布节点。",
      nodeTypes: {
        INPUT: "输入",
        SOLVER: "求解器",
        TRANSFORM: "转换",
        CONDITION: "条件",
        LOOP: "循环",
        MERGE: "合并",
        OUTPUT: "输出",
      },
      addNode: "添加节点",
      addEdge: "添加边",
      fromNode: "源节点",
      toNode: "目标节点",
      selectTarget: "选择目标…",
      label: "标签",
      solverKey: "求解器",
      stepType: "转换类型",
      args: "参数",
      params: "参数",
      timeoutMs: "超时(ms)",
      onError: "错误处理",
      blocks: "输出块",
      noCanvas: "暂无画布，点击新建",
      compile: "编译验证",
      compileOk: "验证通过",
      publish: "发布画布",
      publishOk: "发布成功",
      run: "试运行",
      runOk: "试运行完成",
      runResult: "运行结果",
      errors: "错误",
      cycleDetected: "检测到环",
      unsaved: "未保存",
    },
    mcp: {
      title: "MCP 服务器",
      test: "连接测试",
      discoveredTools: "tools/list 发现结果",
    },
    scenes: {
      title: "场景入口配置",
      featureOff: "功能未开通",
    },
    tenants: {
      title: "租户管理",
      create: "创建租户",
      key: "租户键",
      name: "名称",
      industry: "行业",
      status: "状态",
      createdAt: "创建时间",
      firstAdmin: "创建首个 tenant_admin",
      firstAdminEmail: "管理员邮箱",
      created: "租户已创建",
      adminCreated: (pw: string) => `tenant_admin 已创建，初始密码：${pw}（仅此一次展示）`,
    },
    users: {
      title: "用户管理",
      create: "新建用户",
      email: "邮箱",
      displayName: "显示名",
      roles: "角色",
      attributes: "属性",
      status: "状态",
      lastLoginAt: "最近登录",
      resetPassword: "重置密码",
      resetDone: (pw: string) => `新密码：${pw}（仅此一次展示，TODO 邮件下发）`,
      roleParam: "角色参数（如 区域/基地名）",
      addRole: "添加角色",
      disable: "禁用",
      enable: "启用",
      attributesEditor: "属性编辑器（JSON）",
      saved: "已保存",
      lastAdmin: "最后一个 ACTIVE 的 tenant_admin 不可禁用",
    },
    views: {
      title: "视图配置",
      create: "新建视图",
      viewKey: "viewKey",
      titleField: "标题",
      renderer: "渲染器",
      navPosition: "导航位置",
      navGroup: "导航分组",
      featureState: "功能状态",
      rolesField: "可见角色",
      widgets: "Widget 列表",
      addWidget: "添加 Widget",
      graphOptions: "GraphOptions",
      paramsForm: "数据范围参数",
      moveUp: "上移",
      moveDown: "下移",
      deleteCascade: "删除将级联影响以下引用，确认删除？",
      saved: (v: number) => `已保存（configVersion ${v}）`,
      featureRegistered: (k: string) => `已自动注册功能 ${k}（默认开）`,
    },
    rules: {
      title: "规则库",
      create: "新建规则",
      editor: "规则编辑器",
      expression: "expression（违规条件 DSL）",
      dryRun: "测试（dry-run）",
      dryRunPayload: "样例载荷（JSON）",
      dryRunHit: "命中违规条件",
      dryRunPass: "未命中（通过）",
      syntaxError: (pos: number) => `语法错误 @ 字符 ${pos}`,
      originManual: "MANUAL",
      originDocument: "DOCUMENT",
      originSynthetic: "SYNTHETIC",
      // WO-RULES-CLASSIFY：分类筛选 + 约束条件独立入口
      category: "类别",
      categoryOptional: "可选",
      categoryPlaceholder: "如 产能/物料/财务",
      uncategorized: "未分类",
      viewAll: "全部",
      viewConstraint: "约束条件",
      viewGeneral: "一般规则",
      filterByCategory: "按类别筛选：",
      filterClear: "清除",
      filterEmpty: "当前筛选条件下无规则",
    },
    empty: {
      connections: "暂无连接 —— 上传文件或创建连接开始接入数据",
      connectionsCta: "上传文件或创建连接",
      ontology: "暂无本体 —— 从数据建模或一键合成开始",
      modelingCta: "从数据建模",
      syntheticCta: "一键合成",
      intents: "暂无意图 —— 创建意图或从兜底记录孵化",
      intentsCta: "创建意图",
      incubateCta: "从兜底记录孵化",
      agents: "暂无 Agent —— 从模板预填创建第一个 Agent",
      agentsCta: "创建 Agent（模板预填）",
    },
    features: {
      title: "功能开通配置",
      tenantTab: "租户功能树",
      roleTab: "角色覆盖",
      preview: "以角色预览",
      tenantOff: "租户未开通",
      bindingSummary: (i: number, s: number) => `${i} 个意图 / ${s} 个求解器`,
      saved: "已保存，配置版本 +1",
      parentOff: "父级已关闭",
    },
    sliceLibrary: {
      title: "切片库",
      sub: "域内/跨域两库（A3.2 派生）：从已发布本体确定性派生，零假数据；空态诚实。",
      tabLibrary: "切片库",
      tabPlan: "规划",
      colSliceKey: "切片键",
      colScope: "范围",
      colRoot: "根类型",
      colDomains: "跨越域",
      colTypeCount: "类型数",
      scopeIntra: "域内",
      scopeCross: "跨域",
      emptyLibrary: "切片库为空 —— 当前租户无已发布本体或本体未形成可派生切片",
      planTitle: "切片规划",
      planSub: "输入 root 类型与目标类型，经 A3.3 确定性图算法求最短路径；命中既有切片则复用。",
      rootType: "根类型（rootType）",
      targets: "目标类型（每行或逗号分隔）",
      maxHops: "最大跳数",
      question: "近似问句（可选，用于复用匹配）",
      submitPlan: "规划路径",
      planning: "规划中…",
      resultTitle: "规划结果",
      reused: "复用既有切片",
      spannedDomains: "跨越域",
      pathTarget: "目标",
      pathHops: "路径（linkKey / direction / toType）",
      noPath: "无可达路径",
      unreachable: (list: string) => `不可达目标：${list}`,
    },
    // WO-SLICE-16-LAYERS · 本体切片十六层结构（层名/状态/说明文案单一来源，R14 不内联业务常数）。
    sliceLayers: {
      title: "十六层结构",
      // 第一层只放结论（CONVENTION-ui-information-layering §1）：一句话说清"这条切片覆盖了几层"。
      headline: (present: number) => `${present}/16 层有数据`,
      sub: "点层卡展开明细。计数为本切片实取，非示例值。",
      // 层名（① … ⑯，顺序即 ordinal，不可重排）
      names: {
        business_scenario: "业务场景",
        decision_intent: "决策意图",
        object: "对象",
        property: "属性",
        relation: "关系",
        event: "事件",
        state: "状态",
        metric: "指标",
        time: "时间",
        rule: "规则",
        constraint: "约束",
        data_binding: "数据绑定",
        scenario: "场景",
        evidence: "证据",
        action: "行动",
        governance: "治理与溯源",
      } as Record<string, string>,
      statusPresent: "有数据",
      statusNotInSlice: "本切片未纳入",
      statusAbsent: "缺席",
      // WO-SLICE-DEFAULT-ARGS：第四态「未判定」。子图没解出来时这十六层**压根没被算过**，
      // 此时显「0 · 缺席」是静默错答——它说的是「查过了，平台没有」，真相是「没查成」。
      // 「算不了」「查了确实为空」「后端出错」必须是屏上三件不同的事。
      statusPending: "未判定",
      pendingNum: "—",
      pendingHeadline: "十六层暂未判定",
      pendingSummary: "子图未解出 ⇒ 各层还没被算过（不是「平台没有」）。先给出 root 实参再看层。",
      // 三态各自的一句话结论（第一层只放结论，口径/原因进浮层）
      summaryLine: (present: number, notInSlice: number, absent: number) =>
        `${present} 层有数据 · ${notInSlice} 层平台有但本切片未纳入 · ${absent} 层缺席`,
      platformHas: (n: number, unit: string) => `平台有 ${n} ${unit}`,
      carrierLabel: "承载物",
      reasonLabel: "为什么没有",
      whyLabel: "口径说明",
      emptyItems: "该层无明细可展开",
      graphSummary: (n: number, e: number) => `子图 ${n} 个节点 · ${e} 条边`,
      truncated: "已截断",
      argsLabel: "试切参数（JSON）",
      reload: "重新取数",
      loading: "解析十六层…",
      error: "十六层解析失败",
      // 诚实位（绝不删除，只允许降层）：说明这一页为什么可能显示空。
      honesty:
        "缺席的层不画占位内容——本平台宁可显示空并说明为什么，也不画假数据。",
      // ── 子图未解出（graph.empty）· 真后端实测（2026-08-10，demo/seed 42）：
      //    98 条切片里 12 条无参即空子图，其中 4 条正是首屏默认显示的多跳业务切片
      //    ⇒ 不说清楚就等于"页面又是空的"。
      //    复验：`GET /a/v1/ontology/slices` 取全表，逐条 `GET /a/v1/ontology/slices/{key}/layers`
      //    （不带 args），看 `graph.empty.reason`；判定实现见
      //    `apps/datacore/src/ontology/slice-layers.ts (diagnoseEmptyGraph)`。
      //    第一层只放**短结论**（状态 + 缺哪个参数名），长说明降到浮层（R-UI-3）。
      empty: {
        // 短结论（第一层）：一眼看出「不是十六层没有，是子图没解出来」
        titleMissingArgs: "子图未解出 · 缺试切参数",
        titleNoRootObjects: "子图未解出 · 根类型零对象",
        titleNoMatch: "子图未解出 · 过滤无匹配",
        // 状态徽标（第一层允许：这是"状态"）
        badge: "十六层暂未判定",
        needArgs: (args: string) => `需要参数：${args}`,
        rootTotal: (typeKey: string, n: number) => `${typeKey} 共 ${n} 个对象`,
        // 候选值（真对象上读出来的，不是示例值）
        pickLabel: (arg: string) => `选一个真实 ${arg} 试切`,
        noCandidates: "取不到候选值（诚实留白：不拿假值凑）",
        inputLabel: (arg: string) => `或自填 ${arg}`,
        apply: "试切",
        clear: "清空参数（看原始诚实态）",
        applied: (pairs: string) => `当前试切参数：${pairs}`,
        whyLabel: "为什么是空的",
        // ── WO-SLICE-DEFAULT-ARGS：首屏默认实参（修法 B）────────────────────────
        // 首屏默认那 4 条多跳切片的 root selector 全带 {{args.X}}，调用侧传 {} ⇒ 十六层全空。
        // 默认值**取自后端从真实 root 对象读出的候选**（零写死 · R14），并必须公示在屏上：
        // 悄悄替用户选一个还不说，比空卡更坏。
        autoDefaultBadge: "默认实参 · 自动取自真实数据",
        autoDefaultWhyLabel: "这个默认值哪来的",
        autoDefaultWhy:
          "这条切片的 root selector 声明了 {{args.X}} 占位符，不给实参则过滤恒不匹配、十六层全空。" +
          "默认实参取自后端在本租户**真实 root 对象**上读出的候选值（按 objectKey 字典序取第一个，同快照同结果），" +
          "不是写死的示例值；取不到真实候选时不猜不编，直接回到「需要参数，请先选择」的诚实态。",
        switchLabel: (arg: string) => `换 ${arg}`,
      },
    },
  },

  // 全局推演「活系统」升级（WO-GSLIVE-1-COCKPIT · 自由杠杆 / 人机对话 / 方案存分比）。additive。
  gslive: {
    // 活②·自由变量推演（portfolio levers[] 血脉·非 generic_inference）
    freeLevers: "自由调节杠杆 · 改任意变量后重新排产",
    freeLeversHint: "拨动或新增任意「调节杠杆」（例如给某基地日产能加 1 条线），系统会立即重新联合排产，并给出调节前后 7 项关键指标的对比（每个数字都能追溯来源）。与上方预设杠杆并存。",
    candidatesTitle: "推荐可调的杠杆（按产能占用率反推 · 最紧张的基地排在前）",
    noCandidates: "先点「发起联合求解」，系统会根据产能占用情况推荐可调的杠杆。",
    addCustom: "新增自定义杠杆",
    leverKeyPlaceholder: "变量键（如 capacityDaily）",
    add: "加入",
    remove: "移除",
    activeTitle: "已生效的调节杠杆（参与本轮联合排产）",
    noActive: "暂无自由杠杆 · 点上方推荐项或「新增」来调节任意变量。",
    deltasTitle: "调节前后对比 · 7 项关键指标 调节前 → 调节后（每个数字可追溯到具体杠杆）",
    noDeltas: "拨动杠杆后，这里显示调节前后的指标对比。",
    leverKeys: {
      capacityDaily: "日产能",
      formationChannels: "化成通道",
    },
    kpiDims: {
      ontime: "按期项",
      cost: "综合代价",
      // 量纲走 contracts KPI_DIM_UNITS（WO-UNIT-MEANING·i18n 只管文案不内联单位）
      changeoverHours: "换型",
      freight: "在途运费",
      fgInv: "成品库存",
      transitInv: "在途库存",
      margin: "毛利代理",
    },
    // 活①·人机对话
    nlTitle: "人机对话 · 自然语言问全局推演",
    nlHint: "用大白话提问（例如「把大客户排在前面，整体按期率会怎么变？」「储能份额提到 30% 要加多少产线？」），系统会逐个方案联合排产并给出文字解读，数字都可追溯来源。",
    nlPlaceholder: "例：把 SO-3437 排在小客户前，整体按期率与被挤单怎么变？",
    nlSubmit: "问一句",
    nlSubmitting: "联合求解中…",
    nlAnswerTitle: "联合排产解读",
    nlPathBadge: (p: string, ran: boolean) => `路径：${p === "compose" ? "联合排产解读" : p} · 是否调用智能体=${ran ? "是" : "否"}`,
    // 活③·方案存/分支/横比
    scenarioTitle: "方案 存 / 分支 / 并排对比（7 项关键指标 × 各方案）",
    scenarioHint: "把当前推演（含自由杠杆 / 目标）存为命名方案 → 做出变体分支 → 并排对比 → 一键采纳并走审批（不直接改动排产数据）。",
    saveLabelPlaceholder: "方案名（如 A·最多按期+常州扩产）",
    saveScenario: "存为方案",
    saving: "存档中…",
    branch: "分支",
    branching: "分支中…",
    adopt: "采纳（→ Action 审批）",
    adopting: "生成草稿中…",
    noScenarios: "先「存为方案」保存一次推演，再分支/横比。",
    needTwo: "存 ≥2 个方案（或分支）以横比。",
    matrixMetric: "指标 / 方案",
    metricServed: "获排单",
    metricDisplaced: "被挤单",
    metricOntimeRate: "按期率(%)",
    adopted: (label: string, status: string) => `已采纳「${label}」→ Action 草稿 ${status}`,
  },
  /**
   * WO-CAPACITY-CARD-LAYOUT · 产能推演「可用产能派生诊断（自下而上 6 层）」卡片布局文案。
   *
   * R14（应用层无业务常数）：**壳文案**在这里；**公式与层名不在这里** ——
   * 那些是 `views/capacity/factorOntology.ts` 的 `ONTO_LAYERS[].role / .name`（单一来源），
   * 抄进本文件就是给它开一条会漂的分身。本块只放"框"，"瓤"仍从本体表取。
   *
   * 唯一的例外是 `honesty`：那句诚实位原本内联在组件里，本单把它从常驻正文
   * 降到 `?` 浮层，按 R-UI-3「浮层文案一律走 locales」搬到这里，**一字未改**。
   */
  capDag: {
    title: "🧮 可用产能派生诊断（自下而上 6 层）",
    sub: (baseName: string, available: string) => `${baseName} · 可用 ${available} 套如何逐层算出`,
    loading: "派生链加载中…",
    unavailable: "派生求解器不可用（诚实空·未伪造）",
    /** 卡片链容器的 aria 说明（递进承载物③ 之一：不靠视觉也读得出方向）。 */
    chainAria: "可用产能派生链 · 自下而上 6 层 · 设备产能 → 工序产能 → 产线产能 → 可投产能 → 产能预测 → 产能缺口",
    step: (n: number) => `第 ${n} 层`,
    /** 卡面 aria-label：把「第几层 / 由谁推出 / 数值 / 状态」压成一句，读屏不必扫视。 */
    cardAria: (step: number, name: string, valueLabel: string, value: string, status: string, from: string) =>
      `${from}${step}. ${name}；${valueLabel} ${value}；状态 ${status}。回车展开本层明细`,
    fromStep: (n: number, name: string) => `由第 ${n} 层 ${name} 推导得出 · `,
    fromNone: "推导链起点（不由上游推出）· ",
    rungAria: (n: number) => `推导链第 ${n} 级 / 共 6 级`,
    /** `?` 浮层（第三层：凭什么）。 */
    formulaTopic: (step: number, name: string) => `第${step}层 ${name} · 口径与公式`,
    formula: (role: string) => `公式：${role}`,
    anchorOf: (label: string, field: string, kind: string) => `本层锚点：${label} · 溯源字段 ${field}（${kind}）`,
    upstream: (n: number, name: string) => `上游 ← 第${n}层 ${name}`,
    upstreamNone: "上游 ← 无（推导链起点：设备层）",
    downstream: (n: number, name: string) => `下游 → 第${n}层 ${name}`,
    downstreamNone: "下游 → 无（推导链终点：本页要回答的那个数）",
    /** 状态词：与形状、颜色三通道并行，不靠颜色单通道。 */
    status: {
      ok: "好",
      warn: "警",
      crit: "危",
      /** 该层锚点是派生量、没有阈值 —— 诚实说"没有状态"，不臆造一个。 */
      derived: "派生值·无阈值",
      /** 无 LIVE 真源（tightness 为 null）。 */
      na: "无真源",
    },
    /** 第二层（一次点击）。 */
    detailHint: "点任一层卡片 → 看该层的判定 / 驱动因素 / 溯源字段",
    detailTitle: (step: number, name: string) => `第 ${step} 层 · ${name} · 明细`,
    detailClose: "收起明细",
    judge: "判定：",
    drivers: "驱动因素：",
    derive: "推导：",
    factorAria: (mark: string, name: string, layer: number) => `本体 ${mark} ${name}（第 ${layer} 层）`,
    /** 诚实位：正文降到浮层，第一层留 `honestyMark` 这个可见记号（静默降层 = 删除）。 */
    honestyMark: "口径·溯源",
    honestyTopic: "口径与溯源（诚实位）",
    honesty:
      "6 层沿产能金字塔既有派生链路（本体 §3·不改链路，仅可视化）；锚点真值溯 base_capacity_outlook.available/gap，各层瓶颈张力溯 bottleneck_matrix（R13 每值可溯·R14 因素表单源 factorOntology）。",
  },
  /**
   * WO-WAITING-STATES-FE · 业务流程等待态（需求 §20「『等待』是一等状态」）。
   *
   * 🔴 四态**四套文案，一个字都不许合并**。需求判据原文：
   * 「每个态都要有可辨识的视觉区分（不是 5 个都显示同一个『等待中』）——
   *   需求要的是回答『为什么卡住』，5 个态混成一个字就等于没做」。
   * 故每态给三样互不相同的东西：`label`（叫什么）· `who`（**等谁**·本页的核心answer）·
   * `hint`（判据原文，逐字取自 `packages/contracts/src/process.ts:70-75`，前端不改写）。
   *
   * 🔴 **没有 WAITING_APPROVAL**，且不许"顺手补齐成五种"。仓主已裁「流程审批不体现」；
   * 契约 `PROCESS_WAIT_KINDS` 刻意四值，`process-layer.test.ts:99/106/114` 三条断言钉着。
   * 本对象的类型是 `Record<ProcessWaitKind, …>`（见 `views/process/processWait.ts`）
   * ⇒ 契约哪天真加了第五态，**这里编译期就红**，不会静默漏画。
   */
  processWait: {
    title: "流程等待态",
    subtitle:
      "13 个一级业务域 × 65 条核心业务流程，每条标注它**卡在哪一类等待**、**等谁**、**标准要等多久**。" +
      "这一页回答的是「为什么这个流程现在卡住了」——按等待类型分组，而不是笼统一个「等待中」。",
    sourceNote: "数据来源：GET /a/v1/process-definitions（业务流程层配置，非引擎实时求解）。",
    /** 与全链阻滞点的分工说明——两页容易被当成一回事，页面上直接写清楚。 */
    vsImpediments:
      "与「全链阻滞点」不是同一件事：那一页在**链路节拍层**（24 个节点）问「哪里被卡住了、凭哪条规则说它被卡住」，" +
      "用引擎实时求解；本页在**业务流程层**（65 条流程）问「这条流程在等哪一类东西、等谁」，读的是流程层配置。",
    waitKind: {
      WAITING_USER: {
        label: "等人",
        short: "等人做动作",
        who: "等**内部的人**拿主意或做动作 —— 评审、拍板、录入、维护。责任落在下方的职能上。",
        hint: "判据：等人做动作/拿主意（评审、拍板、录入、签字以外的操作）。",
      },
      WAITING_DATA: {
        label: "等数据",
        short: "等上游数据齐",
        who: "等**上游数据齐**才能起算 —— 人到位也没用，缺的是输入。典型如预测、MRP、良率分析、指标监控。",
        hint: "判据：等上游数据齐才能算（预测、MRP、良率分析、指标监控）。",
      },
      WAITING_EXTERNAL_SYSTEM: {
        label: "等外部",
        short: "等外部回话",
        who: "等**企业外面**回话 —— 供应商、海关、客户、行情源、设备网关。催内部没有用，工期不由我方决定。",
        hint: "判据：等外部方/外部系统回话（供应商、海关、客户、行情源、设备网关）。",
      },
      WAITING_SCHEDULE: {
        label: "等节拍",
        short: "等窗口开闸",
        who: "等**到点开闸** —— 例会、批次、班次、检修窗、盘点日。没人在拖，是窗口还没到。",
        hint: "判据：等节拍/窗口开闸（例会、批次、班次、检修窗、盘点日）。",
      },
    },
    summary: {
      totalProcesses: "在册流程",
      totalStdDays: "标准工期合计",
      unit: { process: "条", day: "天" },
      byKind: "按等待类型分布",
    },
    group: {
      countLabel: (n: number) => `${n} 条流程`,
      stdDaysLabel: (d: number, pct: number) => `标准工期合计 ${d} 天（占全部 ${pct}%）`,
      owners: "等谁（责任职能）",
      empty: "本租户暂无此类等待的流程 —— 这是真实读数，不是没渲染。",
    },
    table: {
      key: "流程",
      name: "名称",
      domain: "业务域",
      owner: "责任职能",
      stdDays: "标准工期",
      carrier: "承载物",
    },
    /**
     * 诚实缺席位（本仓纪律：缺席要说出来，不许拿别的数字冒充）。
     * `ProcessTask` / `ProcessInstance` 全仓不存在（PRD §5 的 E2 未实现），
     * 故「此刻已经卡了多久」今天答不了；页面只给标准工期并写明它不是实测。
     */
    honesty: {
      title: "本页答得了什么、答不了什么",
      canAnswer:
        "答得了：卡在哪一类等待（四态）· 等谁（责任职能）· 标准要等多久（工期基线）。" +
        "点开任一条流程还能看到**实例粒度**：哪一条单据卡着 · 卡在谁那里 · 卡了多久 · 站间流转多久。",
      cannotAnswer:
        "答不了（诚实边界，一条都没放宽）：① 实例时刻是从**既有带时间戳单据反推**的（推导值，不是流程引擎直采的实测值）；" +
        // 「9/65」是**实测值**，故按 stale-claims 门的两条要求把日期与复验方式**写进文案本身**
        // （写在注释里门看不见，用户也看不见 —— 没有日期就没有保质期：
        //  上游种子一变这个数会静默失真，而界面照旧言之凿凿）。
        "② 65 条流程里只有 9 条反推得出，其余 56 条会明说「缺哪种单据」并给复验探针，**不会返回 0 冒充「没有卡顿」**。" +
        "（**2026-08-13 实测**·battery/S/seed=42；复验：`curl -s -H 'X-Debug-User: demo:admin:admin' " +
        "'http://127.0.0.1:4001/a/v1/process-definitions/P34/instances' | jq '{available,instanceCount}'`，" +
        "逐条清单见 `docs/WO-FLOWTIME-feasibility.md`；上游种子若变，此数必须复测改写而不是加豁免。）",
      notMeasured: "下方「标准工期」是流程定义里的**基线工期**，不是实测滞留天数 —— 不要当作「已卡 N 天」读。",
    },
    /** WO-FLOWTIME · 实例下钻面板（点某条流程 → 看它的实例与站间流转时长）。 */
    instances: {
      open: "看实例",
      close: "收起",
      loading: "反推流程实例中…",
      titleFor: (key: string) => `${key} · 流程实例与站间流转时长`,
      asOf: (d: string, src: string) => `分析截止时刻 ${d}（来源 ${src}）`,
      asOfHint:
        "「分析截止时刻」缺省取**数据里观测到的最晚时刻**（不是 wall-clock，也不是预测窗起点）——" +
        "流转时长是回溯分析，它的「现在」应当是数据的最后一刻。",
      originNote:
        "⚠ 下列天数**全部由既有带时间戳单据反推**（推导值，可逐条溯回单据 id + 字段名 + 该字段原值），" +
        "不是流程引擎直采的实测值，更不是标准工期。",
      stdCompare: (d: number) => `对照：标准工期 ${d} 天（定义值，非实测）`,
      counts: (n: number, stuck: number) => `${n} 条实例，其中 ${stuck} 条到截止时刻仍卡着`,
      table: {
        instance: "实例",
        carrier: "承载单据",
        entered: "入站",
        exited: "出站",
        dwell: "站内停留(天)",
        gap: "到下一站(天)",
        owner: "卡在谁那里",
        wait: "等待类型",
        source: "溯源",
      },
      stillIn: "仍卡着",
      done: "已出站",
      noGap: "—",
      /** 反推不出：明说缺什么 + 怎么复验，不是空表也不是 0。 */
      absentTitle: "这条流程反推不出流转时长",
      absentKind: (kind: string) => `缺席类型：${kind}`,
      absentProbe: (probe: string) => `复验探针：${probe}`,
    },
    state: {
      loading: "加载流程等待态…",
      empty: "后端未返回任何流程定义。业务流程层种子由 SEED_DEMO 播入；未播种时此处为空是正常的。",
      errorTitle: "取不到流程等待态",
    },
    /**
     * WO-V4-INSPECT · 节点检视面板的**界面骨架文案**（PRD-sandbox-v4 §4.2）。
     *
     * ⚠ 这里只放**骨架**（区块标题 / 表头 / 空态句 / 三态名），
     * **一个业务词都不许放** —— 流程名 / 域名 / 职能名 / 对象类型中文名 / 属性中文名 / 单位
     * 全部随 `/inspect` 响应下发（R14 零写死词表）。哪天有人往这里加一个业务名词，
     * 就是在复制「两个 dev 各发明一套词表、交集为 0」那次事故。
     */
    inspect: {
      title: "节点检视",
      close: "关闭",
      loading: "加载本流程的本体关系…",
      errorTitle: "取不到本流程的检视投影",
      openHint: "点开任意一行查看该流程的完整本体关系",
      section: {
        process: "流程属性",
        runtime: "本页答不了什么（运行态诚实位）",
        carrier: "承载物（对象类型）",
        relations: "一跳关系",
        shared: "同承载物的其它流程",
        levers: "打到这个承载物的杠杆",
        layers: "十六层三态",
      },
      field: {
        name: "名称",
        domain: "业务域",
        owner: "责任职能",
        waitKind: "等待类型",
        stdDays: "标准工期（天）",
        carrier: "承载类型",
      },
      carrier: {
        objectCount: (n: number) => `本租户 ${n} 个对象`,
      },
      propTable: {
        propKey: "属性键",
        displayName: "中文业务名",
        dataType: "类型",
        unit: "单位",
        flags: "标记",
        pk: "主键",
        derived: "派生",
        /** 中文名缺省 = 业务含义未确证，如实说，不臆造（WO-SCHEMA-ZH 留白纪律）。 */
        noZhName: "未登记中文名",
      },
      relations: {
        empty: "本承载类型在本体链路表里没有任何一跳关系 —— 这是真实读数，不是没渲染。",
        objectCount: (n: number) => `对端 ${n} 个对象`,
        /** null ≠ 0：对端类型压根不存在，与「存在但没数据」是两件事。 */
        typeMissing: "对端类型在本体里查不到",
      },
      shared: {
        empty: "没有别的流程与它共用同一个承载物（一对一，不是漏查）。",
      },
      levers: {
        empty: "今天没有任何登记杠杆落在这个承载类型上 —— 这是真实读数，不是没渲染。",
        landing: (where: string) => `落点解析于 ${where}`,
        dead: "落点属性不存在（死杠杆）",
        reach: (domains: string, n: number) => `打到 ${n} 条流程 · 业务域：${domains || "无"}`,
      },
      layers: {
        summary: (present: number, notInSlice: number, absent: number) =>
          `有数据 ${present} 层 · 未纳入 ${notInSlice} 层 · 缺席 ${absent} 层`,
      },
      /** 三态名（与后端 `SliceLayerStatus` 一一对应；三态含义不同，绝不合并成"有/无"）。 */
      layerStatus: {
        present: "有数据",
        not_in_slice: "平台有·本次未纳入",
        absent: "缺席",
      } as Record<string, string>,
      /**
       * 十六层的中文名（键 = 契约 `SLICE_LAYER_IDS`，**结构词不是业务词**）。
       * 查不到即回落层 id 原文，不臆造。
       */
      layerName: {
        business_scenario: "① 业务场景",
        decision_intent: "② 决策意图",
        object: "③ 对象",
        property: "④ 属性",
        relation: "⑤ 关系",
        event: "⑥ 事件",
        state: "⑦ 状态",
        metric: "⑧ 指标",
        time: "⑨ 时间",
        rule: "⑩ 规则",
        constraint: "⑪ 约束",
        data_binding: "⑫ 数据绑定",
        scenario: "⑬ 场景",
        evidence: "⑭ 证据",
        action: "⑮ 行动",
        governance: "⑯ 治理与溯源",
      } as Record<string, string>,
    },
    /** 词表漂移（后端下发词表 ≠ 契约词表）——接缝断了要显式报，不许默默少画一组。 */
    drift: {
      title: "⚠ 等待类型词表漂移",
      missing: (keys: string) => `契约里有、后端没下发：${keys}`,
      unknown: (keys: string) => `后端下发了、契约里没有：${keys}（前端不会渲染它，因为词表单源在契约）`,
    },
  },
} as const;

export type Locale = typeof zh;
export default zh;
