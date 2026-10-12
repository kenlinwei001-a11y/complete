# WO-CAPACITY-DEEPEN-ADDITIVE · 产能推演「纯增量深化」施工单

> 一句话：**现页产能推演一个功能、一个像素都不动，只在 `RiskDetailPanel`（基地卡展开层）里"插入" 4 个新块**，把"只出结论"升级成"看得见派生过程 + 逐因素归因 + 每产品瓶颈"。
>
> 铁律：**不是重画、不是重排、不是融合成新页 —— 是纯增量。**

---

## 🚦 范围边界（只碰这些·这是本单的身份）

**允许改（增量）**
- `apps/frontend-shell/src/views/RiskBoardView.tsx` —— **仅在 `RiskDetailPanel` 内插入 4 个新子组件的挂载点**（≤6 行 JSX 插入），现有 JSX 一行不删不改。
- `apps/frontend-shell/src/views/RiskBoardView.module.css` —— **仅追加**新类，**复用现有 CSS 变量**（`--c-solver/--c-forecast/--danger/--muted/--muted2/--panel…`），禁新配色。
- `apps/frontend-shell/src/views/BaseOutlookPanel.tsx` —— **仅加一个"按产品/按基地"切换**（现"按基地"视图零改，加一个 tab 分支）。
- **新增文件**（互不污染现有）：
  - `apps/frontend-shell/src/views/capacity/CapacityDerivationDag.tsx`（块A）
  - `apps/frontend-shell/src/views/capacity/CapacityRampEnvelope.tsx`（块B）
  - `apps/frontend-shell/src/views/capacity/factorOntology.ts`（块C·20因素本体表）
  - 对应 `*.module.css`（可选，或并入 RiskBoardView.module.css 追加段）
- **后端（块D）**：`base_capacity_outlook` 求解器 + `packages/contracts` 输出 schema —— **仅加 `byModel` 字段**（现有 per-base 字段零改）。

**禁止改**
- 现有任何组件的既有 JSX/逻辑/testid（`risk-timeline` / `rootcause-panel` / `mitigation-matrix` / `risk-plan-table` / `risk-qa-*` / `risk-order-*` / `risk-kpi` / 基地卡 …全部照旧）。
- 现有 CSS 类的颜色/尺寸。
- 双 tab、窗口选择、历史案例、订单聚合 tab —— 全部不动。

---

## 铁约束（复验头号判据，违反即退）

1. **功能 100% 保留** —— 现页全部 testid/交互照旧。**硬证据 = 现有 `RiskBoardView` 相关测试一条不改、全绿**（新块只是"多出来"的）。若为通过而改了现有断言 → 退。
2. **颜色/风格 100% 复刻现页** —— 4 个新块**只准用 `RiskBoardView.module.css` 现有类 + 现有 CSS 变量**渲染，**禁止引入任何新色值/新字号体系**。视觉上新块必须"长得就像本来就在这页里"。审核方会像素级比对新块与现页色板一致性。
3. **R13 每值可溯** —— 新块每个数字标出处求解器字段（`capacity_forecast` / `bottleneck_matrix` / `gap_attribution` / `base_capacity_outlook`）。
4. **R14 无写死** —— 20 因素表、派生系数、爬坡子曲线来自数据/配置，不内联字面量伪造。
5. **R6 确定性** —— 同 seed 同输入，byModel/派生/爬坡字节级一致（禁 `Date.now`/随机）。

---

## 4 个增量块（插入位置 + 干什么 + 数据源）

> 现页 `RiskDetailPanel` 现有顺序：①产能影响对象全景+时间轴 → ②🌳根因推演树 → ③`BaseOutlookPanel`前瞻四线 → ④缓解方案矩阵+QA。新块按下面位置**插入其间**。

### 块A · 派生诊断 DAG（插在 ③ 之上）
把"前瞻那个可用产能数(如126万套)"**自下而上怎么算出来的** 6 层派生显式画出来：
```
设备产能(节拍①×A③×P④×通道②×班次⑯) → 工序产能(×良率⑥⑦×在岗⑰)
→ 产线产能(min瓶颈⑩·WIP⑪·平衡⑫) → 可投产能(∩物料齐套⑬⑭·到货⑮)
→ 产能预测(×爬坡⑳−换型⑤⑱−检修) → 缺口(−需求⑲)
```
- 每层节点可点 → 展开"判定/推导/驱动因素/溯源字段"。
- 数据源：`capacity_forecast`（p50/mainBn）、`bottleneck_matrix`（各工序 tightness/OEE）。
- **不替代** ③ 的四线图 —— DAG 是它的"上游解释"。

### 块B · 产能爬坡 min 包络（插在 ③ 之内/后）
6 条子爬坡取 min 的实际爬坡曲线：投产⑳ / 良率爬坡⑨ / OEE③④ / 熟练⑰ / 换型收敛⑤ / 物料齐套⑬。
- 一眼看出"爬坡被哪条拖住"（如化成 OEE 爬坡被换型拖住）。
- 数据源：`capacity_forecast` 爬坡序列 + `base_capacity_outlook` 逐日。crossDay 竖线复用现有阈值。

### 块C · 20 因素本体标注（顶部折叠图例 + 给 ②④ 因子挂徽标）
- 新增可折叠"20 因素本体图例"（6 层色标 ①–⑳），`factorOntology.ts` 单一来源。
- 给现有 ②根因推演树 的因子、④缓解方案 的杠杆**附加**一个因素徽标（①–⑳）——**纯附加小标，现有文字/逻辑/testid 不动**。
- 目的：现有根因/方案挂上本体坐标，人能看出"这个根因属于哪层因素"。

### 块D · byModel 每产品（`BaseOutlookPanel` 加"按产品"切换）
- 现"按基地"前瞻四线**零改**；加一个"按产品"tab → 每产品(model) T+30/60/90 产能预测 + 每产品**瓶颈工序**。
- **后端**：`base_capacity_outlook` 输出加 `byModel: Array<{ model, p50@30/60/90, mainBn工序, gap }>`，数据来自把已有 **`capacity_forecast` 的 per-model（P50/P90/mainBn）** join 进 outlook。现有 per-base 字段零改（纯加字段）。
- `packages/contracts` outlook schema 同步加 `byModel`（optional，向后兼容）。

---

## 《本体引用与影响》（铁律0）

> **开工前先读 `docs/SYSTEM-ONTOLOGY.md` §3（产能派生链路）/§4（数据流）/§8（断点）**，本单沿"产能金字塔"链路走。

- **对象类型**：Base / Line / Process / Equipment / CapacityForecast / DemandSegment / Order（只读消费，不新增对象类型）。
- **链路**：产能金字塔自下而上派生（节拍×OEE→设备→工序→min瓶颈→产线→Σ工厂→∩物料→预测→缺口）——块A 就是把这条既有链路**可视化**，不改链路本身。
- **闭合断点**：
  - **G-CAPACITY-INFER-PROCESS**（"产能/风险看板只出结论无过程·CEO 信任缺口"）→ 块A/B 直接闭（出派生过程 + 爬坡过程）。
  - **G-CAPACITY-BASE-OUTLOOK** 延伸 → 块D 加每产品维度。
- **不变量**：R6（确定性）、R13（每值可溯）、R14（无写死）—— 见上铁约束。
- **数据变更需回写本体**：块D 给 `base_capacity_outlook` 加 `byModel` 字段 → **必须回写 `docs/SYSTEM-ONTOLOGY.md` 对应数据流/对象字段章节**（本体不回写即过期）。

---

## SEAM-GATE 组合测（复验头号判据·非各半绿）

块D 跨"数据(datacore outlook byModel) × 展示(frontend 按产品 tab)"两半 → **必须一条驱动接缝的组合测**（一个 dev 整单做，禁拆两半不对接）：

- **SEAM 测**：`base_capacity_outlook` 求解器对某基地返回 `byModel` → 断言 **每 model 的 T+30/60/90 与该 model 在 `capacity_forecast` 的 P50 同源勾稽**（改 `capacity_forecast` 输入 → byModel 真变，非写死）；且**每 model 的 mainBn 工序 = capacity_forecast 该 model 的主瓶颈**（跨求解器一致）。
- 前端：`BaseOutlookPanel` "按产品"tab 渲染 byModel 行（新 testid `outlook-bymodel-{model}`），"按基地"现有 testid 不回归。

## DoD（交付即须满足）

1. **现有 `RiskBoardView` / `BaseOutlookPanel` 全部既有测试一条不改、全绿**（功能 100% 保留的硬证据）。
2. 新块各自单测 + 上面 SEAM 组合测通过。
3. **四包 gate 全绿**：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`（datacore 勿并发多 vitest）。
4. 亲手真跑：起内存态 datacore+frontend，点常州基地卡 → 4 个新块真渲染、色板与现页一致、每值有出处；"按产品"tab 出每产品 T+30/60/90+瓶颈。（绿测试≠能用）
5. 块D 回写 `docs/SYSTEM-ONTOLOGY.md`。
6. 金值：无新增 solver/对象类型（块D 仅加字段）→ 无 golden 计数变更；若实现中新增了派生对象则同步 demo-chain/ontology-core 计数。

## 交付方式（LOOP 纪律）

- 一 WO = 一 handoff 分支：dev 建 → push **`claude/handoff-cap-deepen`**，**不碰正线**。
- 审核方隔离复验：worktree 独立 checkout → 四包 gate + SEAM 驱动通 + 亲手真跑 + 像素级色板比对 → cherry-pick 上 canonical → push。
- 退回给精确 `file:line` + 最小修路径。

---

**优先级**：P1（用户点名·闭 G-CAPACITY-INFER-PROCESS 的 CEO 信任缺口）。
**依赖**：无（`capacity_forecast` per-model 与 `base_capacity_outlook` 均已在库，块D 只是接线）。
