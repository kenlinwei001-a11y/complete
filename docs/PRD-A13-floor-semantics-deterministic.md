# PRD · A13 · 通用图求解器地板语义确定化（concentration_risk / supplier_disruption_radius 去 Kimi）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 波次 Wave 2 |
| 取代/扩展 | 扩 `PRD-addendum-solvers-and-gaps.md`（通用图求解器）· `PRD-generic-inference.md` · 关联 `databuilder/solver-args.ts`（入参倒推） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.E 通用图求解器 · §5 R6） · `apps/datacore/src/solvers/service.ts:45`（shared_bottleneck）`:79` · `apps/datacore/src/solvers/extended.ts` · `apps/datacore/src/databuilder/solver-args.ts:9`（运行期标量不自动填的注释） |
| 索引 | `PRD-A-series-roadmap.md` |

> 一句话：通用图求解器（`concentration_risk`/`supplier_disruption_radius` 及亲族 `shared_bottleneck`/`margin_attribution`）把"哪个字段是 root / via / 优先级(地板) / 叶层"映射到任意本体时存在**多源/标量歧义**，目前靠 **Kimi(LLM) 兜底消歧** → 违反 R6 确定性。A13 用**结构化确定性推断**（ref 基数 / 扇入扇出 / 主键 / 命名启发）+ **显式优先级与 tie-break** 把角色解析做成纯函数，**去掉 LLM 兜底**；真歧义时返回**确定性排序的候选**（而非随机/LLM）。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.E）：`Solver(concentration_risk/supplier_disruption_radius/shared_bottleneck/margin_attribution)`·`OntologyType/OntologyLink`（ref 图）·`PropertyDef`（字段角色）·`SolverArgs`（solver-args 倒推产物）。
- **触及链路**（§3）：`本体 ref 图 → resolveFieldRoles(确定性) → solver args(root/via/priority/leaf/floor) → compute`；替换"args 缺 → LLM 消歧"为"args 缺 → 结构推断"。
- **触及事件/数据流**（§4）：无新事件。
- **触及不变量**（§5）：
  - **R6 确定性（核心）**：角色解析是纯函数（无 LLM、无随机），同本体同求解器**字节一致**；真歧义返回**确定性排序候选** + 置信度，调用方/HITL 选，**不调 Kimi**。
  - **R14**：推断规则基于结构（基数/扇入扇出/PK/语义命名表），命名表配置化、非业务常数内联。
- **关闭/影响断点**（§8）：闭合"通用求解器仍依赖 LLM 消歧 → 非确定"的接缝；提升 A14 evals 可比对性（去 LLM 抖动）。
- **门禁**（§7）：`chain:check` · 求解器确定性回归（同输入字节一致）· 新增 `floor-semantics:check`（对参考本体每个通用求解器场景，角色解析有唯一确定结果或确定性候选）。
- **回写承诺**：回写本体 §2.E（通用求解器角色解析确定化 + 去 LLM）· §8（接缝闭合）。

## 1. 目标 / 非目标
### 目标
1. **确定性角色解析** `resolveFieldRoles(ontology, solverKey)`：为通用图求解器解析所需字段角色——
   - `root`（聚合/扇出起点）· `via`（分组/路径字段）· `priority`/`floor`（降级/底线判定字段，"地板语义"）· `leaf`（叶层敞口）· `sink`（收敛根）。
2. **去 Kimi**：消歧不再调 LLM；规则 = 结构信号 + 显式优先级 + tie-break。
3. **真歧义诚实**：当结构信号不足以唯一确定，返回**确定性排序的候选列表 + 置信度**（供 solver-args 默认取 top1，或 HITL 选），而非 LLM 猜或随机。

### 非目标
- 不改求解器 compute 数学；只改"字段角色从哪来"。
- 不强制 HITL；默认取确定性 top1，歧义可选上报（对接 A4/A5）。

## 2. 现状与缺口（file:line）
| 维度 | 现状 | 缺口 |
|---|---|---|
| 角色来源 | `solver-args.ts` 倒推多跳路径；运行期标量"不自动填"（`:9` 注释）→ 落到 LLM 兜底 | 多源/标量歧义靠 Kimi 消歧 → 非确定（R6 破） |
| 通用求解器 | `service.ts:45` shared_bottleneck（viaField/priorityField）· extended.ts concentration_risk/supplier_disruption_radius | 字段角色映射歧义无确定性裁决 |
| 地板语义 | priority/floor 字段选择无规则 | "哪个字段当底线/优先级"靠 LLM |

## 3. 设计（结构推断 + 优先级 + tie-break + 候选）
### 3.1 结构信号（确定性）
- `field-roles.ts`（新）从本体 ref 图为候选字段算信号：**扇入度**（多少类型 ref 它 → sink/root 候选）· **扇出度** · **ref 基数**（1:N/N:1，复用 A3 规划器/modeling 的 cardinality）· **PK 唯一率** · **数值/枚举类型**（priority/floor 多为数值或有序枚举）· **语义命名表**（priority/level/tier/floor/threshold/grade → priority；supplier/vendor/source → root；customer/order → leaf；可配置 R14）。
### 3.2 角色优先级 + tie-break（R6）
- 每角色一组**加权规则**（如 root = max 扇出 + 命名命中；floor = 数值/有序枚举 + 命名"floor/threshold/priority" + 单调判定可用）。
- **tie-break 固定**：信号分降序 → 命名命中优先 → 字段 key 字典序。保证唯一确定。
### 3.3 候选与置信度
- 输出 `FieldRoleResolution{roles:{root,via,priority,floor,leaf,sink}, candidates:{role:[{field,score}]}, confidence, ambiguous:bool}`。
- `ambiguous=true`（top1/top2 分差 < 阈值）→ 仍给确定性 top1 作默认 + 候选列表上报（A5"比差"/A4 可让人选）。**绝不调 LLM。**
### 3.4 接入
- `solver-args.ts` 倒推时调 `resolveFieldRoles` 填角色；移除 LLM 消歧分支（或仅在 `ambiguous` 时上报候选，不自动 LLM）。
- 运行期标量（rootId/budget）仍诚实留空 → 由调用方/启动器提供（非 A13 职责）。

## 4. 契约 / 端点
- `contracts/solvers.ts`：`FieldRoleResolutionSchema`、`SOLVER_FIELD_ROLES`（每通用求解器需要的角色集）。
- 端点（可选）：`GET /a/v1/solvers/:key/field-roles?ontologyVersion=`（返回确定性解析 + 候选，供 A5/A4）。
- 命名语义表 `field-role-lexicon.ts`（配置化）。

## 5. 关键流程（端到端）
某行业本体 → concentration_risk 需 root/via/sink → `resolveFieldRoles` 按扇入/基数/命名确定 `供应商=sink、客户=root、物料=via` → 唯一确定则直接喂 compute；若 supplier/vendor 两字段同分 → 返回确定性候选(supplier 字典序优先) + ambiguous 标记 → 默认取 top1，A5 可让人确认。全程无 Kimi。

## 6. 非功能（§5）
R6（纯函数确定，单测对固定本体字节锁）· R14（命名表配置化）。

## 7. 验收（DoD）
- concentration_risk/supplier_disruption_radius/shared_bottleneck 角色解析**不再调 LLM**；同本体同求解器字节一致。
- 真歧义返回确定性候选 + 置信度（非 LLM）。
- `pnpm -r build && pnpm -r test` 全绿（新增 field-roles 单测 + 求解器确定性回归 + 去 LLM 验证）；`floor-semantics:check`/`chain:check` 过。
- 回写本体 §2.E/§8。

## 8. 分期
- **A13.1** field-roles 结构信号 + 优先级 + tie-break + 候选输出。
- **A13.2** 接入 solver-args（移除 LLM 消歧）+ field-role-lexicon 配置化。
- **A13.3** `/field-roles` 端点（供 A5/A4）+ `floor-semantics:check` 门。

> 基线分支：纯后端新文件 + solver-args 改一处；冲突小。提升 A14 evals 去抖。
