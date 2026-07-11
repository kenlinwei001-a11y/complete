# WO · SANDBOX-TRUST-BADGE（沙盘每个数字标真假·让用户敢信）· 详细施工单

> 状态：**待派单**（给 dev 的施工规格；作者不实现）。
> 一句话：给沙盘每个数字（全局态/状态变量 KPI/基地卡/节点态）绑一枚 `dataMode` 徽标（LIVE 实测 / SYNTHETIC 合成 / STALE 陈旧 / UNCALIBRATED 未校准），补上沙盘唯一缺的诚信位——用户一眼知"这数敢不敢信"。
> 依据：`docs/REVIEW-sandbox-intent-vs-reality.md §7`（配套·数据血缘）+ `AUDIT-fake-simulation-inventory.md`（诚实披露只覆盖 3 通道·8 推演视图无）。所有锚点已核对真实存在。
> 纪律：`DESIGN-refit-rollback-plan.md` 七原则。这是**最小、最独立、最符 `genuine-sim` 纪律**的一单，可先落、不依赖 S1。

---

## §0 本体引用与影响（铁律 0 · 门 `prd:check` 机器解析）

**触及对象类型（母体 §2）**：`SimTickState`/`TickState`（§2.I·`contracts/sim.ts:75/14`）· `ObjectInstance.origin`（§2.B·SYNTHETIC/LIVE 血缘）· `SolverDataMode`（§2.E·已有 LIVE/MOCK/STALE/SYNTHETIC）。
**触及链路（母体 §3）**：世界态→`propagateTick`→tick 态→**前端渲染时透传诚实位**（不新增链路，补现有链的披露面）。
**不变量（母体 §5）**：R6 确定性（诚实位纯派生·无造） · **R13 结论可溯源（本 WO 直击·数据血缘诚实）** · R14 零业务常数（徽标文案 i18n） · **KILL-MOCK-RED 红线（无真值不伪造·诚实标合成/未校准）**。
**断点（母体 §8）**：G-DM-1（MOCK 值上线为决策级红的根断点·本 WO 补沙盘侧披露）· G-1（预诊断）。
**门禁（母体 §7）**：`genuine-sim:check`（扩断言到沙盘）· `no-silent-mock:check`（TickState 输出含 dataMode）。
**回写母体**：§2.I 给 `SimTickState` 登记 `dataMode` 字段；§7 `genuine-sim` 断言扩沙盘；`pnpm ontology:slices`。

---

## §1 背景·目标·依赖

### 1.1 问题
沙盘初态是真的（`SandboxView.tsx:43` 不 hash 造伪初态），但**页面不告诉你"这是真态还是合成态、系数标定没标定"**。讽刺的是周边视图（`ProjectSimView`/`PlanAuditView`）已被 `genuine-sim:check` 逼着标 LIVE/MOCK 并用**已存在的 `DataModeBadge` 组件**（`PlanAuditView.tsx:17`），**沙盘自己反而没标**。`SimTickState`（`sim.ts:75`）当前只有 `{state, trace}`，**无 dataMode 字段**。

### 1.2 目标
沙盘每个可见数字绑诚实位 → 用户"敢信"。**复用既有 `DataModeBadge` 组件 + 既有 `SolverDataMode` 枚举**，不造轮子、不加新色。

### 1.3 依赖
- **无前置**（独立于 S1·可先落）。
- **复用**：`components/DataModeBadge`（已有）· `SolverDataMode` 枚举 LIVE/MOCK/STALE/SYNTHETIC（已有·`contracts/solvers`）· `ObjectInstance.origin`（SYNTHETIC 血缘·已有）。

---

## §2 范围（Scope）与非范围

**In scope**：
1. 契约：`SimTickState` 加 `dataMode` 字段（每 tick 态的诚实位·additive）；`SandboxViewConfig.nodeObjectState` 携每对象每变量的来源位。
2. 后端：`propagateTick`/view-config 派生时**透传源诚实位**（真数值派生属性=LIVE；合成对象 origin=SYNTHETIC；关键源滞后=STALE；传导系数未校准=UNCALIBRATED）——**不造，无真值退诚实缺省**。
3. 前端：全局态/stateVar KPI/基地卡/DAG 节点各绑 `DataModeBadge`（复用组件）；顶部一枚"整体可信度"汇总位。

**Out of scope**：
- ❌ 修好数据本身（合成→真接入是连接器的事·本 WO 只诚实标注）。
- ❌ 校准系数（→ calibration WO·本 WO 只标"未校准"）。
- ❌ 前端新组件/新色（复用 DataModeBadge + 既有 token）。

---

## §3 详细设计

### 3.1 契约（`packages/contracts/src/sim.ts`）
```typescript
// 复用既有 SolverDataMode 语义（LIVE/MOCK→SYNTHETIC/STALE），加 UNCALIBRATED（传导系数为默认非标定）
export const SimDataModeSchema = z.enum(["LIVE", "SYNTHETIC", "STALE", "UNCALIBRATED"]);

// SimTickState additive 加 dataMode（整 tick 汇总）+ 逐 (对象,变量) 细粒度可选
export const SimTickStateSchema = z.object({
  /* …现有 sessionId/tick/state/pending/trace… */
  dataMode: SimDataModeSchema.default("SYNTHETIC"),                 // 整 tick 汇总诚实位
  cellDataMode: z.record(z.string(), z.record(z.string(), SimDataModeSchema)).optional(), // 逐格（对象→变量→位）
});
```
- `SandboxViewConfig.nodeObjectState` 旁加 `nodeObjectMode`（每对象每变量来源位·从 `obj.origin` + 派生属性新鲜度 + 规则 coefficientRef 是否校准 派生）。

### 3.2 后端派生（诚实位来源·`app.ts` buildRealSnapshot + `sim/propagation.ts`）
| 位 | 判据（真实·不造） |
|---|---|
| **LIVE** | 对象 `origin≠SYNTHETIC` 且该派生属性有真数值且新鲜（`dataHealth` 未滞后） |
| **SYNTHETIC** | 对象 `origin=SYNTHETIC`（合成种子·demo 全此） |
| **STALE** | 关键源 `dataHealth.critical` 滞后（复用既有 C09 降级判据） |
| **UNCALIBRATED** | 该传导规则 `coefficientRef` 为空或未经校准（=冷启动默认系数·G-10） |
- 汇总规则：整 tick dataMode = 最"不可信"档（LIVE < UNCALIBRATED < SYNTHETIC < STALE 由派生态取最弱）。**R6 纯派生·R13 溯源·绝不造**。

### 3.3 前端（`SandboxView.tsx` + 复用 `DataModeBadge`）
- 全局态大数旁：`<DataModeBadge mode={tickState.dataMode} />`。
- 每 stateVar KPI、每基地卡、DAG 节点：绑 `cellDataMode`（复用组件·文案 i18n "基于N小时前/合成数据/未校准系数"）。
- 顶部一枚汇总"可信度"位（如"本次推演：合成数据·系数未校准·仅供参考"）。**零新色**（DataModeBadge 用既有 token）。

---

## §4 触点清单

| 文件 | 改动 | 面 |
|---|---|---|
| `packages/contracts/src/sim.ts` | `SimTickState +dataMode/cellDataMode`（additive）·`SimDataMode` 枚举·view-config +nodeObjectMode | 契约 |
| `apps/datacore/src/app.ts`（buildRealSnapshot / sim/view-config） | 派生诚实位（真判据·不造） | 后端 |
| `apps/datacore/src/sim/propagation.ts` | 透传/合成 tick dataMode（延迟贡献继承源位） | 后端 |
| `apps/frontend-shell/src/views/sim/SandboxView.tsx` | 绑 `DataModeBadge`（复用·各数字位） | 前端 |
| `scripts/check-genuine-sim.mjs` | 断言扩：沙盘 KPI 消费 dataMode | 门 |
| `docs/SYSTEM-ONTOLOGY.md` §2.I/§7 | 回写 | 回写 |

---

## §5 验收（真跑·铁律 0.4·含回退演练）
1. **合成租户诚实**：demo 起沙盘→全局态/每 KPI/每基地卡显"合成"徽标（origin=SYNTHETIC）；逐值对 `SimTickState.dataMode`。
2. **未校准诚实**：某传导规则 coefficientRef 空→相关数字显"未校准"。
3. **LIVE 真实**：给一租户导真数据+校准→相应数字转 LIVE（证判据真读非写死）。
4. **green→red 自证**：临时把真态改回合成→徽标应从 LIVE 变 SYNTHETIC（`genuine-sim:check` 断言守）。
5. **R6**：同 session 双跑 dataMode 字节一致。
6. **回退演练**：feature `sim.trust_badge` 关→不显徽标、页面 100% 原样；契约字段 default→旧 SimTickState 反序列化零破坏。
7. **gates 全绿**（genuine-sim / no-silent-mock / prd:check）。

## §6 失败判据（中止即回退）
- F1 无真值却标 LIVE（造假位·违 KILL-MOCK-RED）→ 关闸,查派生判据。
- F2 契约破坏旧 SimTickState（dataMode 非 default）→ revert。
- F3 徽标误覆盖（把合成标成实测）→ genuine-sim 门红即拒合。
- F4 门禁红 → 不进下一期。

## §7 排序
- **独立·可先落**（不依赖 S1）；与 S1 并行（触点：S2 后端 dataMode + 徽标，S1 主链路由，弱相交）。
- 是"从不敢信到敢信"最小一步。

## 附录 · 证据锚点
`contracts/sim.ts:14/75/81`（TickState/SimTickState/trace 无 dataMode）·`components/DataModeBadge`（已有·`PlanAuditView.tsx:17` 用）·`SandboxView.tsx:43`（真初态不造）·`ProjectSimView.tsx:464`（dataMode 消费先例）·`AUDIT-fake-simulation-inventory.md`（披露缺口）·母体 §5 R6/R13/R14/KILL-MOCK-RED · §8 G-DM-1。
