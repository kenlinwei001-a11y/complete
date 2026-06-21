# PRD · A3 · 14 域参考本体 + 域内/跨域两库 + 多跳切片规划器（图路径搜索）+ 切片索引

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 波次 Wave 1（基座，最大块） |
| 取代/扩展 | 扩 `PRD-ontology-core.md` · `PRD-ontology-browser-field-coverage.md` · 关联本体 §10（系统自我域切片范式，本项为**业务域**对应物） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§10.1 两级域辨析 / §10.3 域内切片 / §10.4 跨域节点 / §3 链路） · `apps/datacore/src/graphmeta.ts` · `apps/datacore/src/ontology-core.ts`（SliceSpec/executeSlice） · `docs/REFERENCE-HTML-INVENTORY.md` §2.14（参考原型 95+ 节点 / 16 域） |
| 索引 | `PRD-A-series-roadmap.md` |

> 一句话：把"业务参考本体"补成 **14 域完整图**，再建**域内库 + 跨域库**两套切片库，并造一个**多跳切片规划器（在 OntologyLink 图上做确定性路径搜索 → 自动产 SliceSpec）** + **切片索引**（先查复用、查不到再规划），作为 A4(浏览)/A5(查能力·比差·多跳)/A10(闭环验证) 的共同基座。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2）：`OntologyType`/`OntologyLink`/`OntologyVersion`·`SliceSpec`（root+hops）·`ObjectInstance`·`Domain`（归域治理）；**新增**：`SlicePlan`（规划器产物，= 一条自动生成的 SliceSpec + 路径证据）·`SliceIndexEntry`（切片索引项，派生投影非新真值源 R13）。
- **触及链路**（§3 / §10.3）：本项把本体 §10.3 的"系统自我域切片"范式落到**业务域**——新增切片族 `biz.<域>.<形状>`（域内）与 `biz.x.<seam>`（跨域）。规划器是 `Query/Objective → SlicePlan(root→hops) → executeSlice → ObjectInstance` 链的**自动接线器**（喂 QOS 路径 B `resolve_slice` 与构建闭包 `validateClosure`）。
- **触及事件/数据流**（§4，D-29）：复用 `ontology.published`（本体变 → 切片索引重建）；**新增** `slice.planned`（规划器产出/复用 SlicePlan，IN_SESSION，失效 slice-library/planner 缓存）。
- **触及不变量**（§5）：
  - **R1** 跨包仅依赖 contracts（SlicePlan/SliceIndex schema 入 `contracts`）。
  - **R2** tenant_id：参考本体为元租户 `__platform__` 只读基线 + 各租户发布版叠加；切片/索引按租户隔离。
  - **R6** 确定性：路径搜索是**确定性图算法**（固定 tie-break：hop 数 → 域内优先 → 类型 key 字典序），同图同目标同结果（无随机/无 LLM）。
  - **R12** 双向闭包：规划器产出的切片必满足"root+hops 类型存在 + 每跳 ref 真实"；喂闭包门。
  - **R14** 无业务常数：14 域清单/参考本体来自**配置化注册表**（非前端内联）；规划器对任意已发布本体通用。
- **关闭/影响断点**（§8）：补 **G-3/G-8**（场景→切片→答案 的切片自动化一环）；为 **G-5** 去电池锁死提供"域可配置 + 通用规划器"地基。
- **门禁**（§7）：`ontology:check`（域/切片锚不漂）· 闭包门（规划切片过 R12）· 新增 `slice-planner:check`（规划器对参考本体每个声明目标都能搜出有效路径，否则红）。
- **回写承诺**：落地回写本体 §2（SlicePlan/SliceIndexEntry）· §3（业务域切片族 biz.*）· §4（slice.planned）· §10.3（业务域切片表）· §10.4（业务跨域节点表）· §8（G-3/G-8 推进）。

## 1. 目标 / 非目标
### 目标
1. **14 域参考本体**：把业务对象按 14 域完整归类（现 `GRAPH_DOMAIN` 9 域 → 补 `sales/material/finance/external/decision` 5 域），并提供一份跨 14 域的**参考本体基线**（对象类型 + 链路 + 派生口径，源自参考原型 95+ 节点登记表，平台自有命名）。
2. **域内/跨域两库**：① 域内切片库 `biz.<域>.<形状>`（单域可追溯子图）；② 跨域切片库 `biz.x.<seam>`（跨域接缝路径，= 高价值断点高发区）。两库均以现有 `SliceSpec(root→hops)` 形态登记。
3. **多跳切片规划器**：输入 `{rootType, targets[]|objective}` → 在 OntologyLink 图上**确定性路径搜索**（最短跳 + tie-break）→ 产出 `SlicePlan`（root + hops + 每跳过滤）→ 经既有 `executeSlice` 可执行。
4. **切片索引复用**：建 `SliceIndex`（按 域 / rootType / 跨域类型集 索引已发布切片）；规划器**先查索引复用**，命中即返回既有切片，未命中才新规划（避免重复造切片）。

### 非目标
- 不引图数据库（A9 旁路，延后）；路径搜索在内存对象图上做。
- 不替换 QOS 现有 `resolve_slice`；规划器是其上游"切片来源"，可被路径 B 调用。
- 不在本项落 A4 浏览器 UI（A4 单独 PRD，消费本项的域/切片/索引）。

## 2. 现状与缺口（file:line）
| 维度 | 现状 | 缺口 |
|---|---|---|
| 业务域 | `graphmeta.ts:8 GRAPH_DOMAIN`（9 域）+ `DOMAIN_ORDER`（9+solver/agent） | 缺 sales/material/finance/external/decision 5 域；无"14 域参考本体基线" |
| 切片 | `ontology-core.ts:552 executeSlice` / `:703 putSliceSpec` / `:715 getSliceSpec`（root+hops 逐跳过滤，A6 行级） | 切片靠**人工登记**；无域内/跨域两库组织 |
| 规划器 | **不存在**（grep `slicePlanner/planSlice/pathSearch/sliceIndex` 全空） | 无图路径搜索、无自动产切片 |
| 索引 | 无 | 无切片索引、无复用查找 |
| 参考本体 | 参考原型 `nodes[]/N()`（95+ 节点，16 域，含逐级 formula/bound，见 INVENTORY §2.14） | 未落为系统的参考本体基线 |

## 3. 设计（复用现有 SliceSpec/executeSlice；规划器+索引为绿地）
### 3.1 14 域注册表（配置驱动，R14）
- 扩 `graphmeta.ts`：`GRAPH_DOMAIN` 补 5 域映射；新增 `BUSINESS_DOMAINS`（14 域 key + 显示名 + 配色，源自 INVENTORY §2.14 的 16 域去 solver/agent）。**域清单为注册表常数，可被行业模板覆盖**（去电池锁死前置）。
- 14 域：`factory product process equip people quality capacity forecast sales material finance plan external decision`。
- 落域的对象类型：复用既有 + 收编 `PRD-cockpit-capacity-1to1-parity.md` 的新类型（`DemandSegment`→forecast、`MaterialBalance`→material、`FinancePlan`→finance、`RootCauseChain`→decision、`ExternalSignal`→external 已在）。**两 PRD 协同：A3 给域框架，cockpit PRD 填 sales/material/finance/decision 域实体。**
### 3.2 参考本体基线（元租户只读）
- `apps/datacore/src/synthetic/reference-ontology.ts`（新）：把参考原型节点登记表的**对象类型/链路/派生口径**确定性投影为元租户 `__platform__` 的参考本体（origin `REFERENCE`，可溯回 INVENTORY 章节），各业务租户经 R2 不可见、仅作规划器/A4 的"参考底座"。复用 objects/links 仓储、不新建表（R9）。
### 3.3 域内/跨域两库
- `slice-library.ts`（新）：确定性派生两库——
  - 域内 `biz.<域>.<形状>`：对每域，以该域"主对象"为 root，hops 限本域 ref → 单域子图切片。
  - 跨域 `biz.x.<seam>`：对每个**跨域节点**（一个类型的 ref 跨到他域，= §10.4 接缝）生成跨域切片（如 `biz.x.order_to_capacity`：Order→Model→Base→Process）。
- 两库经 `putSliceSpec` 登记为一等 SliceSpec（可执行、可被 QOS 调）。
### 3.4 多跳切片规划器（图路径搜索）
- `slice-planner.ts`（新）`planSlice(ctx, {rootType, targets[], maxHops})`：
  1. 取本租户已发布本体的 OntologyLink 图（类型为节点，ref/link 为边，双向）。
  2. **确定性 BFS/Dijkstra**（边权=1）：从 rootType 搜到每个 target 的最短路径；多目标取并集成 hops 树。
  3. **tie-break（R6）**：跳数升序 → 域内边优先于跨域边 → 目标类型 key 字典序 → 边 key 字典序。
  4. 产 `SlicePlan{sliceKey(派生), root, hops[{viaField, toType, filter?}], pathEvidence[], spannedDomains[]}`；经 `executeSlice` 可直接跑。
  5. 搜不到 → 返回 `NO_PATH`（结构化，喂 A5"比差"/GapReport `NO_SLICE`）。
- **纯函数 + 确定性**：无 LLM、无随机；测试以参考本体固定图断言路径字节一致。
### 3.5 切片索引复用
- `slice-index.ts`（新）`SliceIndex`：派生投影（R13，非新真值源）——按 `{domain, rootType, spannedTypesSet}` 索引所有已发布 SliceSpec + 两库切片。
- `planSlice` 先 `index.lookup({rootType, targets})`：覆盖目标类型集的既有切片 → 直接复用（返回 `reused:true`）；未命中 → §3.4 新规划并回写索引。
- 索引随 `ontology.published`/`slice.planned` 失效重建。

## 4. 契约 / 端点 / 数据模型
- `contracts/slice-planner.ts`（新）：`SlicePlanSchema`、`SliceIndexEntrySchema`、`PlanSliceRequest/Response`、`NoPathReason`。
- 端点（DataCore）：`POST /a/v1/slices/plan`（规划/复用，返回 SlicePlan + reused 标记）· `GET /a/v1/slices/library?scope=intra|cross|all`（两库）· `GET /a/v1/slices/index`（索引）· `GET /a/v1/reference-ontology`（元租户参考本体，只读）。
- 仓储：SliceSpec 复用既有；SlicePlan 可不持久（按需算）或登记为 SliceSpec；SliceIndex 为派生投影（不新表，R9）。
- `slice.planned` 入 `event-subscriptions.ts`（D-29）。

## 5. 关键流程（端到端）
A5/QOS 给 `{rootType=Order, targets=[Base,Process], objective:"产能瓶颈"}` → `planSlice` 先查 `SliceIndex`（命中 `biz.x.order_to_capacity` 即复用）→ 未命中则 BFS 出 `Order→Model→Base→Process`（域 product→factory→process，跨 2 接缝）→ `SlicePlan` → `executeSlice`（A6 行级过滤）→ ObjectInstance 子图 → 喂求解器/答案；搜不到 → `NO_PATH` → A5 标"缺切片"。

## 6. 非功能（§5）
R6 确定性图算法（固定 tie-break，单测字节锁）· R2 多租户隔离 + 元租户参考本体只读 · R12 规划切片过闭包 · R14 14 域/参考本体配置化。

## 7. 验收（DoD）
- 14 域全覆盖（每业务对象类型 ∈ 唯一域）；参考本体基线落元租户可查。
- 两库切片可列、可执行；`planSlice` 对参考本体每个声明目标都搜出有效路径或诚实 NO_PATH。
- 索引复用生效（重复目标返回 reused）。
- `pnpm -r build && pnpm -r test` 全绿（新增 slice-planner 单测：固定图路径字节一致 + 复用命中 + NO_PATH）；`ontology:check` / 闭包门 / 新 `slice-planner:check` 过；`debattery:check` 不超基线。
- 回写本体 §2/§3/§4/§10.3/§10.4/§8。

## 8. 分期
- **A3.1** 14 域注册表 + 5 新域归类 + 参考本体基线（元租户）。
- **A3.2** 域内/跨域两库派生 + 登记 + 端点。
- **A3.3** 多跳切片规划器（BFS + tie-break + SlicePlan）+ `slice-planner:check`。
- **A3.4** 切片索引 + 复用查找 + `slice.planned` 事件。

> 基线分支：实现前定准 wizardly-gauss（推荐）vs vigilant-knuth。规划器/索引为新文件，跨分支冲突小。
